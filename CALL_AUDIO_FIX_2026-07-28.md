# Live call audio: breaking / crackling / echo — diagnosis and fix

**Date:** 2026-07-28 · **Scope:** 1:1 coaching calls (LiveKit), with parity fixes
to the group and guest call pages.

## Symptom

Audio "breaks" and cuts in and out, with a radio-like crackle and audible echo.
Worst on the **client's** side. The coach always has in-call AI note-taking
enabled and always experiences it. WhatsApp calls on the same network are fine.
Crucially, it happens on **some** sessions and not others, with the same coach and
the same equipment.

## Root cause

Two independent capture sessions of the **same physical microphone** run at once:

1. LiveKit's WebRTC capture (`setMicrophoneEnabled`), and
2. the Web Speech API transcriber that powers AI note-taking
   (`window.webkitSpeechRecognition`), which opens its own microphone capture and
   cannot be fed an existing `MediaStreamTrack`.

Chrome cannot always share one input device between two capture clients with
different requirements. When it has to reconfigure the shared device, the WebRTC
capture is disrupted — heard as dropouts and crackle — and the echo canceller
(which lives on the capture stream) loses its filter state, so echo returns. This
also explains *why the client suffers most*: the audio the client hears is what the
**coach's** browser sent, and the coach is the one running AI notes. The client
hears the coach's degraded, no-longer-echo-cancelled stream.

### Why it was intermittent — three timing-dependent mechanisms

This is the part a constant misconfiguration cannot explain, and all three were
real bugs in the code, not speculation.

**1. A genuine double-capture leak on mute/unmute** (the strongest one).
In the previous `liveTranscribe.js`, `stop()` set `active = false` and dropped its
reference to the recognizer, but the recognizer's `onend` fired *later* and
restarted on the condition `if (active)`. So: mute (`stop()`), unmute
(`start()` → `active = true`, builds recognizer **B**), then recognizer **A**'s
queued `onend` arrives, sees `active === true`, and restarts **A**. Two live
recognition sessions now hold the microphone on top of LiveKit's — and it
compounds with each mute/unmute cycle. Whether it triggers depends entirely on
whether `onend` lands inside that window, which is why some calls were fine.

**2. Inverted, non-deterministic start order.**
The transcriber effect ran on `callState === "connecting"`, which happens *before*
the access token is fetched and long before `room.connect()` and
`enableMedia()`. The Web Speech API therefore reliably opened the microphone
**first** and dictated the device's format and effects; LiveKit's capture then had
to join — or forcibly reconfigure — a device another client had already opened.

**3. A restart storm that sometimes killed itself.**
Chrome ends `continuous` recognition on every silence timeout. The old `onend`
called `r.start()` **synchronously on the same object**, which Chrome throws on —
and the error was swallowed. So a call went one of two ways: the restart loop
died early (transcription silently stopped, and *the audio was fine*), or it kept
succeeding and re-opened the microphone dozens of times across the session
(*audio degraded*). Same code, same setup, opposite outcomes.

Network variability was also considered and is not the primary cause — but the
code observed connection quality nowhere, so there was no evidence either way.
That is now instrumented and acted upon.

## What changed

### `frontend/src/utils/liveTranscribe.js` — rewritten defensively
- **Generation guard**: abandoning a recognizer bumps a counter and detaches its
  restart handlers, so a stale recognizer can never resurrect itself. This makes
  mechanism 1 structurally impossible rather than unlikely.
- **Never restarts synchronously in `onend`**; always builds a fresh recognizer on
  a timer with a floor delay (450 ms) so the device is fully released first, and
  exponential backoff (to 8 s) on errors.
- **Terminal error handling**: `audio-capture` (device unavailable / held
  elsewhere), `not-allowed` and `service-not-allowed` stop transcription instead
  of hammering the device.
- **Circuit breaker**: more than 14 restarts in 60 s means the device is contended;
  transcription gives up for the rest of the call. Notes may degrade; the
  conversation must not.
- A final buffered utterance is still delivered after `stop()`.

### `frontend/src/pages/SessionCallLiveKit.jsx`
- **Deterministic ordering.** The microphone is now acquired **first and alone** in
  `enableMedia()` (before the camera and any background processor), and the
  transcriber is gated on a new `micLive` flag set from
  `LocalTrackPublished(Source.Microphone)`. LiveKit's capture is always the first
  client to open the device and the one that installs echo cancellation / noise
  suppression / AGC; the transcriber only ever attaches to an already-running
  device, after a 1.2 s settle. The gate re-arms on unpublish, mute, and
  reconnect, so the ordering holds on *every* acquisition, not just the first.
- **Adaptive backoff.** `ConnectionQualityChanged` → on `poor`/`lost` for the local
  participant, browser transcription pauses (and resumes on recovery). It is the
  first thing sacrificed under stress.
- **Re-entrancy guard** (`joiningRef`) so two overlapping joins can never build two
  Rooms and open the microphone twice.
