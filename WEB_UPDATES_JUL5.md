# Web Updates — Dr. Nath (05 July 2026)

From `additional web updates_4_2026.pdf`. Work through one at a time; tick as done.

Legend: 🆕 new · 🟡 partial (some done) · ✅ likely already done (verify) · 🔴 big/new feature

---

- [x] **E1. All clients must log in** ✅ DONE (2026-07-05)
  - _Root cause:_ every platform page was already login-gated; the ONLY passwordless access was our "magic join" link (email Join buttons auto-logged clients in without a password).
  - _Fix:_ retired passwordless auto-login. All email Join links (confirmation, reminder, nudge) now point to `/session/<id>` which requires login. Old magic links now resolve to `/login?next=/session/<id>` (no tokens issued). Verified 6/6 (rollback + locmem) + live.

- [x] **E2. Restrict to the 6-month program + pre-register the 20 clients** ✅ DONE (2026-07-06)
  - _She says:_ ~20 clients are only for the 6-month Health & Wellness program (Skill #8, coach drnath). Once logged in they should be able to book **only** that program. Suggested: pre-register those clients, send an activation link → they set/reset password.
  - _Decisions:_ hard lock (only the programme); onboarding via a self-service **Admin Panel UI**; activation reuses the existing password-reset link flow; activation email is a branded **welcome + set-password**.
  - _Phase 1 (backend lock + enforcement) ✅ DONE (2026-07-06):_ `UserProfile.restricted_to_skill` (FK→Skill, null = unrestricted; migration 0007). Enforced defence-in-depth via `bookings.services.locked_skill_id` / `program_lock_error`: both confirm views (paid + free) **403** a locked client booking another offering; `slots/available` returns only the locked skill's slots; `hold` rejects another coach's slot; `/api/skills/public/` now recognises a signed-in client (optional JWT auth) and shows only their offering (guests still see all). Lock id also added to JWT claims + profile serializer. Verified 8/8 (rollback). No existing client is locked yet — field is null for all.
  - _Phase 2 (backend pre-register + activation) ✅ DONE (2026-07-06):_ admin-only `POST /api/admin/pre-register-clients/` (`IsAdminUser`) taking `{skill_id, clients:[{email, first_name, last_name}]}`. Per row: validates + de-dupes email, creates a client account (username = email, `is_active=True`, **unusable password** so the only way in is the link), locks it to the programme, and sends a branded **welcome + set-password** email (`client_activation.html/.txt`) reusing the password-reset token → link `/reset-password/<uid>/<token>`. Idempotent — existing emails are skipped, never overwritten. Returns a per-row result + summary (created / exists / invalid / error). Verified 16/17 (locmem + rollback; the 1 "fail" was a test-harness dict collision, behaviour correct) — no real accounts/emails.
  - _Phase 3 (frontend) ✅ DONE (2026-07-06):_ New **"Onboard Clients"** tab in the Admin Panel — pick a programme, paste clients (one per line, `email, First, Last`; live "N clients ready" count), **"Pre-register & send activation"** → per-row result list (created / already existed / invalid / error) + summary chips. Client-side lock needs no extra code: `/skills/public/` already returns only the locked client's programme, so the directory shows just that, and opening another offering's `/book/:id` bounces to `/skills` (offering not in their filtered list). Build clean.
  - _Follow-up (optional):_ set/unlock an individual client's programme from Client Management, and filter the coach directory for locked clients (browsing other coaches is harmless — booking is fully blocked).

- [x] **E3. Too many tabs → consolidate to ≤4** ✅ DONE (2026-07-05)
  - _Fix:_ Navbar consolidated into dropdown categories. Coach: **Sessions · Clients · Offerings · Workspace** (4) + Profile avatar menu. Client: **Sessions · Coaches · Workspace** (3) + Profile avatar. Desktop = hover dropdowns; mobile = grouped sections. All routes still reachable; badge (upcoming) surfaced on the Sessions group. Admin/guest kept as flat bars.

- [x] **E4. No booking within 24 hours of a session** ✅ DONE (2026-07-05)
  - _Fix:_ Enforced the coach's `min_notice_hours` rule (set to **24h** for all coaches; model default now 24). Three layers: (1) the available-slots listing hides any slot starting within 24h; (2) `hold` rejects it; (3) both confirm views (free + paid) reject it — clear error "must be booked at least 24 hours in advance." Verified 6/6 (rollback). No frontend change needed (listing + error surfacing already wired). Coach can still edit the value in the DB if she wants a different window later.

- [x] **E5. Booking confirmation + "add to calendar"** ✅ DONE (2026-07-05)
  - _Phase 1 (email):_ `bookings/calendar.py` builds a standard `.ics` (VEVENT + 1-hour alarm) attached to the booking-confirmation for both parties, plus "Add to Google Calendar" / "Add to Outlook" buttons in the email. Verified 8/8.
  - _Phase 2 (in-app):_ an "Add to Calendar" menu (Google · Outlook · Apple/.ics) on the upcoming session cards in My Sessions (coach) and My Learning (client), via `utils/calendarLinks.js` + `components/AddToCalendar.jsx` — mirrors the backend so email and app stay consistent.

- [x] **E6. Join button must stay active until the session ends** ✅ DONE (2026-07-06)
  - _She says:_ "Join" disappears when the session starts, even before participants connect. It must stay active till the end (e.g. one hour).
  - _Fix:_ A session stays in **Upcoming** with a working **Join** until scheduled end + 10-min grace (both coach & client). Her earlier report was a cached/old version. Verified live on the fresh app.

- [x] **E7. In-session AI (summarize discussion, etc.)** 🔴 _(Phases 1–2 done + live; Phase 3 built, verify later)_
  - _She says:_ Build AI capabilities during the online session to summarize discussion, like Zoom/Teams.
  - _Approach:_ Option A (browser MVP) — Web Speech API transcribes in-call → AI summary. Cheap, no server transcription infra. Phase-by-phase.
  - _Phase 1 (backend) ✅ DONE (2026-07-06):_ `assistant.services.summarize_session(transcript)` → Anthropic (reuses website key) → structured `{summary, key_points, action_items}`; `SessionSummary` model (one per booking, both parties read); `GET/POST /api/bookings/<id>/ai-summary/` (participant-only, POST throttled 'assistant' scope, generates + stores); `has_summary` on the booking serializer. Verified 15/15 (unit + real AI call + endpoint rollback). Real-call output was clean & accurate.
  - _Phase 2 (frontend) ✅ DONE (2026-07-06):_ In-call browser transcription (`utils/liveTranscribe.js`, Web Speech API, Chrome/Edge) transcribes the local speaker; both sides exchange finalised segments over the **LiveKit data channel** → one merged transcript. Consent banner + "AI notes" indicator + a controls-bar toggle in the call page (muting the mic pauses it). On session completion → best-effort POST to `/ai-summary/` (backend idempotency guard prevents double AI spend when both parties post). New `SessionSummaryModal` opened via an "AI Summary" button on completed cards in My Sessions (coach) + My Learning (client). E9 reflection now offers an "Add AI suggestions" button to pre-fill the client's action items from the summary. Safari/Firefox degrade gracefully (no local capture, still receive the other side's segments + view the summary). Backend verified 15/15 + idempotency 3/3; frontend builds clean.
  - _Phase 3 (server-side transcription) ✅ BUILT (2026-07-06, verify later):_ `backend/transcription_worker.py` — a LiveKit Agents worker that joins each `booking-<id>` room, transcribes **all** participants server-side (covers Safari/Firefox, better accuracy), and stores the summary directly — no browser dependency. Provider-agnostic STT (`STT_PROVIDER=deepgram|openai`). Shared summary code path extracted to `bookings/ai_summary.py` (`generate_and_store_summary` + `speaker_label_for_identity`) and the Phase-2 endpoint refactored onto it. Runs **isolated** (own `venv-worker` + `requirements-worker.txt` + `transcription-worker.service`) so it can't affect the live API — see `transcription_worker.README.md`. Needs an STT key + isolated install to activate; **off by default** (`TRANSCRIPTION_ENABLED=false`), so Phase 2 is unaffected. Django integration verified 8/8 + endpoint 3/3; the worker itself needs a live test call after setup.

