// Feature flags — single source of truth for toggling functionality on/off.
//
// Group sessions are visible. The flag is kept so the feature can be toggled in
// one place later if needed (gates the client nav link, coach tab, and routes).
export const GROUP_SESSIONS_ENABLED = true;

// Video call provider. Flip this single value to switch the whole app between
// the built-in P2P/mesh WebRTC system and LiveKit — instant rollback either way.
//   "builtin" → SessionCallPage / GroupCallPage (original WebRTC)
//   "livekit" → SessionCallLiveKit / GroupCallLiveKit (LiveKit SFU)
export const VIDEO_PROVIDER = "livekit"; // "builtin" | "livekit"
