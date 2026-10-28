"""Independent validation of weekly draft allocations.

Intervals are half-open: [start, end). No fixed shift or class duration is assumed.
"""
from .models import ScheduledSession, Scope, TeacherAvailability, TeacherEvent, TimeBlock, TimeWindow
from .workload import audit_intervals


def minutes(value):
    return value.hour * 60 + value.minute


def overlaps(a_start, a_end, b_start, b_end):
    return a_start < b_end and b_start < a_end


def availability_issue(teacher_id, term_id, weekday, start, end, rules=None):
    """An empty set of AVAILABLE rules means unrestricted teaching hours."""
    if rules is None:
        rules = TeacherAvailability.objects.filter(teacher_id=teacher_id, term_id=term_id, is_active=True)
    rules = list(rules)
    start = start if isinstance(start, int) else minutes(start)
    end = end if isinstance(end, int) else minutes(end)
    daily = [rule for rule in rules if rule.weekday == weekday]
    if any(rule.kind == TeacherAvailability.Kind.UNAVAILABLE and
           overlaps(start, end, minutes(rule.starts_at), minutes(rule.ends_at)) for rule in daily):
        return {"code": "TEACHER_UNAVAILABLE", "message": "O professor está indisponível neste horário."}
    if any(rule.kind == TeacherAvailability.Kind.AVAILABLE for rule in rules) and not any(
        rule.kind == TeacherAvailability.Kind.AVAILABLE and
        minutes(rule.starts_at) <= start and end <= minutes(rule.ends_at) for rule in daily
    ):
        return {"code": "OUTSIDE_TEACHER_AVAILABILITY", "message": "A aula está fora dos horários permitidos para o professor neste período letivo."}
    return None


def preferred_minutes(weekday, start, end, rules):
    spans = sorted((max(start, minutes(rule.starts_at)), min(end, minutes(rule.ends_at)))
                   for rule in rules if rule.weekday == weekday and rule.kind == TeacherAvailability.Kind.PREFERRED
                   and overlaps(start, end, minutes(rule.starts_at), minutes(rule.ends_at)))
    merged = []
    for left, right in spans:
        if merged and left <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], right))
        else:
            merged.append((left, right))
    return sum(right - left for left, right in merged)


def intraday_break_issue(term_id, teacher_id, weekday, start, end, *, session_id=None, event_id=None):
    intervals = [{"weekday": weekday, "start": start, "end": end}]
    sessions = ScheduledSession.objects.filter(schedule__term_id=term_id, teacher_id=teacher_id, weekday=weekday).exclude(pk=session_id)
    events = TeacherEvent.objects.filter(term_id=term_id, teacher_id=teacher_id, weekday=weekday, is_active=True).exclude(pk=event_id)
    intervals.extend({"weekday": weekday, "start": item.starts_at, "end": item.ends_at} for item in sessions)
    intervals.extend({"weekday": weekday, "start": item.starts_at, "end": item.ends_at} for item in events)
    return next((issue for issue in audit_intervals(intervals) if issue["code"] == "INTRADAY_BREAK"), None)


def matching_scopes(session):
    offering = session.requirement.offering
    return {
        (Scope.INSTITUTION, None),
        (Scope.COURSE, offering.group.course_id),
        (Scope.GROUP, offering.group_id),
        (Scope.TEACHER, session.teacher_id),
        (Scope.ROOM, session.room_id),
        (Scope.OFFERING, offering.id),
    }


