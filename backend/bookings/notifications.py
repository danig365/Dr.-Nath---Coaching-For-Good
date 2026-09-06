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
from .calendar import build_ics, google_calendar_link, outlook_calendar_link

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
        # One-click join: the coach's external meeting link if set, else the
        # in-app call page (same room for both parties).
        'join_link': booking.meeting_link or f"{settings.SITE_URL}/session/{booking.id}",
        'manage_url': recipient['manage_url'],
        'login_url': f"{settings.SITE_URL}/login",
        # "Add to calendar" links (only meaningful on the confirmation email).
        'add_to_google': google_calendar_link(booking, start_utc),
        'add_to_outlook': outlook_calendar_link(booking, start_utc),
        'reminder_label': reminder_label or '',
        # Push copy. ScheduledNotification._push() mirrors the email to the
        # recipient's phones and skips anything without a body, so this is what
        # turns push on for booking notifications. The subject becomes the
        # title, so the body carries the detail rather than repeating it.
        'push_body': (
            f"{booking.skill.name if booking.skill else 'Your session'} with "
            f"{recipient['other_name']} — {_fmt_when(start_utc, recipient['tz'])}"
        ),
        'push_url': f"/session/{booking.id}",
    }


def retarget_booking_reminders(booking):
    """Refresh pending reminder notifications for a booking so their stored
    context shows the booking's current program name — used after a coach
    changes a booking's program. Already-sent notifications are left untouched
    and nothing new is sent. Returns the number of reminders updated.
    """
    from django.contrib.contenttypes.models import ContentType
    from notifications.models import ScheduledNotification

    ct = ContentType.objects.get_for_model(booking.__class__)
    name = booking.skill.name if booking.skill else 'your session'
    pending = ScheduledNotification.objects.filter(
        content_type=ct, object_id=booking.id, status='pending'
    )
    updated = 0
    for n in pending:
        if isinstance(n.context, dict) and n.context.get('skill_name') != name:
            n.context['skill_name'] = name
            n.save(update_fields=['context'])
            updated += 1
    return updated


def refresh_user_reminder_timezone(user):
    """Re-render the time in a user's still-pending reminders after their
    timezone changes.

    Clients have no timezone picker — the browser timezone is auto-detected and
    saved to their profile, which can happen AFTER reminders were queued (e.g. a
    booking made before the profile's timezone was ever set showed the time in
    UTC). Only `session_when` depends on the timezone; everything else in the
    stored context is timezone-independent. Already-sent reminders are left as-is.
    Returns the number updated.
    """
    from notifications.models import ScheduledNotification

    tzname = getattr(getattr(user, 'profile', None), 'timezone', 'UTC') or 'UTC'
    pending = ScheduledNotification.objects.filter(
        recipient_user=user, status='pending',
    ).select_related('content_type')

    updated = 0
    for n in pending:
        ctx = n.context
        if not isinstance(ctx, dict) or 'session_when' not in ctx:
            continue
        booking = n.related_object
        start_utc = session_start_utc(booking) if booking is not None else None
        if not start_utc:
            continue
        new_when = _fmt_when(start_utc, tzname)
        if ctx.get('session_when') != new_when:
            ctx['session_when'] = new_when
            n.context = ctx
            n.save(update_fields=['context'])
            updated += 1
    return updated


def send_join_nudge(booking):
    """Coach → client: 'I'm waiting, join now' with a one-click join link."""
    client = booking.learner
    if not client.email:
        return
    coach_user = booking.mentor.user
    from notifications.services import send_email
    send_email(
        to=client.email,
        subject=f"{_display_name(coach_user)} is waiting — join your session now",
        template='session_nudge',
        context={
            'recipient_name': _display_name(client),
            'coach_name': _display_name(coach_user),
            'skill_name': booking.skill.name if booking.skill else 'your session',
            'join_link': f"{settings.SITE_URL}/session/{booking.id}",
            'login_url': f"{settings.SITE_URL}/login",
        },
        reply_to=[coach_user.email] if coach_user.email else None,
    )

    # This one is worth interrupting for: the coach is sitting in the room now.
    # Sent directly rather than queued, so it pushes here rather than via
    # ScheduledNotification._push().
    try:
        from notifications.push import send_push
        send_push(
            client,
            title=f"{_display_name(coach_user)} is waiting",
            body=f"Join {booking.skill.name if booking.skill else 'your session'} now.",
            data={'url': f"/session/{booking.id}"},
        )
    except Exception:  # noqa: BLE001 — never let a push failure break the nudge
        logger.warning("Join-nudge push failed for booking %s", booking.id, exc_info=True)


