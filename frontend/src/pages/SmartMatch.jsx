import { useState } from "react";
import { api } from "../utils/auth";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { FiArrowRight, FiArrowLeft, FiCheckCircle, FiStar, FiUsers, FiZap } from "react-icons/fi";

const GOAL_OPTIONS = ["Leadership", "Executive", "Career Transition", "Work-Life Balance", "Team Management", "Personal Development"];
const INDUSTRY_OPTIONS = ["Healthcare", "Finance", "Technology", "Energy", "Education", "Retail"];
const LANGUAGE_OPTIONS = ["English", "French", "Spanish", "Arabic", "Mandarin"];

const STEPS = [
  { n: 1, label: "Goals" },
  { n: 2, label: "Industry" },
  { n: 3, label: "Language" },
  { n: 4, label: "Results" },
];

// ─── Step Progress Bar ─────────────────────────────────────────────────────────
const StepBar = ({ step }) => (
  <div className="flex items-center justify-center gap-2 mb-8">
    {STEPS.slice(0, 3).map((s, i) => (
      <div key={s.n} className="flex items-center gap-2">
        <div className="flex items-center gap-1.5">
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300"
            style={{
              background: step > s.n ? "#C8A951" : step === s.n ? "#C8A951" : "rgba(200,169,81,0.12)",
              color: step >= s.n ? "#14213D" : "rgba(74,85,104,0.5)",
            }}
          >
            {step > s.n ? <FiCheckCircle size={13} /> : s.n}
          </div>
          <span className="text-xs font-semibold hidden sm:block" style={{ color: step >= s.n ? "#A9863A" : "rgba(74,85,104,0.45)" }}>
            {s.label}
          </span>
        </div>
        {i < 2 && (
          <div className="w-8 h-px transition-all duration-300" style={{ background: step > s.n ? "#C8A951" : "rgba(200,169,81,0.2)" }} />
        )}
      </div>
    ))}
  </div>
);

// ─── Option Pill ───────────────────────────────────────────────────────────────
const OptionPill = ({ label, selected, onToggle }) => (
  <motion.button
    onClick={onToggle}
    whileHover={{ scale: 1.03 }}
    whileTap={{ scale: 0.96 }}
    className="px-4 py-2.5 rounded-full text-sm font-semibold transition-all duration-200"
    style={{
      background: selected ? "#C8A951" : "white",
      color: selected ? "#14213D" : "#4A5568",
      border: `1px solid ${selected ? "#C8A951" : "rgba(200,169,81,0.3)"}`,
      boxShadow: selected ? "0 2px 12px rgba(200,169,81,0.3)" : "none",
    }}
  >
    {selected && <span className="mr-1.5">✓</span>}
    {label}
  </motion.button>
);

// ─── Coach Result Card ─────────────────────────────────────────────────────────
const CoachCard = ({ coach, index, onView }) => (
  <motion.div
    className="rounded-2xl overflow-hidden"
    style={{ background: "white", border: "1px solid rgba(200,169,81,0.15)", boxShadow: "0 2px 16px rgba(27,43,74,0.05)" }}
    initial={{ opacity: 0, y: 16 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.3, delay: index * 0.06 }}
  >
    <div className="h-1" style={{ background: "linear-gradient(90deg,#C8A951,#F0D98C)" }} />
    <div className="p-5">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center font-bold shrink-0" style={{ background: "#C8A951", color: "#14213D" }}>
          {coach.username?.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-[#1B2B4A]" style={{ fontFamily: "'Playfair Display', serif" }}>{coach.username}</span>
            {coach.is_verified && (
              <span className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: "rgba(52,168,83,0.1)", color: "#2E7D32", border: "1px solid rgba(52,168,83,0.2)" }}>
                <FiCheckCircle size={9} /> Verified
              </span>
            )}
          </div>
          {coach.avg_rating && (
            <div className="flex items-center gap-1 mt-0.5">
              <FiStar size={11} style={{ color: "#C8A951", fill: "#C8A951" }} />
              <span className="text-xs font-semibold" style={{ color: "#A9863A" }}>{parseFloat(coach.avg_rating).toFixed(1)}</span>
            </div>
          )}
        </div>
        {coach.hourly_rate && (
          <p className="text-sm font-bold text-[#1B2B4A] shrink-0">${coach.hourly_rate}<span className="text-xs font-normal text-[#4A5568]">/hr</span></p>
        )}
      </div>

      {coach.specialties?.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          {coach.specialties.slice(0, 4).map(s => (
            <span key={s} className="text-xs px-2.5 py-1 rounded-full font-medium" style={{ background: "rgba(200,169,81,0.1)", color: "#A9863A", border: "1px solid rgba(200,169,81,0.2)" }}>{s}</span>
          ))}
        </div>
      )}

      <motion.button
        whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
        onClick={onView}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-full text-sm font-bold"
        style={{ background: "linear-gradient(135deg,#C8A951,#F0D98C)", color: "#14213D" }}
      >
        View Profile <FiArrowRight size={13} />
      </motion.button>
    </div>
  </motion.div>
);

