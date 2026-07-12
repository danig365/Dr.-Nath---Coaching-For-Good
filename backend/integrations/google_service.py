"""
Google Calendar OAuth + API helpers.

Kept dependency-light: `google-auth` + `google-auth-oauthlib` for the OAuth
dance and credential refresh, plain `requests` for the Calendar REST API (no
heavyweight google-api-python-client).
"""
import logging
import os
from datetime import timezone as dt_timezone

# Google may return granted scopes reordered or with extras (e.g. via
# include_granted_scopes); relax oauthlib's strict scope-equality check so the
# token exchange doesn't raise "Scope has changed".
os.environ.setdefault("OAUTHLIB_RELAX_TOKEN_SCOPE", "1")

import requests
from django.conf import settings
from django.utils import timezone as dj_tz
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request as GoogleRequest
from google_auth_oauthlib.flow import Flow

logger = logging.getLogger(__name__)

CALENDAR_API = "https://www.googleapis.com/calendar/v3"
TOKEN_URI = "https://oauth2.googleapis.com/token"
AUTH_URI = "https://accounts.google.com/o/oauth2/auth"


def is_configured():
    return bool(settings.GOOGLE_CLIENT_ID and settings.GOOGLE_CLIENT_SECRET)


def _client_config():
    return {
        "web": {
            "client_id": settings.GOOGLE_CLIENT_ID,
            "client_secret": settings.GOOGLE_CLIENT_SECRET,
            "auth_uri": AUTH_URI,
            "token_uri": TOKEN_URI,
            "redirect_uris": [settings.GOOGLE_OAUTH_REDIRECT_URI],
        }
    }


def _flow():
    # No PKCE: build_authorize_url and exchange_code use separate Flow instances,
    # so a generated code_verifier wouldn't survive the round-trip ("Missing code
    # verifier"). We're a confidential client (client secret) with a signed-state
    # CSRF guard, so the standard web-server auth-code flow is appropriate.
    return Flow.from_client_config(
        _client_config(),
        scopes=settings.GOOGLE_CALENDAR_SCOPES,
        redirect_uri=settings.GOOGLE_OAUTH_REDIRECT_URI,
        autogenerate_code_verifier=False,
    )


def build_authorize_url(state):
    """The Google consent URL. `state` carries the (signed) coach identity.
    access_type=offline + prompt=consent guarantees a refresh token every time."""
    flow = _flow()
    url, _ = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
        state=state,
    )
    return url


def exchange_code(code):
    """Exchange an authorization code for credentials (access + refresh token)."""
    flow = _flow()
    flow.fetch_token(code=code)
    return flow.credentials


def primary_calendar_email(access_token):
    """The connected account's primary calendar id (its email), or ''."""
    try:
        resp = requests.get(
            f"{CALENDAR_API}/calendars/primary",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10,
        )
        if resp.ok:
            return resp.json().get("id", "")
    except requests.RequestException as exc:
        logger.warning("primary_calendar_email failed: %s", exc)
    return ""


def credentials_from_account(account):
    """Build a google Credentials object from a stored GoogleCalendarAccount."""
    return Credentials(
        token=account.access_token or None,
        refresh_token=account.refresh_token or None,
        token_uri=TOKEN_URI,
        client_id=settings.GOOGLE_CLIENT_ID,
        client_secret=settings.GOOGLE_CLIENT_SECRET,
        scopes=settings.GOOGLE_CALENDAR_SCOPES,
    )


def fresh_access_token(account):
    """Return a valid access token for the account, refreshing + persisting if
    needed. Returns None (and flags the account) if the refresh fails."""
    creds = credentials_from_account(account)
    try:
        creds.refresh(GoogleRequest())
    except Exception as exc:  # noqa: BLE001 — revoked/expired refresh token
        logger.warning("Google token refresh failed for profile %s: %s", account.profile_id, exc)
        account.is_active = False
        account.last_error = str(exc)[:500]
        account.save(update_fields=["is_active", "last_error", "updated_at"])
        return None

    account.access_token = creds.token
    expiry = creds.expiry
    if expiry and dj_tz.is_naive(expiry):
        expiry = dj_tz.make_aware(expiry, dt_timezone.utc)
    account.token_expiry = expiry
    if account.last_error or not account.is_active:
        account.is_active = True
        account.last_error = ""
    account.save(update_fields=["access_token", "token_expiry", "is_active", "last_error", "updated_at"])
    return creds.token


def create_event(access_token, calendar_id, body):
    """Create an event; returns its id or None."""
    try:
        resp = requests.post(
            f"{CALENDAR_API}/calendars/{calendar_id}/events",
            headers={"Authorization": f"Bearer {access_token}"}, json=body, timeout=15)
        if resp.ok:
            return resp.json().get("id")
        logger.warning("create_event %s: %s", resp.status_code, resp.text[:200])
    except requests.RequestException as exc:
        logger.warning("create_event failed: %s", exc)
    return None


def update_event(access_token, calendar_id, event_id, body):
    """Patch an existing event. Returns True on success."""
    try:
        resp = requests.patch(
            f"{CALENDAR_API}/calendars/{calendar_id}/events/{event_id}",
            headers={"Authorization": f"Bearer {access_token}"}, json=body, timeout=15)
        if resp.ok:
            return True
        logger.warning("update_event %s: %s", resp.status_code, resp.text[:200])
    except requests.RequestException as exc:
        logger.warning("update_event failed: %s", exc)
    return False


def delete_event(access_token, calendar_id, event_id):
    """Delete an event. Treats already-gone (404/410) as success."""
    try:
        resp = requests.delete(
            f"{CALENDAR_API}/calendars/{calendar_id}/events/{event_id}",
            headers={"Authorization": f"Bearer {access_token}"}, timeout=15)
        return resp.status_code in (200, 204, 404, 410)
    except requests.RequestException as exc:
        logger.warning("delete_event failed: %s", exc)
    return False


def _parse_rfc3339(value):
    if not value:
        return None
    from datetime import datetime
    try:
        return datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        return None


def freebusy(access_token, calendar_id, time_min_iso, time_max_iso):
    """Return the calendar's busy intervals as [(start_dt, end_dt), …] (UTC-aware)."""
    try:
        resp = requests.post(
            f"{CALENDAR_API}/freeBusy",
            headers={"Authorization": f"Bearer {access_token}"},
            json={"timeMin": time_min_iso, "timeMax": time_max_iso,
                  "items": [{"id": calendar_id}]},
            timeout=15)
        if resp.ok:
            busy = resp.json().get("calendars", {}).get(calendar_id, {}).get("busy", [])
            out = []
            for b in busy:
                start = _parse_rfc3339(b.get("start"))
                end = _parse_rfc3339(b.get("end"))
                if start and end:
                    out.append((start, end))
            return out
        logger.warning("freebusy %s: %s", resp.status_code, resp.text[:200])
    except requests.RequestException as exc:
        logger.warning("freebusy failed: %s", exc)
    return []


def revoke(account):
    """Best-effort revoke of the account's token at Google."""
    token = account.refresh_token or account.access_token
    if not token:
        return
    try:
        requests.post(
            "https://oauth2.googleapis.com/revoke",
            params={"token": token},
            headers={"content-type": "application/x-www-form-urlencoded"},
            timeout=10,
        )
    except requests.RequestException as exc:
        logger.info("Google token revoke best-effort failed: %s", exc)
