import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { motion, AnimatePresence } from "framer-motion";
import { FiUsers, FiCalendar, FiClock, FiArrowRight, FiX, FiCheckCircle } from "react-icons/fi";
import { api } from "../utils/auth";
import { useAuth } from "../context/AuthContext";
import { loadStripe } from "@stripe/stripe-js";
import { Elements } from "@stripe/react-stripe-js";
import PaymentForm from "../components/PaymentForm";

const stripePromise = loadStripe(
  "pk_test_51RCasKQOwqqD0Bo5Lzoz0xt4hMfh2bmrua5Vo3TchUsnI5ZpgDV1Pg7pZUlmBd0soZSOrkJLSTAWkMisLNxH1Pru00v8URzIRH"
);

const fmtDate = (iso) => new Date(iso).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

// ─── Checkout modal: hold → pay → confirm ──────────────────────────────────────
const CheckoutModal = ({ session, onClose, onSuccess }) => {
  const [stage, setStage] = useState("confirm"); // "confirm" | "pay"
  const [clientSecret, setClientSecret] = useState(null);
  const [amount, setAmount] = useState(null);
  const [busy, setBusy] = useState(false);
  const [held, setHeld] = useState(false);

  const startCheckout = async () => {
    setBusy(true);
    try {
      await api.post(`/bookings/group-sessions/${session.id}/hold/`);
      setHeld(true);
      const res = await api.post("/bookings/create-group-payment-intent/", { group_session_id: session.id });
      setClientSecret(res.data.client_secret);
      setAmount(res.data.amount);
      setStage("pay");
    } catch (err) {
      toast.error(err.response?.data?.detail || err.response?.data?.error || "Could not reserve a seat — it may be full.");
      onClose(true); // signal a refresh
    } finally {
      setBusy(false);
    }
  };

  // Release the held seat if the client backs out before paying.
  const handleClose = async () => {
    if (held) {
      try { await api.post(`/bookings/group-sessions/${session.id}/release/`); } catch { /* best effort */ }
    }
    onClose(true);
  };

  return (
    <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={handleClose} />
      <motion.div
        className="relative rounded-2xl w-full max-w-md z-10 overflow-hidden"
        style={{ background: "white", border: "1px solid rgba(200,169,81,0.2)" }}
        initial={{ scale: 0.94, opacity: 0, y: 12 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.94, opacity: 0, y: 12 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
      >
        <div className="px-7 pt-6 pb-5" style={{ background: "linear-gradient(135deg,#1B2B4A,#14213D)" }}>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] mb-1" style={{ color: "#C8A951" }}>Reserve a Seat</p>
              <h3 className="text-2xl font-normal text-white" style={{ fontFamily: "'Playfair Display', serif" }}>{session.title}</h3>
              <p className="text-sm mt-1" style={{ color: "rgba(255,255,255,0.6)" }}>with {session.coach_username}</p>
            </div>
            <button onClick={handleClose} className="p-1.5 rounded-full" style={{ color: "rgba(255,255,255,0.7)" }}><FiX size={18} /></button>
          </div>
        </div>

        <div className="p-7">
          <div className="rounded-xl p-4 mb-5" style={{ background: "#F3ECD9", border: "1px solid rgba(200,169,81,0.2)" }}>
            <p className="flex items-center gap-2 text-sm text-[#1B2B4A]"><FiCalendar size={13} style={{ color: "#C8A951" }} /> {fmtDate(session.start_datetime)}</p>
            <p className="flex items-center gap-2 text-sm text-[#1B2B4A] mt-1.5"><FiClock size={13} style={{ color: "#C8A951" }} /> {fmtTime(session.start_datetime)} – {fmtTime(session.end_datetime)}</p>
            <p className="flex items-center gap-2 text-sm text-[#1B2B4A] mt-1.5"><FiUsers size={13} style={{ color: "#C8A951" }} /> {session.seats_remaining} seat{session.seats_remaining !== 1 ? "s" : ""} left</p>
          </div>

          {stage === "confirm" ? (
            <>
              <div className="flex justify-between items-center mb-5">
                <span className="text-sm text-[#4A5568]">Price per seat</span>
                <span className="text-xl font-bold" style={{ color: "#A9863A", fontFamily: "'Playfair Display', serif" }}>
                  ${parseFloat(session.price_per_seat).toFixed(2)}
                </span>
              </div>
              <button onClick={startCheckout} disabled={busy}
                className="w-full gold-btn py-3.5 rounded-full text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-60">
                {busy ? "Reserving…" : <>Reserve &amp; Pay <FiArrowRight size={15} /></>}
              </button>
            </>
          ) : (
            clientSecret && (
              <Elements stripe={stripePromise} options={{ clientSecret }}>
                <PaymentForm
                  clientSecret={clientSecret}
                  amount={amount}
                  confirmUrl="/bookings/confirm-group-payment/"
                  buildConfirmPayload={(piId) => ({ payment_intent_id: piId, group_session_id: session.id })}
                  onSuccess={onSuccess}
                />
              </Elements>
            )
          )}
        </div>
      </motion.div>
    </motion.div>
  );
};

// ─── Session card ──────────────────────────────────────────────────────────────
const SessionCard = ({ session, onReserve, reserved, index, navigate }) => (
  <motion.div
    initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: index * 0.05 }}
    className="rounded-2xl overflow-hidden flex flex-col"
    style={{ background: "white", border: `1px solid ${reserved ? "rgba(52,168,83,0.35)" : "rgba(200,169,81,0.18)"}`, boxShadow: "0 2px 14px rgba(27,43,74,0.06)" }}
  >
    <div className="h-1" style={{ background: reserved ? "linear-gradient(90deg,#34A853,#86EFAC)" : "linear-gradient(90deg,#C8A951,#F0D98C)" }} />
    <div className="p-6 flex flex-col flex-1">
      <div className="flex items-center gap-2 mb-2">
        <span className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0" style={{ background: "#C8A951", color: "#14213D" }}>
          {session.coach_username?.charAt(0).toUpperCase()}
        </span>
        <span className="text-xs font-semibold" style={{ color: "#A9863A" }}>{session.coach_username}</span>
        {reserved && (
          <span className="ml-auto flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background: "rgba(52,168,83,0.1)", color: "#2E7D32", border: "1px solid rgba(52,168,83,0.25)" }}>
            <FiCheckCircle size={12} /> Reserved
          </span>
        )}
      </div>
      <h3 className="text-xl font-normal text-[#1B2B4A] mb-2" style={{ fontFamily: "'Playfair Display', serif" }}>{session.title}</h3>
      {session.description && <p className="text-sm text-[#4A5568] mb-4 line-clamp-3">{session.description}</p>}

      <div className="space-y-1.5 mb-4 mt-auto">
        <p className="flex items-center gap-2 text-sm text-[#4A5568]"><FiCalendar size={13} style={{ color: "#C8A951" }} /> {fmtDate(session.start_datetime)}</p>
        <p className="flex items-center gap-2 text-sm text-[#4A5568]"><FiClock size={13} style={{ color: "#C8A951" }} /> {fmtTime(session.start_datetime)} – {fmtTime(session.end_datetime)}</p>
        <p className="flex items-center gap-2 text-sm text-[#4A5568]"><FiUsers size={13} style={{ color: "#C8A951" }} /> {session.seats_remaining} of {session.capacity} seats left</p>
      </div>

      <div className="flex items-center justify-between pt-4" style={{ borderTop: "1px solid rgba(200,169,81,0.12)" }}>
        <span className="text-lg font-bold" style={{ color: "#A9863A", fontFamily: "'Playfair Display', serif" }}>
          ${parseFloat(session.price_per_seat).toFixed(2)}<span className="text-xs font-normal text-[#4A5568]"> /seat</span>
        </span>
        {reserved ? (
          <button onClick={() => navigate("/my-learning")}
            className="px-5 py-2.5 rounded-full text-sm font-bold flex items-center gap-2"
            style={{ background: "rgba(52,168,83,0.1)", color: "#2E7D32", border: "1px solid rgba(52,168,83,0.25)" }}>
            <FiCheckCircle size={14} /> My Learning
          </button>
        ) : (
          <button onClick={() => onReserve(session)} disabled={session.seats_remaining <= 0}
            className="gold-btn px-5 py-2.5 rounded-full text-sm font-bold flex items-center gap-2 disabled:opacity-50">
            {session.seats_remaining <= 0 ? "Full" : <>Reserve <FiArrowRight size={14} /></>}
          </button>
        )}
      </div>
    </div>
  </motion.div>
);

