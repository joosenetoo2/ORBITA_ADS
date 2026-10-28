from datetime import date, time

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import F
from django.db.models.deletion import ProtectedError
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.permissions import AllowAny

from . import generation, models, serializers
from .permissions import AcademicPermission
from .scheduling import candidate_starts, validate_session, validate_teacher_event
from .quick_grid import GridConflict, delete_cell, make_code, normalize_text_key, parse_time, reconcile, save_cell
from .catalog_flow import offer_subject
from .workload import teacher_summary


class AcademicViewSet(viewsets.ModelViewSet):
    permission_classes = [AcademicPermission]
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if isinstance(instance, models.Institution):
            raise ValidationError({"message": "A instituição principal não pode ser excluída."})
        try:
            with transaction.atomic():
                entity_name = instance.__class__.__name__
                item_name = str(getattr(instance, "name", getattr(instance, "code", instance.pk)))
                self.perform_destroy(instance)
                models.AuditEvent.objects.create(
                    actor=request.user,
                    action=f"{entity_name.upper()}_DELETED",
                    entity=entity_name,
                    entity_id=str(kwargs.get("pk", instance.pk)),
                    metadata={"name": item_name},
                )
        except ProtectedError as err:
            related_objects = err.protected_objects
            rel_names = {obj.__class__._meta.verbose_name for obj in related_objects}
            rel_str = ", ".join(sorted(rel_names)) if rel_names else "outros cadastros vinculados"
            raise ValidationError({
                "message": f"Não é possível excluir este item pois ele possui vínculos ativos ({rel_str}). Remova os vínculos primeiro."
            })
        return Response(status=status.HTTP_204_NO_CONTENT)


def viewset_for(model, serializer, *, admin_only=False):
    return type(f"{model.__name__}ViewSet", (AcademicViewSet,), {
        "queryset": model.objects.all().order_by("pk"),
        "serializer_class": serializer,
        "admin_only": admin_only,
    })


def generation_job_data(job):
    return {
        "id": job.pk, "schedule_id": job.schedule_id, "base_revision": job.base_revision,
        "mode": job.mode, "status": job.status, "report": job.report, "error": job.error,
        "created_at": job.created_at,
        "candidates": [{"id": item.pk, "score": item.score, "metrics": item.metrics,
                        "allocations": item.allocations} for item in job.candidates.order_by("score", "pk")],
    }


class GenerationJobView(APIView):
    permission_classes = [AcademicPermission]

    def get(self, request, job_id):
        job = get_object_or_404(models.GenerationJob, pk=job_id)
        return Response(generation_job_data(job))


class GenerationCandidateApplyView(APIView):
    permission_classes = [AcademicPermission]
    coordinator_only = True

    def post(self, request, candidate_id):
        candidate = get_object_or_404(models.GenerationCandidate.objects.select_related("job"), pk=candidate_id)
        try:
            revision = int(request.headers.get("If-Match", ""))
        except ValueError:
            raise ValidationError({"code": "REVISION_REQUIRED", "message": "Envie a revisão atual em If-Match."})
        try:
            new_revision = generation.apply_candidate(candidate, revision, request.user)
        except ValueError as exc:
            return Response({"code": "STALE_PROPOSAL", "message": str(exc)}, status=status.HTTP_409_CONFLICT)
        except GridConflict as exc:
            return Response({"code": "GRID_CONFLICT", "conflicts": exc.conflicts}, status=status.HTTP_409_CONFLICT)
        return Response({"revision": new_revision, "applied": len(candidate.allocations)})


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


class SafeRoomEnvironmentUpdateMixin:
    def partial_update(self, request, *args, **kwargs):
        instance = self.get_object()
        fields = ("required_room_type", "secondary_room_type") if isinstance(instance, models.Subject) else ("room_type",)
        previous = tuple(getattr(instance, field) for field in fields)
        with transaction.atomic():
            response = super().partial_update(request, *args, **kwargs)
            instance.refresh_from_db(fields=fields)
            if tuple(getattr(instance, field) for field in fields) == previous:
                return response
            if isinstance(instance, models.Subject):
                sessions = models.ScheduledSession.objects.filter(requirement__offering__subject=instance).select_related("room")
                invalid = [session.pk for session in sessions if session.room.room_type not in instance.allowed_room_types()]
            else:
                sessions = models.ScheduledSession.objects.filter(room=instance).select_related("requirement__offering__subject")
                invalid = [session.pk for session in sessions if instance.room_type not in session.requirement.offering.subject.allowed_room_types()]
            if invalid:
                transaction.set_rollback(True)
                return Response({"code": "ROOM_TYPE_AFFECTS_SESSIONS",
                                 "message": "A alteração tornaria aulas já alocadas incompatíveis com o ambiente. Realoque essas aulas antes de mudar o tipo.",
                                 "affected_session_ids": invalid}, status=status.HTTP_409_CONFLICT)
            return response


class SubjectViewSet(SafeRoomEnvironmentUpdateMixin, AcademicViewSet):
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
class RoomViewSet(SafeRoomEnvironmentUpdateMixin, AcademicViewSet):
    queryset = models.Room.objects.all().order_by("pk")
    serializer_class = serializers.RoomSerializer
