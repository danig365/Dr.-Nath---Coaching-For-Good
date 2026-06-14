import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { FiPlus, FiEdit2, FiTrash2, FiStar, FiDollarSign, FiUsers, FiToggleLeft, FiToggleRight } from "react-icons/fi";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "react-toastify";
import { api } from "../utils/auth";
import { useAuth } from "../context/AuthContext";

// ─── Stat Card ────────────────────────────────────────────────────────────────
const StatCard = ({ title, value, icon, bg = "#F3ECD9" }) => (
  <div className="rounded-2xl p-5" style={{ background: bg, border: "1px solid rgba(200,169,81,0.2)" }}>
    <div className="flex items-center gap-2 mb-2" style={{ color: "#C8A951" }}>
      {icon}
      <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "rgba(74,85,104,0.7)" }}>{title}</span>
    </div>
    <p className="text-3xl font-bold text-[#1B2B4A]" style={{ fontFamily: "'Playfair Display', serif" }}>{value}</p>
  </div>
);

// ─── Skill Card ───────────────────────────────────────────────────────────────
const SkillCard = ({ skill, onEdit, onDelete, onToggleActive, index }) => (
  <motion.div
    initial={{ opacity: 0, y: 16 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: -10 }}
    transition={{ duration: 0.3, delay: index * 0.04 }}
    className="rounded-2xl overflow-hidden"
    style={{ background: "white", border: "1px solid rgba(200,169,81,0.15)", boxShadow: "0 2px 16px rgba(27,43,74,0.05)" }}
  >
    {/* Gold accent top bar */}
    <div className="h-1" style={{ background: skill.active ? "linear-gradient(90deg,#C8A951,#F0D98C)" : "rgba(200,169,81,0.2)" }} />

    <div className="p-6 flex flex-col md:flex-row gap-6">
      {/* Left: info */}
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-start gap-3 mb-3">
          <h3 className="text-lg font-normal text-[#1B2B4A]" style={{ fontFamily: "'Playfair Display', serif" }}>
            {skill.name}
          </h3>
          {skill.active ? (
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background: "rgba(52,168,83,0.1)", color: "#2E7D32", border: "1px solid rgba(52,168,83,0.2)" }}>
              ✓ Active
            </span>
          ) : (
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background: "rgba(200,169,81,0.08)", color: "#A9863A", border: "1px solid rgba(200,169,81,0.2)" }}>
              Inactive
            </span>
          )}
          {skill.avg_rating !== null && skill.avg_rating !== undefined && (
            <span className="flex items-center gap-1 text-xs font-semibold" style={{ color: "#C8A951" }}>
              <FiStar className="fill-current" /> {parseFloat(skill.avg_rating).toFixed(1)}
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-2 mb-3">
          {skill.category && (
            <span className="text-xs px-2.5 py-1 rounded-full" style={{ background: "rgba(200,169,81,0.1)", color: "#A9863A", border: "1px solid rgba(200,169,81,0.2)" }}>
              {skill.category}
            </span>
          )}
          {skill.level && (
            <span className="text-xs px-2.5 py-1 rounded-full" style={{ background: "#F3ECD9", color: "#4A5568", border: "1px solid rgba(200,169,81,0.15)" }}>
              {skill.level}
            </span>
          )}
          <span className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-semibold" style={{ background: "#F3ECD9", color: "#A9863A", border: "1px solid rgba(200,169,81,0.2)" }}>
            <FiDollarSign size={11} />{skill.price}/hr
          </span>
        </div>

        {skill.description && (
          <p className="text-sm leading-relaxed mb-3 line-clamp-2" style={{ color: "#4A5568" }}>{skill.description}</p>
        )}

        {skill.tags?.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {skill.tags.map((tag, i) => (
              <span key={tag + i} className="text-xs px-2 py-0.5 rounded-md" style={{ background: "rgba(200,169,81,0.08)", color: "#A9863A" }}>
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Right: actions */}
      <div className="flex md:flex-col gap-2 md:w-36 shrink-0">
        <button
          onClick={onEdit}
          className="flex-1 md:flex-none flex items-center justify-center gap-2 px-3 py-2.5 rounded-full text-sm font-semibold transition-all duration-200"
          style={{ background: "rgba(200,169,81,0.1)", color: "#A9863A", border: "1px solid rgba(200,169,81,0.25)" }}
        >
          <FiEdit2 size={13} /> Edit
        </button>

        <button
          onClick={onToggleActive}
          className="flex-1 md:flex-none flex items-center justify-center gap-2 px-3 py-2.5 rounded-full text-sm font-semibold transition-all duration-200"
          style={skill.active
            ? { background: "rgba(239,68,68,0.08)", color: "#B91C1C", border: "1px solid rgba(239,68,68,0.2)" }
            : { background: "rgba(52,168,83,0.08)", color: "#2E7D32", border: "1px solid rgba(52,168,83,0.2)" }
          }
        >
          {skill.active ? <FiToggleRight size={13} /> : <FiToggleLeft size={13} />}
          {skill.active ? "Deactivate" : "Activate"}
        </button>

        <button
          onClick={onDelete}
          className="flex-1 md:flex-none flex items-center justify-center gap-2 px-3 py-2.5 rounded-full text-sm font-semibold transition-all duration-200"
          style={{ background: "rgba(239,68,68,0.08)", color: "#B91C1C", border: "1px solid rgba(239,68,68,0.2)" }}
        >
          <FiTrash2 size={13} /> Delete
        </button>
      </div>
    </div>
  </motion.div>
);

// ─── Confirm Modal ────────────────────────────────────────────────────────────
const ConfirmModal = ({ message, onConfirm, onCancel }) => (
  <motion.div
    className="fixed inset-0 z-50 flex items-center justify-center p-4"
    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
  >
    <motion.div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onCancel} />
    <motion.div
      className="relative rounded-2xl p-8 w-full max-w-sm text-center z-10"
      style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.2)" }}
      initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
    >
      <p className="text-4xl mb-4">🗑️</p>
      <h3 className="text-xl font-normal text-[#1B2B4A] mb-2" style={{ fontFamily: "'Playfair Display', serif" }}>Delete Skill</h3>
      <p className="text-sm text-[#4A5568] mb-6">{message}</p>
      <div className="flex gap-3">
        <button onClick={onCancel} className="flex-1 py-2.5 rounded-full text-sm font-semibold border transition-all" style={{ borderColor: "rgba(200,169,81,0.3)", color: "#4A5568" }}>
          Cancel
        </button>
        <button onClick={onConfirm} className="flex-1 py-2.5 rounded-full text-sm font-bold text-white transition-all" style={{ background: "#DC2626" }}>
          Delete
        </button>
      </div>
    </motion.div>
  </motion.div>
);

// ─── Main Component ───────────────────────────────────────────────────────────
const MySkills = () => {
  const [skills, setSkills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const navigate = useNavigate();
  const { isAuthenticated, isCoach, logout } = useAuth();

  const fetchSkills = useCallback(async () => {
    if (!isAuthenticated || !isCoach()) { logout(); return; }
    setLoading(true);
    try {
      const res = await api.get("/skills/");
      setSkills(res.data);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to load skills.");
      if (err.response?.status === 401) logout();
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, isCoach, logout]);

  useEffect(() => { fetchSkills(); }, [fetchSkills]);

  const handleDelete = async (id) => {
    try {
      await api.delete(`/skills/${id}/`);
      setSkills(s => s.filter(x => x.id !== id));
      toast.success("Skill deleted.");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to delete.");
    } finally {
      setDeleteTarget(null);
    }
  };

  const handleToggleActive = async (id) => {
    const skill = skills.find(s => s.id === id);
    if (!skill) return;
    try {
      const res = await api.patch(`/skills/${id}/`, { active: !skill.active });
      setSkills(s => s.map(x => x.id === id ? res.data : x));
      toast.success(`Skill ${res.data.active ? "activated" : "deactivated"}.`);
    } catch (err) {
      toast.error("Failed to update status.");
    }
  };

  const averageRate = skills.length > 0
    ? Math.round(skills.reduce((acc, s) => acc + parseFloat(s.price || 0), 0) / skills.length)
    : 0;

  if (loading) return (
    <div className="flex justify-center items-center min-h-screen" style={{ background: "#FAF6EC" }}>
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "#C8A951", borderTopColor: "transparent" }} />
        <p className="text-sm" style={{ color: "rgba(74,85,104,0.7)" }}>Loading skills...</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen pt-28 pb-16 px-6" style={{ background: "#FAF6EC" }}>
      <div className="max-w-5xl mx-auto">

        {/* ── Header ──────────────────────────────────────── */}
        <motion.div
          className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8"
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
        >
          <div>
            <h1 className="text-3xl md:text-4xl font-normal text-[#1B2B4A]" style={{ fontFamily: "'Playfair Display', serif" }}>My Skills</h1>
          </div>
          <motion.button
            whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
            onClick={() => navigate("/add-skill")}
            className="gold-btn flex items-center gap-2 px-5 py-3 rounded-full text-sm font-bold"
          >
            <FiPlus size={15} /> Add New Skill
          </motion.button>
        </motion.div>

        {/* ── Stats ───────────────────────────────────────── */}
        {skills.length > 0 && (
          <motion.div
            className="grid grid-cols-3 gap-4 mb-8"
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1 }}
          >
            <StatCard title="Total Skills" value={skills.length} icon={<FiUsers size={14} />} />
            <StatCard title="Active" value={skills.filter(s => s.active).length} icon={<FiStar size={14} />} bg="white" />
            <StatCard title="Avg. Rate" value={`$${averageRate}`} icon={<FiDollarSign size={14} />} bg="white" />
          </motion.div>
        )}

        {/* ── Skills List / Empty State ────────────────────── */}
        <AnimatePresence mode="wait">
          {skills.length === 0 ? (
            <motion.div
              key="empty"
              className="text-center py-20 rounded-2xl"
              style={{ background: "white", border: "1px solid rgba(200,169,81,0.15)" }}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            >
              <p className="text-5xl mb-4">🎯</p>
              <h2 className="text-2xl font-normal text-[#1B2B4A] mb-2" style={{ fontFamily: "'Playfair Display', serif" }}>
                No skills yet
              </h2>
              <p className="text-sm text-[#4A5568] mb-6">Add your first skill to start coaching clients.</p>
              <motion.button
                whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                onClick={() => navigate("/add-skill")}
                className="gold-btn inline-flex items-center gap-2 px-6 py-3 rounded-full text-sm font-bold"
              >
                <FiPlus size={15} /> Add Your First Skill
              </motion.button>
            </motion.div>
          ) : (
            <motion.div key="list" className="space-y-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              {skills.map((skill, i) => (
                <SkillCard
                  key={skill.id}
                  skill={skill}
                  index={i}
                  onEdit={() => navigate(`/skills/edit/${skill.id}`)}
                  onDelete={() => setDeleteTarget(skill)}
                  onToggleActive={() => handleToggleActive(skill.id)}
                />
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Delete Confirm Modal ─────────────────────────── */}
      <AnimatePresence>
        {deleteTarget && (
          <ConfirmModal
            message={`Are you sure you want to delete "${deleteTarget.name}"? This cannot be undone.`}
            onConfirm={() => handleDelete(deleteTarget.id)}
            onCancel={() => setDeleteTarget(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

export default MySkills;
