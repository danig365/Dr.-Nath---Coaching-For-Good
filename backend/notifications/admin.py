from django.contrib import admin

from .models import ScheduledNotification


@admin.register(ScheduledNotification)
class ScheduledNotificationAdmin(admin.ModelAdmin):
    list_display = ('kind', 'recipient_email', 'scheduled_for', 'status', 'attempts', 'sent_at')
    list_filter = ('status', 'kind', 'channel')
    search_fields = ('recipient_email', 'subject', 'dedupe_key')
    readonly_fields = ('created_at', 'updated_at', 'sent_at', 'attempts', 'error')
    date_hierarchy = 'scheduled_for'
