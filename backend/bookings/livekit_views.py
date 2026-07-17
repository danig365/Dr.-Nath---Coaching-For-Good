"""
LiveKit room access tokens.

The frontend connects to LiveKit Cloud with a short-lived JWT minted here. These
endpoints enforce the SAME access rules as the built-in WebRTC consumers, so the
video provider can be switched without changing who is allowed into a call:

  - 1:1   : the booking's mentor or learner, while status is 'accepted'.
  - group : the coach or a 'booked' client, within the call time window.
"""
import asyncio
import logging
from datetime import timedelta

from django.conf import settings
from django.core import signing
from django.core.cache import cache
from django.utils import timezone as dj_tz
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework import status

from livekit import api as lk_api

from .models import SessionBooking, GroupSession, GroupEnrollment, CallGuest

logger = logging.getLogger(__name__)

# Signed, shareable guest-invite link tokens (N4). The token only encodes the
# booking id; whether the link is live (booking.guest_link_active) and whether
# each guest may enter (CallGuest.status) are enforced server-side per request.
GUEST_INVITE_SALT = 'session-call-guest-invite'
GUEST_INVITE_MAX_AGE = 12 * 3600  # a hard validity cap; joinability checked separately


def make_guest_link_token(booking):
    return signing.dumps({'b': booking.id}, salt=GUEST_INVITE_SALT)


def read_guest_link_token(token):
    """Booking id encoded in a guest link token, or None if invalid/expired."""
    try:
        data = signing.loads(token, salt=GUEST_INVITE_SALT, max_age=GUEST_INVITE_MAX_AGE)
    except (signing.BadSignature, signing.SignatureExpired):
        return None
    return data.get('b')


def coach_in_room(booking):
    """Is the booking's coach currently connected to its LiveKit room? Cached a
    few seconds so the waiting-room polling doesn't hammer the LiveKit API."""
    if not (settings.LIVEKIT_URL and settings.LIVEKIT_API_KEY and settings.LIVEKIT_API_SECRET):
        return False
    key = f"coach_in_room_{booking.id}"
    cached = cache.get(key)
    if cached is not None:
        return cached
    room = f"booking-{booking.id}"
    coach_identity = str(booking.mentor.user_id)

    async def _check():
        lkapi = lk_api.LiveKitAPI(settings.LIVEKIT_URL, settings.LIVEKIT_API_KEY, settings.LIVEKIT_API_SECRET)
        try:
            res = await lkapi.room.list_participants(lk_api.ListParticipantsRequest(room=room))
            return any(p.identity == coach_identity for p in res.participants)
        finally:
            await lkapi.aclose()

    present = False
    try:
        present = asyncio.run(_check())
    except Exception as exc:  # noqa: BLE001 — presence is best-effort
        logger.warning("coach_in_room(%s) failed: %s", booking.id, exc)
    cache.set(key, present, 3)
    return present


def room_participant_count(booking):
    """How many people are currently connected to the booking's LiveKit room, or
    None if it can't be determined. Best-effort, cached briefly. Used to cap the
    room size when admitting guests (N4)."""
    if not (settings.LIVEKIT_URL and settings.LIVEKIT_API_KEY and settings.LIVEKIT_API_SECRET):
        return None
    room = f"booking-{booking.id}"

    async def _count():
        lkapi = lk_api.LiveKitAPI(settings.LIVEKIT_URL, settings.LIVEKIT_API_KEY, settings.LIVEKIT_API_SECRET)
        try:
            res = await lkapi.room.list_participants(lk_api.ListParticipantsRequest(room=room))
            return len(res.participants)
        finally:
            await lkapi.aclose()

    try:
        return asyncio.run(_count())
    except Exception as exc:  # noqa: BLE001 — capacity check is best-effort
        logger.warning("room_participant_count(%s) failed: %s", booking.id, exc)
        return None


def remove_room_participant(booking, identity):
    """Kick a participant (by LiveKit identity) out of the booking's room — used
    by the coach to remove an invited guest (N4). Best-effort."""
    if not (settings.LIVEKIT_URL and settings.LIVEKIT_API_KEY and settings.LIVEKIT_API_SECRET):
        return False
    room = f"booking-{booking.id}"

    async def _remove():
        lkapi = lk_api.LiveKitAPI(settings.LIVEKIT_URL, settings.LIVEKIT_API_KEY, settings.LIVEKIT_API_SECRET)
        try:
            await lkapi.room.remove_participant(lk_api.RoomParticipantIdentity(room=room, identity=identity))
            return True
        finally:
            await lkapi.aclose()

    try:
        return asyncio.run(_remove())
    except Exception as exc:  # noqa: BLE001 — removal is best-effort
        logger.warning("remove_room_participant(%s, %s) failed: %s", booking.id, identity, exc)
        return False


def _display_name(user):
    full = f"{user.first_name} {user.last_name}".strip()
    return full or user.username


def _mint_token_for(identity, name, room):
    """Return a signed LiveKit JWT for `identity` (any participant, incl. guests)
    to join `room`, or None if unconfigured."""
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
        .with_identity(identity)
        .with_name(name)
        .with_grants(grants)
        .with_ttl(timedelta(seconds=settings.LIVEKIT_TOKEN_TTL))
        .to_jwt()
    )


def _mint_token(user, room):
    return _mint_token_for(str(user.id), _display_name(user), room)


def _token_response_for(identity, name, room):
    token = _mint_token_for(identity, name, room)
    if not token:
        return Response(
            {'detail': 'Video service is not configured.'},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )
    return Response({
        'url': settings.LIVEKIT_URL,
        'token': token,
        'room': room,
        'identity': identity,
    })


def _token_response(user, room):
    return _token_response_for(str(user.id), _display_name(user), room)


