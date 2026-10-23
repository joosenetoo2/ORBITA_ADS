import json

from django.contrib.auth import get_user_model
from django.test import Client, TestCase


class ApplicationLoginTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="coordenador", password="secure-test-password", first_name="Maria")
        self.client = Client(enforce_csrf_checks=True)

    def post(self, path, body, csrf=True):
        headers = {"HTTP_X_CSRFTOKEN": self.client.cookies["csrftoken"].value} if csrf else {}
        return self.client.post(path, data=json.dumps(body), content_type="application/json", **headers)

    def test_session_requires_login_and_login_requires_csrf(self):
        initial = self.client.get("/api/v1/auth/session/")
        self.assertEqual(initial.status_code, 200)
        self.assertFalse(initial.json()["authenticated"])
        self.assertIn("csrftoken", self.client.cookies)
        self.assertEqual(self.post("/api/v1/auth/login/", {"username": "coordenador", "password": "secure-test-password"}, csrf=False).status_code, 403)
        self.assertEqual(self.client.get("/api/v1/schedules/").status_code, 403)

    def test_login_bad_password_and_logout(self):
        self.client.get("/api/v1/auth/session/")
        invalid = self.post("/api/v1/auth/login/", {"username": "coordenador", "password": "wrong"})
        self.assertEqual(invalid.status_code, 400)
        self.assertFalse(self.client.get("/api/v1/auth/session/").json()["authenticated"])
        valid = self.post("/api/v1/auth/login/", {"username": "coordenador", "password": "secure-test-password"})
        self.assertEqual(valid.status_code, 200)
        self.assertEqual(valid.json()["user"]["name"], "Maria")
        self.assertTrue(self.client.get("/api/v1/auth/session/").json()["authenticated"])
        self.assertEqual(self.client.get("/api/v1/schedules/").status_code, 200)
        self.assertEqual(self.post("/api/v1/auth/logout/", {}, csrf=False).status_code, 403)
        self.assertTrue(self.client.get("/api/v1/auth/session/").json()["authenticated"])
        signed_out = self.post("/api/v1/auth/logout/", {})
        self.assertEqual(signed_out.status_code, 200)
        self.assertFalse(self.client.get("/api/v1/auth/session/").json()["authenticated"])
        self.assertEqual(self.client.get("/api/v1/schedules/").status_code, 403)

    def test_inactive_user_cannot_login(self):
        self.user.is_active = False
        self.user.save(update_fields=["is_active"])
        self.client.get("/api/v1/auth/session/")
        response = self.post("/api/v1/auth/login/", {"username": "coordenador", "password": "secure-test-password"})
        self.assertEqual(response.status_code, 400)
        self.assertFalse(self.client.get("/api/v1/auth/session/").json()["authenticated"])