ClassGroupViewSet = viewset_for(models.ClassGroup, serializers.ClassGroupSerializer)
class SubjectOfferingViewSet(AcademicViewSet):
    queryset = models.SubjectOffering.objects.all().order_by("pk")
    serializer_class = serializers.SubjectOfferingSerializer

    @action(detail=False, methods=["post"], url_path="bulk-assign")
    def bulk_assign(self, request):
        items = request.data.get("items")
        if not isinstance(items, list) or not items or len(items) > 200:
            raise ValidationError({"items": "Selecione de 1 a 200 disciplinas."})
        group = get_object_or_404(models.ClassGroup, pk=request.data.get("group_id"), is_active=True)
        subject_ids = [item.get("subject_id") for item in items if isinstance(item, dict)]
        if len(subject_ids) != len(items) or len(set(map(str, subject_ids))) != len(items):
            raise ValidationError({"items": "Cada disciplina deve aparecer apenas uma vez."})
        with transaction.atomic():
            created_ids = []
            for index, item in enumerate(items, 1):
                subject = get_object_or_404(models.Subject, pk=item.get("subject_id"), is_active=True)
                teacher = get_object_or_404(models.Teacher, pk=item.get("teacher_id"), is_active=True)
                if models.SubjectOffering.objects.filter(group=group, subject=subject).exists():
                    raise ValidationError({"items": f"Linha {index}: {subject.name} já está ofertada para {group.code}."})
                offering, _ = offer_subject(subject, group, teacher, item.get("block_hours", 2))
                created_ids.append(offering.pk)
            models.AuditEvent.objects.create(actor=request.user, action="SUBJECTS_BULK_OFFERED", entity="ClassGroup", entity_id=str(group.pk), metadata={"offering_ids": created_ids})
        return Response({"created": len(created_ids), "offering_ids": created_ids}, status=status.HTTP_201_CREATED)


SessionRequirementViewSet = viewset_for(models.SessionRequirement, serializers.SessionRequirementSerializer)


class BatchImportView(APIView):
    permission_classes = [AcademicPermission]

    @staticmethod
    def _room_type(value, field):
        normalized = normalize_text_key(value or "CLASSROOM")
        choices = {"classroom": "CLASSROOM", "sala de aula": "CLASSROOM", "sala": "CLASSROOM",
                   "laboratory": "LABORATORY", "laboratorio": "LABORATORY", "lab": "LABORATORY",
                   "metalab": "METALAB", "meta lab": "METALAB"}
        if normalized not in choices:
            raise ValidationError({field: "Use Sala de Aula (CLASSROOM), Laboratório (LABORATORY) ou Metalab (METALAB)."})
        return choices[normalized]

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
        elif resource == "offerings":
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
                        if "ead_percentage" in row:
                            raise ValidationError({"ead_weekly_hours": "Este CSV usa percentual EAD. Substitua a coluna por horas_ead e informe horas semanais."})
                        ead = self._integer(row.get("ead_weekly_hours", 0) or 0, "ead_weekly_hours", maximum=credits)
                        period_number = self._integer(row.get("period_number"), "period_number", minimum=1, maximum=20)
                        room_type = self._room_type(row.get("required_room_type"), "required_room_type")
                        secondary_room_type = self._room_type(row.get("secondary_room_type"), "secondary_room_type") if row.get("secondary_room_type") else ""
                        obj = models.Subject(institution=institution, code=code, name=name, credits=credits,
                                             onsite_weekly_hours=onsite, ead_weekly_hours=ead, period_number=period_number,
                                             total_workload=credits * 20, workload_unit=models.Subject.Unit.CLASS_HOUR,
                                             required_room_type=room_type, secondary_room_type=secondary_room_type)
                    elif resource == "teachers":
                        if models.Teacher.objects.filter(institution=institution, code__iexact=code).exists():
                            skipped += 1; continue
                        color = str(row.get("color", "") or row.get("cor", "")).strip()
                        obj = models.Teacher(institution=institution, code=code, name=name, color=color)
                    elif resource == "rooms":
                        if models.Room.objects.filter(institution=institution, code__iexact=code).exists():
                            skipped += 1; continue
                        capacity = row.get("capacity")
                        room_type = self._room_type(row.get("room_type"), "room_type")
                        obj = models.Room(institution=institution, code=code, name=name,
                                          capacity=self._integer(capacity, "capacity") if capacity not in (None, "") else None,
                                          room_type=room_type)
                    elif resource == "class-groups":
                        if models.ClassGroup.objects.filter(term=group_term, code__iexact=code).exists():
                            skipped += 1; continue
                        period_number = self._integer(row.get("period_number"), "period_number", minimum=1, maximum=20)
                        profile_name = str(row.get("time_profile", "")).strip()
                        profile = models.TimeProfile.objects.filter(institution=institution, name__iexact=profile_name, is_active=True).first()
                        if not profile:
                            raise ValidationError({"time_profile": "Informe um perfil de horário ativo, como Manhã ou Noite."})
                        obj = models.ClassGroup(course=group_course, term=group_term, code=code, name=name or code, period_number=period_number, time_profile=profile)
                    else:
                        group = models.ClassGroup.objects.filter(term=group_term, code__iexact=str(row.get("group_code", "")).strip()).first()
                        subject = models.Subject.objects.filter(institution=institution, code__iexact=str(row.get("subject_code", "")).strip()).first()
                        teacher = models.Teacher.objects.filter(institution=institution, code__iexact=str(row.get("teacher_code", "")).strip()).first()
                        if not group or not subject or not teacher:
                            raise ValidationError({"offering": "Turma, disciplina ou professor não encontrado pelos códigos informados."})
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

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        institution = getattr(instance, "institution", None)
        if institution:
            sessions = list(models.ScheduledSession.objects.filter(schedule__course__institution=institution).select_related(
                "schedule", "requirement__offering__group__course", "requirement__offering__subject", "teacher", "room"
            ))
            before = {item.pk: {conflict["code"] for conflict in validate_session(item)} & {"OUTSIDE_WINDOW", "TIME_BLOCK"} for item in sessions}
            with transaction.atomic():
                instance.delete()
                affected = [item.pk for item in sessions if ({conflict["code"] for conflict in validate_session(item)} & {"OUTSIDE_WINDOW", "TIME_BLOCK"}) - before[item.pk]]
                if affected:
                    transaction.set_rollback(True)
                    return Response({"code": "CONFIGURATION_AFFECTS_SESSIONS", "message": "A exclusão invalidaria horários de aulas já alocadas na grade.", "affected_session_ids": affected}, status=status.HTTP_409_CONFLICT)
                models.AuditEvent.objects.create(
                    actor=request.user,
                    action=f"{instance.__class__.__name__.upper()}_DELETED",
                    entity=instance.__class__.__name__,
                    entity_id=str(kwargs.get("pk", instance.pk)),
                    metadata={"name": str(getattr(instance, "name", instance.pk))},
                )
            return Response(status=status.HTTP_204_NO_CONTENT)
        return super().destroy(request, *args, **kwargs)

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

    @action(detail=False, methods=["post"], url_path="setup-shifts")
    def setup_shifts(self, request):
        institution = get_object_or_404(models.Institution, pk=request.data.get("institution_id"))
        defaults = (("Manhã", time(8), time(12), 0), ("Noite", time(17, 50), time(21, 50), 1))
        with transaction.atomic():
            sessions = list(models.ScheduledSession.objects.filter(schedule__course__institution=institution).select_related(
                "schedule", "requirement__offering__group__course", "requirement__offering__subject", "teacher", "room"
            ))
            before = {item.pk: {conflict["code"] for conflict in validate_session(item)} & {"OUTSIDE_WINDOW"} for item in sessions}
            profiles = []
            for name, start, end, order in defaults:
                profile, _ = models.TimeProfile.objects.get_or_create(institution=institution, name=name, defaults={"display_order": order})
                if not profile.is_active:
                    profile.is_active = True
                    profile.save(update_fields=["is_active", "updated_at"])
                if not profile.windows.exists():
                    for weekday in range(1, 6):
                        models.TimeWindow.objects.create(institution=institution, profile=profile, weekday=weekday, starts_at=start, ends_at=end)
                profiles.append(profile)
            affected = [item.pk for item in sessions if ({conflict["code"] for conflict in validate_session(item)} & {"OUTSIDE_WINDOW"}) - before[item.pk]]
            if affected:
                transaction.set_rollback(True)
                return Response({"code": "CONFIGURATION_AFFECTS_SESSIONS", "message": "Os horários padrão de manhã e noite restringiriam aulas já alocadas. Ajuste as janelas manualmente.", "affected_session_ids": affected}, status=status.HTTP_409_CONFLICT)
            models.AuditEvent.objects.create(actor=request.user, action="SHIFT_PROFILES_CONFIGURED", entity="Institution", entity_id=str(institution.pk), metadata={"profile_ids": [item.pk for item in profiles]})
        return Response({"profiles": [{"id": item.pk, "name": item.name} for item in profiles]})


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


