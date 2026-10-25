from django.db import migrations


def backfill(apps, schema_editor):
    Offering = apps.get_model("academic", "SubjectOffering")
    through = Offering.eligible_teachers.through
    for offering in Offering.objects.filter(assigned_teacher__isnull=True).iterator():
        teacher_id = (through.objects.filter(subjectoffering_id=offering.pk)
                      .order_by("teacher_id").values_list("teacher_id", flat=True).first())
        if teacher_id:
            Offering.objects.filter(pk=offering.pk).update(assigned_teacher_id=teacher_id)


class Migration(migrations.Migration):
    dependencies = [("academic", "0010_subjectoffering_assigned_teacher_generationjob_and_more")]
    operations = [migrations.RunPython(backfill, migrations.RunPython.noop)]
