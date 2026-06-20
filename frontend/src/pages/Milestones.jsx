import { useEffect, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../utils/auth";
import { useAuth } from "../context/AuthContext";
import { toast } from "react-toastify";
import { motion, AnimatePresence } from "framer-motion";
import {
  FiTarget, FiPlus, FiCheck, FiTrash2, FiEdit2,
  FiCalendar, FiChevronLeft, FiX, FiFlag,
} from "react-icons/fi";

const GOLD = "#C8A951";
const DARK = "#1B2B4A";
const BROWN = "#4A5568";

function MilestoneCard({ m, role, onToggle, onDelete, onEdit }) {
  const overdue = !m.completed && m.due_date && new Date(m.due_date) < new Date();
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      className="rounded-2xl p-4 flex gap-4 items-start"
      style={{
        background: m.completed ? "rgba(52,168,83,0.04)" : "white",
        border: `1px solid ${m.completed ? "rgba(52,168,83,0.2)" : overdue ? "rgba(239,68,68,0.2)" : "rgba(200,169,81,0.15)"}`,
      }}
    >
      {/* Checkbox */}
      <button
        onClick={() => onToggle(m)}
        className="mt-0.5 w-6 h-6 rounded-lg flex items-center justify-center shrink-0 transition-all"
        style={{
          background: m.completed ? "#34A853" : "transparent",
          border: `2px solid ${m.completed ? "#34A853" : "rgba(74,85,104,0.4)"}`,
        }}
        title={role === "client" ? (m.completed ? "Mark incomplete" : "Mark complete") : "Only clients can toggle"}
        disabled={role !== "client"}
      >
        {m.completed && <FiCheck size={13} color="white" strokeWidth={3} />}
      </button>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className={`font-semibold text-sm ${m.completed ? "line-through" : ""}`}
          style={{ color: m.completed ? "rgba(74,85,104,0.55)" : DARK }}>
          {m.title}
        </p>
        {m.description && (
          <p className="text-xs mt-1 leading-relaxed" style={{ color: "rgba(74,85,104,0.7)" }}>{m.description}</p>
        )}
        <div className="flex flex-wrap gap-3 mt-2">
          {m.due_date && (
            <span className="flex items-center gap-1 text-xs"
              style={{ color: overdue ? "#EF4444" : "rgba(74,85,104,0.6)" }}>
              <FiCalendar size={11} />
              {overdue && !m.completed ? "Overdue · " : ""}{m.due_date}
            </span>
          )}
          {m.completed && m.completed_at && (
            <span className="text-xs" style={{ color: "#34A853" }}>
              ✓ Completed {new Date(m.completed_at).toLocaleDateString()}
            </span>
          )}
          {role === "coach" && (
            <span className="text-xs px-2 py-0.5 rounded-full"
              style={{ background: "rgba(200,169,81,0.1)", color: "#A9863A" }}>
              {m.client}
            </span>
          )}
          {role === "client" && (
            <span className="text-xs px-2 py-0.5 rounded-full"
              style={{ background: "rgba(200,169,81,0.1)", color: "#A9863A" }}>
              from {m.coach}
            </span>
          )}
        </div>
      </div>

      {/* Coach actions */}
      {role === "coach" && (
        <div className="flex gap-1.5 shrink-0">
          <button onClick={() => onEdit(m)}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-all hover:bg-amber-50"
            style={{ color: "rgba(74,85,104,0.55)" }}>
            <FiEdit2 size={13} />
          </button>
          <button onClick={() => onDelete(m.id)}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-all hover:bg-red-50"
            style={{ color: "rgba(239,68,68,0.5)" }}>
            <FiTrash2 size={13} />
          </button>
        </div>
      )}
    </motion.div>
  );
}