class TeacherAvailabilityViewSet(AcademicViewSet):
    queryset = models.TeacherAvailability.objects.select_related("teacher", "term").all()
    serializer_class = serializers.TeacherAvailabilitySerializer
    coordinator_only = True

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.request.query_params.get("term_id"):
            queryset = queryset.filter(term_id=self.request.query_params["term_id"])
        if self.request.query_params.get("teacher_id"):
            queryset = queryset.filter(teacher_id=self.request.query_params["teacher_id"])
        return queryset

    @staticmethod
    def _lesson_issues(teacher_id, term_id):
        sessions = models.ScheduledSession.objects.filter(teacher_id=teacher_id, schedule__term_id=term_id).select_related(
            "schedule", "room", "teacher", "requirement__offering__group__course", "requirement__offering__subject"
        )
        availability_codes = {"TEACHER_UNAVAILABLE", "OUTSIDE_TEACHER_AVAILABILITY"}
        return {session.pk: {item["code"] for item in validate_session(session)} & availability_codes
                for session in sessions}

    @staticmethod
    def _affected(before, after):
        return [session_id for session_id, codes in after.items() if codes - before.get(session_id, set())]

    def create(self, request, *args, **kwargs):
        days = request.data.get("weekdays")
        if days is None:
            days = [request.data.get("weekday")]
        if not isinstance(days, list) or not days or len(days) > 7:
            raise ValidationError({"weekdays": "Selecione de um a sete dias."})
        try:
            days = [int(day) for day in days]
        except (TypeError, ValueError):
            raise ValidationError({"weekdays": "Selecione dias válidos."})
        if len(days) != len(set(days)) or any(day not in range(1, 8) for day in days):
            raise ValidationError({"weekdays": "Selecione dias válidos sem repetição."})
        serializers_to_save = []
        for day in days:
            payload = {key: value for key, value in request.data.items() if key != "weekdays"}
            payload["weekday"] = day
            serializer = self.get_serializer(data=payload)
            serializer.is_valid(raise_exception=True)
            serializers_to_save.append(serializer)
        teacher = serializers_to_save[0].validated_data["teacher"]
        term = serializers_to_save[0].validated_data["term"]
        with transaction.atomic():
            before = self._lesson_issues(teacher.pk, term.pk)
            saved = [serializer.save() for serializer in serializers_to_save]
            affected = self._affected(before, self._lesson_issues(teacher.pk, term.pk))
            if affected:
                transaction.set_rollback(True)
                return Response({"code": "AVAILABILITY_AFFECTS_SESSIONS",
                                 "message": "A regra impediria aulas já alocadas. Ajuste a regra ou mova essas aulas primeiro.",
                                 "affected_session_ids": affected}, status=status.HTTP_409_CONFLICT)
            models.AuditEvent.objects.create(actor=request.user, action="TEACHER_AVAILABILITY_CREATED",
                                             entity="TeacherAvailability", entity_id=",".join(str(item.pk) for item in saved),
                                             metadata={"teacher_id": teacher.pk, "term_id": term.pk, "days": days})
        return Response(self.get_serializer(saved, many=True).data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, *args, **kwargs):
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            before = self._lesson_issues(instance.teacher_id, instance.term_id)
            saved = serializer.save()
            affected = self._affected(before, self._lesson_issues(instance.teacher_id, instance.term_id))
            if affected:
                transaction.set_rollback(True)
                return Response({"code": "AVAILABILITY_AFFECTS_SESSIONS",
                                 "message": "A alteração impediria aulas já alocadas. Ajuste a regra ou mova essas aulas primeiro.",
                                 "affected_session_ids": affected}, status=status.HTTP_409_CONFLICT)
            models.AuditEvent.objects.create(actor=request.user, action="TEACHER_AVAILABILITY_UPDATED",
                                             entity="TeacherAvailability", entity_id=str(saved.pk), metadata={"values": serializer.data})
        return Response(serializer.data)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        teacher_id, term_id, rule_id = instance.teacher_id, instance.term_id, instance.pk
        with transaction.atomic():
            before = self._lesson_issues(teacher_id, term_id)
            instance.delete()
            affected = self._affected(before, self._lesson_issues(teacher_id, term_id))
            if affected:
                transaction.set_rollback(True)
                return Response({"code": "AVAILABILITY_AFFECTS_SESSIONS",
                                 "message": "Remover esta faixa deixaria aulas fora da disponibilidade do professor.",
                                 "affected_session_ids": affected}, status=status.HTTP_409_CONFLICT)
            models.AuditEvent.objects.create(actor=request.user, action="TEACHER_AVAILABILITY_DELETED",
                                             entity="TeacherAvailability", entity_id=str(rule_id))
        return Response(status=status.HTTP_204_NO_CONTENT)