# ── "Remind me to book my next session" — client opt-in from the summary email ──
REBOOK_OPTIN_SALT = 'rebook-reminder-optin'
REBOOK_OPTIN_MAX_AGE = 30 * 24 * 3600  # link stays valid 30 days


def make_rebook_optin_token(booking):
    from django.core import signing
    return signing.dumps({'b': booking.id}, salt=REBOOK_OPTIN_SALT)


def read_rebook_optin_token(token):
    from django.core import signing
    try:
        data = signing.loads(token, salt=REBOOK_OPTIN_SALT, max_age=REBOOK_OPTIN_MAX_AGE)
    except (signing.BadSignature, signing.SignatureExpired):
        return None
    return data.get('b')


def schedule_rebook_reminders(booking):
    """Queue 'book your next session' nudges to the CLIENT at +3, +5 and +7 days.
    Client-driven (they opt in from the summary email). Idempotent via dedupe
    keys, so clicking the link twice doesn't double-schedule."""
    client = booking.learner
    if not client or not client.email:
        return 0
    skill = booking.skill
    skill_name = skill.name if skill else 'your programme'
    book_link = f"{settings.SITE_URL}/book/{skill.id}" if skill else f"{settings.SITE_URL}/coaches"
    coach_name = _display_name(booking.mentor.user) if booking.mentor else ''
    now = dj_tz.now()
    scheduled = 0
    for days in (3, 5, 7):
        note = ScheduledNotification.queue(
            kind='rebook_reminder',
            recipient_email=client.email,
            recipient_user=client,
            subject=f"Ready to book your next {skill_name} session?",
            template='rebook_reminder',
            context={
                'recipient_name': _display_name(client),
                'skill_name': skill_name,
                'coach_name': coach_name,
                'book_link': book_link,
            },
            scheduled_for=now + timedelta(days=days),
            related=booking,
            dedupe_key=f"booking:{booking.id}:rebook:{days}",
        )
        if note:
            scheduled += 1

    # A day after the last client nudge, if they still haven't rebooked, tell the
    # coach so they can reach out personally. This is cancelled (like the client
    # nudges) the moment the client books — see cancel_rebook_reminders.
    coach_user = booking.mentor.user if booking.mentor else None
    if coach_user and coach_user.email:
        ScheduledNotification.queue(
            kind='rebook_coach_alert',
            recipient_email=coach_user.email,
            recipient_user=coach_user,
            subject=f"{_display_name(client)} hasn't rebooked yet",
            template='rebook_coach_alert',
            context={
                'recipient_name': _display_name(coach_user),
                'client_name': _display_name(client),
                'skill_name': skill_name,
                'manage_url': f"{settings.SITE_URL}/my-sessions",
            },
            scheduled_for=now + timedelta(days=8),
            related=booking,
            dedupe_key=f"booking:{booking.id}:rebook_coach_alert",
        )
    return scheduled


def cancel_rebook_reminders(user):
    """Stop nudging a client to rebook once they've actually booked again — cancels
    their pending rebook reminders AND the coach 'not rebooked' alert tied to them.
    Returns the number cancelled."""
    from notifications.models import ScheduledNotification as SN
    # The client's own pending nudges.
    n = SN.objects.filter(
        recipient_user=user, kind='rebook_reminder', status='pending',
    ).update(status='cancelled')
    # The coach alerts for bookings where this user was the client. Resolve via
    # the related booking so we only touch this client's alerts.
    from .models import SessionBooking
    from django.contrib.contenttypes.models import ContentType
    ct = ContentType.objects.get_for_model(SessionBooking)
    booking_ids = list(
        SessionBooking.objects.filter(learner=user).values_list('id', flat=True)
    )
    n += SN.objects.filter(
        content_type=ct, object_id__in=booking_ids,
        kind='rebook_coach_alert', status='pending',
    ).update(status='cancelled')
    return n


