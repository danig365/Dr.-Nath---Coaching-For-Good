# C4G — Pending Features Tracker

Brief ke against jo functionality abhi baaki hai. Jaise jaise feature complete hota
jaye, yahan se uska entry remove kar dena (ya ✅ mark karke history me rakhna).

Last updated: 2026-07-07

---

## 🔴 Tier 1 — Quick wins (existing infra par bante hain, no new external cost)

_(Tier 1 clear ✅)_

## 🟠 Tier 2 — Important

- [ ] **5. Flexible billing** — Stripe subscriptions + payment plans (abhi sirf one-off).
- [ ] **6. Multi-week package booking** — abhi sirf single session bookable.
- [ ] **7. Content Gates** — resource ↔ payment tier access (code me "deferred until subscription model" likha hai; #5 ke baad).

## 🟡 Tier 3 — Bade integrations (external dependency)

- [ ] **11. Video recording** — LiveKit egress + storage.

## 🔵 Tier 4 — Bada milestone / compliance

- [ ] **13. Mobile App (M4)** — React Native (Expo) iOS + Android. Alag ~30 din milestone.
- [ ] **14. GDPR/HIPAA + E2E encryption** — formal compliance pass before launch.

---

## ⚠️ Partial (kuch bana hua hai, scope adhura)

- Booking: single ✅ / multi-week packages ❌ (#6)
- Shared Journal: booking par `notes_file` ✅ / dedicated journal+homework workspace ❌
- Encryption: HTTPS/transport ✅ / true E2E ❌ (#14)

---

## ✅ Completed (history)

- **Google Calendar two-way sync** (2026-07-07) — per-user OAuth (coach + client). New `integrations` app: `GoogleCalendarAccount` (refresh token + prefs), `CalendarEventLink`. **Outbound:** bookings auto-create/update/delete events on each connected participant's calendar (hooked into both confirm views, `cancel_booking`, `change_program`; best-effort). **Inbound:** coach's Google FreeBusy hides clashing slots in the availability listing (60-day window, 120s cache, per-coach `block_busy_times`). Connect/disconnect/settings UI (`GoogleCalendarCard`) on My Availability (coach) + My Learning (client). Client = outbound-only. Google Cloud: project + Calendar API + OAuth web client (creds in git-ignored `.env`), app **in production but pending verification** (users click through the unverified-app warning; 100-user cap). Verified: Phase 1 15/15, Phase 2 7/7, Phase 3 6/6 + live connect. Tracker: `GOOGLE_CALENDAR.md`. Phase 4 (optional): confirm-time freebusy recheck, Google push/watch.

- **Template Builder** (2026-07-03) — reusable intake forms & feedback surveys. New `formbuilder` app: `FormTemplate` (coach's reusable questions, JSON) + `FormAssignment` (a template sent to a client, with a **questions snapshot** so later template edits don't alter already-sent forms, plus answers). 8 question types (short/long text, single/multi choice, rating 1–5, yes/no, number, date) with server-side validation. Coach `/forms` page: build/edit/duplicate/archive templates (drag-free reorder), send to a client, read responses. Client `/forms` page: fill in assigned forms (type-aware inputs) + view own answers. Emails on assign (→client) and submit (→coach). Verified: templates 17/17, assign→submit flow 15/15 (rollback + locmem); live routes + deployed bundle confirmed.

- **Analytics complete** (2026-07-03) — extended `AdminAnalyticsView` (`/api/admin/analytics/`) with four new metrics on top of the existing monthly sessions/revenue: **retention rate** (engaged = ≥1 accepted/completed booking; returning = ≥2), **coachees-by-company** (grouped by client organisation, staff/superuser excluded so counts = real coachees), **best-performing coaches** (ranked by engagement→rating→revenue), and **habit-consistency** (active habits, avg 30-day adherence %, 14-day daily check-in trend). Metrics keyed off accepted+completed (not just completed) so they aren't blank pre-completion. AdminPanel Analytics tab renders each as recharts cards/charts with graceful empty-states. Verified against DB ground-truth + live through daphne with a real admin JWT (all keys, sums correct).

- **AI Virtual Assistant** (2026-07-03) — floating website chatbot (`AssistantWidget`, rendered globally in App.jsx) that answers visitor questions and nudges toward sign-up/booking. Provider-agnostic backend (`assistant` app): `AI_PROVIDER` in `.env` switches Anthropic ↔ OpenAI with no code change; graceful fallback if unconfigured; rate-throttled endpoint `POST /api/assistant/chat/` ({messages} → {reply}). Now live on **Claude Haiku 4.5** (`claude-haiku-4-5-20251001`) via `ANTHROPIC_API_KEY`. Verified end-to-end through the running server (real Claude reply). Key kept in git-ignored `.env`.

- **Automated PDF invoices/receipts** (2026-06-30) — reportlab branded receipt (`bookings/invoices.py`) for paid sessions + group enrollments. On-demand download endpoints (learner/coach/admin, paid & amount>0 only); "Receipt" buttons in MyLearning/MySessions (axios blob via `utils/downloadFile.js`); auto-attached to buyer's booking-confirmation email (`send_email` + `ScheduledNotification.send` now take attachments). Free ($0) sessions excluded. Verified live end-to-end + visual render.

- **Habit Tracker** (2026-06-30) — coach client ke liye daily habits assign karta hai (`Habit`/`HabitCheckIn` models in bookings app), client tap-to-log daily check-in karta hai. Streak (one-day grace) + 30-day consistency %. Backend role-aware API (coach CRUD + archive, client check-in toggle); frontend `/habits` page role-aware (client 7-day grid, coach manage + read-only consistency view) + nav link. Verified end-to-end via rollback transaction (no prod writes). Coach client-dropdown bug fixed (`b.learner` not `b.learner_id`).

- **Newsletter system** (2026-06-29) — full pipeline: public subscribe (Home modal + band), admin compose/edit/delete drafts + subscriber list (AdminPanel "Newsletter" tab), send to active subscribers via existing notification queue + dispatcher, branded `newsletter.html/.txt` email with one-click unsubscribe page, sent issues = archive. Real SMTP (Office365) delivery verified end-to-end. New `newsletters` app. _(Public archive page intentionally skipped — admin archive satisfies brief.)_

- **Chat file-sharing** (2026-06-29) — har chat me file/image attachments: 1:1 session chat, group chat, aur in-call chat panels (LiveKit + builtin, sab 4 call pages). Backend: `Message`/`GroupMessage` me attachment fields, multipart upload + channel-layer broadcast, 50MB + type guard. Frontend: staged-attach (select → Send par jata hai, optional caption), image preview + download chip; shared util `utils/chatAttachments.js`. _(Manual test pending.)_
