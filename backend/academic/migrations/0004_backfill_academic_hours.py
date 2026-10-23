from django.db import migrations


def backfill(apps, schema_editor):
    Institution = apps.get_model("academic", "Institution")
    ClassGroup = apps.get_model("academic", "ClassGroup")
    Subject = apps.get_model("academic", "Subject")
    Institution.objects.exclude(class_minutes=60).update(class_minutes=60)
    for group in ClassGroup.objects.filter(name=""):
        group.name = group.code
        group.save(update_fields=["name"])
    for subject in Subject.objects.filter(credits__isnull=True, workload_unit="CLASS_HOUR"):
        if subject.total_workload and subject.total_workload % 20 == 0:
            subject.credits = subject.total_workload // 20
            subject.onsite_weekly_hours = subject.credits
            subject.save(update_fields=["credits", "onsite_weekly_hours"])


class Migration(migrations.Migration):
    dependencies = [("academic", "0003_classgroup_name_subject_credits_and_more")]
    operations = [migrations.RunPython(backfill, migrations.RunPython.noop)]