def send_session_summary_email(booking):
    """Email the AI summary of a finished session to BOTH parties, right after the
    summary is generated (so it lands within minutes of the session ending).

    Sent once per session (SessionSummary.summary_email_sent guards it — both
    participants POST the transcript at session end). Includes a "Book your next
    session" button. Best-effort — never raises into the caller.
    """
    summ = getattr(booking, 'ai_summary', None)
    if not summ or summ.summary_email_sent:
        return
    # Only for sessions that actually took place.
    if booking.status not in ('completed', 'held_offline'):
        return
    if not (summ.summary or summ.key_points or summ.action_items):
        return

    start_utc = session_start_utc(booking)
    skill = booking.skill
    skill_name = skill.name if skill else 'your session'
    book_link = f"{settings.SITE_URL}/book/{skill.id}" if skill else f"{settings.SITE_URL}/coaches"

    sent_any = False
    for r in _recipients(booking):
        if not r['email']:
            continue
        ctx = _context(booking, r, start_utc) if start_utc else {'recipient_name': r['name']}
        ctx.update({
            'skill_name': skill_name,
            'summary': summ.summary or '',
            'key_points': summ.key_points or [],
            'action_items': summ.action_items or [],
            'reflection_points': summ.reflection_points or [],
            'book_link': book_link,
        })
        # Only the client gets the "remind me to rebook" opt-in button.
        if r['role'] == 'client':
            ctx['remind_link'] = f"{settings.SITE_URL}/api/bookings/{booking.id}/rebook-reminders/opt-in/?t={make_rebook_optin_token(booking)}"
        try:
            note = ScheduledNotification.queue(
                kind='session_summary',
                recipient_email=r['email'],
                recipient_user=r['user'],
                subject=f"Your session summary — {skill_name}",
                template='session_summary',
                context=ctx,
                scheduled_for=dj_tz.now(),
                related=booking,
                dedupe_key=f"booking:{booking.id}:summary:{r['role']}",
            )
            if note and note.status == ScheduledNotification.STATUS_PENDING:
                note.send()
                sent_any = True
        except Exception as err:  # noqa: BLE001 — never block on email
            logger.warning("Booking %s: summary email to %s failed: %s", booking.id, r['email'], err)

    if sent_any:
        summ.summary_email_sent = True
        summ.save(update_fields=['summary_email_sent'])


def send_session_missed(booking):
    """A session was finalised as a no-show (it didn't take place). Tell both
    parties and invite the client to rebook. Sent once per booking (dedupe key +
    the pending-only send guard). Best-effort — never raises into the caller.
    """
    start_utc = session_start_utc(booking)
    if not start_utc:
        return
    skill_name = booking.skill.name if booking.skill else 'your session'
    for r in _recipients(booking):
        if not r['email']:
            continue
        ctx = _context(booking, r, start_utc)
        ctx['browse_link'] = f"{settings.SITE_URL}/skills"
        try:
            note = ScheduledNotification.queue(
                kind='session_missed',
                recipient_email=r['email'],
                recipient_user=r['user'],
                subject=f"Let's reschedule — {skill_name}",
                template='session_missed',
                context=ctx,
                scheduled_for=dj_tz.now(),
                related=booking,
                dedupe_key=f"booking:{booking.id}:missed:{r['role']}",
            )
            if note and note.status == ScheduledNotification.STATUS_PENDING:
                note.send()
        except Exception as err:  # noqa: BLE001 — never block finalisation on email
            logger.warning("Booking %s: missed-session email to %s failed: %s", booking.id, r['email'], err)


