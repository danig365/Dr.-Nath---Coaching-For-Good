"""
Create (or update) Dr Nath's health-and-wellness intake form.

The questions come from her own PDF, "INTAKE FORM HEALTH AND WELLNESS
COACHING". Kept as a command rather than a data migration so the wording can be
corrected by re-running it, without inventing a migration each time.
"""
from django.core.management.base import BaseCommand

from formbuilder.models import FormTemplate
from profiles.models import UserProfile

TITLE = "Intake Form — Health and Wellness Coaching"

QUESTIONS = [
    {
        "id": "concerns",
        "label": "What are your health and wellness concerns?",
        "type": "long_text",
        "required": True,
    },
    {
        "id": "motivation",
        "label": "How motivated are you to address those concerns through coaching?",
        # Her PDF gives a 1–10 line with 1 = not motivated at all, 5 =
        # moderately motivated, 10 = highly motivated.
        "type": "rating",
        "max": 10,
        "required": True,
        "help": "1 = not motivated at all · 5 = moderately motivated · 10 = highly motivated",
    },
    {
        "id": "motivation_detail",
        "label": "Please expand on the answer you gave above.",
        "type": "long_text",
        "required": False,
    },
    {
        "id": "priority",
        "label": "What is your single biggest priority for your coaching engagement with Dr. Nath?",
        "type": "long_text",
        "required": True,
    },
    {
        "id": "other",
        "label": "Anything else you'd like the coach to address?",
        "type": "long_text",
        "required": False,
        "help": "Any remarks or questions of importance to you.",
    },
]


class Command(BaseCommand):
    help = "Seed Dr Nath's health-and-wellness intake form and auto-send it to new clients."

    def add_arguments(self, parser):
        parser.add_argument(
            "--coach", default="drnath",
            help="Username of the coach who owns the form (default: drnath).",
        )
        parser.add_argument(
            "--no-auto", action="store_true",
            help="Create it without turning on automatic sending to new clients.",
        )

    def handle(self, *args, **opts):
        try:
            coach = UserProfile.objects.select_related("user").get(
                user__username=opts["coach"], role="coach"
            )
        except UserProfile.DoesNotExist:
            self.stderr.write(self.style.ERROR(f"No coach named {opts['coach']!r}."))
            return

        template, created = FormTemplate.objects.update_or_create(
            coach=coach,
            title=TITLE,
            defaults={
                "description": (
                    "A few questions before we begin, so Dr Nath can prepare for "
                    "your first session."
                ),
                "kind": FormTemplate.KIND_INTAKE,
                "questions": QUESTIONS,
                "active": True,
                "auto_assign_on_signup": not opts["no_auto"],
            },
        )

        self.stdout.write(self.style.SUCCESS(
            f"{'Created' if created else 'Updated'} {template.title!r} "
            f"for {coach.user.username} "
            f"({len(QUESTIONS)} questions, "
            f"auto-send {'on' if template.auto_assign_on_signup else 'off'})."
        ))
