from django.db import migrations, models


def classify_existing_rooms(apps, schema_editor):
    Room = apps.get_model("academic", "Room")
    Subject = apps.get_model("academic", "Subject")
    ScheduledSession = apps.get_model("academic", "ScheduledSession")
    for room in Room.objects.all().only("id", "code", "name"):
        label = f"{room.code} {room.name}".casefold()
        if "metalab" in label or "meta lab" in label:
            room.room_type = "METALAB"
        elif "laborat" in label or "lab" in label:
            room.room_type = "LABORATORY"
        else:
            continue
        room.save(update_fields=["room_type"])
    for subject in Subject.objects.all().only("id"):
        used_types = set(ScheduledSession.objects.filter(requirement__offering__subject_id=subject.pk)
                         .values_list("room__room_type", flat=True).distinct())
        if len(used_types) == 1:
            subject.required_room_type = used_types.pop()
            subject.save(update_fields=["required_room_type"])


class Migration(migrations.Migration):
    dependencies = [("academic", "0012_teacheravailability")]

    operations = [
        migrations.AddField(
            model_name="room",
            name="room_type",
            field=models.CharField(choices=[("CLASSROOM", "Sala de Aula"), ("LABORATORY", "Laboratório"), ("METALAB", "Metalab")], default="CLASSROOM", max_length=12),
        ),
        migrations.AddField(
            model_name="subject",
            name="required_room_type",
            field=models.CharField(choices=[("CLASSROOM", "Sala de Aula"), ("LABORATORY", "Laboratório"), ("METALAB", "Metalab")], default="CLASSROOM", max_length=12),
        ),
        migrations.RunPython(classify_existing_rooms, migrations.RunPython.noop),
    ]
