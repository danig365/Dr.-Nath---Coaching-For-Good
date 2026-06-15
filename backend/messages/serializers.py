from rest_framework import serializers
from .models import Message, GroupMessage
from bookings.models import SessionBooking

class MessageSerializer(serializers.ModelSerializer):
    sender_username = serializers.CharField(source='sender.username', read_only=True)
    receiver_username = serializers.CharField(source='receiver.username', read_only=True)
    booking = serializers.PrimaryKeyRelatedField(queryset=SessionBooking.objects.all())

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
            'timestamp',
            'is_read',
        ]
        read_only_fields = [
            'id',
            'sender',
            'sender_username',
            'receiver',
            'receiver_username',
            'timestamp',
            'is_read',
        ]


class GroupMessageSerializer(serializers.ModelSerializer):
    sender_username = serializers.CharField(source='sender.username', read_only=True)

    class Meta:
        model = GroupMessage
        fields = ['id', 'group_session', 'sender', 'sender_username', 'content', 'timestamp']
        read_only_fields = fields