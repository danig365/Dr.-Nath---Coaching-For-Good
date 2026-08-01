from django.db import models
from django.utils import timezone
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
        ('no_show', 'No Show'),  # scheduled time passed but not both parties joined
        # Coach corrections for when the platform's automatic guess is wrong:
        ('held_offline', 'Held off-platform'),  # it took place, just elsewhere (e.g. WhatsApp)
        ('not_held', 'Did not take place'),      # it never happened at all
    )
    # Terminal statuses a coach may set as a manual correction, and whether that
    # outcome counts as a real session (for numbering, "sessions had", etc.).
    OUTCOME_CHOICES = ('completed', 'held_offline', 'no_show', 'not_held')
    OUTCOMES_THAT_HAPPENED = ('completed', 'held_offline')

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
    # Attendance — set the first time each party opens the call. Used to decide
    # completed vs no-show once the session's time has passed.
    coach_joined_at = models.DateTimeField(null=True, blank=True)
    client_joined_at = models.DateTimeField(null=True, blank=True)
    # Waiting-room admission (coach is host): the client can only get a call
    # token once the coach admits them. '' = not requested yet.
    ADMIT_CHOICES = (
        ('', 'None'), ('requested', 'Requested'), ('admitted', 'Admitted'), ('denied', 'Denied'),
    )
    client_admit_status = models.CharField(max_length=10, choices=ADMIT_CHOICES, default='', blank=True)
    # Whether a shareable guest-invite link is currently live for this session's
    # call (N4). The coach turns it on to invite an extra person mid-call; guests
    # still have to be admitted individually (see CallGuest).
    guest_link_active = models.BooleanField(default=False)
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
    # Set once the post-session thank-you + rebook email has gone out, so the
    # completion flow and the sweep don't send it twice.
    thankyou_sent = models.BooleanField(default=False)
    notes_file = models.FileField(upload_to='session_notes/', blank=True, null=True)
    slot = models.OneToOneField(
        'TimeSlot',
        on_delete=models.SET_NULL,
        related_name='booking',
        null=True, blank=True,
        help_text="The bookable time slot this session occupies (slot-based booking)."
    )

    class Meta:
        constraints = [
            # One Stripe payment can only ever pay for one booking. The view also
            # checks this, but two concurrent confirms would both pass that check
            # — only the database can actually settle the race. Free bookings
            # leave payment_intent_id NULL, which the condition excludes.
            models.UniqueConstraint(
                fields=['payment_intent_id'],
                condition=~models.Q(payment_intent_id=None) & ~models.Q(payment_intent_id=''),
                name='unique_payment_intent_per_booking',
            ),
        ]

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


class SlotInvite(models.Model):
    """A record that the coach emailed an invite for a slot to a given address.

    Lets the availability calendar show which open slots have pending invites
    (and to whom), and powers the "Sent Invites" history + one-click resend.
    Stores the skill and note used so a resend reproduces the original email.
    Cleared with the slot if it's deleted.
    """
    slot = models.ForeignKey(
        TimeSlot, on_delete=models.CASCADE, related_name='invites'
    )
    email = models.EmailField()
    # The offering the invite link pointed at, and the personal note, kept so a
    # one-click resend reproduces the same email. Nullable for legacy rows.
    skill = models.ForeignKey(
        Skill, on_delete=models.SET_NULL, related_name='slot_invites',
        null=True, blank=True,
    )
    note = models.TextField(blank=True, default='')
    # Documents the coach chose to attach to the invite email (D3). Kept so a
    # one-click resend reproduces the same attachments. A resource removed from
    # the library simply drops out of the invite (M2M, no cascade delete).
    attached_resources = models.ManyToManyField(
        'resources.Resource', blank=True, related_name='slot_invites',
    )
    invited_at = models.DateTimeField(auto_now_add=True)        # first time sent
    last_sent_at = models.DateTimeField(default=timezone.now)   # most recent (re)send
    sent_count = models.PositiveIntegerField(default=1)         # total times emailed

    class Meta:
        ordering = ['-last_sent_at']
        # One invite record per (slot, email) — re-inviting refreshes it.
        constraints = [
            models.UniqueConstraint(fields=['slot', 'email'], name='unique_slot_invite'),
        ]

    def __str__(self):
        return f"{self.email} → slot {self.slot_id}"


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


