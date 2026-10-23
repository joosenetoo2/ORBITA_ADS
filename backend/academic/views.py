from datetime import date

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import F
from django.shortcuts import get_object_or_404
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import MethodNotAllowed, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from . import models, serializers
from .permissions import AcademicPermission
from .scheduling import candidate_starts, validate_session
from .quick_grid import GridConflict, delete_cell, make_code, parse_time, save_cell
from .catalog_flow import offer_subject


class AcademicViewSet(viewsets.ModelViewSet):
    permission_classes = [AcademicPermission]
    http_method_names = ["get", "post", "patch", "head", "options"]


def viewset_for(model, serializer, *, admin_only=False):
    return type(f"{model.__name__}ViewSet", (AcademicViewSet,), {
        "queryset": model.objects.all().order_by("pk"),
        "serializer_class": serializer,
        "admin_only": admin_only,
    })


class InstitutionViewSet(AcademicViewSet):
    queryset = models.Institution.objects.all().order_by("pk")
    serializer_class = serializers.InstitutionSerializer
    admin_only = True

    def perform_create(self, serializer):
        if models.Institution.objects.exists():
            raise ValidationError({"code": "SINGLE_INSTITUTION", "message": "O MVP permite uma instituição."})
        serializer.save()


AcademicTermViewSet = viewset_for(models.AcademicTerm, serializers.AcademicTermSerializer)
CourseViewSet = viewset_for(models.Course, serializers.CourseSerializer)
class SubjectViewSet(AcademicViewSet):
    queryset = models.Subject.objects.all().order_by("pk")
    serializer_class = serializers.SubjectSerializer

    @action(detail=True, methods=["post"])
    def offer(self, request, pk=None):
        subject = self.get_object()
        group = get_object_or_404(models.ClassGroup, pk=request.data.get("group_id"))
        teacher = get_object_or_404(models.Teacher, pk=request.data.get("teacher_id"))
        with transaction.atomic():
            offering, created = offer_subject(subject, group, teacher, request.data.get("block_hours", 2))
            models.AuditEvent.objects.create(actor=request.user, action="SUBJECT_OFFERED", entity="SubjectOffering", entity_id=str(offering.pk), metadata={"subject_id": subject.pk, "group_id": group.pk, "teacher_id": teacher.pk, "created": created})
        return Response({"id": offering.pk, "created": created, "weekly_hours": offering.weekly_minutes // 60}, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)
CurriculumViewSet = viewset_for(models.Curriculum, serializers.CurriculumSerializer)
CurriculumPeriodViewSet = viewset_for(models.CurriculumPeriod, serializers.CurriculumPeriodSerializer)
TeacherViewSet = viewset_for(models.Teacher, serializers.TeacherSerializer)
RoomFeatureViewSet = viewset_for(models.RoomFeature, serializers.RoomFeatureSerializer)
RoomViewSet = viewset_for(models.Room, serializers.RoomSerializer)
ClassGroupViewSet = viewset_for(models.ClassGroup, serializers.ClassGroupSerializer)
SubjectOfferingViewSet = viewset_for(models.SubjectOffering, serializers.SubjectOfferingSerializer)
SessionRequirementViewSet = viewset_for(models.SessionRequirement, serializers.SessionRequirementSerializer)


class BatchImportView(APIView):
    permission_classes = [AcademicPermission]

    @staticmethod
    def _integer(value, label, *, minimum=0, maximum=None):
        try:
            result = int(value)
        except (TypeError, ValueError):
            raise ValidationError({label: "Informe um número inteiro."})
        if result < minimum or (maximum is not None and result > maximum):
            raise ValidationError({label: f"Use um valor entre {minimum} e {maximum if maximum is not None else 'o máximo permitido'}."})
        return result

    def post(self, request):
        resource = request.data.get("resource")
        rows = request.data.get("rows")
        if resource not in {"subjects", "teachers", "rooms", "class-groups", "courses", "offerings"}:
            raise ValidationError({"resource": "Escolha cursos, disciplinas, professores, salas, turmas ou ofertas."})
        if not isinstance(rows, list) or not rows or len(rows) > 500:
            raise ValidationError({"rows": "Envie de 1 a 500 linhas."})
        institution = models.Institution.objects.first()
        if institution is None:
            raise ValidationError({"institution": "Cadastre a instituição antes de importar."})
        group_course = group_term = None
        if resource == "class-groups":
            group_course = get_object_or_404(models.Course, pk=request.data.get("course_id"), institution=institution)
            group_term = get_object_or_404(models.AcademicTerm, pk=request.data.get("term_id"), institution=institution)
        created = skipped = updated = 0
        with transaction.atomic():
            for index, row in enumerate(rows, 1):
                if not isinstance(row, dict):
                    raise ValidationError({"row": index, "message": "Linha inválida."})
                try:
                    code = str(row.get("code", "")).strip()
                    name = str(row.get("name", "")).strip()
                    if resource in {"subjects", "teachers", "rooms", "class-groups", "courses"}:
                        if not name and resource != "class-groups":
                            raise ValidationError({"name": "Informe o nome."})
                        if not code:
                            code = make_code({"subjects": models.Subject, "teachers": models.Teacher, "rooms": models.Room, "courses": models.Course}.get(resource), institution, name) if resource != "class-groups" else name
                        if not code:
                            raise ValidationError({"code": "Informe o código da turma."})
                    if resource == "courses":
                        if models.Course.objects.filter(institution=institution, code__iexact=code).exists():
                            skipped += 1; continue
                        obj = models.Course(institution=institution, code=code, name=name, modality=str(row.get("modality", "")).strip())
                    elif resource == "subjects":
                        if models.Subject.objects.filter(institution=institution, code__iexact=code).exists():
                            skipped += 1; continue
                        credits = self._integer(row.get("credits"), "credits", minimum=1, maximum=40)
                        onsite = self._integer(row.get("onsite_weekly_hours"), "onsite_weekly_hours", maximum=credits)
                        ead = self._integer(row.get("ead_percentage", 0) or 0, "ead_percentage", maximum=100)
                        obj = models.Subject(institution=institution, code=code, name=name, credits=credits,
                                             onsite_weekly_hours=onsite, ead_percentage=ead,
                                             total_workload=credits * 20, workload_unit=models.Subject.Unit.CLASS_HOUR)
                    elif resource == "teachers":
                        if models.Teacher.objects.filter(institution=institution, code__iexact=code).exists():
                            skipped += 1; continue
                        obj = models.Teacher(institution=institution, code=code, name=name)
                    elif resource == "rooms":
                        if models.Room.objects.filter(institution=institution, code__iexact=code).exists():
                            skipped += 1; continue
                        capacity = row.get("capacity")
                        obj = models.Room(institution=institution, code=code, name=name,
                                          capacity=self._integer(capacity, "capacity") if capacity not in (None, "") else None)
                    elif resource == "class-groups":
                        if models.ClassGroup.objects.filter(term=group_term, code__iexact=code).exists():
                            skipped += 1; continue
                        obj = models.ClassGroup(course=group_course, term=group_term, code=code, name=name or code)
                    else:
                        group = get_object_or_404(models.ClassGroup, term__institution=institution, code__iexact=str(row.get("group_code", "")).strip())
                        subject = get_object_or_404(models.Subject, institution=institution, code__iexact=str(row.get("subject_code", "")).strip())
                        teacher = get_object_or_404(models.Teacher, institution=institution, code__iexact=str(row.get("teacher_code", "")).strip())
                        _, was_created = offer_subject(subject, group, teacher, row.get("block_hours", 2))
                        if was_created: created += 1
                        else: updated += 1
                        continue
                    obj.full_clean()
                    obj.save()
                    created += 1
                except (ValidationError, DjangoValidationError) as error:
                    detail = error.detail if isinstance(error, ValidationError) else error.message_dict
                    raise ValidationError({"row": index, "errors": detail})
            models.AuditEvent.objects.create(actor=request.user, action="BATCH_IMPORTED", entity=resource, entity_id="batch", metadata={"created": created, "skipped": skipped, "updated": updated})
        return Response({"created": created, "skipped": skipped, "updated": updated})


class SafeTimeConfigurationMixin:
    """Reject configuration changes that would newly invalidate existing sessions."""

    def create(self, request, *args, **kwargs):
        return self._change(request)

    def partial_update(self, request, *args, **kwargs):
        return self._change(request, instance=self.get_object())

    def _change(self, request, instance=None):
        serializer = self.get_serializer(instance, data=request.data, partial=instance is not None)
        serializer.is_valid(raise_exception=True)
        institution = serializer.validated_data.get("institution") or (instance.institution if instance else None)
        if institution is None:
            raise ValidationError({"institution": "Instituição obrigatória."})
        with transaction.atomic():
            sessions = list(models.ScheduledSession.objects.filter(schedule__course__institution=institution).select_related(
                "schedule", "requirement__offering__group__course", "requirement__offering__subject", "teacher", "room"
            ))
            before = {item.pk: {conflict["code"] for conflict in validate_session(item)} & {"OUTSIDE_WINDOW", "TIME_BLOCK"} for item in sessions}
            saved = serializer.save()
            affected = [item.pk for item in sessions if ({conflict["code"] for conflict in validate_session(item)} & {"OUTSIDE_WINDOW", "TIME_BLOCK"}) - before[item.pk]]
            if affected:
                transaction.set_rollback(True)
                return Response({"code": "CONFIGURATION_AFFECTS_SESSIONS", "message": "A alteração invalidaria alocações existentes.", "affected_session_ids": affected}, status=status.HTTP_409_CONFLICT)
            models.AuditEvent.objects.create(actor=request.user, action="TIME_CONFIGURATION_CREATED" if instance is None else "TIME_CONFIGURATION_UPDATED", entity=type(saved).__name__, entity_id=str(saved.pk), metadata={"values": serializer.data})
            return Response(serializer.data, status=status.HTTP_201_CREATED if instance is None else status.HTTP_200_OK)


class TimeProfileViewSet(SafeTimeConfigurationMixin, AcademicViewSet):
    queryset = models.TimeProfile.objects.all().order_by("display_order", "pk")
    serializer_class = serializers.TimeProfileSerializer
    admin_only = True


class TimeWindowViewSet(SafeTimeConfigurationMixin, AcademicViewSet):
    queryset = models.TimeWindow.objects.all().order_by("weekday", "starts_at")
    serializer_class = serializers.TimeWindowSerializer
    admin_only = True

    @action(detail=True, methods=["get"], url_path="candidate-starts")
    def candidate_starts(self, request, pk=None):
        window = self.get_object()
        try:
            duration = int(request.query_params["duration_minutes"])
        except (KeyError, ValueError):
            raise ValidationError({"duration_minutes": "Informe uma duração inteira em minutos."})
        blocks = models.TimeBlock.objects.filter(institution=window.institution, weekday=window.weekday, is_active=True)
        applicable = [block for block in blocks if (block.scope == window.scope and block.scope_id == window.scope_id) or block.scope == models.Scope.INSTITUTION]
        starts = candidate_starts(window, duration, window.institution.slot_granularity_minutes, applicable)
        return Response({"duration_minutes": duration, "granularity_minutes": window.institution.slot_granularity_minutes, "starts": [f"{minute // 60:02d}:{minute % 60:02d}" for minute in starts]})


class TimeBlockViewSet(SafeTimeConfigurationMixin, AcademicViewSet):
    queryset = models.TimeBlock.objects.all().order_by("weekday", "starts_at")
    serializer_class = serializers.TimeBlockSerializer
    admin_only = True


class ScheduleViewSet(AcademicViewSet):
    queryset = models.Schedule.objects.select_related("course", "term").all().order_by("pk")
    serializer_class = serializers.ScheduleSerializer
    http_method_names = ["get", "post", "delete", "head", "options"]

    def destroy(self, request, *args, **kwargs):
        raise MethodNotAllowed("DELETE")

    @staticmethod
    def _configure_slots(schedule, slot_values, weekdays):
        if not isinstance(slot_values, list) or not slot_values or len(slot_values) > 30:
            raise ValidationError({"slots": "Informe de 1 a 30 faixas de horário."})
        try:
            weekdays = [int(value) for value in weekdays]
        except (TypeError, ValueError):
            raise ValidationError({"weekdays": "Informe os dias da semana."})
        if not weekdays or any(day not in range(1, 8) for day in weekdays):
            raise ValidationError({"weekdays": "Selecione ao menos um dia válido."})
        slots = []
        for index, value in enumerate(slot_values):
            try:
                start, end = parse_time(value["start"]), parse_time(value["end"])
            except (KeyError, TypeError):
                raise ValidationError({"slots": "Cada faixa precisa de início e fim."})
            if start >= end or (slots and start < slots[-1][1]):
                raise ValidationError({"slots": "As faixas devem estar em ordem e sem sobreposição."})
            slots.append((start, end, index))
        existing = list(schedule.slots.all())
        for start, end, _ in slots:
            if any(start < item.ends_at and item.starts_at < end and (start, end) != (item.starts_at, item.ends_at) for item in existing):
                raise ValidationError({"slots": "Uma faixa nova cruza um horário já configurado."})
        for start, end, index in slots:
            models.ScheduleSlot.objects.get_or_create(schedule=schedule, starts_at=start, ends_at=end, defaults={"display_order": index})
        # Row order follows clock time, including rows added to an older schedule.
        for index, slot in enumerate(schedule.slots.order_by("starts_at", "ends_at")):
            if slot.display_order != index:
                slot.display_order = index
                slot.save(update_fields=["display_order"])
        runs = []
        for start, end, _ in slots:
            if runs and runs[-1][1] == start:
                runs[-1] = (runs[-1][0], end)
            else:
                runs.append((start, end))
        for day in set(weekdays):
            for start, end in runs:
                models.TimeWindow.objects.get_or_create(
                    institution=schedule.course.institution, scope=models.Scope.COURSE, scope_id=schedule.course_id,
                    weekday=day, starts_at=start, ends_at=end,
                )

    @action(detail=True, methods=["post"], url_path="configure-grid")
    def configure_grid(self, request, pk=None):
        with transaction.atomic():
            schedule = models.Schedule.objects.select_for_update().get(pk=self.get_object().pk)
            self._check_revision(request, schedule)
            self._configure_slots(schedule, request.data.get("slots"), request.data.get("weekdays"))
            schedule.revision = F("revision") + 1
            schedule.save(update_fields=["revision", "updated_at"])
            schedule.refresh_from_db(fields=["revision"])
            models.AuditEvent.objects.create(actor=request.user, action="GRID_SLOTS_CONFIGURED", entity="Schedule", entity_id=str(schedule.pk), metadata={"slots": request.data.get("slots"), "weekdays": request.data.get("weekdays")})
            return Response({"revision": schedule.revision, "slot_count": schedule.slots.count()})

    @action(detail=False, methods=["post"], url_path="quick-setup")
    def quick_setup(self, request):
        data = request.data
        required = ["institution", "course_code", "course_name", "term", "starts_on", "ends_on"]
        if any(not str(data.get(key, "")).strip() for key in required):
            raise ValidationError({"setup": "Informe instituição, curso, período e datas."})
        try:
            starts_on, ends_on = date.fromisoformat(data["starts_on"]), date.fromisoformat(data["ends_on"])
            groups = [str(value).strip() for value in data["groups"]]
            slot_values = data["slots"]
            weekdays = [int(value) for value in data.get("weekdays", [1, 2, 3, 4, 5])]
        except (KeyError, TypeError, ValueError):
            raise ValidationError({"setup": "Confira as datas, turmas, faixas e dias."})
        if starts_on > ends_on or not groups or not slot_values or not weekdays or any(day not in range(1, 8) for day in weekdays):
            raise ValidationError({"setup": "Informe datas válidas e ao menos uma turma, faixa e dia."})
        if len(groups) != len(set(groups)) or any(not value or len(value) > 50 for value in groups):
            raise ValidationError({"groups": "As turmas devem ter nomes únicos com até 50 caracteres."})
        with transaction.atomic():
            institution = models.Institution.objects.first()
            if institution is None:
                institution = models.Institution.objects.create(name=data["institution"].strip())
            elif institution.name.casefold() != data["institution"].strip().casefold():
                raise ValidationError({"institution": "Já existe outra instituição configurada."})
            course, _ = models.Course.objects.get_or_create(institution=institution, code=data["course_code"].strip(), defaults={"name": data["course_name"].strip()})
            term, created = models.AcademicTerm.objects.get_or_create(institution=institution, name=data["term"].strip(), defaults={"starts_on": starts_on, "ends_on": ends_on})
            if not created and (term.starts_on != starts_on or term.ends_on != ends_on):
                raise ValidationError({"term": "O período existente possui outras datas."})
            schedule, _ = models.Schedule.objects.get_or_create(course=course, term=term)
            for code in groups:
                previous = models.ClassGroup.objects.filter(term=term, code=code).first()
                if previous and previous.course_id != course.pk:
                    raise ValidationError({"groups": f"A turma {code} pertence a outro curso."})
                models.ClassGroup.objects.get_or_create(course=course, term=term, code=code)
            self._configure_slots(schedule, slot_values, weekdays)
            models.AuditEvent.objects.create(actor=request.user, action="GRID_QUICK_SETUP", entity="Schedule", entity_id=str(schedule.pk), metadata={"groups": groups})
            return Response({"id": schedule.pk}, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"])
    def grid(self, request, pk=None):
        schedule = self.get_object()
        groups = models.ClassGroup.objects.filter(course=schedule.course, term=schedule.term, is_active=True).order_by("code")
        sessions = schedule.sessions.select_related("requirement__offering__subject", "requirement__offering__group", "teacher", "room").order_by("weekday", "starts_at")
        return Response({
            "id": schedule.pk, "revision": schedule.revision, "course": schedule.course.name, "term": schedule.term.name,
            "institution": schedule.course.institution.name,
            "weekdays": list(models.TimeWindow.objects.filter(institution=schedule.course.institution, scope=models.Scope.COURSE, scope_id=schedule.course_id, is_active=True).values_list("weekday", flat=True).distinct().order_by("weekday")),
            "groups": [{"id": group.pk, "code": group.code} for group in groups],
            "slots": [{"id": slot.pk, "start": slot.starts_at.strftime("%H:%M"), "end": slot.ends_at.strftime("%H:%M")} for slot in schedule.slots.all()],
            "sessions": [{"id": item.pk, "group_id": item.requirement.offering.group_id, "weekday": item.weekday,
                          "start": item.starts_at.strftime("%H:%M"), "end": item.ends_at.strftime("%H:%M"),
                          "subject": item.requirement.offering.subject.name, "teacher": item.teacher.name, "room": item.room.code,
                          "is_locked": item.is_locked}
                         for item in sessions],
        })

    @action(detail=True, methods=["post", "delete"], url_path="quick-cells")
    def quick_cells(self, request, pk=None):
        with transaction.atomic():
            schedule = models.Schedule.objects.select_for_update().get(pk=self.get_object().pk)
            self._check_revision(request, schedule)
            try:
                if request.method == "DELETE":
                    delete_cell(schedule, request.data.get("session_id"), unlock=bool(request.data.get("unlock")))
                    count = 1
                else:
                    entries = request.data.get("cells")
                    if entries is None:
                        entries = [request.data]
                    if not isinstance(entries, list) or not entries or len(entries) > 200:
                        raise ValidationError({"cells": "Envie de 1 a 200 células."})
                    for index, entry in enumerate(entries):
                        try:
                            save_cell(schedule, entry)
                        except GridConflict as conflict:
                            conflict.index = index
                            raise
                    count = len(entries)
            except GridConflict as conflict:
                transaction.set_rollback(True)
                return Response({"code": "GRID_CONFLICT", "cell_index": conflict.index, "conflicts": conflict.conflicts}, status=status.HTTP_409_CONFLICT)
            schedule.revision = F("revision") + 1
            schedule.save(update_fields=["revision", "updated_at"])
            schedule.refresh_from_db(fields=["revision"])
            models.AuditEvent.objects.create(actor=request.user, action="GRID_CELLS_CHANGED", entity="Schedule", entity_id=str(schedule.pk), metadata={"count": count, "method": request.method})
            return Response({"count": count, "revision": schedule.revision})

    @action(detail=True, methods=["get", "post"], url_path="sessions")
    def sessions(self, request, pk=None):
        schedule = self.get_object()
        if request.method == "GET":
            sessions = schedule.sessions.select_related("requirement__offering__subject", "teacher", "room").order_by("weekday", "starts_at")
            return Response(serializers.ScheduledSessionSerializer(sessions, many=True).data)
        with transaction.atomic():
            schedule = models.Schedule.objects.select_for_update().get(pk=schedule.pk)
            self._check_revision(request, schedule)
            serializer = serializers.ScheduledSessionSerializer(data={**request.data, "schedule": schedule.pk})
            serializer.is_valid(raise_exception=True)
            session = serializer.save()
            conflicts = validate_session(session)
            if conflicts:
                transaction.set_rollback(True)
                return Response({"valid": False, "conflicts": conflicts}, status=status.HTTP_409_CONFLICT)
            models.AuditEvent.objects.create(actor=request.user, action="SESSION_CREATED", entity="ScheduledSession", entity_id=str(session.pk), metadata={"after": serializer.data})
            schedule.revision = F("revision") + 1
            schedule.save(update_fields=["revision", "updated_at"])
            schedule.refresh_from_db(fields=["revision"])
            return Response({"session": serializer.data, "revision": schedule.revision}, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="sessions/preview")
    def preview_session(self, request, pk=None):
        schedule = self.get_object()
        self._check_revision(request, schedule)
        session_id = request.data.get("session_id")
        existing = get_object_or_404(models.ScheduledSession, pk=session_id, schedule=schedule) if session_id else None
        data = {key: value for key, value in request.data.items() if key != "session_id"}
        if existing is None:
            data["schedule"] = schedule.pk
        serializer = serializers.ScheduledSessionSerializer(existing, data=data, partial=existing is not None)
        serializer.is_valid(raise_exception=True)
        if existing is None:
            session = models.ScheduledSession(**serializer.validated_data)
        else:
            session = serializer.instance
        conflicts = validate_session(session)
        return Response({"valid": not conflicts, "conflicts": conflicts, "revision": schedule.revision})

    @action(detail=True, methods=["post"])
    def validate(self, request, pk=None):
        schedule = self.get_object()
        conflicts = []
        for session in schedule.sessions.select_related("requirement__offering__group__course", "requirement__offering__subject", "teacher", "room"):
            conflicts.extend(validate_session(session))
        for requirement in models.SessionRequirement.objects.filter(offering__group__course=schedule.course, offering__group__term=schedule.term, offering__is_active=True):
            count = schedule.sessions.filter(requirement=requirement).count()
            if count != requirement.weekly_count:
                conflicts.append({"code": "MISSING_SESSIONS", "severity": "HARD", "message": f"A oferta {requirement.offering} requer {requirement.weekly_count} encontro(s); há {count}.", "requirement_id": requirement.pk})
        for offering in models.SubjectOffering.objects.filter(group__course=schedule.course, group__term=schedule.term, is_active=True):
            total = sum(item.duration_minutes * item.weekly_count for item in offering.requirements.all())
            if total != offering.weekly_minutes:
                conflicts.append({"code": "WORKLOAD_MISMATCH", "severity": "HARD", "message": f"A oferta {offering} prevê {offering.weekly_minutes} minutos, mas seus encontros somam {total}.", "offering_id": offering.pk})
        return Response({"valid": not conflicts, "conflicts": conflicts})

    @action(detail=True, methods=["get"])
    def versions(self, request, pk=None):
        return Response(serializers.ScheduleVersionSerializer(self.get_object().versions.order_by("-number"), many=True).data)

    def _check_revision(self, request, schedule):
        try:
            expected = int(request.headers.get("If-Match", ""))
        except ValueError:
            raise ValidationError({"code": "REVISION_REQUIRED", "message": "Envie a revisão atual em If-Match."})
        if expected != schedule.revision:
            raise ValidationError({"code": "STALE_REVISION", "message": "A grade foi alterada por outra pessoa.", "current_revision": schedule.revision})


class ScheduleSessionViewSet(AcademicViewSet):
    queryset = models.ScheduledSession.objects.all()
    serializer_class = serializers.ScheduledSessionSerializer
    http_method_names = ["patch", "delete", "head", "options"]

    def partial_update(self, request, *args, **kwargs):
        return self._mutate(request, delete=False)

    def destroy(self, request, *args, **kwargs):
        return self._mutate(request, delete=True)

    def _mutate(self, request, delete):
        with transaction.atomic():
            session = get_object_or_404(models.ScheduledSession.objects.select_related("schedule"), pk=self.kwargs["pk"], schedule_id=self.kwargs["schedule_pk"])
            schedule = models.Schedule.objects.select_for_update().get(pk=session.schedule_id)
            ScheduleViewSet()._check_revision(request, schedule)
            before = serializers.ScheduledSessionSerializer(session).data
            if delete:
                if session.is_locked:
                    raise ValidationError({"code": "LOCKED_SESSION", "message": "Desbloqueie o encontro antes de removê-lo."})
                session.delete()
                data = None
                action_name = "SESSION_DELETED"
            else:
                if "schedule" in request.data:
                    raise ValidationError({"schedule": "A grade de um encontro não pode ser alterada."})
                serializer = self.get_serializer(session, data=request.data, partial=True)
                serializer.is_valid(raise_exception=True)
                session = serializer.save()
                conflicts = validate_session(session)
                if conflicts:
                    transaction.set_rollback(True)
                    return Response({"valid": False, "conflicts": conflicts}, status=status.HTTP_409_CONFLICT)
                data = serializer.data
                action_name = "SESSION_UPDATED"
            models.AuditEvent.objects.create(actor=request.user, action=action_name, entity="ScheduledSession", entity_id=str(before["id"]), metadata={"before": before, "after": data})
            schedule.revision = F("revision") + 1
            schedule.save(update_fields=["revision", "updated_at"])
            schedule.refresh_from_db(fields=["revision"])
            return Response({"session": data, "revision": schedule.revision})

