import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../utils/auth";
import { useAuth } from "../context/AuthContext";
import { FiPlus, FiX, FiDollarSign, FiArrowLeft, FiTag, FiBookOpen, FiLayers } from "react-icons/fi";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "react-toastify";

const SKILL_LEVELS = ["beginner", "intermediate", "advanced", "expert"];
const CATEGORIES = ["Programming", "Design", "Business", "Marketing", "Data Science", "Career Growth", "Leadership", "Other"];

// ─── Field Label ──────────────────────────────────────────────────────────────
const FieldLabel = ({ icon: Icon, children, required }) => (
  <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "rgba(74,85,104,0.7)" }}>
    {Icon && <Icon size={11} style={{ color: "#C8A951" }} />}
    {children}
    {required && <span style={{ color: "#C8A951" }}>*</span>}
  </label>
);

// ─── Gold Input ───────────────────────────────────────────────────────────────
const GoldInput = ({ ...props }) => (
  <input
    {...props}
    className="w-full px-4 py-3 rounded-xl text-sm focus:outline-none transition-all duration-200"
    style={{ background: "white", border: "1px solid rgba(200,169,81,0.3)", color: "#1B2B4A" }}
    onFocus={e => e.target.style.borderColor = "#C8A951"}
    onBlur={e => e.target.style.borderColor = "rgba(200,169,81,0.3)"}
  />
);

// ─── Gold Select ──────────────────────────────────────────────────────────────
const GoldSelect = ({ children, ...props }) => (
  <div className="relative">
    <select
      {...props}
      className="w-full px-4 py-3 pr-10 rounded-xl text-sm appearance-none focus:outline-none transition-all duration-200"
      style={{ background: "white", border: "1px solid rgba(200,169,81,0.3)", color: "#1B2B4A" }}
      onFocus={e => e.target.style.borderColor = "#C8A951"}
      onBlur={e => e.target.style.borderColor = "rgba(200,169,81,0.3)"}
    >
      {children}
    </select>
    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-xs" style={{ color: "#C8A951" }}>▾</div>
  </div>
);

// ─── Level Selector ───────────────────────────────────────────────────────────
const LevelSelector = ({ value, onChange }) => (
  <div className="grid grid-cols-4 gap-2">
    {SKILL_LEVELS.map(l => (
      <button
        key={l}
        type="button"
        onClick={() => onChange(l)}
        className="py-2.5 rounded-full text-xs font-semibold capitalize transition-all duration-200"
        style={{
          background: value === l ? "#C8A951" : "white",
          color: value === l ? "#14213D" : "#4A5568",
          border: `1px solid ${value === l ? "#C8A951" : "rgba(200,169,81,0.25)"}`,
        }}
      >
        {l}
      </button>
    ))}
  </div>
);

