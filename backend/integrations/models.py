from django.db import models

from profiles.models import UserProfile


class GoogleCalendarAccount(models.Model):
    """A user's connected Google Calendar (two-way sync).

    One per user (coach OR client). Holds the OAuth refresh token (long-lived)
    used to mint access tokens on demand, plus per-user sync preferences.
    Created when the user completes the OAuth consent flow; deleted on
    disconnect. For clients, only outbound sync (`sync_bookings_out`) applies —
    `block_busy_times` is coach-only.
    """
    profile = models.OneToOneField(
        UserProfile, on_delete=models.CASCADE, related_name='google_calendar',
    )
    # The Google account / primary calendar id (an email address).
    google_email = models.EmailField(blank=True, default='')
    calendar_id = models.CharField(max_length=255, default='primary')

    # OAuth tokens. The refresh token is the durable credential; the access
    # token + expiry are a cache we refresh as needed.
    refresh_token = models.TextField(blank=True, default='')
    access_token = models.TextField(blank=True, default='')
    token_expiry = models.DateTimeField(null=True, blank=True)

    # Sync preferences (used by Phase 2/3).
    sync_bookings_out = models.BooleanField(
        default=True, help_text="Create/update platform bookings as events on this calendar.")
    block_busy_times = models.BooleanField(
        default=True, help_text="Hide platform slots that clash with this calendar's busy times.")

    # If Google revokes access (password change, user removed the app), we flag
    # this so the UI can prompt the coach to reconnect.
    is_active = models.BooleanField(default=True)
    last_error = models.TextField(blank=True, default='')

    connected_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Google Calendar for {self.profile.user.username} ({self.google_email or 'unlinked'})"


class CalendarEventLink(models.Model):
    """Links a platform booking to the Google Calendar event we created for it on
    a specific connected calendar. Lets us update/delete that event later.

    One row per (booking, account) — a booking can sync to both the coach's and
    the client's calendars.
    """
    booking = models.ForeignKey(
        'bookings.SessionBooking', on_delete=models.CASCADE, related_name='calendar_links'
    )
    account = models.ForeignKey(
        GoogleCalendarAccount, on_delete=models.CASCADE, related_name='event_links'
    )
    google_event_id = models.CharField(max_length=255)
    updated_at = models.DateTimeField(auto_now=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['booking', 'account'], name='unique_booking_account_event'),
        ]

    def __str__(self):
        return f"Booking {self.booking_id} → event {self.google_event_id}"
