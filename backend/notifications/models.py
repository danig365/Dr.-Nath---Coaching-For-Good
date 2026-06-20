"""
Notification queue.

`ScheduledNotification` is a channel-agnostic, feature-agnostic record of "send
this message to this recipient at this time." Booking confirmations, session
reminders, and any future notification (announcements, milestone nudges, …) are
all rows in this one table. A dispatcher sends whatever is due.

Idempotency: rows carry a `dedupe_key`; queueing the same key twice returns the
existing row instead of creating a duplicate. This makes (re)scheduling safe.

Linking: an optional GenericForeignKey ties a notification to the object it's
about (e.g. a SessionBooking), so we can cancel a booking's pending reminders
when it's cancelled — without the notifications app depending on bookings.
"""
from django.conf import settings
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from django.db import models
from django.utils import timezone


class ScheduledNotification(models.Model):
    CHANNEL_EMAIL = 'email'
    CHANNEL_CHOICES = [(CHANNEL_EMAIL, 'Email')]

    STATUS_PENDING = 'pending'
    STATUS_SENT = 'sent'
    STATUS_FAILED = 'failed'
    STATUS_CANCELLED = 'cancelled'
    STATUS_CHOICES = [
        (STATUS_PENDING, 'Pending'),
        (STATUS_SENT, 'Sent'),
        (STATUS_FAILED, 'Failed'),
        (STATUS_CANCELLED, 'Cancelled'),
    ]

    channel = models.CharField(max_length=20, choices=CHANNEL_CHOICES, default=CHANNEL_EMAIL)
    kind = models.CharField(max_length=50, help_text="e.g. 'booking_confirmation', 'reminder_1h'")

    recipient_email = models.EmailField()
    recipient_user = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='notifications',
    )

    subject = models.CharField(max_length=255)
    template = models.CharField(max_length=100, help_text="Template base name under emails/.")
    context = models.JSONField(default=dict, blank=True)

    scheduled_for = models.DateTimeField(help_text="When this should be sent (UTC).")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_PENDING)
    attempts = models.PositiveIntegerField(default=0)
    sent_at = models.DateTimeField(null=True, blank=True)
    error = models.TextField(blank=True, default='')

    # Prevents duplicate scheduling and lets callers find/cancel related rows.
    dedupe_key = models.CharField(max_length=200, blank=True, default='', db_index=True)

    # Optional link to the object this notification is about.
    content_type = models.ForeignKey(ContentType, null=True, blank=True, on_delete=models.SET_NULL)
    object_id = models.PositiveIntegerField(null=True, blank=True)
    related_object = GenericForeignKey('content_type', 'object_id')

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['scheduled_for']
        indexes = [
            models.Index(fields=['status', 'scheduled_for']),
            models.Index(fields=['content_type', 'object_id']),
        ]
        constraints = [
            # Unique only when a dedupe_key is set (partial unique index).
            models.UniqueConstraint(
                fields=['dedupe_key'],
                condition=~models.Q(dedupe_key=''),
                name='uniq_notification_dedupe',
            ),
        ]

    def __str__(self):
        return f"{self.kind} → {self.recipient_email} @ {self.scheduled_for:%Y-%m-%d %H:%M} ({self.status})"

    @classmethod
    def queue(cls, *, kind, recipient_email, subject, template, context,
              scheduled_for, recipient_user=None, related=None, dedupe_key='',
              channel=CHANNEL_EMAIL):
        """
        Create a notification, or return the existing one if `dedupe_key` matches.
        Skips creation entirely when there's no recipient email.
        """
        if not recipient_email:
            return None
        if dedupe_key:
            existing = cls.objects.filter(dedupe_key=dedupe_key).first()
            if existing:
                return existing

        obj = cls(
            channel=channel, kind=kind, recipient_email=recipient_email,
            recipient_user=recipient_user, subject=subject, template=template,
            context=context or {}, scheduled_for=scheduled_for, dedupe_key=dedupe_key,
        )
        if related is not None and related.pk:
            obj.content_type = ContentType.objects.get_for_model(related.__class__)
            obj.object_id = related.pk
        obj.save()
        return obj

    def send(self):
        """
        Render and send this notification now. Updates status/attempts in place.
        Returns True on success. Never raises — failures are recorded for retry.
        """
        from .services import send_email

        self.attempts += 1
        try:
            ok = send_email(
                to=self.recipient_email,
                subject=self.subject,
                template=self.template,
                context=self.context,
                fail_silently=True,
            )
            if ok:
                self.status = self.STATUS_SENT
                self.sent_at = timezone.now()
                self.error = ''
            else:
                self.status = self.STATUS_FAILED
                self.error = 'Email backend reported failure (see logs).'
        except Exception as exc:  # noqa: BLE001
            self.status = self.STATUS_FAILED
            self.error = str(exc)
            ok = False
        self.save(update_fields=['status', 'attempts', 'sent_at', 'error', 'updated_at'])
        return ok
