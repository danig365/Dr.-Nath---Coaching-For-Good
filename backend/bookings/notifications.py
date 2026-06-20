"""
Booking-aware notification scheduling.

Translates a SessionBooking into concrete `ScheduledNotification` rows: an
immediate confirmation to both parties, plus the reminder ladder (added in a
later phase). Kept in the bookings app so the generic notifications app stays
feature-agnostic.
"""
import logging
from datetime import datetime, timedelta, timezone as dt_timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.conf import settings
from django.contrib.contenttypes.models import ContentType
from django.utils import timezone as dj_tz

from notifications.models import ScheduledNotification

logger = logging.getLogger(__name__)

# The reminder ladder: (kind, how-long-before-start, human label).
# A rung is skipped if its fire time is already in the past at booking time.
REMINDER_LADDER = [
    ('reminder_1d', timedelta(days=1), 'in 1 day'),
    ('reminder_1h', timedelta(hours=1), 'in 1 hour'),
    ('reminder_30m', timedelta(minutes=30), 'in 30 minutes'),
    ('reminder_start', timedelta(0), 'starting now'),
]


def _display_name(user):
    if not user:
        return "there"
    full = f"{user.first_name} {user.last_name}".strip()
    return full or user.username


def _tz(name):
    try:
        return ZoneInfo(name or 'UTC')
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo('UTC')


def session_start_utc(booking):
    """The booking's start as a tz-aware UTC datetime, or None if unknown."""
    if booking.slot and booking.slot.start_datetime:
        return booking.slot.start_datetime
    if booking.session_date and booking.session_time:
        # session_date/time are UTC-derived; treat them as UTC.
        return datetime.combine(
            booking.session_date, booking.session_time, tzinfo=dt_timezone.utc
        )
    return None


def _fmt_when(start_utc, tzname):
    """Format the session start in the recipient's local timezone."""
    local = start_utc.astimezone(_tz(tzname))
    # e.g. "Saturday, July 4, 2026 at 9:00 AM SAST"
    return local.strftime('%A, %B %-d, %Y at %-I:%M %p %Z')


def _recipients(booking):
    """Both parties with the data each email needs."""
    coach_user = booking.mentor.user
    client_user = booking.learner
    coach_tz = getattr(booking.mentor, 'timezone', 'UTC')
    client_tz = getattr(getattr(client_user, 'profile', None), 'timezone', 'UTC')

    return [
        {
            'role': 'coach',
            'user': coach_user,
            'email': coach_user.email,
            'tz': coach_tz,
            'name': _display_name(coach_user),
            'other_name': _display_name(client_user),
            'manage_url': f"{settings.SITE_URL}/my-sessions",
        },
        {
            'role': 'client',
            'user': client_user,
            'email': client_user.email,
            'tz': client_tz,
            'name': _display_name(client_user),
            'other_name': _display_name(coach_user),
            'manage_url': f"{settings.SITE_URL}/my-learning",
        },
    ]


def _context(booking, recipient, start_utc, *, reminder_label=None):
    return {
        'role': recipient['role'],
        'recipient_name': recipient['name'],
        'other_name': recipient['other_name'],
        'skill_name': booking.skill.name if booking.skill else 'your session',
        'session_when': _fmt_when(start_utc, recipient['tz']),
        'duration': booking.duration,
        'meeting_link': booking.meeting_link or '',
        'manage_url': recipient['manage_url'],
        'reminder_label': reminder_label or '',
    }


def schedule_booking_notifications(booking):
    """
    Queue notifications for a new booking: an immediate confirmation to both
    parties, plus the reminder ladder (1 day / 1 hour / 30 min / at-start).
    Safe to call more than once — dedupe keys prevent duplicates.
    """
    start_utc = session_start_utc(booking)
    if not start_utc:
        logger.warning("Booking %s has no resolvable start time; skipping notifications.", booking.id)
        return

    now = dj_tz.now()
    skill_name = booking.skill.name if booking.skill else 'your session'
    recipients = _recipients(booking)

    # 1) Confirmation — due now, sent immediately for instant feedback.
    for r in recipients:
        if not r['email']:
            continue
        note = ScheduledNotification.queue(
            kind='booking_confirmation',
            recipient_email=r['email'],
            recipient_user=r['user'],
            subject=f"Booking confirmed — {skill_name}",
            template='booking_confirmation',
            context=_context(booking, r, start_utc),
            scheduled_for=now,
            related=booking,
            dedupe_key=f"booking:{booking.id}:confirmation:{r['role']}",
        )
        if note and note.status == ScheduledNotification.STATUS_PENDING:
            note.send()

    # 2) Reminders — queued for the dispatcher to send when due.
    for kind, delta, label in REMINDER_LADDER:
        fire_at = start_utc - delta
        if fire_at <= now:
            continue  # too late for this rung
        for r in recipients:
            if not r['email']:
                continue
            subject = (
                f"Reminder — {skill_name} {label}"
                if kind != 'reminder_start'
                else f"{skill_name} is starting now"
            )
            ScheduledNotification.queue(
                kind=kind,
                recipient_email=r['email'],
                recipient_user=r['user'],
                subject=subject,
                template='session_reminder',
                context=_context(booking, r, start_utc, reminder_label=label),
                scheduled_for=fire_at,
                related=booking,
                dedupe_key=f"booking:{booking.id}:{kind}:{r['role']}",
            )


def cancel_booking_notifications(booking):
    """
    Cancel any still-pending notifications for a booking (e.g. when it's
    cancelled/declined) so reminders don't fire for a dead session. Already-sent
    notifications are left as-is. Returns the number cancelled.
    """
    ct = ContentType.objects.get_for_model(booking.__class__)
    return ScheduledNotification.objects.filter(
        content_type=ct,
        object_id=booking.id,
        status=ScheduledNotification.STATUS_PENDING,
    ).update(status=ScheduledNotification.STATUS_CANCELLED, updated_at=dj_tz.now())
