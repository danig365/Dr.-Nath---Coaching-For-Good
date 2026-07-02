from rest_framework import serializers
from .models import Message, GroupMessage
from bookings.models import SessionBooking
from resources.serializers import validate_upload_file

class MessageSerializer(serializers.ModelSerializer):
    sender_username = serializers.CharField(source='sender.username', read_only=True)
    receiver_username = serializers.CharField(source='receiver.username', read_only=True)
    booking = serializers.PrimaryKeyRelatedField(queryset=SessionBooking.objects.all())
    attachment = serializers.FileField(write_only=True, required=False, allow_null=True)
    attachment_url = serializers.SerializerMethodField()

    class Meta:
        model = Message
        fields = [
            'id',
            'booking',
            'sender',
            'sender_username',
            'receiver',
            'receiver_username',
            'content',
            'attachment',
            'attachment_url',
            'attachment_name',
            'attachment_size',
            'content_type',
            'timestamp',
            'is_read',
        ]
        read_only_fields = [
            'id',
            'sender',
            'sender_username',
            'receiver',
            'receiver_username',
            'attachment_url',
            'attachment_name',
            'attachment_size',
            'content_type',
            'timestamp',
            'is_read',
        ]

    def get_attachment_url(self, obj):
        if not obj.attachment:
            return None
        request = self.context.get('request')
        url = obj.attachment.url
        return request.build_absolute_uri(url) if request else url

    def validate_attachment(self, f):
        if f is None:
            return f
        return validate_upload_file(f)

    def validate(self, attrs):
        content = (attrs.get('content') or '').strip()
        if not content and not attrs.get('attachment'):
            raise serializers.ValidationError("Message must include text or a file.")
        return attrs


class GroupMessageSerializer(serializers.ModelSerializer):
    sender_username = serializers.CharField(source='sender.username', read_only=True)
    attachment = serializers.FileField(write_only=True, required=False, allow_null=True)
    attachment_url = serializers.SerializerMethodField()

    class Meta:
        model = GroupMessage
        fields = [
            'id', 'group_session', 'sender', 'sender_username', 'content',
            'attachment', 'attachment_url', 'attachment_name', 'attachment_size',
            'content_type', 'timestamp',
        ]
        read_only_fields = [
            'id', 'group_session', 'sender', 'sender_username',
            'attachment_url', 'attachment_name', 'attachment_size', 'content_type',
            'timestamp',
        ]

    def get_attachment_url(self, obj):
        if not obj.attachment:
            return None
        request = self.context.get('request')
        url = obj.attachment.url
        return request.build_absolute_uri(url) if request else url

    def validate_attachment(self, f):
        if f is None:
            return f
        return validate_upload_file(f)

    def validate(self, attrs):
        content = (attrs.get('content') or '').strip()
        if not content and not attrs.get('attachment'):
            raise serializers.ValidationError("Message must include text or a file.")
        return attrs