// ─── Main ──────────────────────────────────────────────────────────────────────
export default function SmartMatch() {
  const [step, setStep] = useState(1);
  const [answers, setAnswers] = useState({ goals: [], industries: [], languages: [] });
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const toggle = (key, value) => {
    setAnswers(prev => ({
      ...prev,
      [key]: prev[key].includes(value)
        ? prev[key].filter(v => v !== value)
        : [...prev[key], value],
    }));
  };

  const handleMatch = async () => {
    setLoading(true);
    try {
      const res = await api.post("/coaches/match/", answers);
      setResults(res.data);
      setStep(4);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen pt-36 pb-16 px-6" style={{ background: "#FAF6EC" }}>

      {/* ── Header (flat, matches dashboard pages) ────────── */}
      <div className="max-w-xl mx-auto text-center">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] mb-2" style={{ color: "#A9863A" }}>AI Coach Matching</p>
          <h1 className="text-3xl md:text-4xl font-normal mb-2 leading-tight" style={{ color: "#1B2B4A", fontFamily: "'Playfair Display', serif" }}>
            Find Your <em style={{ color: "#A9863A" }}>Perfect Coach</em>
          </h1>
          <p className="text-base" style={{ color: "#4A5568" }}>
            Answer three quick questions and we'll match you with coaches who fit your goals, industry, and preferences.
          </p>
        </motion.div>
      </div>

      <div className="max-w-xl mx-auto py-10">
        <motion.div
          className="rounded-2xl overflow-hidden"
          style={{ background: "white", border: "1px solid rgba(200,169,81,0.15)", boxShadow: "0 4px 32px rgba(27,43,74,0.07)" }}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
        >
          <div className="px-8 py-8">
            {step < 4 && <StepBar step={step} />}

            <AnimatePresence mode="wait">

              {/* ── Step 1: Goals ─────────────────────────── */}
              {step === 1 && (
                <motion.div key="step1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.25 }}>
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(200,169,81,0.15)" }}>
                      <FiZap size={13} style={{ color: "#C8A951" }} />
                    </div>
                    <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#C8A951" }}>Step 1 of 3</p>
                  </div>
                  <h2 className="text-2xl font-normal text-[#1B2B4A] mb-1" style={{ fontFamily: "'Playfair Display', serif" }}>
                    What are your coaching goals?
                  </h2>
                  <p className="text-sm text-[#4A5568] mb-6">Select all that apply.</p>
                  <div className="flex flex-wrap gap-2 mb-8">
                    {GOAL_OPTIONS.map(g => (
                      <OptionPill key={g} label={g} selected={answers.goals.includes(g)} onToggle={() => toggle("goals", g)} />
                    ))}
                  </div>
                  <motion.button
                    whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                    onClick={() => setStep(2)}
                    className="gold-btn w-full py-3 rounded-full text-sm font-bold flex items-center justify-center gap-2"
                  >
                    Next <FiArrowRight size={14} />
                  </motion.button>
                </motion.div>
              )}

              {/* ── Step 2: Industry ──────────────────────── */}
              {step === 2 && (
                <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.25 }}>
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(200,169,81,0.15)" }}>
                      <FiUsers size={13} style={{ color: "#C8A951" }} />
                    </div>
                    <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#C8A951" }}>Step 2 of 3</p>
                  </div>
                  <h2 className="text-2xl font-normal text-[#1B2B4A] mb-1" style={{ fontFamily: "'Playfair Display', serif" }}>
                    Which industries are relevant to you?
                  </h2>
                  <p className="text-sm text-[#4A5568] mb-6">Select all that apply.</p>
                  <div className="flex flex-wrap gap-2 mb-8">
                    {INDUSTRY_OPTIONS.map(i => (
                      <OptionPill key={i} label={i} selected={answers.industries.includes(i)} onToggle={() => toggle("industries", i)} />
                    ))}
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setStep(1)}
                      className="flex-1 py-3 rounded-full text-sm font-semibold border flex items-center justify-center gap-2"
                      style={{ borderColor: "rgba(200,169,81,0.3)", color: "#4A5568" }}
                    >
                      <FiArrowLeft size={13} /> Back
                    </button>
                    <motion.button
                      whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                      onClick={() => setStep(3)}
                      className="flex-1 gold-btn py-3 rounded-full text-sm font-bold flex items-center justify-center gap-2"
                    >
                      Next <FiArrowRight size={14} />
                    </motion.button>
                  </div>
                </motion.div>
              )}

              {/* ── Step 3: Language ──────────────────────── */}
              {step === 3 && (
                <motion.div key="step3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.25 }}>
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(200,169,81,0.15)" }}>
                      <FiStar size={13} style={{ color: "#C8A951" }} />
                    </div>
                    <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#C8A951" }}>Step 3 of 3</p>
                  </div>
                  <h2 className="text-2xl font-normal text-[#1B2B4A] mb-1" style={{ fontFamily: "'Playfair Display', serif" }}>
                    Preferred coaching language?
                  </h2>
                  <p className="text-sm text-[#4A5568] mb-6">Select all that apply.</p>
                  <div className="flex flex-wrap gap-2 mb-8">
                    {LANGUAGE_OPTIONS.map(l => (
                      <OptionPill key={l} label={l} selected={answers.languages.includes(l)} onToggle={() => toggle("languages", l)} />
                    ))}
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setStep(2)}
                      className="flex-1 py-3 rounded-full text-sm font-semibold border flex items-center justify-center gap-2"
                      style={{ borderColor: "rgba(200,169,81,0.3)", color: "#4A5568" }}
                    >
                      <FiArrowLeft size={13} /> Back
                    </button>
                    <motion.button
                      whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                      onClick={handleMatch}
                      disabled={loading}
                      className="flex-1 gold-btn py-3 rounded-full text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-60"
                    >
                      {loading ? (
                        <>
                          <div className="w-4 h-4 rounded-full border-2 animate-spin" style={{ borderColor: "#14213D", borderTopColor: "transparent" }} />
                          Matching...
                        </>
                      ) : (
                        <><FiZap size={14} /> Find My Coach</>
                      )}
                    </motion.button>
                  </div>
                </motion.div>
              )}

              {/* ── Step 4: Results ───────────────────────── */}
              {step === 4 && (
                <motion.div key="step4" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
                  <div className="text-center mb-6">
                    <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: "rgba(200,169,81,0.15)" }}>
                      <FiZap size={24} style={{ color: "#C8A951" }} />
                    </div>
                    <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: "#C8A951" }}>Match Complete</p>
                    <h2 className="text-3xl font-normal text-[#1B2B4A]" style={{ fontFamily: "'Playfair Display', serif" }}>
                      Your Matched Coaches
                    </h2>
                    <p className="text-sm text-[#4A5568] mt-1">{results.length} coach{results.length !== 1 ? "es" : ""} found for you</p>
                  </div>

                  {results.length === 0 ? (
                    <div className="text-center py-10 rounded-2xl" style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.15)" }}>
                      <p className="text-4xl mb-3">🔍</p>
                      <p className="text-sm font-semibold text-[#1B2B4A] mb-1">No exact matches found</p>
                      <p className="text-xs text-[#4A5568]">Try browsing the full coach directory.</p>
                    </div>
                  ) : (
                    <div className="space-y-3 mb-6">
                      {results.map((coach, i) => (
                        <CoachCard key={coach.user_id} coach={coach} index={i} onView={() => navigate(`/coaches/${coach.user_id}`)} />
                      ))}
                    </div>
                  )}

                  <div className="flex flex-col gap-2 pt-4" style={{ borderTop: "1px solid rgba(200,169,81,0.12)" }}>
                    <button
                      onClick={() => { setStep(1); setAnswers({ goals: [], industries: [], languages: [] }); setResults([]); }}
                      className="py-2.5 rounded-full text-sm font-semibold border transition-all"
                      style={{ borderColor: "rgba(200,169,81,0.3)", color: "#4A5568" }}
                    >
                      Start Over
                    </button>
                    <button
                      onClick={() => navigate("/coaches")}
                      className="py-2.5 rounded-xl text-sm font-medium transition-all"
                      style={{ color: "rgba(74,85,104,0.6)" }}
                    >
                      Browse all coaches →
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
