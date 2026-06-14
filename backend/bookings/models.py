from django.db import models
from skills.models import Skill, Availability # Ensure Availability is imported
from profiles.models import CustomUser, UserProfile
from django.core.validators import MinValueValidator
from django.core.exceptions import ValidationError

class SessionBooking(models.Model):
    STATUS_CHOICES = (
        ('pending', 'Pending'),
        ('accepted', 'Accepted'),
        ('declined', 'Declined'),
        ('rescheduled', 'Rescheduled'),
        ('completed', 'Completed'),
    )

    mentor = models.ForeignKey(
        UserProfile,
        on_delete=models.CASCADE,
        related_name='mentored_sessions',
        limit_choices_to={'role': 'coach'}
    )
    learner = models.ForeignKey(
        CustomUser,
        on_delete=models.CASCADE,
        related_name='booked_sessions'
    )
    skill = models.ForeignKey(
        Skill,
        on_delete=models.CASCADE,
        related_name='sessions_booked'
    )
    session_date = models.DateField()
    session_time = models.TimeField()
    created_at = models.DateTimeField(auto_now_add=True)
    status = models.CharField(
        max_length=15,
        choices=STATUS_CHOICES,
        default='pending'
    )
    
    duration = models.PositiveIntegerField(default=60) # In minutes
    skill_level = models.CharField(max_length=50, blank=True, null=True)
    message = models.TextField(blank=True, null=True)
    notes_available = models.BooleanField(default=False) # This field was added previously
    meeting_link = models.URLField(blank=True, null=True, help_text="Optional meeting/join URL for the session")
    payment_intent_id = models.CharField(max_length=255, blank=True, null=True)
    payment_status = models.CharField(max_length=20, default='unpaid', choices=[
        ('unpaid', 'Unpaid'),
        ('paid', 'Paid'),
        ('refunded', 'Refunded'),
    ])
    amount_paid = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    notes_file = models.FileField(upload_to='session_notes/', blank=True, null=True)
    def clean(self):
        super().clean() # Always call the parent's clean method first

        # ⭐ RE-ACTIVATED AND CORRECTED VALIDATION LOGIC ⭐
        # 1. Ensure the learner is actually a 'client' role
        if self.learner.profile.role != 'client':
            raise ValidationError("Only users with 'client' role can book sessions.")

        # 2. Ensure the skill is offered by the selected mentor
        if self.skill.profile != self.mentor:
            raise ValidationError("The selected mentor does not offer this skill.")
        
        try:
            mentor_profile_for_availability = self.mentor
            day_of_week = self.session_date.strftime('%A').lower()

            # 3. Check mentor's availability for the specific date and time
            availability = Availability.objects.filter(
                mentor=mentor_profile_for_availability,
                day_of_week__iexact=day_of_week, # Case-insensitive match for day of week
                start_time__lte=self.session_time,
                end_time__gte=self.session_time,
                is_available=True # Only consider available slots
            ).exists()
            if not availability:
                raise ValidationError(f"The mentor is not available on {self.session_date.strftime('%A')} at {self.session_time}.")
            
            # 4. Prevent double booking for 'accepted' sessions
            if self.status == 'accepted':
                conflicting_bookings = SessionBooking.objects.filter(
                    mentor=self.mentor,
                    session_date=self.session_date,
                    session_time=self.session_time,
                    status='accepted' # Only check against already accepted sessions
                ).exclude(pk=self.pk).exists() # Exclude the current instance for updates

                if conflicting_bookings:
                    raise ValidationError(f"This mentor is already booked on {self.session_date} at {self.session_time}.")
        
        except AttributeError as e:
            # Catch errors if related objects (like profile or user) are unexpectedly missing
            raise ValidationError(f"Configuration error: Missing related data for mentor or skill. Detail: {e}")
        except Exception as e:
            # Catch any other unexpected errors during the validation process
            raise ValidationError(f"An unexpected error occurred during booking validation: {e}")
    
    def __str__(self):
        mentor_username = self.mentor.user.username if self.mentor and hasattr(self.mentor, 'user') else 'N/A Mentor'
        learner_username = self.learner.username if self.learner else 'N/A Learner'
        skill_name = self.skill.name if self.skill else 'N/A Skill'
        return f"{learner_username} booked {skill_name} with {mentor_username}"

class Milestone(models.Model):
    booking = models.ForeignKey(
        SessionBooking,
        on_delete=models.CASCADE,
        related_name='milestones',
        null=True, blank=True
    )
    coach = models.ForeignKey(
        UserProfile,
        on_delete=models.CASCADE,
        related_name='created_milestones',
        limit_choices_to={'role': 'coach'}
    )
    client = models.ForeignKey(
        CustomUser,
        on_delete=models.CASCADE,
        related_name='milestones'
    )
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    due_date = models.DateField(null=True, blank=True)
    completed = models.BooleanField(default=False)
    completed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['completed', 'due_date', '-created_at']

    def __str__(self):
        return f"{self.title} ({self.client.username} ← {self.coach.user.username})"


class Review(models.Model):
    # This model remains unchanged and is correctly defined
    mentor_profile = models.ForeignKey(UserProfile, on_delete=models.CASCADE, related_name='received_reviews', limit_choices_to={'role': 'coach'}, null=True, blank=True )
    student = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name='given_reviews')
    rating = models.PositiveSmallIntegerField(validators=[MinValueValidator(1)], help_text="Rating out of 5 stars")
    comment = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    class Meta:
        ordering = ['-created_at']
        unique_together = ('mentor_profile', 'student')

    def __str__(self):
        mentor_username = self.mentor_profile.user.username if self.mentor_profile and hasattr(self.mentor_profile, 'user') else "N/A Mentor"
        student_username = self.student.username if self.student else "N/A Student"
        return f"Review for {mentor_username} by {student_username} ({self.rating} stars)"