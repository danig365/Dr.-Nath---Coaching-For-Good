from django.contrib import admin

from .models import GoogleCalendarAccount


@admin.register(GoogleCalendarAccount)
class GoogleCalendarAccountAdmin(admin.ModelAdmin):
    list_display = ('profile', 'google_email', 'is_active', 'sync_bookings_out',
                    'block_busy_times', 'connected_at')
    list_filter = ('is_active', 'sync_bookings_out', 'block_busy_times')
    search_fields = ('profile__user__username', 'google_email')
    readonly_fields = ('refresh_token', 'access_token', 'token_expiry', 'connected_at', 'updated_at')