- **Audio bitrate 24 → 32 kbps** mono (`AudioPresets.speech` is 24 kbps, which
  pushes Opus into narrower bands and thins voices out). RED and DTX-off kept.
  This is a clarity improvement, *not* the crackle fix.
- Lobby-preview device release settle raised 200 → 350 ms, since the browser
  releases capture devices asynchronously.
- UI: a "Notes paused" state in the top bar and banner, so a backoff is visible
  rather than silent.

### `frontend/src/utils/callDiagnostics.js` — new
Timestamped ring buffer (400 events) plus console output, covering device
acquisitions and their *applied* constraints, track publish/unpublish,
subscribe, mute, reconnects, connection quality, transcriber lifecycle, and a
10 s RTP audio-stats probe that logs **only** when loss ≥ 3 %, sample concealment
≥ 5 % (what crackling actually is), or the outbound stream is starved. A healthy
call stays quiet in the log.

Ask a user reporting bad audio to run `__callDiagText()` in the browser console
and paste the output. `LOCAL AUDIO SILENCE DETECTED` in that log means the capture
was lost — the smoking gun for contention.

### Parity
- `GroupCallLiveKit.jsx`: mic-first ordering, join guard, 32 kbps, full
  diagnostics. (It has no transcriber, so it never had the contention bug.)
- `GuestCall.jsx`: **was missing `publishDefaults` entirely** — a guest's audio was
  encoded with library defaults while everyone else on the same call used the
  tuned settings. Now matched, plus mic-first ordering and diagnostics.

### `backend/bookings/livekit_views.py`
The token response now carries `server_transcription: TRANSCRIPTION_ENABLED`, and
the call page disables its browser transcriber when it is true. This is the switch
that retires browser transcription completely — see below.

## Verified

- **The bug is reproduced and fixed under test.** A harness mocking
  `SpeechRecognition` (each live instance = one mic capture) drives the previous
  implementation to `maxConcurrent = 2` on the mute/unmute sequence, and the new
  one to `maxConcurrent = 1`. It also confirms paced restarts (no re-open within
  100 ms of `onend`), that `audio-capture` is terminal after a single open, that
  the restart-storm breaker trips and releases the device, and that a final
  utterance still survives `stop()`. All six checks pass.
- `npm run build` passes; no new lint findings (the `motion is defined but never
  used` error is a pre-existing eslint false positive on `<motion.div>`, present
  on `main` before these changes).
- `manage.py check` clean; daphne restarted and healthy; site returns 200 and the
  token endpoint still enforces auth.

**Not verified:** no real two-party call was made. There is no browser binary on
this host, and the Web Speech API needs a real Chrome with Google's speech
service, so an end-to-end audio comparison (notes on vs off) was not possible
here. Given the bug is intermittent, the fixes were deliberately chosen to make
the bad state *impossible* rather than to be confirmed by one clean test.

## Remaining work — the complete fix

Browser transcription can never be made perfectly safe: the Web Speech API has no
API for supplying an existing audio track, so it will always open its own capture.
The hardening above removes the code-level defects and the ordering race, but the
only way to guarantee a single microphone capture is to transcribe server-side.

That worker already exists (`backend/transcription_worker.py`), is wired to the
same idempotent summary path, and the frontend switch is now in place. It is
**blocked on one thing the owner must provide: an STT provider key.** Neither
`DEEPGRAM_API_KEY` nor `OPENAI_API_KEY` is set in `.env` (only
`ANTHROPIC_API_KEY`, which is used for summarisation and cannot do speech-to-text).

To finish, per `backend/transcription_worker.README.md`:

1. Obtain a Deepgram key (recommended for streaming; ~$0.004–0.02/min) or an
   OpenAI key for Whisper.
2. `python3 -m venv venv-worker && venv-worker/bin/pip install -r requirements-worker.txt`
   — an isolated venv, because `livekit-agents` clashes with the API's pinned
   `livekit-api`.
3. In `.env`: `TRANSCRIPTION_ENABLED=true`, `STT_PROVIDER=deepgram`,
   `DEEPGRAM_API_KEY=…`, `STT_LANGUAGE=en` (Dr. Nath also coaches in French — set
   `fr` per need, or run Deepgram's multilingual model).
4. Install and start `transcription-worker.service`, then restart daphne so the
   API picks up the new flag.
5. Make one real test call and confirm: the browser console shows
   *"server-side transcription active — browser transcriber disabled"*, and a
   `SessionSummary` is written by the worker.

The worker itself has never been run end-to-end and should be tested on a
throwaway booking before a real client session.

Two further items worth doing regardless of the key:
- Bring browser transcription's data-channel segment exchange under the same
  diagnostics (currently only the local side is logged).
- Consider defaulting AI notes **off for the client** and on only for the coach.
  Both sides currently open a second capture; the coach's is the one that produces
  most of the useful transcript, and the client is typically the one on a laptop
  with speakers and no headphones.
