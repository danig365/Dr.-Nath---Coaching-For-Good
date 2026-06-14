from django.db import models
from django.contrib.auth.models import AbstractUser
from django.db.models.signals import post_save
from django.dispatch import receiver

class CustomUser(AbstractUser):
    pass

class UserProfile(models.Model):
    ROLE_CHOICES = (
        ('coach', 'Coach'),
        ('client', 'Client'),
        ('admin', 'Admin'),
    )
    APPROVAL_CHOICES = (
        ('pending', 'Pending'),
        ('approved', 'Approved'),
        ('rejected', 'Rejected'),
    )

    user = models.OneToOneField(CustomUser, on_delete=models.CASCADE, related_name='profile')
    role = models.CharField(max_length=10, choices=ROLE_CHOICES, default='client')
    bio = models.TextField(blank=True, null=True)
    photo = models.ImageField(upload_to='coach_photos/', blank=True, null=True)

    # Coach-specific
    specialties = models.JSONField(default=list, blank=True)   # ["Leadership", "Executive"]
    certifications = models.JSONField(default=list, blank=True) # ["ICF PCC", "EMCC"]
    hourly_rate = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    years_experience = models.PositiveIntegerField(null=True, blank=True)
    languages = models.JSONField(default=list, blank=True)
    industries = models.JSONField(default=list, blank=True)

    # Vetting
    approval_status = models.CharField(max_length=10, choices=APPROVAL_CHOICES, default='pending')
    is_verified = models.BooleanField(default=False)  # Badge shown on directory
    rejection_reason = models.TextField(blank=True, null=True)

    # Client-specific
    organisation = models.CharField(max_length=255, blank=True, null=True)
    job_title = models.CharField(max_length=255, blank=True, null=True)
    coaching_goals = models.JSONField(default=list, blank=True)  # from quiz

    def __str__(self):
        return f"{self.user.username} ({self.role})"

@receiver(post_save, sender=CustomUser)
def create_or_update_user_profile(sender, instance, created, **kwargs):
    if created:
        UserProfile.objects.create(user=instance)
    else:
        instance.profile.save()