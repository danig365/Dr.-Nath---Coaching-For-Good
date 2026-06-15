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
    slot = models.OneToOneField(
        'TimeSlot',
        on_delete=models.SET_NULL,
        related_name='booking',
        null=True, blank=True,
        help_text="The bookable time slot this session occupies (slot-based booking)."
    )
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

class TimeSlot(models.Model):
    """
    A concrete, bookable block of time on a coach's calendar.

    Slots are the source of truth for what a client can book. They are either
    auto-generated from a coach's recurring availability rules, or created
    manually as one-off slots. A booking binds to exactly one slot.

    All datetimes are stored in UTC; display conversion happens per-user using
    UserProfile.timezone.
    """
    STATUS_CHOICES = (
        ('open', 'Open'),          # available for a client to book
        ('held', 'Held'),          # temporarily reserved during checkout
        ('booked', 'Booked'),      # confirmed booking attached
        ('blocked', 'Blocked'),    # coach closed this slot (vacation, etc.)
    )
    SOURCE_CHOICES = (
        ('auto', 'Auto-generated'),  # minted from recurring availability rules
        ('manual', 'Manual'),        # one-off slot created by the coach
    )

    coach = models.ForeignKey(
        UserProfile,
        on_delete=models.CASCADE,
        related_name='time_slots',
        limit_choices_to={'role': 'coach'}
    )
    skill = models.ForeignKey(
        Skill,
        on_delete=models.CASCADE,
        related_name='time_slots',
        null=True, blank=True,
        help_text="Optional: restrict this slot to a specific skill. Null = any skill."
    )
    start_datetime = models.DateTimeField()
    end_datetime = models.DateTimeField()
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='open')
    source = models.CharField(max_length=10, choices=SOURCE_CHOICES, default='auto')

    # Set while status == 'held' so abandoned checkouts can be reclaimed.
    held_until = models.DateTimeField(null=True, blank=True)
    # The client who currently holds this slot during checkout. Lets us reject
    # a confirm/release coming from anyone other than the holder.
    held_by = models.ForeignKey(
        CustomUser,
        on_delete=models.SET_NULL,
        related_name='held_slots',
        null=True, blank=True,
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['start_datetime']
        constraints = [
            models.UniqueConstraint(
                fields=['coach', 'start_datetime', 'end_datetime'],
                name='unique_coach_slot'
            ),
        ]
        indexes = [
            models.Index(fields=['coach', 'status', 'start_datetime']),
        ]

    def clean(self):
        super().clean()
        if self.end_datetime <= self.start_datetime:
            raise ValidationError("Slot end time must be after its start time.")
        if self.skill and self.skill.profile != self.coach:
            raise ValidationError("The selected skill is not offered by this coach.")

    @property
    def duration_minutes(self):
        return int((self.end_datetime - self.start_datetime).total_seconds() // 60)

    def __str__(self):
        coach_username = self.coach.user.username if self.coach and hasattr(self.coach, 'user') else 'N/A'
        return f"{coach_username} · {self.start_datetime:%Y-%m-%d %H:%M} ({self.status})"


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


class GroupSession(models.Model):
    """
    A coach-led session with a capped number of paying participants.

    Unlike a 1:1 booking (one exclusive TimeSlot per booking), a group session is
    a single scheduled event that many clients enrol into, up to `capacity`. Each
    enrolment is paid individually (see GroupEnrollment). Sessions are created
    one-off by the coach; when capacity is reached the session is a hard stop
    (status flips to 'full' and no further enrolments are accepted).

    All datetimes are stored in UTC; display conversion happens per-user.
    """
    STATUS_CHOICES = (
        ('scheduled', 'Scheduled'),   # open for enrolment
        ('full', 'Full'),             # capacity reached
        ('completed', 'Completed'),   # session has happened
        ('cancelled', 'Cancelled'),   # coach cancelled; enrolments refunded
    )

    coach = models.ForeignKey(
        UserProfile,
        on_delete=models.CASCADE,
        related_name='group_sessions',
        limit_choices_to={'role': 'coach'}
    )
    skill = models.ForeignKey(
        Skill,
        on_delete=models.SET_NULL,
        related_name='group_sessions',
        null=True, blank=True,
        help_text="Optional: link this session to a skill/offering."
    )
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    start_datetime = models.DateTimeField()
    end_datetime = models.DateTimeField()
    capacity = models.PositiveIntegerField(
        default=10,
        validators=[MinValueValidator(1)],
        help_text="Maximum number of participants."
    )
    price_per_seat = models.DecimalField(
        max_digits=8, decimal_places=2, default=0.00,
        validators=[MinValueValidator(0.00)]
    )
    meeting_link = models.URLField(blank=True, null=True, help_text="Shared join URL for all participants.")
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='scheduled')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['start_datetime']
        indexes = [
            models.Index(fields=['coach', 'status', 'start_datetime']),
        ]

    def clean(self):
        super().clean()
        if self.end_datetime <= self.start_datetime:
            raise ValidationError("Session end time must be after its start time.")
        if self.skill and self.skill.profile != self.coach:
            raise ValidationError("The selected skill is not offered by this coach.")

    @property
    def seats_taken(self):
        """Active enrolments (held during checkout + confirmed) consume a seat."""
        return self.enrollments.filter(status__in=('held', 'booked')).count()

    @property
    def seats_remaining(self):
        return max(self.capacity - self.seats_taken, 0)

    @property
    def is_full(self):
        return self.seats_taken >= self.capacity

    def __str__(self):
        coach_username = self.coach.user.username if self.coach and hasattr(self.coach, 'user') else 'N/A'
        return f"{self.title} · {coach_username} · {self.start_datetime:%Y-%m-%d %H:%M} ({self.status})"


class GroupEnrollment(models.Model):
    """One client's paid seat in a GroupSession."""
    STATUS_CHOICES = (
        ('held', 'Held'),          # temporarily reserved during checkout
        ('booked', 'Booked'),      # confirmed + paid
        ('cancelled', 'Cancelled'),
    )

    group_session = models.ForeignKey(
        GroupSession,
        on_delete=models.CASCADE,
        related_name='enrollments'
    )
    learner = models.ForeignKey(
        CustomUser,
        on_delete=models.CASCADE,
        related_name='group_enrollments'
    )
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='held')

    # Set while status == 'held' so abandoned checkouts can be reclaimed.
    held_until = models.DateTimeField(null=True, blank=True)

    payment_intent_id = models.CharField(max_length=255, blank=True, null=True)
    payment_status = models.CharField(max_length=20, default='unpaid', choices=[
        ('unpaid', 'Unpaid'),
        ('paid', 'Paid'),
        ('refunded', 'Refunded'),
    ])
    amount_paid = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        # A client cannot occupy two seats in the same session.
        constraints = [
            models.UniqueConstraint(
                fields=['group_session', 'learner'],
                name='unique_group_enrollment'
            ),
        ]

    def __str__(self):
        learner_username = self.learner.username if self.learner else 'N/A'
        return f"{learner_username} → {self.group_session.title} ({self.status})"