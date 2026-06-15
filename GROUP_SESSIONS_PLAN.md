# Group Sessions — Implementation Plan

Adds coach-led **group sessions** (one event, many paying clients, capped capacity)
alongside the existing 1:1 slot-based booking system.

> **Status: ✅ All 5 phases implemented, verified, and deployed.**
> (Deferred items below — group chat, recurring series, waitlist — remain out of scope.)

## Locked decisions
- **Architecture:** separate `GroupSession` + `GroupEnrollment` models, parallel to the
  1:1 `TimeSlot`/`SessionBooking` flow (no changes to the working 1:1 path).
- **Booking model:** instant pay-per-seat (reserve seat → pay → confirmed; no coach approval).
- **Scheduling:** one-off sessions only (coach creates each manually).
- **When full:** hard stop (booking closes at capacity; no waitlist).
- **Group chat:** deferred to a later phase; v1 ships a shared `meeting_link` only.

## Reuse
Stripe payment-intent pattern, the hold→pay→confirm sequence, `release_expired_holds`
cleanup + management command, and the existing `Review` model (per coach↔student, unchanged).

---

## Phase 1 — Data foundation
**Goal:** models + migration + admin in place; nothing wired to the API yet.

Tasks:
- `bookings/models.py`:
  - `GroupSession`: `coach` (FK UserProfile, `limit_choices_to={'role':'coach'}`), `skill`
    (FK, null/blank), `title`, `description`, `start_datetime`, `end_datetime`,
    `capacity` (PositiveInt), `price_per_seat` (Decimal), `meeting_link` (URL, blank),
    `status` (`scheduled`/`full`/`completed`/`cancelled`, default `scheduled`),
    `created_at`/`updated_at`.
    - Properties: `seats_taken`, `seats_remaining`, `is_full` (count active enrollments).
    - `clean()`: `end_datetime > start_datetime`; skill (if set) belongs to coach.
  - `GroupEnrollment`: `group_session` (FK, related_name `enrollments`), `learner`
    (FK CustomUser), `status` (`held`/`booked`/`cancelled`), `held_until` (null/blank),
    `payment_intent_id`, `payment_status` (`unpaid`/`paid`/`refunded`), `amount_paid`,
    `created_at`/`updated_at`.
    - `unique_together (group_session, learner)`.
- `bookings/admin.py`: register both models (inline enrollments under session is nice-to-have).
- `makemigrations bookings` + `migrate`.

**Acceptance:** `manage.py check` clean; migration applies; models visible in `/admin/`.

---

## Phase 2 — Backend services + API
**Goal:** full server-side group-session lifecycle behind authenticated endpoints.

Tasks:
- `bookings/services.py`:
  - `reserve_seat(session, user)`: transaction + `select_for_update()` on the
    `GroupSession`; recount active (`held`+`booked`) enrollments; reject if `>= capacity`;
    else create/refresh a `held` enrollment with `held_until = now + HOLD_MINUTES`.
  - Extend `release_expired_holds()` to also cancel expired `held` enrollments and
    flip any `full` session back to `scheduled` when a seat frees up.
- `bookings/serializers.py`: `GroupSessionSerializer` (incl. `seats_remaining`,
  `is_full`, `coach_username`, `skill_title`), `GroupEnrollmentSerializer`.
- `bookings/views.py`:
  - `GroupSessionViewSet`: coach CRUD on own sessions; block edit/delete once booked
    enrollments exist; `roster` action; `cancel` action (refund all, set `cancelled`);
    `available` action (public/authenticated list of upcoming, non-full `scheduled` sessions).
  - Payment endpoints (mirror existing 1:1): `hold` (→ `reserve_seat`),
    `create-group-payment-intent` (price_per_seat), `confirm-group-payment`
    (verify intent → `held`→`booked`; last seat → session `full`; seat-recount under lock),
    `release` (owner-checked seat release).
- `bookings/urls.py`: register viewset + payment endpoints.

**Acceptance:** can create a session, hold/pay/confirm a seat, hit capacity (hard stop),
cancel (seat frees, refund path runs), expired holds reclaimed — verified via API/shell.

---

## Phase 3 — Coach UI
**Goal:** coaches create and manage group sessions.