- [x] **E8. Dr. Nath logo → home page** ✅ DONE (2026-07-05)
  - _Fix:_ Added a `/home` route that always renders the marketing home, and pointed the logo there for signed-in users. Now clicking the logo lands on the home page (instead of the dashboard) without logging out. The `/` default-redirect (post-login → dashboard) is untouched, so no other flow changed.

- [x] **E9. Post-session solutions (notes / action items)** ✅ DONE (2026-07-05)
  - _Phase 1 (backend):_ `SessionReflection` model (takeaways + action_items `[{text,done}]`) + API `GET/PUT /api/bookings/<id>/reflection/` (client writes, coach reads, others 403) + `has_reflection` on the booking serializer + a "Capture your takeaways" CTA in the post-session thank-you email. Verified 10/10.
  - _Phase 2 (frontend):_ shared `SessionReflectionModal` — on My Learning completed cards the client gets an "Add Notes / My Notes ✓" button (editable takeaways + checkable action items); on My Sessions completed cards the coach gets a "Client Notes" read-only view (only when a reflection exists).

- [ ] **E10. Dashboard analytics — define & track metrics** 🟡
  - _She says:_ Metrics to be defined and tracked.
  - _Status:_ We built an analytics dashboard (retention, coachees-by-company, top coaches, habit consistency, sessions/revenue). **Ask her which specific metrics she wants** so we add the right ones.

---

## Suggested order (quick wins → big features)
1. **E6** verify (already done) · **E8** logo→home (small)
2. **E4** 24-hour rule · **E5** calendar add-to-calendar
3. **E3** consolidate tabs · **E1** login enforcement
4. **E2** pre-register 20 clients + program lock
5. **E10** define metrics (needs her input)
6. **E7 / E9** in-session AI + post-session (big, phase-by-phase)
