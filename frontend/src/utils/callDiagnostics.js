// Lightweight in-call diagnostics.
//
// Audio faults on live calls are intermittent and users can't reproduce them on
// demand, so every interesting event (device acquisition, track (re)publish,
// reconnect, connection-quality change, transcriber lifecycle, periodic audio
// stats) is timestamped into a bounded ring buffer AND echoed to the console.
// When someone reports "the audio broke", ask them to run `__callDiag()` in the
// browser console (or `copy(__callDiagText())`) and paste the result — that
// turns an unreproducible report into an evidence trail.

const MAX_EVENTS = 400;
const buffer = [];
let t0 = null;

function stamp() {
  if (t0 == null) t0 = performance.now();
  return Math.round(performance.now() - t0);
}

// Record one event. `tag` is a short channel name ("mic", "stt", "net", "track"),
// `detail` any small JSON-able payload.
export function diag(tag, message, detail) {
  const entry = { t: stamp(), tag, message, ...(detail !== undefined ? { detail } : {}) };
  buffer.push(entry);
  if (buffer.length > MAX_EVENTS) buffer.shift();
  // Console too, so it interleaves with LiveKit's own logs in a live debug session.
  try {
    if (detail !== undefined) console.log(`[call +${entry.t}ms][${tag}] ${message}`, detail);
    else console.log(`[call +${entry.t}ms][${tag}] ${message}`);
  } catch { /* noop */ }
}

// Begin a new timeline (called when a call page mounts / joins).
export function resetDiag(label) {
  buffer.length = 0;
  t0 = performance.now();
  diag("session", `diagnostics started: ${label}`, {
    ua: typeof navigator !== "undefined" ? navigator.userAgent : "",
    cores: typeof navigator !== "undefined" ? navigator.hardwareConcurrency : undefined,
  });
}

export function getDiag() { return buffer.slice(); }

export function getDiagText() {
  return buffer.map((e) => `+${e.t}ms [${e.tag}] ${e.message}${e.detail !== undefined ? ` ${JSON.stringify(e.detail)}` : ""}`).join("\n");
}

if (typeof window !== "undefined") {
  window.__callDiag = getDiag;
  window.__callDiagText = getDiagText;
}

// Enumerate the audio input devices actually in use — a second app or tab
// holding the mic is a common cause of a bad-sounding call.
export async function logAudioDevices(reason) {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    diag("mic", `audio inputs (${reason})`, devices
      .filter((d) => d.kind === "audioinput")
      .map((d) => ({ label: d.label || "(unlabelled)", id: d.deviceId.slice(0, 8) })));
  } catch { /* noop */ }
}

// Snapshot the real applied constraints of a published mic track. If the browser
// silently dropped echo cancellation / changed the sample rate, it shows up here.
export function logMicTrackSettings(mediaStreamTrack, reason) {
  if (!mediaStreamTrack) return;
  try {
    const s = mediaStreamTrack.getSettings?.() || {};
    diag("mic", `local mic settings (${reason})`, {
      label: mediaStreamTrack.label,
      readyState: mediaStreamTrack.readyState,
      muted: mediaStreamTrack.muted,
      echoCancellation: s.echoCancellation,
      noiseSuppression: s.noiseSuppression,
      autoGainControl: s.autoGainControl,
      sampleRate: s.sampleRate,
      channelCount: s.channelCount,
      deviceId: s.deviceId ? String(s.deviceId).slice(0, 8) : undefined,
    });
  } catch { /* noop */ }
}

// Poll the outbound + inbound audio RTP stats and log only when something looks
// wrong (loss, jitter, or the decoder concealing/stretching samples — which is
// exactly what "crackling / breaking up" sounds like). Returns a stop function.
export function startAudioStatsProbe(room, { intervalMs = 10000 } = {}) {
  let stopped = false;
  const prev = { out: null, in: null };

  const sample = async () => {
    if (stopped || !room) return;
    try {
      const pubs = [];
      room.localParticipant?.audioTrackPublications?.forEach((p) => pubs.push(p));
      room.remoteParticipants?.forEach((rp) => rp.audioTrackPublications?.forEach((p) => pubs.push(p)));

      for (const pub of pubs) {
        const track = pub?.track;
        const stats = await track?.getRTCStatsReport?.();
        if (!stats) continue;
        stats.forEach((r) => {
          if (r.type === "outbound-rtp" && r.kind === "audio") {
            const cur = { packets: r.packetsSent || 0, bytes: r.bytesSent || 0 };
            if (prev.out) {
              const dp = cur.packets - prev.out.packets;
              // A live mic should send ~50 packets/s; far fewer means capture stalled.
              if (dp >= 0 && dp < (intervalMs / 1000) * 20) {
                diag("net", "outbound audio starved", { packetsInWindow: dp, windowMs: intervalMs });
              }
            }
            prev.out = cur;
          }
          if (r.type === "inbound-rtp" && r.kind === "audio") {
            const cur = {
              lost: r.packetsLost || 0,
              recv: r.packetsReceived || 0,
              concealed: r.concealedSamples || 0,
              total: r.totalSamplesReceived || 0,
            };
            if (prev.in) {
              const dLost = cur.lost - prev.in.lost;
              const dRecv = cur.recv - prev.in.recv;
              const dConcealed = cur.concealed - prev.in.concealed;
              const dTotal = cur.total - prev.in.total;
              const lossPct = dRecv + dLost > 0 ? (dLost / (dRecv + dLost)) * 100 : 0;
              const concealPct = dTotal > 0 ? (dConcealed / dTotal) * 100 : 0;
              // Thresholds chosen so a healthy call stays silent in the log.
              if (lossPct >= 3 || concealPct >= 5) {
                diag("net", "inbound audio degraded", {
                  lossPct: Number(lossPct.toFixed(1)),
                  concealPct: Number(concealPct.toFixed(1)),
                  jitter: r.jitter,
                });
              }
            }
            prev.in = cur;
          }
        });
      }
    } catch { /* stats are best-effort */ }
  };

  const id = setInterval(sample, intervalMs);
  return () => { stopped = true; clearInterval(id); };
}
