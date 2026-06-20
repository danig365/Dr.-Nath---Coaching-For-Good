import { useEffect, useState } from "react";
import { api } from "../utils/auth";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  FiSearch, FiSliders, FiCheckCircle, FiX,
  FiArrowRight, FiStar, FiDollarSign, FiUsers,
} from "react-icons/fi";

// ─── Coach Card ───────────────────────────────────────────────────────────────
const CoachCard = ({ coach, index, onView }) => (
  <motion.div
    initial={{ opacity: 0, y: 16 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.3, delay: index * 0.05 }}
    className="rounded-2xl overflow-hidden group"
    style={{
      background: "white",
      border: "1px solid rgba(200,169,81,0.15)",
      boxShadow: "0 2px 16px rgba(27,43,74,0.05)",
    }}
  >
    <div className="h-1" style={{ background: "linear-gradient(90deg,#C8A951,#F0D98C)" }} />

    <div className="p-6">
      {/* Header row */}
      <div className="flex items-start gap-4 mb-4">
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center text-lg font-bold shrink-0"
          style={{ background: "#C8A951", color: "#14213D" }}
        >
          {(coach.display_name || coach.username)?.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h2
              className="text-lg font-normal text-[#1B2B4A] leading-tight"
              style={{ fontFamily: "'Playfair Display', serif" }}
            >
              {coach.display_name || coach.username}
            </h2>
            {coach.is_verified && (
              <span
                className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full"
                style={{ background: "rgba(52,168,83,0.1)", color: "#2E7D32", border: "1px solid rgba(52,168,83,0.2)" }}
              >
                <FiCheckCircle size={10} /> Verified
              </span>
            )}
          </div>
          {coach.avg_rating && (
            <div className="flex items-center gap-1">
              <FiStar size={11} style={{ color: "#C8A951", fill: "#C8A951" }} />
              <span className="text-xs font-semibold" style={{ color: "#A9863A" }}>
                {parseFloat(coach.avg_rating).toFixed(1)}
              </span>
            </div>
          )}
        </div>
        {coach.hourly_rate && (
          <div className="text-right shrink-0">
            <p className="text-xs text-[#4A5568]">from</p>
            <p className="text-base font-bold text-[#1B2B4A]" style={{ fontFamily: "'Playfair Display', serif" }}>
              ${coach.hourly_rate}
              <span className="text-xs font-normal text-[#4A5568]">/hr</span>
            </p>
          </div>
        )}
      </div>

      {/* Bio */}
      <p className="text-sm leading-relaxed mb-4 line-clamp-2" style={{ color: "#4A5568" }}>
        {coach.bio || "Experienced coach ready to help you grow."}
      </p>

      {/* Specialties */}
      {coach.specialties?.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-5">
          {coach.specialties.slice(0, 4).map(s => (
            <span
              key={s}
              className="text-xs px-2.5 py-1 rounded-full font-medium"
              style={{ background: "rgba(200,169,81,0.1)", color: "#A9863A", border: "1px solid rgba(200,169,81,0.2)" }}
            >
              {s}
            </span>
          ))}
          {coach.specialties.length > 4 && (
            <span className="text-xs px-2 py-1 rounded-full" style={{ color: "rgba(74,85,104,0.6)" }}>
              +{coach.specialties.length - 4} more
            </span>
          )}
        </div>
      )}

      {/* CTA */}
      <motion.button
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.97 }}
        onClick={onView}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-full text-sm font-bold transition-all duration-200"
        style={{
          background: "linear-gradient(135deg,#C8A951,#F0D98C)",
          color: "#14213D",
        }}
      >
        View Profile <FiArrowRight size={13} />
      </motion.button>
    </div>
  </motion.div>
);

