from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from academic.models import AcademicTerm, ClassGroup, Course, Institution, SessionRequirement, Subject, SubjectOffering, Teacher


class CatalogFlowTests(TestCase):
    def setUp(self):
        user = get_user_model().objects.create_superuser("catalog-admin", "catalog@example.test", "test-password")
        self.client = APIClient()
        self.client.force_authenticate(user)
        self.institution = Institution.objects.create(name="Faculdade")

    def test_subject_credits_offer_and_allocation_use_presence_hours(self):
        subject_response = self.client.post("/api/v1/subjects/", {
            "institution": self.institution.pk, "code": "OO", "name": "Programação OO",
            "credits": 4, "onsite_weekly_hours": 3, "ead_weekly_hours": 1,
        }, format="json")
        self.assertEqual(subject_response.status_code, 201, subject_response.data)
        self.assertEqual(subject_response.data["total_workload"], 80)
        self.assertEqual(subject_response.data["workload_unit"], "CLASS_HOUR")
        self.assertEqual(subject_response.data["ead_weekly_hours"], 1)
        setup = self.client.post("/api/v1/schedules/quick-setup/", {
            "institution": "Faculdade", "course_code": "ADS", "course_name": "ADS",
            "term": "2027.1", "starts_on": "2027-01-01", "ends_on": "2027-06-30",
            "groups": ["1º A"], "weekdays": [1, 2, 3, 4, 5],
            "slots": [{"start": "17:50", "end": "18:50"}, {"start": "18:50", "end": "19:50"}, {"start": "19:50", "end": "20:50"}],
        }, format="json")
        self.assertEqual(setup.status_code, 201, setup.data)
        teacher = Teacher.objects.create(institution=self.institution, code="ANA", name="Ana")
        group = ClassGroup.objects.get(code="1º A")
        offered = self.client.post(f"/api/v1/subjects/{subject_response.data['id']}/offer/", {
            "group_id": group.pk, "teacher_id": teacher.pk, "block_hours": 2,
        }, format="json")
        self.assertEqual(offered.status_code, 201, offered.data)
        offering = SubjectOffering.objects.get(pk=offered.data["id"])
        self.assertEqual(offering.weekly_minutes, 180)
        self.assertEqual(set(SessionRequirement.objects.filter(offering=offering).values_list("duration_minutes", "weekly_count")), {(120, 1), (60, 1)})
        repeated = self.client.post(f"/api/v1/subjects/{subject_response.data['id']}/offer/", {
            "group_id": group.pk, "teacher_id": teacher.pk, "block_hours": 1,
        }, format="json")
        self.assertEqual(repeated.status_code, 400, repeated.data)
        self.assertEqual(SubjectOffering.objects.filter(group=group, subject_id=subject_response.data["id"]).count(), 1)
        self.assertEqual(SessionRequirement.objects.filter(offering=offering).count(), 2)
        extra_requirement = self.client.post("/api/v1/session-requirements/", {
            "offering": offering.pk, "duration_minutes": 60, "weekly_count": 1,
        }, format="json")
        self.assertEqual(extra_requirement.status_code, 400, extra_requirement.data)
        grid = self.client.get(f"/api/v1/schedules/{setup.data['id']}/grid/").data
        path = f"/api/v1/schedules/{setup.data['id']}/quick-cells/"
        first = self.client.post(path, {"group_id": group.pk, "weekday": 1, "slot_id": grid["slots"][0]["id"], "span": 2,
                                        "subject": "Programação OO", "teacher": "Ana", "room": "H01"}, format="json", HTTP_IF_MATCH="1")
        self.assertEqual(first.status_code, 200, first.data)
        second = self.client.post(path, {"group_id": group.pk, "weekday": 2, "slot_id": grid["slots"][2]["id"], "span": 1,
                                         "subject": "Programação OO", "teacher": "Ana", "room": "H01"}, format="json", HTTP_IF_MATCH="2")
        self.assertEqual(second.status_code, 200, second.data)
        ead_hour = self.client.post(path, {"group_id": group.pk, "weekday": 3, "slot_id": grid["slots"][0]["id"], "span": 1,
                                           "subject": "Programação OO", "teacher": "Ana", "room": "H01"}, format="json", HTTP_IF_MATCH="3")
        self.assertEqual(ead_hour.status_code, 400, ead_hour.data)
        second_teacher = Teacher.objects.create(institution=self.institution, code="BIA", name="Bia")
        linked = self.client.post(f"/api/v1/subjects/{subject_response.data['id']}/offer/", {
            "group_id": group.pk, "teacher_id": second_teacher.pk, "block_hours": 1,
        }, format="json")
        self.assertEqual(linked.status_code, 200, linked.data)
        self.assertEqual(SessionRequirement.objects.filter(offering=offering).count(), 2)
        self.assertEqual(SubjectOffering.objects.filter(group=group, subject_id=subject_response.data["id"]).count(), 1)
        validated = self.client.post(f"/api/v1/schedules/{setup.data['id']}/validate/", {}, format="json")
        self.assertTrue(validated.data["valid"], validated.data)

    def test_batch_import_is_atomic_and_does_not_set_teacher_minute_limits(self):
        url = "/api/v1/batch-import/"
        invalid = self.client.post(url, {"resource": "subjects", "rows": [
            {"code": "MAT", "name": "Matemática", "credits": 4, "onsite_weekly_hours": 4},
            {"code": "ERR", "name": "Erro", "credits": 2, "onsite_weekly_hours": 3},
        ]}, format="json")
        self.assertEqual(invalid.status_code, 400, invalid.data)
        self.assertEqual(Subject.objects.count(), 0)
        imported = self.client.post(url, {"resource": "teachers", "rows": [
            {"code": "P1", "name": "Ana"}, {"code": "P2", "name": "Bruno"},
        ]}, format="json")
        self.assertEqual(imported.status_code, 200, imported.data)
        self.assertEqual(imported.data["created"], 2)
        self.assertTrue(all(value is None for value in Teacher.objects.values_list("max_weekly_minutes", flat=True)))

    def test_subject_rejects_hours_above_credits_and_old_percentage_import(self):
        invalid = self.client.post("/api/v1/subjects/", {
            "institution": self.institution.pk, "code": "BAD", "name": "Inconsistente",
            "credits": 4, "onsite_weekly_hours": 3, "ead_weekly_hours": 2,
        }, format="json")
        self.assertEqual(invalid.status_code, 400, invalid.data)
        old_api = self.client.post("/api/v1/subjects/", {
            "institution": self.institution.pk, "code": "OLDAPI", "name": "Modelo antigo",
            "credits": 4, "onsite_weekly_hours": 3, "ead_percentage": 25,
        }, format="json")
        self.assertEqual(old_api.status_code, 400, old_api.data)
        old_csv = self.client.post("/api/v1/batch-import/", {"resource": "subjects", "rows": [
            {"code": "OLD", "name": "Modelo antigo", "credits": 4, "onsite_weekly_hours": 3, "ead_percentage": 25},
        ]}, format="json")
        self.assertEqual(old_csv.status_code, 400, old_csv.data)

    def test_bulk_teacher_assignment_and_open_schedule_from_offers(self):
        course = Course.objects.create(institution=self.institution, code="ADS", name="ADS")
        term = AcademicTerm.objects.create(institution=self.institution, name="2027.1", starts_on="2027-01-01", ends_on="2027-06-30")
        group = ClassGroup.objects.create(course=course, term=term, code="1A")
        teacher = Teacher.objects.create(institution=self.institution, code="ANA", name="Ana")
        first = Subject.objects.create(institution=self.institution, code="BD", name="Banco de Dados", credits=4, onsite_weekly_hours=3, ead_weekly_hours=1)
        second = Subject.objects.create(institution=self.institution, code="WEB", name="Web", credits=2, onsite_weekly_hours=2)
        schedule_url = "/api/v1/schedules/from-offerings/"
        self.assertEqual(self.client.post(schedule_url, {"group_id": group.pk}, format="json").status_code, 400)
        url = "/api/v1/subject-offerings/bulk-assign/"
        invalid = self.client.post(url, {"group_id": group.pk, "items": [
            {"subject_id": first.pk, "teacher_id": teacher.pk},
            {"subject_id": second.pk, "teacher_id": 999999},
        ]}, format="json")
        self.assertEqual(invalid.status_code, 404)
        self.assertEqual(SubjectOffering.objects.count(), 0)
        saved = self.client.post(url, {"group_id": group.pk, "items": [
            {"subject_id": first.pk, "teacher_id": teacher.pk},
            {"subject_id": second.pk, "teacher_id": teacher.pk},
        ]}, format="json")
        self.assertEqual(saved.status_code, 201, saved.data)
        self.assertEqual(saved.data["created"], 2)
        self.assertEqual(SubjectOffering.objects.count(), 2)
        self.assertEqual(SessionRequirement.objects.count(), 3)
        duplicate = self.client.post(url, {"group_id": group.pk, "items": [{"subject_id": first.pk, "teacher_id": teacher.pk}]}, format="json")
        self.assertEqual(duplicate.status_code, 400, duplicate.data)
        opened = self.client.post(schedule_url, {"group_id": group.pk}, format="json")
        self.assertEqual(opened.status_code, 201, opened.data)
        grid = self.client.get(f"/api/v1/schedules/{opened.data['id']}/grid/").data
        self.assertEqual(len(grid["offerings"]), 2)
        self.assertEqual(grid["sessions"], [])
        self.assertFalse(Subject.objects.filter(code="OLD").exists())

    def test_batch_offerings_resolve_group_within_selected_term(self):
        course = Course.objects.create(institution=self.institution, code="ADS", name="ADS")
        term = AcademicTerm.objects.create(institution=self.institution, name="2027.1", starts_on="2027-01-01", ends_on="2027-06-30")
        ClassGroup.objects.create(course=course, term=term, code="P1", name="1º período A")
        Subject.objects.create(institution=self.institution, code="OO", name="Programação OO", credits=4,
                               onsite_weekly_hours=4, total_workload=80)
        Teacher.objects.create(institution=self.institution, code="ANA", name="Ana")
        response = self.client.post("/api/v1/batch-import/", {"resource": "offerings", "term_id": term.pk, "rows": [
            {"group_code": "P1", "subject_code": "OO", "teacher_code": "ANA", "block_hours": 2},
        ]}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["created"], 1)
        self.assertEqual(SubjectOffering.objects.count(), 1)
        self.assertEqual(list(SessionRequirement.objects.values_list("duration_minutes", "weekly_count")), [(120, 2)])
        repeated = self.client.post("/api/v1/batch-import/", {"resource": "offerings", "term_id": term.pk, "rows": [
            {"group_code": "P1", "subject_code": "OO", "teacher_code": "ANA", "block_hours": 1},
        ]}, format="json")
        self.assertEqual(repeated.status_code, 400, repeated.data)
        self.assertEqual(SubjectOffering.objects.count(), 1)
        self.assertEqual(list(SessionRequirement.objects.values_list("duration_minutes", "weekly_count")), [(120, 2)])
