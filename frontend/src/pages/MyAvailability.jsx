import { useState, useEffect, useCallback, useMemo } from "react";
import { FiPlus, FiTrash2, FiClock, FiCalendar, FiZap, FiLock, FiUnlock, FiGlobe, FiSettings, FiFilter, FiChevronLeft, FiChevronRight, FiChevronDown, FiUsers, FiVideo, FiXCircle, FiMessageSquare } from "react-icons/fi";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "react-toastify";
import { useNavigate } from "react-router-dom";
import { api } from "../utils/auth";
import { useAuth } from "../context/AuthContext";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DURATIONS = [15, 30, 45, 60]; // 60 min is the maximum slot length
const COMMON_TZS = [
  "UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "Europe/London", "Europe/Paris", "Europe/Berlin", "Asia/Dubai", "Asia/Karachi",
  "Asia/Kolkata", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney",
];

const card = { background: "white", border: "1px solid rgba(200,169,81,0.15)", boxShadow: "0 2px 16px rgba(27,43,74,0.05)" };
const inputStyle = { background: "#FAF6EC", border: "1px solid rgba(27,43,74,0.2)", color: "#1B2B4A" };
const serif = { fontFamily: "'Playfair Display', serif" };

const fmtTime = (iso, tz) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: tz || undefined });
const fmtDateShort = (iso, tz) => new Date(iso).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: tz || undefined });
const SLOTS_PER_PAGE = 12;
const RULES_PER_PAGE = 6;

// ─── Slot status pill ───────────────────────────────────────────────────────
const STATUS_STYLE = {
  open:    { background: "rgba(52,168,83,0.1)",  color: "#2E7D32", border: "1px solid rgba(52,168,83,0.2)" },
  booked:  { background: "rgba(27,43,74,0.08)",  color: "#1B2B4A", border: "1px solid rgba(27,43,74,0.18)" },
  held:    { background: "rgba(200,169,81,0.14)", color: "#A9863A", border: "1px solid rgba(200,169,81,0.25)" },
  blocked: { background: "rgba(74,85,104,0.1)",  color: "#4A5568", border: "1px solid rgba(74,85,104,0.2)" },
};

// ─── Group session status pill ───────────────────────────────────────────────
const GS_STATUS_STYLE = {
  scheduled: { background: "rgba(52,168,83,0.1)",  color: "#2E7D32", border: "1px solid rgba(52,168,83,0.2)" },
  full:      { background: "rgba(200,169,81,0.14)", color: "#A9863A", border: "1px solid rgba(200,169,81,0.25)" },
  completed: { background: "rgba(27,43,74,0.08)",  color: "#1B2B4A", border: "1px solid rgba(27,43,74,0.18)" },
  cancelled: { background: "rgba(239,68,68,0.08)", color: "#B91C1C", border: "1px solid rgba(239,68,68,0.2)" },
};

// ─── Weekly rule row ────────────────────────────────────────────────────────
const RuleRow = ({ rule, onChange, onSave, onDelete, saving }) => (
  <div className="rounded-xl px-3 py-2.5 flex flex-wrap items-end gap-2.5" style={card}>
    <Field label="Day">
      <select value={rule.day_of_week} onChange={(e) => onChange({ day_of_week: e.target.value })}
        className="rounded-lg px-2.5 py-1.5 text-sm w-32" style={inputStyle}>
        {DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
      </select>
    </Field>
    <Field label="From">
      <input type="time" value={rule.start_time?.slice(0, 5)} onChange={(e) => onChange({ start_time: e.target.value })}
        className="rounded-lg px-2.5 py-1.5 text-sm" style={inputStyle} />
    </Field>
    <Field label="To">
      <input type="time" value={rule.end_time?.slice(0, 5)} onChange={(e) => onChange({ end_time: e.target.value })}
        className="rounded-lg px-2.5 py-1.5 text-sm" style={inputStyle} />
    </Field>
    <Field label="Slot (min)">
      <select value={rule.slot_duration} onChange={(e) => onChange({ slot_duration: Number(e.target.value) })}
        className="rounded-lg px-2.5 py-1.5 text-sm w-20" style={inputStyle}>
        {DURATIONS.map((d) => <option key={d} value={d}>{d}</option>)}
      </select>
    </Field>
    <Field label="Buffer (min)">
      <input type="number" min="0" step="5" value={rule.buffer_minutes}
        onChange={(e) => onChange({ buffer_minutes: Number(e.target.value) })}
        className="rounded-lg px-2.5 py-1.5 text-sm w-20" style={inputStyle} />
    </Field>
    <div className="flex items-center gap-1.5 ml-auto">
      <button onClick={onSave} disabled={saving}
        className="px-3.5 py-1.5 rounded-full text-sm font-semibold disabled:opacity-50"
        style={{ background: "rgba(200,169,81,0.12)", color: "#A9863A", border: "1px solid rgba(200,169,81,0.25)" }}>
        Save
      </button>
      <button onClick={onDelete} className="p-2 rounded-full"
        style={{ background: "rgba(239,68,68,0.08)", color: "#B91C1C" }}>
        <FiTrash2 size={13} />
      </button>
    </div>
  </div>
);

const Field = ({ label, children }) => (
  <label className="flex flex-col gap-0.5">
    <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "rgba(74,85,104,0.7)" }}>{label}</span>
    {children}
  </label>
);

