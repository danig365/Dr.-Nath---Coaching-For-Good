"""Google Calendar OAuth connect/callback/status/disconnect (Phase 1)."""
import logging

from django.conf import settings
from django.core import signing
from django.shortcuts import redirect
from datetime import timezone as dt_timezone
from django.utils import timezone as dj_tz
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework import status

from .models import GoogleCalendarAccount
from . import google_service as gsvc

logger = logging.getLogger(__name__)

STATE_SALT = "integrations.google.oauth"
STATE_MAX_AGE = 600  # seconds a consent round-trip may take


def _can_connect(user):
    """Coaches and clients may connect a calendar (admins have no sessions)."""
    profile = getattr(user, 'profile', None)
    return bool(profile and profile.role in ('coach', 'client'))


def _keep_existing_refresh(profile):
    existing = GoogleCalendarAccount.objects.filter(profile=profile).first()
    return existing.refresh_token if existing else ''


class GoogleConnectView(APIView):
    """Coach-only: return the Google consent URL to redirect the browser to.
    The coach's identity is carried in a signed `state` (the callback is a
    top-level redirect with no auth header)."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not gsvc.is_configured():
            return Response({'detail': 'Google Calendar is not configured on the server.'},
                            status=status.HTTP_503_SERVICE_UNAVAILABLE)
        if not _can_connect(request.user):
            return Response({'detail': 'This account type cannot connect a calendar.'},
                            status=status.HTTP_403_FORBIDDEN)
        state = signing.dumps(request.user.profile.id, salt=STATE_SALT)
        return Response({'authorize_url': gsvc.build_authorize_url(state)})


class GoogleCallbackView(APIView):
    """Google redirects the browser here after consent. Validates state,
    exchanges the code, stores the coach's tokens, then bounces back to the app."""
    permission_classes = [AllowAny]

    def get(self, request):
        # Where the user came from — coaches manage on My Availability, clients
        # on My Learning. Default to My Availability if we can't tell.
        def _dest(profile, param):
            page = 'my-learning' if profile and profile.role == 'client' else 'my-availability'
            return redirect(f"{settings.SITE_URL}/{page}?google={param}")

        error = request.query_params.get('error')
        code = request.query_params.get('code')
        state = request.query_params.get('state')
        if error or not code or not state:
            return _dest(None, 'error')

        try:
            profile_id = signing.loads(state, salt=STATE_SALT, max_age=STATE_MAX_AGE)
        except signing.BadSignature:
            return _dest(None, 'error')

        from profiles.models import UserProfile
        profile = UserProfile.objects.filter(id=profile_id, role__in=('coach', 'client')).first()
        if not profile:
            return _dest(None, 'error')

        try:
            creds = gsvc.exchange_code(code)
        except Exception as exc:  # noqa: BLE001
            logger.error("Google code exchange failed: %s", exc)
            return _dest(profile, 'error')

        email = gsvc.primary_calendar_email(creds.token)
        expiry = creds.expiry
        if expiry and dj_tz.is_naive(expiry):
            expiry = dj_tz.make_aware(expiry, dt_timezone.utc)

        GoogleCalendarAccount.objects.update_or_create(
            profile=profile,
            defaults={
                'google_email': email,
                'calendar_id': 'primary',
                # Google only returns a refresh token on first consent; prompt=
                # consent forces one every time, but keep any existing one as a
                # fallback so a re-consent never blanks it.
                'refresh_token': creds.refresh_token or _keep_existing_refresh(profile),
                'access_token': creds.token or '',
                'token_expiry': expiry,
                'is_active': True,
                'last_error': '',
            },
        )
        return _dest(profile, 'connected')


class GoogleStatusView(APIView):
    """Coach-only: whether their Google Calendar is connected + prefs."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not _can_connect(request.user):
            return Response({'connected': False, 'configured': gsvc.is_configured()})
        acct = GoogleCalendarAccount.objects.filter(profile=request.user.profile).first()
        if not acct:
            return Response({'connected': False, 'configured': gsvc.is_configured()})
        return Response({
            'connected': True,
            'configured': True,
            'email': acct.google_email,
            'is_active': acct.is_active,
            'sync_bookings_out': acct.sync_bookings_out,
            'block_busy_times': acct.block_busy_times,
        })


class GoogleSettingsView(APIView):
    """Coach/client: toggle sync preferences on their connected calendar.
    Accepts `sync_bookings_out` and/or `block_busy_times` (booleans)."""
    permission_classes = [IsAuthenticated]

    def patch(self, request):
        if not _can_connect(request.user):
            return Response({'detail': 'This account type has no calendar.'},
                            status=status.HTTP_403_FORBIDDEN)
        acct = GoogleCalendarAccount.objects.filter(profile=request.user.profile).first()
        if not acct:
            return Response({'detail': 'No connected calendar.'}, status=status.HTTP_404_NOT_FOUND)
        changed = []
        for field in ('sync_bookings_out', 'block_busy_times'):
            if field in request.data:
                setattr(acct, field, bool(request.data[field]))
                changed.append(field)
        if changed:
            acct.save(update_fields=changed + ['updated_at'])
        return Response({
            'sync_bookings_out': acct.sync_bookings_out,
            'block_busy_times': acct.block_busy_times,
        })


class GoogleDisconnectView(APIView):
    """Coach-only: revoke + remove the connected calendar."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not _can_connect(request.user):
            return Response({'detail': 'This account type has no calendar.'},
                            status=status.HTTP_403_FORBIDDEN)
        acct = GoogleCalendarAccount.objects.filter(profile=request.user.profile).first()
        if acct:
            gsvc.revoke(acct)
            acct.delete()
        return Response({'connected': False})
