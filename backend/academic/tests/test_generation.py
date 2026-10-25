from datetime import time

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from academic import generation
from academic.catalog_flow import offer_subject
from academic.models import (
    AcademicTerm, ClassGroup, Course, GenerationCandidate, Institution, Room,
    Schedule, ScheduleSlot, ScheduledSession, Subject, Teacher, TeacherEvent,
    TimeProfile, TimeWindow,
)


class GenerationTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_superuser("generator", "generator@example.test", "password")
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        institution = Institution.objects.create(name="Faculdade")
        term = AcademicTerm.objects.create(institution=institution, name="2027.1", starts_on="2027-01-01", ends_on="2027-06-30")
        course = Course.objects.create(institution=institution, code="ADS", name="ADS")
        profile = TimeProfile.objects.create(institution=institution, name="Noite")
        self.group = ClassGroup.objects.create(course=course, term=term, code="P1-N", period_number=1, time_profile=profile, student_count=30)
        subject = Subject.objects.create(institution=institution, code="BD", name="Banco de Dados", period_number=1,
                                         credits=3, onsite_weekly_hours=3, total_workload=60)
        self.teacher = Teacher.objects.create(institution=institution, code="P1", name="Ana")
        self.offering, _ = offer_subject(subject, self.group, self.teacher)
        self.room = Room.objects.create(institution=institution, code="S1", name="Sala 1", capacity=40)
        self.schedule = Schedule.objects.create(course=course, term=term, time_profile=profile)
        for index, hour in enumerate((18, 19, 20)):
            ScheduleSlot.objects.create(schedule=self.schedule, display_order=index, starts_at=time(hour), ends_at=time(hour + 1))
        for day in (1, 2):
            TimeWindow.objects.create(institution=institution, profile=profile, weekday=day, starts_at=time(18), ends_at=time(21))

    def test_generate_and_apply_split_three_hours(self):
        response = self.client.post(f"/api/v1/schedules/{self.schedule.pk}/generation/", {"mode": "FILL", "time_limit_seconds": 4},
                                    format="json", HTTP_IF_MATCH="1")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertIn(response.data["status"], {"FEASIBLE", "OPTIMAL"})
        self.assertEqual(ScheduledSession.objects.count(), 0)
        candidate = response.data["candidates"][0]
        self.assertEqual(candidate["metrics"]["hours"], 3)
        self.assertEqual(sum(int(item["end"][:2]) - int(item["start"][:2]) for item in candidate["allocations"]), 3)
        applied = self.client.post(f"/api/v1/generation-candidates/{candidate['id']}/apply/", {}, format="json", HTTP_IF_MATCH="1")
        self.assertEqual(applied.status_code, 200, applied.data)
        self.assertEqual(ScheduledSession.objects.count(), 2)
        self.assertEqual(self.schedule.sessions.count(), 2)
        stale = self.client.post(f"/api/v1/generation-candidates/{candidate['id']}/apply/", {}, format="json", HTTP_IF_MATCH="1")
        self.assertEqual(stale.status_code, 409)

    def test_preflight_reports_missing_compatible_room(self):
        self.room.capacity = 20
        self.room.save()
        response = self.client.get(f"/api/v1/schedules/{self.schedule.pk}/generation/preflight/")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.data["ready"])
        self.assertIn("NO_COMPATIBLE_ROOM", {item["code"] for item in response.data["issues"]})

    def test_teacher_event_blocks_candidate(self):
        TeacherEvent.objects.create(teacher=self.teacher, term=self.schedule.term, title="Orientação",
                                    weekday=1, starts_at=time(18), ends_at=time(21))
        TeacherEvent.objects.create(teacher=self.teacher, term=self.schedule.term, title="Coordenação",
                                    weekday=2, starts_at=time(18), ends_at=time(21))
        report = generation.preflight(self.schedule)
        self.assertFalse(report["ready"])
        self.assertIn("TEACHER_UNAVAILABLE", {item["code"] for item in report["issues"]})

    def test_preflight_reports_shared_room_shortage(self):
        for index in (2, 3):
            group = ClassGroup.objects.create(course=self.schedule.course, term=self.schedule.term,
                                              code=f"P1-{index}", period_number=1,
                                              time_profile=self.schedule.time_profile, student_count=30)
            teacher = Teacher.objects.create(institution=self.schedule.course.institution,
                                             code=f"P{index}", name=f"Docente {index}")
            offer_subject(self.offering.subject, group, teacher)
        report = generation.preflight(self.schedule)
        self.assertFalse(report["ready"])
        self.assertIn("ROOM_CAPACITY_SHORTAGE", {item["code"] for item in report["issues"]})

    def test_removed_room_cannot_be_recreated_when_applying(self):
        state, _, proposals = generation.solve(self.schedule, time_limit=4, alternatives=1)
        self.assertIn(state, {"FEASIBLE", "OPTIMAL"})
        from academic.models import GenerationJob
        job = GenerationJob.objects.create(schedule=self.schedule, requested_by=self.user,
                                           base_revision=1, status=state)
        candidate = GenerationCandidate.objects.create(job=job, **proposals[0])
        self.room.is_active = False
        self.room.save(update_fields=["is_active"])
        response = self.client.post(f"/api/v1/generation-candidates/{candidate.pk}/apply/", {},
                                    format="json", HTTP_IF_MATCH="1")
        self.assertEqual(response.status_code, 409, response.data)
        self.assertEqual(ScheduledSession.objects.count(), 0)

    def test_night_commitment_excludes_next_morning_before_eleven_hours(self):
        institution = self.schedule.course.institution
        morning = TimeProfile.objects.create(institution=institution, name="Manhã")
        group = ClassGroup.objects.create(course=self.schedule.course, term=self.schedule.term,
                                          code="P1-M", period_number=1, time_profile=morning, student_count=30)
        offer_subject(self.offering.subject, group, self.teacher)
        schedule = Schedule.objects.create(course=self.schedule.course, term=self.schedule.term, time_profile=morning)
        for index, hour in enumerate((8, 9, 10)):
            ScheduleSlot.objects.create(schedule=schedule, display_order=index,
                                        starts_at=time(hour), ends_at=time(hour + 1))
        for day in (2, 3):
            TimeWindow.objects.create(institution=institution, profile=morning, weekday=day,
                                      starts_at=time(8), ends_at=time(11))
        TeacherEvent.objects.create(teacher=self.teacher, term=self.schedule.term,
                                    title="Administração noturna", weekday=1,
                                    starts_at=time(21), ends_at=time(22))
        state, report, candidates = generation.solve(schedule, time_limit=4, alternatives=1)
        self.assertTrue(report["ready"], report)
        self.assertIn(state, {"FEASIBLE", "OPTIMAL"})
        self.assertTrue(all(item["start"] >= "09:00" for item in candidates[0]["allocations"]
                            if item["weekday"] == 2))

    def test_existing_locked_session_is_preserved_when_rearranging(self):
        slot = self.schedule.slots.first()
        from academic.quick_grid import save_cell
        fixed = save_cell(self.schedule, {"group_id": self.group.pk, "weekday": 1, "slot_id": slot.pk,
                                         "span": 1, "subject": "Banco de Dados", "teacher": "Ana", "room": "Sala 1"})
        fixed.is_locked = True
        fixed.save(update_fields=["is_locked"])
        state, report, candidates = generation.solve(self.schedule, "REARRANGE", time_limit=4, alternatives=1)
        self.assertTrue(report["ready"], report)
        self.assertIn(state, {"FEASIBLE", "OPTIMAL"})
        self.assertEqual(sum(item["end"] != item["start"] for item in candidates[0]["allocations"]), 1)

    def test_rearrange_apply_keeps_locked_and_replaces_unlocked(self):
        from academic.models import GenerationJob
        from academic.quick_grid import save_cell
        slot = self.schedule.slots.first()
        fixed = save_cell(self.schedule, {"group_id": self.group.pk, "weekday": 1, "slot_id": slot.pk,
                                         "span": 1, "subject": "Banco de Dados", "teacher": "Ana", "room": "Sala 1"})
        fixed.is_locked = True
        fixed.save(update_fields=["is_locked"])
        movable = save_cell(self.schedule, {"group_id": self.group.pk, "weekday": 2, "slot_id": slot.pk,
                                           "span": 1, "subject": "Banco de Dados", "teacher": "Ana", "room": "Sala 1"})
        state, _, proposals = generation.solve(self.schedule, "REARRANGE", time_limit=4, alternatives=1)
        self.assertIn(state, {"FEASIBLE", "OPTIMAL"})
        job = GenerationJob.objects.create(schedule=self.schedule, requested_by=self.user,
                                           base_revision=1, mode="REARRANGE", status=state)
        candidate = GenerationCandidate.objects.create(job=job, **proposals[0])
        revision = generation.apply_candidate(candidate, 1, self.user)
        self.assertEqual(revision, 2)
        self.assertTrue(ScheduledSession.objects.filter(pk=fixed.pk, is_locked=True).exists())
        self.assertFalse(ScheduledSession.objects.filter(pk=movable.pk).exists())
        self.assertEqual(sum((s.ends_at.hour - s.starts_at.hour) for s in self.schedule.sessions.all()), 3)
