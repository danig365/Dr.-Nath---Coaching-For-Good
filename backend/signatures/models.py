"""
Online document signing (e-signature).

A coach uploads an agreement and sends it to one client. The client signs
(typed full name = e-signature, with timestamp + IP for the audit trail), then
the coach counter-signs. On completion a signed PDF is generated (see
signatures/pdf.py, Phase 2) and both parties can download it.

Flow / status:
    sent  →  client_signed  →  completed
      └────────→ declined (client declined)
"""
from django.db import models

from profiles.models import UserProfile, CustomUser


class SignatureDocument(models.Model):
    STATUS_SENT = 'sent'                    # awaiting the client's signature
    STATUS_CLIENT_SIGNED = 'client_signed'  # awaiting the coach's counter-signature
    STATUS_COMPLETED = 'completed'          # both signed
    STATUS_DECLINED = 'declined'            # client declined
    STATUS_CHOICES = [
        (STATUS_SENT, 'Awaiting client signature'),
        (STATUS_CLIENT_SIGNED, 'Awaiting coach counter-signature'),
        (STATUS_COMPLETED, 'Completed'),
        (STATUS_DECLINED, 'Declined'),
    ]

    coach = models.ForeignKey(
        UserProfile, on_delete=models.CASCADE, related_name='sent_signature_documents',
        limit_choices_to={'role': 'coach'},
    )
    client = models.ForeignKey(
        CustomUser, on_delete=models.CASCADE, related_name='signature_documents',
    )
    title = models.CharField(max_length=200)
    message = models.TextField(blank=True, help_text="Optional note shown to the client.")

    # Stored under media/resources/ so nginx's existing `internal` rule keeps
    # these private (served only via the permission-checked download endpoint).
    file = models.FileField(upload_to='resources/agreements/', help_text="The original document to sign.")
    signed_file = models.FileField(upload_to='resources/agreements/signed/', blank=True, null=True,
                                   help_text="Generated PDF with both signatures.")

    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=STATUS_SENT)

    # Client signature (typed full name = e-signature) + audit.
    client_signature = models.CharField(max_length=200, blank=True)
    client_signed_at = models.DateTimeField(null=True, blank=True)
    client_signed_ip = models.GenericIPAddressField(null=True, blank=True)

    # Coach counter-signature + audit.
    coach_signature = models.CharField(max_length=200, blank=True)
    coach_signed_at = models.DateTimeField(null=True, blank=True)
    coach_signed_ip = models.GenericIPAddressField(null=True, blank=True)

    decline_reason = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['coach', 'status']),
            models.Index(fields=['client', 'status']),
        ]

    def __str__(self):
        return f"{self.title} — {self.client.username} ({self.status})"
