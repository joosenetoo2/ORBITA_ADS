"""Small, transactional entry path for the spreadsheet-style timetable."""

from datetime import datetime
import unicodedata

from django.db.models import Max
from django.utils.text import slugify
from rest_framework.exceptions import ValidationError

from . import models
from .scheduling import validate_session


class GridConflict(Exception):
    def __init__(self, conflicts, index=None):
        self.conflicts = conflicts
        self.index = index


def normalize_text_key(text):
    if not text:
        return ""
    normalized = unicodedata.normalize("NFD", str(text))
    without_marks = "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")
    return " ".join(without_marks.strip().casefold().split())


def parse_time(value):
    val_str = str(value or "").strip()
    for fmt in ("%H:%M", "%H:%M:%S"):
        try:
            return datetime.strptime(val_str, fmt).time()
        except ValueError:
            pass
    raise ValidationError({"slots": f"Horário '{value}' inválido. Use horários no formato HH:MM."})


def make_code(model, institution, name):
    base = slugify(name)[:25].upper() or "ITEM"
    code = base
    number = 2
    while model.objects.filter(institution=institution, code=code).exists():
        code = f"{base[:24]}-{number}"
        number += 1
    return code


def by_name(model, institution, name):
    name = str(name or "").strip()
    if not name:
        raise ValidationError({"name": "Informe disciplina, professor e sala."})
    matches = list(model.objects.filter(institution=institution, name__iexact=name)[:2])
    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        raise ValidationError({"name": f"Há mais de um cadastro chamado {name}. Use os cadastros para corrigir a duplicidade."})

    # Busca com tolerância a acentos, cedilhas e maiúsculas/minúsculas
    target_key = normalize_text_key(name)
    candidates = [obj for obj in model.objects.filter(institution=institution) if normalize_text_key(obj.name) == target_key]
    if len(candidates) == 1:
        return candidates[0]
    if len(candidates) > 1:
        raise ValidationError({"name": f"Há mais de um cadastro similar a '{name}'. Use os cadastros para corrigir a duplicidade."})

    kwargs = {"institution": institution, "name": name, "code": make_code(model, institution, name)}
    return model.objects.create(**kwargs)


def room_by_code(institution, code):
    code = str(code or "").strip()
    if not code:
        raise ValidationError({"room": "Informe a sala."})
    if len(code) > 30:
        raise ValidationError({"room": "O código da sala deve ter até 30 caracteres."})
    room = models.Room.objects.filter(institution=institution, code__iexact=code).first()
    if not room:
        target_key = normalize_text_key(code)
        candidates = [
            r for r in models.Room.objects.filter(institution=institution)
            if normalize_text_key(r.code) == target_key or normalize_text_key(r.name) == target_key
        ]
        if candidates:
            return candidates[0]
    return room or models.Room.objects.create(institution=institution, code=code, name=code)


def reconcile(requirement):
    if not requirement:
        return
    sessions = list(models.ScheduledSession.objects.filter(requirement=requirement).order_by("occurrence", "pk"))
    offering = requirement.offering
    if sessions:
        for index, session in enumerate(sessions, 1):
            if session.occurrence != index:
                session.occurrence = index
                session.save(update_fields=["occurrence"])
        requirement.weekly_count = len(sessions)
        requirement.save(update_fields=["weekly_count"])
    else:
        requirement.delete()
    offering.weekly_minutes = sum(item.duration_minutes * item.weekly_count for item in offering.requirements.all())
    offering.save(update_fields=["weekly_minutes", "updated_at"])


