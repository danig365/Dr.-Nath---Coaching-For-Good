"""
Slot generation engine.

Turns a coach's recurring `Availability` windows into concrete, bookable
`TimeSlot` instances for a rolling horizon. Auto-generation is idempotent and
non-destructive: it never touches manual, booked, held, or blocked slots, and
it skips any open slot that already exists or that would overlap a protected
slot.
"""
from datetime import datetime, timedelta, time
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.db import transaction
from django.utils import timezone as dj_timezone

from skills.models import Availability
from .models import TimeSlot

# Slots in these states must never be overwritten or duplicated by generation.
PROTECTED_STATUSES = ('booked', 'held', 'blocked')

# How long a slot stays reserved while a client completes checkout.
HOLD_MINUTES = 10


def release_expired_holds():
    """Return any held slots whose hold window has lapsed back to 'open'."""
    now = dj_timezone.now()
    return TimeSlot.objects.filter(
        status='held', held_until__lt=now
    ).update(status='open', held_until=None)


def _coach_tz(coach):
    """Return the coach's ZoneInfo, falling back to UTC for bad/empty values."""
    try:
        return ZoneInfo(coach.timezone or 'UTC')
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo('UTC')


def _window_slot_bounds(day_date, availability, tz):
    """
    Yield (start_utc, end_utc) tuples for every slot that fits inside one
    availability window on a given local date.
    """
    step = availability.slot_duration + availability.buffer_minutes
    if step <= 0:
        return

    local_cursor = datetime.combine(day_date, availability.start_time, tzinfo=tz)
    window_end = datetime.combine(day_date, availability.end_time, tzinfo=tz)

    while True:
        slot_end_local = local_cursor + timedelta(minutes=availability.slot_duration)
        if slot_end_local > window_end:
            break
        yield (
            local_cursor.astimezone(ZoneInfo('UTC')),
            slot_end_local.astimezone(ZoneInfo('UTC')),
        )
        local_cursor = local_cursor + timedelta(minutes=step)


@transaction.atomic
def generate_slots_for_coach(coach, horizon_days=None, min_notice_hours=None):
    """
    Generate `open`/`auto` TimeSlots for `coach` across the rolling horizon.

    Returns a summary dict: {'created': int, 'skipped': int}.
    """
    horizon_days = horizon_days if horizon_days is not None else coach.booking_horizon_days
    min_notice_hours = (
        min_notice_hours if min_notice_hours is not None else coach.min_notice_hours
    )

    tz = _coach_tz(coach)
    now_utc = dj_timezone.now()
    earliest_start = now_utc + timedelta(hours=min_notice_hours)
    horizon_end = now_utc + timedelta(days=horizon_days)

    windows = list(
        Availability.objects.filter(mentor=coach, is_available=True)
    )

    # Existing slots in the horizon, to avoid duplicates / collisions.
    existing = list(
        TimeSlot.objects.filter(
            coach=coach,
            start_datetime__lt=horizon_end,
            end_datetime__gt=now_utc,
        )
    )
    existing_keys = {(s.start_datetime, s.end_datetime) for s in existing}
    protected = [s for s in existing if s.status in PROTECTED_STATUSES]

    def overlaps_protected(start, end):
        return any(p.start_datetime < end and start < p.end_datetime for p in protected)

    created = 0
    skipped = 0
    new_slots = []

    # Walk each local date in the horizon and match same-weekday windows.
    start_date = now_utc.astimezone(tz).date()
    for offset in range((horizon_days) + 1):
        day_date = start_date + timedelta(days=offset)
        weekday_name = day_date.strftime('%A')

        for window in windows:
            if window.day_of_week.strip().lower() != weekday_name.lower():
                continue

            for start_utc, end_utc in _window_slot_bounds(day_date, window, tz):
                if start_utc < earliest_start or start_utc >= horizon_end:
                    skipped += 1
                    continue
                if (start_utc, end_utc) in existing_keys:
                    skipped += 1
                    continue
                if overlaps_protected(start_utc, end_utc):
                    skipped += 1
                    continue

                new_slots.append(TimeSlot(
                    coach=coach,
                    start_datetime=start_utc,
                    end_datetime=end_utc,
                    status='open',
                    source='auto',
                ))
                existing_keys.add((start_utc, end_utc))
                created += 1

    if new_slots:
        TimeSlot.objects.bulk_create(new_slots, ignore_conflicts=True)

    return {'created': created, 'skipped': skipped}
