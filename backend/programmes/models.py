from django.db import models

from profiles.models import UserProfile
from skills.models import Skill


class Announcement(models.Model):
    """A short update a coach posts to one of their programmes (a Skill). Every
    client enrolled in that programme sees it in the programme space."""
    coach = models.ForeignKey(
        UserProfile,
        on_delete=models.CASCADE,
        related_name='announcements',
        limit_choices_to={'role': 'coach'},
    )
    skill = models.ForeignKey(
        Skill,
        on_delete=models.CASCADE,
        related_name='announcements',
    )
    title = models.CharField(max_length=200)
    body = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.title} — {self.skill.name}"