def save_cell(schedule, data):
    try:
        group = models.ClassGroup.objects.get(pk=data["group_id"], course=schedule.course, term=schedule.term)
        weekday = int(data["weekday"])
        start_slot = models.ScheduleSlot.objects.get(pk=data["slot_id"], schedule=schedule)
        span = int(data.get("span", 1))
    except (KeyError, ValueError, TypeError, models.ClassGroup.DoesNotExist, models.ScheduleSlot.DoesNotExist):
        raise ValidationError({"cell": "Turma, dia ou faixa de horário inválidos."})
    if weekday not in range(1, 8) or span < 1:
        raise ValidationError({"cell": "Dia ou duração inválidos."})
    slots = list(schedule.slots.order_by("display_order", "starts_at"))
    start_index = next(index for index, slot in enumerate(slots) if slot.pk == start_slot.pk)
    chosen = slots[start_index:start_index + span]
    if len(chosen) != span or any(a.ends_at != b.starts_at for a, b in zip(chosen, chosen[1:])):
        raise ValidationError({"span": "A aula deve ocupar faixas consecutivas, sem intervalo."})
    duration = (chosen[-1].ends_at.hour * 60 + chosen[-1].ends_at.minute) - (chosen[0].starts_at.hour * 60 + chosen[0].starts_at.minute)
    institution = schedule.course.institution
    existing = None
    if data.get("session_id"):
        existing = models.ScheduledSession.objects.filter(pk=data["session_id"], schedule=schedule).select_related("requirement__offering").first()
        if not existing or existing.requirement.offering.group_id != group.pk:
            raise ValidationError({"session_id": "A aula não pertence a esta turma."})
        if "is_locked" in data:
            existing.is_locked = bool(data["is_locked"])
        if existing.is_locked and "is_locked" not in data:
            raise ValidationError({"session_id": "Esta aula está bloqueada. Desmarque o bloqueio no formulário para movê-la."})
        same_requirement = (
            existing.requirement.duration_minutes == duration
            and existing.requirement.offering.subject.name.casefold() == str(data.get("subject", "")).strip().casefold()
        )
        if same_requirement:
            teacher = by_name(models.Teacher, institution, data.get("teacher"))
            room = room_by_code(institution, data.get("room"))
            existing.requirement.offering.eligible_teachers.add(teacher)
            existing.weekday = weekday
            existing.starts_at = chosen[0].starts_at
            existing.ends_at = chosen[-1].ends_at
            existing.teacher = teacher
            existing.room = room
            existing.save(update_fields=["weekday", "starts_at", "ends_at", "teacher", "room", "is_locked"])
            conflicts = validate_session(existing)
            if conflicts:
                raise GridConflict(conflicts)
            return existing
        if existing.requirement.kind != "GRADE":
            raise ValidationError({"session_id": "Para esta aula cadastrada anteriormente, mantenha a disciplina e a duração. Professor, sala e dia podem ser alterados aqui."})
        old_requirement = existing.requirement
        existing.delete()
        reconcile(old_requirement)

    subject = by_name(models.Subject, institution, data.get("subject"))
    teacher = by_name(models.Teacher, institution, data.get("teacher"))
    room = room_by_code(institution, data.get("room"))
    offering, _ = models.SubjectOffering.objects.get_or_create(group=group, subject=subject)
    offering.eligible_teachers.add(teacher)
    requirement = models.SessionRequirement.objects.filter(offering=offering, duration_minutes=duration, kind="GRADE").first()
    if requirement is None:
        requirement = models.SessionRequirement.objects.create(offering=offering, duration_minutes=duration, weekly_count=1, kind="GRADE")
        occurrence = 1
    else:
        occurrence = (models.ScheduledSession.objects.filter(requirement=requirement).aggregate(Max("occurrence"))["occurrence__max"] or 0) + 1
        requirement.weekly_count = occurrence
        requirement.save(update_fields=["weekly_count"])
    session = models.ScheduledSession.objects.create(
        schedule=schedule, requirement=requirement, occurrence=occurrence, weekday=weekday,
        starts_at=chosen[0].starts_at, ends_at=chosen[-1].ends_at, teacher=teacher, room=room,
    )
    conflicts = validate_session(session)
    if conflicts:
        raise GridConflict(conflicts)
    reconcile(requirement)
    return session


def delete_cell(schedule, session_id, unlock=False):
    session = models.ScheduledSession.objects.filter(pk=session_id, schedule=schedule).select_related("requirement__offering").first()
    if not session:
        raise ValidationError({"session_id": "Aula não encontrada."})
    if session.is_locked and not unlock:
        raise ValidationError({"session_id": "Esta aula está bloqueada. Desbloqueie-a para excluir."})
    requirement = session.requirement
    session.delete()
    if requirement.kind == "GRADE":
        reconcile(requirement)