def send_session_thankyou(booking):
    """After a session completes, thank the client and show the coach's next open
    slots so they can rebook in one click. Sent once per booking (idempotent via
    booking.thankyou_sent). Best-effort — never raises into the caller.
    """
    if getattr(booking, 'thankyou_sent', False):
        return
    try:
        from notifications.services import send_email
        from .models import TimeSlot

        client = booking.learner
        coach_user = booking.mentor.user
        skill = booking.skill
        skill_name = skill.name if skill else 'your session'
        tz = getattr(booking.mentor, 'timezone', 'UTC') or 'UTC'

        slots = []
        if skill:
            open_slots = (
                TimeSlot.objects
                .filter(coach=booking.mentor, status='open', start_datetime__gt=dj_tz.now())
                .order_by('start_datetime')[:5]
            )
            for s in open_slots:
                slots.append({
                    'when': _fmt_when(s.start_datetime, tz),
                    'link': f"{settings.SITE_URL}/book/{skill.id}?slot={s.id}",
                })
        browse_link = (
            f"{settings.SITE_URL}/book/{skill.id}" if skill else f"{settings.SITE_URL}/coaches"
        )

        if client.email:
            send_email(
                to=client.email,
                subject=f"Thank you — your {skill_name} session with {_display_name(coach_user)}",
                template='session_thankyou',
                context={
                    'recipient_name': _display_name(client),
                    'coach_name': _display_name(coach_user),
                    'skill_name': skill_name,
                    'slots': slots,
                    'browse_link': browse_link,
                    'reflect_link': f"{settings.SITE_URL}/my-learning",
                },
                reply_to=[coach_user.email] if coach_user.email else None,
            )
    except Exception as exc:  # noqa: BLE001 — best-effort courtesy email
        logger.error("Thank-you email for booking %s failed: %s", booking.id, exc)
    finally:
        # Mark sent regardless, so the completion flow + the 15-min sweep never
        # re-send it. (A one-off courtesy email isn't worth retry loops.)
        booking.thankyou_sent = True
        booking.save(update_fields=['thankyou_sent'])


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

    # The client just booked — stop any "please rebook" nudges (and the coach
    # 'not rebooked' alert) they may have opted into after a previous session.
    try:
        if booking.learner:
            cancel_rebook_reminders(booking.learner)
    except Exception:  # noqa: BLE001 — never block a booking on this
        pass

    now = dj_tz.now()
    skill_name = booking.skill.name if booking.skill else 'your session'
    recipients = _recipients(booking)

    # Attach the PDF receipt to the buyer's confirmation when the booking was paid.
    invoice_attachment = None
    if booking.payment_status == 'paid' and booking.amount_paid and booking.amount_paid > 0:
        try:
            from .invoices import build_booking_invoice_pdf
            pdf, filename = build_booking_invoice_pdf(booking)
            invoice_attachment = [(filename, pdf, 'application/pdf')]
        except Exception as inv_err:  # noqa: BLE001 — never block emails on a receipt
            logger.warning("Booking %s: receipt generation failed: %s", booking.id, inv_err)

    # Attach a calendar (.ics) file so both parties can add the session to their
    # own calendar (Apple / Outlook / import). Best-effort.
    ics_attachment = None
    try:
        ics = build_ics(booking, start_utc)
        if ics:
            ics_attachment = [ics]
    except Exception as cal_err:  # noqa: BLE001
        logger.warning("Booking %s: .ics generation failed: %s", booking.id, cal_err)

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
            # Everyone gets the .ics; only the buyer (client) gets the receipt PDF.
            atts = list(ics_attachment or [])
            if r['role'] == 'client' and invoice_attachment:
                atts += invoice_attachment
            note.send(attachments=atts or None)

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


def send_booking_cancelled(booking, start_utc=None, cancelled_by=None):
    """
    Tell BOTH parties a session was cancelled. Sent immediately (a cancellation
    is useless if it arrives later), and best-effort — a failed email must never
    block the cancellation itself.

    `start_utc` should be captured BEFORE the slot is released, since cancelling
    unlinks booking.slot. `cancelled_by` is the User who cancelled, so each side
    can be told who did it.
    """
    start_utc = start_utc or session_start_utc(booking)
    if not start_utc:
        logger.warning("Booking %s has no resolvable start time; skipping cancellation emails.", booking.id)
        return

    skill_name = booking.skill.name if booking.skill else 'your session'
    canceller_name = _display_name(cancelled_by) if cancelled_by else ''
    refunded = booking.payment_status == 'refunded'

    for r in _recipients(booking):
        if not r['email']:
            continue
        ctx = _context(booking, r, start_utc)
        ctx.update({
            'canceller_name': canceller_name,
            'cancelled_by_you': bool(cancelled_by and r['user'] and cancelled_by.id == r['user'].id),
            'refunded': refunded,
            'browse_link': f"{settings.SITE_URL}/skills",
        })
        try:
            note = ScheduledNotification.queue(
                kind='booking_cancelled',
                recipient_email=r['email'],
                recipient_user=r['user'],
                subject=f"Session cancelled — {skill_name}",
                template='booking_cancelled',
                context=ctx,
                scheduled_for=dj_tz.now(),
                related=booking,
                dedupe_key=f"booking:{booking.id}:cancelled:{r['role']}",
            )
            if note and note.status == ScheduledNotification.STATUS_PENDING:
                note.send()
        except Exception as err:  # noqa: BLE001 — never block a cancellation
            logger.warning("Booking %s: cancellation email to %s failed: %s", booking.id, r['email'], err)


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


