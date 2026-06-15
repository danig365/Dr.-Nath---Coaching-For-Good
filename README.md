# 🌟 Coaching for Good (C4G)

Coaching for Good (C4G) is a full-stack skill-sharing and booking platform where **mentors** and **learners** connect for personalized sessions. It's designed to make 1-on-1 skill development easy, flexible, and scalable.

---

## 🎯 Features

### ✅ Implemented
- 🔐 **JWT Authentication** with role-based access (Mentor / Learner)
- 🙋‍♂️ User Registration & Login
- 🧾 Profile system for both mentors and learners
- 📚 Skill listing page with filtering, search, and categories
- 📆 Book a session (learner)
- 🎫 Mentor session management: upcoming, past, cancel, reschedule, upload notes
- 📥 Booking request management for mentors
- 🎨 Beautiful UI with Tailwind CSS and smooth animations via Framer Motion

### ⏳ In Progress
- ⭐ Learner reviews and session feedback
- 💬 Chat messaging between mentor and learner
- 🧑‍💼 Admin dashboard for user management
- 💳 Payments with Stripe (optional)
- 📅 Calendar integration and notifications

---

## 🛠️ Tech Stack

| Layer     | Tech Stack                        |
|-----------|-----------------------------------|
| Frontend  | React, Tailwind CSS, Framer Motion |
| Backend   | Django, Django REST Framework     |
| Database  | PostgreSQL                        |
| Auth      | JWT-based authentication          |
| Deployment| Nginx + Daphne on VPS |

---

## 🚀 VPS Deployment Guide

**Server IP:** `129.121.115.149`
**Domain:** `dr-nath.com`
**App location on VPS:** `/root/dr-nath-coaching/`

### Deploying Code Changes

The recommended workflow: **make changes locally → push to GitHub → deploy on VPS.**

After pushing to GitHub, SSH into the VPS and run:

```bash
/root/deploy.sh
```

This automatically:
1. Pulls latest code from GitHub (`main` branch)
2. Runs any new database migrations
3. Collects Django static files
4. Rebuilds the React frontend
5. Restarts Daphne and reloads Nginx

---

### Making Changes Directly on the VPS

You can edit files directly on the VPS, but **changes won't be saved to GitHub**.
Running `deploy.sh` afterward will overwrite them.

After editing, restart the relevant service:

**Backend (Python/Django) — edit file then:**
```bash
systemctl restart daphne
```

**Frontend (React) — edit file then rebuild:**
```bash
cd /root/dr-nath-coaching/frontend && npm run build
```

**Nginx config — edit then reload:**
```bash
systemctl reload nginx
```

**Always push direct edits back to GitHub immediately:**
```bash
cd /root/dr-nath-coaching
git add .
git commit -m "your message"
git push origin main
```

> Only edit directly on VPS for urgent fixes. Push to GitHub right after to keep everything in sync.

---

### Managing Services

```bash
# Check status
systemctl status daphne
systemctl status nginx
systemctl status postgresql

# Restart
systemctl restart daphne
systemctl reload nginx
```

---

### Database Backups

Backups run **automatically every day at 2:00 AM** and saved to `/root/backups/`.
Last 7 days kept, older ones auto-deleted.

Each backup includes:
- `db_YYYY-MM-DD_HH-MM.sql.gz` — full PostgreSQL dump
- `media_YYYY-MM-DD_HH-MM.tar.gz` — uploaded files

```bash
# Run a manual backup
/root/backup.sh

# Restore from a backup
gunzip -c /root/backups/db_YYYY-MM-DD_HH-MM.sql.gz | PGPASSWORD="banned1234" psql -U skilluser -h localhost skillforge

# View backup logs
cat /root/backups/backup.log
```

---

### SSL / HTTPS

Handled by Let's Encrypt (Certbot), auto-renews every 90 days.

```bash
certbot renew   # manual renewal
```

---

### Django Admin

Access at: `https://dr-nath.com/admin`

```bash
# Create a superuser
cd /root/dr-nath-coaching/backend
./venv/bin/python manage.py createsuperuser
```

---