class TeacherEventViewSet(AcademicViewSet):
    queryset = models.TeacherEvent.objects.select_related("teacher", "term").all().order_by("weekday", "starts_at", "pk")
    serializer_class = serializers.TeacherEventSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.request.query_params.get("term_id"):
            queryset = queryset.filter(term_id=self.request.query_params["term_id"])
        if self.request.query_params.get("teacher_id"):
            queryset = queryset.filter(teacher_id=self.request.query_params["teacher_id"])
        return queryset

    def create(self, request, *args, **kwargs):
        return self._save_event(request)

    def partial_update(self, request, *args, **kwargs):
        return self._save_event(request, self.get_object())

    def _save_event(self, request, instance=None):
        serializer = self.get_serializer(instance, data=request.data, partial=instance is not None)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            event = serializer.save()
            conflicts = validate_teacher_event(event)
            if conflicts:
                transaction.set_rollback(True)
                return Response({"valid": False, "conflicts": conflicts}, status=status.HTTP_409_CONFLICT)
            models.AuditEvent.objects.create(actor=request.user, action="TEACHER_EVENT_CREATED" if instance is None else "TEACHER_EVENT_UPDATED", entity="TeacherEvent", entity_id=str(event.pk), metadata={"values": serializer.data})
            return Response(serializer.data, status=status.HTTP_201_CREATED if instance is None else status.HTTP_200_OK)


class TeacherAgendaView(APIView):
    permission_classes = [AcademicPermission]

    def get(self, request):
        term = get_object_or_404(models.AcademicTerm, pk=request.query_params.get("term_id"))
        teachers = models.Teacher.objects.filter(institution=term.institution, is_active=True).order_by("name")
        lessons = models.ScheduledSession.objects.filter(schedule__term=term).select_related(
            "teacher", "room", "requirement__offering__subject", "requirement__offering__group", "schedule__course", "schedule__time_profile"
        )
        events = models.TeacherEvent.objects.filter(term=term, is_active=True).select_related("teacher")
        items = [{"id": session.pk, "kind": "LESSON", "teacher_id": session.teacher_id, "weekday": session.weekday,
                  "start": session.starts_at.strftime("%H:%M"), "end": session.ends_at.strftime("%H:%M"),
                  "title": session.requirement.offering.subject.name,
                  "detail": f"{session.requirement.offering.group.name or session.requirement.offering.group.code} · {session.schedule.course.code}",
                  "location": session.room.name or session.room.code,
                  "source": session.schedule.time_profile.name if session.schedule.time_profile_id else "Grade sem turno",
                  "schedule_id": session.schedule_id} for session in lessons]
        items += [{"id": event.pk, "kind": "EVENT", "teacher_id": event.teacher_id, "weekday": event.weekday,
                   "start": event.starts_at.strftime("%H:%M"), "end": event.ends_at.strftime("%H:%M"),
                   "title": event.title, "detail": event.notes, "location": event.location,
                   "source": "Avulso", "schedule_id": None} for event in events]
        summaries = [{"teacher_id": teacher.pk, **teacher_summary([item for item in items if item["teacher_id"] == teacher.pk])}
                     for teacher in teachers]
        return Response({"term": term.name, "teachers": [{"id": teacher.pk, "name": teacher.name, "color": teacher.color} for teacher in teachers],
                         "items": sorted(items, key=lambda item: (item["weekday"], item["start"], item["teacher_id"])),
                         "summaries": summaries})