// ─── Main Component ───────────────────────────────────────────────────────────
export default function CoachDirectory() {
  const [filters, setFilters] = useState({ specialty: "", industry: "", verified: false });
  const [coaches, setCoaches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const timer = setTimeout(() => { fetchCoaches(); }, 400);
    return () => clearTimeout(timer);
  }, [filters]);

  const fetchCoaches = async () => {
    setLoading(true);
    try {
      const params = {};
      if (filters.specialty) params.specialty = filters.specialty;
      if (filters.industry) params.industry = filters.industry;
      if (filters.verified) params.verified = true;
      const res = await api.get("/coaches/", { params });
      setCoaches(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const hasFilters = filters.specialty || filters.industry || filters.verified;

  const clearFilters = () => setFilters({ specialty: "", industry: "", verified: false });

  return (
    <div className="min-h-screen pt-36 pb-16 px-6" style={{ background: "#FAF6EC" }}>

      {/* ── Header (flat, matches dashboard pages) ─────────── */}
      <div className="max-w-5xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <h1
            className="text-3xl md:text-4xl font-normal mb-2 leading-tight"
            style={{ color: "#1B2B4A", fontFamily: "'Playfair Display', serif" }}
          >
            Find Your <em style={{ color: "#A9863A" }}>Coach</em>
          </h1>
          <p className="text-base" style={{ color: "#4A5568" }}>
            Browse our community of verified coaches and find the right guide for your journey.
          </p>
        </motion.div>
      </div>

      <div className="max-w-5xl mx-auto py-10">

        {/* ── Search & Filter Bar ──────────────────────── */}
        <motion.div
          className="mb-8"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
        >
          <div className="flex flex-wrap gap-3 items-center">
            {/* Specialty search */}
            <div className="relative flex-1 min-w-48">
              <FiSearch size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "#C8A951" }} />
              <input
                type="text"
                placeholder="Search by specialty..."
                value={filters.specialty}
                onChange={e => setFilters(f => ({ ...f, specialty: e.target.value }))}
                className="w-full pl-10 pr-4 py-3 rounded-xl text-sm focus:outline-none transition-all duration-200"
                style={{
                  background: "white",
                  border: "1px solid rgba(200,169,81,0.3)",
                  color: "#1B2B4A",
                }}
                onFocus={e => e.target.style.borderColor = "#C8A951"}
                onBlur={e => e.target.style.borderColor = "rgba(200,169,81,0.3)"}
              />
            </div>

            {/* Filter toggle */}
            <button
              onClick={() => setShowFilters(v => !v)}
              className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-200"
              style={{
                background: showFilters ? "#C8A951" : "white",
                color: showFilters ? "#14213D" : "#4A5568",
                border: `1px solid ${showFilters ? "#C8A951" : "rgba(200,169,81,0.3)"}`,
              }}
            >
              <FiSliders size={13} /> Filters {hasFilters && <span className="w-1.5 h-1.5 rounded-full bg-current" />}
            </button>

            {hasFilters && (
              <button
                onClick={clearFilters}
                className="flex items-center gap-1.5 px-3 py-3 rounded-xl text-xs font-semibold transition-all"
                style={{ color: "#B91C1C", border: "1px solid rgba(239,68,68,0.2)", background: "rgba(239,68,68,0.05)" }}
              >
                <FiX size={12} /> Clear
              </button>
            )}
          </div>

          {/* Expandable filters */}
          <AnimatePresence>
            {showFilters && (
              <motion.div
                className="mt-3 p-4 rounded-2xl flex flex-wrap gap-4 items-center"
                style={{ background: "white", border: "1px solid rgba(200,169,81,0.15)" }}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.25 }}
              >
                <div className="flex-1 min-w-40">
                  <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: "rgba(74,85,104,0.6)" }}>Industry</label>
                  <input
                    type="text"
                    placeholder="e.g. Technology, Finance"
                    value={filters.industry}
                    onChange={e => setFilters(f => ({ ...f, industry: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-xl text-sm focus:outline-none transition-all"
                    style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.25)", color: "#1B2B4A" }}
                    onFocus={e => e.target.style.borderColor = "#C8A951"}
                    onBlur={e => e.target.style.borderColor = "rgba(200,169,81,0.25)"}
                  />
                </div>
                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                  <div
                    onClick={() => setFilters(f => ({ ...f, verified: !f.verified }))}
                    className="w-10 h-5 rounded-full relative transition-all duration-200"
                    style={{ background: filters.verified ? "#C8A951" : "rgba(200,169,81,0.2)" }}
                  >
                    <div
                      className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all duration-200"
                      style={{ left: filters.verified ? "calc(100% - 18px)" : "2px" }}
                    />
                  </div>
                  <span className="text-sm font-medium" style={{ color: "#1B2B4A" }}>Verified coaches only</span>
                </label>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* ── Results count ────────────────────────────── */}
        {!loading && (
          <motion.p
            className="text-xs font-semibold uppercase tracking-wider mb-5"
            style={{ color: "rgba(74,85,104,0.6)" }}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          >
            <FiUsers size={11} className="inline mr-1" />
            {coaches.length} {coaches.length === 1 ? "coach" : "coaches"} found
          </motion.p>
        )}

        {/* ── Loading ──────────────────────────────────── */}
        {loading && (
          <div className="flex justify-center py-20">
            <div className="flex flex-col items-center gap-4">
              <div className="w-10 h-10 rounded-full border-2 animate-spin" style={{ borderColor: "#C8A951", borderTopColor: "transparent" }} />
              <p className="text-sm" style={{ color: "rgba(74,85,104,0.7)" }}>Finding coaches...</p>
            </div>
          </div>
        )}

        {/* ── Empty State ──────────────────────────────── */}
        {!loading && coaches.length === 0 && (
          <motion.div
            className="text-center py-20 rounded-2xl"
            style={{ background: "white", border: "1px solid rgba(200,169,81,0.15)" }}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          >
            <p className="text-5xl mb-4">🔍</p>
            <h3 className="text-xl font-normal text-[#1B2B4A] mb-2" style={{ fontFamily: "'Playfair Display', serif" }}>
              No coaches found
            </h3>
            <p className="text-sm text-[#4A5568] mb-5">Try adjusting your filters or search terms.</p>
            {hasFilters && (
              <button
                onClick={clearFilters}
                className="gold-btn inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-bold"
              >
                <FiX size={13} /> Clear Filters
              </button>
            )}
          </motion.div>
        )}

        {/* ── Coach Grid ───────────────────────────────── */}
        {!loading && coaches.length > 0 && (
          <motion.div
            className="grid grid-cols-1 md:grid-cols-2 gap-5"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          >
            {coaches.map((coach, i) => (
              <CoachCard
                key={coach.user_id}
                coach={coach}
                index={i}
                onView={() => navigate(`/coaches/${coach.user_id}`)}
              />
            ))}
          </motion.div>
        )}
      </div>
    </div>
  );
}