// ─── Page ──────────────────────────────────────────────────────────────────────
const GroupSessions = () => {
  const navigate = useNavigate();
  const { isAuthenticated, logout } = useAuth();
  const [sessions, setSessions] = useState([]);
  const [reservedIds, setReservedIds] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [checkout, setCheckout] = useState(null);

  const fetchSessions = useCallback(async () => {
    if (!isAuthenticated) { toast.error("Please log in to view group sessions."); logout(); return; }
    setLoading(true);
    try {
      const [res, mine] = await Promise.all([
        api.get("/bookings/group-sessions/available/"),
        api.get("/bookings/group-sessions/mine/"),
      ]);
      setSessions(res.data);
      // Sessions the client already holds a booked seat in.
      setReservedIds(new Set(
        mine.data.filter((e) => e.session_status !== "cancelled").map((e) => e.group_session)
      ));
    } catch (err) {
      toast.error("Failed to load group sessions.");
      if (err.response?.status === 401) logout();
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, logout]);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  if (loading) return (
    <div className="flex justify-center items-center min-h-screen" style={{ background: "#FAF6EC" }}>
      <div className="w-10 h-10 rounded-full border-2 animate-spin" style={{ borderColor: "#C8A951", borderTopColor: "transparent" }} />
    </div>
  );

  return (
    <div className="min-h-screen pt-28 pb-16 px-6" style={{ background: "#FAF6EC" }}>
      <div className="max-w-5xl mx-auto">
        <motion.div className="mb-8" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] mb-2" style={{ color: "#A9863A" }}>Coaching, together</p>
          <h1 className="text-3xl md:text-4xl font-normal text-[#1B2B4A]" style={{ fontFamily: "'Playfair Display', serif" }}>Group Sessions</h1>
        </motion.div>

        {sessions.length === 0 ? (
          <div className="text-center py-20 rounded-2xl" style={{ background: "white", border: "1px solid rgba(200,169,81,0.15)" }}>
            <p className="text-5xl mb-4">👥</p>
            <h3 className="text-xl font-normal text-[#1B2B4A] mb-2" style={{ fontFamily: "'Playfair Display', serif" }}>No group sessions available</h3>
            <p className="text-sm text-[#4A5568]">Check back soon — new sessions are added regularly.</p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {sessions.map((s, i) => (
              <SessionCard key={s.id} session={s} index={i} onReserve={setCheckout} reserved={reservedIds.has(s.id)} navigate={navigate} />
            ))}
          </div>
        )}
      </div>

      <AnimatePresence>
        {checkout && (
          <CheckoutModal
            session={checkout}
            onClose={(refresh) => { setCheckout(null); if (refresh) fetchSessions(); }}
            onSuccess={() => { setCheckout(null); navigate("/my-learning"); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

export default GroupSessions;
