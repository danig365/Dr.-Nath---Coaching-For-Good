# Client Amendments — Dr. Nath (01 July 2026)

Requests from `webplatform_drnath_amendments_0107.pdf`. Implement one at a time;
tick off / move to Done as completed.

---

## A. Profile content & fields — ✅ DONE (2026-07-01, verified via live API)

- [x] **A1. Certification** — "Fellow, …" → "Full member, Institute of Coaching (McLean Hospital, Harvard Medical School)".
- [x] **A2. Bio wording** — "recognized Fellow" → "Full member".
- [x] **A3. Industries** — replaced with Banking and Insurance, Education, Healthcare, ICT, Manufacturing.
- [x] **A4. Languages** — English + French.
- [x] **A5. Hourly rate** — removed ($150/hr); `hourly_rate` dropped from `is_profile_complete`; UI hides when null.
- [x] **A6. Bio addition** — was already the first line of her bio (no change needed).
- [x] **A7. LinkedIn** — `linkedin_url` field added (model + serializers + ProfilePage edit); name hyperlinked + LinkedIn pill on CoachProfile & directory. Value set to linkedin.com/in/drnathchinje/.

## B. Reminders & email — ✅ DONE (2026-07-01)

- [x] **B1. 24-hour meeting reminder** — 1:1 bookings already scheduled the ladder incl. `reminder_1d` (24h) to confirmed attendees (verified live). **Gap filled:** group sessions had no reminders → added `schedule_group_notifications` (confirmation + 24h/1h/30m/at-start ladder to booked attendees + coach), with per-attendee and session-wide cancellation. Hooked into ConfirmGroupPayment + coach cancel + client leave.
- [x] **B2. "Resend" — coach copy** — By design, invites/resends go to the *invitee*, not the coach (that's why she didn't see them). Added `bcc` to `send_email` and BCC the coach on every invite/resend, so she now gets a copy at nathinno@gmail.com (invitee doesn't see it; no self-dup when she invites herself).

## C. Resources, secure folders & e-signature

- [x] **C1. Inbox / Sent / Outbox** — ✅ DONE (2026-07-01). Coach Library(sent)+Client-Submissions(inbox) & client Shared/Send views already existed; added email notifications: coach shares to a *specific* client → client emailed a secure link; client submits → coach emailed. UI hints + toasts clarify the email behaviour. (Verified 5/5, rollback+locmem.)
- [x] **C2. Per-client secure private folder** — ✅ DONE (2026-07-01). `ResourceFolder.client` FK = private folder; resources inside auto-forced to visibility 'specific' + that client only (over-share blocked); enforced by `can_access`. Coach UI creates/labels private folders (🔒) + locks the share selector. Verified 9/9 incl. "other client cannot access".
- [x] **C3. Online document signing (e-signature)** — ✅ DONE (2026-07-01). New `signatures` app: coach sends an agreement → client signs (typed name + audit: time/IP) → coach counter-signs → signed PDF generated (original + certificate page via reportlab/pypdf). Role-aware `/agreements` page; emails at each step (please-sign / signed / completed+attached PDF / declined). Files private under `/media/resources/agreements/`. Verified end-to-end (15/15 + 5/5 + 7/7) and live.

---

## ✅ Done — all client amendments (A, B, C) complete (2026-07-01)

_(move completed items here)_
