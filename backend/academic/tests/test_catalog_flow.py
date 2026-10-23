from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from academic.models import ClassGroup, Institution, SessionRequirement, Subject, SubjectOffering, Teacher


class CatalogFlowTests(TestCase):
    def setUp(self):
        user = get_user_model().objects.create_superuser("catalog-admin", "catalog@example.test", "test-password")
        self.client = APIClient()
        self.client.force_authenticate(user)
        self.institution = Institution.objects.create(name="Faculdade")

    def test_subject_credits_offer_and_allocation_use_presence_hours(self):
        subject_response = self.client.post("/api/v1/subjects/", {
            "institution": self.institution.pk, "code": "OO", "name": "Programação OO",
            "credits": 4, "onsite_weekly_hours": 3, "ead_percentage": 25,
        }, format="json")
        self.assertEqual(subject_response.status_code, 201, subject_response.data)
        self.assertEqual(subject_response.data["total_workload"], 80)
        self.assertEqual(subject_response.data["workload_unit"], "CLASS_HOUR")
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
        grid = self.client.get(f"/api/v1/schedules/{setup.data['id']}/grid/").data
        path = f"/api/v1/schedules/{setup.data['id']}/quick-cells/"
        first = self.client.post(path, {"group_id": group.pk, "weekday": 1, "slot_id": grid["slots"][0]["id"], "span": 2,
                                        "subject": "Programação OO", "teacher": "Ana", "room": "H01"}, format="json", HTTP_IF_MATCH="1")
        self.assertEqual(first.status_code, 200, first.data)
        second = self.client.post(path, {"group_id": group.pk, "weekday": 2, "slot_id": grid["slots"][2]["id"], "span": 1,
                                         "subject": "Programação OO", "teacher": "Ana", "room": "H01"}, format="json", HTTP_IF_MATCH="2")
        self.assertEqual(second.status_code, 200, second.data)
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
