"""
Create (or update) Dr. Nathalie's coach account for launch.

Idempotent: safe to re-run. Creates the user if missing, ensures the profile is
an approved/verified coach in South Africa time, fills a launch bio + specialties
where empty (never overwrites real data she later edits), and ensures she has at
least one bookable coaching offering.

Usage:
    python manage.py create_launch_coach
    python manage.py create_launch_coach --username drnath --email nathalie@dr-nath.com
"""
from django.core.management.base import BaseCommand
from django.db import transaction

from profiles.models import CustomUser
from skills.models import Skill

SA_TZ = "Africa/Johannesburg"

LAUNCH_BIO = (
    "Dr. Nathalie is the founder of Coaching for Good (C4G), a practice built on "
    "three principles — clarity, growth, and impact. Through a warm, "
    "client-centered approach she partners with individuals, teams, and "
    "organisations to turn insight into action: clarifying goals, building "
    "confident leadership, and creating lasting positive change. Whether you are "
    "navigating a career transition, stepping into a bigger role, or investing in "
    "your team's development, Dr. Nathalie offers a supportive, structured space "
    "to help you move forward with purpose."
)
SPECIALTIES = ["Executive Coaching", "Leadership Development", "Life Coaching",
               "Career Transition", "Team & Organisational Coaching"]
INDUSTRIES = ["Nonprofit & Social Impact", "Corporate & Business", "Education"]
LANGUAGES = ["English"]

OFFERING = {
    "name": "Executive & Life Coaching",
    "price": "50.00",
    "category": "Coaching",
    "level": "All levels",
    "description": ("One-on-one coaching to build clarity, confidence, and momentum "
                    "— for your career, leadership, and life goals."),
}


class Command(BaseCommand):
    help = "Create/refresh Dr. Nathalie's coach account for launch."

    def add_arguments(self, parser):
        parser.add_argument("--username", default="drnath")
        parser.add_argument("--email", default="nathalie@dr-nath.com")
        parser.add_argument("--password", default="Coaching4Good!2026",
                            help="Temp password (only set when the account is first created).")

    @transaction.atomic
    def handle(self, *args, **opts):
        username, email, password = opts["username"], opts["email"], opts["password"]

        user, created = CustomUser.objects.get_or_create(
            username=username, defaults={"email": email}
        )
        if created:
            user.email = email
            user.set_password(password)
            user.save()
            self.stdout.write(self.style.SUCCESS(f"+ created user '{username}' (temp password: {password})"))
        else:
            self.stdout.write(f"user '{username}' already exists — leaving password unchanged")

        profile = user.profile  # created by post_save signal
        profile.role = "coach"
        profile.approval_status = "approved"
        profile.is_verified = True
        if profile.timezone in ("", "UTC", None):
            profile.timezone = SA_TZ
        if not profile.bio:
            profile.bio = LAUNCH_BIO
        if not profile.specialties:
            profile.specialties = SPECIALTIES
        if not profile.industries:
            profile.industries = INDUSTRIES
        if not profile.languages:
            profile.languages = LANGUAGES
        profile.save()
        self.stdout.write(self.style.SUCCESS(
            f"  coach profile #{profile.id}: approved+verified, tz={profile.timezone}"
        ))

        skill, s_created = Skill.objects.get_or_create(
            profile=profile, name=OFFERING["name"],
            defaults={
                "price": OFFERING["price"], "category": OFFERING["category"],
                "level": OFFERING["level"], "description": OFFERING["description"],
                "active": True,
            },
        )
        self.stdout.write(self.style.SUCCESS(
            f"  offering: '{skill.name}' (${skill.price}) {'created' if s_created else 'already exists'}"
        ))
        self.stdout.write(self.style.MIGRATE_HEADING(
            f"Done. Next: python manage.py setup_coach_for_launch --coach {username}"
        ))
