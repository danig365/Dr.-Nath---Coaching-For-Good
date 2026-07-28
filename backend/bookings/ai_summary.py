"""Shared helpers for generating + storing a session's AI summary (E7).

Used by BOTH the API endpoint (transcript posted from the browser — Phase 2)
and the server-side transcription worker (Phase 3), so there is a single,
idempotent, cost-safe code path for turning a transcript into a SessionSummary.
"""
from assistant.services import summarize_session
from .models import SessionSummary

MIN_TRANSCRIPT_CHARS = 40


def speaker_label_for_identity(booking, identity):
    """Map a LiveKit participant identity (which is str(user.id)) to a friendly
    transcript label. Falls back to "Participant" for anything unexpected."""
    try:
        uid = int(identity)
    except (TypeError, ValueError):
        return "Participant"
    if booking.mentor and booking.mentor.user_id == uid:
        return "Coach"
    if booking.learner_id == uid:
        return "Client"
    return "Participant"


def generate_and_store_summary(booking, transcript, *, min_chars=MIN_TRANSCRIPT_CHARS):
    """Summarise `transcript` and upsert the booking's SessionSummary.

    Idempotent + cost-safe: if an equal-or-longer transcript was already
    summarised, returns the existing summary WITHOUT calling the AI again.
    Returns the SessionSummary, or None when there isn't enough content or the
    AI is unavailable (callers treat None as "no summary produced").
    """
    transcript = (transcript or "").strip()
    if len(transcript) < min_chars:
        return None

    existing = SessionSummary.objects.filter(booking=booking).first()
    if existing and existing.transcript_chars >= len(transcript) and existing.summary:
        return existing

    result = summarize_session(transcript)
    if not result:
        return None

    summ, _ = SessionSummary.objects.update_or_create(
        booking=booking,
        defaults={
            'summary': result['summary'],
            'key_points': result['key_points'],
            'action_items': result['action_items'],
            'reflection_points': result.get('reflection_points', []),
            'transcript_chars': len(transcript),
        },
    )
    # Email the summary to both parties as soon as it exists (fires from whichever
    # path generated it — the call page or the server-side worker). Guarded so it
    # only sends once and only for a session that actually took place.
    try:
        booking.refresh_from_db(fields=['status'])
        from .notifications import send_session_summary_email
        send_session_summary_email(booking)
    except Exception:  # noqa: BLE001 — never break summary generation on email
        pass
    return summ
