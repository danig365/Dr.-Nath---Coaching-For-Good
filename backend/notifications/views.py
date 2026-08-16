from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import DeviceToken


class RegisterDeviceView(APIView):
    """Register (or refresh) this device's Expo push token for the signed-in user."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        token = (request.data.get('token') or '').strip()
        platform = (request.data.get('platform') or '').strip().lower()
        if not token:
            return Response({'detail': 'A push token is required.'},
                            status=status.HTTP_400_BAD_REQUEST)
        if platform not in dict(DeviceToken.PLATFORM_CHOICES):
            platform = ''

        # A token is unique to a device+app install, so re-registering it for a
        # different user must MOVE it — otherwise the previous account would keep
        # receiving notifications on a device they no longer use.
        DeviceToken.objects.update_or_create(
            token=token,
            defaults={'user': request.user, 'platform': platform, 'active': True},
        )
        return Response({'detail': 'Device registered.'}, status=status.HTTP_200_OK)


class UnregisterDeviceView(APIView):
    """Retire this device's token (called on sign-out)."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        token = (request.data.get('token') or '').strip()
        if not token:
            return Response({'detail': 'A push token is required.'},
                            status=status.HTTP_400_BAD_REQUEST)
        DeviceToken.objects.filter(token=token, user=request.user).update(active=False)
        return Response({'detail': 'Device unregistered.'}, status=status.HTTP_200_OK)
