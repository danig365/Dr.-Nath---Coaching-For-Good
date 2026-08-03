"""
Template Builder — reusable intake forms & feedback surveys.

A coach builds a FormTemplate (a titled set of questions) once, then assigns it
to clients as many times as needed. Each assignment snapshots the template's
questions at send time (FormAssignment.questions_snapshot) so later edits to the
template never change a form a client has already been sent. The client fills it
in (FormAssignment.answers) and the coach reads the responses.

Questions are stored as JSON rather than separate rows — a form is always read
and written as a whole, so a list of dicts is simpler and keeps ordering:
    {"id": "q1", "label": "...", "type": "short_text",
     "required": true, "options": ["A", "B"]}
"""
from django.db import models

from profiles.models import UserProfile, CustomUser


# Supported question types. `options` only applies to the choice types.
QUESTION_TYPES = [
    'short_text', 'long_text', 'single_choice', 'multi_choice',
    'rating', 'yes_no', 'number', 'date',
]


class FormTemplate(models.Model):
    KIND_INTAKE = 'intake'
    KIND_FEEDBACK = 'feedback'
    KIND_OTHER = 'other'
    KIND_CHOICES = [
        (KIND_INTAKE, 'Intake form'),
        (KIND_FEEDBACK, 'Feedback survey'),
        (KIND_OTHER, 'Other'),
    ]

    coach = models.ForeignKey(
        UserProfile, on_delete=models.CASCADE, related_name='form_templates',
        limit_choices_to={'role': 'coach'},
    )
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True, help_text="Optional intro shown to the client.")
    kind = models.CharField(max_length=12, choices=KIND_CHOICES, default=KIND_INTAKE)
    # Optional: designate this template as the intake form for a specific skill.
    # Used by the public Chemistry Session flow (intake-gated booking).
    skill = models.ForeignKey(
        'skills.Skill', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='intake_forms',
    )

    # Ordered list of question dicts (see module docstring).
    questions = models.JSONField(default=list, blank=True)

    active = models.BooleanField(default=True)  # archive instead of delete
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']

    def __str__(self):
        return f"{self.title} ({self.coach.user.username})"


class FormAssignment(models.Model):
    STATUS_SENT = 'sent'            # awaiting the client's response
    STATUS_COMPLETED = 'completed'  # client has submitted
    STATUS_CHOICES = [
        (STATUS_SENT, 'Awaiting response'),
        (STATUS_COMPLETED, 'Completed'),
    ]

    template = models.ForeignKey(
        FormTemplate, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='assignments',
    )
    coach = models.ForeignKey(
        UserProfile, on_delete=models.CASCADE, related_name='sent_form_assignments',
        limit_choices_to={'role': 'coach'},
    )
    client = models.ForeignKey(
        CustomUser, on_delete=models.CASCADE, related_name='form_assignments',
    )
    # Link to a session, e.g. a post-session feedback survey (optional).
    booking = models.ForeignKey(
        'bookings.SessionBooking', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='form_assignments',
    )

    # Frozen at assign time so template edits don't alter a sent form.
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    kind = models.CharField(max_length=12, default=FormTemplate.KIND_INTAKE)
    questions_snapshot = models.JSONField(default=list, blank=True)

    # {question_id: answer} — answer shape depends on the question type.
    answers = models.JSONField(default=dict, blank=True)

    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default=STATUS_SENT)
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.title} -> {self.client.username} ({self.status})"
