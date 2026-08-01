"""
Weekly AI insights email for each coach (F2).

For every coach, works out (a) clients they haven't interacted with recently and
(b) the most-discussed topics across their recent sessions, then queues one email
via the existing notification dispatcher. Idempotent per coach per ISO week, so
running it more than once in the same week never double-sends.

    python manage.py send_weekly_insights [--quiet] [--dry-run] [--force]

Normally fired weekly by the weekly-coach-insights.timer systemd unit.
"""
from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from profiles.models import UserProfile
from bookings.insights import compute_weekly_insights
from notifications.models import ScheduledNotification


class Command(BaseCommand):
    help = "Queue the weekly insights email for each coach."

    def add_arguments(self, parser):
        parser.add_argument('--quiet', action='store_true', help="Only print on changes.")
        parser.add_argument('--dry-run', action='store_true', help="Compute and print, but queue nothing.")
        parser.add_argument('--force', action='store_true', help="Ignore the per-week dedupe (re-send).")

    def handle(self, *args, **opts):
        quiet, dry_run, force = opts['quiet'], opts['dry_run'], opts['force']
        now = timezone.now()
        iso_year, iso_week, _ = now.isocalendar()
        manage_url = f"{settings.SITE_URL}/my-sessions"

        coaches = UserProfile.objects.filter(role='coach').select_related('user')
        queued = 0
        for coach in coaches:
            user = coach.user
            if not user.email:
                continue

            data = compute_weekly_insights(coach, now=now)
            name = f"{user.first_name} {user.last_name}".strip() or user.username

            if dry_run:
                self.stdout.write(
                    f"[dry-run] {user.email}: "
                    f"{len(data['neglected_clients'])} neglected, "
                    f"{len(data['top_topics'])} topics"
                )
                continue

            dedupe = '' if force else f"weekly-insights-{coach.id}-{iso_year}W{iso_week}"
            note = ScheduledNotification.queue(
                kind='weekly_insights',
                recipient_email=user.email,
                recipient_user=user,
                subject="Your weekly coaching insights",
                template='weekly_insights',
                context={
                    'recipient_name': name,
                    'neglected_clients': data['neglected_clients'],
                    'top_topics': data['top_topics'],
                    'manage_url': manage_url,
                },
                scheduled_for=now,
                dedupe_key=dedupe,
            )
            if note:
                queued += 1

        if not quiet or queued:
            self.stdout.write(self.style.SUCCESS(f"Weekly insights: queued {queued} email(s)."))
