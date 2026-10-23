"""Academic catalog operations expressed in credits and weekly class hours."""

from rest_framework.exceptions import ValidationError

from . import models


def offer_subject(subject, group, teacher, block_hours=2):
    if group.course.institution_id != subject.institution_id or teacher.institution_id != subject.institution_id:
        raise ValidationError({"offering": "Turma, disciplina e professor devem pertencer à mesma instituição."})
    if subject.credits is None or subject.onsite_weekly_hours is None:
        raise ValidationError({"subject": "Defina créditos e horas presenciais semanais na disciplina antes de ofertá-la."})
    try:
        block_hours = int(block_hours)
    except (TypeError, ValueError):
        raise ValidationError({"block_hours": "Informe 1, 2, 3 ou 4 horas por bloco."})
    if block_hours not in range(1, 5):
        raise ValidationError({"block_hours": "Informe 1, 2, 3 ou 4 horas por bloco."})
    offering, created = models.SubjectOffering.objects.get_or_create(
        group=group, subject=subject, defaults={"weekly_minutes": subject.onsite_weekly_hours * 60},
    )
    offering.eligible_teachers.add(teacher)
    if created and subject.onsite_weekly_hours:
        full, remainder = divmod(subject.onsite_weekly_hours, block_hours)
        if full:
            models.SessionRequirement.objects.create(
                offering=offering, duration_minutes=block_hours * 60, weekly_count=full, kind="AUTO_OFFER",
            )
        if remainder:
            models.SessionRequirement.objects.create(
                offering=offering, duration_minutes=remainder * 60, weekly_count=1, kind="AUTO_OFFER",
            )
    return offering, created
