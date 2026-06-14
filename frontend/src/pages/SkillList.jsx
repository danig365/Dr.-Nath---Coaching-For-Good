import { useEffect, useState, useCallback } from "react";
import { api } from "../utils/auth";
import { useNavigate } from "react-router-dom";
import { FiSearch, FiChevronLeft, FiChevronRight, FiStar } from "react-icons/fi";
import { toast } from "react-toastify";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRightIcon } from "@heroicons/react/24/outline";

// ─── Skill Card ──────────────────────────────────────────────────────────────
const SkillCard = ({ skill, onBook, index }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.35, delay: index * 0.05 }}
    whileHover={{ y: -4 }}
    className="flex flex-col rounded-2xl overflow-hidden transition-all duration-300 hover:shadow-xl"
    style={{ background: "white", border: "1px solid rgba(200,169,81,0.15)" }}
  >
    {/* Card top accent */}
    <div className="h-1.5 w-full" style={{ background: "linear-gradient(90deg, #C8A951, #F0D98C)" }} />

    <div className="flex flex-col flex-1 p-6">
      <div className="flex justify-between items-start mb-3">
        <h3
          className="text-lg font-normal text-[#1B2B4A] leading-tight pr-2"
          style={{ fontFamily: "'Playfair Display', serif" }}
        >
          {skill.title}
        </h3>
        <span
          className="shrink-0 text-xs font-bold px-2.5 py-1 rounded-full"
          style={{ background: "rgba(200,169,81,0.12)", color: "#A9863A" }}
        >
          ${parseFloat(skill.price).toFixed(0)}/hr
        </span>
      </div>

      <p className="text-sm text-[#4A5568] leading-relaxed mb-4 flex-1 line-clamp-3">
        {skill.description}
      </p>

      <div className="mt-auto pt-4 space-y-3" style={{ borderTop: "1px solid rgba(200,169,81,0.15)" }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
              style={{ background: "#C8A951", color: "#14213D" }}
            >
              {skill.mentor?.charAt(0).toUpperCase()}
            </div>
            <span className="text-xs font-medium" style={{ color: "#C8A951" }}>{skill.mentor}</span>
          </div>
          {skill.rating !== null && (
            <span className="flex items-center gap-1 text-xs font-semibold" style={{ color: "#A9863A" }}>
              <FiStar className="fill-current" />
              {parseFloat(skill.rating).toFixed(1)}
            </span>
          )}
        </div>

        {onBook && (
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => onBook(skill.id)}
            className="w-full gold-btn py-2.5 rounded-full text-sm font-bold flex items-center justify-center gap-2"
          >
            Book Session <ArrowRightIcon className="w-4 h-4" />
          </motion.button>
        )}
      </div>
    </div>
  </motion.div>
);

