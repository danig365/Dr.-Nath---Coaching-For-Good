"""
Weekly AI habit nudge for each client (F3 — 'sustain' habits).

For every client with active habits, works out their recent adherence (streaks +
consistency), asks the AI to write a short warm encouragement, and queues one
email via the existing dispatcher. Idempotent per client per ISO week.

    python manage.py send_habit_nudges [--quiet] [--dry-run] [--force]

Normally fired weekly by the habit-nudges.timer systemd unit.
"""
from collections import defaultdict

from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from bookings.models import Habit
from bookings.habit_ai import habit_nudge_message
from bookings.views import _serialize_habit
from notifications.models import ScheduledNotification


def _display_name(user):
    full = f"{user.first_name} {user.last_name}".strip()
    return full or user.username or user.email


class Command(BaseCommand):
    help = "Queue a weekly AI habit-encouragement email for each client with active habits."

    def add_arguments(self, parser):
        parser.add_argument('--quiet', action='store_true', help="Only print on changes.")
        parser.add_argument('--dry-run', action='store_true', help="Compute and print, but queue nothing.")
        parser.add_argument('--force', action='store_true', help="Ignore the per-week dedupe (re-send).")

    def handle(self, *args, **opts):
        quiet, dry_run, force = opts['quiet'], opts['dry_run'], opts['force']
        now = timezone.now()
        iso_year, iso_week, _ = now.isocalendar()
        manage_url = f"{settings.SITE_URL}/habits"

        by_client = defaultdict(list)
        for h in Habit.objects.filter(active=True).select_related('client'):
            by_client[h.client_id].append(h)

        queued = 0
        for hlist in by_client.values():
            client = hlist[0].client
            if not client.email:
                continue

            stats = []
            for h in hlist:
                s = _serialize_habit(h)
                stats.append({
                    'title': s['title'],
                    'category': s['category'],
                    'streak': s['streak'],
                    'consistency': s['consistency'],
                })

            name = _display_name(client)
            message = habit_nudge_message(client_name=name, habit_stats=stats)
            if not message:  # AI off / nothing to say — skip rather than send an empty nudge
                continue

            if dry_run:
                self.stdout.write(f"[dry-run] {client.email}: {len(stats)} habit(s) → nudge ready")
                continue

            dedupe = '' if force else f"habit-nudge-{client.id}-{iso_year}W{iso_week}"
            note = ScheduledNotification.queue(
                kind='habit_nudge',
                recipient_email=client.email,
                recipient_user=client,
                subject="A little nudge on your habits",
                template='habit_nudge',
                context={
                    'recipient_name': name,
                    'message': message,
                    'habits': stats,
                    'manage_url': manage_url,
                },
                scheduled_for=now,
                dedupe_key=dedupe,
            )
            if note:
                queued += 1

        if not quiet or queued:
            self.stdout.write(self.style.SUCCESS(f"Habit nudges: queued {queued} email(s)."))
