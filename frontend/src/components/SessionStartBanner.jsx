import { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { FiVideo, FiX } from "react-icons/fi";
import { api } from "../utils/auth";
import { useAuth } from "../context/AuthContext";
import { SESSION_GRACE_MS } from "../utils/sessionTiming";

const LEAD_MS = 15 * 60 * 1000; // surface the banner from 15 min before start

const startMs = (s) => new Date(s.slot_start || `${s.session_date}T${s.session_time}Z`).getTime();
const endMs = (s) => {
  const start = startMs(s);
  return s.slot_end ? new Date(s.slot_end).getTime() : start + (s.duration || 60) * 60000;
};

// A global, always-visible nudge: when a session is about to start (or is live),
// show a "Join now" bar with a live countdown — so even a non-technical user on
// any page can jump straight in, without hunting for the session.
export default function SessionStartBanner() {
  const { isAuthenticated, isAdmin } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [sessions, setSessions] = useState([]);
  const [dismissed, setDismissed] = useState({});
  const [, setTick] = useState(0);
  const pollRef = useRef(null);

  useEffect(() => {
    if (!isAuthenticated || isAdmin()) { setSessions([]); return undefined; }
    const load = () =>
      api.get("/bookings/")
        .then((res) => {
          const all = Array.isArray(res.data) ? res.data : (res.data.results ?? []);
          setSessions(all.filter((b) => b.status === "accepted"));
        })
        .catch(() => {});
    load();
    pollRef.current = setInterval(load, 30000);
    return () => clearInterval(pollRef.current);
  }, [isAuthenticated, isAdmin]);

  // 1s tick drives the live countdown.
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  if (!isAuthenticated) return null;
  // Don't cover the actual call page.
  if (pathname.startsWith("/session/") || pathname.startsWith("/join/")) return null;

  const now = Date.now();
  const active = sessions
    .filter((s) => !dismissed[s.id] && now >= startMs(s) - LEAD_MS && now < endMs(s) + SESSION_GRACE_MS)
    .sort((a, b) => startMs(a) - startMs(b))[0];
  if (!active) return null;

  const start = startMs(active);
  const live = now >= start;
  const remaining = Math.max(0, Math.floor((start - now) / 1000));
  const mm = Math.floor(remaining / 60);
  const ss = remaining % 60;
  const when = live ? "is live now" : `starts in ${mm}:${String(ss).padStart(2, "0")}`;

  return (
    <div className="fixed left-0 right-0 z-40 flex justify-center px-4" style={{ top: 76 }}>
      <div className="flex items-center gap-3 w-full max-w-2xl rounded-2xl px-4 py-2.5 shadow-xl"
        style={{ background: "linear-gradient(135deg,#1B2B4A,#14213D)", border: "1px solid rgba(200,169,81,0.4)" }}>
        <span className="flex h-2.5 w-2.5 relative shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-70" style={{ background: live ? "#34A853" : "#C8A951" }} />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5" style={{ background: live ? "#34A853" : "#C8A951" }} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white truncate">
            {active.skill_title || "Your session"} {when}
          </p>
        </div>
        <button onClick={() => navigate(`/session/${active.id}`)}
          className="shrink-0 inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-bold"
          style={{ background: "linear-gradient(135deg,#C8A951,#F0D98C)", color: "#14213D" }}>
          <FiVideo size={14} /> Join now
        </button>
        <button onClick={() => setDismissed((d) => ({ ...d, [active.id]: true }))}
          className="shrink-0 p-1 rounded-full hover:bg-white/10" style={{ color: "rgba(255,255,255,0.6)" }} title="Dismiss">
          <FiX size={16} />
        </button>
      </div>
    </div>
  );
}
