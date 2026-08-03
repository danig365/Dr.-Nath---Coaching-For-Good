from rest_framework import serializers

from .models import Announcement


class AnnouncementSerializer(serializers.ModelSerializer):
    coach_name = serializers.SerializerMethodField()

    class Meta:
        model = Announcement
        fields = ['id', 'skill', 'title', 'body', 'created_at', 'coach_name']
        read_only_fields = ['id', 'skill', 'created_at', 'coach_name']

    def get_coach_name(self, obj):
        u = obj.coach.user
        return f"{u.first_name} {u.last_name}".strip() or u.username
