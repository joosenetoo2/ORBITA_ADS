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

    def session(self, occurrence, start, end, room=None, weekday=1):
        return ScheduledSession.objects.create(schedule=self.schedule, requirement=self.requirement, occurrence=occurrence, weekday=weekday, starts_at=start, ends_at=end, teacher=self.teacher, room=room or self.room)

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

    def test_room_environment_must_match_subject_requirement(self):
        self.subject.required_room_type = Subject.RoomType.LABORATORY
        self.subject.save(update_fields=["required_room_type"])
        item = self.session(1, time(18), time(19, 40))
        conflicts = validate_session(item)
        self.assertIn("ROOM_TYPE_MISMATCH", {conflict["code"] for conflict in conflicts})
        self.assertIn("Laboratório", next(conflict["message"] for conflict in conflicts if conflict["code"] == "ROOM_TYPE_MISMATCH"))
        self.room.room_type = Room.Type.LABORATORY
        self.room.save(update_fields=["room_type"])
        self.assertNotIn("ROOM_TYPE_MISMATCH", {conflict["code"] for conflict in validate_session(item)})

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

    def test_teacher_needs_eleven_hours_between_night_and_next_morning(self):
        TimeWindow.objects.create(institution=self.institution, weekday=2, starts_at=time(8), ends_at=time(12))
        night = self.session(1, time(20, 10), time(21, 50))
        too_early = self.session(2, time(8, 40), time(10, 20), weekday=2)
        self.assertIn("TEACHER_MIN_REST", {item["code"] for item in validate_session(too_early)})
        self.assertIn("TEACHER_MIN_REST", {item["code"] for item in validate_session(night)})
        too_early.starts_at, too_early.ends_at = time(8, 50), time(10, 30)
        too_early.save(update_fields=["starts_at", "ends_at"])
        self.assertNotIn("TEACHER_MIN_REST", {item["code"] for item in validate_session(too_early)})

    def test_teacher_rest_wraps_sunday_to_monday(self):
        TimeWindow.objects.create(institution=self.institution, weekday=7, starts_at=time(20), ends_at=time(22))
        sunday = self.session(1, time(20, 10), time(21, 50), weekday=7)
        monday = self.session(2, time(8), time(9, 40))
        self.assertIn("TEACHER_MIN_REST", {item["code"] for item in validate_session(monday)})
        self.assertIn("TEACHER_MIN_REST", {item["code"] for item in validate_session(sunday)})

    def test_five_continuous_hours_require_intraday_break(self):
        self.requirement.duration_minutes = 300
        self.requirement.save(update_fields=["duration_minutes"])
        TimeWindow.objects.create(institution=self.institution, weekday=1, starts_at=time(8), ends_at=time(13))
        item = self.session(1, time(8), time(13))
        self.assertIn("INTRADAY_BREAK", {issue["code"] for issue in validate_session(item)})

