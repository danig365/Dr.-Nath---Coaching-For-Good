"""
LiveKit room access tokens.

The frontend connects to LiveKit Cloud with a short-lived JWT minted here. These
endpoints enforce the SAME access rules as the built-in WebRTC consumers, so the
video provider can be switched without changing who is allowed into a call:

  - 1:1   : the booking's mentor or learner, while status is 'accepted'.
  - group : the coach or a 'booked' client, within the call time window.
"""
from datetime import timedelta

from django.conf import settings
from django.utils import timezone as dj_tz
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

from livekit import api as lk_api

from .models import SessionBooking, GroupSession, GroupEnrollment


def _display_name(user):
    full = f"{user.first_name} {user.last_name}".strip()
    return full or user.username


def _mint_token(user, room):
    """Return a signed LiveKit JWT for `user` to join `room`, or None if unconfigured."""
    if not (settings.LIVEKIT_URL and settings.LIVEKIT_API_KEY and settings.LIVEKIT_API_SECRET):
        return None
    grants = lk_api.VideoGrants(
        room_join=True,
        room=room,
        can_publish=True,
        can_subscribe=True,
        can_publish_data=True,
    )
    return (
        lk_api.AccessToken(settings.LIVEKIT_API_KEY, settings.LIVEKIT_API_SECRET)
        .with_identity(str(user.id))
        .with_name(_display_name(user))
        .with_grants(grants)
        .with_ttl(timedelta(seconds=settings.LIVEKIT_TOKEN_TTL))
        .to_jwt()
    )


def _token_response(user, room):
    token = _mint_token(user, room)
    if not token:
        return Response(
            {'detail': 'Video service is not configured.'},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )
    return Response({
        'url': settings.LIVEKIT_URL,
        'token': token,
        'room': room,
        'identity': str(user.id),
    })


class BookingCallTokenView(APIView):
    """Token for a 1:1 session call. Only the booking's two participants."""
    permission_classes = [IsAuthenticated]

    def get(self, request, booking_id):
        try:
            booking = SessionBooking.objects.select_related('mentor__user', 'learner').get(id=booking_id)
        except SessionBooking.DoesNotExist:
            return Response({'detail': 'Booking not found.'}, status=status.HTTP_404_NOT_FOUND)

        user = request.user
        is_participant = booking.mentor.user_id == user.id or booking.learner_id == user.id
        if not is_participant or booking.status != 'accepted':
            return Response({'detail': 'You cannot join this call.'}, status=status.HTTP_403_FORBIDDEN)

        # Note: attendance is recorded only once the participant actually CONNECTS
        # to the room (see SessionBookingViewSet.mark_joined), not here — merely
        # requesting a token (or checking the lobby preview) must not count.
        return _token_response(user, f'booking-{booking.id}')


class GroupCallTokenView(APIView):
    """Token for a group session call. Coach or booked client, within the window."""
    permission_classes = [IsAuthenticated]

    def get(self, request, session_id):
        try:
            session = GroupSession.objects.select_related('coach__user').get(id=session_id)
        except GroupSession.DoesNotExist:
            return Response({'detail': 'Session not found.'}, status=status.HTTP_404_NOT_FOUND)

        if session.status == 'cancelled':
            return Response({'detail': 'This session was cancelled.'}, status=status.HTTP_403_FORBIDDEN)

        now = dj_tz.now()
        # Joinable from 15 minutes before start until a grace window after the end.
        grace = timedelta(minutes=settings.SESSION_GRACE_MINUTES)
        if now < session.start_datetime - timedelta(minutes=15) or now > session.end_datetime + grace:
            return Response({'detail': 'This call is not open right now.'}, status=status.HTTP_403_FORBIDDEN)

        user = request.user
        is_coach = session.coach.user_id == user.id
        is_booked = GroupEnrollment.objects.filter(
            group_session=session, learner=user, status='booked'
        ).exists()
        if not (is_coach or is_booked):
            return Response({'detail': 'You are not enrolled in this session.'}, status=status.HTTP_403_FORBIDDEN)

        return _token_response(user, f'group-{session.id}')
