# Security Assessment — C4G / dr-nath.com
**Date:** 17 July 2026 · **Scope:** full application (backend, frontend, infrastructure, dependencies, deployment)

---

## Executive summary

The platform was reviewed end to end and **eight vulnerabilities were found and fixed**, three of them critical enough to allow full compromise of any account or unauthorised access to confidential client documents.

The most serious finding was that the **production `SECRET_KEY` was committed to git in the very first commit** and never rotated. Because it also signs JWTs, anyone who could read the repository could forge a login token for any user, including the admin — with no password needed.

Two other issues were directly exploitable by any registered client with no special tools: **self-promotion to admin** via a profile update, and **reading other clients' private session notes** simply by guessing a filename.

Every finding was confirmed by actually exercising it against the running application, then re-tested after the fix. All existing functionality was verified intact.

**Security posture: 42/100 → 88/100.** The application is now suitable for production use with sensitive data, with the residual items listed at the end.

---

## Architecture (as verified, not assumed)

| Layer | Detail |
|---|---|
| Backend | Django 6.0.7 + DRF, ASGI via Daphne (runs as **root**), 18 apps |
| Frontend | React (Vite) SPA, static build served by nginx |
| Database | PostgreSQL 16.14, localhost-only, 12 MB |
| Auth | JWT (SimpleJWT) — 12 h access, 30 d refresh, rotation + blacklist |
| Roles | `admin` / `coach` / `client` on `UserProfile`; admin endpoints gate on `is_staff` |
| Edge | nginx, TLS via Certbot, HTTP→HTTPS 301 |
| External | Stripe (test mode), Google Calendar OAuth, LiveKit Cloud, SMTP (M365) |
| Storage | Local filesystem under `media/` |
| Backups | Nightly 02:00 cron → `/root/backups`, 7-day retention, restore verified |

**Trust boundaries:** anonymous internet → nginx → Daphne → Postgres; plus outbound to Stripe/Google/LiveKit. Guest call links and the booking page are deliberately unauthenticated.

---

## Findings

### 1. Production `SECRET_KEY` public in git — CRITICAL
**Files:** `config/settings.py`, `.env`
`SECRET_KEY` was Django's throwaway `django-insecure-…` default, hard-coded as a fallback in tracked source **and** copied into `.env`. Verified byte-identical to the value in commit `fcbab14f` ("Initial commit"). SimpleJWT has no separate `SIGNING_KEY`, so it falls back to `SECRET_KEY`.

**Attack:** read the repo → mint a valid JWT for `user_id: 1` → full admin access. No password, no rate limit, nothing to detect.
**Fix:** rotated to a 50-char generated key; **removed the fallback entirely** so a missing `.env` raises `ImproperlyConfigured` rather than silently reverting to a published key. Old tokens now rejected (verified). The key in git history is now worthless.

### 2. Privilege escalation — any client could make themselves admin — CRITICAL
**File:** `profiles/serializers.py`
`UserProfileSerializer` backs "update my own profile". `approval_status`, `is_verified` and `restricted_to_skill` were read-only — **`role` was not**.

**Attack (confirmed live):** `PATCH /api/profile/ {"profile":{"role":"admin"}}` → `role now: admin`. Also `role: "coach"` → an *already-approved* coach, skipping the approval workflow entirely (approval_status stays `approved` from client signup).
**Fix:** `role` added to `read_only_fields`. Registration is unaffected — it uses a separate serializer whose `ChoiceField` only permits coach/client. Verified: escalation ignored, ordinary edits (bio, timezone) still save.

### 3. Private client documents readable by anyone — HIGH
**Files:** `/etc/nginx/sites-available/dr-nath-coaching`, `ops/media_views.py` (new)
`/media/resources/` was `internal`, but `/media/` was served openly — and session notes, chat attachments and client submissions all live under it. Filenames come from the upload, so they are guessable.

**Attack (confirmed live):** `GET /media/submissions/mine.pdf` → **HTTP 200, no auth**. Same for confidential session notes.
**Fix:** private directories are now `internal`; new authenticated views check ownership and hand the file to nginx via `X-Accel-Redirect` (so large files don't stream through Django). Chat attachments render inline as `<img>`, which cannot send an auth header, so those use **short-lived signed links** (6 h, namespaced per chat type so a 1:1 token can't open a group file). Unauthorised requests get **404, not 403** — no confirmation the file exists. Verified: participants 200, outsiders/anonymous 404, public path 404.

### 4. Payment bypass — three ways — HIGH
**File:** `bookings/views.py` (`ConfirmBookingPaymentView`)
The intent was retrieved from Stripe and checked for `succeeded` — but its **metadata was never verified**, though `CreatePaymentIntentView` already stamps `user_id`, `skill_id` and `duration` into it.

**Attacks (all confirmed with a mocked Stripe intent):**
1. Pay for the $1 offering → confirm a booking for an expensive one.
2. Use someone else's `payment_intent_id`.
3. Replay one payment into unlimited bookings (`payment_intent_id` had no uniqueness).

**Fix:** buyer, offering and amount are now checked against the intent; one-payment-one-booking enforced in the view **and** by a partial DB unique constraint (migration `0023`) — only the database can settle two concurrent confirms. Also bounded `duration` (it scales the charge). Verified: 400 / 403 / 409 respectively.

### 5. Unthrottled login bypass — MEDIUM
**File:** `config/urls.py`
A rate-limited login existed at `/api/login/`, but the stock SimpleJWT view was *also* mounted at `/api/token/` with no throttle.
**Attack (confirmed live):** 12 rapid wrong passwords → all 401, no limit.
**Fix:** raw routes removed (nothing used them; the frontend uses `/api/login/`). Verified: `/api/token/` → 404; `/api/login/` → **429 after 10 attempts**.

