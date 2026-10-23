from datetime import time

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from academic.models import (
    AcademicTerm, ClassGroup, Course, Institution, Room, Schedule,
    ScheduledSession, SessionRequirement, Subject, SubjectOffering, Teacher,
    TimeWindow,
)


class ScheduleApiTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_superuser("admin", "admin@example.test", "temporary-test-password")
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        institution = Institution.objects.create(name="Instituição de teste")
        term = AcademicTerm.objects.create(institution=institution, name="2027.1", starts_on="2027-01-01", ends_on="2027-06-30")
        course = Course.objects.create(institution=institution, code="ADS", name="ADS")
        subject = Subject.objects.create(institution=institution, code="ALG", name="Algoritmos")
        self.teacher = Teacher.objects.create(institution=institution, code="P1", name="Ana")
        self.room = Room.objects.create(institution=institution, code="S1", name="Sala 1")
        group = ClassGroup.objects.create(course=course, term=term, code="ADS-A")
        offering = SubjectOffering.objects.create(group=group, subject=subject, weekly_minutes=200)
        offering.eligible_teachers.add(self.teacher)
        self.requirement = SessionRequirement.objects.create(offering=offering, duration_minutes=100, weekly_count=2)
        self.schedule = Schedule.objects.create(course=course, term=term)
        TimeWindow.objects.create(institution=institution, weekday=1, starts_at=time(18), ends_at=time(22))
        self.institution = institution

    def payload(self, occurrence=1, start="18:00", end="19:40"):
        return {
            "requirement": self.requirement.pk, "occurrence": occurrence,
            "weekday": 1, "starts_at": start, "ends_at": end,
            "teacher": self.teacher.pk, "room": self.room.pk,
        }

    def test_existing_schedule_can_gain_grid_rows_without_recreating_groups(self):
        response = self.client.post(f"/api/v1/schedules/{self.schedule.pk}/configure-grid/", {
            "slots": [{"start": "18:00", "end": "19:00"}, {"start": "19:00", "end": "20:00"}],
            "weekdays": [1, 2, 3, 4, 5],
        }, format="json", HTTP_IF_MATCH="1")
        self.assertEqual(response.status_code, 200, response.data)
        grid = self.client.get(f"/api/v1/schedules/{self.schedule.pk}/grid/").data
        self.assertEqual(len(grid["groups"]), 1)
        self.assertEqual(len(grid["slots"]), 2)
        self.assertEqual(grid["slots"][0]["start"], "18:00")

    def test_quick_edit_preserves_an_older_manual_requirement(self):
        configured = self.client.post(f"/api/v1/schedules/{self.schedule.pk}/configure-grid/", {
            "slots": [{"start": "18:00", "end": "19:40"}], "weekdays": [1],
        }, format="json", HTTP_IF_MATCH="1")
        self.assertEqual(configured.status_code, 200, configured.data)
        created = self.client.post(f"/api/v1/schedules/{self.schedule.pk}/sessions/", self.payload(), format="json", HTTP_IF_MATCH="2")
        self.assertEqual(created.status_code, 201, created.data)
        grid = self.client.get(f"/api/v1/schedules/{self.schedule.pk}/grid/").data
        changed = self.client.post(f"/api/v1/schedules/{self.schedule.pk}/quick-cells/", {
            "session_id": created.data["session"]["id"], "group_id": grid["groups"][0]["id"],
            "weekday": 1, "slot_id": grid["slots"][0]["id"], "span": 1,
            "subject": "Algoritmos", "teacher": "Ana", "room": "S2",
        }, format="json", HTTP_IF_MATCH="3")
        self.assertEqual(changed.status_code, 200, changed.data)
        self.requirement.refresh_from_db()
        self.assertEqual(self.requirement.weekly_count, 2)
        self.assertEqual(ScheduledSession.objects.get().requirement_id, self.requirement.pk)
        self.assertEqual(ScheduledSession.objects.get().room.code, "S2")

    def test_create_updates_revision_and_rejects_stale_write(self):
        path = f"/api/v1/schedules/{self.schedule.pk}/sessions/"
        created = self.client.post(path, self.payload(), format="json", HTTP_IF_MATCH="1")
        self.assertEqual(created.status_code, 201, created.data)
        self.assertEqual(created.data["revision"], 2)
        stale = self.client.post(path, self.payload(2, "20:00", "21:40"), format="json", HTTP_IF_MATCH="1")
        self.assertEqual(stale.status_code, 400)
        self.assertEqual(ScheduledSession.objects.count(), 1)

    def test_overlap_rolls_back_second_allocation(self):
        path = f"/api/v1/schedules/{self.schedule.pk}/sessions/"
        self.client.post(path, self.payload(), format="json", HTTP_IF_MATCH="1")
        second = self.client.post(path, self.payload(2, "19:00", "20:40"), format="json", HTTP_IF_MATCH="2")
        self.assertEqual(second.status_code, 409, second.data)
        self.assertIn("TEACHER_OVERLAP", {item["code"] for item in second.data["conflicts"]})
        self.assertEqual(ScheduledSession.objects.count(), 1)
        self.schedule.refresh_from_db()
        self.assertEqual(self.schedule.revision, 2)

    def test_block_cannot_silently_invalidate_existing_session(self):
        self.client.post(f"/api/v1/schedules/{self.schedule.pk}/sessions/", self.payload(), format="json", HTTP_IF_MATCH="1")
        response = self.client.post("/api/v1/time-blocks/", {
            "institution": self.institution.pk, "weekday": 1,
            "starts_at": "19:00", "ends_at": "19:15", "reason": "Intervalo",
        }, format="json")
        self.assertEqual(response.status_code, 409, response.data)
        self.assertEqual(response.data["code"], "CONFIGURATION_AFFECTS_SESSIONS")

    def test_preview_reports_conflict_without_saving(self):
        path = f"/api/v1/schedules/{self.schedule.pk}/sessions/"
        self.client.post(path, self.payload(), format="json", HTTP_IF_MATCH="1")
        preview = self.client.post(f"/api/v1/schedules/{self.schedule.pk}/sessions/preview/", self.payload(2, "19:00", "20:40"), format="json", HTTP_IF_MATCH="2")
        self.assertEqual(preview.status_code, 200, preview.data)
        self.assertFalse(preview.data["valid"])
        self.assertEqual(ScheduledSession.objects.count(), 1)