# ─── Group sessions ─────────────────────────────────────────────────────────────
def _group_recipients(session):
    """Coach + every booked attendee, with the data each reminder email needs."""
    coach_user = session.coach.user
    coach_tz = getattr(session.coach, 'timezone', 'UTC')
    recipients = [{
        'role': 'coach',
        'user': coach_user,
        'email': coach_user.email,
        'tz': coach_tz,
        'name': _display_name(coach_user),
        'other_name': 'your attendees',
        'manage_url': f"{settings.SITE_URL}/my-availability",
    }]
    booked = session.enrollments.filter(status='booked').select_related('learner')
    for enr in booked:
        learner = enr.learner
        recipients.append({
            'role': 'client',
            'user': learner,
            'email': learner.email,
            'tz': getattr(getattr(learner, 'profile', None), 'timezone', 'UTC'),
            'name': _display_name(learner),
            'other_name': _display_name(coach_user),
            'manage_url': f"{settings.SITE_URL}/my-learning",
        })
    return recipients


def _group_context(session, recipient, *, reminder_label=None):
    start_utc = session.start_datetime
    duration = int((session.end_datetime - start_utc).total_seconds() // 60) if session.end_datetime else 60
    return {
        'role': recipient['role'],
        'recipient_name': recipient['name'],
        'other_name': recipient['other_name'],
        'skill_name': session.title,
        'session_when': _fmt_when(start_utc, recipient['tz']),
        'duration': duration,
        'meeting_link': session.meeting_link or '',
        'join_link': session.meeting_link or f"{settings.SITE_URL}/group-session/{session.id}/call",
        'manage_url': recipient['manage_url'],
        'login_url': f"{settings.SITE_URL}/login",
        'reminder_label': reminder_label or '',
    }


def schedule_group_notifications(session):
    """
    Queue a confirmation + the reminder ladder for a group session's coach and
    all booked attendees. Idempotent (dedupe keys keyed by user id), so it's safe
    to call again whenever a new attendee books — existing recipients aren't
    re-notified, the new one is.
    """
    start_utc = session.start_datetime
    if not start_utc:
        logger.warning("Group session %s has no start time; skipping notifications.", session.id)
        return
    now = dj_tz.now()

    for r in _group_recipients(session):
        if not r['email']:
            continue
        uid = r['user'].id

        # Confirmation — sent immediately, once per recipient.
        note = ScheduledNotification.queue(
            kind='booking_confirmation',
            recipient_email=r['email'],
            recipient_user=r['user'],
            subject=f"Group session confirmed — {session.title}",
            template='booking_confirmation',
            context=_group_context(session, r),
            scheduled_for=now,
            related=session,
            dedupe_key=f"group:{session.id}:confirmation:{uid}",
        )
        if note and note.status == ScheduledNotification.STATUS_PENDING:
            note.send()

        # Reminder ladder.
        for kind, delta, label in REMINDER_LADDER:
            fire_at = start_utc - delta
            if fire_at <= now:
                continue
            subject = (
                f"Reminder — {session.title} {label}"
                if kind != 'reminder_start'
                else f"{session.title} is starting now"
            )
            ScheduledNotification.queue(
                kind=kind,
                recipient_email=r['email'],
                recipient_user=r['user'],
                subject=subject,
                template='session_reminder',
                context=_group_context(session, r, reminder_label=label),
                scheduled_for=fire_at,
                related=session,
                dedupe_key=f"group:{session.id}:{kind}:{uid}",
            )


def cancel_group_notifications(session):
    """Cancel all still-pending notifications for a group session (session-wide
    cancellation). Returns the number cancelled."""
    ct = ContentType.objects.get_for_model(session.__class__)
    return ScheduledNotification.objects.filter(
        content_type=ct, object_id=session.id,
        status=ScheduledNotification.STATUS_PENDING,
    ).update(status=ScheduledNotification.STATUS_CANCELLED, updated_at=dj_tz.now())


def cancel_group_enrollment_notifications(enrollment):
    """Cancel pending notifications for one attendee who left a group session,
    leaving other attendees' reminders intact. Returns the number cancelled."""
    session = enrollment.group_session
    ct = ContentType.objects.get_for_model(session.__class__)
    return ScheduledNotification.objects.filter(
        content_type=ct, object_id=session.id,
        recipient_user=enrollment.learner,
        status=ScheduledNotification.STATUS_PENDING,
    ).update(status=ScheduledNotification.STATUS_CANCELLED, updated_at=dj_tz.now())
