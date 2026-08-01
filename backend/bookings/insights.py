"""Weekly coach insights (F2).

Pure computation for the weekly coach email — who to re-engage, and what's been
discussed most. No email/scheduling here; the management command turns this into
a queued notification.

Two things the coach asked for:
  1. Clients they haven't interacted with recently ("neglected").
  2. An AI list of the most-discussed topics across recent sessions.
"""
from collections import defaultdict
from datetime import timedelta

from django.conf import settings
from django.utils import timezone

from .models import SessionBooking, SessionSummary

# A client counts as "neglected" if their last *held* session was more than this
# many days ago (and they have nothing upcoming). Tunable via settings/.env.
NEGLECT_DAYS = getattr(settings, "WEEKLY_INSIGHTS_NEGLECT_DAYS", 21)
# How far back to look when working out the most-discussed topics.
TOPICS_LOOKBACK_DAYS = getattr(settings, "WEEKLY_INSIGHTS_TOPICS_DAYS", 30)

_UPCOMING_STATUSES = ("accepted", "pending")


def _display_name(user):
    full = f"{user.first_name} {user.last_name}".strip()
    return full or user.username or user.email


def compute_weekly_insights(coach, *, now=None):
    """`coach` is a UserProfile (role='coach').

    Returns:
        {
          'neglected_clients': [
              {'name': str, 'last_session': 'YYYY-MM-DD'|None, 'days_since': int|None},
              ...  # most urgent first
          ],
          'top_topics': [str, ...],   # ranked, may be empty
        }
    """
    now = now or timezone.now()
    today = timezone.localdate()
    neglect_cutoff = today - timedelta(days=NEGLECT_DAYS)

    # A coach can appear as a learner on a test booking — never list them as their
    # own neglected client.
    bookings = (
        SessionBooking.objects.filter(mentor=coach)
        .exclude(learner=coach.user)
        .select_related("learner")
    )

    by_client = defaultdict(list)
    for b in bookings:
        by_client[b.learner_id].append(b)

    neglected = []
    for blist in by_client.values():
        learner = blist[0].learner
        happened = [
            b.session_date for b in blist
            if b.status in SessionBooking.OUTCOMES_THAT_HAPPENED
        ]
        last_session = max(happened) if happened else None

        has_upcoming = any(
            b.session_date >= today and b.status in _UPCOMING_STATUSES
            for b in blist
        )
        if has_upcoming:
            continue  # already re-engaged — nothing to nudge

        if last_session is None or last_session < neglect_cutoff:
            days_since = (today - last_session).days if last_session else None
            neglected.append({
                "name": _display_name(learner),
                "last_session": last_session.isoformat() if last_session else None,
                "days_since": days_since,
            })

    # Most urgent first: never-met clients (days_since None) at the top, then the
    # longest since a session.
    neglected.sort(
        key=lambda c: c["days_since"] if c["days_since"] is not None else 10**9,
        reverse=True,
    )

    # Most-discussed topics from recent session summaries.
    since = now - timedelta(days=TOPICS_LOOKBACK_DAYS)
    texts = []
    for s in SessionSummary.objects.filter(
        booking__mentor=coach, updated_at__gte=since,
    ):
        parts = []
        if s.summary:
            parts.append(s.summary)
        if s.key_points:
            parts.append(" • ".join(s.key_points))
        if parts:
            texts.append("\n".join(parts))

    from assistant.services import summarize_topics
    top_topics = summarize_topics(texts)

    return {"neglected_clients": neglected, "top_topics": top_topics}
