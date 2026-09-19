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

// Pipeline logging for diagnosing a background that won't apply. Off now that
// the presets are confirmed working — flip to true to get the library's own
// logs, all console-only and prefixed with [bg].
const BG_DEBUG = false;
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

// The largest edge we hand to the segmentation shader. A photo straight off a
// phone is often 4000px+ wide, which is over the maximum texture size on plenty
// of GPUs — the upload fails and the background silently never appears, while
// the bundled presets (1920px JPEGs) work fine.
const MAX_CUSTOM_EDGE = 1920;

/**
 * Turn a file the user picked into something the processor can definitely use:
 * decoded here, scaled down, and re-encoded as a JPEG data URL.
 *
 * Why not hand the processor the object URL directly (what we used to do): the
 * library loads the image with `crossOrigin = "Anonymous"`, swallows any load
 * error into a console line, and then runs with no background at all — so an
 * image it can't read (an iPhone HEIC, which browsers can't decode, or one too
 * large for the GPU) looked exactly like "custom backgrounds don't work".
 *
 * Returns a data URL. Throws an Error with a message worth showing the user.
 */
export async function prepareCustomBackground(file) {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error(
        "This image couldn't be read. Photos straight from an iPhone (.HEIC) aren't supported — please use a JPG or PNG."
      ));
      el.src = objectUrl;
    });

    const scale = Math.min(1, MAX_CUSTOM_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser couldn't prepare the image.");
    ctx.drawImage(img, 0, 0, w, h);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
    if (!dataUrl.startsWith("data:image/jpeg")) throw new Error("This browser couldn't prepare the image.");
    return dataUrl;
  } finally {
    try { URL.revokeObjectURL(objectUrl); } catch { /* noop */ }
  }
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

    // Check the image loads BEFORE handing it over: the processor logs a load
    // failure and then renders with no background, which reads as "the feature
    // is broken" rather than "that file couldn't be used".
    if (image) {
      const loaded = await new Promise((resolve) => {
        const el = new Image();
        el.crossOrigin = "Anonymous";       // exactly what the library does
        el.onload = () => resolve(true);
        el.onerror = () => resolve(false);
        el.src = image;
      });
      if (!loaded) {
        log("background image failed to load", image.slice(0, 64));
        return { ok: false, reason: "image" };
      }
    }

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
