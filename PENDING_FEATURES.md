# C4G — Pending Features Tracker

Brief ke against jo functionality abhi baaki hai. Jaise jaise feature complete hota
jaye, yahan se uska entry remove kar dena (ya ✅ mark karke history me rakhna).

Last updated: 2026-06-29

---

## 🔴 Tier 1 — Quick wins (existing infra par bante hain, no new external cost)

_(Tier 1 clear ✅)_

## 🟠 Tier 2 — Important

- [ ] **5. Flexible billing** — Stripe subscriptions + payment plans (abhi sirf one-off).
- [ ] **6. Multi-week package booking** — abhi sirf single session bookable.
- [ ] **7. Content Gates** — resource ↔ payment tier access (code me "deferred until subscription model" likha hai; #5 ke baad).
- [ ] **8. Analytics complete karna** — retention rate, coachees-by-company, best-performing coach, habit-consistency charts.

## 🟡 Tier 3 — Bade integrations (external dependency)

- [ ] **9. AI Virtual Assistant** — visitor chatbot (OpenAI API).
- [ ] **10. Google Calendar two-way sync** — OAuth + Google Calendar API.
- [ ] **11. Video recording** — LiveKit egress + storage.
- [ ] **12. Template Builder** — reusable intake forms / feedback surveys.

## 🔵 Tier 4 — Bada milestone / compliance

- [ ] **13. Mobile App (M4)** — React Native (Expo) iOS + Android. Alag ~30 din milestone.
- [ ] **14. GDPR/HIPAA + E2E encryption** — formal compliance pass before launch.

---

## ⚠️ Partial (kuch bana hua hai, scope adhura)

- Booking: single ✅ / multi-week packages ❌ (#6)
- Shared Journal: booking par `notes_file` ✅ / dedicated journal+homework workspace ❌
- Analytics: revenue/hours/per-coach/monthly ✅ / baaki metrics ❌ (#8)
- Encryption: HTTPS/transport ✅ / true E2E ❌ (#14)

---

## ✅ Completed (history)

- **Automated PDF invoices/receipts** (2026-06-30) — reportlab branded receipt (`bookings/invoices.py`) for paid sessions + group enrollments. On-demand download endpoints (learner/coach/admin, paid & amount>0 only); "Receipt" buttons in MyLearning/MySessions (axios blob via `utils/downloadFile.js`); auto-attached to buyer's booking-confirmation email (`send_email` + `ScheduledNotification.send` now take attachments). Free ($0) sessions excluded. Verified live end-to-end + visual render.

- **Habit Tracker** (2026-06-30) — coach client ke liye daily habits assign karta hai (`Habit`/`HabitCheckIn` models in bookings app), client tap-to-log daily check-in karta hai. Streak (one-day grace) + 30-day consistency %. Backend role-aware API (coach CRUD + archive, client check-in toggle); frontend `/habits` page role-aware (client 7-day grid, coach manage + read-only consistency view) + nav link. Verified end-to-end via rollback transaction (no prod writes). Coach client-dropdown bug fixed (`b.learner` not `b.learner_id`).

- **Newsletter system** (2026-06-29) — full pipeline: public subscribe (Home modal + band), admin compose/edit/delete drafts + subscriber list (AdminPanel "Newsletter" tab), send to active subscribers via existing notification queue + dispatcher, branded `newsletter.html/.txt` email with one-click unsubscribe page, sent issues = archive. Real SMTP (Office365) delivery verified end-to-end. New `newsletters` app. _(Public archive page intentionally skipped — admin archive satisfies brief.)_

- **Chat file-sharing** (2026-06-29) — har chat me file/image attachments: 1:1 session chat, group chat, aur in-call chat panels (LiveKit + builtin, sab 4 call pages). Backend: `Message`/`GroupMessage` me attachment fields, multipart upload + channel-layer broadcast, 50MB + type guard. Frontend: staged-attach (select → Send par jata hai, optional caption), image preview + download chip; shared util `utils/chatAttachments.js`. _(Manual test pending.)_
