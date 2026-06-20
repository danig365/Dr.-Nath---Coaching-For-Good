import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "react-toastify";
import { motion, AnimatePresence } from "framer-motion";
import {
  FiCalendar, FiClock, FiUser, FiMessageSquare,
  FiChevronDown, FiChevronLeft, FiChevronRight, FiDollarSign, FiArrowLeft, FiStar,
  FiCheckCircle, FiCreditCard,
} from "react-icons/fi";
import { api } from "../utils/auth";
import { useAuth } from "../context/AuthContext";
import { loadStripe } from "@stripe/stripe-js";
import { Elements } from "@stripe/react-stripe-js";
import PaymentForm from "../components/PaymentForm";

const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const dayKey = (iso) => new Date(iso).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });

// ─── Field Label ──────────────────────────────────────────────────────────────
const FieldLabel = ({ icon: Icon, children }) => (
  <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "rgba(74,85,104,0.7)" }}>
    <Icon size={12} style={{ color: "#C8A951" }} /> {children}
  </label>
);

// ─── Gold Select ──────────────────────────────────────────────────────────────
const GoldSelect = ({ name, value, onChange, children }) => (
  <div className="relative">
    <select
      name={name}
      value={value}
      onChange={onChange}
      className="w-full px-4 py-3 pr-10 rounded-xl text-sm font-medium appearance-none focus:outline-none transition-all duration-200"
      style={{
        background: "white",
        border: "1px solid rgba(200,169,81,0.3)",
        color: "#1B2B4A",
      }}
      onFocus={e => e.target.style.borderColor = "#C8A951"}
      onBlur={e => e.target.style.borderColor = "rgba(200,169,81,0.3)"}
    >
      {children}
    </select>
    <FiChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "#C8A951" }} />
  </div>
);

// ─── Step Indicator ───────────────────────────────────────────────────────────
const StepIndicator = ({ step }) => (
  <div className="flex items-center justify-center gap-3 mb-8">
    {[
      { n: 1, label: "Details" },
      { n: 2, label: "Payment" },
    ].map(({ n, label }, i) => (
      <div key={n} className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300"
            style={{
              background: step >= n ? "#C8A951" : "rgba(200,169,81,0.12)",
              color: step >= n ? "#14213D" : "rgba(74,85,104,0.5)",
            }}
          >
            {step > n ? <FiCheckCircle size={13} /> : n}
          </div>
          <span className="text-xs font-semibold" style={{ color: step >= n ? "#A9863A" : "rgba(74,85,104,0.5)" }}>{label}</span>
        </div>
        {i < 1 && <div className="w-12 h-px" style={{ background: step > 1 ? "#C8A951" : "rgba(200,169,81,0.2)" }} />}
      </div>
    ))}
  </div>
);

