from django.urls import path

from .views import RegisterDeviceView, UnregisterDeviceView

urlpatterns = [
    # The mobile app registers its Expo push token here after signing in, and
    # unregisters on sign-out so a shared device stops receiving the previous
    # user's notifications.
    path('devices/', RegisterDeviceView.as_view(), name='register-device'),
    path('devices/unregister/', UnregisterDeviceView.as_view(), name='unregister-device'),
]
