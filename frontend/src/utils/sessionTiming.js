// Grace window for 1:1 sessions.
//
// A call gives the full booked duration from when both sides actually connect,
// but never runs later than (scheduled end + grace). The same grace extends the
// window in which a session can still be joined. This lets a slightly late start
// keep the full session without calls running forever or no-shows hanging open.
export const SESSION_GRACE_MS = 10 * 60 * 1000; // 10 minutes

// Rejoin window: how long after the scheduled end a 1:1 session's SAME link
// stays live so participants can run over or reconnect and continue (N3). The
// scheduled end is a soft boundary — the call is not force-ended and the booking
// is not finalised until this window closes. Mirrors SESSION_REJOIN_MINUTES on
// the backend — keep the two in sync.
export const SESSION_REJOIN_MS = 120 * 60 * 1000; // 2 hours

// ── What counts as an "upcoming" 1:1 session ─────────────────────────────────
// This has to mean exactly the same thing in the sessions list and in the navbar
// badge, so both import it from here. (They previously had their own copies and
// drifted apart: the badge compared only the session's DATE against `now`, which
// silently dropped every session happening later TODAY.)

// The session's scheduled end (ms epoch). Prefers the slot's absolute UTC times;
// falls back to the legacy session_date/session_time (stored as UTC).
export function sessionEndMs(s) {
  const start = new Date(s.slot_start || `${s.session_date}T${s.session_time}Z`).getTime();
  return s.slot_end ? new Date(s.slot_end).getTime() : start + (s.duration || 60) * 60 * 1000;
}

// Still live: joinable / continuable until the rejoin window closes (N3).
export function isSessionLive(s) {
  return Date.now() < sessionEndMs(s) + SESSION_REJOIN_MS;
}

// A session shown under "Upcoming" — awaiting confirmation or confirmed, and not
// yet past its rejoin window.
export function isUpcomingSession(s) {
  return (s.status === "pending" || s.status === "accepted") && isSessionLive(s);
}

// "1st", "2nd", "3rd", "4th"… — used to label which session this is for a client
// on a programme (backend sends `session_number`).
export function ordinal(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "";
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] || "th"}`;
}