class Habit(models.Model):
    """A daily behaviour a coach assigns to a client for between-session
    accountability. The client logs a HabitCheckIn for each day they do it.
    Archived (active=False) instead of deleted to preserve check-in history."""
    coach = models.ForeignKey(
        UserProfile,
        on_delete=models.CASCADE,
        related_name='created_habits',
        limit_choices_to={'role': 'coach'},
    )
    client = models.ForeignKey(
        CustomUser,
        on_delete=models.CASCADE,
        related_name='habits',
    )
    # Wellness domains the client cares about (feedback point 3). Optional so
    # existing free-text habits keep working.
    CATEGORY_CHOICES = [
        ('nutrition', 'Nutrition & eating'),
        ('activity', 'Physical activity'),
        ('sleep', 'Sleep'),
        ('stress', 'Stress'),
        ('mindfulness', 'Mindfulness'),
        ('relationships', 'Relationships & connection'),
        ('burnout', 'Burnout'),
        ('balance', 'Work-life balance'),
    ]
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    category = models.CharField(max_length=20, choices=CATEGORY_CHOICES, blank=True, default='')
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-active', '-created_at']

    def __str__(self):
        return f"{self.title} ({self.client.username} ← {self.coach.user.username})"


class HabitCheckIn(models.Model):
    """One row per day the client marks a habit done. Presence = done that day;
    removing the row = not done. One check-in per habit per date."""
    habit = models.ForeignKey(
        Habit,
        on_delete=models.CASCADE,
        related_name='check_ins',
    )
    date = models.DateField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-date']
        constraints = [
            models.UniqueConstraint(fields=['habit', 'date'], name='uniq_habit_checkin_per_day'),
        ]

    def __str__(self):
        return f"{self.habit.title} · {self.date}"


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


class SessionReflection(models.Model):
    """A client's own post-session reflection: key takeaways + action items they
    captured after a coaching session. One per booking. Written by the client and
    readable by their coach (helps the coach follow up)."""
    booking = models.OneToOneField(
        SessionBooking, on_delete=models.CASCADE, related_name='reflection'
    )
    client = models.ForeignKey(
        CustomUser, on_delete=models.CASCADE, related_name='session_reflections'
    )
    takeaways = models.TextField(blank=True, default='')
    # List of {"text": str, "done": bool} — the next steps that came out of the session.
    action_items = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Reflection for booking {self.booking_id}"


class CallGuest(models.Model):
    """An extra person the coach invites into a 1:1 session call at short notice
    (N4). They join via a shareable guest link, but — like the client — they can
    only enter once the coach admits them; the link alone never lets them in."""
    STATUS_CHOICES = (
        ('requested', 'Requested'), ('admitted', 'Admitted'), ('denied', 'Denied'),
    )
    booking = models.ForeignKey(
        SessionBooking, on_delete=models.CASCADE, related_name='call_guests'
    )
    guest_uid = models.CharField(max_length=40, unique=True)  # LiveKit identity: guest-<uid>
    name = models.CharField(max_length=120)
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default='requested')
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Guest {self.name} ({self.status}) on booking {self.booking_id}"


class SessionSummary(models.Model):
    """An AI-generated summary of the session, produced from an in-call transcript.
    One per booking; visible to both the client and the coach."""
    booking = models.OneToOneField(
        SessionBooking, on_delete=models.CASCADE, related_name='ai_summary'
    )
    summary = models.TextField(blank=True, default='')
    key_points = models.JSONField(default=list, blank=True)   # list of short strings
    action_items = models.JSONField(default=list, blank=True)  # list of short strings
    reflection_points = models.JSONField(default=list, blank=True)  # prompts to reflect on
    transcript_chars = models.PositiveIntegerField(default=0)
    # Set once the post-session summary email has gone out, so both participants
    # POSTing the transcript at session end don't each trigger an email.
    summary_email_sent = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"AI summary for booking {self.booking_id}"