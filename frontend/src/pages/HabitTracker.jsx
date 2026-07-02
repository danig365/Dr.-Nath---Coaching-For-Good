import { useEffect, useState, useCallback } from "react";
import { api } from "../utils/auth";
import { useAuth } from "../context/AuthContext";
import { toast } from "react-toastify";
import { motion, AnimatePresence } from "framer-motion";
import { FiActivity, FiCheck, FiZap, FiPlus, FiEdit2, FiTrash2, FiArchive, FiRotateCcw, FiX } from "react-icons/fi";

const GOLD = "#C8A951";
const DARK = "#1B2B4A";
const BROWN = "#4A5568";

const isoDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const last7Days = () => {
  const today = new Date();
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - (6 - i));
    return d;
  });
};

const WEEKDAY = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function HabitCard({ habit, readOnly, onToggleDay, onEdit, onArchive, onDelete }) {
  const dates = last7Days();
  const todayIso = isoDate(new Date());
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      className="rounded-2xl p-5"
      style={{
        background: habit.active === false ? "rgba(74,85,104,0.04)" : "white",
        border: "1px solid rgba(200,169,81,0.15)",
        boxShadow: "0 2px 12px rgba(27,43,74,0.04)",
        opacity: habit.active === false ? 0.7 : 1,
      }}
    >
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-lg font-normal" style={{ color: DARK, fontFamily: "'Playfair Display', serif" }}>{habit.title}</h3>
            {habit.active === false && (
              <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full" style={{ background: "rgba(74,85,104,0.1)", color: BROWN }}>Archived</span>
            )}
          </div>
          {habit.description && <p className="text-sm mt-0.5" style={{ color: BROWN }}>{habit.description}</p>}
          {readOnly && <p className="text-xs mt-1" style={{ color: "rgba(74,85,104,0.6)" }}>for {habit.client}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full"
            style={{ background: "rgba(200,169,81,0.12)", color: "#A9863A" }} title="Current streak">
            <FiZap size={12} /> {habit.streak}d
          </span>
          <span className="text-xs font-bold px-2.5 py-1 rounded-full"
            style={{ background: "rgba(52,168,83,0.1)", color: "#2E7D32" }} title="30-day consistency">
            {habit.consistency}%
          </span>
        </div>
      </div>

      {/* 7-day grid */}
      <div className="flex items-end justify-between gap-2">
        {dates.map((d) => {
          const iso = isoDate(d);
          const done = habit.check_in_dates.includes(iso);
          const isToday = iso === todayIso;
          const cell = (
            <span
              className="w-full aspect-square max-w-[40px] rounded-xl flex items-center justify-center transition-all"
              style={
                done
                  ? { background: "linear-gradient(135deg,#C8A951,#F0D98C)", color: "#14213D" }
                  : { background: "#FAF6EC", border: `1px solid ${isToday ? GOLD : "rgba(200,169,81,0.25)"}`, color: "rgba(74,85,104,0.4)" }
              }
            >
              {done ? <FiCheck size={16} /> : <span className="text-xs font-semibold">{d.getDate()}</span>}
            </span>
          );
          return (
            <div key={iso} className="flex flex-col items-center gap-1.5 flex-1">
              <span className="text-[10px] font-semibold" style={{ color: isToday ? GOLD : "rgba(74,85,104,0.6)" }}>{WEEKDAY[d.getDay()]}</span>
              {readOnly
                ? <div className="w-full flex justify-center" title={d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}>{cell}</div>
                : <button onClick={() => onToggleDay(habit, d)} className="w-full flex justify-center" title={d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}>{cell}</button>}
            </div>
          );
        })}
      </div>

      {readOnly && (
        <div className="flex items-center gap-2 mt-4 pt-4" style={{ borderTop: "1px solid rgba(200,169,81,0.12)" }}>
          {habit.active !== false && (
            <button onClick={() => onEdit(habit)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold" style={{ background: "rgba(200,169,81,0.12)", color: "#A9863A" }}>
              <FiEdit2 size={12} /> Edit
            </button>
          )}
          <button onClick={() => onArchive(habit)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold" style={{ background: "rgba(27,43,74,0.06)", color: DARK }}>
            {habit.active === false ? <><FiRotateCcw size={12} /> Unarchive</> : <><FiArchive size={12} /> Archive</>}
          </button>
          <button onClick={() => onDelete(habit)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold ml-auto" style={{ background: "rgba(239,68,68,0.08)", color: "#B91C1C" }}>
            <FiTrash2 size={12} /> Delete
          </button>
        </div>
      )}
    </motion.div>
  );
}

function HabitModal({ initial, onClose, onSave }) {
  const isEdit = !!initial?.id;
  const [title, setTitle] = useState(initial?.title || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!title.trim()) { toast.error("Title is required."); return; }
    setSaving(true);
    try {
      await onSave({ title: title.trim(), description: description.trim() });
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0" style={{ background: "rgba(20,33,61,0.6)" }} onClick={onClose} />
      <motion.form onSubmit={submit} initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        className="relative w-full max-w-md rounded-2xl p-6 z-10" style={{ background: "white" }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-normal text-xl" style={{ color: DARK, fontFamily: "'Playfair Display', serif" }}>{isEdit ? "Edit habit" : "New habit"}</h3>
          <button type="button" onClick={onClose} className="p-1.5 rounded-full" style={{ background: "rgba(27,43,74,0.06)", color: BROWN }}><FiX size={16} /></button>
        </div>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Meditate 10 minutes"
          className="w-full px-4 py-2.5 rounded-xl text-sm mb-3 focus:outline-none" style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.3)", color: DARK }} />
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional details…" rows={3}
          className="w-full px-4 py-2.5 rounded-xl text-sm mb-5 resize-none focus:outline-none" style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.3)", color: DARK }} />
        <div className="flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold" style={{ background: "rgba(27,43,74,0.06)", color: BROWN }}>Cancel</button>
          <button type="submit" disabled={saving} className="flex-1 py-2.5 rounded-xl text-sm font-bold disabled:opacity-60" style={{ background: GOLD, color: "#14213D" }}>
            {saving ? "Saving…" : isEdit ? "Save" : "Create"}
          </button>
        </div>
      </motion.form>
    </motion.div>
  );
}

const HabitTracker = () => {
  const { isAuthenticated, isCoach, logout } = useAuth();
  const coach = isCoach();
  const [habits, setHabits] = useState([]);
  const [loading, setLoading] = useState(true);
  // Coach-only state
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState("");
  const [modal, setModal] = useState({ open: false, data: null });

  const fetchClients = useCallback(async () => {
    try {
      const res = await api.get("/bookings/");
      const seen = new Map();
      (res.data || []).forEach((b) => {
        const id = b.learner; // booking serializer exposes the learner PK as `learner`
        if (id && !seen.has(id)) {
          seen.set(id, { id, username: b.learner_name || b.learner_username || `Client #${id}` });
        }
      });
      setClients([...seen.values()]);
    } catch { /* non-critical */ }
  }, []);

  const fetchHabits = useCallback(async (cid) => {
    setLoading(true);
    try {
      let url = "/bookings/habits/";
      if (coach) url += `?include_archived=1${cid ? `&client_id=${cid}` : ""}`;
      const res = await api.get(url);
      setHabits(res.data);
    } catch {
      toast.error("Failed to load habits.");
    } finally {
      setLoading(false);
    }
  }, [coach]);

  useEffect(() => {
    if (!isAuthenticated) { logout(); return; }
    if (coach) { fetchClients(); fetchHabits(""); }
    else { fetchHabits(); }
  }, [isAuthenticated, coach, logout, fetchClients, fetchHabits]);

  const onClientChange = (cid) => { setClientId(cid); fetchHabits(cid); };

  const toggleDay = async (habit, dateObj) => {
    const iso = isoDate(dateObj);
    const done = !habit.check_in_dates.includes(iso);
    try {
      const res = await api.post(`/bookings/habits/${habit.id}/check-in/`, { date: iso, done });
      setHabits((hs) => hs.map((h) => (h.id === habit.id ? res.data : h)));
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to update check-in.");
    }
  };

  const saveHabit = async ({ title, description }) => {
    try {
      if (modal.data?.id) {
        const res = await api.patch(`/bookings/habits/${modal.data.id}/`, { title, description });
        setHabits((hs) => hs.map((h) => (h.id === modal.data.id ? res.data : h)));
      } else {
        if (!clientId) { toast.error("Select a client first."); return; }
        const res = await api.post("/bookings/habits/", { client_id: clientId, title, description });
        setHabits((hs) => [res.data, ...hs]);
      }
      setModal({ open: false, data: null });
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to save habit.");
    }
  };

  const archiveHabit = async (habit) => {
    try {
      const res = await api.patch(`/bookings/habits/${habit.id}/`, { active: habit.active === false });
      setHabits((hs) => hs.map((h) => (h.id === habit.id ? res.data : h)));
    } catch { toast.error("Failed to update habit."); }
  };

  const deleteHabit = async (habit) => {
    if (!window.confirm(`Delete "${habit.title}"? This removes all its check-in history.`)) return;
    try {
      await api.delete(`/bookings/habits/${habit.id}/`);
      setHabits((hs) => hs.filter((h) => h.id !== habit.id));
    } catch { toast.error("Failed to delete habit."); }
  };

  if (loading) return (
    <div className="flex justify-center items-center min-h-screen" style={{ background: "#FAF6EC" }}>
      <div className="w-10 h-10 rounded-full border-2 animate-spin" style={{ borderColor: GOLD, borderTopColor: "transparent" }} />
    </div>
  );

  return (
    <div className="min-h-screen pt-36 pb-16 px-6" style={{ background: "#FAF6EC" }}>
      <div className="max-w-3xl mx-auto">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mb-8 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: GOLD }}>Accountability</p>
            <h1 className="text-3xl font-normal" style={{ color: DARK, fontFamily: "'Playfair Display', serif" }}>{coach ? "Habit Tracker" : "Daily Habits"}</h1>
            <p className="text-sm mt-1" style={{ color: BROWN }}>
              {coach ? "Assign daily habits and track each client's consistency." : "Tap a day to log it. Keep your streak alive between sessions."}
            </p>
          </div>
          {coach && (
            <button onClick={() => setModal({ open: true, data: null })}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-bold shrink-0" style={{ background: GOLD, color: "#14213D" }}>
              <FiPlus size={14} /> New habit
            </button>
          )}
        </motion.div>

        {coach && (
          <div className="mb-6">
            <select value={clientId} onChange={(e) => onClientChange(e.target.value)}
              className="w-full sm:w-auto px-4 py-2.5 rounded-xl text-sm focus:outline-none" style={{ background: "white", border: "1px solid rgba(200,169,81,0.3)", color: DARK }}>
              <option value="">All clients</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.username}</option>)}
            </select>
          </div>
        )}

        {habits.length === 0 ? (
          <div className="text-center py-20 rounded-2xl" style={{ background: "white", border: "1px dashed rgba(200,169,81,0.3)" }}>
            <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: "rgba(200,169,81,0.12)" }}>
              <FiActivity size={22} style={{ color: GOLD }} />
            </div>
            <h3 className="text-lg font-normal mb-1" style={{ color: DARK, fontFamily: "'Playfair Display', serif" }}>No habits yet</h3>
            <p className="text-sm" style={{ color: BROWN }}>
              {coach ? "Select a client and create a habit to get them started." : "Your coach will assign habits to help you build momentum."}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <AnimatePresence>
              {habits.map((h) => (
                <HabitCard key={h.id} habit={h} readOnly={coach}
                  onToggleDay={toggleDay} onEdit={(hb) => setModal({ open: true, data: hb })}
                  onArchive={archiveHabit} onDelete={deleteHabit} />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      <AnimatePresence>
        {modal.open && <HabitModal initial={modal.data} onClose={() => setModal({ open: false, data: null })} onSave={saveHabit} />}
      </AnimatePresence>
    </div>
  );
};

export default HabitTracker;
