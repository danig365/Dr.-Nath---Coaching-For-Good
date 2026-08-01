from django.conf import settings
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny, IsAdminUser
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Newsletter, NewsletterSubscriber
from .serializers import (
    NewsletterSerializer, SubscribeSerializer, SubscriberSerializer,
)


class SubscribeView(APIView):
    """Public newsletter sign-up. Idempotent: re-subscribing with an existing
    email reactivates that subscriber (and refreshes name/source) instead of
    erroring on the unique constraint."""
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = SubscribeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        subscriber, created = NewsletterSubscriber.objects.get_or_create(
            email=data['email'],
            defaults={'first_name': data.get('first_name', ''), 'source': data.get('source', 'other')},
        )
        if not created:
            subscriber.is_active = True
            if data.get('first_name'):
                subscriber.first_name = data['first_name']
            subscriber.save(update_fields=['is_active', 'first_name', 'updated_at'])

        return Response(
            {'detail': "You're subscribed."},
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class NewsletterViewSet(viewsets.ModelViewSet):
    """Admin CRUD for newsletter issues. A sent newsletter is immutable."""
    queryset = Newsletter.objects.all()
    serializer_class = NewsletterSerializer
    permission_classes = [IsAdminUser]

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    def _block_if_sent(self, instance):
        if instance.status == Newsletter.STATUS_SENT:
            raise ValidationError("A sent newsletter can no longer be edited or deleted.")

    def perform_update(self, serializer):
        self._block_if_sent(serializer.instance)
        serializer.save()

    def perform_destroy(self, instance):
        self._block_if_sent(instance)
        instance.delete()

    @action(detail=True, methods=['post'])
    def send(self, request, pk=None):
        """Queue this newsletter to the chosen audience. The existing dispatcher
        delivers the queued emails. Idempotent per recipient via dedupe_key, and
        the issue becomes immutable once sent.

        Body param `audience`: 'subscribers' (default), 'clients', or 'both'.
        Registered clients are folded into the subscriber list (source='client')
        so they get a proper unsubscribe link, dedupe, and — if they've ever
        unsubscribed — are respectfully skipped. Sending to 'both' never
        double-sends: a client who is also a subscriber shares one row (unique
        email), so they receive a single copy."""
        newsletter = self.get_object()
        if newsletter.status == Newsletter.STATUS_SENT:
            return Response({'detail': 'This newsletter has already been sent.'},
                            status=status.HTTP_400_BAD_REQUEST)

        from notifications.models import ScheduledNotification
        from profiles.models import UserProfile

        audience = (request.data.get('audience') or 'subscribers').lower()
        if audience not in ('subscribers', 'clients', 'both'):
            return Response({'detail': "audience must be 'subscribers', 'clients' or 'both'."},
                            status=status.HTTP_400_BAD_REQUEST)

        # Collect recipients as NewsletterSubscriber rows keyed by email (dedupes
        # across the two audiences automatically).
        recipients = {}

        if audience in ('subscribers', 'both'):
            for sub in NewsletterSubscriber.objects.filter(is_active=True):
                recipients[sub.email] = sub

        if audience in ('clients', 'both'):
            clients = UserProfile.objects.filter(role='client').select_related('user')
            for prof in clients:
                user = prof.user
                if not user.email:
                    continue
                sub, _ = NewsletterSubscriber.objects.get_or_create(
                    email=user.email,
                    defaults={'first_name': user.first_name or '', 'source': 'client'},
                )
                if sub.is_active:  # respect a prior unsubscribe
                    recipients.setdefault(sub.email, sub)

        now = timezone.now()
        count = 0
        for sub in recipients.values():
            unsubscribe_url = f"{settings.SITE_URL}/api/newsletter/unsubscribe/{sub.unsubscribe_token}/"
            ScheduledNotification.queue(
                kind='newsletter',
                recipient_email=sub.email,
                subject=newsletter.subject,
                template='newsletter',
                context={
                    'subject': newsletter.subject,
                    'first_name': sub.first_name,
                    'body_html': newsletter.body_html,
                    'unsubscribe_url': unsubscribe_url,
                },
                scheduled_for=now,
                dedupe_key=f'newsletter-{newsletter.id}-{sub.id}',
            )
            count += 1

        newsletter.status = Newsletter.STATUS_SENT
        newsletter.sent_at = now
        newsletter.sent_count = count
        newsletter.save(update_fields=['status', 'sent_at', 'sent_count', 'updated_at'])
        return Response(self.get_serializer(newsletter).data)


class SubscriberListView(APIView):
    """Admin: all subscribers plus active/total counts."""
    permission_classes = [IsAdminUser]

    def get(self, request):
        from profiles.models import UserProfile
        qs = NewsletterSubscriber.objects.all()
        registered_clients = UserProfile.objects.filter(
            role='client', user__email__gt='',
        ).count()
        return Response({
            'total': qs.count(),
            'active': qs.filter(is_active=True).count(),
            'registered_clients': registered_clients,
            'subscribers': SubscriberSerializer(qs, many=True).data,
        })


class UnsubscribeView(APIView):
    """Public one-click unsubscribe via the token embedded in every email.
    Returns a small branded confirmation page (links are opened in a browser)."""
    permission_classes = [AllowAny]

    def get(self, request, token):
        sub = NewsletterSubscriber.objects.filter(unsubscribe_token=token).first()
        if sub and sub.is_active:
            sub.is_active = False
            sub.save(update_fields=['is_active', 'updated_at'])
        message = ("You've been unsubscribed. You won't receive any more newsletters."
                   if sub else "This unsubscribe link is invalid or has expired.")
        html = f"""<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Unsubscribe — Dr. Nath</title></head>
<body style="margin:0;background:#FAF6EC;font-family:Georgia,serif;color:#1B2B4A;">
  <div style="max-width:480px;margin:64px auto;background:#fff;border-radius:16px;
       box-shadow:0 2px 16px rgba(27,43,74,0.08);overflow:hidden;text-align:center;">
    <div style="background:linear-gradient(135deg,#1B2B4A,#14213D);padding:24px;">
      <div style="font-size:22px;font-weight:bold;color:#fff;">Dr. Nath</div>
      <div style="font-size:11px;letter-spacing:3px;color:#C8A951;text-transform:uppercase;">Coaching for Impact</div>
    </div>
    <div style="height:4px;background:linear-gradient(90deg,#C8A951,#F0D98C);"></div>
    <div style="padding:36px 28px;">
      <p style="font-size:16px;line-height:1.6;color:#4A5568;font-family:Arial,sans-serif;">{message}</p>
      <a href="{settings.SITE_URL}" style="display:inline-block;margin-top:16px;background:linear-gradient(135deg,#C8A951,#F0D98C);
         color:#14213D;text-decoration:none;font-weight:bold;font-size:14px;padding:12px 28px;border-radius:999px;font-family:Arial,sans-serif;">
        Back to dr-nath.com</a>
    </div>
  </div>
</body></html>"""
        return HttpResponse(html)
