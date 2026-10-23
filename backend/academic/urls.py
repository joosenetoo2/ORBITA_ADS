from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import auth_views, views

router = DefaultRouter()
for route, viewset in [
    ("institutions", views.InstitutionViewSet),
    ("academic-terms", views.AcademicTermViewSet),
    ("courses", views.CourseViewSet),
    ("subjects", views.SubjectViewSet),
    ("curricula", views.CurriculumViewSet),
    ("curriculum-periods", views.CurriculumPeriodViewSet),
    ("teachers", views.TeacherViewSet),
    ("room-features", views.RoomFeatureViewSet),
    ("rooms", views.RoomViewSet),
    ("class-groups", views.ClassGroupViewSet),
    ("subject-offerings", views.SubjectOfferingViewSet),
    ("session-requirements", views.SessionRequirementViewSet),
    ("time-profiles", views.TimeProfileViewSet),
    ("time-windows", views.TimeWindowViewSet),
    ("time-blocks", views.TimeBlockViewSet),
    ("schedules", views.ScheduleViewSet),
]:
    router.register(route, viewset, basename=route)

session_detail = views.ScheduleSessionViewSet.as_view({"patch": "partial_update", "delete": "destroy"})
urlpatterns = [
    path("auth/session/", auth_views.session_view, name="auth-session"),
    path("auth/login/", auth_views.login_view, name="auth-login"),
    path("auth/logout/", auth_views.logout_view, name="auth-logout"),
    path("schedules/<int:schedule_pk>/sessions/<int:pk>/", session_detail, name="schedule-session-detail"),
    path("", include(router.urls)),
]