const Pager = ({ page, totalPages, onPrev, onNext }) =>
  totalPages > 1 ? (
    <div className="flex items-center justify-center gap-3 pt-1">
      <button onClick={onPrev} disabled={page <= 1}
        className="w-9 h-9 rounded-full flex items-center justify-center disabled:opacity-40 transition-all"
        style={{ background: "white", color: "#1B2B4A", border: "1px solid rgba(27,43,74,0.12)" }}>
        <FiChevronLeft size={16} />
      </button>
      <span className="text-sm" style={{ color: "#4A5568" }}>Page {page} of {totalPages}</span>
      <button onClick={onNext} disabled={page >= totalPages}
        className="w-9 h-9 rounded-full flex items-center justify-center disabled:opacity-40 transition-all"
        style={{ background: "white", color: "#1B2B4A", border: "1px solid rgba(27,43,74,0.12)" }}>
        <FiChevronRight size={16} />
      </button>
    </div>
  ) : null;

// ─── Main ───────────────────────────────────────────────────────────────────
const MyAvailability = () => {
  const navigate = useNavigate();
  const { isAuthenticated, isCoach, logout } = useAuth();
  const [tab, setTab] = useState("rules");
  const [rules, setRules] = useState([]);
  const [slots, setSlots] = useState([]);
  const [settings, setSettings] = useState({ timezone: "UTC", booking_horizon_days: 30, min_notice_hours: 12 });
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [savingId, setSavingId] = useState(null);
  const [manual, setManual] = useState({ start: "", end: "" });
  const [slotFilters, setSlotFilters] = useState({ fromDate: "", toDate: "", fromTime: "", toTime: "" });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [slotPage, setSlotPage] = useState(1);
  useEffect(() => { setSlotPage(1); }, [slotFilters]);
  const [rulePage, setRulePage] = useState(1);

  // Group sessions
  const [groupSessions, setGroupSessions] = useState([]);
  const [coachSkills, setCoachSkills] = useState([]);
  const [gsForm, setGsForm] = useState({ title: "", description: "", start: "", end: "", capacity: 10, price_per_seat: "", skill: "" });
  const [gsSaving, setGsSaving] = useState(false);
  const [rosterFor, setRosterFor] = useState(null);
  const [rosterData, setRosterData] = useState([]);

  // Coach can enter the call from 15 min before start until the scheduled end.
  const canJoinCall = (s) =>
    s.status !== "cancelled" &&
    new Date(s.end_datetime) > new Date() &&
    Date.now() >= new Date(s.start_datetime).getTime() - 15 * 60 * 1000;

  const totalRulePages = Math.max(1, Math.ceil(rules.length / RULES_PER_PAGE));
  const currentRulePage = Math.min(rulePage, totalRulePages);
  const pagedRules = rules.slice((currentRulePage - 1) * RULES_PER_PAGE, currentRulePage * RULES_PER_PAGE);

  const fetchAll = useCallback(async () => {
    if (!isAuthenticated || !isCoach()) { logout(); return; }
    setLoading(true);
    try {
      const [r, s, p, g, sk] = await Promise.all([
        api.get("/skills/availabilities/"),
        api.get("/bookings/slots/"),
        api.get("/profile/"),
        api.get("/bookings/group-sessions/"),
        api.get("/skills/"),
      ]);
      setRules(r.data);
      setSlots(s.data);
      setGroupSessions(g.data);
      setCoachSkills(sk.data);
      const prof = p.data.profile || {};
      setSettings({
        timezone: prof.timezone || "UTC",
        booking_horizon_days: prof.booking_horizon_days ?? 30,
        min_notice_hours: prof.min_notice_hours ?? 12,
      });
    } catch (err) {
      toast.error("Failed to load availability.");
      if (err.response?.status === 401) logout();
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, isCoach, logout]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Rules ──
  const patchLocalRule = (id, patch) => setRules((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const addRule = () => {
    const tempId = `new-${Date.now()}`;
    setRules((rs) => [...rs, { id: tempId, day_of_week: "Monday", start_time: "09:00", end_time: "12:00", slot_duration: 60, buffer_minutes: 0, is_available: true, _new: true }]);
    setRulePage(Math.ceil((rules.length + 1) / RULES_PER_PAGE)); // jump to the page with the new row
  };

  const saveRule = async (rule) => {
    setSavingId(rule.id);
    const payload = {
      day_of_week: rule.day_of_week, start_time: rule.start_time, end_time: rule.end_time,
      slot_duration: rule.slot_duration, buffer_minutes: rule.buffer_minutes, is_available: true,
    };
    try {
      if (rule._new) {
        const res = await api.post("/skills/availabilities/", payload);
        setRules((rs) => rs.map((r) => (r.id === rule.id ? res.data : r)));
      } else {
        const res = await api.patch(`/skills/availabilities/${rule.id}/`, payload);
        setRules((rs) => rs.map((r) => (r.id === rule.id ? res.data : r)));
      }
      toast.success("Availability saved.");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to save rule.");
    } finally {
      setSavingId(null);
    }
  };

  const deleteRule = async (rule) => {
    if (rule._new) { setRules((rs) => rs.filter((r) => r.id !== rule.id)); return; }
    try {
      await api.delete(`/skills/availabilities/${rule.id}/`);
      setRules((rs) => rs.filter((r) => r.id !== rule.id));
      toast.success("Removed.");
    } catch { toast.error("Failed to delete."); }
  };

  // ── Settings ──
  const saveSettings = async () => {
    try {
      await api.patch("/profile/", { profile: settings });
      toast.success("Booking settings updated.");
    } catch { toast.error("Failed to save settings."); }
  };

  // ── Generate ──
  const generate = async () => {
    setGenerating(true);
    try {
      const res = await api.post("/bookings/slots/generate/", {});
      toast.success(`${res.data.created} slot(s) created.`);
      const s = await api.get("/bookings/slots/");
      setSlots(s.data);
      if (res.data.created > 0) setTab("slots");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Generation failed.");
    } finally {
      setGenerating(false);
    }
  };

  // ── Slots ──
  const addManualSlot = async () => {
    if (!manual.start || !manual.end) { toast.error("Pick a start and end time."); return; }
    try {
      const res = await api.post("/bookings/slots/", {
        start_datetime: new Date(manual.start).toISOString(),
        end_datetime: new Date(manual.end).toISOString(),
      });
      setSlots((s) => [...s, res.data].sort((a, b) => new Date(a.start_datetime) - new Date(b.start_datetime)));
      setManual({ start: "", end: "" });
      toast.success("Slot added.");
    } catch (err) {
      toast.error(err.response?.data?.detail || err.response?.data?.[0] || "Failed to add slot.");
    }
  };

  const toggleBlock = async (slot) => {
    const action = slot.status === "blocked" ? "unblock" : "block";
    try {
      const res = await api.patch(`/bookings/slots/${slot.id}/${action}/`);
      setSlots((s) => s.map((x) => (x.id === slot.id ? res.data : x)));
    } catch (err) { toast.error(err.response?.data?.detail || "Action failed."); }
  };

  const deleteSlot = async (slot) => {
    try {
      await api.delete(`/bookings/slots/${slot.id}/`);
      setSlots((s) => s.filter((x) => x.id !== slot.id));
    } catch (err) { toast.error(err.response?.data?.detail || "Cannot delete."); }
  };

  // ── Group sessions ──
  const sortByStart = (arr) => [...arr].sort((a, b) => new Date(a.start_datetime) - new Date(b.start_datetime));

  const createGroupSession = async () => {
    if (!gsForm.title || !gsForm.start || !gsForm.end) { toast.error("Title, start and end are required."); return; }
    setGsSaving(true);
    try {
      const payload = {
        title: gsForm.title,
        description: gsForm.description,
        start_datetime: new Date(gsForm.start).toISOString(),
        end_datetime: new Date(gsForm.end).toISOString(),
        capacity: Number(gsForm.capacity),
        price_per_seat: gsForm.price_per_seat || 0,
      };
      if (gsForm.skill) payload.skill = Number(gsForm.skill);
      const res = await api.post("/bookings/group-sessions/", payload);
      setGroupSessions((gs) => sortByStart([...gs, res.data]));
      setGsForm({ title: "", description: "", start: "", end: "", capacity: 10, price_per_seat: "", skill: "" });
      toast.success("Group session created.");
    } catch (err) {
      toast.error(err.response?.data?.detail || err.response?.data?.[0] || "Failed to create session.");
    } finally { setGsSaving(false); }
  };

  const cancelGroupSession = async (s) => {
    try {
      const res = await api.patch(`/bookings/group-sessions/${s.id}/cancel/`);
      setGroupSessions((gs) => gs.map((x) => (x.id === s.id ? res.data : x)));
      toast.success("Session cancelled. Participants refunded.");
    } catch (err) { toast.error(err.response?.data?.detail || "Cancel failed."); }
  };

  const deleteGroupSession = async (s) => {
    try {
      await api.delete(`/bookings/group-sessions/${s.id}/`);
      setGroupSessions((gs) => gs.filter((x) => x.id !== s.id));
      if (rosterFor === s.id) setRosterFor(null);
      toast.success("Session deleted.");
    } catch (err) { toast.error(err.response?.data?.detail || "Delete failed."); }
  };

  const toggleRoster = async (s) => {
    if (rosterFor === s.id) { setRosterFor(null); return; }
    try {
      const res = await api.get(`/bookings/group-sessions/${s.id}/roster/`);
      setRosterData(res.data);
      setRosterFor(s.id);
    } catch { toast.error("Failed to load roster."); }
  };

  const filteredSlots = useMemo(() => {
    const pad = (n) => String(n).padStart(2, "0");
    return [...slots]
      .filter((s) => {
        const d = new Date(s.start_datetime);
        const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        const timeStr = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
        if (slotFilters.fromDate && dateStr < slotFilters.fromDate) return false;
        if (slotFilters.toDate && dateStr > slotFilters.toDate) return false;
        if (slotFilters.fromTime && timeStr < slotFilters.fromTime) return false;
        if (slotFilters.toTime && timeStr > slotFilters.toTime) return false;
        return true;
      })
      .sort((a, b) => new Date(a.start_datetime) - new Date(b.start_datetime));
  }, [slots, slotFilters]);

  const hasSlotFilters = !!(slotFilters.fromDate || slotFilters.toDate || slotFilters.fromTime || slotFilters.toTime);
  const totalSlotPages = Math.max(1, Math.ceil(filteredSlots.length / SLOTS_PER_PAGE));
  const currentSlotPage = Math.min(slotPage, totalSlotPages);
  const pagedSlots = filteredSlots.slice((currentSlotPage - 1) * SLOTS_PER_PAGE, currentSlotPage * SLOTS_PER_PAGE);

  if (loading) return (
    <div className="flex justify-center items-center min-h-screen" style={{ background: "#FAF6EC" }}>
      <div className="w-10 h-10 rounded-full border-2 animate-spin" style={{ borderColor: "#C8A951", borderTopColor: "transparent" }} />
    </div>
  );

  return (
    <div className="min-h-screen pt-28 pb-16 px-6" style={{ background: "#FAF6EC" }}>
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <motion.div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8"
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <div>
            <h1 className="text-3xl md:text-4xl font-normal text-[#1B2B4A]" style={serif}>My Availability</h1>
          </div>
          <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={generate} disabled={generating}
            className="gold-btn flex items-center gap-2 px-5 py-3 rounded-full text-sm font-bold disabled:opacity-60">
            <FiZap size={15} /> {generating ? "Generating…" : "Generate Slots"}
          </motion.button>
        </motion.div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          {[["rules", "Weekly Rules", FiClock], ["slots", "Slots", FiCalendar], ["group", "Group Sessions", FiUsers]].map(([key, label, Icon]) => (
            <button key={key} onClick={() => setTab(key)}
              className="flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold transition-all"
              style={tab === key
                ? { background: "#1B2B4A", color: "#FAF6EC" }
                : { background: "white", color: "#4A5568", border: "1px solid rgba(27,43,74,0.12)" }}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {tab === "rules" && (
            <motion.div key="rules" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
              {/* Booking policy */}
              <div className="rounded-2xl p-6" style={card}>
                <h3 className="flex items-center gap-2 text-lg font-normal text-[#1B2B4A] mb-4" style={serif}>
                  <FiSettings size={16} style={{ color: "#C8A951" }} /> Booking Policy
                </h3>
                <div className="flex flex-wrap items-end gap-4">
                  <Field label="Timezone">
                    <select value={settings.timezone} onChange={(e) => setSettings((s) => ({ ...s, timezone: e.target.value }))}
                      className="rounded-xl px-3 py-2 text-sm w-52" style={inputStyle}>
                      {COMMON_TZS.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                    </select>
                  </Field>
                  <Field label="Booking horizon (days)">
                    <input type="number" min="1" value={settings.booking_horizon_days}
                      onChange={(e) => setSettings((s) => ({ ...s, booking_horizon_days: Number(e.target.value) }))}
                      className="rounded-xl px-3 py-2 text-sm w-32" style={inputStyle} />
                  </Field>
                  <Field label="Min notice (hours)">
                    <input type="number" min="0" value={settings.min_notice_hours}
                      onChange={(e) => setSettings((s) => ({ ...s, min_notice_hours: Number(e.target.value) }))}
                      className="rounded-xl px-3 py-2 text-sm w-32" style={inputStyle} />
                  </Field>
                  <button onClick={saveSettings} className="ml-auto px-5 py-2.5 rounded-full text-sm font-bold navy-btn">
                    Save Policy
                  </button>
                </div>
                <p className="text-xs mt-3 flex items-center gap-1.5" style={{ color: "rgba(74,85,104,0.7)" }}>
                  <FiGlobe size={12} /> Slots are generated in your timezone and shown to clients in theirs.
                </p>
              </div>

              {/* Weekly rules */}
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-normal text-[#1B2B4A]" style={serif}>Weekly Windows</h3>
                <button onClick={addRule} className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold"
                  style={{ background: "rgba(200,169,81,0.12)", color: "#A9863A", border: "1px solid rgba(200,169,81,0.25)" }}>
                  <FiPlus size={14} /> Add Window
                </button>
              </div>

              {rules.length === 0 ? (
                <div className="text-center py-16 rounded-2xl" style={card}>
                  <p className="text-4xl mb-3">🗓️</p>
                  <p className="text-sm text-[#4A5568]">No availability windows yet. Add one, then hit <strong>Generate Slots</strong>.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {pagedRules.map((rule) => (
                    <RuleRow key={rule.id} rule={rule} saving={savingId === rule.id}
                      onChange={(patch) => patchLocalRule(rule.id, patch)}
                      onSave={() => saveRule(rule)} onDelete={() => deleteRule(rule)} />
                  ))}
                  <Pager page={currentRulePage} totalPages={totalRulePages}
                    onPrev={() => setRulePage((p) => Math.max(1, p - 1))}
                    onNext={() => setRulePage((p) => Math.min(totalRulePages, p + 1))} />
                </div>
              )}
            </motion.div>
          )}
          {tab === "slots" && (
            <motion.div key="slots" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
              {/* Manual slot */}
              <div className="rounded-2xl p-6" style={card}>
                <h3 className="flex items-center gap-2 text-lg font-normal text-[#1B2B4A] mb-4" style={serif}>
                  <FiPlus size={16} style={{ color: "#C8A951" }} /> Add a One-off Slot
                </h3>
                <div className="flex flex-wrap items-end gap-4">
                  <Field label="Starts">
                    <input type="datetime-local" value={manual.start} onChange={(e) => setManual((m) => ({ ...m, start: e.target.value }))}
                      className="rounded-xl px-3 py-2 text-sm" style={inputStyle} />
                  </Field>
                  <Field label="Ends">
                    <input type="datetime-local" value={manual.end} onChange={(e) => setManual((m) => ({ ...m, end: e.target.value }))}
                      className="rounded-xl px-3 py-2 text-sm" style={inputStyle} />
                  </Field>
                  <button onClick={addManualSlot} className="px-5 py-2.5 rounded-full text-sm font-bold gold-btn">Add Slot</button>
                </div>
              </div>

              {/* Filters (collapsed by default) */}
              <div className="rounded-2xl p-5" style={card}>
                <button onClick={() => setFiltersOpen((o) => !o)} className="w-full flex items-center gap-2">
                  <FiFilter size={15} style={{ color: "#C8A951" }} />
                  <p className="text-sm font-bold text-[#1B2B4A]">Filter Slots</p>
                  {hasSlotFilters && <span className="w-2 h-2 rounded-full" style={{ background: "#C8A951" }} />}
                  {hasSlotFilters && (
                    <span onClick={(e) => { e.stopPropagation(); setSlotFilters({ fromDate: "", toDate: "", fromTime: "", toTime: "" }); }}
                      className="ml-auto text-xs font-semibold" style={{ color: "#A9863A" }}>Clear</span>
                  )}
                  <FiChevronDown size={15} className={hasSlotFilters ? "" : "ml-auto"}
                    style={{ color: "#A9863A", transform: filtersOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
                </button>
                {filtersOpen && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
                    <Field label="From Date">
                      <input type="date" value={slotFilters.fromDate} onChange={(e) => setSlotFilters((f) => ({ ...f, fromDate: e.target.value }))}
                        className="rounded-xl px-3 py-2 text-sm w-full" style={inputStyle} />
                    </Field>
                    <Field label="To Date">
                      <input type="date" value={slotFilters.toDate} onChange={(e) => setSlotFilters((f) => ({ ...f, toDate: e.target.value }))}
                        className="rounded-xl px-3 py-2 text-sm w-full" style={inputStyle} />
                    </Field>
                    <Field label="From Time">
                      <input type="time" value={slotFilters.fromTime} onChange={(e) => setSlotFilters((f) => ({ ...f, fromTime: e.target.value }))}
                        className="rounded-xl px-3 py-2 text-sm w-full" style={inputStyle} />
                    </Field>
                    <Field label="To Time">
                      <input type="time" value={slotFilters.toTime} onChange={(e) => setSlotFilters((f) => ({ ...f, toTime: e.target.value }))}
                        className="rounded-xl px-3 py-2 text-sm w-full" style={inputStyle} />
                    </Field>
                  </div>
                )}
              </div>

              {/* Count + timezone note */}
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="inline-block text-sm px-4 py-1.5 rounded-full" style={{ background: "rgba(200,169,81,0.12)", color: "#A9863A" }}>
                  Total: <strong>{filteredSlots.length}</strong> slots · Page {currentSlotPage} of {totalSlotPages}
                </span>
                <span className="flex items-center gap-1 text-xs" style={{ color: "rgba(74,85,104,0.6)" }}>
                  <FiGlobe size={11} /> Times shown in {settings.timezone}
                </span>
              </div>

              {/* Table */}
              {filteredSlots.length === 0 ? (
                <div className="text-center py-16 rounded-2xl" style={card}>
                  <p className="text-4xl mb-3">📭</p>
                  <p className="text-sm text-[#4A5568]">No slots match. Set weekly windows and click <strong>Generate Slots</strong>, or clear filters.</p>
                </div>
              ) : (
                <div className="rounded-2xl overflow-hidden" style={card}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ background: "#FAF6EC" }}>
                        <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: "rgba(74,85,104,0.7)" }}>Date</th>
                        <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: "rgba(74,85,104,0.7)" }}>Time</th>
                        <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: "rgba(74,85,104,0.7)" }}>Status</th>
                        <th className="text-right px-5 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: "rgba(74,85,104,0.7)" }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedSlots.map((slot) => (
                        <tr key={slot.id} style={{ borderTop: "1px solid rgba(27,43,74,0.06)" }}>
                          <td className="px-5 py-3 font-medium text-[#1B2B4A]">{fmtDateShort(slot.start_datetime, settings.timezone)}</td>
                          <td className="px-5 py-3 text-[#4A5568]">{fmtTime(slot.start_datetime, settings.timezone)} – {fmtTime(slot.end_datetime, settings.timezone)}</td>
                          <td className="px-5 py-3">
                            <span className="text-[11px] font-semibold uppercase tracking-wide px-2.5 py-1 rounded-full" style={STATUS_STYLE[slot.status] || STATUS_STYLE.open}>
                              {slot.status}
                            </span>
                          </td>
                          <td className="px-5 py-3">
                            <div className="flex items-center justify-end gap-1.5">
                              {slot.status !== "booked" && slot.status !== "held" ? (
                                <>
                                  <button onClick={() => toggleBlock(slot)} title={slot.status === "blocked" ? "Unblock" : "Block"}
                                    className="p-2 rounded-full transition-all hover:bg-[rgba(200,169,81,0.12)]" style={{ color: "#A9863A" }}>
                                    {slot.status === "blocked" ? <FiUnlock size={14} /> : <FiLock size={14} />}
                                  </button>
                                  <button onClick={() => deleteSlot(slot)} title="Delete"
                                    className="p-2 rounded-full transition-all hover:bg-[rgba(239,68,68,0.1)]" style={{ color: "#B91C1C" }}>
                                    <FiTrash2 size={14} />
                                  </button>
                                </>
                              ) : (
                                <span className="text-xs italic" style={{ color: "rgba(74,85,104,0.5)" }}>locked</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Pagination */}
              {totalSlotPages > 1 && (
                <div className="flex items-center justify-center gap-3">
                  <button onClick={() => setSlotPage((p) => Math.max(1, p - 1))} disabled={currentSlotPage <= 1}
                    className="w-9 h-9 rounded-full flex items-center justify-center disabled:opacity-40 transition-all"
                    style={{ background: "white", color: "#1B2B4A", border: "1px solid rgba(27,43,74,0.12)" }}>
                    <FiChevronLeft size={16} />
                  </button>
                  <span className="text-sm" style={{ color: "#4A5568" }}>Page {currentSlotPage} of {totalSlotPages}</span>
                  <button onClick={() => setSlotPage((p) => Math.min(totalSlotPages, p + 1))} disabled={currentSlotPage >= totalSlotPages}
                    className="w-9 h-9 rounded-full flex items-center justify-center disabled:opacity-40 transition-all"
                    style={{ background: "white", color: "#1B2B4A", border: "1px solid rgba(27,43,74,0.12)" }}>
                    <FiChevronRight size={16} />
                  </button>
                </div>
              )}
            </motion.div>
          )}
          {tab === "group" && (
            <motion.div key="group" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
              {/* Create a group session */}
              <div className="rounded-2xl p-6" style={card}>
                <h3 className="flex items-center gap-2 text-lg font-normal text-[#1B2B4A] mb-4" style={serif}>
                  <FiUsers size={16} style={{ color: "#C8A951" }} /> Create a Group Session
                </h3>
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <Field label="Title">
                      <input value={gsForm.title} onChange={(e) => setGsForm((f) => ({ ...f, title: e.target.value }))}
                        placeholder="e.g. Group Wellness Workshop" className="rounded-xl px-3 py-2 text-sm w-full" style={inputStyle} />
                    </Field>
                  </div>
                  <div className="md:col-span-2">
                    <Field label="Description">
                      <textarea rows={3} value={gsForm.description} onChange={(e) => setGsForm((f) => ({ ...f, description: e.target.value }))}
                        className="rounded-xl px-3 py-2 text-sm w-full resize-none" style={inputStyle} />
                    </Field>
                  </div>
                  <Field label="Starts">
                    <input type="datetime-local" value={gsForm.start} onChange={(e) => setGsForm((f) => ({ ...f, start: e.target.value }))}
                      className="rounded-xl px-3 py-2 text-sm w-full" style={inputStyle} />
                  </Field>
                  <Field label="Ends">
                    <input type="datetime-local" value={gsForm.end} onChange={(e) => setGsForm((f) => ({ ...f, end: e.target.value }))}
                      className="rounded-xl px-3 py-2 text-sm w-full" style={inputStyle} />
                  </Field>
                  <Field label="Capacity">
                    <input type="number" min="1" value={gsForm.capacity} onChange={(e) => setGsForm((f) => ({ ...f, capacity: e.target.value }))}
                      className="rounded-xl px-3 py-2 text-sm w-full" style={inputStyle} />
                  </Field>
                  <Field label="Price per seat ($)">
                    <input type="number" min="0" step="0.01" value={gsForm.price_per_seat} onChange={(e) => setGsForm((f) => ({ ...f, price_per_seat: e.target.value }))}
                      className="rounded-xl px-3 py-2 text-sm w-full" style={inputStyle} />
                  </Field>
                  <div className="md:col-span-2">
                    <Field label="Linked skill (optional)">
                      <select value={gsForm.skill} onChange={(e) => setGsForm((f) => ({ ...f, skill: e.target.value }))}
                        className="rounded-xl px-3 py-2 text-sm w-full" style={inputStyle}>
                        <option value="">— None —</option>
                        {coachSkills.map((sk) => <option key={sk.id} value={sk.id}>{sk.name}</option>)}
                      </select>
                    </Field>
                  </div>
                </div>
                <div className="flex justify-end mt-4">
                  <button onClick={createGroupSession} disabled={gsSaving}
                    className="px-5 py-2.5 rounded-full text-sm font-bold gold-btn disabled:opacity-60">
                    {gsSaving ? "Creating…" : "Create Session"}
                  </button>
                </div>
              </div>

              {/* Existing sessions */}
              {groupSessions.length === 0 ? (
                <div className="text-center py-16 rounded-2xl" style={card}>
                  <p className="text-4xl mb-3">👥</p>
                  <p className="text-sm text-[#4A5568]">No group sessions yet. Create one above.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {groupSessions.map((s) => (
                    <div key={s.id} className="rounded-2xl p-5" style={card}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="font-semibold text-[#1B2B4A]" style={serif}>{s.title}</h4>
                            <span className="text-[11px] font-semibold uppercase tracking-wide px-2.5 py-1 rounded-full" style={GS_STATUS_STYLE[s.status] || GS_STATUS_STYLE.scheduled}>{s.status}</span>
                          </div>
                          <p className="text-sm text-[#4A5568] mt-1">
                            {fmtDateShort(s.start_datetime, settings.timezone)} · {fmtTime(s.start_datetime, settings.timezone)} – {fmtTime(s.end_datetime, settings.timezone)}
                          </p>
                          <p className="text-xs mt-1" style={{ color: "rgba(74,85,104,0.7)" }}>
                            {s.seats_taken}/{s.capacity} seats · ${parseFloat(s.price_per_seat).toFixed(2)}/seat
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => toggleRoster(s)} className="px-3 py-1.5 rounded-full text-sm font-semibold"
                            style={{ background: "rgba(27,43,74,0.06)", color: "#1B2B4A" }}>
                            {rosterFor === s.id ? "Hide" : "Roster"}
                          </button>
                          {s.status !== "cancelled" && (
                            <button onClick={() => cancelGroupSession(s)} title="Cancel & refund"
                              className="p-2 rounded-full" style={{ background: "rgba(239,68,68,0.08)", color: "#B91C1C" }}>
                              <FiXCircle size={15} />
                            </button>
                          )}
                          {s.seats_taken === 0 && (
                            <button onClick={() => deleteGroupSession(s)} title="Delete"
                              className="p-2 rounded-full" style={{ background: "rgba(239,68,68,0.08)", color: "#B91C1C" }}>
                              <FiTrash2 size={14} />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Built-in call + group chat */}
                      {s.status !== "cancelled" && (
                        <div className="flex flex-wrap items-center gap-2 mt-4">
                          {new Date(s.end_datetime) > new Date() && (
                            canJoinCall(s) ? (
                              <button onClick={() => navigate(`/group-session/${s.id}/call`)}
                                className="px-4 py-2 rounded-full text-sm font-semibold flex items-center gap-1.5"
                                style={{ background: "rgba(200,169,81,0.12)", color: "#A9863A", border: "1px solid rgba(200,169,81,0.25)" }}>
                                <FiVideo size={13} /> Join Call
                              </button>
                            ) : (
                              <span className="text-xs" style={{ color: "rgba(74,85,104,0.6)" }}>
                                <FiVideo size={12} className="inline mr-1" /> Call opens 15 min before start
                              </span>
                            )
                          )}
                          <button onClick={() => navigate(`/group-chat/${s.id}`)}
                            className="px-4 py-2 rounded-full text-sm font-semibold flex items-center gap-1.5"
                            style={{ background: "rgba(27,43,74,0.06)", color: "#1B2B4A", border: "1px solid rgba(27,43,74,0.12)" }}>
                            <FiMessageSquare size={13} /> Group Chat
                          </button>
                        </div>
                      )}

                      {/* Roster */}
                      {rosterFor === s.id && (
                        <div className="mt-4 rounded-xl p-4" style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.15)" }}>
                          {rosterData.length === 0 ? (
                            <p className="text-sm text-[#4A5568]">No participants yet.</p>
                          ) : (
                            <ul className="space-y-1.5">
                              {rosterData.map((e) => (
                                <li key={e.id} className="flex items-center justify-between text-sm">
                                  <span className="text-[#1B2B4A] font-medium">{e.learner_username}</span>
                                  <span className="text-xs" style={{ color: e.status === "booked" ? "#2E7D32" : "#A9863A" }}>
                                    {e.status}{e.payment_status === "paid" ? " · paid" : ""}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default MyAvailability;
