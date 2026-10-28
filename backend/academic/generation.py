"""Constraint based suggestions for the recurring weekly timetable.

Generation never writes sessions. Only apply_candidate() changes a draft, after
checking its revision and validating every proposed allocation again.
"""

from collections import Counter, defaultdict
from time import monotonic

from django.db import transaction
from django.db.models import F
from django.utils import timezone
from ortools.sat.python import cp_model

from . import models
from .quick_grid import GridConflict, reconcile, save_cell
from .scheduling import availability_issue, preferred_minutes, validate_session
from .workload import audit_intervals


def minute(value):
    return value.hour * 60 + value.minute


def clock(value):
    return f"{value // 60:02d}:{value % 60:02d}"


def issue(code, message, *, severity="BLOCKER", offering=None, group=None, details=None):
    return {"code": code, "severity": severity, "message": message,
            "offering_id": offering.pk if offering else None,
            "group_code": group.code if group else (offering.group.code if offering else None),
            "subject_name": offering.subject.name if offering else None,
            "details": details or {}}


def overlaps(a, b):
    return a["weekday"] == b["weekday"] and a["start"] < b["end"] and b["start"] < a["end"]


def rest_conflict(a, b):
    if a["weekday"] % 7 + 1 == b["weekday"]:
        return 1440 + b["start"] - a["end"] < 660
    if b["weekday"] % 7 + 1 == a["weekday"]:
        return 1440 + a["start"] - b["end"] < 660
    return False


def _scopes(offering, teacher_id, room_id):
    return {
        (models.Scope.INSTITUTION, None),
        (models.Scope.COURSE, offering.group.course_id),
        (models.Scope.GROUP, offering.group_id),
        (models.Scope.OFFERING, offering.pk),
        (models.Scope.TEACHER, teacher_id),
        (models.Scope.ROOM, room_id),
    }


def _fits_windows(context, offering, teacher_id, room_id, weekday, start, end):
    scopes = _scopes(offering, teacher_id, room_id)
    windows = [window for window in context["windows"][weekday]
               if (window.scope, window.scope_id) in scopes
               and (window.profile_id is None or window.profile_id == context["schedule"].time_profile_id)]
    profiled_scopes = {window.scope for window in windows if window.profile_id}
    windows = [window for window in windows if window.profile_id or window.scope not in profiled_scopes]
    if not windows:
        return False
    return all(any(minute(window.starts_at) <= start and end <= minute(window.ends_at)
                   for window in windows if window.scope == scope)
               for scope in {window.scope for window in windows})


def _blocked(context, offering, teacher_id, room_id, weekday, start, end):
    scopes = _scopes(offering, teacher_id, room_id)
    return any((block.scope, block.scope_id) in scopes
               and start < minute(block.ends_at) and minute(block.starts_at) < end
               for block in context["blocks"][weekday])


def _fixed_conflict(context, offering, teacher_id, room_id, weekday, start, end):
    candidate = {"weekday": weekday, "start": start, "end": end}
    for fixed in context["fixed"]:
        same_teacher = fixed["teacher_id"] == teacher_id
        if overlaps(candidate, fixed):
            if same_teacher:
                return "TEACHER_BUSY"
            if fixed["room_id"] == room_id:
                return "ROOM_BUSY"
            if fixed["group_id"] == offering.group_id:
                return "GROUP_BUSY"
        if same_teacher and rest_conflict(candidate, fixed):
            return "TEACHER_REST"
    return None


def _teacher_for(offering):
    eligible = [teacher for teacher in offering.eligible_teachers.all() if teacher.is_active]
    if offering.assigned_teacher_id:
        return next((teacher for teacher in eligible if teacher.pk == offering.assigned_teacher_id), None)
    return eligible[0] if len(eligible) == 1 else None


