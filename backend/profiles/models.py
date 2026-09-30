from django.db import models
from django.contrib.auth.models import AbstractUser
from django.db.models.signals import post_save
from django.dispatch import receiver

class CustomUser(AbstractUser):
    pass

def bookable_coaches(qs=None):
    """Coaches the public may see and book: approved AND not deactivated.

    An admin deactivating a coach has to remove them from everywhere at once —
    the directory, Smart Match, their profile page, the skills a client browses
    and the slots behind them. One definition, used by every one of those.
    """
    qs = UserProfile.objects.all() if qs is None else qs
    return qs.filter(role='coach', approval_status='approved', user__is_active=True)


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
    # When this client last opened their Resources page. Anything a coach has
    # shared since then is "new" — that's the count on the Resources nav item,
    # the same idea as the upcoming-sessions badge. Null = never opened, so
    # everything shared with them counts as new.
    resources_seen_at = models.DateTimeField(null=True, blank=True)
    role = models.CharField(max_length=10, choices=ROLE_CHOICES, default='client')
    bio = models.TextField(blank=True, null=True)
    photo = models.ImageField(upload_to='coach_photos/', blank=True, null=True)
    timezone = models.CharField(
        max_length=64,
        default='UTC',
        help_text="IANA timezone name, e.g. 'America/New_York'. Used to display slots."
    )
    # Coach booking policy (used when generating bookable slots)
    booking_horizon_days = models.PositiveIntegerField(
        default=30,
        help_text="How many days into the future clients may book."
    )
    min_notice_hours = models.PositiveIntegerField(
        default=12,
        help_text="Minimum lead time, in hours, required before a session can start."
    )

    # Coach-specific
    specialties = models.JSONField(default=list, blank=True)   # ["Leadership", "Executive"]
    certifications = models.JSONField(default=list, blank=True) # ["ICF PCC", "EMCC"]
    hourly_rate = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    years_experience = models.PositiveIntegerField(null=True, blank=True)
    languages = models.JSONField(default=list, blank=True)
    industries = models.JSONField(default=list, blank=True)
    linkedin_url = models.URLField(max_length=300, blank=True, default='')

    # Vetting
    approval_status = models.CharField(max_length=10, choices=APPROVAL_CHOICES, default='pending')
    is_verified = models.BooleanField(default=False)  # Badge shown on directory
    rejection_reason = models.TextField(blank=True, null=True)

    # Client-specific
    organisation = models.CharField(max_length=255, blank=True, null=True)
    # Set when a client registers with a partner organisation's participation
    # code (October Health Month). Their sessions draw on that organisation's
    # allocation, and they count towards its per-patient limit.
    participation_code = models.ForeignKey(
        'profiles.ParticipationCode', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='clients',
    )
    # Whether this client agreed that their practice may see their participation
    # in the anonymised report. Coaching content is never shared either way.
    share_with_organisation = models.BooleanField(default=False)
    job_title = models.CharField(max_length=255, blank=True, null=True)
    coaching_goals = models.JSONField(default=list, blank=True)  # from quiz

    # Program lock (E2): when set, this client may only see + book this one
    # offering (e.g. the 6-month Health & Wellness Program). Null = unrestricted.
    restricted_to_skill = models.ForeignKey(
        'skills.Skill', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='restricted_clients',
        help_text="If set, this client can only book this offering.",
    )

    @property
    def is_profile_complete(self):
        user = self.user
        if not (user.first_name.strip() and user.last_name.strip()):
            return False
        if self.role == 'coach':
            # Hourly rate is optional — a coach may choose not to publish it.
            return bool(self.bio and self.bio.strip() and self.specialties)
        if self.role == 'client':
            return bool(self.job_title and self.job_title.strip() and self.organisation and self.organisation.strip())
        return True  # admin

    def __str__(self):
        return f"{self.user.username} ({self.role})"

@receiver(post_save, sender=CustomUser)
def create_or_update_user_profile(sender, instance, created, **kwargs):
    if created:
        UserProfile.objects.create(user=instance)
    else:
        instance.profile.save()

class ParticipationCode(models.Model):
    """A partner organisation's allocation of sessions — the October Health Month
    campaign, where each practice gets 20 complimentary sessions for patients it
    nominates, capped at 4 per patient.

    Patients enter the code when registering. From then on their bookings of the
    campaign offering draw down THIS organisation's allocation, which is what
    lets several practices run in parallel without sharing one pool.
    """
    code = models.CharField(max_length=32, unique=True)
    organisation = models.CharField(max_length=200)
    # Where the practice's summary report goes.
    contact_name = models.CharField(max_length=150, blank=True)
    # One practice usually means several people — the doctor, the practice
    # manager, reception. Comma-separated, so the invitation reaches all of them.
    contact_email = models.CharField(max_length=500, blank=True)
    # When the invitation was last sent from the platform, and to how many.
    invite_sent_at = models.DateTimeField(null=True, blank=True)
    invite_sent_count = models.PositiveIntegerField(default=0)

    # The offering this allocation pays for. Null = any offering the coach runs.
    skill = models.ForeignKey(
        'skills.Skill', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='participation_codes',
    )
    coach = models.ForeignKey(
        UserProfile, on_delete=models.CASCADE, related_name='participation_codes',
        limit_choices_to={'role': 'coach'},
    )

    AUDIENCE_CHOICES = (
        ('patients', 'Patients'),
        ('employees', 'Employees'),
        ('clients', 'Clients'),
    )
    # A medical practice nominates patients; a company nominates employees. The
    # invitation says whichever this organisation uses.
    audience = models.CharField(max_length=12, choices=AUDIENCE_CHOICES, default='patients')
    total_sessions = models.PositiveIntegerField(default=20)
    max_per_client = models.PositiveIntegerField(default=4)
    # The campaign window. Sessions must START inside it.
    valid_from = models.DateField(null=True, blank=True)
    valid_until = models.DateField(null=True, blank=True)
    active = models.BooleanField(default=True)

    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['organisation']

    def __str__(self):
        return f"{self.code} — {self.organisation}"

    def save(self, *args, **kwargs):
        # Codes are read off a letter and typed by patients: store one canonical
        # form so 'keagan', 'Keagan ' and 'KEAGAN' are the same code.
        self.code = (self.code or '').strip().upper()
        return super().save(*args, **kwargs)

    def contact_emails(self):
        """The practice's addresses as a list, however they were typed in."""
        import re
        return [e.strip() for e in re.split(r'[;,\n]+', self.contact_email or '') if e.strip()]

    def window_error(self, when=None, *, registering=False):
        """Why this code can't be used (now, or for a session on `when`).

        `registering=True` allows someone to join BEFORE the campaign opens —
        the practice's letter asks patients to register and then book, so
        refusing them in September would have been the wrong end to enforce.
        Only the booking itself has to fall inside the window.
        """
        from django.utils import timezone as dj_tz
        if not self.active:
            return "That participation code is no longer active."
        day = when or dj_tz.now().date()
        if not registering and self.valid_from and day < self.valid_from:
            return f"These sessions can be booked from {self.valid_from:%-d %B %Y}."
        if self.valid_until and day > self.valid_until:
            return f"This offer closed on {self.valid_until:%-d %B %Y}."
        return None

    def opens_later(self):
        """True while the campaign is still ahead of us."""
        from django.utils import timezone as dj_tz
        return bool(self.valid_from and dj_tz.now().date() < self.valid_from)
