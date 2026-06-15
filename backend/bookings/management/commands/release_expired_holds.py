"""
Release time slots whose checkout hold has expired.

Run periodically (e.g. cron / Celery beat every minute) so abandoned checkouts
free up their slots even if no client hits the availability endpoint. The
listing endpoint also releases lazily, so this is a safety net.

    python manage.py release_expired_holds
"""
from django.core.management.base import BaseCommand

from bookings.services import release_expired_holds


class Command(BaseCommand):
    help = "Return expired checkout holds (1:1 slots and group seats) to available."

    def handle(self, *args, **options):
        count = release_expired_holds()
        self.stdout.write(self.style.SUCCESS(f"Released {count} expired hold(s)."))