// ─── Main Component ───────────────────────────────────────────────────────────
const AddSkill = () => {
  const [form, setForm] = useState({
    name: "",
    description: "",
    level: "intermediate",
    category: "",
    price: "",
    tags: [],
    currentTag: "",
  });
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { isAuthenticated, isCoach, logout } = useAuth();

  useEffect(() => {
    if (!isAuthenticated || !isCoach()) logout();
  }, [isAuthenticated, isCoach, logout]);

  const handleChange = e => setForm(f => ({ ...f, [e.target.name]: e.target.value }));

  const handleTagAdd = () => {
    const tag = form.currentTag.trim();
    if (tag && !form.tags.includes(tag)) {
      setForm(f => ({ ...f, tags: [...f.tags, tag], currentTag: "" }));
    }
  };

  const handleTagRemove = tag => setForm(f => ({ ...f, tags: f.tags.filter(t => t !== tag) }));

  const handleSubmit = async e => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post("/skills/", {
        name: form.name,
        description: form.description,
        level: form.level,
        category: form.category,
        price: Number(form.price),
        tags: form.tags,
      });
      toast.success("Skill added successfully!");
      navigate("/my-skills");
    } catch (error) {
      const errorData = error.response?.data;
      if (errorData) {
        Object.keys(errorData).forEach(key => {
          const msg = Array.isArray(errorData[key]) ? errorData[key][0] : errorData[key];
          toast.error(`${key.charAt(0).toUpperCase() + key.slice(1)}: ${msg}`);
        });
      } else {
        toast.error("Failed to add skill. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  // Estimated earnings preview
  const estimatedMonthly = form.price
    ? (parseFloat(form.price) * 10).toFixed(0)
    : null;

  return (
    <div className="min-h-screen pt-36 pb-16 px-4" style={{ background: "#FAF6EC" }}>
      <div className="max-w-2xl mx-auto">

        {/* ── Back link ─────────────────────────────────── */}
        <motion.button
          onClick={() => navigate("/my-skills")}
          className="flex items-center gap-2 text-sm font-medium mb-6"
          style={{ color: "#A9863A" }}
          whileHover={{ x: -3 }}
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
        >
        </motion.button>

        <motion.div
          className="rounded-2xl overflow-hidden"
          style={{ background: "white", border: "1px solid rgba(200,169,81,0.15)", boxShadow: "0 4px 32px rgba(27,43,74,0.07)" }}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          {/* Card Header */}
          <div className="px-8 pt-8 pb-6" style={{ background: "linear-gradient(135deg, #1B2B4A, #14213D)" }}>
            <h1 className="text-3xl font-normal text-white" style={{ fontFamily: "'Playfair Display', serif" }}>
              Add a New Skill
            </h1>
            <p className="text-sm mt-1" style={{ color: "rgba(255,255,255,0.55)" }}>
              Share your expertise and start earning.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="px-8 py-8 space-y-6">

            {/* Skill Name */}
            <div>
              <FieldLabel icon={FiBookOpen} required>Skill Name</FieldLabel>
              <GoldInput
                name="name"
                value={form.name}
                onChange={handleChange}
                placeholder="e.g. Executive Communication, Advanced React"
                required
              />
            </div>

            {/* Category + Level */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <FieldLabel icon={FiLayers} required>Category</FieldLabel>
                <GoldSelect name="category" value={form.category} onChange={handleChange} required>
                  <option value="">Select a category</option>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </GoldSelect>
              </div>

              <div>
                <FieldLabel icon={FiDollarSign} required>Hourly Rate (USD)</FieldLabel>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold pointer-events-none" style={{ color: "#C8A951" }}>$</span>
                  <input
                    type="number"
                    name="price"
                    value={form.price}
                    onChange={handleChange}
                    placeholder="50"
                    min="1"
                    required
                    className="w-full pl-8 pr-4 py-3 rounded-xl text-sm focus:outline-none transition-all duration-200"
                    style={{ background: "white", border: "1px solid rgba(200,169,81,0.3)", color: "#1B2B4A" }}
                    onFocus={e => e.target.style.borderColor = "#C8A951"}
                    onBlur={e => e.target.style.borderColor = "rgba(200,169,81,0.3)"}
                  />
                </div>
                {estimatedMonthly && (
                  <p className="text-xs mt-1.5" style={{ color: "#A9863A" }}>
                    ≈ ${estimatedMonthly}/mo at 10 sessions
                  </p>
                )}
              </div>
            </div>

            {/* Skill Level */}
            <div>
              <FieldLabel required>Experience Level</FieldLabel>
              <LevelSelector value={form.level} onChange={level => setForm(f => ({ ...f, level }))} />
            </div>

            {/* Tags */}
            <div>
              <FieldLabel icon={FiTag}>Topics Covered</FieldLabel>
              <div className="flex gap-2">
                <input
                  value={form.currentTag}
                  onChange={e => setForm(f => ({ ...f, currentTag: e.target.value }))}
                  onKeyDown={e => e.key === "Enter" && (e.preventDefault(), handleTagAdd())}
                  placeholder="e.g. Hooks, Leadership, Branding"
                  className="flex-1 px-4 py-3 rounded-xl text-sm focus:outline-none transition-all duration-200"
                  style={{ background: "white", border: "1px solid rgba(200,169,81,0.3)", color: "#1B2B4A" }}
                  onFocus={e => e.target.style.borderColor = "#C8A951"}
                  onBlur={e => e.target.style.borderColor = "rgba(200,169,81,0.3)"}
                />
                <motion.button
                  type="button"
                  onClick={handleTagAdd}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className="px-4 py-3 rounded-xl font-bold text-sm transition-all"
                  style={{ background: "#C8A951", color: "#14213D" }}
                >
                  <FiPlus size={16} />
                </motion.button>
              </div>

              <AnimatePresence>
                {form.tags.length > 0 && (
                  <motion.div
                    className="flex flex-wrap gap-2 mt-3"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                  >
                    {form.tags.map(tag => (
                      <motion.span
                        key={tag}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold"
                        style={{ background: "rgba(200,169,81,0.12)", color: "#A9863A", border: "1px solid rgba(200,169,81,0.25)" }}
                        initial={{ opacity: 0, scale: 0.85 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.85 }}
                        transition={{ duration: 0.15 }}
                      >
                        {tag}
                        <button
                          type="button"
                          onClick={() => handleTagRemove(tag)}
                          className="rounded-full transition-opacity hover:opacity-60"
                          style={{ color: "#A9863A" }}
                        >
                          <FiX size={11} />
                        </button>
                      </motion.span>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Description */}
            <div>
              <FieldLabel icon={FiBookOpen} required>Description</FieldLabel>
              <textarea
                name="description"
                value={form.description}
                onChange={handleChange}
                rows={5}
                placeholder="What will learners gain? Describe what you cover, your approach, and who this is for..."
                required
                className="w-full px-4 py-3 rounded-xl text-sm resize-none focus:outline-none transition-all duration-200"
                style={{ background: "white", border: "1px solid rgba(200,169,81,0.3)", color: "#1B2B4A" }}
                onFocus={e => e.target.style.borderColor = "#C8A951"}
                onBlur={e => e.target.style.borderColor = "rgba(200,169,81,0.3)"}
              />
              <p className="text-xs mt-1.5" style={{ color: "rgba(74,85,104,0.6)" }}>
                Visible to all learners browsing the directory.
              </p>
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => navigate("/my-skills")}
                className="flex-1 py-3 rounded-full text-sm font-semibold border transition-all"
                style={{ borderColor: "rgba(200,169,81,0.3)", color: "#4A5568", background: "transparent" }}
              >
                Cancel
              </button>
              <motion.button
                type="submit"
                disabled={loading}
                whileHover={!loading ? { scale: 1.02 } : {}}
                whileTap={!loading ? { scale: 0.97 } : {}}
                className="flex-1 gold-btn py-3 rounded-full text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 rounded-full border-2 animate-spin" style={{ borderColor: "#14213D", borderTopColor: "transparent" }} />
                    Saving...
                  </>
                ) : (
                  <><FiPlus size={14} /> Add Skill</>
                )}
              </motion.button>
            </div>
          </form>
        </motion.div>
      </div>
    </div>
  );
};

export default AddSkill;
