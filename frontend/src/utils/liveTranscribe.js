// Browser live transcription via the Web Speech API (SpeechRecognition).
//
// Used during a live session to transcribe the LOCAL participant's speech only
// (the API can only hear the device microphone, not remote audio). Each side
// runs its own transcriber and exchanges finalised segments over the LiveKit
// data channel, so both build the same merged transcript for the AI summary.
//
// Support is Chrome/Edge (and Chromium browsers). Safari/Firefox return null
// from isTranscriptionSupported(); callers should degrade gracefully.

export function isTranscriptionSupported() {
  return typeof window !== "undefined" &&
    !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

// Create a transcriber. `onFinal(text)` fires for each finalised utterance.
// Returns { start, stop }. Auto-restarts (Chrome stops on silence) until
// stop() is called or the mic permission is denied.
export function createTranscriber({ onFinal, lang = "en-US" } = {}) {
  const SR = typeof window !== "undefined" &&
    (window.SpeechRecognition || window.webkitSpeechRecognition);
  if (!SR) return { start() {}, stop() {} };

  let rec = null;
  let active = false;   // caller wants it running
  let starting = false; // guard against overlapping start()s

  const build = () => {
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

    // Chrome ends recognition after a pause — restart while still active.
    r.onend = () => {
      starting = false;
      if (active) { try { r.start(); starting = true; } catch { /* already starting */ } }
    };

    r.onerror = (e) => {
      // Permission/hardware problems are terminal; transient ones (no-speech,
      // aborted, network) fall through to onend which restarts.
      if (e?.error === "not-allowed" || e?.error === "service-not-allowed") {
        active = false;
      }
    };

    return r;
  };

  return {
    start() {
      if (active) return;
      active = true;
      rec = build();
      try { rec.start(); starting = true; } catch { /* onend will retry */ }
    },
    stop() {
      active = false;
      if (rec) { try { rec.stop(); } catch { /* noop */ } rec = null; }
    },
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
