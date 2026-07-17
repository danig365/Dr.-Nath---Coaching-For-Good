// Virtual background helpers, shared by the 1:1 and group LiveKit call pages.
//
// Uses @livekit/track-processors (MediaPipe selfie segmentation) to blur or
// replace the camera background. Processors are applied to the LOCAL camera
// video track, so other participants see the effect.
import {
  BackgroundProcessor, supportsBackgroundProcessors, supportsModernBackgroundProcessors,
  setLogLevel,
} from "@livekit/track-processors";
import { Track } from "livekit-client";

// TEMPORARY DEBUG (remove once virtual backgrounds are confirmed working):
// turns on the library's own pipeline logs so we can see exactly which step
// stalls. Everything is console-only and prefixed with [bg].
const BG_DEBUG = true;
if (BG_DEBUG) {
  try { setLogLevel("debug"); } catch (e) { console.warn("[bg] setLogLevel failed", e); }
}

export const BACKGROUND_OPTIONS = [
  { id: "none", label: "None" },
  { id: "blur", label: "Blur" },
  { id: "navy", label: "Studio", image: "/backgrounds/bg-navy.jpg" },
  { id: "warm", label: "Warm", image: "/backgrounds/bg-warm.jpg" },
];

// Serve the MediaPipe segmentation engine (WASM) + model from OUR OWN domain
// instead of the default public CDNs (cdn.jsdelivr.net + storage.googleapis.com).
// Those are blocked on many corporate/firewalled networks, which made every
// background (blur + images) silently fail — only "None" worked. Same-origin
// assets fix that. Files live in `public/mediapipe/`.
const ASSET_PATHS = {
  tasksVisionFileSet: "/mediapipe/wasm",
  modelAssetPath: "/mediapipe/selfie_segmenter.tflite",
};

// Pull the segmentation engine into the browser cache as soon as the call page
// opens, instead of on the first background click. It's ~3 MB over the wire, so
// fetching it lazily meant staring at "loading…" for 10s+ on a slow link; doing
// it while the user is still in the lobby makes the click feel instant. Cheap in
// context — a video call moves far more data than this — and the assets are
// immutable + cached, so it only ever downloads once per browser.
let assetsWarmed = false;
export function preloadBackgroundAssets() {
  if (assetsWarmed || typeof fetch === "undefined") return;
  try { if (!supportsBackgroundProcessors()) return; } catch { return; }
  assetsWarmed = true;
  const warm = (url) =>
    fetch(url, { cache: "force-cache" })
      .then((r) => r.arrayBuffer())
      .then(() => { if (BG_DEBUG) console.log("[bg] preloaded", url); })
      .catch((e) => { if (BG_DEBUG) console.log("[bg] preload failed", url, String(e)); });
  warm(`${ASSET_PATHS.tasksVisionFileSet}/vision_wasm_internal.js`);
  warm(`${ASSET_PATHS.tasksVisionFileSet}/vision_wasm_internal.wasm`);
  warm(ASSET_PATHS.modelAssetPath);
}

// The local camera LiveKit track from a Room, or null.
export function getLocalVideoTrack(room) {
  const pub = room?.localParticipant?.getTrackPublication(Track.Source.Camera);
  return pub?.videoTrack || pub?.track || null;
}

// Loading the segmentation engine should take a moment, not forever. If it ever
// stalls (blocked asset, wedged WASM), fail loudly instead of leaving the picker
// stuck on "loading…" for the rest of the call. Generous, because the very first
// use downloads several MB of WASM on what may be a slow link — after that it's
// cached and effectively instant.
const APPLY_TIMEOUT_MS = 60000;

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("background-timeout")), ms);
    }),
  ]);
}

// Apply the chosen background to a local video track. Returns
// { ok: true } on success, or { ok: false, reason } so the caller can tell the
// user when the effect genuinely isn't supported (never breaks the call).
// `image` may be a preset path or a custom object-URL (uploaded background).
export async function applyBackground(videoTrack, optionId, customImage) {
  const t0 = performance.now();
  const log = (...a) => { if (BG_DEBUG) console.log(`[bg +${Math.round(performance.now() - t0)}ms]`, ...a); };

  if (!videoTrack) { log("no local video track"); return { ok: false, reason: "no-track" }; }
  const opt = BACKGROUND_OPTIONS.find((o) => o.id === optionId);
  const image = optionId === "custom" ? customImage : opt?.image;
  log("start", { optionId, image, trackSid: videoTrack.sid, muted: videoTrack.isMuted });
  try {
    if (optionId === "none" || (!opt && !image)) {
      log("stopping processor (None)");
      await videoTrack.stopProcessor();
      log("processor stopped");
      return { ok: true };
    }
    log("support", {
      background: supportsBackgroundProcessors(),
      modern: supportsModernBackgroundProcessors(),
      webgl2: !!document.createElement("canvas").getContext("webgl2"),
    });
    if (!supportsBackgroundProcessors()) { log("NOT SUPPORTED on this browser"); return { ok: false, reason: "unsupported" }; }

    // Confirm the self-hosted assets are actually reachable from this browser.
    if (BG_DEBUG) {
      const probe = (url) => fetch(url, { method: "GET", headers: { Range: "bytes=0-0" } })
        .then((r) => log("asset probe", url, r.status, r.headers.get("content-type")))
        .catch((e) => log("asset probe FAILED", url, String(e)));
      probe(`${ASSET_PATHS.tasksVisionFileSet}/vision_wasm_internal.js`);
      probe(ASSET_PATHS.modelAssetPath);
    }

    // NOTE: `assetPaths` only takes effect on the processor's OWN options — the
    // deprecated BackgroundBlur()/VirtualBackground() helpers take it as a 4th
    // `ProcessorWrapperOptions` argument, which silently ignores it and falls back
    // to the public CDNs (blocked on some corporate networks → loads forever).
    log("constructing processor", { mode: optionId === "blur" ? "background-blur" : "virtual-background", assetPaths: ASSET_PATHS });
    const processor = optionId === "blur"
      ? BackgroundProcessor({ mode: "background-blur", blurRadius: 15, assetPaths: ASSET_PATHS })
      : image
        ? BackgroundProcessor({ mode: "virtual-background", imagePath: image, assetPaths: ASSET_PATHS })
        : null;
    if (!processor) { log("unknown option"); return { ok: false, reason: "unknown-option" }; }
    log("processor constructed — calling setProcessor()…");

    await withTimeout(videoTrack.setProcessor(processor), APPLY_TIMEOUT_MS);
    log("setProcessor RESOLVED — background applied ✅");
    return { ok: true };
  } catch (err) {
    // Segmentation failed or stalled (no WebGL / weak device / assets blocked).
    log("FAILED", err?.message || err);
    console.warn("Background effect could not be applied:", err);
    // Revert to the raw camera. A half-applied / stalled processor can leave the
    // track alive but producing NO frames — which looks like a dead camera to
    // both sides — so re-acquire the device too. A failed background must never
    // cost the user their video.
    try { await videoTrack.stopProcessor(); } catch { /* noop */ }
    try { await videoTrack.restartTrack?.(); } catch { /* noop */ }
    return { ok: false, reason: "unsupported", error: err };
  }
}
