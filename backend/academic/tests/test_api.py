from datetime import time

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from academic.models import (
    AcademicTerm, ClassGroup, Course, Institution, Room, Schedule,
    ScheduledSession, SessionRequirement, Subject, SubjectOffering, Teacher,
    TimeProfile, TimeWindow,
)


class ScheduleApiTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_superuser("admin", "admin@example.test", "temporary-test-password")
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        institution = Institution.objects.create(name="Instituição de teste")
        term = AcademicTerm.objects.create(institution=institution, name="2027.1", starts_on="2027-01-01", ends_on="2027-06-30")
        course = Course.objects.create(institution=institution, code="ADS", name="ADS")
        subject = Subject.objects.create(institution=institution, code="ALG", name="Algoritmos", period_number=1)
        self.night = TimeProfile.objects.create(institution=institution, name="Noite")
        self.teacher = Teacher.objects.create(institution=institution, code="P1", name="Ana")
        self.room = Room.objects.create(institution=institution, code="S1", name="Sala 1")
        group = ClassGroup.objects.create(course=course, term=term, code="ADS-A", period_number=1, time_profile=self.night)
        offering = SubjectOffering.objects.create(group=group, subject=subject, weekly_minutes=200)
        offering.eligible_teachers.add(self.teacher)
        self.requirement = SessionRequirement.objects.create(offering=offering, duration_minutes=100, weekly_count=2)
        self.schedule = Schedule.objects.create(course=course, term=term, time_profile=self.night)
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

    def test_setup_morning_and_night_profiles_is_idempotent(self):
        url = "/api/v1/time-profiles/setup-shifts/"
        first = self.client.post(url, {"institution_id": self.institution.pk}, format="json")
        self.assertEqual(first.status_code, 200, first.data)
        self.assertEqual({item["name"] for item in first.data["profiles"]}, {"Manhã", "Noite"})
        self.assertEqual(TimeProfile.objects.count(), 2)
        self.assertEqual(TimeWindow.objects.filter(profile__isnull=False).count(), 10)
        repeated = self.client.post(url, {"institution_id": self.institution.pk}, format="json")
        self.assertEqual(repeated.status_code, 200, repeated.data)
        self.assertEqual(TimeWindow.objects.filter(profile__isnull=False).count(), 10)

    def test_grid_uses_profile_windows_and_preserves_allocated_lessons(self):
        self.client.post("/api/v1/time-profiles/setup-shifts/", {"institution_id": self.institution.pk}, format="json")
        preview_url = f"/api/v1/schedules/{self.schedule.pk}/profile-slots/"
        preview = self.client.get(preview_url)
        self.assertEqual(preview.status_code, 200, preview.data)
        self.assertEqual({item["name"] for item in preview.data["profiles"]}, {"Noite"})
        self.assertEqual(preview.data["weekdays"], [1, 2, 3, 4, 5])
        self.assertEqual(len(preview.data["slots"]), 4)
        path = f"/api/v1/schedules/{self.schedule.pk}/configure-grid/"
        configured = self.client.post(path, {"use_profiles": True}, format="json", HTTP_IF_MATCH="1")
        self.assertEqual(configured.status_code, 200, configured.data)
        self.assertEqual(configured.data["slot_count"], 4)
        self.requirement.duration_minutes = 120
        self.requirement.save(update_fields=["duration_minutes"])
        lesson = ScheduledSession.objects.create(schedule=self.schedule, requirement=self.requirement, occurrence=1, weekday=1, starts_at=time(17, 50), ends_at=time(19, 50), teacher=self.teacher, room=self.room)
        TimeWindow.objects.filter(profile__name="Manhã").delete()
        updated = self.client.post(path, {"use_profiles": True}, format="json", HTTP_IF_MATCH="2")
        self.assertEqual(updated.status_code, 200, updated.data)
        self.assertEqual(updated.data["slot_count"], 4)
        self.assertTrue(ScheduledSession.objects.filter(pk=lesson.pk).exists())
        grid = self.client.get(f"/api/v1/schedules/{self.schedule.pk}/grid/").data
        self.assertEqual(grid["weekdays"], [1, 2, 3, 4, 5])
        self.assertEqual(grid["slots"][0]["start"], "17:50")

    def test_quick_setup_uses_profiles_when_they_are_active(self):
        self.client.post("/api/v1/time-profiles/setup-shifts/", {"institution_id": self.institution.pk}, format="json")
        response = self.client.post("/api/v1/schedules/quick-setup/", {
            "institution": self.institution.name, "course_code": "ADS", "course_name": "ADS",
            "term": "2027.1", "starts_on": "2027-01-01", "ends_on": "2027-06-30",
            "groups": ["ADS-B"], "group_period": 1, "time_profile_id": self.night.pk, "slots": [{"start": "13:00", "end": "14:00"}], "weekdays": [6],
        }, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        grid = self.client.get(f"/api/v1/schedules/{self.schedule.pk}/grid/").data
        self.assertEqual(len(grid["slots"]), 4)
        self.assertEqual(grid["weekdays"], [1, 2, 3, 4, 5])
        self.assertNotIn("13:00", [slot["start"] for slot in grid["slots"]])

    def test_profile_sync_rejects_change_that_would_strand_a_lesson(self):
        self.client.post("/api/v1/time-profiles/setup-shifts/", {"institution_id": self.institution.pk}, format="json")
        self.requirement.duration_minutes = 120
        self.requirement.save(update_fields=["duration_minutes"])
        lesson = ScheduledSession.objects.create(schedule=self.schedule, requirement=self.requirement, occurrence=1, weekday=1, starts_at=time(17, 50), ends_at=time(19, 50), teacher=self.teacher, room=self.room)
        TimeWindow.objects.filter(profile__name="Noite", weekday=1).update(starts_at=time(18, 50))
        response = self.client.post(f"/api/v1/schedules/{self.schedule.pk}/configure-grid/", {"use_profiles": True}, format="json", HTTP_IF_MATCH="1")
        self.assertEqual(response.status_code, 400, response.data)
        self.assertTrue(ScheduledSession.objects.filter(pk=lesson.pk).exists())
        self.schedule.refresh_from_db()
        self.assertEqual(self.schedule.revision, 1)

    def test_old_grid_slot_outside_active_profile_is_explained(self):
        configured = self.client.post(f"/api/v1/schedules/{self.schedule.pk}/configure-grid/", {
            "slots": [{"start": "17:50", "end": "18:50"}, {"start": "18:50", "end": "19:50"}], "weekdays": [1],
        }, format="json", HTTP_IF_MATCH="1")
        self.assertEqual(configured.status_code, 200, configured.data)
        profile = self.night
        TimeWindow.objects.filter(profile=profile, scope="COURSE", scope_id=self.schedule.course_id).delete()
        TimeWindow.objects.create(institution=self.institution, profile=profile, weekday=1, starts_at=time(18, 30), ends_at=time(21, 30), scope="COURSE", scope_id=self.schedule.course_id)
        grid = self.client.get(f"/api/v1/schedules/{self.schedule.pk}/grid/").data
        self.assertFalse(grid["profile_slots_in_sync"])
        self.assertEqual(grid["available_slot_ids_by_day"]["1"], [])
        result = self.client.post(f"/api/v1/schedules/{self.schedule.pk}/quick-cells/", {
            "group_id": self.requirement.offering.group_id, "weekday": 1, "slot_id": grid["slots"][0]["id"],
            "span": 2, "subject": "Algoritmos", "teacher": "Ana", "room": "S1",
        }, format="json", HTTP_IF_MATCH="2")
        self.assertEqual(result.status_code, 409, result.data)
        self.assertNotIn("cell_index", result.data)
        message = " ".join(item["message"] for item in result.data["conflicts"])
        self.assertIn("Noite 18:30–21:30", message)
        self.assertIn("17:50–19:50", message)

    def test_morning_and_night_have_separate_grids_and_groups(self):
        morning = TimeProfile.objects.create(institution=self.institution, name="Manhã")
        group = ClassGroup.objects.create(course=self.schedule.course, term=self.schedule.term, code="ADS-M", period_number=1, time_profile=morning)
        subject = self.requirement.offering.subject
        SubjectOffering.objects.create(group=group, subject=subject, weekly_minutes=100)
        created = self.client.post("/api/v1/schedules/from-offerings/", {"group_id": group.pk}, format="json")
        self.assertEqual(created.status_code, 201, created.data)
        morning_grid = self.client.get(f"/api/v1/schedules/{created.data['id']}/grid/").data
        night_grid = self.client.get(f"/api/v1/schedules/{self.schedule.pk}/grid/").data
        self.assertEqual([item["id"] for item in morning_grid["groups"]], [group.pk])
        self.assertEqual([item["id"] for item in night_grid["groups"]], [self.requirement.offering.group_id])
        self.assertEqual(Schedule.objects.count(), 2)

    def test_publish_exposes_snapshot_without_login_and_delete_removes_it(self):
        TimeWindow.objects.create(institution=self.institution, weekday=2, starts_at=time(18), ends_at=time(22))
        for occurrence, weekday in ((1, 1), (2, 2)):
            response = self.client.post(f"/api/v1/schedules/{self.schedule.pk}/sessions/", {**self.payload(occurrence), "weekday": weekday}, format="json", HTTP_IF_MATCH=str(occurrence))
            self.assertEqual(response.status_code, 201, response.data)
        published = self.client.post(f"/api/v1/schedules/{self.schedule.pk}/publish/", {}, format="json", HTTP_IF_MATCH="3")
        self.assertEqual(published.status_code, 200, published.data)
        anonymous = APIClient()
        listing = anonymous.get("/api/v1/public/schedules/")
        self.assertEqual(listing.status_code, 200)
        self.assertEqual(len(listing.data), 1)
        detail = anonymous.get(f"/api/v1/public/schedules/{self.schedule.pk}/")
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(len(detail.data["sessions"]), 2)
        second_room = Room.objects.create(institution=self.institution, code="S2", name="Sala 2")
        session = ScheduledSession.objects.first()
        changed = self.client.patch(f"/api/v1/schedules/{self.schedule.pk}/sessions/{session.pk}/", {"room": second_room.pk}, format="json", HTTP_IF_MATCH="4")
        self.assertEqual(changed.status_code, 200, changed.data)
        self.assertTrue(any(item["room"] == "Sala 1" for item in anonymous.get(f"/api/v1/public/schedules/{self.schedule.pk}/").data["sessions"]))
        removed = self.client.delete(f"/api/v1/schedules/{self.schedule.pk}/")
        self.assertEqual(removed.status_code, 204)
        self.assertEqual(anonymous.get(f"/api/v1/public/schedules/{self.schedule.pk}/").status_code, 404)

    def test_publish_rejects_incomplete_schedule(self):
        response = self.client.post(f"/api/v1/schedules/{self.schedule.pk}/publish/", {}, format="json", HTTP_IF_MATCH="1")
        self.assertEqual(response.status_code, 409, response.data)
        self.assertIsNone(Schedule.objects.get(pk=self.schedule.pk).published_version)
        self.assertEqual(APIClient().get("/api/v1/public/schedules/").data, [])

    def test_api_rejects_less_than_eleven_hours_of_teacher_rest(self):
        TimeWindow.objects.create(institution=self.institution, weekday=2, starts_at=time(8), ends_at=time(12))
        path = f"/api/v1/schedules/{self.schedule.pk}/sessions/"
        night = self.client.post(path, {**self.payload(start="20:10", end="21:50"), "weekday": 1}, format="json", HTTP_IF_MATCH="1")
        self.assertEqual(night.status_code, 201, night.data)
        morning = self.client.post(path, {**self.payload(occurrence=2, start="08:40", end="10:20"), "weekday": 2}, format="json", HTTP_IF_MATCH="2")
        self.assertEqual(morning.status_code, 409, morning.data)
        self.assertIn("TEACHER_MIN_REST", {item["code"] for item in morning.data["conflicts"]})
        self.assertEqual(ScheduledSession.objects.count(), 1)
        allowed = self.client.post(path, {**self.payload(occurrence=2, start="08:50", end="10:30"), "weekday": 2}, format="json", HTTP_IF_MATCH="2")
        self.assertEqual(allowed.status_code, 201, allowed.data)

    def test_delete_resource_success(self):
        new_teacher = Teacher.objects.create(institution=self.institution, code="TEMP", name="Professor Temporário")
        response = self.client.delete(f"/api/v1/teachers/{new_teacher.pk}/")
        self.assertEqual(response.status_code, 204)
        self.assertFalse(Teacher.objects.filter(pk=new_teacher.pk).exists())

    def test_delete_unlinked_subject_success(self):
        subject = Subject.objects.create(institution=self.institution, code="TEMP", name="Temporária")
        response = self.client.delete(f"/api/v1/subjects/{subject.pk}/")
        self.assertEqual(response.status_code, 204, response.data)
        self.assertFalse(Subject.objects.filter(pk=subject.pk).exists())

    def test_delete_protected_resource_fails_gracefully(self):
        # Subject is linked to an existing offering
        subject = self.requirement.offering.subject
        response = self.client.delete(f"/api/v1/subjects/{subject.pk}/")
        self.assertEqual(response.status_code, 400)
        self.assertIn("vínculos ativos", str(response.data))
        self.assertTrue(Subject.objects.filter(pk=subject.pk).exists())

    def test_delete_institution_rejected(self):
        response = self.client.delete(f"/api/v1/institutions/{self.institution.pk}/")
        self.assertEqual(response.status_code, 400)
        self.assertIn("não pode ser excluída", str(response.data))
