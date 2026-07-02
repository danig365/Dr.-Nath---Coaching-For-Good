"""
Newsletter system models.

`NewsletterSubscriber` — anyone who signs up via the public site forms. Re-using
the same email reactivates an existing (possibly unsubscribed) row rather than
creating a duplicate.

`Newsletter` — an authored issue. Drafts are composed in the admin panel; on
send, one ScheduledNotification is queued per active subscriber and the existing
dispatcher delivers them. Sent issues stay in the table as the platform archive.
"""
import uuid

from django.conf import settings
from django.db import models


class NewsletterSubscriber(models.Model):
    SOURCE_CHOICES = [
        ('modal', 'Pop-up modal'),
        ('band', 'Homepage band'),
        ('other', 'Other'),
    ]

    email = models.EmailField(unique=True)
    first_name = models.CharField(max_length=120, blank=True)
    is_active = models.BooleanField(default=True)  # False once unsubscribed
    source = models.CharField(max_length=10, choices=SOURCE_CHOICES, default='other')
    # Stable token used to build a one-click unsubscribe link in every email.
    unsubscribe_token = models.UUIDField(default=uuid.uuid4, editable=False, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        state = 'active' if self.is_active else 'unsubscribed'
        return f"{self.email} ({state})"


class Newsletter(models.Model):
    STATUS_DRAFT = 'draft'
    STATUS_SENT = 'sent'
    STATUS_CHOICES = [
        (STATUS_DRAFT, 'Draft'),
        (STATUS_SENT, 'Sent'),
    ]

    subject = models.CharField(max_length=255)
    body_html = models.TextField(help_text="Newsletter body (HTML, authored by admin).")
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=STATUS_DRAFT)
    sent_at = models.DateTimeField(null=True, blank=True)
    sent_count = models.PositiveIntegerField(default=0)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='newsletters',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.subject} ({self.status})"