class ScheduleViewSet(AcademicViewSet):
    queryset = models.Schedule.objects.select_related("course", "term", "time_profile").all().order_by("pk")
    serializer_class = serializers.ScheduleSerializer
    http_method_names = ["get", "post", "delete", "head", "options"]

    @action(detail=True, methods=["get"], url_path="generation/preflight")
    def generation_preflight(self, request, pk=None):
        mode = request.query_params.get("mode", "FILL")
        try:
            report = generation.preflight(self.get_object(), mode)
        except ValueError as exc:
            raise ValidationError({"mode": str(exc)}) from exc
        return Response(report)

    @action(detail=True, methods=["post"], url_path="generation")
    def generate(self, request, pk=None):
        if not (request.user.is_superuser or request.user.groups.filter(name__in=["Administrador", "Coordenador"]).exists()):
            raise PermissionDenied("A geração de horários é exclusiva da coordenação.")
        schedule = self.get_object()
        self._check_revision(request, schedule)
        mode = request.data.get("mode", "FILL")
        if mode not in {"FILL", "REARRANGE"}:
            raise ValidationError({"mode": "Escolha preencher lacunas ou reorganizar aulas não fixadas."})
        try:
            seconds = int(request.data.get("time_limit_seconds", 10))
        except (ValueError, TypeError):
            raise ValidationError({"time_limit_seconds": "Informe um tempo entre 1 e 30 segundos."})
        if not 1 <= seconds <= 30:
            raise ValidationError({"time_limit_seconds": "Informe um tempo entre 1 e 30 segundos."})
        job = models.GenerationJob.objects.create(
            schedule=schedule, requested_by=request.user, base_revision=schedule.revision,
            mode=mode, time_limit_seconds=seconds, status=models.GenerationJob.Status.RUNNING,
            started_at=timezone.now(),
        )
        try:
            state, report, candidates = generation.solve(schedule, mode, time_limit=seconds, alternatives=2)
            job.status = state
            job.report = report
            job.finished_at = timezone.now()
            job.save(update_fields=["status", "report", "finished_at"])
            for item in candidates:
                models.GenerationCandidate.objects.create(job=job, **item)
            models.AuditEvent.objects.create(actor=request.user, action="GENERATION_FINISHED",
                                             entity="GenerationJob", entity_id=str(job.pk),
                                             metadata={"status": state, "candidates": len(candidates)})
        except Exception as exc:
            job.status = models.GenerationJob.Status.FAILED
            job.error = str(exc)
            job.finished_at = timezone.now()
            job.save(update_fields=["status", "error", "finished_at"])
            raise
        return Response(generation_job_data(job), status=status.HTTP_201_CREATED)

    def destroy(self, request, *args, **kwargs):
        schedule = self.get_object()
        with transaction.atomic():
            grade_requirement_ids = list(schedule.sessions.filter(requirement__kind="GRADE").values_list("requirement_id", flat=True).distinct())
            schedule.versions.all().delete()
            schedule.sessions.all().delete()
            for requirement in models.SessionRequirement.objects.filter(pk__in=grade_requirement_ids):
                reconcile(requirement)
            schedule_id = schedule.pk
            schedule.delete()
            models.AuditEvent.objects.create(actor=request.user, action="SCHEDULE_DELETED", entity="Schedule", entity_id=str(schedule_id))
        return Response(status=status.HTTP_204_NO_CONTENT)

    @staticmethod
    def _profile_structure(schedule):
        institution = schedule.course.institution
        group_ids = set(models.ClassGroup.objects.filter(course=schedule.course, term=schedule.term, time_profile=schedule.time_profile).values_list("pk", flat=True))
        profiles = list(models.TimeProfile.objects.filter(pk=schedule.time_profile_id, institution=institution, is_active=True))
        windows = list(models.TimeWindow.objects.filter(institution=institution, profile__in=profiles, is_active=True).order_by("weekday", "starts_at"))
        applicable = [window for window in windows if window.scope == models.Scope.INSTITUTION or
                      (window.scope == models.Scope.COURSE and window.scope_id == schedule.course_id) or
                      (window.scope == models.Scope.GROUP and window.scope_id in group_ids)]
        minutes_per_class = institution.class_minutes
        slots = set()
        daily_slots = {}
        weekdays = set()
        details = []
        for profile in profiles:
            own = [window for window in applicable if window.profile_id == profile.pk]
            details.append({"id": profile.pk, "name": profile.name, "windows": [
                {"weekday": window.weekday, "start": window.starts_at.strftime("%H:%M"), "end": window.ends_at.strftime("%H:%M")}
                for window in own]})
            for window in own:
                start = window.starts_at.hour * 60 + window.starts_at.minute
                end = window.ends_at.hour * 60 + window.ends_at.minute
                if (end - start) % minutes_per_class:
                    raise ValidationError({"windows": f"A janela {profile.name}, dia {window.weekday}, precisa conter horas-aula completas de {minutes_per_class} minutos."})
                weekdays.add(window.weekday)
                for minute in range(start, end, minutes_per_class):
                    slots.add((minute, minute + minutes_per_class))
                    daily_slots.setdefault(window.weekday, set()).add((minute, minute + minutes_per_class))
        ordered = sorted(slots)
        if any(left[1] > right[0] for left, right in zip(ordered, ordered[1:])):
            raise ValidationError({"windows": "As janelas dos perfis geram faixas de aula sobrepostas. Ajuste os perfis."})
        return {"profiles": details, "weekdays": sorted(weekdays), "daily_slots": {day: sorted(values) for day, values in daily_slots.items()}, "slots": [
            {"start": f"{start // 60:02d}:{start % 60:02d}", "end": f"{end // 60:02d}:{end % 60:02d}"}
            for start, end in ordered]}

    @action(detail=True, methods=["get"], url_path="profile-slots")
    def profile_slots(self, request, pk=None):
        return Response(self._profile_structure(self.get_object()))

    @staticmethod
    def _check_profile_sessions(schedule, structure):
        weekdays = set(structure["weekdays"])
        for session in schedule.sessions.all():
            if session.weekday not in weekdays:
                raise ValidationError({"profiles": f"A aula #{session.pk} usa um dia ausente dos perfis ativos. Ajuste a janela antes de aplicar."})
            cursor = session.starts_at.hour * 60 + session.starts_at.minute
            end_minute = session.ends_at.hour * 60 + session.ends_at.minute
            for start, end in structure["daily_slots"][session.weekday]:
                if start == cursor and end <= end_minute:
                    cursor = end
            if cursor != end_minute:
                raise ValidationError({"profiles": f"A aula #{session.pk} não cabe nas faixas atuais dos perfis. Ajuste a janela antes de aplicar."})

    @classmethod
    def _apply_profile_structure(cls, schedule):
        structure = cls._profile_structure(schedule)
        if not structure["slots"]:
            raise ValidationError({"profiles": "Configure janelas ativas nos perfis de horário antes de montar a grade."})
        cls._check_profile_sessions(schedule, structure)
        desired = {(parse_time(item["start"]), parse_time(item["end"])) for item in structure["slots"]}
        for slot in schedule.slots.all():
            if (slot.starts_at, slot.ends_at) not in desired:
                slot.delete()
        cls._configure_slots(schedule, structure["slots"], structure["weekdays"])
        return structure

    @staticmethod
    def _grid_blocks(offer):
        used = sum(
            item.requirement.duration_minutes
            for item in models.ScheduledSession.objects.filter(requirement__offering=offer).select_related("requirement")
        )
        onsite = offer.subject.onsite_weekly_hours
        max_weekly_hours = onsite if onsite is not None else 6
        remaining_minutes = max(0, max_weekly_hours * 60 - used)
        max_possible_hours = min(max_weekly_hours, 6)
        return [
            {
                "duration_minutes": hours * 60,
                "remaining": 1 if remaining_minutes >= hours * 60 else 0,
                "total_weekly_hours": max_weekly_hours,
                "remaining_minutes": remaining_minutes,
            }
            for hours in range(1, max_possible_hours + 1)
        ]

    @action(detail=False, methods=["post"], url_path="from-offerings")
    def from_offerings(self, request):
        group = get_object_or_404(models.ClassGroup, pk=request.data.get("group_id"), is_active=True)
        if not group.time_profile_id:
            raise ValidationError({"group_id": "Defina o turno da turma antes de criar a grade."})
        if not models.SubjectOffering.objects.filter(group=group, is_active=True).exists():
            raise ValidationError({"group_id": "Oferte ao menos uma disciplina para esta turma antes de criar a grade."})
        with transaction.atomic():
            schedule, created = models.Schedule.objects.get_or_create(course=group.course, term=group.term, time_profile=group.time_profile)
            models.AuditEvent.objects.create(actor=request.user, action="GRID_OPENED_FROM_OFFERINGS", entity="Schedule", entity_id=str(schedule.pk), metadata={"group_id": group.pk, "created": created})
        return Response({"id": schedule.pk, "created": created}, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)

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
                    institution=schedule.course.institution, profile=schedule.time_profile if (end.hour * 60 + end.minute - start.hour * 60 - start.minute) % schedule.course.institution.class_minutes == 0 else None,
                    scope=models.Scope.COURSE, scope_id=schedule.course_id,
                    weekday=day, starts_at=start, ends_at=end,
                )

    @action(detail=True, methods=["post"], url_path="configure-grid")
    def configure_grid(self, request, pk=None):
        with transaction.atomic():
            schedule = models.Schedule.objects.select_for_update().get(pk=self.get_object().pk)
            self._check_revision(request, schedule)
            if request.data.get("use_profiles"):
                structure = self._apply_profile_structure(schedule)
                slot_values, weekdays = structure["slots"], structure["weekdays"]
            else:
                if models.TimeWindow.objects.filter(institution=schedule.course.institution, profile=schedule.time_profile, profile__is_active=True, is_active=True).exists():
                    raise ValidationError({"profiles": "As faixas desta grade vêm dos perfis de horário. Atualize a grade a partir das janelas vigentes."})
                slot_values, weekdays = request.data.get("slots"), request.data.get("weekdays")
                self._configure_slots(schedule, slot_values, weekdays)
            schedule.revision = F("revision") + 1
            schedule.save(update_fields=["revision", "updated_at"])
            schedule.refresh_from_db(fields=["revision"])
            models.AuditEvent.objects.create(actor=request.user, action="GRID_SLOTS_CONFIGURED", entity="Schedule", entity_id=str(schedule.pk), metadata={"slots": slot_values, "weekdays": weekdays, "use_profiles": bool(request.data.get("use_profiles"))})
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
            slot_values = data.get("slots") or []
            weekdays = [int(value) for value in data.get("weekdays", [1, 2, 3, 4, 5])]
        except (KeyError, TypeError, ValueError):
            raise ValidationError({"setup": "Confira as datas, turmas, faixas e dias."})
        if starts_on > ends_on or not groups or any(day not in range(1, 8) for day in weekdays):
            raise ValidationError({"setup": "Informe datas válidas e ao menos uma turma."})
        if len(groups) != len(set(groups)) or any(not value or len(value) > 50 for value in groups):
            raise ValidationError({"groups": "As turmas devem ter nomes únicos com até 50 caracteres."})
        try:
            group_period = int(data.get("group_period"))
        except (TypeError, ValueError):
            raise ValidationError({"group_period": "Informe o período curricular das turmas."})
        if group_period not in range(1, 21):
            raise ValidationError({"group_period": "Escolha um período curricular entre 1 e 20."})
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
            profile = get_object_or_404(models.TimeProfile, pk=data.get("time_profile_id"), institution=institution, is_active=True)
            schedule, _ = models.Schedule.objects.get_or_create(course=course, term=term, time_profile=profile)
            for code in groups:
                previous = models.ClassGroup.objects.filter(term=term, code=code).first()
                if previous and previous.course_id != course.pk:
                    raise ValidationError({"groups": f"A turma {code} pertence a outro curso."})
                if previous and previous.time_profile_id != profile.pk:
                    raise ValidationError({"groups": f"A turma {code} pertence a outro turno."})
                if previous and previous.period_number != group_period:
                    raise ValidationError({"groups": f"A turma {code} pertence a outro período curricular."})
                models.ClassGroup.objects.get_or_create(course=course, term=term, code=code, defaults={"time_profile": profile, "period_number": group_period, "name": code})
            if models.TimeWindow.objects.filter(institution=institution, profile=profile, profile__is_active=True, is_active=True).exists():
                self._apply_profile_structure(schedule)
            else:
                if not slot_values or not weekdays:
                    raise ValidationError({"setup": "Configure as janelas dos perfis ou informe faixas e dias para a primeira grade."})
                self._configure_slots(schedule, slot_values, weekdays)
            models.AuditEvent.objects.create(actor=request.user, action="GRID_QUICK_SETUP", entity="Schedule", entity_id=str(schedule.pk), metadata={"groups": groups})
            return Response({"id": schedule.pk}, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"])
    def grid(self, request, pk=None):
        schedule = self.get_object()
        profile_structure = self._profile_structure(schedule)
        active_weekdays = profile_structure["weekdays"] if profile_structure["slots"] else list(models.TimeWindow.objects.filter(institution=schedule.course.institution, scope=models.Scope.COURSE, scope_id=schedule.course_id, is_active=True).values_list("weekday", flat=True).distinct().order_by("weekday"))
        schedule_slots = list(schedule.slots.all())
        configured_slots = {(slot.starts_at.strftime("%H:%M"), slot.ends_at.strftime("%H:%M")) for slot in schedule_slots}
        current_profile_slots = {(item["start"], item["end"]) for item in profile_structure["slots"]}
        allowed_slots = {str(day): [slot.pk for slot in schedule_slots if
                          (slot.starts_at.hour * 60 + slot.starts_at.minute, slot.ends_at.hour * 60 + slot.ends_at.minute) in values]
                         for day, values in profile_structure["daily_slots"].items()} if profile_structure["slots"] else {}
        groups = models.ClassGroup.objects.filter(course=schedule.course, term=schedule.term, time_profile=schedule.time_profile, is_active=True).order_by("code")
        offerings = models.SubjectOffering.objects.filter(group__in=groups, is_active=True).select_related("subject").prefetch_related("eligible_teachers", "requirements")
        sessions = schedule.sessions.select_related("requirement__offering__subject", "requirement__offering__group", "teacher", "room").order_by("weekday", "starts_at")
        return Response({
            "id": schedule.pk, "revision": schedule.revision, "course": schedule.course.name, "term": schedule.term.name, "time_profile": schedule.time_profile_id, "time_profile_name": schedule.time_profile.name if schedule.time_profile_id else "Sem turno",
            "institution": schedule.course.institution.name,
            "profiles_active": bool(profile_structure["slots"]),
            "profile_slots_in_sync": not current_profile_slots or configured_slots == current_profile_slots,
            "weekdays": active_weekdays,
            "available_slot_ids_by_day": allowed_slots,
            "groups": [{"id": group.pk, "code": group.code, "name": group.name, "period_number": group.period_number} for group in groups],
            "offerings": [{"id": offer.pk, "group_id": offer.group_id, "subject": offer.subject.name,
                           "onsite_weekly_hours": offer.subject.onsite_weekly_hours,
                           "required_room_type": offer.subject.required_room_type,
                           "secondary_room_type": offer.subject.secondary_room_type,
                           "teachers": [{"id": teacher.pk, "name": teacher.name, "color": teacher.color} for teacher in offer.eligible_teachers.all()],
                           "blocks": self._grid_blocks(offer)}
                          for offer in offerings],
            "slots": [{"id": slot.pk, "start": slot.starts_at.strftime("%H:%M"), "end": slot.ends_at.strftime("%H:%M")} for slot in schedule_slots],
            "sessions": [{"id": item.pk, "group_id": item.requirement.offering.group_id, "weekday": item.weekday,
                          "start": item.starts_at.strftime("%H:%M"), "end": item.ends_at.strftime("%H:%M"),
                          "subject": item.requirement.offering.subject.name,
                          "teacher": item.teacher.name,
                          "teacher_id": item.teacher_id,
                          "teacher_color": item.teacher.color,
                          "room": item.room.name or item.room.code,
                          "room_code": item.room.code,
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
                    is_batch = entries is not None
                    if entries is None:
                        entries = [request.data]
                    if not isinstance(entries, list) or not entries or len(entries) > 200:
                        raise ValidationError({"cells": "Envie de 1 a 200 células."})
                    for index, entry in enumerate(entries):
                        try:
                            save_cell(schedule, entry)
                        except GridConflict as conflict:
                            conflict.index = index if is_batch else None
                            raise
                    count = len(entries)
            except GridConflict as conflict:
                transaction.set_rollback(True)
                payload = {"code": "GRID_CONFLICT", "conflicts": conflict.conflicts}
                if conflict.index is not None:
                    payload["cell_index"] = conflict.index
                return Response(payload, status=status.HTTP_409_CONFLICT)
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
        offerings = models.SubjectOffering.objects.filter(
            group__course=schedule.course, group__term=schedule.term,
            group__time_profile=schedule.time_profile, is_active=True,
        ).select_related("group", "subject")
        for offering in offerings:
            required = (offering.subject.onsite_weekly_hours * 60
                        if offering.subject.onsite_weekly_hours is not None else offering.weekly_minutes)
            sessions = schedule.sessions.filter(requirement__offering=offering)
            allocated = sum(
                (session.ends_at.hour * 60 + session.ends_at.minute)
                - (session.starts_at.hour * 60 + session.starts_at.minute)
                for session in sessions
            )
            if allocated != required:
                difference = abs(required - allocated)
                action = "Faltam" if allocated < required else "Excedem"
                conflicts.append({
                    "code": "OFFERING_HOURS", "severity": "HARD",
                    "message": f"{offering}: {action} {difference / 60:g} h presenciais ({allocated / 60:g} de {required / 60:g} h alocadas).",
                    "offering_id": offering.pk, "group_code": offering.group.code,
                    "subject_name": offering.subject.name, "required_minutes": required,
                    "allocated_minutes": allocated,
                })
        return Response({"valid": not conflicts, "conflicts": conflicts})

    @action(detail=True, methods=["get"])
    def versions(self, request, pk=None):
        return Response(serializers.ScheduleVersionSerializer(self.get_object().versions.order_by("-number"), many=True).data)

    @action(detail=True, methods=["post"])
    def publish(self, request, pk=None):
        if not request.user.is_superuser and not request.user.groups.filter(name__in=["Administrador", "Coordenador"]).exists():
            raise PermissionDenied("A publicação exige perfil de coordenador ou administrador.")
        with transaction.atomic():
            schedule = models.Schedule.objects.select_for_update().get(pk=self.get_object().pk)
            self._check_revision(request, schedule)
            if schedule.term.status == models.AcademicTerm.Status.CLOSED:
                raise ValidationError({"term": "O período letivo está encerrado e não aceita publicação."})
            result = self.validate(request, pk)
            if not result.data["valid"]:
                return Response({"valid": False, "conflicts": result.data["conflicts"]}, status=status.HTTP_409_CONFLICT)
            grid = self.grid(request, pk).data
            if not grid["sessions"]:
                raise ValidationError({"schedule": "Aloque ao menos uma aula antes de publicar."})
            snapshot = {key: grid[key] for key in ("id", "revision", "course", "term", "institution", "time_profile_name", "weekdays", "groups", "slots", "sessions")}
            number = (schedule.versions.order_by("-number").values_list("number", flat=True).first() or 0) + 1
            version = models.ScheduleVersion.objects.create(schedule=schedule, number=number, created_by=request.user, snapshot=snapshot)
            schedule.published_version = number
            schedule.revision = F("revision") + 1
            schedule.save(update_fields=["published_version", "revision", "updated_at"])
            schedule.refresh_from_db(fields=["revision"])
            models.AuditEvent.objects.create(actor=request.user, action="SCHEDULE_PUBLISHED", entity="Schedule", entity_id=str(schedule.pk), metadata={"version": number})
            return Response({"version": number, "revision": schedule.revision, "published_at": version.created_at})

    @action(detail=True, methods=["post"])
    def unpublish(self, request, pk=None):
        if not request.user.is_superuser and not request.user.groups.filter(name__in=["Administrador", "Coordenador"]).exists():
            raise PermissionDenied("A despublicação exige perfil de coordenador ou administrador.")
        with transaction.atomic():
            schedule = models.Schedule.objects.select_for_update().get(pk=self.get_object().pk)
            self._check_revision(request, schedule)
            schedule.published_version = None
            schedule.revision = F("revision") + 1
            schedule.save(update_fields=["published_version", "revision", "updated_at"])
            schedule.refresh_from_db(fields=["revision"])
            models.AuditEvent.objects.create(actor=request.user, action="SCHEDULE_UNPUBLISHED", entity="Schedule", entity_id=str(schedule.pk))
            return Response({"revision": schedule.revision})

    def _check_revision(self, request, schedule):
        try:
            expected = int(request.headers.get("If-Match", ""))
        except ValueError:
            raise ValidationError({"code": "REVISION_REQUIRED", "message": "Envie a revisão atual em If-Match."})
        if expected != schedule.revision:
            raise ValidationError({"code": "STALE_REVISION", "message": "A grade foi alterada por outra pessoa.", "current_revision": schedule.revision})


class PublicScheduleView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request, schedule_id=None):
        queryset = models.Schedule.objects.filter(is_active=True, published_version__isnull=False).select_related("course", "term", "time_profile")
        if schedule_id is not None:
            schedule = get_object_or_404(queryset, pk=schedule_id)
            version = get_object_or_404(models.ScheduleVersion, schedule=schedule, number=schedule.published_version)
            return Response({**version.snapshot, "version": version.number, "published_at": version.created_at})
        rows = []
        for schedule in queryset.order_by("course__name", "term__name", "time_profile__name"):
            version = schedule.versions.filter(number=schedule.published_version).first()
            if not version:
                continue
            snapshot = version.snapshot
            rows.append({"id": schedule.pk, "course": snapshot["course"], "term": snapshot["term"],
                         "institution": snapshot["institution"], "time_profile_name": snapshot["time_profile_name"],
                         "version": version.number, "published_at": version.created_at,
                         "period_numbers": sorted({group["period_number"] for group in snapshot["groups"] if group.get("period_number")})})
        return Response(rows)


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

