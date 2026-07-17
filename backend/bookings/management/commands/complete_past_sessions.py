"""
Mark accepted 1:1 bookings as completed once their scheduled time (plus the
rejoin window) has fully passed.

Sessions are normally completed by the call page when the booked time runs out,
but if neither party is on the page at that moment the booking stays 'accepted'.
This safety-net sweep finalises those so records/analytics stay accurate. It
mirrors the rejoin window (N3) so a session that could still be reconnected and
continued on the same link is never finalised early.

    python manage.py complete_past_sessions [--quiet]
"""
from datetime import datetime, timezone as dt_timezone, timedelta

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db.models import Q
from django.utils import timezone

from bookings.models import SessionBooking

# Only finalise once the whole rejoin window has closed — mirrors
# SESSION_REJOIN_MINUTES / SESSION_REJOIN_MS on the frontend.
GRACE = timedelta(minutes=settings.SESSION_REJOIN_MINUTES)


class Command(BaseCommand):
    help = "Complete accepted bookings whose scheduled time (plus grace) has passed."

    def add_arguments(self, parser):
        parser.add_argument('--quiet', action='store_true', help="Only print on changes.")

    def _end_time(self, booking):
        slot = booking.slot
        if slot and slot.end_datetime:
            return slot.end_datetime
        if booking.session_date and booking.session_time:
            naive = datetime.combine(booking.session_date, booking.session_time)
            return naive.replace(tzinfo=dt_timezone.utc) + timedelta(minutes=booking.duration or 60)
        return None

    def handle(self, *args, **options):
        quiet = options['quiet']
        now = timezone.now()
        cutoff = now - GRACE

        # Only consider accepted bookings that have plausibly ended already.
        qs = (
            SessionBooking.objects
            .filter(status='accepted')
            .filter(Q(slot__end_datetime__lt=cutoff) | Q(slot__isnull=True))
            .select_related('slot')
        )

        from bookings.services import finalize_status

        completed = 0
        no_show = 0
        for booking in qs:
            end = self._end_time(booking)
            if end and now >= end + GRACE:
                booking.status = finalize_status(booking)
                booking.save(update_fields=['status'])
                if booking.status == 'completed':
                    completed += 1
                    # Thank the client + invite them to rebook (best-effort, once).
                    from bookings.notifications import send_session_thankyou
                    send_session_thankyou(booking)
                else:
                    no_show += 1

        if completed or no_show or not quiet:
            self.stdout.write(self.style.SUCCESS(
                f"Finalised past sessions: {completed} completed, {no_show} no-show."))
