from rest_framework import serializers

from .models import SignatureDocument

# Reuse the resources upload guard (size cap + type allowlist).
from resources.serializers import validate_upload_file


class SignatureDocumentSerializer(serializers.ModelSerializer):
    file = serializers.FileField(write_only=True)
    coach_name = serializers.SerializerMethodField()
    client_name = serializers.SerializerMethodField()
    client_username = serializers.CharField(source='client.username', read_only=True)
    has_signed_file = serializers.SerializerMethodField()

    class Meta:
        model = SignatureDocument
        fields = [
            'id', 'title', 'message', 'file', 'status',
            'coach', 'coach_name', 'client', 'client_name', 'client_username',
            'client_signature', 'client_signed_at',
            'coach_signature', 'coach_signed_at',
            'decline_reason', 'has_signed_file', 'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'status', 'coach', 'coach_name', 'client_name', 'client_username',
            'client_signature', 'client_signed_at',
            'coach_signature', 'coach_signed_at',
            'decline_reason', 'has_signed_file', 'created_at', 'updated_at',
        ]

    def _display(self, user):
        if not user:
            return ''
        return f"{user.first_name} {user.last_name}".strip() or user.username

    def get_coach_name(self, obj):
        return self._display(obj.coach.user if obj.coach else None)

    def get_client_name(self, obj):
        return self._display(obj.client)

    def get_has_signed_file(self, obj):
        return bool(obj.signed_file)

    def validate_file(self, f):
        return validate_upload_file(f)
