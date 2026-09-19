"""
Send all due notifications.

Designed to be run frequently (every minute via cron / a systemd timer). It
picks up pending notifications whose `scheduled_for` has passed, plus failed
ones still within their retry budget, and sends them. Idempotent and safe to
run concurrently-ish for a single small instance.
"""
from django.core.management.base import BaseCommand
from django.db.models import Q
from django.utils import timezone

from notifications.models import ScheduledNotification

MAX_ATTEMPTS = 3


class Command(BaseCommand):
    help = "Send all due notifications (pending + retryable failures)."

    def add_arguments(self, parser):
        parser.add_argument(
            '--limit', type=int, default=200,
            help="Max notifications to process in one run (default 200).",
        )
        parser.add_argument(
            '--dry-run', action='store_true',
            help="List what would be sent without sending.",
        )
        parser.add_argument(
            '--quiet', action='store_true',
            help="Only print when something is actually sent (keeps cron/timer logs clean).",
        )

    # A session summary whose email never went out — the generating process can
    # die between storing the summary and queueing the email (the transcription
    # worker used to be killed 10s after a call ended), and a session completed
    # later by complete_past_sessions is only eligible for the email afterwards.
    # This sweep is the safety net: without it, nobody ever notices.
    SUMMARY_SWEEP_DAYS = 7

    def _sweep_missing_summary_emails(self, now, dry_run, quiet):
        from datetime import timedelta
        from bookings.models import SessionSummary
        from bookings.notifications import send_session_summary_email

        stale = (
            SessionSummary.objects
            .select_related('booking__mentor__user', 'booking__learner', 'booking__skill')
            .filter(summary_email_sent=False,
                    created_at__gte=now - timedelta(days=self.SUMMARY_SWEEP_DAYS),
                    booking__status__in=('completed', 'held_offline'))
        )
        for summ in stale:
            if not (summ.summary or summ.key_points or summ.action_items):
                continue
            if dry_run:
                self.stdout.write(f"[dry-run] would send the missing summary email for booking {summ.booking_id}")
                continue
            send_session_summary_email(summ.booking)
            summ.refresh_from_db(fields=['summary_email_sent'])
            if summ.summary_email_sent:
                self.stdout.write(self.style.SUCCESS(
                    f"Sent the missing summary email for booking {summ.booking_id}."))
            elif not quiet:
                self.stdout.write(self.style.WARNING(
                    f"Booking {summ.booking_id}: summary email still not sent."))

    def handle(self, *args, **options):
        now = timezone.now()
        limit = options['limit']
        dry_run = options['dry_run']
        quiet = options['quiet']

        self._sweep_missing_summary_emails(now, dry_run, quiet)

        due = (
            ScheduledNotification.objects
            .filter(scheduled_for__lte=now)
            .filter(
                Q(status=ScheduledNotification.STATUS_PENDING) |
                Q(status=ScheduledNotification.STATUS_FAILED,
                  attempts__lt=MAX_ATTEMPTS)
            )
            .order_by('scheduled_for')[:limit]
        )

        total = due.count()
        if total == 0:
            if not quiet:
                self.stdout.write("No notifications due.")
            return

        if dry_run:
            for n in due:
                self.stdout.write(f"[dry-run] would send {n.kind} → {n.recipient_email} (due {n.scheduled_for:%Y-%m-%d %H:%M})")
            self.stdout.write(self.style.WARNING(f"{total} due (dry run, nothing sent)."))
            return

        sent = failed = 0
        for n in due:
            ok = n.send()
            if ok:
                sent += 1
            else:
                failed += 1

        msg = f"Processed {total}: {sent} sent, {failed} failed."
        self.stdout.write(self.style.SUCCESS(msg) if failed == 0 else self.style.WARNING(msg))
