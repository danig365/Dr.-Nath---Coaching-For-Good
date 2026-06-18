"""
One-shot launch setup for Dr. Nath's coaching availability.

Seeds the recurring weekly schedule Nathalie sent, generates bookable slots
across the launch season (4 Jul – 10 Dec 2026), and adds her two one-off days.
Idempotent: re-running will not duplicate rules or slots, and never touches a
booked/held/blocked slot.

Usage:
    python manage.py setup_coach_for_launch --coach <username>
    python manage.py setup_coach_for_launch --coach <username> --dry-run
"""
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from profiles.models import CustomUser
from skills.models import Availability
from bookings.models import TimeSlot
from bookings.services import generate_slots_for_coach

SA_TZ = "Africa/Johannesburg"

# Recurring weekly windows (local SA time), 60-minute slots.
#   day, start, end
WEEKLY_WINDOWS = [
    ("Saturday", time(8, 0),  time(12, 0)),   # 08:00–12:00
    ("Saturday", time(18, 0), time(20, 0)),   # 18:00–20:00
    ("Thursday", time(7, 0),  time(10, 0)),   # 07:00–10:00
]

# Range to generate recurring slots across (inclusive). Saturdays naturally
# begin 4 Jul; the first Thursday on/after this start is 9 Jul.
RANGE_START = date(2026, 7, 4)
RANGE_END = date(2026, 12, 10)

# One-off days (not weekly): each a list of (start, end) local windows.
# Fri 7 Aug morning start mirrors her Saturday format (same "– 12 pm" morning and
# identical "6 pm – 8 pm" evening), so the omitted start is taken as 08:00.
ONE_OFF_DAYS = {
    date(2026, 8, 7):  [(time(8, 0), time(12, 0)), (time(18, 0), time(20, 0))],   # Friday
    date(2026, 11, 16): [(time(8, 0), time(12, 0)), (time(18, 0), time(20, 0))],  # Monday
}

SLOT_MINUTES = 60


class Command(BaseCommand):
    help = "Seed Dr. Nath's launch availability (schedule + slots) for a coach account."

    def add_arguments(self, parser):
        parser.add_argument("--coach", required=True, help="Username of the coach account.")
        parser.add_argument("--dry-run", action="store_true", help="Report what would change without writing.")

    @transaction.atomic
    def handle(self, *args, **opts):
        username = opts["coach"]
        dry = opts["dry_run"]

        try:
            user = CustomUser.objects.select_related("profile").get(username=username)
        except CustomUser.DoesNotExist:
            raise CommandError(f"No user named '{username}'.")
        profile = getattr(user, "profile", None)
        if not profile or profile.role != "coach":
            raise CommandError(f"'{username}' is not a coach (role={getattr(profile, 'role', None)}).")

        tz = ZoneInfo(SA_TZ)
        self.stdout.write(self.style.MIGRATE_HEADING(f"Coach: {username} (profile #{profile.id})"))

        # 1. Timezone → South Africa.
        if profile.timezone != SA_TZ:
            self.stdout.write(f"  timezone: {profile.timezone} → {SA_TZ}")
            if not dry:
                profile.timezone = SA_TZ
                profile.save(update_fields=["timezone"])
        else:
            self.stdout.write(f"  timezone already {SA_TZ}")

        # 2. Recurring weekly windows (idempotent).
        for day, start, end in WEEKLY_WINDOWS:
            exists = Availability.objects.filter(
                mentor=profile, day_of_week=day, start_time=start, end_time=end
            ).exists()
            if exists:
                self.stdout.write(f"  rule exists: {day} {start:%H:%M}-{end:%H:%M}")
                continue
            self.stdout.write(self.style.SUCCESS(f"  + rule: {day} {start:%H:%M}-{end:%H:%M} ({SLOT_MINUTES}m)"))
            if not dry:
                Availability.objects.create(
                    mentor=profile, day_of_week=day, start_time=start, end_time=end,
                    slot_duration=SLOT_MINUTES, buffer_minutes=0, is_available=True,
                )

        # 3. Generate slots across the launch range.
        if dry:
            self.stdout.write(f"  would generate slots {RANGE_START} → {RANGE_END}")
        else:
            result = generate_slots_for_coach(profile, start_date=RANGE_START, end_date=RANGE_END)
            self.stdout.write(self.style.SUCCESS(
                f"  generated: {result['created']} created, {result['skipped']} skipped"
            ))

        # 4. One-off days as manual slots (skip any that already exist).
        created_oneoff = 0
        for day, windows in ONE_OFF_DAYS.items():
            for start, end in windows:
                cursor = datetime.combine(day, start, tzinfo=tz)
                window_end = datetime.combine(day, end, tzinfo=tz)
                while cursor + timedelta(minutes=SLOT_MINUTES) <= window_end:
                    slot_end = cursor + timedelta(minutes=SLOT_MINUTES)
                    start_utc = cursor.astimezone(ZoneInfo("UTC"))
                    end_utc = slot_end.astimezone(ZoneInfo("UTC"))
                    dup = TimeSlot.objects.filter(
                        coach=profile, start_datetime=start_utc, end_datetime=end_utc
                    ).exists()
                    if not dup:
                        created_oneoff += 1
                        self.stdout.write(self.style.SUCCESS(
                            f"  + one-off: {day} {cursor:%H:%M}-{slot_end:%H:%M} SA"
                        ))
                        if not dry:
                            TimeSlot.objects.create(
                                coach=profile, start_datetime=start_utc, end_datetime=end_utc,
                                status="open", source="manual",
                            )
                    cursor = slot_end

        self.stdout.write(self.style.MIGRATE_HEADING(
            f"Done. One-off slots {'(would add) ' if dry else ''}added: {created_oneoff}"
        ))
        if dry:
            raise CommandError("Dry run — rolling back.")  # abort the atomic block
