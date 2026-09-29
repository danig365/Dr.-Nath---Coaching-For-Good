"""Participation codes: the partner-organisation side of the October campaign.

A practice gets a code, an allocation of sessions and a per-patient limit. This
module is what Dr Nath manages them through, what the registration form checks a
typed code against, and what the practice's anonymised report is built from.
"""
from django.db.models import Count, Q
from django.utils import timezone as dj_tz

from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import ParticipationCode, UserProfile


class ParticipationCodeSerializer(serializers.ModelSerializer):
    skill_name = serializers.CharField(source='skill.name', read_only=True, default='')
    clients_registered = serializers.SerializerMethodField()
    sessions_used = serializers.SerializerMethodField()
    sessions_left = serializers.SerializerMethodField()

    class Meta:
        model = ParticipationCode
        fields = [
            'id', 'code', 'organisation', 'contact_name', 'contact_email',
            'skill', 'skill_name', 'total_sessions', 'max_per_client',
            'valid_from', 'valid_until', 'active', 'notes',
            'clients_registered', 'sessions_used', 'sessions_left', 'created_at',
            'invite_sent_at', 'invite_sent_count',
        ]
        read_only_fields = ['id', 'created_at', 'skill_name',
                            'clients_registered', 'sessions_used', 'sessions_left',
                            'invite_sent_at', 'invite_sent_count']

    def validate_contact_email(self, value):
        """Several addresses, however they were typed — comma, semicolon or line."""
        import re
        from django.core.validators import validate_email
        from django.core.exceptions import ValidationError as DjangoValidationError
        parts = [e.strip() for e in re.split(r'[;,\n]+', value or '') if e.strip()]
        bad = []
        for email in parts:
            try:
                validate_email(email)
            except DjangoValidationError:
                bad.append(email)
        if bad:
            raise serializers.ValidationError(
                f"{'These addresses do not look right' if len(bad) > 1 else 'That address does not look right'}: "
                + ', '.join(bad))
        return ', '.join(parts)

    def get_clients_registered(self, obj):
        return obj.clients.count()

    def get_sessions_used(self, obj):
        from bookings.services import code_bookings_used
        return code_bookings_used(obj)

    def get_sessions_left(self, obj):
        from bookings.services import code_bookings_used
        return max(0, (obj.total_sessions or 0) - code_bookings_used(obj))

    def validate_code(self, value):
        value = (value or '').strip().upper()
        if not value:
            raise serializers.ValidationError("A code is required.")
        clash = ParticipationCode.objects.filter(code=value)
        if self.instance:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError("That code is already in use.")
        return value


class ParticipationCodeViewSet(viewsets.ModelViewSet):
    """Dr Nath's own codes. One row per participating practice."""
    serializer_class = ParticipationCodeSerializer
    permission_classes = [IsAuthenticated]

    def _profile(self):
        profile = getattr(self.request.user, 'profile', None)
        if profile is None or profile.role not in ('coach', 'admin'):
            raise serializers.ValidationError("Only coaches manage participation codes.")
        return profile

    def get_queryset(self):
        profile = getattr(self.request.user, 'profile', None)
        if profile is None:
            return ParticipationCode.objects.none()
        if profile.role == 'admin':
            return ParticipationCode.objects.select_related('skill').all()
        return ParticipationCode.objects.select_related('skill').filter(coach=profile)

    def perform_create(self, serializer):
        serializer.save(coach=self._profile())

    @action(detail=True, methods=['get', 'post'])
    def invitation(self, request, pk=None):
        """The invitation to the practice: GET the draft, POST to send it.

        The draft is filled in from the code itself — practice name, the code,
        the window and the allocation — so the coach only has to read it over.
        She can edit every word before it goes, and each recipient is sent their
        own copy rather than a visible group email.
        """
        from django.conf import settings
        from django.utils import timezone as tz
        from notifications.services import send_email

        code = self.get_object()

        if request.method == 'GET':
            return Response({
                'to': code.contact_emails(),
                'subject': default_invite_subject(code),
                'body': default_invite_body(code, request.user),
                'sent_at': code.invite_sent_at,
                'sent_count': code.invite_sent_count,
            })

        # Only fall back to the saved contacts when the caller didn't mention
        # recipients at all. Someone who cleared the box meant to clear it.
        to = request.data['to'] if 'to' in request.data else code.contact_emails()
        if isinstance(to, str):
            import re
            to = [e.strip() for e in re.split(r'[;,\n]+', to) if e.strip()]
        to = [e for e in to if e]
        if not to:
            return Response({'detail': 'Add at least one email address to send to.'}, status=400)

        subject = (request.data.get('subject') or default_invite_subject(code)).strip()
        body = (request.data.get('body') or default_invite_body(code, request.user)).strip()
        if not body:
            return Response({'detail': 'The message is empty.'}, status=400)

        window = ''
        if code.valid_from and code.valid_until:
            window = f"{code.valid_from:%-d %B} – {code.valid_until:%-d %B %Y}"

        sent, failed = 0, []
        for email in to:
            ok = send_email(
                to=email, subject=subject, template='partner_invite',
                context={
                    'body': body, 'subject': subject, 'code': code.code,
                    'total_sessions': code.total_sessions,
                    'max_per_client': code.max_per_client,
                    'window': window, 'site_url': settings.SITE_URL,
                },
                reply_to=[getattr(settings, 'CONTACT_EMAIL', '') or settings.DEFAULT_FROM_EMAIL],
            )
            if ok:
                sent += 1
            else:
                failed.append(email)

        if sent:
            code.invite_sent_at = tz.now()
            code.invite_sent_count = (code.invite_sent_count or 0) + sent
            code.save(update_fields=['invite_sent_at', 'invite_sent_count'])

        return Response({'sent': sent, 'failed': failed, 'sent_at': code.invite_sent_at,
                         'sent_count': code.invite_sent_count})

    @action(detail=True, methods=['get'])
    def report(self, request, pk=None):
        """The practice's anonymised report: numbers only, never coaching content.

        Individual patients are not named and nothing they discussed is included
        — a practice sees how its allocation was used, not what was said.
        """
        from bookings.models import SessionBooking
        from bookings.services import SPENT_BOOKING_STATUSES, code_bookings_used

        code = self.get_object()
        clients = UserProfile.objects.filter(participation_code=code)
        bookings = SessionBooking.objects.filter(learner__profile__participation_code=code)
        if code.skill_id:
            bookings = bookings.filter(skill_id=code.skill_id)

        live = bookings.filter(status__in=SPENT_BOOKING_STATUSES)
        now = dj_tz.now()
        per_client = (
            live.values('learner_id')
            .annotate(n=Count('id'))
            .order_by()
        )
        counts = [row['n'] for row in per_client]
        used = code_bookings_used(code)
        return Response({
            'code': code.code,
            'organisation': code.organisation,
            'window': {'from': code.valid_from, 'until': code.valid_until},
            'allocation': {
                'total': code.total_sessions,
                'used': used,
                'left': max(0, (code.total_sessions or 0) - used),
                'max_per_client': code.max_per_client,
            },
            'patients': {
                'registered': clients.count(),
                'booked_at_least_one': len(counts),
                'consented_to_share': clients.filter(share_with_organisation=True).count(),
                'average_sessions_each': round(sum(counts) / len(counts), 1) if counts else 0,
            },
            'sessions': {
                'completed': bookings.filter(status='completed').count(),
                'upcoming': live.filter(session_date__gte=now.date()).count(),
                'cancelled': bookings.filter(status='cancelled').count(),
                'missed': bookings.filter(status='no_show').count(),
            },
        })


