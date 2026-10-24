from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MinValueValidator
from django.db import models


class ActiveModel(models.Model):
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class Institution(ActiveModel):
    name = models.CharField(max_length=200)
    timezone = models.CharField(max_length=80, default="America/Fortaleza")
    class_minutes = models.PositiveSmallIntegerField(default=60, validators=[MinValueValidator(1)])
    slot_granularity_minutes = models.PositiveSmallIntegerField(default=10, validators=[MinValueValidator(1)])

    def clean(self):
        if self.class_minutes != 60:
            raise ValidationError({"class_minutes": "A hora-aula deve ter 60 minutos."})

    def __str__(self):
        return self.name


class AcademicTerm(ActiveModel):
    class Status(models.TextChoices):
        PLANNING = "PLANNING", "Planejamento"
        ACTIVE = "ACTIVE", "Ativo"
        CLOSED = "CLOSED", "Encerrado"

    institution = models.ForeignKey(Institution, on_delete=models.PROTECT)
    name = models.CharField(max_length=100)
    starts_on = models.DateField()
    ends_on = models.DateField()
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.PLANNING)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["institution", "name"], name="unique_term_name")]

    def clean(self):
        if self.starts_on and self.ends_on and self.starts_on > self.ends_on:
            raise ValidationError({"ends_on": "A data final deve ser posterior à inicial."})

    def __str__(self):
        return self.name


class Course(ActiveModel):
    institution = models.ForeignKey(Institution, on_delete=models.PROTECT)
    code = models.CharField(max_length=30)
    name = models.CharField(max_length=200)
    modality = models.CharField(max_length=80, blank=True)
    expected_periods = models.PositiveSmallIntegerField(null=True, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["institution", "code"], name="unique_course_code")]

    def __str__(self):
        return f"{self.code} · {self.name}"


class Subject(ActiveModel):
    class Unit(models.TextChoices):
        CLASS_HOUR = "CLASS_HOUR", "Hora-aula"
        CLOCK_HOUR = "CLOCK_HOUR", "Hora-relógio"

    institution = models.ForeignKey(Institution, on_delete=models.PROTECT)
    code = models.CharField(max_length=30)
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    total_workload = models.PositiveIntegerField(default=0)
    workload_unit = models.CharField(max_length=12, choices=Unit.choices, default=Unit.CLASS_HOUR)
    credits = models.PositiveSmallIntegerField(null=True, blank=True, validators=[MinValueValidator(1)])
    onsite_weekly_hours = models.PositiveSmallIntegerField(null=True, blank=True)
    ead_weekly_hours = models.PositiveSmallIntegerField(default=0)
    period_number = models.PositiveSmallIntegerField(null=True, blank=True, validators=[MinValueValidator(1)])
    required_features = models.ManyToManyField("RoomFeature", blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["institution", "code"], name="unique_subject_code")]

    def __str__(self):
        return f"{self.code} · {self.name}"

    def clean(self):
        if self.credits is not None and self.onsite_weekly_hours is not None and self.onsite_weekly_hours > self.credits:
            raise ValidationError({"onsite_weekly_hours": "As horas presenciais semanais não podem exceder os créditos."})
        if self.credits is not None and self.onsite_weekly_hours is not None and self.onsite_weekly_hours + self.ead_weekly_hours > self.credits:
            raise ValidationError({"ead_weekly_hours": "A soma das horas presenciais e EAD semanais não pode exceder os créditos."})
        if self.workload_unit != self.Unit.CLASS_HOUR:
            raise ValidationError({"workload_unit": "A carga das disciplinas é sempre em hora-aula de 60 minutos."})
        if self.pk and self.period_number and self.subjectoffering_set.exclude(group__period_number=self.period_number).exists():
            raise ValidationError({"period_number": "Esta disciplina já possui oferta para turma de outro período."})


class Curriculum(ActiveModel):
    course = models.ForeignKey(Course, on_delete=models.PROTECT, related_name="curricula")
    version = models.CharField(max_length=40)
    effective_from = models.DateField(null=True, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["course", "version"], name="unique_curriculum_version")]

    def __str__(self):
        return f"{self.course.code} · {self.version}"


class CurriculumPeriod(models.Model):
    curriculum = models.ForeignKey(Curriculum, on_delete=models.CASCADE, related_name="periods")
    number = models.PositiveSmallIntegerField()
    name = models.CharField(max_length=80, blank=True)
    subjects = models.ManyToManyField(Subject, through="CurriculumSubject")

    class Meta:
        constraints = [models.UniqueConstraint(fields=["curriculum", "number"], name="unique_curriculum_period")]


