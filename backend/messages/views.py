from rest_framework import viewsets, permissions
from rest_framework.exceptions import ValidationError
from .models import Message
from .serializers import MessageSerializer

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
        serializer.save(sender=user, receiver=receiver)