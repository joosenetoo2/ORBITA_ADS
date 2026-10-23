from django.db import migrations, models


def convert_percentages_to_hours(apps, schema_editor):
    Subject = apps.get_model("academic", "Subject")
    for subject in Subject.objects.exclude(ead_weekly_hours=0):
        credits = subject.credits or 0
        onsite = subject.onsite_weekly_hours or 0
        hours = (credits * subject.ead_weekly_hours + 50) // 100
        subject.ead_weekly_hours = min(hours, max(credits - onsite, 0))
        subject.save(update_fields=["ead_weekly_hours"])


class Migration(migrations.Migration):
    dependencies = [("academic", "0004_backfill_academic_hours")]
    operations = [
        migrations.RenameField(model_name="subject", old_name="ead_percentage", new_name="ead_weekly_hours"),
        migrations.AlterField(model_name="subject", name="ead_weekly_hours", field=models.PositiveSmallIntegerField(default=0)),
        migrations.RunPython(convert_percentages_to_hours, migrations.RunPython.noop),
    ]