class BookingCallTokenView(APIView):
    """Token for a 1:1 session call. Only the booking's two participants."""
    permission_classes = [IsAuthenticated]

    def get(self, request, booking_id):
        try:
            booking = SessionBooking.objects.select_related('mentor__user', 'learner').get(id=booking_id)
        except SessionBooking.DoesNotExist:
            return Response({'detail': 'Booking not found.'}, status=status.HTTP_404_NOT_FOUND)

        user = request.user
        is_coach = booking.mentor.user_id == user.id
        is_learner = booking.learner_id == user.id
        if not (is_coach or is_learner) or booking.status != 'accepted':
            return Response({'detail': 'You cannot join this call.'}, status=status.HTTP_403_FORBIDDEN)

        # Waiting room: the coach is the host and joins freely. The client only
        # gets a token once the coach has admitted them.
        if is_learner and booking.client_admit_status != 'admitted':
            return Response({'detail': 'Waiting for the coach to let you in.', 'admit_status': booking.client_admit_status or 'none'},
                            status=status.HTTP_403_FORBIDDEN)

        # Note: attendance is recorded only once the participant actually CONNECTS
        # to the room (see SessionBookingViewSet.mark_joined), not here — merely
        # requesting a token (or checking the lobby preview) must not count.
        return _token_response(user, f'booking-{booking.id}')


# ── Guest join (N4): an extra person the coach invites into a 1:1 call ─────────
# These are PUBLIC (a guest need not have an account); access is gated by the
# signed link token + the coach admitting the guest individually.

class GuestJoinRequestView(APIView):
    """A guest opens the shared link and asks to join. Creates a waiting record;
    the coach still has to admit them before a token is issued."""
    permission_classes = [AllowAny]

    def post(self, request, booking_id):
        import uuid
        from .services import booking_is_joinable
        token = request.data.get('token') or ''
        name = (request.data.get('name') or '').strip()[:120]
        if not name:
            return Response({'detail': 'Please enter your name.'}, status=status.HTTP_400_BAD_REQUEST)
        if read_guest_link_token(token) != booking_id:
            return Response({'detail': 'This guest link is invalid or has expired.'},
                            status=status.HTTP_403_FORBIDDEN)
        try:
            booking = SessionBooking.objects.get(id=booking_id)
        except SessionBooking.DoesNotExist:
            return Response({'detail': 'Session not found.'}, status=status.HTTP_404_NOT_FOUND)
        if not booking.guest_link_active or not booking_is_joinable(booking):
            return Response({'detail': 'This session is not open to guests right now.'},
                            status=status.HTTP_403_FORBIDDEN)
        guest = CallGuest.objects.create(
            booking=booking, guest_uid=uuid.uuid4().hex, name=name, status='requested',
        )
        return Response({'guest_uid': guest.guest_uid, 'name': guest.name})


class GuestJoinStatusView(APIView):
    """A waiting guest polls whether the coach has admitted them yet."""
    permission_classes = [AllowAny]

    def get(self, request, booking_id):
        uid = request.query_params.get('guest_uid') or ''
        try:
            guest = CallGuest.objects.select_related('booking__mentor').get(
                guest_uid=uid, booking_id=booking_id)
        except CallGuest.DoesNotExist:
            return Response({'status': 'denied', 'coach_present': False})
        return Response({'status': guest.status, 'coach_present': coach_in_room(guest.booking)})


class GuestCallTokenView(APIView):
    """Mint a LiveKit token for a guest the coach has admitted, respecting the
    room's participant cap."""
    permission_classes = [AllowAny]

    def get(self, request, booking_id):
        from .services import booking_is_joinable
        token = request.query_params.get('t') or request.query_params.get('token') or ''
        uid = request.query_params.get('guest_uid') or ''
        if read_guest_link_token(token) != booking_id:
            return Response({'detail': 'This guest link is invalid or has expired.'},
                            status=status.HTTP_403_FORBIDDEN)
        try:
            guest = CallGuest.objects.select_related('booking').get(
                guest_uid=uid, booking_id=booking_id)
        except CallGuest.DoesNotExist:
            return Response({'detail': 'Guest not found.'}, status=status.HTTP_404_NOT_FOUND)
        booking = guest.booking
        if not booking.guest_link_active or not booking_is_joinable(booking):
            return Response({'detail': 'This session is not open right now.'},
                            status=status.HTTP_403_FORBIDDEN)
        if guest.status != 'admitted':
            return Response({'detail': 'Waiting for the coach to let you in.', 'admit_status': guest.status},
                            status=status.HTTP_403_FORBIDDEN)
        count = room_participant_count(booking)
        if count is not None and count >= settings.SESSION_CALL_MAX_PARTICIPANTS:
            return Response({'detail': 'This call is full.'}, status=status.HTTP_403_FORBIDDEN)
        return _token_response_for(f'guest-{guest.guest_uid}', guest.name, f'booking-{booking.id}')


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
        # Joinable from 15 minutes before start through the rejoin window after the
        # end, so a group session can run over / be reconnected and continued (N3).
        rejoin = timedelta(minutes=settings.SESSION_REJOIN_MINUTES)
        if now < session.start_datetime - timedelta(minutes=15) or now > session.end_datetime + rejoin:
            return Response({'detail': 'This call is not open right now.'}, status=status.HTTP_403_FORBIDDEN)

        user = request.user
        is_coach = session.coach.user_id == user.id
        is_booked = GroupEnrollment.objects.filter(
            group_session=session, learner=user, status='booked'
        ).exists()
        if not (is_coach or is_booked):
            return Response({'detail': 'You are not enrolled in this session.'}, status=status.HTTP_403_FORBIDDEN)

        return _token_response(user, f'group-{session.id}')
