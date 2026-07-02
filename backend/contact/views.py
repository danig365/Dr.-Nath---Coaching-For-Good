from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import ContactMessage
from .serializers import ContactMessageSerializer


class ContactMessageListCreateView(generics.ListCreateAPIView):
    """
    POST — anyone can submit a contact message (public form).
    GET  — admins/staff list all messages.
    """
    queryset = ContactMessage.objects.all()
    serializer_class = ContactMessageSerializer

    def get_permissions(self):
        if self.request.method == 'POST':
            return [permissions.AllowAny()]
        return [permissions.IsAdminUser()]

    def perform_create(self, serializer):
        user = self.request.user if self.request.user.is_authenticated else None
        msg = serializer.save(user=user)
        # Best-effort: notify the business that a message arrived.
        try:
            from django.conf import settings
            from django.contrib.auth import get_user_model
            from notifications.services import send_email
            coach = get_user_model().objects.filter(profile__role='coach').first()
            to = coach.email if coach and coach.email else None
            if to:
                send_email(
                    to=to,
                    subject=f"New contact message: {msg.subject}",
                    template='contact_message',
                    context={
                        'name': msg.name or 'Someone',
                        'email': msg.email,
                        'subject': msg.subject,
                        'message': msg.message,
                        'admin_url': f"{settings.SITE_URL}/admin?tab=messages",
                    },
                    reply_to=[msg.email],
                )
        except Exception as exc:  # noqa: BLE001
            print(f"Contact message saved but notification failed: {exc}")


class ContactMessageDetailView(APIView):
    """Admin: mark a message read/unread, or delete it."""
    permission_classes = [permissions.IsAdminUser]

    def patch(self, request, pk):
        try:
            msg = ContactMessage.objects.get(pk=pk)
        except ContactMessage.DoesNotExist:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        msg.is_read = bool(request.data.get('is_read', True))
        msg.save(update_fields=['is_read'])
        return Response(ContactMessageSerializer(msg).data)

    def delete(self, request, pk):
        ContactMessage.objects.filter(pk=pk).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
