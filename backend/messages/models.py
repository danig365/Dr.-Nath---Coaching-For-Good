from django.db import models
from bookings.models import SessionBooking, GroupSession
from profiles.models import CustomUser

# Create your models here.
class Message(models.Model):
    booking = models.ForeignKey(SessionBooking, on_delete=models.CASCADE, related_name='messages')
    sender = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name='sent_messages')
    receiver = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name='received_messages')
    content = models.TextField(blank=True)  # may be empty for file-only messages
    # Optional file attachment. A message must carry content and/or an attachment.
    attachment = models.FileField(upload_to='chat_attachments/', blank=True, null=True)
    attachment_name = models.CharField(max_length=255, blank=True)  # original filename
    attachment_size = models.PositiveBigIntegerField(null=True, blank=True)  # bytes
    content_type = models.CharField(max_length=120, blank=True)  # MIME type
    timestamp = models.DateTimeField(auto_now_add=True)
    is_read = models.BooleanField(default=False)

    class Meta:
        ordering = ['timestamp']

    def __str__(self):
        return f"Booking {self.booking_id}: {self.sender.username} to {self.receiver.username}"


class GroupMessage(models.Model):
    """A persisted message in a group session's shared chat thread."""
    group_session = models.ForeignKey(GroupSession, on_delete=models.CASCADE, related_name='messages')
    sender = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name='group_messages')
    content = models.TextField(blank=True)  # may be empty for file-only messages
    # Optional file attachment. A message must carry content and/or an attachment.
    attachment = models.FileField(upload_to='chat_attachments/', blank=True, null=True)
    attachment_name = models.CharField(max_length=255, blank=True)  # original filename
    attachment_size = models.PositiveBigIntegerField(null=True, blank=True)  # bytes
    content_type = models.CharField(max_length=120, blank=True)  # MIME type
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['timestamp']

    def __str__(self):
        return f"GroupSession {self.group_session_id}: {self.sender.username}"
