// Grace window for 1:1 sessions.
//
// A call gives the full booked duration from when both sides actually connect,
// but never runs later than (scheduled end + grace). The same grace extends the
// window in which a session can still be joined. This lets a slightly late start
// keep the full session without calls running forever or no-shows hanging open.
export const SESSION_GRACE_MS = 10 * 60 * 1000; // 10 minutes
