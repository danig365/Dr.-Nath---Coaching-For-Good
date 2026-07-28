// Browser live transcription via the Web Speech API (SpeechRecognition).
//
// Used during a live session to transcribe the LOCAL participant's speech only
// (the API can only hear the device microphone, not remote audio). Each side
// runs its own transcriber and exchanges finalised segments over the LiveKit
// data channel, so both build the same merged transcript for the AI summary.
//
// Support is Chrome/Edge (and Chromium browsers). Safari/Firefox return null
// from isTranscriptionSupported(); callers should degrade gracefully.
//
// ── WHY THIS FILE IS DEFENSIVE ────────────────────────────────────────────────
// SpeechRecognition opens its OWN capture of the physical microphone, in
// parallel with the one WebRTC/LiveKit already holds. Chrome cannot always
// share a device between two capture clients with different requirements, so
// each open/close cycle risks reconfiguring the shared device — which is heard
// on the call as crackling, dropouts and returning echo (the echo canceller's
// filter state is lost when the capture is reconfigured).
//
// Chrome ends `continuous` recognition on every silence timeout, so a naive
// "restart in onend" loop re-opens the microphone dozens of times per call.
// This module therefore:
//   1. never restarts synchronously inside onend (Chrome throws there, and the
//      swallowed error used to kill transcription silently for the whole call);
//   2. always builds a FRESH recognizer and hard-detaches the old one, with a
//      generation guard, so a stale recognizer can never resurrect itself and
//      leave TWO live recognition sessions competing for the microphone;
//   3. paces restarts (floor delay + exponential backoff on errors) so the
//      device is never hammered open/closed;
//   4. trips a circuit breaker and stays off for the rest of the call if it has
//      to restart abnormally often — a contended microphone must degrade the
//      notes, never the conversation.
// Every transition is reported through `onStatus` for the diagnostics log.

// Floor delay before re-opening the mic after recognition ends. Long enough for
// Chrome to fully release the capture, short enough not to lose speech.
const MIN_RESTART_MS = 450;
const MAX_RESTART_MS = 8000;
// If recognition has to restart more often than this, the device is contended
// (or Chrome is erroring in a loop) — stop competing for the mic entirely.
const RESTART_WINDOW_MS = 60000;
const MAX_RESTARTS_PER_WINDOW = 14;

export function isTranscriptionSupported() {
  return typeof window !== "undefined" &&
    !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

// Create a transcriber. `onFinal(text)` fires for each finalised utterance;
// `onStatus(event, detail)` reports lifecycle for diagnostics/UI.
// Returns { start, stop, isRunning, isBlocked }.
export function createTranscriber({ onFinal, onStatus, lang = "en-US" } = {}) {
  const SR = typeof window !== "undefined" &&
    (window.SpeechRecognition || window.webkitSpeechRecognition);
  const status = (event, detail) => { try { onStatus?.(event, detail); } catch { /* noop */ } };
  if (!SR) return { start() {}, stop() {}, isRunning: () => false, isBlocked: () => true };

  let rec = null;
  let active = false;        // caller wants it running
  let blocked = false;       // circuit breaker tripped — off for the rest of the call
  let generation = 0;        // bumped whenever we abandon a recognizer
  let restartTimer = null;
  let backoff = MIN_RESTART_MS;
  let restartCount = 0;
  let windowStart = 0;

  // Abandon a recognizer for good: bump the generation so its late `onend` /
  // `onerror` can't schedule a restart, drop the restart handlers, and ask it to
  // release the microphone. `onresult` is deliberately left attached so a final
  // buffered utterance still reaches the transcript.
  const abandon = (r, { graceful }) => {
    generation += 1;
    if (!r) return;
    r.onend = null;
    r.onerror = null;
    r.onaudiostart = null;
    r.onaudioend = null;
    try { graceful ? r.stop() : r.abort(); } catch { /* already dead */ }
  };

  const scheduleRestart = (reason, { isError = false } = {}) => {
    if (!active || blocked) return;

    const now = Date.now();
    if (now - windowStart > RESTART_WINDOW_MS) { windowStart = now; restartCount = 0; }
    restartCount += 1;
    if (restartCount > MAX_RESTARTS_PER_WINDOW) {
      blocked = true;
      active = false;
      status("blocked", { reason: "restart-storm", restartCount, windowMs: RESTART_WINDOW_MS });
      return;
    }

    // Errors back off exponentially; a normal silence timeout uses the floor.
    backoff = isError ? Math.min(backoff * 2, MAX_RESTART_MS) : MIN_RESTART_MS;
    status("restart-scheduled", { reason, inMs: backoff, restartCount });
    clearTimeout(restartTimer);
    restartTimer = setTimeout(launch, backoff);
  };

  function launch() {
    if (!active || blocked) return;
    const myGen = generation;
    const isCurrent = () => myGen === generation;

    const r = new SR();
    r.continuous = true;
    r.interimResults = false;
    r.lang = lang;
    r.maxAlternatives = 1;

    r.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) {
          const text = (result[0]?.transcript || "").trim();
          if (text) { try { onFinal?.(text); } catch { /* noop */ } }
        }
      }
    };

    // These two bracket the actual device acquisition — the events that matter
    // when diagnosing a mic fight.
    r.onaudiostart = () => { if (isCurrent()) status("device-open"); };
    r.onaudioend = () => { if (isCurrent()) status("device-close"); };

    // A clean end (Chrome stops on silence) — reset the backoff and come back.
    r.onend = () => {
      if (!isCurrent()) return;
      abandon(r, { graceful: false });
      rec = null;
      scheduleRestart("ended");
    };

    r.onerror = (e) => {
      if (!isCurrent()) return;
      const err = e?.error || "unknown";
      status("error", { error: err });
      // Terminal: permission refused, or the device itself is unavailable
      // (another app or the WebRTC capture is holding it exclusively). Retrying
      // would only hammer the microphone.
      if (err === "not-allowed" || err === "service-not-allowed" || err === "audio-capture") {
        blocked = true;
        active = false;
        abandon(r, { graceful: false });
        rec = null;
        status("blocked", { reason: err });
        return;
      }
      // Transient (no-speech / aborted / network): onend follows and restarts,
      // but mark it as an error so the backoff grows.
      abandon(r, { graceful: false });
      rec = null;
      scheduleRestart(err, { isError: err !== "no-speech" });
    };

    rec = r;
    try {
      r.start();
      status("started");
    } catch {
      // InvalidStateError etc. — treat as an error restart rather than dying.
      abandon(r, { graceful: false });
      rec = null;
      scheduleRestart("start-threw", { isError: true });
    }
  }

  return {
    start() {
      if (active || blocked) return;
      active = true;
      backoff = MIN_RESTART_MS;
      windowStart = Date.now();
      restartCount = 0;
      status("start-requested");
      launch();
    },
    stop() {
      if (!active && !rec && !restartTimer) return;
      active = false;
      clearTimeout(restartTimer);
      restartTimer = null;
      abandon(rec, { graceful: true });
      rec = null;
      status("stopped");
    },
    isRunning: () => active,
    isBlocked: () => blocked,
  };
}

// Merge time-ordered segments into a plain-text transcript for the AI.
// segments: [{ speaker, text, ts }]
export function buildTranscriptText(segments) {
  return (segments || [])
    .slice()
    .sort((a, b) => (a.ts || 0) - (b.ts || 0))
    .map((s) => `${s.speaker}: ${s.text}`)
    .join("\n");
}
