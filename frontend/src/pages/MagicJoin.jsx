import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import axios from "axios";

const GOLD = "#C8A951";
const DARK = "#1B2B4A";

// Resolves an old email join link to its session and sends the client through
// the normal login flow (passwordless auto-join has been retired).
export default function MagicJoin() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // guard against double-run in StrictMode
    ran.current = true;
    (async () => {
      try {
        // Resolve the (old) email link to its session, then require a normal
        // login — passwordless auto-join has been retired so every client signs
        // in with their own credentials.
        const base = axios.create({ baseURL: "/api/" });
        const res = await base.get(`bookings/magic-join/${token}/`);
        const bookingId = res.data.booking_id;
        navigate(`/login?next=${encodeURIComponent(`/session/${bookingId}`)}`, { replace: true });
      } catch (err) {
        setError(err.response?.data?.detail || "This link isn't valid. Please sign in to join your session.");
      }
    })();
  }, [token, navigate]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center" style={{ background: "#FAF6EC" }}>
      {!error ? (
        <>
          <div className="w-12 h-12 rounded-full border-2 animate-spin mb-5" style={{ borderColor: GOLD, borderTopColor: "transparent" }} />
          <p className="text-lg font-normal" style={{ color: DARK, fontFamily: "'Playfair Display', serif" }}>Getting you into your session…</p>
          <p className="text-sm mt-1" style={{ color: "#4A5568" }}>One moment, no password needed.</p>
        </>
      ) : (
        <>
          <p className="text-lg font-normal mb-2" style={{ color: DARK, fontFamily: "'Playfair Display', serif" }}>Couldn't open your session</p>
          <p className="text-sm mb-5 max-w-sm" style={{ color: "#4A5568" }}>{error}</p>
          <Link to="/login" className="px-6 py-2.5 rounded-full text-sm font-bold" style={{ background: `linear-gradient(135deg,${GOLD},#F0D98C)`, color: "#14213D" }}>
            Sign in
          </Link>
        </>
      )}
    </div>
  );
}