def default_invite_subject(code):
    year = code.valid_from.year if code.valid_from else ''
    month = f"{code.valid_from:%B}" if code.valid_from else ''
    when = f" — {month} {year}".rstrip()
    return f"{code.total_sessions} complimentary coaching sessions for your patients{when}"


def default_invite_body(code, user):
    """The letter, with this practice's own details already in it.

    Kept as plain text the coach reads and edits in the app; what she sends is
    what they get.
    """
    from django.conf import settings

    practice = code.organisation or 'your practice'
    greeting = f"Dear {code.contact_name}," if code.contact_name else "Dear Doctor,"
    if code.valid_from and code.valid_until:
        window = f"{code.valid_from:%-d %B} to {code.valid_until:%-d %B %Y}"
        book_from = f"{code.valid_from:%-d %B}"
    else:
        window, book_from = "October 2026", "1 October"
    coach_name = (f"{user.first_name} {user.last_name}".strip() or user.username)

    return f"""{greeting}

In celebration of Health Month, we invite {practice} to partner with dr-nath.com in helping your patients turn sound medical advice into sustainable, everyday habits.

From {window} we are offering your practice {code.total_sessions} complimentary 30-minute health and wellness coaching sessions for patients you nominate. Coaching complements clinical care: it helps patients translate the goals you agree with them into practical routines, keeps them accountable, and sustains change between appointments.

How it works
- Each nominated patient books a 30-minute session on the secure dr-nath.com platform, at a date and time that suits them.
- A patient may use up to {code.max_per_client} sessions during this period, ideally one a week.
- Your practice's participation code is {code.code}. Patients enter it in the Participation Code box when they register, so their sessions draw on your practice's allocation.

What we need from you
1. Confirm your participation by replying to this email.
2. Share the code {code.code} with the patients you nominate.
3. Ask them to register at {settings.SITE_URL} — they can do this now — and book their sessions from {book_from}.

What your practice gains
- Continuity of care between consultations, reinforcing the goals you have already agreed.
- Stronger patient engagement through structured accountability.
- An anonymised summary report on participation and progress, within applicable privacy safeguards.
- Visibility in our newsletter and on our website for three months.

This offer is limited to {code.total_sessions} sessions for {practice}.

Together we can extend the impact of your care beyond the consultation room.

Yours sincerely,
{coach_name}"""


class ParticipationCodeCheckView(APIView):
    """Public: does this code work? Used by the registration form as it's typed."""
    permission_classes = [AllowAny]

    def get(self, request):
        value = (request.query_params.get('code') or '').strip().upper()
        if not value:
            return Response({'valid': False, 'detail': ''})
        code = ParticipationCode.objects.filter(code=value).first()
        if code is None:
            return Response({'valid': False,
                             'detail': "We don't recognise that code. Please check it with your practice."})
        window = code.window_error(registering=True)
        if window:
            return Response({'valid': False, 'detail': window})
        detail = f"Recognised — {code.organisation}."
        if code.opens_later():
            detail += f" Sessions can be booked from {code.valid_from:%-d %B %Y}."
        return Response({'valid': True, 'organisation': code.organisation, 'detail': detail})