def validate_session(session, other_sessions=None):
    offering = session.requirement.offering
    group = offering.group
    institution_id = group.course.institution_id
    term_id = group.term_id
    start, end = minutes(session.starts_at), minutes(session.ends_at)
    conflicts = []

    def add(code, message, resource_type=None, resource_id=None, conflicting_session_id=None):
        conflicts.append({
            "code": code, "severity": "HARD", "message": message,
            "resource_type": resource_type, "resource_id": resource_id,
            "interval": {"day": session.weekday, "start": session.starts_at.strftime("%H:%M"), "end": session.ends_at.strftime("%H:%M")},
            "conflicting_session_id": conflicting_session_id,
        })

    if end <= start or end - start != session.requirement.duration_minutes:
        add("INVALID_DURATION", "A duração não corresponde ao encontro requerido.")
    if session.occurrence > session.requirement.weekly_count:
        add("INVALID_OCCURRENCE", "A ocorrência excede a quantidade semanal requerida.")
    if session.schedule.course_id != group.course_id or session.schedule.term_id != term_id:
        add("SCHEDULE_MISMATCH", "A oferta não pertence ao curso e período da grade.")
    if session.schedule.time_profile_id != group.time_profile_id:
        add("PROFILE_MISMATCH", "A turma pertence a outro turno da grade.")
    if session.teacher.institution_id != institution_id or session.room.institution_id != institution_id:
        add("INSTITUTION_MISMATCH", "Professor ou sala pertence a outra instituição.")
    if not session.teacher.is_active or not session.room.is_active or not offering.is_active:
        add("INACTIVE_RESOURCE", "A oferta, o professor ou a sala está inativo.")
    if not offering.eligible_teachers.filter(pk=session.teacher_id).exists():
        add("TEACHER_NOT_ELIGIBLE", "O professor não está habilitado para esta oferta.", "teacher", session.teacher_id)
    availability = availability_issue(session.teacher_id, term_id, session.weekday, start, end)
    if availability:
        add(availability["code"], availability["message"], "teacher", session.teacher_id)
    required = set(offering.required_features.values_list("id", flat=True)) | set(offering.subject.required_features.values_list("id", flat=True))
    available = set(session.room.features.values_list("id", flat=True))
    if not required.issubset(available):
        add("ROOM_FEATURES", "A sala não possui todos os recursos exigidos.", "room", session.room_id)
    if session.room.room_type != offering.subject.required_room_type:
        add("ROOM_TYPE_MISMATCH", f"Esta disciplina exige {offering.subject.get_required_room_type_display()}; a sala selecionada é {session.room.get_room_type_display()}.", "room", session.room_id)

    scopes = matching_scopes(session)
    windows = [w for w in TimeWindow.objects.filter(institution_id=institution_id, weekday=session.weekday, is_active=True).select_related("profile") if (w.scope, w.scope_id) in scopes and (not w.profile_id or (w.profile_id == session.schedule.time_profile_id and w.profile.is_active))]
    profiled_scopes = {window.scope for window in windows if window.profile_id}
    windows = [window for window in windows if window.profile_id or window.scope not in profiled_scopes]
    if not windows:
        add("OUTSIDE_WINDOW", "Não há janela de horário ativa para esta aula. Configure os perfis em Regras de horário.")
    else:
        scope_names = {Scope.INSTITUTION: "da instituição", Scope.COURSE: "do curso", Scope.GROUP: "da turma", Scope.TEACHER: "do professor", Scope.ROOM: "da sala", Scope.OFFERING: "da oferta"}
        day_names = ["", "segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"]
        for scope in {window.scope for window in windows}:
            scoped = [window for window in windows if window.scope == scope]
            if any(minutes(window.starts_at) <= start and end <= minutes(window.ends_at) for window in scoped):
                continue
            expected = ", ".join(f"{window.profile.name if window.profile_id else 'sem perfil'} {window.starts_at.strftime('%H:%M')}–{window.ends_at.strftime('%H:%M')}" for window in scoped)
            add("OUTSIDE_WINDOW", f"A aula {session.starts_at.strftime('%H:%M')}–{session.ends_at.strftime('%H:%M')} não cabe na janela {scope_names[scope]} na {day_names[session.weekday]}: {expected}. Ajuste o perfil em Regras de horário ou escolha outra faixa.")
    for block in TimeBlock.objects.filter(institution_id=institution_id, weekday=session.weekday, is_active=True):
        if (block.scope, block.scope_id) in scopes and overlaps(start, end, minutes(block.starts_at), minutes(block.ends_at)):
            add("TIME_BLOCK", f"O encontro cruza um bloqueio: {block.reason}.")

    if other_sessions is None:
        other_sessions = ScheduledSession.objects.filter(schedule__term_id=term_id, weekday=session.weekday).exclude(pk=session.pk).select_related("requirement__offering__group")
    for other in other_sessions:
        if not overlaps(start, end, minutes(other.starts_at), minutes(other.ends_at)):
            continue
        if other.teacher_id == session.teacher_id:
            add("TEACHER_OVERLAP", "O professor já possui aula neste intervalo.", "teacher", session.teacher_id, other.pk)
        if other.room_id == session.room_id:
            add("ROOM_OVERLAP", "A sala já está ocupada neste intervalo.", "room", session.room_id, other.pk)
        if other.requirement.offering.group_id == group.id:
            add("GROUP_OVERLAP", "A turma já possui aula neste intervalo.", "group", group.id, other.pk)
    for event in TeacherEvent.objects.filter(term_id=term_id, teacher_id=session.teacher_id, weekday=session.weekday, is_active=True):
        if overlaps(start, end, minutes(event.starts_at), minutes(event.ends_at)):
            add("TEACHER_EVENT_OVERLAP", f"O professor possui {event.title} neste intervalo.", "teacher", session.teacher_id)
    # Mínimo de 11 horas entre dias consecutivos, inclusive domingo → segunda.
    previous_day = (session.weekday - 2) % 7 + 1
    next_day = session.weekday % 7 + 1
    for other in ScheduledSession.objects.filter(
        schedule__term_id=term_id, teacher_id=session.teacher_id, weekday__in=[previous_day, next_day]
    ).exclude(pk=session.pk):
        if other.weekday == previous_day:
            gap = 24 * 60 + start - minutes(other.ends_at)
        else:
            gap = 24 * 60 + minutes(other.starts_at) - end
        if gap < 11 * 60:
            add("TEACHER_MIN_REST", "O professor precisa de pelo menos 11 horas entre aulas de dias consecutivos.", "teacher", session.teacher_id, other.pk)
    for event in TeacherEvent.objects.filter(term_id=term_id, teacher_id=session.teacher_id, weekday__in=[previous_day, next_day], is_active=True):
        gap = (24 * 60 + start - minutes(event.ends_at)) if event.weekday == previous_day else (24 * 60 + minutes(event.starts_at) - end)
        if gap < 11 * 60:
            add("TEACHER_MIN_REST", f"O professor precisa de 11 horas de descanso entre esta aula e {event.title}.", "teacher", session.teacher_id)
    intraday = intraday_break_issue(term_id, session.teacher_id, session.weekday, session.starts_at, session.ends_at, session_id=session.pk)
    if intraday:
        add("INTRADAY_BREAK", intraday["message"], "teacher", session.teacher_id)
    if session.teacher.max_weekly_minutes is not None:
        weekly = end - start
        for other in ScheduledSession.objects.filter(schedule__term_id=term_id, teacher_id=session.teacher_id).exclude(pk=session.pk):
            weekly += minutes(other.ends_at) - minutes(other.starts_at)
        if weekly > session.teacher.max_weekly_minutes:
            add("TEACHER_WEEKLY_LIMIT", "A carga semanal máxima do professor foi excedida.", "teacher", session.teacher_id)
    return conflicts