class CurriculumSubject(models.Model):
    period = models.ForeignKey(CurriculumPeriod, on_delete=models.CASCADE)
    subject = models.ForeignKey(Subject, on_delete=models.PROTECT)
    is_required = models.BooleanField(default=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["period", "subject"], name="unique_period_subject")]


class Teacher(ActiveModel):
    institution = models.ForeignKey(Institution, on_delete=models.PROTECT)
    code = models.CharField(max_length=30)
    name = models.CharField(max_length=200)
    color = models.CharField(max_length=30, blank=True, default="")
    max_weekly_minutes = models.PositiveIntegerField(null=True, blank=True)
    qualified_subjects = models.ManyToManyField(Subject, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["institution", "code"], name="unique_teacher_code")]

    def __str__(self):
        return self.name


class RoomFeature(ActiveModel):
    institution = models.ForeignKey(Institution, on_delete=models.PROTECT)
    code = models.CharField(max_length=30)
    name = models.CharField(max_length=100)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["institution", "code"], name="unique_room_feature_code")]

    def __str__(self):
        return self.name


class Room(ActiveModel):
    institution = models.ForeignKey(Institution, on_delete=models.PROTECT)
    code = models.CharField(max_length=30)
    name = models.CharField(max_length=120)
    capacity = models.PositiveIntegerField(null=True, blank=True)
    location = models.CharField(max_length=120, blank=True)
    features = models.ManyToManyField(RoomFeature, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["institution", "code"], name="unique_room_code")]

    def __str__(self):
        return self.name


class ClassGroup(ActiveModel):
    course = models.ForeignKey(Course, on_delete=models.PROTECT)
    term = models.ForeignKey(AcademicTerm, on_delete=models.PROTECT)
    code = models.CharField(max_length=50)
    name = models.CharField(max_length=120, blank=True)
    curriculum_period = models.ForeignKey(CurriculumPeriod, null=True, blank=True, on_delete=models.PROTECT)
    period_number = models.PositiveSmallIntegerField(null=True, blank=True, validators=[MinValueValidator(1)])
    time_profile = models.ForeignKey("TimeProfile", null=True, blank=True, on_delete=models.PROTECT)
    student_count = models.PositiveIntegerField(null=True, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["term", "code"], name="unique_group_code_per_term")]

    def __str__(self):
        return self.code

    def clean(self):
        errors = {}
        if self.course_id and self.term_id and self.course.institution_id != self.term.institution_id:
            errors["term"] = "O período letivo pertence a outra instituição."
        if self.curriculum_period_id and self.course_id and self.curriculum_period.curriculum.course_id != self.course_id:
            errors["curriculum_period"] = "O período curricular pertence a outro curso."
        if self.time_profile_id and self.course_id and self.time_profile.institution_id != self.course.institution_id:
            errors["time_profile"] = "O turno pertence a outra instituição."
        if self.pk and self.period_number and self.offerings.exclude(subject__period_number=self.period_number).exists():
            errors["period_number"] = "A turma possui ofertas de outro período curricular."
        if self.pk and ScheduledSession.objects.filter(requirement__offering__group_id=self.pk).exclude(schedule__time_profile_id=self.time_profile_id).exists():
            errors["time_profile"] = "A turma possui aulas alocadas em outra grade. Remova essas aulas antes de trocar o turno."
        if errors:
            raise ValidationError(errors)


class SubjectOffering(ActiveModel):
    group = models.ForeignKey(ClassGroup, on_delete=models.PROTECT, related_name="offerings")
    subject = models.ForeignKey(Subject, on_delete=models.PROTECT)
    weekly_minutes = models.PositiveIntegerField(default=0)
    eligible_teachers = models.ManyToManyField(Teacher, blank=True)
    required_features = models.ManyToManyField(RoomFeature, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["group", "subject"], name="unique_group_subject_offering")]

    def __str__(self):
        return f"{self.group.code} · {self.subject.name}"

    def clean(self):
        if self.group_id and self.subject_id and self.group.course.institution_id != self.subject.institution_id:
            raise ValidationError({"subject": "A disciplina pertence a outra instituição."})
        if self.group_id and self.subject_id and self.group.period_number != self.subject.period_number:
            raise ValidationError({"subject": "A disciplina pertence a outro período curricular."})


