# Notifications system

A small, reusable email/notification layer used by bookings (confirmations +
session reminders) and available to any future feature.

## Pieces

- **`services.send_email(to, subject, template, context)`** — renders an
  `emails/<template>.html` + `.txt` pair into a branded multipart email and
  sends it. Fail-safe by default (logs and returns `False` instead of raising).
- **`models.ScheduledNotification`** — the queue. One row = "send this message
  to this recipient at this time." Channel-agnostic, idempotent via `dedupe_key`,
  and optionally linked to the object it's about (GenericForeignKey).
- **`management/commands/dispatch_notifications`** — sends everything that's due
  (pending + failed within the retry budget). Run on a schedule.
- **bookings/`notifications.py`** — turns a `SessionBooking` into rows:
  confirmation (immediate) + reminders (1 day / 1 hour / 30 min / at start), and
  `cancel_booking_notifications()` to void pending rows when a booking is cancelled.

## Configuration (backend/.env)

```
EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend   # console backend = just logs
EMAIL_HOST=...
EMAIL_PORT=587
EMAIL_HOST_USER=...
EMAIL_HOST_PASSWORD=...
EMAIL_USE_TLS=True
DEFAULT_FROM_EMAIL=Dr. Nath Coaching <no-reply@dr-nath.com>
SITE_URL=https://dr-nath.com
```

While `EMAIL_BACKEND` is the **console** backend, emails are printed to the
journal instead of being sent. Switch it to the **smtp** backend to send for real.

## Scheduling (systemd timer)

The dispatcher runs every minute via a systemd timer.

```
# status / next run
systemctl list-timers dispatch-notifications.timer
systemctl status dispatch-notifications.service

# logs (each run)
journalctl -u dispatch-notifications.service -f

# run once by hand
cd /root/dr-nath-coaching/backend
venv/bin/python3 manage.py dispatch_notifications            # verbose
venv/bin/python3 manage.py dispatch_notifications --dry-run  # show, don't send
```

Unit files: `/etc/systemd/system/dispatch-notifications.{service,timer}`.
After editing them: `systemctl daemon-reload && systemctl restart dispatch-notifications.timer`.

## Adding a new notification type

1. Create `emails/<name>.html` + `<name>.txt` (extend `emails/base.*`).
2. Call `send_email(...)` directly for one-offs, or
   `ScheduledNotification.queue(...)` to schedule (give it a unique `dedupe_key`).
3. The timer delivers scheduled rows automatically.
