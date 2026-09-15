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

# 1. Isolated venv for the worker (needs the python3.12-venv apt package).
#    Two stages: the API's Django deps minus its livekit pins, then the agents.
#    A single `pip install` of both is unsatisfiable — see requirements-worker.txt.
python3 -m venv venv-worker
grep -vE '^livekit-(api|protocol)==' requirements.txt > /tmp/req-worker-base.txt
venv-worker/bin/pip install -r /tmp/req-worker-base.txt
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

## Why enabling this also FIXES the live call audio

This is not only an accuracy/coverage upgrade — it removes the cause of the
reported "breaking / radio-like crackling / echo" audio on 1:1 calls.

The browser MVP transcribes with the Web Speech API, which opens its **own,
second capture of the physical microphone**, in parallel with the one WebRTC
already holds for the call. Chrome cannot always share one input device between
two capture clients, so each open/close reconfigures the shared device — heard on
the call as dropouts, crackling, and returning echo (the echo canceller loses its
filter state when the capture is reconfigured). Chrome also ends `continuous`
recognition on every silence timeout, so the microphone is re-opened repeatedly
throughout a call. Server-side transcription reads the audio LiveKit **already**
has, so the microphone is captured exactly **once**.

The handoff is automatic. `BookingCallTokenView` returns
`server_transcription: TRANSCRIPTION_ENABLED` with the room token, and
`SessionCallLiveKit.jsx` disables its browser transcriber when that is true. So
flipping `TRANSCRIPTION_ENABLED=true` (with a valid key) is all it takes: the
browser stops competing for the microphone on the next call, with no frontend
change or redeploy. Flip it back off and the browser MVP resumes.

Until a key is configured the browser MVP stays in charge, hardened to minimise
the contention (single deterministic microphone acquisition ordered *after*
LiveKit's, paced restarts, and a circuit breaker that gives up transcription
rather than degrade the conversation) — see `frontend/src/utils/liveTranscribe.js`.

## Config reference (settings.py / .env)

| Setting | Default | Purpose |
| --- | --- | --- |
| `TRANSCRIPTION_ENABLED` | `false` | Master switch. The worker no-ops until true, and it is also sent to the browser as `server_transcription` so the call page disables its own transcriber. |
| `STT_PROVIDER` | `deepgram` | `deepgram` or `openai`. |
| `STT_LANGUAGE` | `en` | STT language hint (`en`, `fr`, …). |
| `DEEPGRAM_API_KEY` | — | Required when `STT_PROVIDER=deepgram`. |
| `DEEPGRAM_MODEL` | `nova-2` | Deepgram model. |
| `OPENAI_API_KEY` | — | Reused for `STT_PROVIDER=openai`. |

## Status

Deployed 2026-09-15 on livekit-agents 1.6.10 with Deepgram. Verified: the worker
starts under systemd, registers with LiveKit Cloud, and resolves speaker labels
through the Django handoff. A real two-party call producing a stored summary is
the one step still to confirm.

## Host notes

- **Port.** The agents health-check server defaults to 8081, which Metro (the
  Expo dev server) already holds here — the worker failed on startup with
  "address already in use". It now listens on `TRANSCRIPTION_WORKER_PORT`
  (default 8091).
- **Memory.** Production defaults to two warm job processes; this host has 3 GB
  shared with the live API, so it keeps one (`TRANSCRIPTION_IDLE_PROCESSES`).
  Idle footprint is roughly 490 MB. The unit sets `MemoryMax=1G`, so a runaway
  worker is stopped by systemd rather than the OOM killer taking daphne.
- **It is a room participant.** The worker joins each `booking-<id>` room as an
  AGENT participant. The call pages ignore agents (no tile, never counted as the
  other side joining) and `room_participant_count` excludes them, so it never
  takes a guest's seat.
