// Virtual background helpers, shared by the 1:1 and group LiveKit call pages.
//
// Uses @livekit/track-processors (MediaPipe selfie segmentation) to blur or
// replace the camera background. Processors are applied to the LOCAL camera
// video track, so other participants see the effect.
import { BackgroundBlur, VirtualBackground } from "@livekit/track-processors";
import { Track } from "livekit-client";

export const BACKGROUND_OPTIONS = [
  { id: "none", label: "None" },
  { id: "blur", label: "Blur" },
  { id: "navy", label: "Studio", image: "/backgrounds/bg-navy.jpg" },
  { id: "warm", label: "Warm", image: "/backgrounds/bg-warm.jpg" },
];

// The local camera LiveKit track from a Room, or null.
export function getLocalVideoTrack(room) {
  const pub = room?.localParticipant?.getTrackPublication(Track.Source.Camera);
  return pub?.videoTrack || pub?.track || null;
}

// Apply the chosen background to a local video track. Best-effort: failures
// (e.g. an underpowered device) are swallowed so the call is never broken.
export async function applyBackground(videoTrack, optionId) {
  if (!videoTrack) return;
  const opt = BACKGROUND_OPTIONS.find((o) => o.id === optionId) || BACKGROUND_OPTIONS[0];
  try {
    if (opt.id === "none") {
      await videoTrack.stopProcessor();
    } else if (opt.id === "blur") {
      await videoTrack.setProcessor(BackgroundBlur(15));
    } else if (opt.image) {
      await videoTrack.setProcessor(VirtualBackground(opt.image));
    }
  } catch (err) {
    // Segmentation can fail on weak hardware — leave the raw camera as-is.
    console.warn("Background effect could not be applied:", err);
  }
}
