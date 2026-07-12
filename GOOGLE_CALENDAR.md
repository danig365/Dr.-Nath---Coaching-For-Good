# Google Calendar — two-way sync (per coach)

Replaces nothing; extends the one-way "Add to calendar" (E5) with real OAuth sync.

## Google Cloud setup (done)
- Project **dr-nath-coaching**, Google Calendar API enabled.
- OAuth consent screen: **External**, **In production** (unverified — coaches click
  through the "unverified app" warning; ~100-user cap, fine at this scale).
- Scopes declared (Data Access): `calendar.events` + `calendar.readonly` (both sensitive).
- OAuth **Web** client. Redirect URI: `https://dr-nath.com/api/integrations/google/callback/`
- Client ID + Secret live in git-ignored `backend/.env` (`GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`).

## Design decisions (resolved)
- **Who can connect:** coaches AND clients (PENDING_FEATURES #10 doesn't restrict;
  clients get outbound-only — their sessions auto-appear on their own calendar).
- **No cross-attendee invites:** each connected party gets the event on their OWN
  calendar (coach event + client event separately), so Google doesn't send its own
  invite that would duplicate our booking emails.
- **Which coaches:** any coach (or client) who connects.
- ⚠️ Unverified app = 100-user cap over the project's lifetime. Coaches are few, but
  every client who connects consumes one. Fine now (~20-30); verify the app before scale.

---

## Phase 1 — OAuth connect + token storage ✅ DONE (2026-07-07)
- New `integrations` app. Model `GoogleCalendarAccount` (OneToOne→coach UserProfile):
  refresh/access token, google_email, `sync_bookings_out`, `block_busy_times`,
  `is_active`, `last_error`.
- Service `integrations/google_service.py` (google-auth + google-auth-oauthlib +
  plain requests; no google-api-python-client): build authorize URL, exchange code,
  refresh + persist access token, get primary-calendar email, revoke.
- Endpoints (`/api/integrations/google/…`): `connect/` (coach → authorize URL, coach
  identity in a signed `state`), `callback/` (validate state → exchange → store →
  redirect to `/my-availability?google=connected|error`), `status/`, `disconnect/`.
- Frontend: `GoogleCalendarCard` on **My Availability** (connect / connected+email /
  reconnect-needed / disconnect); hides itself if the server isn't configured.
- Verified 15/15 (rollback) + live routing (401 unauth, 302 callback). Real consent
  round-trip is a live click-test by the coach.

## Phase 2 — Outbound sync (platform → Google) ✅ DONE (2026-07-07)
- Connection generalised from coach-only to any user (`GoogleCalendarAccount.profile`;
  clients connect on **My Learning**, coaches on **My Availability** — same card,
  role-aware copy). Migration reset (0 rows) → single `0001` with both models.
- New `CalendarEventLink` (booking ↔ account ↔ google_event_id, unique per pair).
- `integrations/google_service.py`: `create_event` / `update_event` / `delete_event`
  (delete treats 404/410 as success).
- `integrations/sync.py`: `sync_booking_created` / `_updated` / `_cancelled` — mirror
  to every connected+active+`sync_bookings_out` calendar of the coach + client; UTC
  start/end + 1-hour popup reminder; all best-effort (never break a booking).
- Hooks in `bookings/views.py`: both confirm views → created; `cancel_booking` (shared)
  → cancelled; `change_program` → updated.
- Verified: sync engine 7/7 (mocked API, rollback) + client/coach connect live.
  Real event create/delete is a live click-test once a coach/client connects.

## Phase 3 — Inbound busy-blocking (Google → platform) ✅ DONE (2026-07-07)
- `google_service.freebusy()` queries the coach's calendar; `integrations/availability.py`
  `filter_open_slots(coach, slots)` drops slots overlapping an external busy interval.
  Busy times fetched over a 60-day window, cached 120s per account. Best-effort: any
  error / no-connection / `block_busy_times=False` → slots shown unchanged.
- Hooked into `TimeSlotViewSet.available` (the public slot listing) after the min-notice
  filter, so guests and clients both see availability minus the coach's external events.
- Prefs: `PATCH /api/integrations/google/settings/` toggles `sync_bookings_out` +
  `block_busy_times`; the `GoogleCalendarCard` shows checkboxes when connected (coach gets
  both, client gets outbound only).
- Verified 6/6 (mocked freebusy + settings, rollback).
- Note: blocking applies to the availability LISTING only. `hold`/confirm don't re-check
  freebusy (would add a Google call + latency to the booking path) — a Phase 4 option.

## Phase 4 (optional) — robustness
- Revoked-token detection + reconnect prompt (partly done via `is_active`),
  Google push (watch) instead of polling.
