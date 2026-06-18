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
from .models import TimeSlot, GroupSession, GroupEnrollment

# Slots in these states must never be overwritten or duplicated by generation.
PROTECTED_STATUSES = ('booked', 'held', 'blocked')

# How long a slot stays reserved while a client completes checkout.
HOLD_MINUTES = 10


class SeatUnavailable(Exception):
    """Raised when a client cannot take a seat in a group session."""
    pass


def release_expired_holds():
    """
    Return abandoned checkout holds to their available state.

    Covers both 1:1 slots (back to 'open') and group-session seats (held
    enrolments back to 'cancelled', reopening any session that is no longer
    full). Returns the total number of holds released.
    """
    now = dj_timezone.now()

    slot_count = TimeSlot.objects.filter(
        status='held', held_until__lt=now
    ).update(status='open', held_until=None, held_by=None)

    expired = GroupEnrollment.objects.filter(status='held', held_until__lt=now)
    affected_session_ids = list(expired.values_list('group_session_id', flat=True).distinct())
    seat_count = expired.update(status='cancelled', held_until=None)

    # A freed seat may take a 'full' session back to 'scheduled'.
    for session in GroupSession.objects.filter(id__in=affected_session_ids, status='full'):
        if session.seats_taken < session.capacity:
            session.status = 'scheduled'
            session.save(update_fields=['status', 'updated_at'])

    # Mark past sessions completed so they leave the bookable pool and read
    # correctly in coach/client views.
    GroupSession.objects.filter(
        status__in=('scheduled', 'full'), end_datetime__lt=now
    ).update(status='completed')

    return slot_count + seat_count


@transaction.atomic
def reserve_seat(session_id, user):
    """
    Reserve a held seat for `user` in a group session.

    Locks the GroupSession row so concurrent enrolments are serialised, enforces
    the hard-stop capacity, and reuses the client's existing enrolment row (so a
    re-enrol after cancellation doesn't violate the unique constraint). Raises
    SeatUnavailable with a client-safe message on any rejection.
    """
    session = GroupSession.objects.select_for_update().get(id=session_id)

    if session.status == 'cancelled':
        raise SeatUnavailable("This session has been cancelled.")
    if session.status == 'completed' or session.end_datetime <= dj_timezone.now():
        raise SeatUnavailable("This session has already taken place.")

    existing = session.enrollments.filter(learner=user).first()
    if existing and existing.status == 'booked':
        raise SeatUnavailable("You are already enrolled in this session.")

    # Seats taken by other clients (held + booked). The caller's own row, if any,
    # is reused rather than counted against them.
    taken_by_others = session.enrollments.filter(
        status__in=('held', 'booked')
    ).exclude(learner=user).count()
    if taken_by_others >= session.capacity:
        raise SeatUnavailable("This session is full.")

    enrollment, _ = GroupEnrollment.objects.update_or_create(
        group_session=session,
        learner=user,
        defaults={
            'status': 'held',
            'held_until': dj_timezone.now() + timedelta(minutes=HOLD_MINUTES),
            'payment_status': 'unpaid',
        },
    )

    # Reflect a now-full session for coarse listing/filtering.
    if session.seats_taken >= session.capacity and session.status == 'scheduled':
        session.status = 'full'
        session.save(update_fields=['status', 'updated_at'])

    return enrollment


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
def generate_slots_for_coach(coach, horizon_days=None, min_notice_hours=None,
                             start_date=None, end_date=None):
    """
    Generate `open`/`auto` TimeSlots for `coach` from their recurring windows.

    Two modes:
      - Rolling horizon (default): covers `now → now + horizon_days`.
      - Fixed range: when `start_date` and `end_date` (local `date`s) are given,
        covers those local dates inclusive — e.g. 1 Jul → 6 Dec.

    The min-notice floor still applies in both modes, so no slot is ever minted
    in the past or inside the coach's notice window.

    Returns a summary dict: {'created': int, 'skipped': int}.
    """
    min_notice_hours = (
        min_notice_hours if min_notice_hours is not None else coach.min_notice_hours
    )

    tz = _coach_tz(coach)
    now_utc = dj_timezone.now()
    earliest_start = now_utc + timedelta(hours=min_notice_hours)

    if start_date is not None and end_date is not None:
        # Fixed date-range mode: walk the given local dates inclusive.
        range_start_date = start_date
        range_end_date = end_date
        # Upper bound = start of the day after the last date, in UTC.
        horizon_end = datetime.combine(
            end_date + timedelta(days=1), time(0, 0), tzinfo=tz
        ).astimezone(ZoneInfo('UTC'))
    else:
        horizon_days = horizon_days if horizon_days is not None else coach.booking_horizon_days
        range_start_date = now_utc.astimezone(tz).date()
        range_end_date = range_start_date + timedelta(days=horizon_days)
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

    # Walk each local date in the range and match same-weekday windows.
    day_count = (range_end_date - range_start_date).days
    for offset in range(day_count + 1):
        day_date = range_start_date + timedelta(days=offset)
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
