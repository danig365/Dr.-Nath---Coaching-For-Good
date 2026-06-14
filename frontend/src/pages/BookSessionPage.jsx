import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { motion, AnimatePresence } from "framer-motion";
import {
  FiCalendar, FiClock, FiUser, FiMessageSquare,
  FiChevronDown, FiDollarSign, FiArrowLeft, FiStar,
  FiCheckCircle, FiCreditCard,
} from "react-icons/fi";
import { api } from "../utils/auth";
import { useAuth } from "../context/AuthContext";
import { loadStripe } from "@stripe/stripe-js";
import { Elements } from "@stripe/react-stripe-js";
import PaymentForm from "../components/PaymentForm";

const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120];

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

// ─── Main Component ───────────────────────────────────────────────────────────
const BookSessionPage = () => {
  const { id: skillId } = useParams();
  const navigate = useNavigate();
  const { isAuthenticated, logout } = useAuth();

  const [skill, setSkill] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [formData, setFormData] = useState({
    preferredTime: "",
    duration: "60",
    skillLevel: "Beginner",
    message: "",
  });

  const [paymentStep, setPaymentStep] = useState(false);
  const [clientSecret, setClientSecret] = useState(null);
  const [paymentAmount, setPaymentAmount] = useState(null);
  const [stripePromise] = useState(() =>
    loadStripe("pk_test_51RCasKQOwqqD0Bo5Lzoz0xt4hMfh2bmrua5Vo3TchUsnI5ZpgDV1Pg7pZUlmBd0soZSOrkJLSTAWkMisLNxH1Pru00v8URzIRH")
  );

  const fetchSkillDetails = useCallback(async () => {
    if (!isAuthenticated) { toast.error("Please log in to book a session."); logout(); return; }
    setLoading(true);
    try {
      const response = await api.get("/skills/public/");
      const found = response.data.find(s => s.id === parseInt(skillId));
      if (found) setSkill(found);
      else { toast.error("Skill not found."); navigate("/skills"); }
    } catch (error) {
      toast.error("Failed to load skill details.");
      if (error.response?.status === 401) logout();
    } finally {
      setLoading(false);
    }
  }, [skillId, isAuthenticated, logout, navigate]);

  useEffect(() => { fetchSkillDetails(); }, [fetchSkillDetails]);

  const handleChange = e => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async e => {
    e.preventDefault();
    if (!formData.preferredTime) { toast.error("Please select a date and time."); return; }
    setIsSubmitting(true);
    try {
      const res = await api.post("/bookings/create-payment-intent/", {
        skill_id: parseInt(skillId),
        duration: parseInt(formData.duration),
      });
      setClientSecret(res.data.client_secret);
      setPaymentAmount(res.data.amount);
      setPaymentStep(true);
    } catch (err) {
      toast.error("Failed to initialize payment. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const [session_date, session_time] = formData.preferredTime
    ? formData.preferredTime.split("T")
    : ["", ""];

  const bookingData = {
    skill: parseInt(skillId),
    session_date,
    session_time,
    duration: parseInt(formData.duration),
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
    <div className="min-h-screen pt-28 pb-16 px-4" style={{ background: "#FAF6EC" }}>
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
            <SkillSummary skill={skill} duration={formData.duration} />

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
                  {/* Date & Time */}
                  <div>
                    <FieldLabel icon={FiCalendar}>Preferred Date & Time</FieldLabel>
                    <input
                      type="datetime-local"
                      name="preferredTime"
                      value={formData.preferredTime}
                      onChange={handleChange}
                      required
                      min={new Date().toISOString().slice(0, 16)}
                      className="w-full px-4 py-3 rounded-xl text-sm font-medium focus:outline-none transition-all duration-200"
                      style={{
                        background: "white",
                        border: "1px solid rgba(200,169,81,0.3)",
                        color: "#1B2B4A",
                      }}
                      onFocus={e => e.target.style.borderColor = "#C8A951"}
                      onBlur={e => e.target.style.borderColor = "rgba(200,169,81,0.3)"}
                    />
                    {formData.preferredTime && (
                      <p className="text-xs mt-1.5" style={{ color: "#A9863A" }}>
                        {new Date(formData.preferredTime).toLocaleString("en-US", {
                          weekday: "long", month: "long", day: "numeric",
                          hour: "2-digit", minute: "2-digit",
                        })}
                      </p>
                    )}
                  </div>

                  {/* Duration */}
                  <div>
                    <FieldLabel icon={FiClock}>Session Duration</FieldLabel>
                    <GoldSelect name="duration" value={formData.duration} onChange={handleChange}>
                      {DURATION_OPTIONS.map(m => (
                        <option key={m} value={m}>{m} minutes</option>
                      ))}
                    </GoldSelect>
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
                      <span className="font-medium text-[#1B2B4A]">{formData.duration} minutes</span>
                    </div>
                    <div className="h-px my-2" style={{ background: "rgba(200,169,81,0.2)" }} />
                    <div className="flex justify-between text-sm font-bold">
                      <span style={{ color: "#1B2B4A" }}>Total</span>
                      <span style={{ color: "#A9863A" }}>
                        ${((parseFloat(skill.price) / 60) * parseInt(formData.duration)).toFixed(2)}
                      </span>
                    </div>
                  </div>

                  <motion.button
                    type="submit"
                    disabled={isSubmitting}
                    whileHover={!isSubmitting ? { scale: 1.02 } : {}}
                    whileTap={!isSubmitting ? { scale: 0.97 } : {}}
                    className="w-full gold-btn py-3.5 rounded-full text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-60"
                  >
                    {isSubmitting ? (
                      <>
                        <div className="w-4 h-4 rounded-full border-2 animate-spin" style={{ borderColor: "#14213D", borderTopColor: "transparent" }} />
                        Processing...
                      </>
                    ) : (
                      <>
                        <FiCreditCard size={14} /> Proceed to Payment
                      </>
                    )}
                  </motion.button>
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
                        {formData.duration} min · {new Date(formData.preferredTime).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
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
                    onClick={() => setPaymentStep(false)}
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