class SessionRequirement(models.Model):
    offering = models.ForeignKey(SubjectOffering, on_delete=models.CASCADE, related_name="requirements")
    duration_minutes = models.PositiveSmallIntegerField(validators=[MinValueValidator(1)])
    weekly_count = models.PositiveSmallIntegerField(validators=[MinValueValidator(1)])
    kind = models.CharField(max_length=80, blank=True)

    def clean(self):
        if not self.offering_id or not self.duration_minutes or not self.weekly_count:
            return
        limit = self.offering.subject.onsite_weekly_hours
        if limit is None:
            return
        others = self.offering.requirements.exclude(pk=self.pk)
        planned_minutes = sum(item.duration_minutes * item.weekly_count for item in others)
        if planned_minutes + self.duration_minutes * self.weekly_count > limit * 60:
            raise ValidationError({"weekly_count": "A oferta já contém todas as horas presenciais semanais desta disciplina."})


class TimeProfile(ActiveModel):
    institution = models.ForeignKey(Institution, on_delete=models.PROTECT)
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    display_order = models.IntegerField(default=0)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["institution", "name"], name="unique_time_profile_name")]

    def __str__(self):
        return self.name


class Weekday(models.IntegerChoices):
    MONDAY = 1, "Segunda"
    TUESDAY = 2, "Terça"
    WEDNESDAY = 3, "Quarta"
    THURSDAY = 4, "Quinta"
    FRIDAY = 5, "Sexta"
    SATURDAY = 6, "Sábado"
    SUNDAY = 7, "Domingo"


class Scope(models.TextChoices):
    INSTITUTION = "INSTITUTION", "Instituição"
    COURSE = "COURSE", "Curso"
    GROUP = "GROUP", "Turma"
    TEACHER = "TEACHER", "Professor"
    ROOM = "ROOM", "Sala"
    OFFERING = "OFFERING", "Oferta"


class TimeWindow(ActiveModel):
    institution = models.ForeignKey(Institution, on_delete=models.PROTECT)
    profile = models.ForeignKey(TimeProfile, null=True, blank=True, on_delete=models.PROTECT, related_name="windows")
    weekday = models.PositiveSmallIntegerField(choices=Weekday.choices)
    starts_at = models.TimeField()
    ends_at = models.TimeField()
    scope = models.CharField(max_length=12, choices=Scope.choices, default=Scope.INSTITUTION)
    scope_id = models.PositiveBigIntegerField(null=True, blank=True)

    def clean(self):
        if self.starts_at and self.ends_at and self.starts_at >= self.ends_at:
            raise ValidationError({"ends_at": "O fim deve ser posterior ao início."})
        if self.profile_id and self.profile.institution_id != self.institution_id:
            raise ValidationError({"profile": "Perfil de outra instituição."})
        validate_time_scope(self)


class TimeBlock(ActiveModel):
    institution = models.ForeignKey(Institution, on_delete=models.PROTECT)
    weekday = models.PositiveSmallIntegerField(choices=Weekday.choices)
    starts_at = models.TimeField()
    ends_at = models.TimeField()
    reason = models.CharField(max_length=200)
    scope = models.CharField(max_length=12, choices=Scope.choices, default=Scope.INSTITUTION)
    scope_id = models.PositiveBigIntegerField(null=True, blank=True)

    def clean(self):
        if self.starts_at and self.ends_at and self.starts_at >= self.ends_at:
            raise ValidationError({"ends_at": "O fim deve ser posterior ao início."})
        validate_time_scope(self)


class TeacherEvent(ActiveModel):
    """Recurring weekly commitment that belongs only to a teacher's agenda."""

    teacher = models.ForeignKey(Teacher, on_delete=models.PROTECT, related_name="events")
    term = models.ForeignKey(AcademicTerm, on_delete=models.PROTECT, related_name="teacher_events")
    title = models.CharField(max_length=160)
    weekday = models.PositiveSmallIntegerField(choices=Weekday.choices)
    starts_at = models.TimeField()
    ends_at = models.TimeField()
    location = models.CharField(max_length=120, blank=True)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["weekday", "starts_at", "teacher_id"]
        indexes = [models.Index(fields=["term", "teacher", "weekday"])]

    def clean(self):
        errors = {}
        if self.teacher_id and self.term_id and self.teacher.institution_id != self.term.institution_id:
            errors["term"] = "O período letivo pertence a outra instituição."
        if self.starts_at and self.ends_at and self.starts_at >= self.ends_at:
            errors["ends_at"] = "O fim deve ser posterior ao início."
        if errors:
            raise ValidationError(errors)


