import re
import unicodedata

from django.db import migrations


SUBJECT_PERIODS = {
    1: "ARQCOMP ENGREQ FUNDLOG INGLES PROGEST",
    2: "ELETIVA1 ENGSOFT EXT1 FUNDADM POO DIRHUM",
    3: "BD1 WEB1 ESTRDAD EXT2 LABRED",
    4: "BD2 MOBILE WEB2 DESINTUX ELETIVA2 EXT3 MAP METAV",
    5: "DIRDIG EMPINOV PROJBD PROJENGSOFT PROJUX PROJWEB QUALTEST ESTAGIO",
}


def fold(value):
    return "".join(char for char in unicodedata.normalize("NFD", value.lower()) if unicodedata.category(char) != "Mn")


def forwards(apps, schema_editor):
    Subject = apps.get_model("academic", "Subject")
    ClassGroup = apps.get_model("academic", "ClassGroup")
    TimeProfile = apps.get_model("academic", "TimeProfile")
    Schedule = apps.get_model("academic", "Schedule")
    lookup = {code: number for number, codes in SUBJECT_PERIODS.items() for code in codes.split()}
    for subject in Subject.objects.filter(period_number__isnull=True):
        number = lookup.get(subject.code.upper())
        if number:
            subject.period_number = number
            subject.save(update_fields=["period_number"])
    for group in ClassGroup.objects.all():
        changes = []
        if group.period_number is None:
            match = re.search(r"\d+", group.code)
            if match:
                group.period_number = int(match.group())
                changes.append("period_number")
        if group.time_profile_id is None:
            profiles = list(TimeProfile.objects.filter(institution_id=group.course.institution_id, is_active=True))
            night = next((profile for profile in profiles if fold(profile.name) == "noite"), None)
            if night:
                group.time_profile_id = night.pk
                changes.append("time_profile")
            elif len(profiles) == 1:
                group.time_profile_id = profiles[0].pk
                changes.append("time_profile")
        if changes:
            group.save(update_fields=changes)
    for schedule in Schedule.objects.filter(time_profile__isnull=True):
        group_profiles = set(ClassGroup.objects.filter(course_id=schedule.course_id, term_id=schedule.term_id).exclude(time_profile__isnull=True).values_list("time_profile_id", flat=True))
        if len(group_profiles) == 1:
            schedule.time_profile_id = group_profiles.pop()
            schedule.save(update_fields=["time_profile"])


class Migration(migrations.Migration):
    dependencies = [("academic", "0006_remove_schedule_unique_schedule_course_term_and_more")]
    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
