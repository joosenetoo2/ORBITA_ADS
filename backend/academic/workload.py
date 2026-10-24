"""Weekly teacher workload and rest checks across every schedule in a term."""

from collections import defaultdict


def minute_of_day(value):
    if isinstance(value, str):
        hour, minute = value[:5].split(":")
        return int(hour) * 60 + int(minute)
    return value.hour * 60 + value.minute


def audit_intervals(items):
    """Return diagnostics for weekly intervals with weekday, start and end keys.

    Daily break defaults follow the general 15/60-minute thresholds. This is a
    scheduling aid; an institution may have a different applicable agreement.
    """
    days = defaultdict(list)
    for item in items:
        days[int(item["weekday"])].append((minute_of_day(item["start"]), minute_of_day(item["end"])))
    issues = []
    for weekday, intervals in days.items():
        intervals.sort()
        total = sum(end - start for start, end in intervals)
        gaps = []
        latest_end = intervals[0][1]
        overlapping = False
        for start, end in intervals[1:]:
            gaps.append(max(0, start - latest_end))
            overlapping = overlapping or start < latest_end
            latest_end = max(latest_end, end)
        required = 60 if total > 360 else 15 if total > 240 else 0
        longest = max(gaps, default=0)
        if required and longest < required:
            issues.append({"code": "INTRADAY_BREAK", "weekday": weekday, "required_minutes": required,
                           "actual_minutes": longest, "message": f"No dia {weekday}, a carga de {total // 60}h{total % 60:02d} exige um intervalo de pelo menos {required} minutos; o maior intervalo é de {longest} minutos."})
        if overlapping:
            issues.append({"code": "TEACHER_OVERLAP", "weekday": weekday,
                           "message": f"Há horários sobrepostos no dia {weekday}."})
    for weekday in range(1, 8):
        next_day = weekday % 7 + 1
        if weekday not in days or next_day not in days:
            continue
        rest = 1440 + min(start for start, _ in days[next_day]) - max(end for _, end in days[weekday])
        if rest < 660:
            issues.append({"code": "INTERDAY_REST", "weekday": weekday, "next_weekday": next_day,
                           "required_minutes": 660, "actual_minutes": rest,
                           "message": f"Entre os dias {weekday} e {next_day}, o descanso é de {rest} minutos; são necessários 660 minutos."})
    return issues


def teacher_summary(items):
    lessons = [item for item in items if item["kind"] == "LESSON"]
    events = [item for item in items if item["kind"] == "EVENT"]
    duration = lambda entries: sum(minute_of_day(item["end"]) - minute_of_day(item["start"]) for item in entries)
    return {"lesson_blocks": len(lessons), "lesson_minutes": duration(lessons),
            "event_count": len(events), "event_minutes": duration(events),
            "total_minutes": duration(items), "issues": audit_intervals(items)}
