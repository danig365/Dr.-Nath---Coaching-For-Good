# Server-side transcription worker (E7 · Phase 3)

Optional. Upgrades in-session AI note-taking from the **browser MVP (Phase 2)** to
**server-side transcription**: a LiveKit Agents worker joins each 1:1 room,
transcribes **every** participant's audio server-side, and stores the AI summary
directly — no dependency on a participant's browser, and it covers Safari/Firefox
(which have no Web Speech API).

Phase 2 keeps working with or without this. When the worker IS running it stores
the summary server-side; a browser also posting is harmless (the summary write is
idempotent + cost-safe, so the AI runs once).

## What it needs

1. An **STT provider key** — Deepgram (recommended for live streaming) or OpenAI
   Whisper. This is a real external service with per-minute cost (~$0.004–0.02/min).
2. Its **own virtualenv** — `livekit-agents` clashes with the API server's pinned
   `livekit-api`, so it must NOT share the API venv. It is never imported by
   Django, so it cannot affect the running API/daphne.

## Setup

```bash
cd /root/dr-nath-coaching/backend

# 1. Isolated venv for the worker
python3 -m venv venv-worker
venv-worker/bin/pip install -r requirements-worker.txt

# 2. Configure in .env (same file the API reads)
#    TRANSCRIPTION_ENABLED=true
#    STT_PROVIDER=deepgram
#    DEEPGRAM_API_KEY=dg_xxx
#    STT_LANGUAGE=en           # or fr
#  (for OpenAI Whisper instead: STT_PROVIDER=openai + OPENAI_API_KEY=sk-xxx)

# 3. Run it
venv-worker/bin/python transcription_worker.py start
```

Or install the systemd unit for a managed, auto-restarting service:

```bash
sudo cp transcription-worker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now transcription-worker
journalctl -u transcription-worker -f
```

## How it works

- Auto-dispatched to every LiveKit room; acts only on rooms named `booking-<id>`,
  no-ops otherwise.
- Loads the booking, maps each participant identity (`str(user.id)`) to
  **Coach**/**Client** via `bookings.ai_summary.speaker_label_for_identity`.
- Streams each audio track through the configured STT, collecting finalised
  segments `{speaker, text, ts}`.
- On room shutdown, merges the segments time-ordered and calls
  `bookings.ai_summary.generate_and_store_summary` — the same shared code path the
  browser endpoint uses.

## Config reference (settings.py / .env)

| Setting | Default | Purpose |
| --- | --- | --- |
| `TRANSCRIPTION_ENABLED` | `false` | Master switch; the worker no-ops until true. |
| `STT_PROVIDER` | `deepgram` | `deepgram` or `openai`. |
| `STT_LANGUAGE` | `en` | STT language hint (`en`, `fr`, …). |
| `DEEPGRAM_API_KEY` | — | Required when `STT_PROVIDER=deepgram`. |
| `DEEPGRAM_MODEL` | `nova-2` | Deepgram model. |
| `OPENAI_API_KEY` | — | Reused for `STT_PROVIDER=openai`. |

## Not yet verified

The worker code is written against livekit-agents 1.6 but has **not been run
end-to-end here** (needs the isolated install, an STT key, and a live 2-party
room). Verify with a real test call after setup. The Django integration it relies
on (`generate_and_store_summary`, `speaker_label_for_identity`) IS tested.
