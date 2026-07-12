"""
Inbound busy-blocking (Google → platform).

Hides a coach's open platform slots that clash with external events on their
connected Google Calendar, so a client can't book a time the coach is already
busy elsewhere. Coach-only (clients have no availability). Best-effort: any
failure falls back to showing the slots unchanged.
"""
import logging
from datetime import timedelta, timezone as dt_timezone

from django.core.cache import cache
from django.utils import timezone as dj_tz

from .models import GoogleCalendarAccount
from . import google_service as gsvc

logger = logging.getLogger(__name__)

BUSY_CACHE_TTL = 120          # seconds — avoid hammering the Google API
BUSY_WINDOW_DAYS = 60         # how far ahead to fetch busy times


def _busy_account(coach_profile):
    return GoogleCalendarAccount.objects.filter(
        profile=coach_profile, is_active=True, block_busy_times=True).first()


def busy_intervals(coach_profile):
    """The coach's external busy intervals over the next window, cached briefly."""
    acct = _busy_account(coach_profile)
    if not acct:
        return []
    key = f"gcal_busy_{acct.id}"
    cached = cache.get(key)
    if cached is not None:
        return cached
    token = gsvc.fresh_access_token(acct)
    if not token:
        return []
    now = dj_tz.now()
    intervals = gsvc.freebusy(
        token, acct.calendar_id,
        now.astimezone(dt_timezone.utc).isoformat(),
        (now + timedelta(days=BUSY_WINDOW_DAYS)).astimezone(dt_timezone.utc).isoformat(),
    )
    cache.set(key, intervals, BUSY_CACHE_TTL)
    return intervals


def filter_open_slots(coach_profile, slots):
    """Return `slots` minus any that overlap an external busy interval. On any
    error (or no connected calendar) returns the slots unchanged."""
    try:
        slots = list(slots)
        if not slots or not _busy_account(coach_profile):
            return slots
        busy = busy_intervals(coach_profile)
        if not busy:
            return slots
        return [s for s in slots if not _clashes(s, busy)]
    except Exception as exc:  # noqa: BLE001 — never break the listing
        logger.error("filter_open_slots failed: %s", exc)
        return list(slots)


def _clashes(slot, busy):
    return any(slot.start_datetime < b_end and b_start < slot.end_datetime
              for (b_start, b_end) in busy)
