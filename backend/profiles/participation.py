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
        ]
        read_only_fields = ['id', 'created_at', 'skill_name',
                            'clients_registered', 'sessions_used', 'sessions_left']

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
