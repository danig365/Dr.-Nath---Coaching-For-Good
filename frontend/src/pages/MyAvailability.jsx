import { useState, useEffect, useCallback, useMemo } from "react";
import { FiPlus, FiTrash2, FiClock, FiCalendar, FiZap, FiLock, FiUnlock, FiGlobe, FiSettings, FiChevronLeft, FiChevronRight, FiChevronDown, FiUsers, FiVideo, FiXCircle, FiMessageSquare, FiShare2, FiCopy, FiCheck, FiX } from "react-icons/fi";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "react-toastify";
import { useNavigate } from "react-router-dom";
import { api } from "../utils/auth";
import { useAuth } from "../context/AuthContext";
import { GROUP_SESSIONS_ENABLED } from "../config/features";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DURATIONS = [15, 30, 45, 60]; // 60 min is the maximum slot length
const COMMON_TZS = [
  "UTC",
  "Africa/Johannesburg", "Africa/Lagos", "Africa/Nairobi", "Africa/Cairo", "Africa/Accra",
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "Europe/London", "Europe/Paris", "Europe/Berlin", "Asia/Dubai", "Asia/Karachi",
  "Asia/Kolkata", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney",
];

const card = { background: "white", border: "1px solid rgba(200,169,81,0.15)", boxShadow: "0 2px 16px rgba(27,43,74,0.05)" };
const inputStyle = { background: "#FAF6EC", border: "1px solid rgba(27,43,74,0.2)", color: "#1B2B4A" };
const serif = { fontFamily: "'Playfair Display', serif" };

const fmtTime = (iso, tz) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: tz || undefined });
const fmtDateShort = (iso, tz) => new Date(iso).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: tz || undefined });
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

// ─── Coach availability calendar ─────────────────────────────────────────────
const CAL_WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const pad2 = (n) => String(n).padStart(2, "0");
// Calendar date (YYYY-MM-DD) of a slot, in the coach's own timezone.
const tzDateKey = (iso, tz) => new Date(iso).toLocaleDateString("en-CA", { timeZone: tz || undefined });