def _partitions(offering, remaining_minutes, flexible=False):
    hours = remaining_minutes // 60
    if flexible:
        return [60] * hours
    preferred = max((item.duration_minutes for item in offering.requirements.all()
                     if item.kind == "AUTO_OFFER" and item.duration_minutes % 60 == 0), default=120)
    preferred = min(preferred, 240)
    result = []
    while hours:
        length = min(hours, preferred // 60)
        result.append(length * 60)
        hours -= length
    return result


def _context(schedule, mode):
    institution = schedule.course.institution
    groups = list(models.ClassGroup.objects.filter(
        course=schedule.course, term=schedule.term, time_profile=schedule.time_profile,
        is_active=True).order_by("code"))
    offerings = list(models.SubjectOffering.objects.filter(group__in=groups, is_active=True)
                     .select_related("group", "subject", "assigned_teacher")
                     .prefetch_related("eligible_teachers", "requirements", "required_features", "subject__required_features"))
    slots = list(schedule.slots.order_by("display_order", "starts_at"))
    fixed = []
    preserved = defaultdict(list)
    for session in models.ScheduledSession.objects.filter(schedule__term=schedule.term).select_related("requirement__offering", "room"):
        movable = session.schedule_id == schedule.pk and mode == "REARRANGE" and not session.is_locked
        if movable:
            continue
        fixed.append({"weekday": session.weekday, "start": minute(session.starts_at), "end": minute(session.ends_at),
                      "teacher_id": session.teacher_id, "room_id": session.room_id,
                      "group_id": session.requirement.offering.group_id, "session_id": session.pk})
        if session.schedule_id == schedule.pk:
            preserved[session.requirement.offering_id].append(session)
    for event in models.TeacherEvent.objects.filter(term=schedule.term, is_active=True):
        fixed.append({"weekday": event.weekday, "start": minute(event.starts_at), "end": minute(event.ends_at),
                      "teacher_id": event.teacher_id, "room_id": None, "group_id": None,
                      "event_id": event.pk})
    windows = defaultdict(list)
    for window in models.TimeWindow.objects.filter(institution=institution, is_active=True).select_related("profile"):
        if window.profile_id is None or (window.profile_id == schedule.time_profile_id and window.profile.is_active):
            windows[window.weekday].append(window)
    blocks = defaultdict(list)
    for block in models.TimeBlock.objects.filter(institution=institution, is_active=True):
        blocks[block.weekday].append(block)
    rooms = list(models.Room.objects.filter(institution=institution, is_active=True).prefetch_related("features"))
    availability = defaultdict(list)
    for rule in models.TeacherAvailability.objects.filter(term=schedule.term, is_active=True):
        availability[rule.teacher_id].append(rule)
    return {"schedule": schedule, "groups": groups, "offerings": offerings, "slots": slots,
            "rooms": rooms, "windows": windows, "blocks": blocks, "fixed": fixed,
            "preserved": preserved, "availability": availability, "mode": mode}


def _slot_spans(slots, duration):
    for index, first in enumerate(slots):
        end = minute(first.starts_at)
        chosen = []
        for slot in slots[index:]:
            if minute(slot.starts_at) != end:
                break
            chosen.append(slot)
            end = minute(slot.ends_at)
            if end - minute(first.starts_at) == duration:
                yield first, chosen, end
                break
            if end - minute(first.starts_at) > duration:
                break


def _options(context, offering, teacher, rooms, duration):
    options = []
    rejected = Counter()
    for weekday in range(1, 8):
        for first, chosen, end in _slot_spans(context["slots"], duration):
            start = minute(first.starts_at)
            for room in rooms:
                if not _fits_windows(context, offering, teacher.pk, room.pk, weekday, start, end):
                    rejected["WINDOW"] += 1
                    continue
                availability = availability_issue(teacher.pk, context["schedule"].term_id, weekday,
                                                  start, end, context["availability"][teacher.pk])
                if availability:
                    rejected[availability["code"]] += 1
                    continue
                if _blocked(context, offering, teacher.pk, room.pk, weekday, start, end):
                    rejected["BLOCK"] += 1
                    continue
                conflict = _fixed_conflict(context, offering, teacher.pk, room.pk, weekday, start, end)
                if conflict:
                    rejected[conflict] += 1
                    continue
                teacher_rules = context["availability"][teacher.pk]
                preferred = preferred_minutes(weekday, start, end, teacher_rules)
                has_preferences = any(rule.kind == models.TeacherAvailability.Kind.PREFERRED for rule in teacher_rules)
                options.append({"offering_id": offering.pk, "group_id": offering.group_id,
                                "subject": offering.subject.name, "teacher_id": teacher.pk,
                                "teacher": teacher.name, "room_id": room.pk, "room": room.name or room.code,
                                "room_code": room.code,
                                "weekday": weekday, "start": start, "end": end,
                                "slot_id": first.pk, "span": len(chosen),
                                "preferred": bool(preferred),
                                "room_priority": "PRIMARY" if room.room_type == offering.subject.required_room_type else "SECONDARY",
                                "room_penalty": 0 if room.room_type == offering.subject.required_room_type else (end - start) // 60 * 10000,
                                "preference_penalty": (end - start - preferred) // 60 * 100 if has_preferences else 0})
    return options, rejected


def prepare(schedule, mode="FILL", *, flexible=False):
    if mode not in {"FILL", "REARRANGE"}:
        raise ValueError("Modo de geração inválido.")
    context = _context(schedule, mode)
    issues = []
    blocks = []
    summaries = []
    sole_room_demand = Counter()
    sole_room_slots = defaultdict(set)
    if not context["slots"]:
        issues.append(issue("NO_SLOTS", "Configure as faixas de horário da grade antes de gerar."))
    for offering in context["offerings"]:
        expected = offering.subject.onsite_weekly_hours
        if expected is None:
            issues.append(issue("MISSING_WORKLOAD", "Informe as horas presenciais semanais da disciplina.", offering=offering))
            continue
        required = expected * 60
        existing = sum(minute(item.ends_at) - minute(item.starts_at)
                       for item in context["preserved"][offering.pk])
        remaining = required - existing
        row = {"offering_id": offering.pk, "group_code": offering.group.code,
               "subject_name": offering.subject.name, "required_minutes": required,
               "preserved_minutes": existing, "pending_minutes": max(0, remaining)}
        summaries.append(row)
        incompatible_preserved = [session.pk for session in context["preserved"][offering.pk]
                                  if session.room.room_type not in offering.subject.allowed_room_types()]
        if incompatible_preserved:
            issues.append(issue("ROOM_TYPE_MISMATCH", "Aulas já alocadas usam ambiente incompatível com as opções da disciplina.", offering=offering,
                                details={"session_ids": incompatible_preserved, "allowed_room_types": sorted(offering.subject.allowed_room_types())}))
        if remaining < 0:
            issues.append(issue("OVER_ALLOCATED", "A oferta já possui mais horas presenciais do que o previsto.", offering=offering,
                                details={"excess_minutes": -remaining}))
            continue
        if not remaining:
            continue
        teacher = _teacher_for(offering)
        if teacher is None:
            issues.append(issue("TEACHER_UNASSIGNED", "Defina um professor ativo e vinculado à oferta antes de gerar.", offering=offering))
            continue
        required_features = {feature.pk for feature in offering.required_features.all()} | {feature.pk for feature in offering.subject.required_features.all()}
        compatible = [room for room in context["rooms"]
                      if room.room_type in offering.subject.allowed_room_types()
                      and required_features.issubset({feature.pk for feature in room.features.all()})]
        if not compatible:
            environments = offering.subject.get_required_room_type_display()
            if offering.subject.secondary_room_type:
                environments += f" ou {offering.subject.get_secondary_room_type_display()}"
            issues.append(issue("NO_COMPATIBLE_ROOM", f"Não há ambiente ativo do tipo {environments} com os recursos exigidos pela disciplina.", offering=offering,
                                details={"allowed_room_types": sorted(offering.subject.allowed_room_types()), "required_feature_ids": sorted(required_features)}))
            continue
        durations = _partitions(offering, remaining, flexible)
        if remaining % 60:
            issues.append(issue("NON_CLASS_HOUR", "A carga restante não é múltipla de uma hora-aula.", offering=offering))
            continue
        for index, duration in enumerate(durations):
            options, rejected = _options(context, offering, teacher, compatible, duration)
            if not options:
                code = "NO_BLOCK_CANDIDATE"
                reason = "O bloco não cabe em nenhuma combinação livre de janela, docente e sala."
                resource_rejected = sum(value for key, value in rejected.items() if key != "WINDOW")
                availability_rejected = rejected["TEACHER_UNAVAILABLE"] + rejected["OUTSIDE_TEACHER_AVAILABILITY"]
                if resource_rejected and availability_rejected >= resource_rejected / 2:
                    code, reason = "TEACHER_UNAVAILABLE", "Nenhuma faixa permitida do professor comporta este bloco. Revise a disponibilidade docente."
                elif resource_rejected and rejected["TEACHER_BUSY"] + rejected["TEACHER_REST"] >= resource_rejected / 2:
                    code, reason = "TEACHER_UNAVAILABLE", "O professor está ocupado ou sem o descanso necessário nas faixas possíveis."
                elif resource_rejected and rejected["ROOM_BUSY"] >= resource_rejected / 2:
                    code, reason = "ROOM_UNAVAILABLE", "As salas compatíveis estão ocupadas nas faixas possíveis."
                issues.append(issue(code, reason, offering=offering,
                                    details={"duration_minutes": duration, "rejected": dict(rejected)}))
            blocks.append({"key": f"{offering.pk}:{index}", "offering": offering,
                           "duration": duration, "options": options})
            if len(compatible) == 1:
                room_id = compatible[0].pk
                sole_room_demand[room_id] += duration
                for option in options:
                    for value in range(option["start"], option["end"], 60):
                        sole_room_slots[room_id].add((option["weekday"], value))
        row["candidate_count"] = sum(len(block["options"]) for block in blocks if block["offering"].pk == offering.pk)
        row["compatible_rooms"] = len(compatible)
    for room_id, demand in sole_room_demand.items():
        capacity = len(sole_room_slots[room_id]) * 60
        if demand > capacity:
            room = next(item for item in context["rooms"] if item.pk == room_id)
            issues.append(issue("ROOM_TIME_SHORTAGE", f"A sala {room.name or room.code} precisa receber {demand // 60}h, mas só dispõe de {capacity // 60}h livres compatíveis.",
                                details={"room_id": room_id, "required_minutes": demand, "available_minutes": capacity}))
    summary = {"offerings": len(context["offerings"]),
               "required_minutes": sum(row["required_minutes"] for row in summaries),
               "preserved_minutes": sum(row["preserved_minutes"] for row in summaries),
               "pending_minutes": sum(row["pending_minutes"] for row in summaries),
               "blocks_to_place": len(blocks), "rooms": len(context["rooms"])}
    return context, blocks, {"ready": not any(item["severity"] == "BLOCKER" for item in issues),
                             "summary": summary, "offerings": summaries, "issues": issues}


def preflight(schedule, mode="FILL"):
    _, _, report = prepare(schedule, mode, flexible=True)
    return report


def _bad_teacher_intervals(context, choices):
    teachers = defaultdict(list)
    for fixed in context["fixed"]:
        teachers[fixed["teacher_id"]].append({"weekday": fixed["weekday"], "start": clock(fixed["start"]), "end": clock(fixed["end"])})
    for choice in choices:
        teachers[choice["teacher_id"]].append({"weekday": choice["weekday"], "start": clock(choice["start"]), "end": clock(choice["end"])})
    return {teacher_id: audit_intervals(items) for teacher_id, items in teachers.items() if items}


def _solve_once(context, blocks, *, time_limit, excluded=()):
    model = cp_model.CpModel()
    variables = []
    resource_intervals = defaultdict(list)
    teacher_options = defaultdict(list)
    for block_index, block in enumerate(blocks):
        row = []
        for option_index, option in enumerate(block["options"]):
            selected = model.NewBoolVar(f"b{block_index}_o{option_index}")
            interval = model.NewOptionalIntervalVar(option["start"], block["duration"], option["end"], selected,
                                                     f"i{block_index}_{option_index}")
            row.append(selected)
            resource_intervals[("group", option["group_id"], option["weekday"])].append(interval)
            resource_intervals[("room", option["room_id"], option["weekday"])].append(interval)
            resource_intervals[("teacher", option["teacher_id"], option["weekday"])].append(interval)
            teacher_options[option["teacher_id"]].append((selected, option))
        model.AddExactlyOne(row)
        variables.append(row)
    for intervals in resource_intervals.values():
        if len(intervals) > 1:
            model.AddNoOverlap(intervals)
    for entries in teacher_options.values():
        for index, (left_var, left) in enumerate(entries):
            for right_var, right in entries[index + 1:]:
                if rest_conflict(left, right):
                    model.AddBoolOr([left_var.Not(), right_var.Not()])
    for excluded_choices in excluded:
        model.AddBoolOr([variables[block][option].Not() for block, option in excluded_choices])
    model.Minimize(sum(variable * (option["room_penalty"] + option["preference_penalty"] + option["weekday"] * 12 + option["start"] // 60 + option["room_id"] % 5)
                       for block, row in zip(blocks, variables)
                       for variable, option in zip(row, block["options"])))
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = max(0.1, time_limit)
    solver.parameters.num_search_workers = 4
    solver.parameters.random_seed = 17
    status = solver.Solve(model)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return status, None, None
    indexes = [(block_index, next(index for index, variable in enumerate(row) if solver.Value(variable)))
               for block_index, row in enumerate(variables)]
    return status, indexes, int(solver.ObjectiveValue())


def solve(schedule, mode="FILL", *, time_limit=10, alternatives=2):
    started = monotonic()
    context, blocks, report = prepare(schedule, mode)
    if not report["ready"] and any(item["code"] in {"NO_BLOCK_CANDIDATE", "TEACHER_UNAVAILABLE", "ROOM_UNAVAILABLE"} for item in report["issues"]):
        context, blocks, report = prepare(schedule, mode, flexible=True)
    if not report["ready"]:
        return "INFEASIBLE", report, []
    if not blocks:
        report["issues"].append(issue("NOTHING_TO_GENERATE", "Não há horas presenciais pendentes para esta grade.", severity="INFO"))
        return "FEASIBLE", report, []
    excluded = []
    candidates = []
    state = "UNKNOWN"
    flexible_attempted = all(block["duration"] == 60 for block in blocks)
    while len(candidates) < alternatives and monotonic() - started < time_limit:
        remaining = time_limit - (monotonic() - started)
        status, selected, score = _solve_once(context, blocks, time_limit=remaining, excluded=excluded)
        if selected is None:
            if not candidates and status == cp_model.INFEASIBLE and not flexible_attempted:
                flexible_attempted = True
                context, blocks, flexible_report = prepare(schedule, mode, flexible=True)
                if flexible_report["ready"]:
                    report = flexible_report
                    excluded = []
                    continue
            state = "INFEASIBLE" if status == cp_model.INFEASIBLE and not candidates else "FEASIBLE" if candidates else "UNKNOWN"
            break
        choices = [blocks[block]["options"][option] for block, option in selected]
        audit = _bad_teacher_intervals(context, choices)
        bad = [(teacher_id, item) for teacher_id, items in audit.items() for item in items
               if item["code"] in {"INTRADAY_BREAK", "INTERDAY_REST", "TEACHER_OVERLAP"}]
        if bad:
            for teacher_id, item in bad:
                days = {item["weekday"], item.get("next_weekday", item["weekday"])}
                cut = [(block, option) for block, option in selected
                       if choices[block]["teacher_id"] == teacher_id and choices[block]["weekday"] in days]
                if cut:
                    excluded.append(cut)
            if not excluded:
                report["issues"].append(issue("EXISTING_TEACHER_CONFLICT", "Aulas fixas ou horários avulsos do professor já violam intervalos de descanso."))
                return "INFEASIBLE", report, []
            continue
        allocations = [{**choice, "start": clock(choice["start"]), "end": clock(choice["end"])} for choice in choices]
        candidates.append({"score": score, "allocations": allocations,
                           "metrics": {"blocks": len(allocations), "hours": sum(block["duration"] for block in blocks) // 60}})
        excluded.append(selected)
        state = "OPTIMAL" if status == cp_model.OPTIMAL and len(candidates) == 1 else "FEASIBLE"
    if not candidates and state == "INFEASIBLE":
        report["issues"].append(issue("COMBINED_CONSTRAINTS", "As restrições combinadas impedem alocar todas as aulas. Revise os gargalos por turma, professor e sala."))
    return state, report, candidates


def apply_candidate(candidate, revision, actor):
    """Recheck a suggestion and commit it atomically; raises ValueError on staleness."""
    with transaction.atomic():
        job = models.GenerationJob.objects.select_for_update().select_related("schedule").get(pk=candidate.job_id)
        schedule = models.Schedule.objects.select_for_update().get(pk=job.schedule_id)
        if schedule.revision != revision or job.base_revision != revision:
            raise ValueError("A grade mudou desde a geração. Gere uma nova proposta.")
        if job.status not in {models.GenerationJob.Status.FEASIBLE, models.GenerationJob.Status.OPTIMAL}:
            raise ValueError("Esta proposta não está pronta para aplicação.")
        if job.mode == "REARRANGE":
            removable = list(schedule.sessions.filter(is_locked=False).select_related("requirement"))
            requirement_ids = {item.requirement_id for item in removable if item.requirement.kind == "GRADE"}
            schedule.sessions.filter(pk__in=[item.pk for item in removable]).delete()
            for requirement in models.SessionRequirement.objects.filter(pk__in=requirement_ids):
                reconcile(requirement)
        for allocation in candidate.allocations:
            if not models.Room.objects.filter(pk=allocation["room_id"], is_active=True).exists():
                raise GridConflict([issue("ROOM_REMOVED", "Uma sala da proposta foi removida ou desativada. Gere novamente.")])
            session = save_cell(schedule, {"group_id": allocation["group_id"], "weekday": allocation["weekday"],
                                           "slot_id": allocation["slot_id"], "span": allocation["span"],
                                           "subject": allocation["subject"], "teacher": allocation["teacher"],
                                           "room": allocation["room_code"]})
            if (session.room_id != allocation["room_id"] or session.teacher_id != allocation["teacher_id"]
                    or session.requirement.offering_id != allocation["offering_id"]):
                raise GridConflict([issue("RESOURCE_CHANGED", "Os recursos da proposta mudaram. Gere novamente.")])
        conflicts = []
        for session in schedule.sessions.select_related("requirement__offering__group__course", "teacher", "room"):
            conflicts.extend(validate_session(session))
        for offering in models.SubjectOffering.objects.filter(group__course=schedule.course, group__term=schedule.term,
                                                               group__time_profile=schedule.time_profile, is_active=True).select_related("subject"):
            expected = (offering.subject.onsite_weekly_hours * 60
                        if offering.subject.onsite_weekly_hours is not None else offering.weekly_minutes)
            allocated = sum(minute(item.ends_at) - minute(item.starts_at)
                            for item in schedule.sessions.filter(requirement__offering=offering))
            if expected != allocated:
                conflicts.append(issue("OFFERING_HOURS", f"{offering}: carga presencial incompleta.", offering=offering))
        if conflicts:
            raise GridConflict(conflicts)
        schedule.revision = F("revision") + 1
        schedule.save(update_fields=["revision", "updated_at"])
        schedule.refresh_from_db(fields=["revision"])
        models.AuditEvent.objects.create(actor=actor, action="GENERATION_CANDIDATE_APPLIED",
                                         entity="Schedule", entity_id=str(schedule.pk),
                                         metadata={"job_id": job.pk, "candidate_id": candidate.pk,
                                                   "blocks": len(candidate.allocations)})
        return schedule.revision
