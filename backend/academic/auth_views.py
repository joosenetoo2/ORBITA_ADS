"""Session authentication for the application UI."""

import json

from django.contrib.auth import authenticate, login, logout
from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_POST


def user_payload(user):
    return {
        "id": user.pk,
        "username": user.get_username(),
        "name": user.get_full_name() or user.get_username(),
        "is_superuser": user.is_superuser,
        "groups": list(user.groups.values_list("name", flat=True)),
    }


@never_cache
@ensure_csrf_cookie
@require_GET
def session_view(request):
    if not request.user.is_authenticated:
        return JsonResponse({"authenticated": False, "user": None})
    return JsonResponse({"authenticated": True, "user": user_payload(request.user)})


@never_cache
@csrf_protect
@require_POST
def login_view(request):
    try:
        body = json.loads(request.body)
        username = str(body.get("username", "")).strip()
        password = body.get("password", "")
    except (ValueError, TypeError, AttributeError):
        return JsonResponse({"message": "Envie usuário e senha válidos."}, status=400)
    if not username or not isinstance(password, str) or not password:
        return JsonResponse({"message": "Informe usuário e senha."}, status=400)
    user = authenticate(request, username=username, password=password)
    if user is None or not user.is_active:
        return JsonResponse({"message": "Usuário ou senha inválidos."}, status=400)
    login(request, user)
    return JsonResponse({"authenticated": True, "user": user_payload(user)})


@never_cache
@csrf_protect
@require_POST
def logout_view(request):
    logout(request)
    return JsonResponse({"authenticated": False, "user": None})