const CoachCalendar = ({ slots, tz, coachSkills = [], onBlockSlot, onUnblockSlot, onDeleteSlot, onAddSlot, onBlockDay, onOpenDay, onShareSlot, busy }) => {
  const slotsByDate = useMemo(() => {
    const m = {};
    slots.forEach((s) => { (m[tzDateKey(s.start_datetime, tz)] ||= []).push(s); });
    Object.values(m).forEach((arr) => arr.sort((a, b) => new Date(a.start_datetime) - new Date(b.start_datetime)));
    return m;
  }, [slots, tz]);

  const [viewMonth, setViewMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [selectedKey, setSelectedKey] = useState(null);
  const [addForm, setAddForm] = useState({ from: "09:00", to: "10:00" });

  // On first load (or when slots first arrive), jump to the earliest slot's month.
  useEffect(() => {
    if (selectedKey === null) {
      const keys = Object.keys(slotsByDate).sort();
      if (keys.length) {
        setSelectedKey(keys[0]);
        const d = new Date(keys[0] + "T00:00:00");
        setViewMonth(new Date(d.getFullYear(), d.getMonth(), 1));
      }
    }
  }, [slotsByDate, selectedKey]);

  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const startWeekday = (new Date(year, month, 1).getDay() + 6) % 7; // Mon-first
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const todayKey = tzDateKey(new Date().toISOString(), tz);
  const monthLabel = viewMonth.toLocaleDateString([], { month: "long", year: "numeric" });
  const daySlots = selectedKey ? (slotsByDate[selectedKey] || []) : [];

  const counts = (arr) => ({
    open: arr.filter((s) => s.status === "open").length,
    booked: arr.filter((s) => s.status === "booked" || s.status === "held").length,
    blocked: arr.filter((s) => s.status === "blocked").length,
  });

  const selCounts = counts(daySlots);
  const prettyDay = selectedKey
    ? new Date(selectedKey + "T00:00:00").toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" })
    : null;

  const addOnDay = () => {
    if (!selectedKey) return;
    const start = new Date(`${selectedKey}T${addForm.from}:00`);
    const end = new Date(`${selectedKey}T${addForm.to}:00`);
    if (end <= start) { toast.error("End time must be after start time."); return; }
    onAddSlot(start.toISOString(), end.toISOString());
  };

  return (
    <div className="grid lg:grid-cols-[1fr_360px] gap-6">
      {/* Month grid */}
      <div className="rounded-2xl p-5" style={card}>
        <div className="flex items-center justify-between mb-4">
          <button type="button" onClick={() => setViewMonth(new Date(year, month - 1, 1))}
            className="w-9 h-9 rounded-full flex items-center justify-center transition-all hover:bg-[rgba(200,169,81,0.12)]" style={{ color: "#A9863A" }}>
            <FiChevronLeft size={16} />
          </button>
          <p className="text-base font-bold text-[#1B2B4A]" style={serif}>{monthLabel}</p>
          <button type="button" onClick={() => setViewMonth(new Date(year, month + 1, 1))}
            className="w-9 h-9 rounded-full flex items-center justify-center transition-all hover:bg-[rgba(200,169,81,0.12)]" style={{ color: "#A9863A" }}>
            <FiChevronRight size={16} />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1 mb-1">
          {CAL_WEEKDAYS.map((w) => (
            <div key={w} className="text-center text-[10px] font-semibold uppercase tracking-wider py-1" style={{ color: "rgba(74,85,104,0.6)" }}>{w}</div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {cells.map((d, i) => {
            if (!d) return <div key={`b${i}`} />;
            const key = `${year}-${pad2(month + 1)}-${pad2(d)}`;
            const dayArr = slotsByDate[key];
            const c = dayArr ? counts(dayArr) : null;
            const isSelected = key === selectedKey;
            const isToday = key === todayKey;
            return (
              <button key={key} type="button" onClick={() => setSelectedKey(key)}
                className="relative aspect-square rounded-xl flex flex-col items-center justify-center text-sm font-medium transition-all"
                style={
                  isSelected
                    ? { background: "#1B2B4A", color: "#FAF6EC" }
                    : dayArr
                    ? { background: "rgba(200,169,81,0.12)", color: "#1B2B4A", cursor: "pointer" }
                    : { background: "transparent", color: "rgba(74,85,104,0.5)", cursor: "pointer", border: isToday ? "1px solid rgba(200,169,81,0.4)" : "1px solid transparent" }
                }>
                <span>{d}</span>
                {c && (
                  <span className="flex items-center gap-0.5 mt-0.5">
                    {c.open > 0 && <span className="w-1.5 h-1.5 rounded-full" style={{ background: isSelected ? "#E8C96A" : "#2E7D32" }} />}
                    {c.booked > 0 && <span className="w-1.5 h-1.5 rounded-full" style={{ background: isSelected ? "#FAF6EC" : "#1B2B4A" }} />}
                    {c.blocked > 0 && <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#7A8699" }} />}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-3 mt-4 text-[11px]" style={{ color: "rgba(74,85,104,0.7)" }}>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: "#2E7D32" }} /> Open</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: "#1B2B4A" }} /> Booked</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: "#7A8699" }} /> Blocked</span>
          <span className="flex items-center gap-1 ml-auto"><FiGlobe size={11} /> {tz}</span>
        </div>
      </div>

      {/* Selected day panel */}
      <div className="rounded-2xl p-5 self-start" style={card}>
        {!selectedKey ? (
          <div className="text-center py-12">
            <p className="text-3xl mb-2">🗓️</p>
            <p className="text-sm text-[#4A5568]">Select a day to manage its slots.</p>
          </div>
        ) : (
          <>
            <h3 className="text-base font-bold text-[#1B2B4A] mb-1" style={serif}>{prettyDay}</h3>
            <p className="text-xs mb-4" style={{ color: "rgba(74,85,104,0.7)" }}>
              {selCounts.open} open · {selCounts.booked} booked · {selCounts.blocked} blocked
            </p>

            {/* Bulk day actions */}
            <div className="flex gap-2 mb-4">
              <button onClick={() => onBlockDay(daySlots)} disabled={busy || selCounts.open === 0}
                className="flex-1 px-3 py-2 rounded-full text-xs font-semibold disabled:opacity-40 flex items-center justify-center gap-1.5"
                style={{ background: "rgba(74,85,104,0.1)", color: "#4A5568" }}>
                <FiLock size={12} /> Block day
              </button>
              <button onClick={() => onOpenDay(daySlots)} disabled={busy || selCounts.blocked === 0}
                className="flex-1 px-3 py-2 rounded-full text-xs font-semibold disabled:opacity-40 flex items-center justify-center gap-1.5"
                style={{ background: "rgba(52,168,83,0.1)", color: "#2E7D32" }}>
                <FiUnlock size={12} /> Open day
              </button>
            </div>

            {/* Slot list */}
            {daySlots.length === 0 ? (
              <p className="text-sm py-3 text-center" style={{ color: "rgba(74,85,104,0.6)" }}>No slots on this day.</p>
            ) : (
              <div className="space-y-2 mb-5">
                {daySlots.map((slot) => {
                  const locked = slot.status === "booked" || slot.status === "held";
                  return (
                    <div key={slot.id} className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: "#FAF6EC", border: "1px solid rgba(27,43,74,0.06)" }}>
                      <span className="text-sm font-medium text-[#1B2B4A]">{fmtTime(slot.start_datetime, tz)}–{fmtTime(slot.end_datetime, tz)}</span>
                      <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full" style={STATUS_STYLE[slot.status] || STATUS_STYLE.open}>{slot.status}</span>
                      <div className="ml-auto flex items-center gap-1">
                        {locked ? (
                          <span className="text-[11px] italic" style={{ color: "rgba(74,85,104,0.5)" }}>locked</span>
                        ) : (
                          <>
                            {slot.status === "open" && (
                              <button onClick={() => onShareSlot(slot)} title="Share invite link" disabled={busy}
                                className="p-1.5 rounded-full hover:bg-[rgba(27,43,74,0.08)] disabled:opacity-40" style={{ color: "#1B2B4A" }}>
                                <FiShare2 size={13} />
                              </button>
                            )}
                            <button onClick={() => (slot.status === "blocked" ? onUnblockSlot(slot) : onBlockSlot(slot))}
                              title={slot.status === "blocked" ? "Open" : "Block"} disabled={busy}
                              className="p-1.5 rounded-full hover:bg-[rgba(200,169,81,0.12)] disabled:opacity-40" style={{ color: "#A9863A" }}>
                              {slot.status === "blocked" ? <FiUnlock size={13} /> : <FiLock size={13} />}
                            </button>
                            <button onClick={() => onDeleteSlot(slot)} title="Delete" disabled={busy}
                              className="p-1.5 rounded-full hover:bg-[rgba(239,68,68,0.1)] disabled:opacity-40" style={{ color: "#B91C1C" }}>
                              <FiTrash2 size={13} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Add a slot to this day */}
            <div className="rounded-xl p-3" style={{ background: "rgba(200,169,81,0.08)", border: "1px solid rgba(200,169,81,0.2)" }}>
              <p className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: "#A9863A" }}>Add a slot</p>
              <div className="flex items-end gap-2">
                <Field label="From">
                  <input type="time" value={addForm.from} onChange={(e) => setAddForm((f) => ({ ...f, from: e.target.value }))}
                    className="rounded-lg px-2 py-1.5 text-sm w-full" style={inputStyle} />
                </Field>
                <Field label="To">
                  <input type="time" value={addForm.to} onChange={(e) => setAddForm((f) => ({ ...f, to: e.target.value }))}
                    className="rounded-lg px-2 py-1.5 text-sm w-full" style={inputStyle} />
                </Field>
                <button onClick={addOnDay} disabled={busy}
                  className="px-4 py-2 rounded-full text-sm font-bold gold-btn disabled:opacity-50 whitespace-nowrap">Add</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// ─── Share-slot invite modal ──────────────────────────────────────────────────
const ShareSlotModal = ({ slot, skills, tz, onClose }) => {
  // Default to the slot's own skill if it has one, else the first offering.
  const [skillId, setSkillId] = useState(() => slot.skill ?? (skills[0]?.id ?? ""));
  const [copied, setCopied] = useState(false);

  const link = skillId
    ? `${window.location.origin}/book/${skillId}?slot=${slot.id}`
    : "";

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      // Fallback for non-secure contexts / older browsers.
      const ta = document.createElement("textarea");
      ta.value = link; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch { /* noop */ }
      document.body.removeChild(ta);
    }
    setCopied(true);
    toast.success("Invite link copied.");
    setTimeout(() => setCopied(false), 2000);
  };

  const when = `${fmtDateShort(slot.start_datetime, tz)} · ${fmtTime(slot.start_datetime, tz)}–${fmtTime(slot.end_datetime, tz)}`;

  return (
    <motion.div className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <motion.div className="relative w-full max-w-md rounded-2xl shadow-2xl z-10 p-7" style={{ background: "#FAF6EC" }}
        initial={{ y: 40, opacity: 0, scale: 0.96 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 40, opacity: 0, scale: 0.96 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}>
        <button onClick={onClose} className="absolute top-4 right-4 p-1 rounded-full hover:bg-[rgba(27,43,74,0.08)]" style={{ color: "#4A5568" }}>
          <FiX size={18} />
        </button>

        <div className="flex items-center gap-2 mb-1">
          <FiShare2 size={16} style={{ color: "#A9863A" }} />
          <h3 className="text-lg font-bold text-[#1B2B4A]" style={serif}>Share this slot</h3>
        </div>
        <p className="text-xs mb-5" style={{ color: "rgba(74,85,104,0.8)" }}>{when}</p>

        <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "#A9863A" }}>Offering to book</label>
        {skills.length === 0 ? (
          <p className="text-sm mb-4" style={{ color: "#B91C1C" }}>You have no offerings yet. Add a skill first.</p>
        ) : (
          <div className="relative mb-4">
            <select value={skillId} onChange={(e) => setSkillId(e.target.value)}
              className="w-full appearance-none rounded-xl px-3 py-2.5 text-sm pr-9" style={inputStyle}>
              {skills.map((sk) => (
                <option key={sk.id} value={sk.id}>{sk.name}{sk.price ? ` — $${sk.price}/hr` : ""}</option>
              ))}
            </select>
            <FiChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "#C8A951" }} />
          </div>
        )}

        <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "#A9863A" }}>Invite link</label>
        <div className="flex items-center gap-2">
          <input readOnly value={link} onFocus={(e) => e.target.select()}
            className="flex-1 rounded-xl px-3 py-2.5 text-xs truncate" style={{ ...inputStyle, color: "#4A5568" }} />
          <button onClick={copy} disabled={!link}
            className="shrink-0 px-4 py-2.5 rounded-xl text-sm font-bold gold-btn disabled:opacity-50 flex items-center gap-1.5">
            {copied ? <FiCheck size={14} /> : <FiCopy size={14} />} {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="text-[11px] mt-3 leading-relaxed" style={{ color: "rgba(74,85,104,0.7)" }}>
          Anyone with this link lands on the booking page with this exact time pre-selected. They sign in only when they confirm.
        </p>
      </motion.div>
    </motion.div>
  );
};

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
  const [calBusy, setCalBusy] = useState(false);
  const [shareSlot, setShareSlot] = useState(null); // slot being shared via invite link
  // Date range to generate bookable slots across (defaults to the launch season).
  const [genRange, setGenRange] = useState({ start: "2026-07-01", end: "2026-12-06" });
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
    if (!genRange.start || !genRange.end) { toast.error("Pick a start and end date."); return; }
    if (genRange.end < genRange.start) { toast.error("End date can't be before start date."); return; }
    setGenerating(true);
    try {
      const res = await api.post("/bookings/slots/generate/", {
        start_date: genRange.start,
        end_date: genRange.end,
      });
      toast.success(
        res.data.created > 0
          ? `${res.data.created} slot(s) created.`
          : "No new slots — your schedule may already be generated for this range."
      );
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
  const deleteSlot = async (slot) => {
    try {
      await api.delete(`/bookings/slots/${slot.id}/`);
      setSlots((s) => s.filter((x) => x.id !== slot.id));
    } catch (err) { toast.error(err.response?.data?.detail || "Cannot delete."); }
  };

  // ── Calendar slot actions ──
  const setSlotStatus = async (slot, action) => {
    const res = await api.patch(`/bookings/slots/${slot.id}/${action}/`);
    setSlots((s) => s.map((x) => (x.id === slot.id ? res.data : x)));
  };

  const blockSlot = async (slot) => {
    try { await setSlotStatus(slot, "block"); } catch (err) { toast.error(err.response?.data?.detail || "Action failed."); }
  };
  const unblockSlot = async (slot) => {
    try { await setSlotStatus(slot, "unblock"); } catch (err) { toast.error(err.response?.data?.detail || "Action failed."); }
  };

  const blockDaySlots = async (daySlots) => {
    const open = daySlots.filter((s) => s.status === "open");
    if (open.length === 0) return;
    setCalBusy(true);
    try {
      await Promise.all(open.map((s) => setSlotStatus(s, "block")));
      toast.success(`Blocked ${open.length} slot(s).`);
    } catch { toast.error("Some slots could not be blocked."); }
    finally { setCalBusy(false); }
  };

  const openDaySlots = async (daySlots) => {
    const blocked = daySlots.filter((s) => s.status === "blocked");
    if (blocked.length === 0) return;
    setCalBusy(true);
    try {
      await Promise.all(blocked.map((s) => setSlotStatus(s, "unblock")));
      toast.success(`Opened ${blocked.length} slot(s).`);
    } catch { toast.error("Some slots could not be opened."); }
    finally { setCalBusy(false); }
  };

  const addSlotForDay = async (startISO, endISO) => {
    setCalBusy(true);
    try {
      const res = await api.post("/bookings/slots/", { start_datetime: startISO, end_datetime: endISO });
      setSlots((s) => [...s, res.data].sort((a, b) => new Date(a.start_datetime) - new Date(b.start_datetime)));
      toast.success("Slot added.");
    } catch (err) {
      toast.error(err.response?.data?.detail || err.response?.data?.[0] || "Failed to add slot.");
    } finally { setCalBusy(false); }
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

  if (loading) return (
    <div className="flex justify-center items-center min-h-screen" style={{ background: "#FAF6EC" }}>
      <div className="w-10 h-10 rounded-full border-2 animate-spin" style={{ borderColor: "#C8A951", borderTopColor: "transparent" }} />
    </div>
  );

  return (
    <div className="min-h-screen pt-36 pb-16 px-6" style={{ background: "#FAF6EC" }}>
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <motion.div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8"
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <div>
            <h1 className="text-3xl md:text-4xl font-normal text-[#1B2B4A]" style={serif}>My Availability</h1>
            <p className="text-sm mt-1" style={{ color: "rgba(74,85,104,0.8)" }}>
              Set your weekly schedule, generate slots for a date range, then fine-tune them on the calendar.
            </p>
          </div>
        </motion.div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          {[["rules", "Schedule", FiClock], ["slots", "Calendar", FiCalendar],
            ...(GROUP_SESSIONS_ENABLED ? [["group", "Group Sessions", FiUsers]] : [])].map(([key, label, Icon]) => (
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

              {/* Coaching days & times */}
              <div>
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-normal text-[#1B2B4A]" style={serif}>Coaching Days &amp; Times</h3>
                  <button onClick={addRule} className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold"
                    style={{ background: "rgba(200,169,81,0.12)", color: "#A9863A", border: "1px solid rgba(200,169,81,0.25)" }}>
                    <FiPlus size={14} /> Add Day
                  </button>
                </div>
                <p className="text-sm mt-1" style={{ color: "rgba(74,85,104,0.8)" }}>
                  Add a row for each day you coach and the hours you're available (e.g. Saturday 08:00–13:00).
                  Add a second row for a split day. Change these anytime — then re-generate below.
                </p>
              </div>

              {rules.length === 0 ? (
                <div className="text-center py-16 rounded-2xl" style={card}>
                  <p className="text-4xl mb-3">🗓️</p>
                  <p className="text-sm text-[#4A5568]">No coaching days set yet. Add one, then <strong>Generate Slots</strong> below.</p>
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

              {/* Generate bookable slots for a date range */}
              <div className="rounded-2xl p-6" style={card}>
                <h3 className="flex items-center gap-2 text-lg font-normal text-[#1B2B4A] mb-1" style={serif}>
                  <FiZap size={16} style={{ color: "#C8A951" }} /> Generate Bookable Slots
                </h3>
                <p className="text-sm mb-4" style={{ color: "rgba(74,85,104,0.8)" }}>
                  Turn the schedule above into bookable slots across a date range. Re-run it anytime — existing
                  booked, held, or blocked slots are never touched.
                </p>
                <div className="flex flex-wrap items-end gap-4">
                  <Field label="From date">
                    <input type="date" value={genRange.start} onChange={(e) => setGenRange((r) => ({ ...r, start: e.target.value }))}
                      className="rounded-xl px-3 py-2 text-sm" style={inputStyle} />
                  </Field>
                  <Field label="To date">
                    <input type="date" value={genRange.end} onChange={(e) => setGenRange((r) => ({ ...r, end: e.target.value }))}
                      className="rounded-xl px-3 py-2 text-sm" style={inputStyle} />
                  </Field>
                  <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={generate} disabled={generating}
                    className="ml-auto gold-btn flex items-center gap-2 px-5 py-3 rounded-full text-sm font-bold disabled:opacity-60">
                    <FiZap size={15} /> {generating ? "Generating…" : "Generate Slots"}
                  </motion.button>
                </div>
              </div>
            </motion.div>
          )}
          {tab === "slots" && (
            <motion.div key="slots" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
              <CoachCalendar
                slots={slots}
                tz={settings.timezone}
                coachSkills={coachSkills}
                busy={calBusy}
                onBlockSlot={blockSlot}
                onUnblockSlot={unblockSlot}
                onDeleteSlot={deleteSlot}
                onAddSlot={addSlotForDay}
                onBlockDay={blockDaySlots}
                onOpenDay={openDaySlots}
                onShareSlot={setShareSlot}
              />
            </motion.div>
          )}
          {GROUP_SESSIONS_ENABLED && tab === "group" && (
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

      {/* Share-slot invite modal */}
      <AnimatePresence>
        {shareSlot && (
          <ShareSlotModal
            slot={shareSlot}
            skills={coachSkills}
            tz={settings.timezone}
            onClose={() => setShareSlot(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

export default MyAvailability;