function AddEditModal({ onClose, onSave, clients, initial }) {
  const isEdit = !!initial;
  const [title, setTitle] = useState(initial?.title || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [dueDate, setDueDate] = useState(initial?.due_date || "");
  const [clientId, setClientId] = useState(initial?.client_id?.toString() || "");
  const [saving, setSaving] = useState(false);

  const inputStyle = {
    background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.3)",
    color: DARK, borderRadius: 12, fontSize: 14,
  };

  const handleSave = async () => {
    if (!title.trim()) { toast.error("Title is required."); return; }
    if (!isEdit && !clientId) { toast.error("Select a client."); return; }
    setSaving(true);
    await onSave({ title, description, due_date: dueDate || null, client_id: clientId });
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(20,33,61,0.6)" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md rounded-2xl p-6 shadow-2xl"
        style={{ background: "white" }}>
        <div className="flex items-center justify-between mb-5">
          <p className="font-normal text-xl" style={{ color: DARK, fontFamily: "'Playfair Display', serif" }}>
            {isEdit ? "Edit Milestone" : "New Milestone"}
          </p>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: "rgba(27,43,74,0.06)", color: BROWN }}>
            <FiX size={14} />
          </button>
        </div>

        <div className="space-y-4">
          {!isEdit && (
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider block mb-1.5" style={{ color: "rgba(74,85,104,0.6)" }}>Client</label>
              <select value={clientId} onChange={e => setClientId(e.target.value)}
                className="w-full px-4 py-2.5 focus:outline-none" style={inputStyle}>
                <option value="">Select client…</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.username}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider block mb-1.5" style={{ color: "rgba(74,85,104,0.6)" }}>Title *</label>
            <input value={title} onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Complete 3 networking conversations"
              className="w-full px-4 py-2.5 focus:outline-none" style={inputStyle} />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider block mb-1.5" style={{ color: "rgba(74,85,104,0.6)" }}>Description</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)}
              rows={3} placeholder="Optional details…"
              className="w-full px-4 py-2.5 focus:outline-none resize-none" style={inputStyle} />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider block mb-1.5" style={{ color: "rgba(74,85,104,0.6)" }}>Due Date</label>
            <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
              className="w-full px-4 py-2.5 focus:outline-none" style={inputStyle} />
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-full text-sm font-semibold"
            style={{ background: "rgba(27,43,74,0.06)", color: BROWN }}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 py-2.5 rounded-full text-sm font-bold transition-all"
            style={{ background: GOLD, color: "#14213D", opacity: saving ? 0.7 : 1 }}>
            {saving ? "Saving…" : isEdit ? "Save Changes" : "Create"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

export default function Milestones() {
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const role = user?.role;

  const [milestones, setMilestones] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // null | { mode: 'add' | 'edit', data?: milestone }
  const [filter, setFilter] = useState("all"); // all | pending | completed | overdue
  const [clientFilter, setClientFilter] = useState("all");

  useEffect(() => {
    if (!isAuthenticated) { navigate("/login"); return; }
  }, []);

  const fetchMilestones = useCallback(async () => {
    try {
      const res = await api.get("/bookings/milestones/");
      setMilestones(res.data);
    } catch { toast.error("Failed to load milestones."); }
  }, []);

  const fetchClients = useCallback(async () => {
    if (role !== "coach") return;
    try {
      // Get distinct clients from bookings
      const res = await api.get("/bookings/");
      const seen = new Map();
      res.data.forEach(b => {
        if (b.learner_id && !seen.has(b.learner_id)) {
          seen.set(b.learner_id, { id: b.learner_id, username: b.learner_username || b.learner_name || `Client #${b.learner_id}` });
        }
      });
      setClients([...seen.values()]);
    } catch { /* non-critical */ }
  }, [role]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await Promise.all([fetchMilestones(), fetchClients()]);
      setLoading(false);
    };
    load();
  }, []);

  const handleToggle = async (m) => {
    if (role !== "client") return;
    try {
      const res = await api.patch(`/bookings/milestones/${m.id}/`, { completed: !m.completed });
      setMilestones(prev => prev.map(x => x.id === m.id ? res.data : x));
      toast.success(res.data.completed ? "Milestone completed! 🎉" : "Marked as incomplete.");
    } catch { toast.error("Failed to update."); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this milestone?")) return;
    try {
      await api.delete(`/bookings/milestones/${id}/`);
      setMilestones(prev => prev.filter(m => m.id !== id));
      toast.success("Milestone deleted.");
    } catch { toast.error("Failed to delete."); }
  };

  const handleSave = async ({ title, description, due_date, client_id }) => {
    try {
      if (modal.mode === "add") {
        const res = await api.post("/bookings/milestones/", { title, description, due_date, client_id });
        setMilestones(prev => [res.data, ...prev]);
        toast.success("Milestone created.");
      } else {
        const res = await api.patch(`/bookings/milestones/${modal.data.id}/`, { title, description, due_date });
        setMilestones(prev => prev.map(m => m.id === modal.data.id ? res.data : m));
        toast.success("Milestone updated.");
      }
      setModal(null);
    } catch { toast.error("Failed to save milestone."); }
  };

  // Filters
  const now = new Date();
  const uniqueClients = [...new Set(milestones.map(m => role === "coach" ? m.client : m.coach))];

  const filtered = milestones.filter(m => {
    const matchStatus =
      filter === "all" ? true :
      filter === "completed" ? m.completed :
      filter === "pending" ? !m.completed :
      filter === "overdue" ? (!m.completed && m.due_date && new Date(m.due_date) < now) : true;
    const matchClient =
      clientFilter === "all" ? true :
      role === "coach" ? m.client === clientFilter : m.coach === clientFilter;
    return matchStatus && matchClient;
  });

  const stats = {
    total: milestones.length,
    completed: milestones.filter(m => m.completed).length,
    overdue: milestones.filter(m => !m.completed && m.due_date && new Date(m.due_date) < now).length,
  };
  const pct = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;

  return (
    <div className="min-h-screen pt-36 pb-16 px-6" style={{ background: "#FAF6EC" }}>
      {/* Header */}
      <motion.div className="max-w-5xl mx-auto"
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: "easeOut" }}>
        <div className="flex items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0"
              style={{ background: "rgba(200,169,81,0.15)" }}>
              <FiTarget size={20} style={{ color: GOLD }} />
            </div>
            <div>
              <h1 className="text-3xl md:text-4xl font-normal" style={{ color: DARK, fontFamily: "'Playfair Display', serif" }}>
                Milestones &amp; Goals
              </h1>
            </div>
          </div>
          {role === "coach" && (
            <button onClick={() => setModal({ mode: "add" })}
              className="gold-btn flex items-center gap-2 px-5 py-3 rounded-full text-sm font-bold shrink-0">
              <FiPlus size={15} /> New Milestone
            </button>
          )}
        </div>

        {/* Progress bar */}
        {stats.total > 0 && (
          <div className="mt-6 p-4 rounded-2xl bg-white" style={{ border: "1px solid rgba(200,169,81,0.2)" }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold" style={{ color: DARK }}>{pct}% Complete</span>
              <span className="text-xs" style={{ color: BROWN }}>
                {stats.completed}/{stats.total} milestones
                {stats.overdue > 0 && <span className="ml-2" style={{ color: "#DC2626" }}>· {stats.overdue} overdue</span>}
              </span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: "rgba(200,169,81,0.15)" }}>
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.8, ease: "easeOut" }}
                className="h-full rounded-full"
                style={{ background: "linear-gradient(90deg, #C8A951, #34A853)" }}
              />
            </div>
          </div>
        )}
      </motion.div>

      <motion.div className="max-w-5xl mx-auto py-8"
        initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: "easeOut", delay: 0.1 }}>
        {/* Filters */}
        <div className="flex flex-wrap gap-2 mb-6">
          {[
            { key: "all", label: `All (${stats.total})` },
            { key: "pending", label: `Pending (${stats.total - stats.completed})` },
            { key: "completed", label: `Completed (${stats.completed})` },
            { key: "overdue", label: `Overdue (${stats.overdue})`, danger: true },
          ].map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className="px-3 py-1.5 rounded-full text-xs font-semibold transition-all"
              style={{
                background: filter === f.key
                  ? (f.danger ? "rgba(239,68,68,0.12)" : GOLD)
                  : "white",
                color: filter === f.key
                  ? (f.danger ? "#B91C1C" : "#14213D")
                  : BROWN,
                border: `1px solid ${filter === f.key
                  ? (f.danger ? "rgba(239,68,68,0.25)" : GOLD)
                  : "rgba(200,169,81,0.2)"}`,
              }}>
              {f.label}
            </button>
          ))}
          {uniqueClients.length > 1 && (
            <select value={clientFilter} onChange={e => setClientFilter(e.target.value)}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold focus:outline-none"
              style={{ background: "white", color: BROWN, border: "1px solid rgba(200,169,81,0.2)" }}>
              <option value="all">{role === "coach" ? "All Clients" : "All Coaches"}</option>
              {uniqueClients.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
        </div>

        {/* List */}
        {loading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-20 rounded-2xl animate-pulse"
                style={{ background: "rgba(200,169,81,0.08)" }} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="text-center py-20 rounded-2xl"
            style={{ background: "white", border: "1px solid rgba(200,169,81,0.15)" }}>
            <p className="text-5xl mb-3"><FiFlag style={{ display: "inline", color: "rgba(200,169,81,0.3)" }} /></p>
            <p className="font-normal text-xl mb-1" style={{ color: DARK, fontFamily: "'Playfair Display', serif" }}>
              {filter === "all" && stats.total === 0
                ? role === "coach" ? "No milestones yet" : "No goals assigned yet"
                : "No milestones match this filter"}
            </p>
            <p className="text-sm" style={{ color: "rgba(74,85,104,0.6)" }}>
              {role === "coach" && filter === "all"
                ? "Create milestones to track your clients' progress toward their goals."
                : "Try a different filter or check back later."}
            </p>
            {role === "coach" && filter === "all" && stats.total === 0 && (
              <button onClick={() => setModal({ mode: "add" })}
                className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-bold"
                style={{ background: GOLD, color: "#14213D" }}>
                <FiPlus size={14} /> Create First Milestone
              </button>
            )}
          </motion.div>
        ) : (
          <div className="space-y-3">
            <AnimatePresence>
              {filtered.map(m => (
                <MilestoneCard key={m.id} m={m} role={role}
                  onToggle={handleToggle}
                  onDelete={handleDelete}
                  onEdit={(m) => setModal({ mode: "edit", data: m })}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </motion.div>

      {/* Modal */}
      <AnimatePresence>
        {modal && (
          <AddEditModal
            onClose={() => setModal(null)}
            onSave={handleSave}
            clients={clients}
            initial={modal.data}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