def validate_time_scope(instance):
    if (instance.scope == Scope.INSTITUTION) != (instance.scope_id is None):
        raise ValidationError({"scope_id": "Informe o ID apenas para um escopo específico."})
    if instance.scope == Scope.INSTITUTION:
        return
    model = {
        Scope.COURSE: Course,
        Scope.GROUP: ClassGroup,
        Scope.TEACHER: Teacher,
        Scope.ROOM: Room,
        Scope.OFFERING: SubjectOffering,
    }.get(instance.scope)
    target = model.objects.filter(pk=instance.scope_id).first() if model else None
    if target is None:
        raise ValidationError({"scope_id": "Registro do escopo não encontrado."})
    target_institution_id = (
        target.course.institution_id if isinstance(target, ClassGroup)
        else target.group.course.institution_id if isinstance(target, SubjectOffering)
        else target.institution_id
    )
    if target_institution_id != instance.institution_id:
        raise ValidationError({"scope_id": "O registro pertence a outra instituição."})


class Schedule(ActiveModel):
    course = models.ForeignKey(Course, on_delete=models.PROTECT)
    term = models.ForeignKey(AcademicTerm, on_delete=models.PROTECT)
    time_profile = models.ForeignKey(TimeProfile, null=True, blank=True, on_delete=models.PROTECT)
    revision = models.PositiveIntegerField(default=1)
    published_version = models.PositiveIntegerField(null=True, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["course", "term", "time_profile"], name="unique_schedule_course_term_profile")]

    def clean(self):
        if self.course_id and self.term_id and self.course.institution_id != self.term.institution_id:
            raise ValidationError({"term": "O período letivo pertence a outra instituição."})
        if self.time_profile_id and self.course_id and self.time_profile.institution_id != self.course.institution_id:
            raise ValidationError({"time_profile": "O turno pertence a outra instituição."})


class ScheduleSlot(models.Model):
    """A row in the familiar weekly spreadsheet, shared by its class groups."""

    schedule = models.ForeignKey(Schedule, on_delete=models.CASCADE, related_name="slots")
    starts_at = models.TimeField()
    ends_at = models.TimeField()
    display_order = models.PositiveSmallIntegerField()

    class Meta:
        ordering = ["display_order", "starts_at"]
        constraints = [models.UniqueConstraint(fields=["schedule", "starts_at", "ends_at"], name="unique_schedule_slot")]

    def clean(self):
        if self.starts_at and self.ends_at and self.starts_at >= self.ends_at:
            raise ValidationError({"ends_at": "O fim deve ser posterior ao início."})


class ScheduledSession(models.Model):
    schedule = models.ForeignKey(Schedule, on_delete=models.CASCADE, related_name="sessions")
    requirement = models.ForeignKey(SessionRequirement, on_delete=models.PROTECT)
    occurrence = models.PositiveSmallIntegerField(default=1)
    weekday = models.PositiveSmallIntegerField(choices=Weekday.choices)
    starts_at = models.TimeField()
    ends_at = models.TimeField()
    teacher = models.ForeignKey(Teacher, on_delete=models.PROTECT)
    room = models.ForeignKey(Room, on_delete=models.PROTECT)
    is_locked = models.BooleanField(default=False)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["requirement", "occurrence"], name="unique_requirement_occurrence")]
        indexes = [models.Index(fields=["weekday", "starts_at", "ends_at"]), models.Index(fields=["teacher", "weekday"]), models.Index(fields=["room", "weekday"])]

    def clean(self):
        if self.starts_at and self.ends_at and self.starts_at >= self.ends_at:
            raise ValidationError({"ends_at": "O fim deve ser posterior ao início."})


class ScheduleVersion(models.Model):
    schedule = models.ForeignKey(Schedule, on_delete=models.PROTECT, related_name="versions")
    number = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    snapshot = models.JSONField()

    class Meta:
        constraints = [models.UniqueConstraint(fields=["schedule", "number"], name="unique_schedule_version")]


class AuditEvent(models.Model):
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL)
    action = models.CharField(max_length=80)
    entity = models.CharField(max_length=80)
    entity_id = models.CharField(max_length=80)
    created_at = models.DateTimeField(auto_now_add=True)
    metadata = models.JSONField(default=dict)