def validate_teacher_event(event):
    """Teacher-only commitments cannot overlap classes or each other in the term."""
    if not event.is_active:
        return []
    start, end = minutes(event.starts_at), minutes(event.ends_at)
    previous_day = (event.weekday - 2) % 7 + 1
    next_day = event.weekday % 7 + 1
    conflicts = []

    def add(code, message):
        conflicts.append({"code": code, "severity": "HARD", "message": message})

    sessions = ScheduledSession.objects.filter(schedule__term_id=event.term_id, teacher_id=event.teacher_id)
    for session in sessions.filter(weekday=event.weekday):
        if overlaps(start, end, minutes(session.starts_at), minutes(session.ends_at)):
            add("TEACHER_OVERLAP", "O professor já possui aula neste intervalo.")
    for session in sessions.filter(weekday__in=[previous_day, next_day]):
        gap = (24 * 60 + start - minutes(session.ends_at)) if session.weekday == previous_day else (24 * 60 + minutes(session.starts_at) - end)
        if gap < 11 * 60:
            add("TEACHER_MIN_REST", "O professor precisa de 11 horas de descanso entre este horário e uma aula.")
    events = TeacherEvent.objects.filter(term_id=event.term_id, teacher_id=event.teacher_id, is_active=True).exclude(pk=event.pk)
    for other in events.filter(weekday=event.weekday):
        if overlaps(start, end, minutes(other.starts_at), minutes(other.ends_at)):
            add("TEACHER_EVENT_OVERLAP", f"O professor já possui {other.title} neste intervalo.")
    for other in events.filter(weekday__in=[previous_day, next_day]):
        gap = (24 * 60 + start - minutes(other.ends_at)) if other.weekday == previous_day else (24 * 60 + minutes(other.starts_at) - end)
        if gap < 11 * 60:
            add("TEACHER_MIN_REST", f"O professor precisa de 11 horas de descanso entre este horário e {other.title}.")
    intraday = intraday_break_issue(event.term_id, event.teacher_id, event.weekday, event.starts_at, event.ends_at, event_id=event.pk)
    if intraday:
        add("INTRADAY_BREAK", intraday["message"])
    return conflicts


def candidate_starts(window, duration_minutes, granularity_minutes, blocks=()):
    """Return unique minute offsets; a candidate must fit entirely in a window."""
    if duration_minutes <= 0 or granularity_minutes <= 0:
        raise ValueError("Duração e granularidade devem ser positivas.")
    start, end = minutes(window.starts_at), minutes(window.ends_at)
    first = ((start + granularity_minutes - 1) // granularity_minutes) * granularity_minutes
    return [minute for minute in range(first, end - duration_minutes + 1, granularity_minutes)
            if not any(overlaps(minute, minute + duration_minutes, minutes(b.starts_at), minutes(b.ends_at)) for b in blocks)]