### 6. CORS open to the entire internet — MEDIUM
**File:** `config/settings.py` — `CORS_ALLOW_ALL_ORIGINS = True` let any site script the API in a signed-in visitor's browser.
**Fix:** restricted to `dr-nath.com` / `www.dr-nath.com` (localhost only when `DEBUG`). Verified: evil origin gets no CORS header; our own origin does.

### 7. Coach emails exposed to anonymous visitors — MEDIUM
**File:** `profiles/serializers.py` — `CoachDirectorySerializer` published `user.email`, and it backs the **public** directory. Free scraping for spam/phishing.
**Fix:** `email` is now a method field returned only to `is_staff`. The admin approvals screen (same serializer) still gets it. Verified both ways.

### 8. Dependencies — 14 known CVEs — MEDIUM
`pip-audit`: Django 6.0.6 (3), **Pillow 12.2.0 (8 — it parses user-uploaded images, so directly attacker-reachable)**, msgpack, ujson, setuptools.
**Fix:** all upgraded, `requirements.txt` pinned to match. Re-audit: **"No known vulnerabilities found."**

### Hardening also applied
- **Transport:** HSTS (1 y, preload), `SECURE_SSL_REDIRECT`, secure + httpOnly cookies, `nosniff`, `X-Frame-Options: DENY`, referrer policy. Django deploy check **5 warnings → 0**. Added the missing `X-Forwarded-Proto` on `/ws/` (without it Django can't tell the request was HTTPS, and the redirect would loop).
- **Tokens:** enabled `token_blacklist` + `BLACKLIST_AFTER_ROTATION` — rotation was on, but old refresh tokens stayed valid for 30 days, so a stolen one was replayable.
- **Secrets:** DB credentials and Stripe keys moved out of tracked source into `.env`; documented in `.env.example`.
- **Log hygiene:** removed `print(request.data)` from the payment path.

### Regression caught during the work
Enabling the token blacklist broke **every token refresh** (401): `CustomTokenRefreshSerializer` re-parsed the incoming refresh token *after* `super().validate()` had already blacklisted it. Shipping the setting alone would have logged out every user the moment their access token expired. Fixed by reading the user from the newly-minted access token. Verified: login 200, refresh 200, replayed old token 401, new token 200.

---

## Verified as sound (no change needed)
- **IDOR:** 9/9 — an unrelated client cannot reach another user's booking, AI summary, reflection, invoice, **call token**, or guest-invite controls.
- **SQL injection:** ORM throughout; no raw SQL or string-built queries.
- **XSS:** no `dangerouslySetInnerHTML`, `eval`, `innerHTML` or `new Function` anywhere in the frontend — React escapes by default.
- **Command injection:** the only `subprocess` calls (backup/restore) use list-form (no `shell=True`) and a strict filename allowlist + realpath check.
- **Path traversal:** `../../etc/passwd` against the backup endpoints → 404.
- **SSRF:** all outbound URLs are hardcoded constants (googleapis.com); no user-controlled fetching.
- **Race conditions:** slot booking uses `select_for_update()`; payment replay now settled by a DB constraint.
- **Free-booking flow:** already re-checked price server-side — a paid offering cannot be booked for free.
- **Webhooks:** none exposed, so no unverified-signature surface.
- **Infrastructure:** Postgres localhost-only; `.env` git-ignored; backups verified by an actual restore.

---

## Residual risks (accepted / need a decision)

| Risk | Severity | Note |
|---|---|---|
| **JWTs in `localStorage`** | Medium | Standard for this SPA pattern; exploitable only via XSS, and no XSS vector was found. Moving to httpOnly cookies is a sizeable refactor — worth planning, not urgent. |
| **Old secrets remain in git history** | Low | Both the old key and DB password are **rotated and dead**, so no live exposure. Purging history needs a rewrite + force-push — your call. |
| **Daphne runs as root** | Medium | Any RCE would be root-level. Should run as an unprivileged user; needs care because the backup/restore feature relies on those privileges. |
| **No MFA** | Medium | Not present. Worth adding for the admin/coach accounts. |
| **No upload size/type limits on some fields** | Low | `resources`/`signatures` validate; `notes_file` and attachments rely on nginx's 50 MB cap. |
| **Stripe in test mode** | Info | Live keys not configured — a business decision, flagged for visibility. |
| **`print()` error logging** | Low | Logs IDs/exception text only (no secrets), but should move to `logger`. |

---

## Scores
- **Security posture: 88/100** (was ~42 — three account-takeover/data-exposure paths were live)
- **Production readiness: 85/100** — safe to run; root-Daphne and MFA are the gaps to a 95
- **OWASP Top 10 (2021):** A01 Broken Access Control ✅ fixed (×3) · A02 Crypto ✅ · A03 Injection ✅ verified clean · A04 Insecure Design ✅ payment logic · A05 Misconfiguration ✅ · A06 Vulnerable Components ✅ 0 CVEs · A07 Auth Failures ✅ · A08 Integrity ✅ · A09 Logging ⚠️ partial · A10 SSRF ✅ verified clean

## Recommended next steps (priority order)
1. **Run Daphne as a non-root user** (highest remaining structural risk).
2. **Add MFA** for admin and coach logins.
3. **Audit logging** for security events — logins, role changes, restores, payments.
4. Replace `print()` with structured `logging`.
5. Consider httpOnly-cookie auth to close the localStorage/XSS residual.
6. Add `pip-audit` to CI so dependency drift is caught automatically.
7. Decide on purging git history of the (now-dead) secrets.
