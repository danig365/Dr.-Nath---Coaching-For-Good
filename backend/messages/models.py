from django.db import models
from bookings.models import SessionBooking
from profiles.models import CustomUser

# Create your models here.
class Message(models.Model):
    booking = models.ForeignKey(SessionBooking, on_delete=models.CASCADE, related_name='messages')
    sender = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name='sent_messages')
    receiver = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name='received_messages')
    content = models.TextField()
    timestamp = models.DateTimeField(auto_now_add=True)
    is_read = models.BooleanField(default=False)

    class Meta:
        ordering = ['timestamp']

    def __str__(self):
        return f"Booking {self.booking_id}: {self.sender.username} to {self.receiver.username}"
