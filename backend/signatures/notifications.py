"""
Email notifications for the e-signature flow. All link back to /agreements
(secure, sign-in required); the completion email additionally attaches the
final signed PDF. Best-effort — never raise into the request path.
"""
import logging

from django.conf import settings

logger = logging.getLogger(__name__)


def _name(user):
    if not user:
        return "there"
    full = f"{user.first_name} {user.last_name}".strip()
    return full or user.username


def _send(**kwargs):
    from notifications.services import send_email
    try:
        send_email(**kwargs)
    except Exception as exc:  # noqa: BLE001
        logger.error("Signature email '%s' failed: %s", kwargs.get('template'), exc)


LINK = None  # resolved per-call from settings.SITE_URL


def notify_signature_request(doc):
    """To the client: a document is waiting for their signature."""
    client = doc.client
    if not client.email:
        return
    coach_user = doc.coach.user
    _send(
        to=client.email,
        subject=f"Please sign: {doc.title}",
        template='signature_request',
        context={
            'recipient_name': _name(client),
            'coach_name': _name(coach_user),
            'title': doc.title,
            'message': doc.message or '',
            'link': f"{settings.SITE_URL}/agreements",
        },
        reply_to=[coach_user.email] if coach_user.email else None,
    )


def notify_client_signed(doc):
    """To the coach: the client signed; counter-signature needed."""
    coach_user = doc.coach.user
    if not coach_user.email:
        return
    _send(
        to=coach_user.email,
        subject=f"{_name(doc.client)} signed: {doc.title}",
        template='signature_signed',
        context={
            'recipient_name': _name(coach_user),
            'client_name': _name(doc.client),
            'title': doc.title,
            'link': f"{settings.SITE_URL}/agreements",
        },
        reply_to=[doc.client.email] if doc.client.email else None,
    )


def notify_completed(doc):
    """To both parties: fully signed. Attaches the signed PDF if available."""
    attachments = None
    if doc.signed_file:
        try:
            doc.signed_file.open('rb')
            data = doc.signed_file.read()
            attachments = [(f"{doc.title} (signed).pdf", data, 'application/pdf')]
        except Exception:  # noqa: BLE001
            attachments = None
        finally:
            try:
                doc.signed_file.close()
            except Exception:  # noqa: BLE001
                pass

    coach_user = doc.coach.user
    for user in (doc.client, coach_user):
        if not user.email:
            continue
        _send(
            to=user.email,
            subject=f"Signed & completed: {doc.title}",
            template='signature_completed',
            context={
                'recipient_name': _name(user),
                'title': doc.title,
                'client_name': _name(doc.client),
                'coach_name': _name(coach_user),
                'link': f"{settings.SITE_URL}/agreements",
            },
            attachments=attachments,
        )


def notify_declined(doc):
    """To the coach: the client declined to sign."""
    coach_user = doc.coach.user
    if not coach_user.email:
        return
    _send(
        to=coach_user.email,
        subject=f"Declined: {doc.title}",
        template='signature_declined',
        context={
            'recipient_name': _name(coach_user),
            'client_name': _name(doc.client),
            'title': doc.title,
            'reason': doc.decline_reason or '',
            'link': f"{settings.SITE_URL}/agreements",
        },
    )