// ─── Skill Summary Card ────────────────────────────────────────────────────────
const SkillSummary = ({ skill, duration }) => {
  const totalCost = ((parseFloat(skill.price) / 60) * parseInt(duration)).toFixed(2);
  return (
    <div className="rounded-2xl overflow-hidden mb-6" style={{ border: "1px solid rgba(200,169,81,0.2)" }}>
      <div className="h-1" style={{ background: "linear-gradient(90deg,#C8A951,#F0D98C)" }} />
      <div className="p-5" style={{ background: "#F3ECD9" }}>
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 font-bold text-lg" style={{ background: "#C8A951", color: "#14213D" }}>
            {skill.mentor?.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-normal text-[#1B2B4A] truncate" style={{ fontFamily: "'Playfair Display', serif" }}>{skill.title}</h3>
            <p className="text-xs text-[#4A5568] mt-0.5">with {skill.mentor}</p>
            {skill.avg_rating && (
              <div className="flex items-center gap-1 mt-1">
                <FiStar size={11} style={{ color: "#C8A951", fill: "#C8A951" }} />
                <span className="text-xs font-semibold" style={{ color: "#A9863A" }}>{parseFloat(skill.avg_rating).toFixed(1)}</span>
              </div>
            )}
          </div>
          <div className="text-right shrink-0">
            <p className="text-xs text-[#4A5568]">${parseFloat(skill.price).toFixed(2)}/hr</p>
            <p className="text-base font-bold text-[#1B2B4A]" style={{ fontFamily: "'Playfair Display', serif" }}>${totalCost}</p>
            <p className="text-xs text-[#4A5568]">for {duration} min</p>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Slot Calendar ─────────────────────────────────────────────────────────────
const localDateKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const SlotCalendar = ({ slots, selectedSlot, onSelectSlot }) => {
  // Group available slots by their local calendar date.
  const slotsByDate = useMemo(() => {
    const m = {};
    slots.forEach((s) => {
      const k = localDateKey(new Date(s.start_datetime));
      (m[k] ||= []).push(s);
    });
    Object.values(m).forEach((arr) =>
      arr.sort((a, b) => new Date(a.start_datetime) - new Date(b.start_datetime))
    );
    return m;
  }, [slots]);

  const firstAvailable = useMemo(() => {
    const ds = slots.map((s) => new Date(s.start_datetime)).sort((a, b) => a - b);
    return ds[0] || null;
  }, [slots]);

  const [viewMonth, setViewMonth] = useState(() => {
    const base = firstAvailable || new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState(() =>
    firstAvailable ? localDateKey(firstAvailable) : null
  );

  // Keep the calendar pointed at whatever slot is currently selected — this is
  // what makes an invite-link slot (auto-selected by the parent) show up on the
  // right day with its time highlighted.
  useEffect(() => {
    if (!selectedSlot) return;
    const d = new Date(selectedSlot.start_datetime);
    setSelectedDate(localDateKey(d));
    setViewMonth(new Date(d.getFullYear(), d.getMonth(), 1));
  }, [selectedSlot]);

  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const startWeekday = (new Date(year, month, 1).getDay() + 6) % 7; // Mon-first
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const monthLabel = viewMonth.toLocaleDateString([], { month: "long", year: "numeric" });
  const daySlots = selectedDate ? (slotsByDate[selectedDate] || []) : [];

  return (
    <div className="space-y-4">
      {/* Calendar card */}
      <div className="rounded-2xl p-4" style={{ background: "white", border: "1px solid rgba(200,169,81,0.2)" }}>
        {/* Month header */}
        <div className="flex items-center justify-between mb-3">
          <button type="button" onClick={() => setViewMonth(new Date(year, month - 1, 1))}
            className="w-8 h-8 rounded-full flex items-center justify-center transition-all hover:bg-[rgba(200,169,81,0.12)]"
            style={{ color: "#A9863A" }}>
            <FiChevronLeft size={16} />
          </button>
          <p className="text-sm font-bold text-[#1B2B4A]" style={{ fontFamily: "'Playfair Display', serif" }}>{monthLabel}</p>
          <button type="button" onClick={() => setViewMonth(new Date(year, month + 1, 1))}
            className="w-8 h-8 rounded-full flex items-center justify-center transition-all hover:bg-[rgba(200,169,81,0.12)]"
            style={{ color: "#A9863A" }}>
            <FiChevronRight size={16} />
          </button>
        </div>

        {/* Weekday row */}
        <div className="grid grid-cols-7 gap-1 mb-1">
          {WEEKDAYS.map((w) => (
            <div key={w} className="text-center text-[10px] font-semibold uppercase tracking-wider py-1" style={{ color: "rgba(74,85,104,0.6)" }}>{w}</div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7 gap-1">
          {cells.map((date, i) => {
            if (!date) return <div key={`b${i}`} />;
            const key = localDateKey(date);
            const hasSlots = !!slotsByDate[key];
            const isSelected = key === selectedDate;
            const isPast = date < todayStart;
            return (
              <button
                key={key}
                type="button"
                disabled={!hasSlots}
                onClick={() => setSelectedDate(key)}
                className="relative aspect-square rounded-xl flex items-center justify-center text-sm font-medium transition-all"
                style={
                  isSelected
                    ? { background: "#1B2B4A", color: "#FAF6EC" }
                    : hasSlots
                    ? { background: "rgba(200,169,81,0.12)", color: "#1B2B4A", cursor: "pointer" }
                    : { background: "transparent", color: isPast ? "rgba(74,85,104,0.3)" : "rgba(74,85,104,0.45)", cursor: "not-allowed" }
                }
              >
                {date.getDate()}
                {hasSlots && !isSelected && (
                  <span className="absolute bottom-1 w-1 h-1 rounded-full" style={{ background: "#C8A951" }} />
                )}
              </button>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-1.5 mt-3 text-[11px]" style={{ color: "rgba(74,85,104,0.7)" }}>
          <span className="w-2 h-2 rounded-full" style={{ background: "#C8A951" }} /> Available dates
        </div>
      </div>

      {/* Times for the selected date */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <FiClock size={13} style={{ color: "#C8A951" }} />
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "rgba(74,85,104,0.7)" }}>Available Times</p>
        </div>
        {daySlots.length === 0 ? (
          <p className="text-sm py-3 text-center" style={{ color: "rgba(74,85,104,0.6)" }}>Select an available date above.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {daySlots.map((slot) => {
              const active = selectedSlot?.id === slot.id;
              return (
                <button
                  key={slot.id}
                  type="button"
                  onClick={() => onSelectSlot(slot)}
                  className="px-3 py-2.5 rounded-xl text-sm font-semibold transition-all text-center"
                  style={active
                    ? { background: "#C8A951", color: "#14213D", border: "1px solid #C8A951" }
                    : { background: "white", color: "#1B2B4A", border: "1px solid rgba(200,169,81,0.3)" }}
                >
                  {fmtTime(slot.start_datetime)}
                  <span className="block text-[10px] font-normal mt-0.5" style={{ color: active ? "rgba(20,33,61,0.7)" : "rgba(74,85,104,0.6)" }}>
                    {slot.duration_minutes} min
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────
const BookSessionPage = () => {
  const { id: skillId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedSlotId = searchParams.get("slot"); // from a coach invite link
  const { isAuthenticated, logout } = useAuth();

  const [skill, setSkill] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [formData, setFormData] = useState({
    skillLevel: "Beginner",
    message: "",
  });

  const [slots, setSlots] = useState([]);
  const [slotsLoading, setSlotsLoading] = useState(true);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [slotNotice, setSlotNotice] = useState(""); // shown if an invite slot is gone
  const autoSelectedRef = useRef(false); // ensures the invite slot is applied only once
  const resumedRef = useRef(false); // ensures a post-login resume runs only once

  const [paymentStep, setPaymentStep] = useState(false);
  const [clientSecret, setClientSecret] = useState(null);
  const [paymentAmount, setPaymentAmount] = useState(null);

  const duration = selectedSlot ? selectedSlot.duration_minutes : 60;
  const [stripePromise] = useState(() =>
    loadStripe("pk_test_51RCasKQOwqqD0Bo5Lzoz0xt4hMfh2bmrua5Vo3TchUsnI5ZpgDV1Pg7pZUlmBd0soZSOrkJLSTAWkMisLNxH1Pru00v8URzIRH")
  );

  const fetchSkillDetails = useCallback(async () => {
    // Guests are welcome here: they can browse the offering, see slots, pick a
    // time and fill in details. Authentication is only required at Confirm
    // (handled in handleSubmit), so we no longer bounce un-authenticated users.
    setLoading(true);
    try {
      const response = await api.get("/skills/public/");
      const found = response.data.find(s => s.id === parseInt(skillId));
      if (found) setSkill(found);
      else { toast.error("Skill not found."); navigate("/skills"); }
    } catch (error) {
      toast.error("Failed to load skill details.");
      // Only force logout for an authenticated user whose session genuinely expired.
      if (error.response?.status === 401 && isAuthenticated) logout();
    } finally {
      setLoading(false);
    }
  }, [skillId, isAuthenticated, logout, navigate]);

  useEffect(() => { fetchSkillDetails(); }, [fetchSkillDetails]);

  const fetchSlots = useCallback(async () => {
    setSlotsLoading(true);
    try {
      const res = await api.get(`/bookings/slots/available/?skill=${skillId}`);
      setSlots(res.data);
    } catch {
      // non-fatal; just show empty state
    } finally {
      setSlotsLoading(false);
    }
  }, [skillId]);

  useEffect(() => { fetchSlots(); }, [fetchSlots]);

  // Auto-select the slot from a coach invite link (`?slot=`) once slots load.
  // If that slot is no longer open (booked/expired), fall back gracefully with
  // a soft notice so the visitor can pick another time.
  useEffect(() => {
    if (autoSelectedRef.current) return;
    if (!requestedSlotId || slotsLoading) return;
    const match = slots.find((s) => String(s.id) === String(requestedSlotId));
    if (match) {
      setSelectedSlot(match);
    } else {
      setSlotNotice("The time from your invite link is no longer available — please pick another below.");
    }
    autoSelectedRef.current = true;
  }, [requestedSlotId, slots, slotsLoading]);

  const handleChange = e => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  // Release a held slot if the client backs out of payment.
  const releaseHold = useCallback(async () => {
    if (selectedSlot) {
      try { await api.post(`/bookings/slots/${selectedSlot.id}/release/`); } catch { /* best effort */ }
    }
  }, [selectedSlot]);

  // Reserve the slot and open the Stripe payment step. Requires auth (the hold
  // is tied to the logged-in user). Shared by the manual submit and the
  // post-login auto-resume.
  const startCheckout = useCallback(async (slot) => {
    setIsSubmitting(true);
    try {
      // 1. Reserve the slot so nobody else can grab it during checkout.
      await api.post(`/bookings/slots/${slot.id}/hold/`);
      // 2. Start payment for the slot's duration.
      const res = await api.post("/bookings/create-payment-intent/", {
        skill_id: parseInt(skillId),
        duration: slot.duration_minutes,
      });
      setClientSecret(res.data.client_secret);
      setPaymentAmount(res.data.amount);
      setPaymentStep(true);
    } catch (err) {
      const msg = err.response?.data?.detail || "This slot is no longer available. Please pick another.";
      toast.error(msg);
      fetchSlots();
      setSelectedSlot(null);
    } finally {
      setIsSubmitting(false);
    }
  }, [skillId, fetchSlots]);

  const handleSubmit = async e => {
    e.preventDefault();
    if (!selectedSlot) { toast.error("Please select an available time slot."); return; }
    // Deferred login: a guest can fill everything in, but must sign in to
    // confirm. Stash the in-progress booking and bounce through login; the
    // resume effect picks it back up and goes straight to payment.
    if (!isAuthenticated) {
      sessionStorage.setItem("pendingBooking", JSON.stringify({
        skillId: String(skillId),
        slotId: selectedSlot.id,
        skillLevel: formData.skillLevel,
        message: formData.message,
      }));
      const next = `/book/${skillId}?slot=${selectedSlot.id}`;
      toast.info("Please sign in to confirm — we've saved your selected time and details.");
      navigate(`/login?next=${encodeURIComponent(next)}`);
      return;
    }
    startCheckout(selectedSlot);
  };

  // After returning from login/register, resume a booking the guest started:
  // restore their details + slot and go straight to payment — no re-entry.
  useEffect(() => {
    if (resumedRef.current) return;
    if (!isAuthenticated || loading || slotsLoading) return;
    const raw = sessionStorage.getItem("pendingBooking");
    if (!raw) return;
    let intent;
    try { intent = JSON.parse(raw); } catch { sessionStorage.removeItem("pendingBooking"); return; }
    if (String(intent.skillId) !== String(skillId)) return; // intent is for another offering
    resumedRef.current = true;
    sessionStorage.removeItem("pendingBooking");
    setFormData({ skillLevel: intent.skillLevel || "Beginner", message: intent.message || "" });
    const match = slots.find((s) => String(s.id) === String(intent.slotId));
    if (!match) {
      setSlotNotice("The time you selected was just taken while you signed in — please pick another below.");
      return;
    }
    setSelectedSlot(match);
    toast.success("You're signed in — continuing to payment to confirm your booking.");
    startCheckout(match);
  }, [isAuthenticated, loading, slotsLoading, slots, skillId, startCheckout]);

  const editDetails = async () => {
    await releaseHold();
    setPaymentStep(false);
  };

  const bookingData = {
    skill: parseInt(skillId),
    slot_id: selectedSlot?.id,
    skill_level: formData.skillLevel,
    message: formData.message,
  };

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="flex justify-center items-center min-h-screen" style={{ background: "#FAF6EC" }}>
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 rounded-full border-2 animate-spin" style={{ borderColor: "#C8A951", borderTopColor: "transparent" }} />
        <p className="text-sm" style={{ color: "rgba(74,85,104,0.7)" }}>Loading session details...</p>
      </div>
    </div>
  );

  if (!skill) return (
    <div className="flex justify-center items-center min-h-screen" style={{ background: "#FAF6EC" }}>
      <p className="text-sm text-[#4A5568]">Skill not found.</p>
    </div>
  );

  return (
    <div className="min-h-screen pt-36 pb-16 px-4" style={{ background: "#FAF6EC" }}>
      <div className="max-w-lg mx-auto">

        {/* ── Back link ──────────────────────────────────────── */}
        <motion.button
          onClick={() => navigate("/skills")}
          className="flex items-center gap-2 text-sm font-medium mb-6 transition-all"
          style={{ color: "#A9863A" }}
          whileHover={{ x: -3 }}
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3 }}
        >
          <FiArrowLeft size={14} /> Back to Skills
        </motion.button>

        {/* ── Card ───────────────────────────────────────────── */}
        <motion.div
          className="rounded-2xl overflow-hidden"
          style={{ background: "white", border: "1px solid rgba(200,169,81,0.15)", boxShadow: "0 4px 32px rgba(27,43,74,0.08)" }}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          {/* Card header */}
          <div className="px-8 pt-8 pb-6" style={{ background: "linear-gradient(135deg, #1B2B4A, #14213D)" }}>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] mb-2" style={{ color: "#C8A951" }}>
              Book a Session
            </p>
            <h1 className="text-3xl font-normal text-white" style={{ fontFamily: "'Playfair Display', serif" }}>
              {paymentStep ? "Complete Payment" : "Confirm Your Booking"}
            </h1>
            <p className="text-sm mt-1" style={{ color: "rgba(255,255,255,0.55)" }}>
              {paymentStep ? "Your session is almost confirmed." : `Coaching session with ${skill.mentor}`}
            </p>
          </div>

          <div className="px-8 py-8">
            <StepIndicator step={paymentStep ? 2 : 1} />

            {/* Skill summary */}
            <SkillSummary skill={skill} duration={duration} />

            <AnimatePresence mode="wait">
              {/* ── Step 1: Booking Form ─────────────────────── */}
              {!paymentStep && (
                <motion.form
                  key="form"
                  onSubmit={handleSubmit}
                  className="space-y-5"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.3 }}
                >
                  {/* Available slots */}
                  <div>
                    <FieldLabel icon={FiCalendar}>Choose an Available Slot</FieldLabel>
                    {slotNotice && (
                      <div className="rounded-xl px-4 py-3 mb-3 text-sm flex items-start gap-2"
                        style={{ background: "rgba(200,169,81,0.12)", border: "1px solid rgba(200,169,81,0.3)", color: "#8a6d1f" }}>
                        <FiClock size={15} className="mt-0.5 shrink-0" />
                        <span>{slotNotice}</span>
                      </div>
                    )}
                    {slotsLoading ? (
                      <div className="flex items-center gap-2 text-sm py-4" style={{ color: "rgba(74,85,104,0.7)" }}>
                        <div className="w-4 h-4 rounded-full border-2 animate-spin" style={{ borderColor: "#C8A951", borderTopColor: "transparent" }} />
                        Loading available times…
                      </div>
                    ) : slots.length === 0 ? (
                      <div className="rounded-xl p-5 text-center text-sm" style={{ background: "#FAF6EC", border: "1px dashed rgba(200,169,81,0.4)", color: "#4A5568" }}>
                        This coach has no open slots right now. Please check back later.
                      </div>
                    ) : (
                      <SlotCalendar slots={slots} selectedSlot={selectedSlot} onSelectSlot={setSelectedSlot} />
                    )}
                  </div>

                  {/* Skill Level */}
                  <div>
                    <FieldLabel icon={FiUser}>Your Experience Level</FieldLabel>
                    <GoldSelect name="skillLevel" value={formData.skillLevel} onChange={handleChange}>
                      <option value="Beginner">Beginner</option>
                      <option value="Intermediate">Intermediate</option>
                      <option value="Advanced">Advanced</option>
                    </GoldSelect>
                  </div>

                  {/* Message */}
                  <div>
                    <FieldLabel icon={FiMessageSquare}>Learning Goals (optional)</FieldLabel>
                    <textarea
                      name="message"
                      rows={4}
                      value={formData.message}
                      onChange={handleChange}
                      placeholder="What would you like to focus on? Share any specific goals or questions..."
                      className="w-full px-4 py-3 rounded-xl text-sm resize-none focus:outline-none transition-all duration-200"
                      style={{
                        background: "white",
                        border: "1px solid rgba(200,169,81,0.3)",
                        color: "#1B2B4A",
                      }}
                      onFocus={e => e.target.style.borderColor = "#C8A951"}
                      onBlur={e => e.target.style.borderColor = "rgba(200,169,81,0.3)"}
                    />
                  </div>

                  {/* Price breakdown */}
                  <div className="rounded-xl p-4" style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.15)" }}>
                    <div className="flex justify-between text-sm mb-1.5">
                      <span style={{ color: "#4A5568" }}>Rate</span>
                      <span className="font-medium text-[#1B2B4A]">${parseFloat(skill.price).toFixed(2)}/hr</span>
                    </div>
                    <div className="flex justify-between text-sm mb-1.5">
                      <span style={{ color: "#4A5568" }}>Duration</span>
                      <span className="font-medium text-[#1B2B4A]">{selectedSlot ? `${duration} minutes` : "Select a slot"}</span>
                    </div>
                    <div className="h-px my-2" style={{ background: "rgba(200,169,81,0.2)" }} />
                    <div className="flex justify-between text-sm font-bold">
                      <span style={{ color: "#1B2B4A" }}>Total</span>
                      <span style={{ color: "#A9863A" }}>
                        ${((parseFloat(skill.price) / 60) * duration).toFixed(2)}
                      </span>
                    </div>
                  </div>

                  <motion.button
                    type="submit"
                    disabled={isSubmitting || !selectedSlot}
                    whileHover={!isSubmitting && selectedSlot ? { scale: 1.02 } : {}}
                    whileTap={!isSubmitting && selectedSlot ? { scale: 0.97 } : {}}
                    className="w-full gold-btn py-3.5 rounded-full text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-60"
                  >
                    {isSubmitting ? (
                      <>
                        <div className="w-4 h-4 rounded-full border-2 animate-spin" style={{ borderColor: "#14213D", borderTopColor: "transparent" }} />
                        Processing...
                      </>
                    ) : isAuthenticated ? (
                      <>
                        <FiCreditCard size={14} /> Proceed to Payment
                      </>
                    ) : (
                      <>
                        <FiUser size={14} /> Sign In to Confirm
                      </>
                    )}
                  </motion.button>

                  {!isAuthenticated && (
                    <p className="text-center text-xs mt-3 flex items-center justify-center gap-1.5" style={{ color: "rgba(74,85,104,0.7)" }}>
                      <FiUser size={11} /> You&apos;ll sign in to confirm — your selected time and details are saved.
                    </p>
                  )}
                </motion.form>
              )}

              {/* ── Step 2: Payment ──────────────────────────── */}
              {paymentStep && clientSecret && (
                <motion.div
                  key="payment"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.3 }}
                >
                  <div className="rounded-xl p-4 mb-5 flex items-center gap-3" style={{ background: "#F3ECD9", border: "1px solid rgba(200,169,81,0.2)" }}>
                    <FiCheckCircle size={16} style={{ color: "#C8A951", shrink: 0 }} />
                    <div>
                      <p className="text-xs font-semibold text-[#1B2B4A]">Session details confirmed</p>
                      <p className="text-xs text-[#4A5568]">
                        {selectedSlot && `${duration} min · ${dayKey(selectedSlot.start_datetime)} at ${fmtTime(selectedSlot.start_datetime)}`}
                      </p>
                    </div>
                  </div>

                  <Elements stripe={stripePromise} options={{ clientSecret }}>
                    <PaymentForm
                      clientSecret={clientSecret}
                      amount={paymentAmount}
                      bookingData={bookingData}
                      onSuccess={() => navigate("/my-learning")}
                    />
                  </Elements>

                  <button
                    onClick={editDetails}
                    className="mt-4 w-full py-2.5 rounded-full text-sm font-medium transition-all"
                    style={{ color: "#A9863A", border: "1px solid rgba(200,169,81,0.25)", background: "transparent" }}
                  >
                    ← Edit Session Details
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default BookSessionPage;
