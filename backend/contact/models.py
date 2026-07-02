from django.conf import settings
from django.db import models


class ContactMessage(models.Model):
    """A message submitted through the public Contact page."""
    name = models.CharField(max_length=120, blank=True, default='')
    email = models.EmailField()
    subject = models.CharField(max_length=200)
    message = models.TextField()
    # Set if the sender was logged in when they submitted.
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='contact_messages',
    )
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.subject} — {self.email}"
