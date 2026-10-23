from django.contrib import admin
from . import models

for model in [
    models.Institution, models.AcademicTerm, models.Course, models.Subject,
    models.Curriculum, models.CurriculumPeriod, models.CurriculumSubject,
    models.Teacher, models.RoomFeature, models.Room, models.ClassGroup,
    models.SubjectOffering, models.SessionRequirement, models.TimeProfile,
    models.TimeWindow, models.TimeBlock, models.Schedule, models.ScheduledSession,
    models.ScheduleVersion, models.AuditEvent,
]:
    admin.site.register(model)

