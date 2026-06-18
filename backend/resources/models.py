from django.db import models
from django.core.exceptions import ValidationError

from profiles.models import UserProfile, CustomUser
from bookings.models import GroupSession


class ResourceFolder(models.Model):
    """A coach's collection for grouping resources (e.g. 'Onboarding')."""
    coach = models.ForeignKey(
        UserProfile,
        on_delete=models.CASCADE,
        related_name='resource_folders',
        limit_choices_to={'role': 'coach'},
    )
    name = models.CharField(max_length=120)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']
        constraints = [
            models.UniqueConstraint(fields=['coach', 'name'], name='unique_folder_per_coach'),
        ]

    def __str__(self):
        coach = self.coach.user.username if self.coach and hasattr(self.coach, 'user') else 'N/A'
        return f"{self.name} ({coach})"


class Resource(models.Model):
    """
    A document a coach uploads and shares with their coachees.

    Visibility controls who may see/download it:
      - all_clients : every coachee of this coach (accepted booking or booked group seat)
      - specific    : only the clients in `shared_clients`
      - group       : booked participants of `group_session`
    Access is relationship-based for v1; payment-tier gating is deferred until a
    subscription/plan model exists.
    """
    VISIBILITY_CHOICES = (
        ('all_platform', 'All clients (including those with no booking)'),
        ('all_clients', 'Clients with at least one booking (my coachees)'),
        ('specific', 'Specific clients'),
        ('group', 'A group session'),
    )

    coach = models.ForeignKey(
        UserProfile,
        on_delete=models.CASCADE,
        related_name='resources',
        limit_choices_to={'role': 'coach'},
    )
    folder = models.ForeignKey(
        ResourceFolder,
        on_delete=models.SET_NULL,
        related_name='resources',
        null=True, blank=True,
    )
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    # A resource is EITHER an uploaded file OR an external link (e.g. a link to an
    # online assessment). Files are stored out of the public /media/ path and
    # served through a permission-checked endpoint; links are just shared URLs.
    file = models.FileField(upload_to='resources/', blank=True, null=True)
    file_size = models.PositiveBigIntegerField(null=True, blank=True, help_text="Size in bytes.")
    content_type = models.CharField(max_length=120, blank=True)
    link_url = models.URLField(max_length=500, blank=True, help_text="External link, used instead of a file.")

    visibility = models.CharField(max_length=12, choices=VISIBILITY_CHOICES, default='all_clients')
    shared_clients = models.ManyToManyField(
        CustomUser, blank=True, related_name='shared_resources',
        help_text="Used when visibility is 'specific'.",
    )
    group_session = models.ForeignKey(
        GroupSession,
        on_delete=models.SET_NULL,
        related_name='resources',
        null=True, blank=True,
        help_text="Used when visibility is 'group'.",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['coach', 'visibility']),
        ]

    @property
    def is_link(self):
        return bool(self.link_url) and not self.file

    def clean(self):
        super().clean()
        has_file = bool(self.file)
        has_link = bool(self.link_url)
        if not has_file and not has_link:
            raise ValidationError("Provide either a file or a link.")
        if has_file and has_link:
            raise ValidationError("Provide a file or a link, not both.")
        if self.folder and self.folder.coach_id != self.coach_id:
            raise ValidationError("The folder belongs to a different coach.")
        if self.visibility == 'group':
            if not self.group_session_id:
                raise ValidationError("A group session is required when visibility is 'group'.")
            if self.group_session and self.group_session.coach_id != self.coach_id:
                raise ValidationError("The group session belongs to a different coach.")
        else:
            # Only 'group' visibility may reference a group session.
            if self.group_session_id:
                raise ValidationError("group_session is only valid when visibility is 'group'.")

    def __str__(self):
        coach = self.coach.user.username if self.coach and hasattr(self.coach, 'user') else 'N/A'
        return f"{self.title} ({coach})"


class ClientSubmission(models.Model):
    """
    A file a client uploads *to* a coach — the coach-accessible "inbox".

    Covers signed contracts, completed assessment reports, and assignment
    responses. A submission may stand alone or reference the Resource (assignment)
    it answers via `in_response_to`. Like resources, the file is served only
    through a permission-checked endpoint, never the public media path.
    """
    STATUS_CHOICES = (
        ('submitted', 'Submitted'),   # waiting for the coach to review
        ('reviewed', 'Reviewed'),     # coach has seen it
    )

    client = models.ForeignKey(
        CustomUser, on_delete=models.CASCADE, related_name='submissions'
    )
    coach = models.ForeignKey(
        UserProfile, on_delete=models.CASCADE, related_name='received_submissions',
        limit_choices_to={'role': 'coach'},
    )
    title = models.CharField(max_length=200)
    note = models.TextField(blank=True)
    file = models.FileField(upload_to='submissions/')
    file_size = models.PositiveBigIntegerField(null=True, blank=True, help_text="Size in bytes.")
    content_type = models.CharField(max_length=120, blank=True)
    # Optional: the resource/assignment this submission answers.
    in_response_to = models.ForeignKey(
        Resource, on_delete=models.SET_NULL, related_name='submissions',
        null=True, blank=True,
        help_text="Optional: the resource/assignment this responds to.",
    )
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='submitted')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['coach', 'status', '-created_at']),
            models.Index(fields=['client', '-created_at']),
        ]

    def clean(self):
        super().clean()
        if self.in_response_to and self.in_response_to.coach_id != self.coach_id:
            raise ValidationError("The referenced resource belongs to a different coach.")

    def __str__(self):
        client = self.client.username if self.client else 'N/A'
        coach = self.coach.user.username if self.coach and hasattr(self.coach, 'user') else 'N/A'
        return f"{client} → {coach}: {self.title}"
