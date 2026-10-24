from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from . import models


class CleanModelSerializer(serializers.ModelSerializer):
    def validate(self, attrs):
        instance = self.instance or self.Meta.model()
        immutable_relations = {
            models.AcademicTerm: ("institution",),
            models.Course: ("institution",),
            models.Subject: ("institution",),
            models.Teacher: ("institution",),
            models.Room: ("institution",),
            models.RoomFeature: ("institution",),
            models.Curriculum: ("course",),
            models.ClassGroup: ("course", "term"),
            models.SubjectOffering: ("group", "subject"),
            models.SessionRequirement: ("offering",),
            models.TimeProfile: ("institution",),
            models.TimeWindow: ("institution",),
            models.TimeBlock: ("institution",),
            models.TeacherEvent: ("teacher", "term"),
        }.get(type(instance), ())
        if self.instance:
            for name in immutable_relations:
                if name in attrs and getattr(self.instance, f"{name}_id") != attrs[name].pk:
                    raise serializers.ValidationError({name: "Este vínculo não pode ser alterado após o cadastro."})
        many_to_many = {field.name for field in instance._meta.many_to_many}
        for key, value in attrs.items():
            if key not in many_to_many:
                setattr(instance, key, value)
        try:
            instance.full_clean(exclude=many_to_many)
        except DjangoValidationError as error:
            raise serializers.ValidationError(error.message_dict if hasattr(error, "message_dict") else error.messages)
        self._validate_relations(instance, attrs)
        return attrs

    def _validate_relations(self, instance, attrs):
        institution_id = getattr(instance, "institution_id", None)
        if isinstance(instance, models.SubjectOffering) and instance.group_id:
            institution_id = instance.group.course.institution_id
        relation_names = {
            models.Subject: ("required_features",),
            models.Teacher: ("qualified_subjects",),
            models.Room: ("features",),
            models.SubjectOffering: ("eligible_teachers", "required_features"),
        }.get(type(instance), ())
        for name in relation_names:
            values = attrs.get(name)
            if values is not None and any(value.institution_id != institution_id for value in values):
                raise serializers.ValidationError({name: "Todos os registros associados devem pertencer à mesma instituição."})


def serializer_for(model, fields="__all__"):
    meta = type("Meta", (), {"model": model, "fields": fields})
    return type(f"{model.__name__}Serializer", (CleanModelSerializer,), {"Meta": meta})


InstitutionSerializer = serializer_for(models.Institution)
AcademicTermSerializer = serializer_for(models.AcademicTerm)
CourseSerializer = serializer_for(models.Course)
class SubjectSerializer(CleanModelSerializer):
    def validate(self, attrs):
        if self.instance is None and not attrs.get("period_number"):
            raise serializers.ValidationError({"period_number": "Informe o período curricular da disciplina."})
        if "ead_percentage" in self.initial_data:
            raise serializers.ValidationError({"ead_weekly_hours": "Informe horas EAD semanais, não percentual."})
        if "credits" in attrs and attrs["credits"] is not None:
            attrs["total_workload"] = attrs["credits"] * 20
        attrs["workload_unit"] = models.Subject.Unit.CLASS_HOUR
        return super().validate(attrs)

    class Meta:
        model = models.Subject
        fields = "__all__"
CurriculumSerializer = serializer_for(models.Curriculum)
CurriculumPeriodSerializer = serializer_for(models.CurriculumPeriod)
TeacherSerializer = serializer_for(models.Teacher)
RoomFeatureSerializer = serializer_for(models.RoomFeature)
RoomSerializer = serializer_for(models.Room)
class ClassGroupSerializer(CleanModelSerializer):
    def validate(self, attrs):
        if self.instance is None:
            for field, message in (("period_number", "Informe o período curricular da turma."), ("time_profile", "Escolha o turno da turma.")):
                if not attrs.get(field):
                    raise serializers.ValidationError({field: message})
        return super().validate(attrs)

    class Meta:
        model = models.ClassGroup
        fields = "__all__"
SubjectOfferingSerializer = serializer_for(models.SubjectOffering)
SessionRequirementSerializer = serializer_for(models.SessionRequirement)
TimeProfileSerializer = serializer_for(models.TimeProfile)
TimeWindowSerializer = serializer_for(models.TimeWindow)
TimeBlockSerializer = serializer_for(models.TimeBlock)
TeacherEventSerializer = serializer_for(models.TeacherEvent)
class ScheduleSerializer(CleanModelSerializer):
    course_name = serializers.CharField(source="course.name", read_only=True)
    term_name = serializers.CharField(source="term.name", read_only=True)
    time_profile_name = serializers.CharField(source="time_profile.name", read_only=True)

    def validate(self, attrs):
        if self.instance is None and not attrs.get("time_profile"):
            raise serializers.ValidationError({"time_profile": "Escolha o turno da grade."})
        return super().validate(attrs)

    class Meta:
        model = models.Schedule
        fields = ["id", "course", "course_name", "term", "term_name", "time_profile", "time_profile_name", "revision", "published_version", "created_at", "updated_at"]
        read_only_fields = ["revision", "published_version", "created_at", "updated_at"]
ScheduledSessionSerializer = serializer_for(models.ScheduledSession)
ScheduleVersionSerializer = serializer_for(models.ScheduleVersion, ["id", "schedule", "number", "created_at", "created_by"])

