# Extra Features — Build Progress

Internal tracker for the additional (out-of-scope) features. Each feature is built
in phases; when a feature is **done** we add non-technical testing instructions to
`CLIENT_VERIFICATION_GUIDE.md` and commit.

## Overview

| # | Feature | Size | Status |
|---|---|---|---|
| F2 | Weekly AI insights for the coach | S | ✅ Done |
| F5+F6 | Chemistry Session + intake-gated flow | M | ✅ Done |
| F3 | AI habit-coaching | M | ✅ Done |
| F4 | Canvas-style learning space | L | ✅ Done |
| F1 | Zoom-style meeting analytics | XL | ⬜ Not started (needs STT key) |

---

## F2 — Weekly AI insights for the coach

**Goal:** every week, email each coach (a) clients they haven't interacted with
recently, and (b) the most-discussed topics across their recent sessions.

**Design decisions (confirm if you disagree):**
- "Neglected" = a client whose last *held* session with this coach was more than
  **21 days** ago **and** who has **no upcoming** accepted session. (Threshold configurable via `WEEKLY_INSIGHTS_NEGLECT_DAYS`.)
- Topics are drawn from `SessionSummary` of the coach's sessions in the last **30 days**, aggregated by AI into a short ranked list.
- Runs **weekly, Monday 08:00 UTC**. One email per coach (deduped per ISO week).
- Sent to every user with role **coach** (currently Dr Nath → nathinno@gmail.com).
- Graceful empty states: if no neglected clients / no topics, the email says so rather than breaking.

### Phases
- [x] **Phase 1 — Insight computation (backend logic)** ✅
  - `bookings/insights.py`: `compute_weekly_insights(coach)` → { neglected_clients:[{name, last_session, days_since}], top_topics:[...] }. Excludes the coach's own self-bookings; most-urgent-first ordering.
  - `assistant/services.py`: `summarize_topics(texts)` — ranked topic list (JSON), reuses provider helpers, never raises.
  - *Live-tested:* 3 neglected clients + 8 AI topics returned correctly from real data.
- [x] **Phase 2 — Email template** ✅
  - `emails/weekly_insights.html` + `.txt` — branded; neglected list (with "N days ago" / "no session yet"), top topics, "View my sessions" button, graceful empty states. Header stays "Dr. Nath" (coach email, not newsletter). Render-tested.
- [x] **Phase 3 — Command + scheduling** ✅
  - `bookings/management/commands/send_weekly_insights.py` (per-coach, dedupe `weekly-insights-<coachId>-<isoweek>`, `--quiet/--dry-run/--force`).
  - systemd `weekly-coach-insights.timer` + `.service` — **enabled**, next run Mon 08:00 UTC.
- [x] **Phase 4 — Test, deploy, document, commit** ✅
  - Dry-run + full locmem/rollback end-to-end (queue → dispatch → render) passed; nothing persisted, no real email.
  - Testing instructions added to `CLIENT_VERIFICATION_GUIDE.md` (item 11).

**Testing instructions (client):** `CLIENT_VERIFICATION_GUIDE.md` item 1 (guide now covers additional features only; the earlier feedback-fixes guide was already sent to the client).
**Commit:** see below.

**Config:** `WEEKLY_INSIGHTS_NEGLECT_DAYS` (default 21), `WEEKLY_INSIGHTS_TOPICS_DAYS` (default 30). Timer: `weekly-coach-insights.timer` (Mon 08:00 UTC).

---

## F3 — AI habit-coaching

**Goal (feedback point 3):** use AI to help clients **build** and **sustain** healthy
habits across nutrition, activity, sleep, stress, mindfulness, relationships,
burnout and work-life balance. Builds on the existing manual Habit tracker.

