from datetime import time
from types import SimpleNamespace

from django.test import TestCase

from academic.models import (
    AcademicTerm, ClassGroup, Course, Institution, Room, Schedule,
    ScheduledSession, SessionRequirement, Subject, SubjectOffering,
    Teacher, TimeBlock, TimeWindow, Scope,
)
from academic.scheduling import candidate_starts, overlaps, validate_session


class CandidateSlotTests(TestCase):
    def test_end_is_inclusive_for_fitting_candidate(self):
        window = SimpleNamespace(starts_at=time(7, 50), ends_at=time(9, 30))
        self.assertEqual(candidate_starts(window, 100, 10), [470])

    def test_block_removes_crossing_candidate(self):
        window = SimpleNamespace(starts_at=time(8), ends_at=time(10))
        block = SimpleNamespace(starts_at=time(8, 45), ends_at=time(9))
        self.assertEqual(candidate_starts(window, 60, 30, [block]), [540])

    def test_touching_half_open_intervals_do_not_overlap(self):
        self.assertFalse(overlaps(480, 540, 540, 600))


class AllocationValidationTests(TestCase):
    def setUp(self):
        self.institution = Institution.objects.create(name="Instituição de teste")
        self.term = AcademicTerm.objects.create(institution=self.institution, name="2027.1", starts_on="2027-01-01", ends_on="2027-06-30")
        self.course = Course.objects.create(institution=self.institution, code="ADS", name="ADS")
        self.subject = Subject.objects.create(institution=self.institution, code="ALG", name="Algoritmos")
        self.teacher = Teacher.objects.create(institution=self.institution, code="P1", name="Ana")
        self.room = Room.objects.create(institution=self.institution, code="S1", name="Sala 1")
        self.group = ClassGroup.objects.create(course=self.course, term=self.term, code="ADS-A")
        self.offering = SubjectOffering.objects.create(group=self.group, subject=self.subject)
        self.offering.eligible_teachers.add(self.teacher)
        self.requirement = SessionRequirement.objects.create(offering=self.offering, duration_minutes=100, weekly_count=2)
        self.schedule = Schedule.objects.create(course=self.course, term=self.term)
        TimeWindow.objects.create(institution=self.institution, weekday=1, starts_at=time(18), ends_at=time(22))

    def session(self, occurrence, start, end, room=None):
        return ScheduledSession.objects.create(schedule=self.schedule, requirement=self.requirement, occurrence=occurrence, weekday=1, starts_at=start, ends_at=end, teacher=self.teacher, room=room or self.room)

    def test_teacher_and_room_conflicts_are_reported(self):
        self.session(1, time(19), time(20, 40))
        second = self.session(2, time(20), time(21, 40))
        codes = {item["code"] for item in validate_session(second)}
        self.assertTrue({"TEACHER_OVERLAP", "ROOM_OVERLAP", "GROUP_OVERLAP"}.issubset(codes))

    def test_touching_sessions_are_valid(self):
        self.session(1, time(18), time(19, 40))
        second = self.session(2, time(19, 40), time(21, 20))
        self.assertEqual(validate_session(second), [])

    def test_block_rejects_crossing_session(self):
        TimeBlock.objects.create(institution=self.institution, weekday=1, starts_at=time(19), ends_at=time(19, 15), reason="Intervalo")
        item = self.session(1, time(18), time(19, 40))
        self.assertIn("TIME_BLOCK", {conflict["code"] for conflict in validate_session(item)})

    def test_specific_teacher_window_restricts_global_window(self):
        TimeWindow.objects.create(institution=self.institution, weekday=1, starts_at=time(20), ends_at=time(22), scope=Scope.TEACHER, scope_id=self.teacher.pk)
        item = self.session(1, time(18), time(19, 40))
        self.assertIn("OUTSIDE_WINDOW", {conflict["code"] for conflict in validate_session(item)})

    def test_teacher_weekly_limit_is_hard_constraint(self):
        self.teacher.max_weekly_minutes = 150
        self.teacher.save(update_fields=["max_weekly_minutes"])
        self.session(1, time(18), time(19, 40))
        second = self.session(2, time(20), time(21, 40))
        self.assertIn("TEACHER_WEEKLY_LIMIT", {conflict["code"] for conflict in validate_session(second)})

