from rest_framework.permissions import BasePermission, SAFE_METHODS


class AcademicPermission(BasePermission):
    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        if request.method in SAFE_METHODS:
            return True
        if request.user.is_superuser:
            return True
        allowed = {"Administrador", "Coordenador", "Colaborador acadêmico"}
        if getattr(view, "admin_only", False):
            allowed = {"Administrador"}
        if getattr(view, "coordinator_only", False):
            allowed = {"Administrador", "Coordenador"}
        return request.user.groups.filter(name__in=allowed).exists()