**Scope (A + B, recommended):**
- **A. AI habit suggestions (coach):** coach picks a client + wellness domain → AI suggests 3-5 concrete daily habits (tailored with the client's recent session context) → coach assigns the ones they like.
- **B. AI adherence nudges (client):** a scheduled job emails clients a short, AI-written encouragement based on their check-in streaks/gaps + one small tip.
- AI output is supportive coaching, not medical advice (baked into prompts).

### Phases
- [x] **Phase 1 — Backend AI + model** ✅
  - `Habit.category` field (8 wellness domains) + migration `0027`.
  - `assistant/services.py`: `complete_text()` generic helper.
  - `bookings/habit_ai.py`: `suggest_habits()` + `habit_nudge_message()` (graceful, no medical claims).
  - Endpoint `POST /bookings/habits/suggest/` (coach-only); `category` now accepted on create/edit and returned in `_serialize_habit`.
  - *Live-tested:* 5 tailored sleep habits + a warm streak-aware nudge.
- [x] **Phase 2 — Coach UI** ✅
  - "Suggest with AI" button + modal (wellness-area picker → Generate/Regenerate → per-suggestion Add) in HabitTracker.
  - Wellness-area dropdown on habit create/edit; category badge on HabitCard.
  - *Tested:* coach 200 (5 tailored suggestions), client 403. Deployed.
- [x] **Phase 3 — Client nudges** ✅
  - `send_habit_nudges` command (per-client active habits → streak/consistency → AI encouragement, per-week dedupe).
  - `emails/habit_nudge.html/.txt`.
  - systemd `habit-nudges.timer/.service` — **enabled**, Thu 09:00 UTC.
  - End-to-end test (create habit+check-ins → queue → dispatch → render) passed; rolled back.
- [x] **Phase 4 — Test, guide, commit** ✅
  - Verification guide item 2 (AI habit coaching, both sides).

**Testing instructions (client):** `CLIENT_VERIFICATION_GUIDE.md` item 2.
**Commit:** see below.

**Schedule:** habit nudges Thu 09:00 UTC (`habit-nudges.timer`); AI suggestions on-demand via Habit Tracker.

---

## F4 — Canvas-style Programme Space

**Goal (feedback point 5):** a per-programme "space" like Canvas, bringing together
exactly what the client listed: **landing page per programme, supporting resources,
calendar, announcements, a shared space for documents/video uploads, and email
exchanges (chat)**. Only these — no extras (no announcement-email, etc.).

**Approach:** new isolated `programmes` app; reuse existing sessions/calendar, chat
and resource upload; add only what's missing (announcements + programme scoping).

### Phases
- [x] **Phase 1 — Backend** ✅
  - `programmes` app + `Announcement` model; `Resource.skill` FK (programme-scoped) + serializer/ownership validation; migrations applied.
  - APIs: `GET /programmes/<id>/space/` (aggregate), `POST /programmes/<id>/announcements/`, `DELETE /programmes/announcements/<id>/`; `programme_role()` enrolled-check.
  - *Tested:* coach/client space 200 (role-aware), announcement post→visible to both, non-enrolled 403.
- [x] **Phase 2 — Programme Space page** ✅
  - `ProgrammeSpace.jsx` at `/programme/:skillId` — Overview, Announcements (coach post/delete), Resources (coach add file/link + download/open), Sessions (+ per-session Chat, client "Book next"), Messages shortcut. 403 handled.
  - *Tested:* resource create with skill → 201, appears in space; deployed, route 200.
- [x] **Phase 3 — Entry points** ✅
  - Client: "Programme" button on each My Learning session. Coach: "Space" button on each My Skills programme.
- [x] **Phase 4 — Test, guide, commit** ✅
  - Verification guide item 3 (Programme space).

**Testing instructions (client):** `CLIENT_VERIFICATION_GUIDE.md` item 3.
**Commit:** see below.

**Reused (not rebuilt):** sessions/calendar, chat, resource upload. **New:** announcements + programme-scoped resources + the space page.

### UI polish (post-F4)
- My Skills cards: content full-width + compact bottom action toolbar (no wasted space).
- Programme Space: hero + stats strip, tabbed layout (Announcements/Resources/Sessions/Messages), collapsible coach composers, **Sessions month-calendar** (`components/MonthCalendar.jsx`) with list toggle, resource card grid, empty states.

---

## F5 + F6 — Free Chemistry Session + intake-gated booking

**Goal (feedback point 5):** a public **"Book a Chemistry Session with Dr Nath"** —
a free discovery call where the visitor completes an **intake form first**, and only
then the calendar unlocks to book.

**Decisions (from Danish):**
- **Auto-provision (recommended):** the visitor doesn't register manually — an
  account is created behind the scenes from their intake email + a welcome/
  set-password link (reuses the E2 onboard pattern). Low friction for "web surfers".
- **Intake NOT hardcoded:** the coach/admin builds/edits an intake form **per skill**
  in the form builder. The chemistry flow uses that skill's intake form.

**Approach:** single-step (intake answers submitted together with the chosen slot →
provision user → book → attach answers as a completed FormAssignment). No guest
schema surgery; core booking model untouched.

### Phases
- [x] **Phase 1 — Backend model + public read** ✅
  - `Skill.is_chemistry` + `FormTemplate.skill` FK + migrations.
  - `GET /api/bookings/chemistry/` (AllowAny) → chemistry skill + coach + per-skill intake questions; public slots confirmed AllowAny.
  - *Tested:* public read returns skill+questions; 48 slots for the test chemistry skill.
- [x] **Phase 2 — Backend public booking** ✅
  - `POST /api/bookings/chemistry/book/` (AllowAny) — validates required intake → finds/creates client from email (activation link for new) → books free session → stores answers as a completed FormAssignment on the booking → booking + activation emails.
  - *Tested (locmem+rollback):* 201, account created, slot booked, intake stored, 3 emails; missing required → 400.
- [x] **Phase 3 — Frontend public flow** ✅
  - `ChemistryBooking.jsx` at public `/chemistry`: 3-step (details+dynamic intake → gated calendar via MonthCalendar → confirmation). Home CTA now "Book a Free Chemistry Session". Deployed, route 200.
- [x] **Phase 4 — Coach/admin builder + view answers + test + guide + commit** ✅
  - Forms template gets a **skill link** (per-skill intake); `is_chemistry` toggle on Add/Edit Skill; coach reads intake answers in Forms → responses (completed FormAssignment on the booking). Verification guide item 4.

**Testing accounts:** testcoach / testclient (password Test@1234).