Tasks:
- New **"Group Sessions"** tab on `frontend/src/pages/MyAvailability.jsx` (keeps all coach
  scheduling in one place):
  - Create form: title, description, start/end datetime, capacity, price per seat, skill (optional).
  - List of own sessions with seats taken / remaining and status.
  - Roster view (enrolled clients); add/edit `meeting_link`; cancel session (refunds all).

**Acceptance:** coach can create, see roster, set meeting link, and cancel a session end-to-end.

---

## Phase 4 — Client UI
**Goal:** clients discover and book seats.

Tasks:
- `/group-sessions` listing page (cards: title, coach, time, seats remaining, price);
  route in `App.jsx` + Navbar link.
- Enroll/checkout page reusing `PaymentForm` and the hold→pay→confirm sequence from
  `BookSessionPage.jsx`; full sessions show as closed.
- Surface booked group sessions in **My Learning** alongside 1:1 sessions.

**Acceptance:** client browses, reserves a seat, pays, sees confirmation, and finds the
session in My Learning; a full session cannot be booked.

---

## Phase 5 — Lifecycle polish + verification
**Goal:** edges closed and the whole flow verified live.

Tasks:
- Client-side cancel (refund + seat reopen; `full`→`scheduled`).
- `completed` handling after `end_datetime` (lazy derivation, or fold into the
  `release_expired_holds` command).
- Confirm the `release_expired_holds` management command covers group holds.
- End-to-end manual verification (coach create → 2 clients book → capacity → cancel → refund),
  build frontend, restart daphne, reload nginx.

**Acceptance:** all paths verified on the running app; no regressions to the 1:1 flow.

---

## Deferred (future, not in v1)
- Recurring group session series.
- Waitlist when full.

---

# Part 2 — Built-in Group Video Call

> **Status: ✅ G1–G4 implemented, verified, and deployed.** Mesh peer-to-peer
> video media itself is only fully testable from two real browsers (no
> camera/browser on the server) — the signaling, access, cap, window, and
> nginx WS routing are all verified server-side.

Replace the external `meeting_link` with the platform's own video call, mirroring
the 1:1 WebRTC call (`SessionCallPage` + Channels signaling on `/ws/chat/{id}/`).

## Locked decisions
- **Mesh WebRTC** reusing the built-in stack (WebRTC + Django Channels + Google STUN).
  No external media server / SFU.
- **Live call capped at ~5 active participants** for quality (booking capacity is
  unchanged; the cap applies only to the simultaneous video call).
- **Join rules:** only the coach and clients with a `booked` seat may join, within a
  window around the scheduled time (from ~15 min before `start_datetime` until
  `end_datetime`) — mirrors the 1:1 rule.
- In-call chat is **ephemeral/broadcast** (not persisted) in v1 — the `Message`
  model is 1:1-only and we won't change it now.

## Phase G1 — Backend group-call signaling
- New `GroupCallConsumer` (messages/consumers.py) + route
  `ws/group-call/(?P<session_id>\d+)/$` in `config/asgi.py`.
- On connect: JWT user (existing middleware) → verify coach-or-booked-client,
  session not cancelled, within join window; reject if the room already has the
  cap (~5). Assign a `peer_id`.
- Mesh signaling: tell the newcomer the list of existing peers; announce
  `peer-joined` to others; relay `offer`/`answer`/`ice` **targeted** to a specific
  peer; broadcast `peer-left` on disconnect.
- Ephemeral chat: broadcast `chat` to the room (no DB write).

## Phase G2 — Frontend GroupCallPage (mesh)
- New page `/group-session/:id/call`: getUserMedia, connect WS, maintain
  `Map<peerId → RTCPeerConnection>`, render a responsive video grid, controls
  (mic / cam / leave), countdown to `end_datetime`, ephemeral chat panel.
- Glare-free rule: the **newcomer initiates** the offer to each already-present peer.

## Phase G3 — Wire it in, drop external links
- Client My Learning group card: replace external link with **Join Call** (active in
  the window).
- Coach My Availability group tab: replace the meeting-link input with **Join Call**;
  stop surfacing `meeting_link`.
- Keep the `meeting_link` DB column for now (unused) to avoid a destructive migration.

## Phase G4 — Verify
- Server-side: WS handshake + access rules (coach/booked/cap/window) and targeted
  relay. Build frontend. (Full multi-peer mesh needs real browsers; note any part
  not exercisable headless.)
