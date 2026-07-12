"""
Email notifications for the Template Builder. Both link to the /forms page
(sign-in required). Best-effort — never raise into the request path.
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
        logger.error("Form email '%s' failed: %s", kwargs.get('template'), exc)


def notify_form_assigned(assignment):
    """To the client: a coach has sent them a form/survey to complete."""
    client = assignment.client
    if not client.email:
        return
    coach_user = assignment.coach.user
    _send(
        to=client.email,
        subject=f"Please complete: {assignment.title}",
        template='form_assigned',
        context={
            'recipient_name': _name(client),
            'coach_name': _name(coach_user),
            'title': assignment.title,
            'description': assignment.description or '',
            'question_count': len(assignment.questions_snapshot or []),
            'link': f"{settings.SITE_URL}/forms",
        },
        reply_to=[coach_user.email] if coach_user.email else None,
    )


def notify_form_submitted(assignment):
    """To the coach: the client has completed and returned the form."""
    coach_user = assignment.coach.user
    if not coach_user.email:
        return
    _send(
        to=coach_user.email,
        subject=f"{_name(assignment.client)} completed: {assignment.title}",
        template='form_submitted',
        context={
            'recipient_name': _name(coach_user),
            'client_name': _name(assignment.client),
            'title': assignment.title,
            'link': f"{settings.SITE_URL}/forms",
        },
        reply_to=[assignment.client.email] if assignment.client.email else None,
    )
