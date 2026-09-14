"""Assignment helpers that other apps can call without importing the models."""
import logging

logger = logging.getLogger(__name__)


def assign_signup_forms(user):
    """
    Send every form marked `auto_assign_on_signup` to a newly registered client.

    Dr Nath asked for the intake form to be "the immediate document a new client
    should receive once she/he has registered" — automated rather than something
    she has to remember after each sign-up.

    Only clients get them: a coach registering is not anyone's client. Idempotent
    per template, so a retried registration cannot send the same form twice.

    Never raises. A failure here must not cost someone their account — the
    registration has already succeeded by the time this runs.
    """
    from .models import FormAssignment, FormTemplate
    from .notifications import notify_form_assigned

    try:
        profile = getattr(user, 'profile', None)
        if not profile or profile.role != 'client':
            return 0

        templates = FormTemplate.objects.filter(
            auto_assign_on_signup=True, active=True
        ).select_related('coach__user')

        sent = 0
        for t in templates:
            assignment, created = FormAssignment.objects.get_or_create(
                template=t,
                client=user,
                defaults={
                    'coach': t.coach,
                    'title': t.title,
                    'description': t.description,
                    'kind': t.kind,
                    # Snapshot, exactly as a manual assignment does, so later
                    # edits to the template never change a form already sent.
                    'questions_snapshot': t.questions,
                },
            )
            if not created:
                continue
            sent += 1
            try:
                notify_form_assigned(assignment)
            except Exception:  # noqa: BLE001 — the form is assigned either way
                logger.warning(
                    "Could not email intake form %s to %s", t.id, user.id, exc_info=True
                )
        return sent
    except Exception:  # noqa: BLE001
        logger.exception("assign_signup_forms failed for user %s", getattr(user, 'id', None))
        return 0