// ─── Main Component ──────────────────────────────────────────────────────────
const SkillList = () => {
  const [allSkills, setAllSkills] = useState([]);
  const [skillsToDisplay, setSkillsToDisplay] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState(["All"]);

  const navigate = useNavigate();
  const skillsPerPage = 8;

  useEffect(() => {
    if (allSkills.length > 0) {
      const unique = [...new Set(allSkills.map(s => s.category))];
      setCategories(["All", ...unique.filter(Boolean)]);
    }
  }, [allSkills]);

  const fetchAllSkills = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get("/skills/public/");
      setAllSkills(res.data);
    } catch (err) {
      toast.error("Failed to load skills.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAllSkills(); }, [fetchAllSkills]);

  useEffect(() => {
    let filtered = allSkills;
    if (searchQuery) {
      filtered = filtered.filter(s =>
        s.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.mentor?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    if (selectedCategory !== "All") {
      filtered = filtered.filter(s => s.category === selectedCategory);
    }
    setSkillsToDisplay(filtered);
    setCurrentPage(1);
  }, [allSkills, searchQuery, selectedCategory]);

  const indexOfLast = currentPage * skillsPerPage;
  const indexOfFirst = indexOfLast - skillsPerPage;
  const currentSkills = skillsToDisplay.slice(indexOfFirst, indexOfLast);
  const totalPages = Math.ceil(skillsToDisplay.length / skillsPerPage);

  const handleBookSession = (skillId) => navigate(`/book/${skillId}`);

  const topRated = [...allSkills]
    .filter(s => s.rating !== null)
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 4);

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen" style={{ background: "#FAF6EC" }}>
        <div className="flex flex-col items-center gap-4">
          <div
            className="w-10 h-10 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: "#C8A951", borderTopColor: "transparent" }}
          />
          <p className="text-sm" style={{ color: "rgba(74,85,104,0.7)" }}>Loading skills...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pt-28 pb-16 px-6" style={{ background: "#FAF6EC" }}>

      {/* ── Header (flat, matches dashboard pages) ────────── */}
      <div className="max-w-5xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <p className="text-xs font-semibold uppercase tracking-[0.22em] mb-2" style={{ color: "#A9863A" }}>
            Coaching for Good
          </p>
          <h1
            className="text-3xl md:text-4xl font-normal mb-2 leading-tight"
            style={{ color: "#1B2B4A", fontFamily: "'Playfair Display', serif" }}
          >
            Explore <em style={{ color: "#A9863A" }}>Skills</em>
          </h1>
          <p className="text-base" style={{ color: "#4A5568" }}>
            Find the perfect coach to help you unlock your next level.
          </p>
        </motion.div>
      </div>

      <div className="max-w-5xl mx-auto py-10">

        {/* ── SEARCH + FILTER ─────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="rounded-2xl p-4 mb-10 flex flex-col md:flex-row gap-3"
          style={{ background: "white", border: "1px solid rgba(200,169,81,0.2)", boxShadow: "0 2px 20px rgba(27,43,74,0.06)" }}
        >
          {/* Search */}
          <div className="relative flex-1">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
              <FiSearch style={{ color: "#C8A951" }} />
            </div>
            <input
              type="text"
              placeholder="Search skills or coaches..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-3 rounded-xl text-sm focus:outline-none transition-all duration-200"
              style={{
                background: "#FAF6EC",
                border: "1px solid rgba(200,169,81,0.25)",
                color: "#1B2B4A",
              }}
              onFocus={e => e.target.style.borderColor = "#C8A951"}
              onBlur={e => e.target.style.borderColor = "rgba(200,169,81,0.25)"}
            />
          </div>

          {/* Category pills */}
          <div className="flex gap-2 flex-wrap">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className="px-4 py-2 rounded-full text-xs font-semibold transition-all duration-200"
                style={{
                  background: selectedCategory === cat ? "#C8A951" : "rgba(200,169,81,0.08)",
                  color: selectedCategory === cat ? "#14213D" : "#A9863A",
                  border: `1px solid ${selectedCategory === cat ? "#C8A951" : "rgba(200,169,81,0.2)"}`,
                }}
              >
                {cat}
              </button>
            ))}
          </div>
        </motion.div>

        {/* ── RESULTS COUNT ────────────────────────────────── */}
        <div className="flex items-center justify-between mb-6">
          <p className="text-sm" style={{ color: "rgba(74,85,104,0.7)" }}>
            Showing <span className="font-semibold text-[#1B2B4A]">{skillsToDisplay.length}</span> skill{skillsToDisplay.length !== 1 ? "s" : ""}
            {searchQuery && <> for <span className="font-semibold text-[#C8A951]">"{searchQuery}"</span></>}
          </p>
          {(searchQuery || selectedCategory !== "All") && (
            <button
              onClick={() => { setSearchQuery(""); setSelectedCategory("All"); }}
              className="text-xs font-semibold transition-colors hover:text-[#C8A951]"
              style={{ color: "rgba(74,85,104,0.6)" }}
            >
              Clear filters ×
            </button>
          )}
        </div>

        {/* ── SKILLS GRID ──────────────────────────────────── */}
        <AnimatePresence mode="wait">
          {currentSkills.length > 0 ? (
            <motion.div
              key="grid"
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-10"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              {currentSkills.map((skill, i) => (
                <SkillCard key={skill.id} skill={skill} onBook={handleBookSession} index={i} />
              ))}
            </motion.div>
          ) : (
            <motion.div
              key="empty"
              className="text-center py-20"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              <p className="text-5xl mb-4">🔍</p>
              <p className="font-semibold text-[#1B2B4A] mb-2" style={{ fontFamily: "'Playfair Display', serif" }}>
                No skills found
              </p>
              <p className="text-sm text-[#4A5568] mb-6">Try a different search term or category.</p>
              <button
                onClick={() => { setSearchQuery(""); setSelectedCategory("All"); }}
                className="gold-btn px-6 py-2.5 rounded-full text-sm font-bold"
              >
                Clear filters
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── PAGINATION ───────────────────────────────────── */}
        {totalPages > 1 && (
          <div className="flex justify-center items-center gap-2 mb-12">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-200 disabled:opacity-40"
              style={{ background: "white", border: "1px solid rgba(200,169,81,0.3)", color: "#C8A951" }}
            >
              <FiChevronLeft />
            </button>
            {[...Array(totalPages).keys()].map(n => (
              <button
                key={n + 1}
                onClick={() => setCurrentPage(n + 1)}
                className="w-9 h-9 rounded-xl text-sm font-semibold transition-all duration-200"
                style={{
                  background: currentPage === n + 1 ? "#C8A951" : "white",
                  color: currentPage === n + 1 ? "#14213D" : "#4A5568",
                  border: `1px solid ${currentPage === n + 1 ? "#C8A951" : "rgba(200,169,81,0.3)"}`,
                }}
              >
                {n + 1}
              </button>
            ))}
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-200 disabled:opacity-40"
              style={{ background: "white", border: "1px solid rgba(200,169,81,0.3)", color: "#C8A951" }}
            >
              <FiChevronRight />
            </button>
          </div>
        )}

        {/* ── TOP RATED ─────────────────────────────────────── */}
        {topRated.length > 0 && (
          <section className="rounded-2xl p-8 mb-10" style={{ background: "#F3ECD9", border: "1px solid rgba(200,169,81,0.2)" }}>
            <div className="flex items-center justify-between mb-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: "#C8A951" }}>
                  Highest Rated
                </p>
                <h2 className="text-3xl font-normal text-[#1B2B4A]" style={{ fontFamily: "'Playfair Display', serif" }}>
                  Top Rated Skills
                </h2>
              </div>
              <button
                onClick={() => { setSearchQuery(""); setSelectedCategory("All"); setCurrentPage(1); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                className="text-xs font-semibold transition-colors hover:text-[#C8A951]"
                style={{ color: "rgba(74,85,104,0.7)" }}
              >
                View all →
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {topRated.map((skill, i) => (
                <SkillCard key={skill.id} skill={skill} onBook={handleBookSession} index={i} />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
};

export default SkillList;
