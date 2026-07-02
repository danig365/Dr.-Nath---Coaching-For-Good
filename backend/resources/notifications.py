"""
Email notifications for the Resources "document delivery" flow (C1):
- notify_resource_shared: tell specific clients a coach shared a document.
- notify_submission_received: tell a coach a client sent them a document.

Emails link back to the platform (permission-checked download) rather than
attaching the file, so private documents aren't exposed in inboxes. Best-effort:
never raise into the request path.
"""
import logging

from django.conf import settings

logger = logging.getLogger(__name__)


def _name(user):
    if not user:
        return "there"
    full = f"{user.first_name} {user.last_name}".strip()
    return full or user.username


def notify_resource_shared(resource):
    """Email each client a 'specific'-visibility resource was shared with."""
    if resource.visibility != 'specific':
        return
    from notifications.services import send_email
    coach_user = resource.coach.user
    coach_name = _name(coach_user)
    link = f"{settings.SITE_URL}/resources"
    for client in resource.shared_clients.all():
        if not client.email:
            continue
        send_email(
            to=client.email,
            subject=f"{coach_name} shared a document with you",
            template='resource_shared',
            context={
                'recipient_name': _name(client),
                'coach_name': coach_name,
                'title': resource.title,
                'note': resource.description or '',
                'link': link,
            },
            reply_to=[coach_user.email] if coach_user.email else None,
        )


def notify_submission_received(submission):
    """Email the coach that a client submitted a document to them."""
    from notifications.services import send_email
    coach_user = submission.coach.user
    if not coach_user.email:
        return
    send_email(
        to=coach_user.email,
        subject=f"New document from {_name(submission.client)}",
        template='submission_received',
        context={
            'recipient_name': _name(coach_user),
            'client_name': _name(submission.client),
            'title': submission.title,
            'note': submission.note or '',
            'link': f"{settings.SITE_URL}/my-resources",
        },
        reply_to=[submission.client.email] if submission.client.email else None,
    )
