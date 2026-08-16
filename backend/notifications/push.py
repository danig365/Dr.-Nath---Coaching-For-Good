"""
Push notifications to the mobile app.

Delivery goes through Expo's push service rather than talking to APNs/FCM
directly. That means no Apple/Google credentials live on this server: the app
registers an Expo push token, and Expo fans out to the right platform.

This sits alongside `services.send_email` — same shape, same fail-silently
default — so callers can notify by email, push, or both without caring how.
"""
import logging

import requests

from .models import DeviceToken

logger = logging.getLogger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
# Expo accepts up to 100 messages per request.
CHUNK_SIZE = 100
TIMEOUT_SECONDS = 10


def _chunks(items, size):
    for i in range(0, len(items), size):
        yield items[i:i + size]


def send_push(user, title, body, data=None, fail_silently=True):
    """
    Push a notification to every active device a user has registered.

    Args:
        user: the recipient (a CustomUser).
        title: notification title.
        body: notification body text.
        data: optional dict delivered with the notification — used by the app to
            deep-link (e.g. {"url": "/session/42"}).
        fail_silently: when True (default), log and return False instead of
            raising, so callers in request paths stay safe.

    Returns:
        True if at least one message was accepted, else False.
    """
    if not user:
        return False

    tokens = list(
        DeviceToken.objects.filter(user=user, active=True).values_list("token", flat=True)
    )
    if not tokens:
        return False

    messages = [
        {
            "to": token,
            "title": title,
            "body": body,
            "sound": "default",
            "data": data or {},
        }
        for token in tokens
    ]

    ok = False
    for chunk in _chunks(messages, CHUNK_SIZE):
        try:
            res = requests.post(
                EXPO_PUSH_URL,
                json=chunk,
                headers={"Accept": "application/json", "Content-Type": "application/json"},
                timeout=TIMEOUT_SECONDS,
            )
            res.raise_for_status()
            payload = res.json()
            ok = True

            # Expo reports per-message errors in the response rather than by
            # status code. A DeviceNotRegistered ticket means the app was
            # uninstalled or the token rotated — retire it so we stop trying.
            for message, ticket in zip(chunk, payload.get("data", []) or []):
                if ticket.get("status") != "error":
                    continue
                detail = (ticket.get("details") or {}).get("error")
                if detail == "DeviceNotRegistered":
                    DeviceToken.objects.filter(token=message["to"]).update(active=False)
                    logger.info("Retired unregistered push token for user %s", user.pk)
                else:
                    logger.warning("Expo push error for user %s: %s", user.pk, ticket)
        except Exception as exc:  # noqa: BLE001 — never break a request path
            if not fail_silently:
                raise
            logger.warning("Push send failed for user %s: %s", user.pk, exc)

    return ok
