from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from rest_framework import viewsets, permissions
from rest_framework.exceptions import ValidationError
from .models import Message
from .serializers import MessageSerializer


def broadcast_message(message):
    """Push a saved Message to its booking's chat group so connected peers get
    it in real time (mirrors the WebSocket text path for REST/file uploads)."""
    layer = get_channel_layer()
    if layer is None:
        return
    async_to_sync(layer.group_send)(
        f'chat_{message.booking_id}',
        {
            'type': 'chat_message',
            'id': message.id,
            'content': message.content,
            'sender': message.sender_id,
            'sender_username': message.sender.username,
            'timestamp': message.timestamp.isoformat(),
            'attachment_url': message.attachment.url if message.attachment else None,
            'attachment_name': message.attachment_name or None,
            'attachment_size': message.attachment_size,
            'content_type': message.content_type or None,
        },
    )


def broadcast_group_message(message):
    """Push a saved GroupMessage to its session's group-chat group so connected
    members get it in real time (mirrors the WebSocket text path for uploads)."""
    layer = get_channel_layer()
    if layer is None:
        return
    async_to_sync(layer.group_send)(
        f'groupchat_{message.group_session_id}',
        {
            'type': 'group_message',
            'id': message.id,
            'content': message.content,
            'sender': message.sender_id,
            'sender_username': message.sender.username,
            'timestamp': message.timestamp.isoformat(),
            'attachment_url': message.attachment.url if message.attachment else None,
            'attachment_name': message.attachment_name or None,
            'attachment_size': message.attachment_size,
            'content_type': message.content_type or None,
        },
    )

class MessageViewSet(viewsets.ModelViewSet):
    serializer_class = MessageSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        if not hasattr(user, 'profile'):
            return Message.objects.none()

        queryset = Message.objects.select_related('booking', 'sender', 'receiver')

        if user.profile.role == 'coach':
            queryset = queryset.filter(booking__mentor=user.profile)
        elif user.profile.role == 'client':
            queryset = queryset.filter(booking__learner=user)
        else:
            return Message.objects.none()

        booking_id = self.request.query_params.get('booking')
        if booking_id:
            queryset = queryset.filter(booking_id=booking_id)

        queryset = queryset.filter(booking__status__in=['accepted', 'completed'])

        return queryset.order_by('timestamp')

    def list(self, request, *args, **kwargs):
        booking_id = request.query_params.get('booking')
        if booking_id and hasattr(request.user, 'profile'):
            Message.objects.filter(
                booking_id=booking_id,
                receiver=request.user,
                is_read=False,
            ).update(is_read=True)
        return super().list(request, *args, **kwargs)

    def perform_create(self, serializer):
        booking = serializer.validated_data.get('booking')
        user = self.request.user

        if not hasattr(user, 'profile'):
            raise ValidationError("User profile not found.")

        if booking.status not in ['accepted', 'completed']:
            raise ValidationError("Chat is only available for accepted or completed sessions.")

        is_mentor = user.profile.role == 'coach' and booking.mentor == user.profile
        is_learner = user.profile.role == 'client' and booking.learner == user

        if not (is_mentor or is_learner):
            raise ValidationError("You can only chat in your own sessions.")

        receiver = booking.learner if is_mentor else booking.mentor.user

        attachment = serializer.validated_data.get('attachment')
        extra = {}
        if attachment:
            extra = {
                'attachment_name': (getattr(attachment, 'name', '') or '')[:255],
                'attachment_size': getattr(attachment, 'size', None),
                'content_type': getattr(attachment, 'content_type', '') or '',
            }

        message = serializer.save(sender=user, receiver=receiver, **extra)

        # File uploads come over REST, so broadcast them to the chat group; text
        # already travels over the WebSocket. Broadcasting only attachments here
        # avoids double-delivery of plain text messages.
        if attachment:
            broadcast_message(message)