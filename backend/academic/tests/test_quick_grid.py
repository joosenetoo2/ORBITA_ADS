from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from academic.models import ClassGroup, Institution, ScheduledSession, SessionRequirement, Subject, SubjectOffering, Teacher, Room, TimeProfile
from academic.catalog_flow import offer_subject


class QuickGridTests(TestCase):
    def setUp(self):
        user = get_user_model().objects.create_superuser("grid-admin", "grid@example.test", "test-password")
        self.client = APIClient()
        self.client.force_authenticate(user)
        institution = Institution.objects.create(name="Faculdade")
        profile = TimeProfile.objects.create(institution=institution, name="Noite")
        response = self.client.post("/api/v1/schedules/quick-setup/", {
            "institution": "Faculdade", "course_code": "ADS", "course_name": "Análise e Desenvolvimento de Sistemas",
            "term": "2027.1", "starts_on": "2027-01-01", "ends_on": "2027-06-30",
            "groups": ["1º A", "1º C"], "group_period": 1, "time_profile_id": profile.pk, "weekdays": [1, 2, 3, 4, 5],
            "slots": [{"start": "17:50", "end": "18:50"}, {"start": "18:50", "end": "19:50"}, {"start": "19:50", "end": "20:50"}],
        }, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.schedule_id = response.data["id"]
        self.grid_url = f"/api/v1/schedules/{self.schedule_id}/grid/"
        self.cells_url = f"/api/v1/schedules/{self.schedule_id}/quick-cells/"
        self.grid = self.client.get(self.grid_url).data
        institution = Institution.objects.get()
        subject = Subject.objects.create(institution=institution, code="POO", name="Programação OO", credits=2, onsite_weekly_hours=2, total_workload=40, period_number=1)
        arthur = Teacher.objects.create(institution=institution, code="ARTHUR", name="Arthur Oliveira", color="#2563eb")
        beatriz = Teacher.objects.create(institution=institution, code="BIA", name="Beatriz")
        for group in ClassGroup.objects.all():
            offering, _ = offer_subject(subject, group, arthur)
            offering.eligible_teachers.add(beatriz)

    def cell(self, **overrides):
        return {"group_id": self.grid["groups"][0]["id"], "weekday": 1,
                "slot_id": self.grid["slots"][0]["id"], "span": 2,
                "subject": "Programação OO", "teacher": "Arthur Oliveira", "room": "Lab A01", **overrides}

    def test_one_cell_creates_related_records_and_teacher_view_data(self):
        response = self.client.post(self.cells_url, self.cell(), format="json", HTTP_IF_MATCH="1")
        self.assertEqual(response.status_code, 200, response.data)
        grid = self.client.get(self.grid_url).data
        self.assertEqual(grid["sessions"][0]["end"], "19:50")
        self.assertEqual(grid["sessions"][0]["teacher"], "Arthur Oliveira")
        self.assertEqual(grid["sessions"][0]["teacher_color"], "#2563eb")
        self.assertEqual(grid["weekdays"], [1, 2, 3, 4, 5])
        self.assertEqual(Subject.objects.count(), 1)
        self.assertEqual(Teacher.objects.count(), 2)
        self.assertEqual(Room.objects.count(), 1)
        self.assertEqual(SessionRequirement.objects.filter(offering__group_id=self.grid["groups"][0]["id"]).get().weekly_count, 1)

    def test_teacher_event_blocks_a_class_cell(self):
        term_id = self.client.get(f"/api/v1/schedules/{self.schedule_id}/").data["term"]
        teacher = Teacher.objects.get(code="ARTHUR")
        event = self.client.post("/api/v1/teacher-events/", {
            "teacher": teacher.pk, "term": term_id, "title": "Orientação",
            "weekday": 1, "starts_at": "18:00", "ends_at": "19:00",
        }, format="json")
        self.assertEqual(event.status_code, 201, event.data)
        response = self.client.post(self.cells_url, self.cell(), format="json", HTTP_IF_MATCH="1")
        self.assertEqual(response.status_code, 409, response.data)
        self.assertEqual(ScheduledSession.objects.count(), 0)

    def test_batch_conflict_rolls_back_every_cell_and_autocreated_records(self):
        second = self.cell(group_id=self.grid["groups"][1]["id"], room="Lab A02")
        response = self.client.post(self.cells_url, {"cells": [self.cell(), second]}, format="json", HTTP_IF_MATCH="1")
        self.assertEqual(response.status_code, 409, response.data)
        self.assertEqual(response.data["cell_index"], 1)
        self.assertEqual(ScheduledSession.objects.count(), 0)
        self.assertEqual(Subject.objects.count(), 1)
        self.assertEqual(ClassGroup.objects.count(), 2)

    def test_edit_and_delete_keep_requirement_count_in_sync(self):
        self.client.post(self.cells_url, self.cell(), format="json", HTTP_IF_MATCH="1")
        old = self.client.get(self.grid_url).data["sessions"][0]
        changed = self.client.post(self.cells_url, self.cell(session_id=old["id"], teacher="Beatriz"), format="json", HTTP_IF_MATCH="2")
        self.assertEqual(changed.status_code, 200, changed.data)
        self.assertEqual(ScheduledSession.objects.count(), 1)
        self.assertEqual(SessionRequirement.objects.filter(offering__group_id=self.grid["groups"][0]["id"]).get().weekly_count, 1)
        new_id = self.client.get(self.grid_url).data["sessions"][0]["id"]
        deleted = self.client.delete(self.cells_url, {"session_id": new_id}, format="json", HTTP_IF_MATCH="3")
        self.assertEqual(deleted.status_code, 200, deleted.data)
        self.assertEqual(ScheduledSession.objects.count(), 0)
        self.assertEqual(SessionRequirement.objects.count(), 2)

    def test_drag_style_move_preserves_the_whole_block_and_id(self):
        self.client.post(self.cells_url, self.cell(), format="json", HTTP_IF_MATCH="1")
        original = self.client.get(self.grid_url).data["sessions"][0]
        moved = self.client.post(self.cells_url, self.cell(
            session_id=original["id"], weekday=2, slot_id=self.grid["slots"][1]["id"],
        ), format="json", HTTP_IF_MATCH="2")
        self.assertEqual(moved.status_code, 200, moved.data)
        session = self.client.get(self.grid_url).data["sessions"][0]
        self.assertEqual(session["id"], original["id"])
        self.assertEqual((session["weekday"], session["start"], session["end"]), (2, "18:50", "20:50"))
        self.assertEqual(SessionRequirement.objects.filter(offering__group_id=self.grid["groups"][0]["id"]).get().weekly_count, 1)

    def test_unoffered_subject_and_unlinked_teacher_are_rejected(self):
        institution = Institution.objects.get()
        subject = Subject.objects.create(institution=institution, code="MAT", name="Matemática", credits=2, onsite_weekly_hours=2, total_workload=40)
        response = self.client.post(self.cells_url, self.cell(subject=subject.name), format="json", HTTP_IF_MATCH="1")
        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(ScheduledSession.objects.count(), 0)
        self.assertFalse(SubjectOffering.objects.filter(subject=subject).exists())
        stranger = Teacher.objects.create(institution=institution, code="OTHER", name="Outro Docente")
        response = self.client.post(self.cells_url, self.cell(teacher=stranger.name), format="json", HTTP_IF_MATCH="1")
        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(ScheduledSession.objects.count(), 0)

    def test_conflicting_move_keeps_original_block(self):
        self.client.post(self.cells_url, self.cell(), format="json", HTTP_IF_MATCH="1")
        original = self.client.get(self.grid_url).data["sessions"][0]
        second = self.cell(group_id=self.grid["groups"][1]["id"], weekday=2,
                           slot_id=self.grid["slots"][1]["id"], teacher="Beatriz")
        self.assertEqual(self.client.post(self.cells_url, second, format="json", HTTP_IF_MATCH="2").status_code, 200)
        conflict = self.client.post(self.cells_url, self.cell(
            session_id=original["id"], weekday=2, slot_id=self.grid["slots"][1]["id"],
        ), format="json", HTTP_IF_MATCH="3")
        self.assertEqual(conflict.status_code, 409, conflict.data)
        self.assertIn("ROOM_OVERLAP", {item["code"] for item in conflict.data["conflicts"]})
        original_after = ScheduledSession.objects.get(pk=original["id"])
        self.assertEqual((original_after.weekday, original_after.starts_at.strftime("%H:%M")), (1, "17:50"))
