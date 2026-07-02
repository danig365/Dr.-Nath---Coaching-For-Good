from rest_framework import serializers

from .models import ContactMessage


class ContactMessageSerializer(serializers.ModelSerializer):
    class Meta:
        model = ContactMessage
        fields = ['id', 'name', 'email', 'subject', 'message', 'is_read', 'created_at']
        read_only_fields = ['id', 'is_read', 'created_at']

    def validate(self, attrs):
        if not (attrs.get('subject') or '').strip():
            raise serializers.ValidationError({'subject': 'A subject is required.'})
        if not (attrs.get('message') or '').strip():
            raise serializers.ValidationError({'message': 'A message is required.'})
        return attrs
