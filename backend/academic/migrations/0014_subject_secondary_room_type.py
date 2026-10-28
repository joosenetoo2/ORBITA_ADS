from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("academic", "0013_room_environment_types")]

    operations = [
        migrations.AddField(
            model_name="subject",
            name="secondary_room_type",
            field=models.CharField(blank=True, choices=[("CLASSROOM", "Sala de Aula"), ("LABORATORY", "Laboratório"), ("METALAB", "Metalab")], default="", max_length=12),
        ),
    ]
