"""
Outbound calendar sync — mirror a platform booking onto the connected Google
Calendars of its participants (coach and/or client).

Every entry point is best-effort and never raises into the caller: a calendar
failure must not break booking, cancellation or rescheduling.
"""
import logging
from datetime import timezone as dt_timezone

from .models import GoogleCalendarAccount, CalendarEventLink
from . import google_service as gsvc

logger = logging.getLogger(__name__)


def _event_body(booking, start_utc):
    from bookings.calendar import _event_fields
    f = _event_fields(booking, start_utc)
    return {
        "summary": f["title"],
        "description": f["description"],
        "location": f["location"],
        "start": {"dateTime": f["start_utc"].astimezone(dt_timezone.utc).isoformat(), "timeZone": "UTC"},
        "end": {"dateTime": f["end_utc"].astimezone(dt_timezone.utc).isoformat(), "timeZone": "UTC"},
        "reminders": {"useDefault": False, "overrides": [{"method": "popup", "minutes": 60}]},
    }


def _target_accounts(booking):
    """Active, outbound-enabled calendars for the booking's coach + client."""
    ids = [booking.mentor_id]
    client_profile = getattr(booking.learner, 'profile', None)
    if client_profile:
        ids.append(client_profile.id)
    return GoogleCalendarAccount.objects.filter(
        profile_id__in=[i for i in ids if i], is_active=True, sync_bookings_out=True,
    )


def _start(booking):
    from bookings.notifications import session_start_utc
    return session_start_utc(booking)


def sync_booking_created(booking):
    """Create the event on each connected participant calendar (idempotent)."""
    try:
        start = _start(booking)
        if not start:
            return
        body = _event_body(booking, start)
        for acct in _target_accounts(booking):
            if CalendarEventLink.objects.filter(booking=booking, account=acct).exists():
                continue
            token = gsvc.fresh_access_token(acct)
            if not token:
                continue
            event_id = gsvc.create_event(token, acct.calendar_id, body)
            if event_id:
                CalendarEventLink.objects.get_or_create(
                    booking=booking, account=acct,
                    defaults={'google_event_id': event_id},
                )
    except Exception as exc:  # noqa: BLE001
        logger.error("sync_booking_created(%s) failed: %s", getattr(booking, 'id', '?'), exc)


def sync_booking_updated(booking):
    """Push new time/details to already-synced calendars (reschedule, program
    change). Also creates the event for any participant who connected later."""
    try:
        start = _start(booking)
        if not start:
            return
        body = _event_body(booking, start)
        linked = {}
        for link in CalendarEventLink.objects.filter(booking=booking).select_related('account'):
            linked[link.account_id] = link
            acct = link.account
            if not (acct.is_active and acct.sync_bookings_out):
                continue
            token = gsvc.fresh_access_token(acct)
            if token:
                gsvc.update_event(token, acct.calendar_id, link.google_event_id, body)
        # A participant who connected after the booking has no link yet — create.
        for acct in _target_accounts(booking):
            if acct.id in linked:
                continue
            token = gsvc.fresh_access_token(acct)
            if not token:
                continue
            event_id = gsvc.create_event(token, acct.calendar_id, body)
            if event_id:
                CalendarEventLink.objects.get_or_create(
                    booking=booking, account=acct, defaults={'google_event_id': event_id})
    except Exception as exc:  # noqa: BLE001
        logger.error("sync_booking_updated(%s) failed: %s", getattr(booking, 'id', '?'), exc)


def sync_booking_cancelled(booking):
    """Remove the event from all synced calendars."""
    try:
        for link in CalendarEventLink.objects.filter(booking=booking).select_related('account'):
            token = gsvc.fresh_access_token(link.account)
            if token:
                gsvc.delete_event(token, link.account.calendar_id, link.google_event_id)
            link.delete()
    except Exception as exc:  # noqa: BLE001
        logger.error("sync_booking_cancelled(%s) failed: %s", getattr(booking, 'id', '?'), exc)
