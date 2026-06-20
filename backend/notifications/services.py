"""
Reusable email service.

A single entry point — `send_email()` — that any feature can call to send a
branded HTML + plain-text email from a template pair. Templates live in
`notifications/templates/emails/<name>.html` and `<name>.txt` and extend the
shared `emails/base.html` / `emails/base.txt` layouts.

Design goals:
  - One call site shape everywhere: send_email(to, subject, template, context).
  - Always multipart (HTML + text) for good deliverability and fallback.
  - Never raise into the caller by default — sending mail should not break a
    booking/payment flow. Failures are logged and returned as False.
"""
import logging

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string
from django.template import TemplateDoesNotExist

logger = logging.getLogger(__name__)


def render_email(template, context=None):
    """
    Render a template pair into (text_body, html_body).

    The `.txt` template is required (plain-text fallback). The `.html` template
    is optional — if absent, the email is sent as text-only.
    """
    context = context or {}
    # Make the site URL available to every template for building links.
    context.setdefault('site_url', getattr(settings, 'SITE_URL', ''))

    text_body = render_to_string(f'emails/{template}.txt', context)
    try:
        html_body = render_to_string(f'emails/{template}.html', context)
    except TemplateDoesNotExist:
        html_body = None
    return text_body, html_body


def send_email(to, subject, template, context=None, from_email=None,
               reply_to=None, fail_silently=True):
    """
    Send a branded email rendered from a template pair.

    Args:
        to: a single address or an iterable of addresses.
        subject: the email subject line.
        template: base name of the template pair under `emails/`
            (e.g. 'booking_confirmation' → booking_confirmation.html/.txt).
        context: dict passed to both templates.
        from_email: overrides DEFAULT_FROM_EMAIL.
        reply_to: optional list of reply-to addresses.
        fail_silently: when True (default), log and return False on error
            instead of raising — so callers in request paths stay safe.

    Returns:
        True if the message was handed to the backend, else False.
    """
    recipients = [to] if isinstance(to, str) else [a for a in (to or []) if a]
    if not recipients:
        logger.warning("send_email('%s') skipped: no valid recipients.", template)
        return False

    try:
        text_body, html_body = render_email(template, context)
        msg = EmailMultiAlternatives(
            subject=subject,
            body=text_body,
            from_email=from_email or settings.DEFAULT_FROM_EMAIL,
            to=recipients,
            reply_to=reply_to,
        )
        if html_body:
            msg.attach_alternative(html_body, 'text/html')
        msg.send(fail_silently=False)
        logger.info("Email '%s' sent to %s", template, ", ".join(recipients))
        return True
    except Exception as exc:  # noqa: BLE001 — we deliberately catch all
        logger.error("Failed to send email '%s' to %s: %s",
                     template, ", ".join(recipients), exc)
        if not fail_silently:
            raise
        return False
