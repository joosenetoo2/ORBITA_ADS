"""Independent validation of weekly draft allocations.

Intervals are half-open: [start, end). No fixed shift or class duration is assumed.
"""
from .models import ScheduledSession, Scope, TimeBlock, TimeWindow


def minutes(value):
    return value.hour * 60 + value.minute


def overlaps(a_start, a_end, b_start, b_end):
    return a_start < b_end and b_start < a_end


def matching_scopes(session):
    offering = session.requirement.offering
    return {
        (Scope.INSTITUTION, None),
        (Scope.COURSE, offering.group.course_id),
        (Scope.GROUP, offering.group_id),
        (Scope.TEACHER, session.teacher_id),
        (Scope.ROOM, session.room_id),
        (Scope.OFFERING, offering.id),
    }


def validate_session(session, other_sessions=None):
    offering = session.requirement.offering
    group = offering.group
    institution_id = group.course.institution_id
    term_id = group.term_id
    start, end = minutes(session.starts_at), minutes(session.ends_at)
    conflicts = []

    def add(code, message, resource_type=None, resource_id=None, conflicting_session_id=None):
        conflicts.append({
            "code": code, "severity": "HARD", "message": message,
            "resource_type": resource_type, "resource_id": resource_id,
            "interval": {"day": session.weekday, "start": session.starts_at.strftime("%H:%M"), "end": session.ends_at.strftime("%H:%M")},
            "conflicting_session_id": conflicting_session_id,
        })

    if end <= start or end - start != session.requirement.duration_minutes:
        add("INVALID_DURATION", "A duração não corresponde ao encontro requerido.")
    if session.occurrence > session.requirement.weekly_count:
        add("INVALID_OCCURRENCE", "A ocorrência excede a quantidade semanal requerida.")
    if session.schedule.course_id != group.course_id or session.schedule.term_id != term_id:
        add("SCHEDULE_MISMATCH", "A oferta não pertence ao curso e período da grade.")
    if session.teacher.institution_id != institution_id or session.room.institution_id != institution_id:
        add("INSTITUTION_MISMATCH", "Professor ou sala pertence a outra instituição.")
    if not session.teacher.is_active or not session.room.is_active or not offering.is_active:
        add("INACTIVE_RESOURCE", "A oferta, o professor ou a sala está inativo.")
    if not offering.eligible_teachers.filter(pk=session.teacher_id).exists():
        add("TEACHER_NOT_ELIGIBLE", "O professor não está habilitado para esta oferta.", "teacher", session.teacher_id)
    if group.student_count is not None and session.room.capacity is not None and session.room.capacity < group.student_count:
        add("ROOM_CAPACITY", "A capacidade da sala é insuficiente.", "room", session.room_id)
    required = set(offering.required_features.values_list("id", flat=True)) | set(offering.subject.required_features.values_list("id", flat=True))
    available = set(session.room.features.values_list("id", flat=True))
    if not required.issubset(available):
        add("ROOM_FEATURES", "A sala não possui todos os recursos exigidos.", "room", session.room_id)

    scopes = matching_scopes(session)
    windows = [w for w in TimeWindow.objects.filter(institution_id=institution_id, weekday=session.weekday, is_active=True).select_related("profile") if (w.scope, w.scope_id) in scopes and (not w.profile_id or w.profile.is_active)]
    if not windows or any(
        not any(w.scope == scope and minutes(w.starts_at) <= start and end <= minutes(w.ends_at) for w in windows)
        for scope in {w.scope for w in windows}
    ):
        add("OUTSIDE_WINDOW", "O encontro não cabe em todas as janelas aplicáveis.")
    for block in TimeBlock.objects.filter(institution_id=institution_id, weekday=session.weekday, is_active=True):
        if (block.scope, block.scope_id) in scopes and overlaps(start, end, minutes(block.starts_at), minutes(block.ends_at)):
            add("TIME_BLOCK", f"O encontro cruza um bloqueio: {block.reason}.")

    if other_sessions is None:
        other_sessions = ScheduledSession.objects.filter(schedule__term_id=term_id, weekday=session.weekday).exclude(pk=session.pk).select_related("requirement__offering__group")
    for other in other_sessions:
        if not overlaps(start, end, minutes(other.starts_at), minutes(other.ends_at)):
            continue
        if other.teacher_id == session.teacher_id:
            add("TEACHER_OVERLAP", "O professor já possui aula neste intervalo.", "teacher", session.teacher_id, other.pk)
        if other.room_id == session.room_id:
            add("ROOM_OVERLAP", "A sala já está ocupada neste intervalo.", "room", session.room_id, other.pk)
        if other.requirement.offering.group_id == group.id:
            add("GROUP_OVERLAP", "A turma já possui aula neste intervalo.", "group", group.id, other.pk)
    if session.teacher.max_weekly_minutes is not None:
        weekly = end - start
        for other in ScheduledSession.objects.filter(schedule__term_id=term_id, teacher_id=session.teacher_id).exclude(pk=session.pk):
            weekly += minutes(other.ends_at) - minutes(other.starts_at)
        if weekly > session.teacher.max_weekly_minutes:
            add("TEACHER_WEEKLY_LIMIT", "A carga semanal máxima do professor foi excedida.", "teacher", session.teacher_id)
    return conflicts


def candidate_starts(window, duration_minutes, granularity_minutes, blocks=()):
    """Return unique minute offsets; a candidate must fit entirely in a window."""
    if duration_minutes <= 0 or granularity_minutes <= 0:
        raise ValueError("Duração e granularidade devem ser positivas.")
    start, end = minutes(window.starts_at), minutes(window.ends_at)
    first = ((start + granularity_minutes - 1) // granularity_minutes) * granularity_minutes
    return [minute for minute in range(first, end - duration_minutes + 1, granularity_minutes)
            if not any(overlaps(minute, minute + duration_minutes, minutes(b.starts_at), minutes(b.ends_at)) for b in blocks)]

