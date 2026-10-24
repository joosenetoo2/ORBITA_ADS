from datetime import time

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from academic.models import (
    AcademicTerm, ClassGroup, Course, Institution, Room, Schedule,
    ScheduledSession, SessionRequirement, Subject, SubjectOffering,
    Teacher, TeacherEvent, TimeProfile, TimeWindow,
)
from academic.scheduling import validate_session


class TeacherEventTests(TestCase):
    def setUp(self):
        user = get_user_model().objects.create_superuser("agenda-admin", "agenda@example.test", "password")
        self.client = APIClient()
        self.client.force_authenticate(user)
        institution = Institution.objects.create(name="Faculdade")
        self.term = AcademicTerm.objects.create(institution=institution, name="2027.1", starts_on="2027-01-01", ends_on="2027-06-30")
        course = Course.objects.create(institution=institution, code="ADS", name="ADS")
        self.teacher = Teacher.objects.create(institution=institution, code="PROF", name="Professora Ana")
        self.room = Room.objects.create(institution=institution, code="S1", name="Sala 1")
        subject = Subject.objects.create(institution=institution, code="ALG", name="Algoritmos")
        group = ClassGroup.objects.create(course=course, term=self.term, code="1A")
        offering = SubjectOffering.objects.create(group=group, subject=subject)
        offering.eligible_teachers.add(self.teacher)
        self.requirement = SessionRequirement.objects.create(offering=offering, duration_minutes=60, weekly_count=1)
        self.schedule = Schedule.objects.create(course=course, term=self.term)
        TimeWindow.objects.create(institution=institution, weekday=1, starts_at=time(17, 50), ends_at=time(21, 50))

    def event(self, **overrides):
        return {
            "teacher": self.teacher.pk, "term": self.term.pk, "title": "Orientação administrativa",
            "weekday": 2, "starts_at": "14:00", "ends_at": "16:00", "location": "Coordenação",
            **overrides,
        }

    def lesson(self, weekday=1, start=time(20, 50), end=time(21, 50)):
        return ScheduledSession.objects.create(
            schedule=self.schedule, requirement=self.requirement, weekday=weekday,
            starts_at=start, ends_at=end, teacher=self.teacher, room=self.room,
        )

    def test_afternoon_event_is_only_in_teacher_agenda(self):
        created = self.client.post("/api/v1/teacher-events/", self.event(), format="json")
        self.assertEqual(created.status_code, 201, created.data)
        agenda = self.client.get(f"/api/v1/teacher-agenda/?term_id={self.term.pk}")
        self.assertEqual(agenda.status_code, 200, agenda.data)
        self.assertEqual(len(agenda.data["items"]), 1)
        self.assertEqual(agenda.data["items"][0]["kind"], "EVENT")
        self.assertEqual(agenda.data["items"][0]["start"], "14:00")
        grid = self.client.get(f"/api/v1/schedules/{self.schedule.pk}/grid/")
        self.assertEqual(grid.status_code, 200, grid.data)
        self.assertEqual(grid.data["sessions"], [])
        self.assertEqual(self.client.get("/api/v1/public/schedules/").data, [])

    def test_event_conflicts_with_existing_lesson_and_rolls_back(self):
        self.lesson(weekday=2, start=time(14, 30), end=time(15, 30))
        response = self.client.post("/api/v1/teacher-events/", self.event(), format="json")
        self.assertEqual(response.status_code, 409, response.data)
        self.assertIn("TEACHER_OVERLAP", {item["code"] for item in response.data["conflicts"]})
        self.assertEqual(TeacherEvent.objects.count(), 0)

    def test_existing_event_blocks_new_lesson_and_another_event(self):
        self.client.post("/api/v1/teacher-events/", self.event(), format="json")
        overlapping = self.client.post("/api/v1/teacher-events/", self.event(title="Reunião", starts_at="15:00", ends_at="17:00"), format="json")
        self.assertEqual(overlapping.status_code, 409, overlapping.data)
        self.assertEqual(TeacherEvent.objects.count(), 1)
        lesson = self.lesson(weekday=2, start=time(14, 30), end=time(15, 30))
        self.assertIn("TEACHER_EVENT_OVERLAP", {item["code"] for item in validate_session(lesson)})

    def test_eleven_hour_rest_between_night_lesson_and_event(self):
        self.lesson()
        early = self.client.post("/api/v1/teacher-events/", self.event(starts_at="08:00", ends_at="09:00"), format="json")
        self.assertEqual(early.status_code, 409, early.data)
        self.assertIn("TEACHER_MIN_REST", {item["code"] for item in early.data["conflicts"]})
        permitted = self.client.post("/api/v1/teacher-events/", self.event(starts_at="08:50", ends_at="09:50"), format="json")
        self.assertEqual(permitted.status_code, 201, permitted.data)

    def test_edit_and_delete_event(self):
        created = self.client.post("/api/v1/teacher-events/", self.event(), format="json")
        event_id = created.data["id"]
        changed = self.client.patch(f"/api/v1/teacher-events/{event_id}/", {"title": "Orientação de estágio"}, format="json")
        self.assertEqual(changed.status_code, 200, changed.data)
        self.assertEqual(changed.data["title"], "Orientação de estágio")
        removed = self.client.delete(f"/api/v1/teacher-events/{event_id}/")
        self.assertEqual(removed.status_code, 204)
        self.assertFalse(TeacherEvent.objects.filter(pk=event_id).exists())

    def test_agenda_combines_schedules_and_reports_weekly_balance(self):
        self.lesson(weekday=1, start=time(18), end=time(19))
        morning = TimeProfile.objects.create(institution=self.term.institution, name="Manhã")
        morning_schedule = Schedule.objects.create(course=self.schedule.course, term=self.term, time_profile=morning)
        morning_group = ClassGroup.objects.create(course=self.schedule.course, term=self.term, code="1M", time_profile=morning)
        offering = SubjectOffering.objects.create(group=morning_group, subject=self.requirement.offering.subject)
        offering.eligible_teachers.add(self.teacher)
        morning_requirement = SessionRequirement.objects.create(offering=offering, duration_minutes=120, weekly_count=1)
        ScheduledSession.objects.create(schedule=morning_schedule, requirement=morning_requirement,
                                        weekday=3, starts_at=time(8), ends_at=time(10), teacher=self.teacher, room=self.room)
        event = self.client.post("/api/v1/teacher-events/", self.event(starts_at="14:00", ends_at="16:00"), format="json")
        self.assertEqual(event.status_code, 201, event.data)
        response = self.client.get(f"/api/v1/teacher-agenda/?term_id={self.term.pk}")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual({item["schedule_id"] for item in response.data["items"]}, {self.schedule.pk, morning_schedule.pk, None})
        summary = response.data["summaries"][0]
        self.assertEqual((summary["lesson_blocks"], summary["lesson_minutes"], summary["event_count"], summary["event_minutes"], summary["total_minutes"]), (2, 180, 1, 120, 300))
        self.assertEqual(summary["issues"], [])

    def test_intraday_break_thresholds_apply_to_teacher_events(self):
        first = self.client.post("/api/v1/teacher-events/", self.event(weekday=3, starts_at="08:00", ends_at="12:00"), format="json")
        self.assertEqual(first.status_code, 201, first.data)
        no_break = self.client.post("/api/v1/teacher-events/", self.event(weekday=3, starts_at="12:00", ends_at="13:00"), format="json")
        self.assertEqual(no_break.status_code, 409, no_break.data)
        self.assertIn("INTRADAY_BREAK", {issue["code"] for issue in no_break.data["conflicts"]})
        fifteen = self.client.post("/api/v1/teacher-events/", self.event(weekday=3, starts_at="12:15", ends_at="13:00"), format="json")
        self.assertEqual(fifteen.status_code, 201, fifteen.data)
        needs_hour = self.client.post("/api/v1/teacher-events/", self.event(weekday=3, starts_at="13:00", ends_at="14:30"), format="json")
        self.assertEqual(needs_hour.status_code, 409, needs_hour.data)
        self.assertIn("INTRADAY_BREAK", {issue["code"] for issue in needs_hour.data["conflicts"]})
        one_hour = self.client.post("/api/v1/teacher-events/", self.event(weekday=3, starts_at="14:00", ends_at="16:00"), format="json")
        self.assertEqual(one_hour.status_code, 201, one_hour.data)

    def test_interday_rest_checks_lessons_in_different_grades(self):
        self.lesson(weekday=1, start=time(20, 50), end=time(21, 50))
        morning = TimeProfile.objects.create(institution=self.term.institution, name="Manhã")
        morning_schedule = Schedule.objects.create(course=self.schedule.course, term=self.term, time_profile=morning)
        group = ClassGroup.objects.create(course=self.schedule.course, term=self.term, code="1M", time_profile=morning)
        offering = SubjectOffering.objects.create(group=group, subject=self.requirement.offering.subject)
        offering.eligible_teachers.add(self.teacher)
        requirement = SessionRequirement.objects.create(offering=offering, duration_minutes=60, weekly_count=1)
        morning_lesson = ScheduledSession.objects.create(schedule=morning_schedule, requirement=requirement,
                                                          weekday=2, starts_at=time(8), ends_at=time(9), teacher=self.teacher, room=self.room)
        self.assertIn("TEACHER_MIN_REST", {issue["code"] for issue in validate_session(morning_lesson)})
        morning_lesson.starts_at, morning_lesson.ends_at = time(8, 50), time(9, 50)
        morning_lesson.save(update_fields=["starts_at", "ends_at"])
        self.assertNotIn("TEACHER_MIN_REST", {issue["code"] for issue in validate_session(morning_lesson)})
