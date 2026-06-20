import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  FiCalendar, FiClock, FiMessageSquare, FiX,
  FiVideo, FiDollarSign, FiUpload, FiCheck,
  FiSearch, FiFilter, FiChevronDown, FiLink, FiUsers,
} from "react-icons/fi";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "react-toastify";
import { api } from "../utils/auth";
import { useAuth } from "../context/AuthContext";
import SessionFeedbackCard from "../components/SessionFeedbackCard";

// ─── Status Badge ─────────────────────────────────────────────────────────────
const StatusBadge = ({ status }) => {
  const map = {
    pending:   { bg: "rgba(251,191,36,0.12)", color: "#92400E", border: "1px solid rgba(251,191,36,0.3)" },
    accepted:  { bg: "rgba(52,168,83,0.1)",   color: "#2E7D32", border: "1px solid rgba(52,168,83,0.25)" },
    confirmed: { bg: "rgba(52,168,83,0.1)",   color: "#2E7D32", border: "1px solid rgba(52,168,83,0.25)" },
    completed: { bg: "rgba(200,169,81,0.12)", color: "#A9863A", border: "1px solid rgba(200,169,81,0.3)" },
    cancelled: { bg: "rgba(239,68,68,0.08)", color: "#B91C1C", border: "1px solid rgba(239,68,68,0.2)" },
    declined:  { bg: "rgba(239,68,68,0.08)", color: "#B91C1C", border: "1px solid rgba(239,68,68,0.2)" },
  };
  const s = map[status] || map.pending;
  return (
    <span className="text-xs font-semibold px-3 py-1 rounded-full shrink-0" style={{ background: s.bg, color: s.color, border: s.border }}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
};

// ─── Unread Badge ─────────────────────────────────────────────────────────────
const UnreadBadge = ({ count }) => {
  if (!count) return null;
  return (
    <span className="ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-bold text-white" style={{ background: "#DC2626" }}>
      {count > 99 ? "99+" : count}
    </span>
  );
};

// ─── Action Button ────────────────────────────────────────────────────────────
const ActionBtn = ({ onClick, icon: Icon, label, badge, variant = "default" }) => {
  const styles = {
    default: { background: "rgba(200,169,81,0.1)", color: "#A9863A", border: "1px solid rgba(200,169,81,0.25)" },
    danger:  { background: "rgba(239,68,68,0.08)", color: "#B91C1C", border: "1px solid rgba(239,68,68,0.2)" },
    primary: { background: "linear-gradient(135deg,#C8A951,#F0D98C)", color: "#14213D", border: "none" },
  }[variant];
  return (
    <motion.button
      whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
      onClick={onClick}
      className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold transition-all duration-200"
      style={styles}
    >
      <Icon size={13} />
      {label}
      {badge}
    </motion.button>
  );
};

// ─── Session Card (compact) ────────────────────────────────────────────────────
const SessionCard = ({ session, activeTab, onCancel, onSetMeetingLink, onUploadNotes, onJoin, navigate, index }) => {
  const date = new Date(session.session_date).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric",
  });
  const time = new Date(`2000-01-01T${session.session_time}`).toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", hour12: true,
  });

  const accentColor = session.status === "accepted" || session.status === "confirmed"
    ? "#34A853" : session.status === "pending" ? "#F59E0B" : "#C8A951";

  const sessionEnd = new Date(
    new Date(`${session.session_date}T${session.session_time}`).getTime() +
    session.duration * 60 * 1000
  );
  const expired = sessionEnd < new Date();

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: index * 0.04 }}
      className="rounded-2xl overflow-hidden"
      style={{ background: "white", border: "1px solid rgba(200,169,81,0.18)", boxShadow: "0 2px 12px rgba(27,43,74,0.06)" }}
    >
      {/* Left accent bar + content */}
      <div className="flex">
        <div className="w-1.5 shrink-0" style={{ background: `linear-gradient(180deg, ${accentColor}, ${accentColor}55)` }} />

        <div className="flex-1 px-5 py-4">
          {/* Row 1: avatar · client + skill · tags · status */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0" style={{ background: "#C8A951", color: "#14213D" }}>
              {session.learner_username?.charAt(0).toUpperCase()}
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-xs font-semibold" style={{ color: "#A9863A" }}>{session.learner_username}</span>
              <span className="text-base font-normal text-[#1B2B4A] truncate" style={{ fontFamily: "'Playfair Display', serif" }}>{session.skill_title}</span>
            </div>
            <div className="flex items-center gap-2 ml-auto flex-wrap">
              {session.duration && (
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background: "rgba(200,169,81,0.1)", color: "#A9863A", border: "1px solid rgba(200,169,81,0.2)" }}>
                  {session.duration} min
                </span>
              )}
              {session.price && (
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full flex items-center gap-1" style={{ background: "#F3ECD9", color: "#A9863A", border: "1px solid rgba(200,169,81,0.2)" }}>
                  <FiDollarSign size={10} />{session.price}
                </span>
              )}
              {session.skill_level && (
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background: "#F3ECD9", color: "#4A5568", border: "1px solid rgba(200,169,81,0.15)" }}>
                  {session.skill_level}
                </span>
              )}
              <StatusBadge status={session.status} />
            </div>
          </div>

          {/* Divider */}
          <div className="mt-3 mb-3" style={{ borderTop: "1px solid rgba(200,169,81,0.1)" }} />

          {/* Row 2: date · time · actions */}
          <div className="flex items-center gap-5 flex-wrap">
            <span className="flex items-center gap-1.5 text-sm text-[#4A5568]">
              <FiCalendar size={13} style={{ color: "#C8A951" }} />{date}
            </span>
            <span className="flex items-center gap-1.5 text-sm text-[#4A5568]">
              <FiClock size={13} style={{ color: "#C8A951" }} />{time}
            </span>

            <div className="flex items-center gap-2 ml-auto flex-wrap">
              {activeTab === "upcoming" && (
                <>
                  {session.status === "accepted" ? (
                    <ActionBtn onClick={() => !expired && navigate(`/session/${session.id}`)} icon={FiVideo}
                      label={expired ? "Expired" : "Join"} variant={expired ? "default" : "primary"} />
                  ) : (
                    <ActionBtn onClick={() => {}} icon={FiVideo} label="Pending" variant="default" />
                  )}
                  {!expired && <ActionBtn onClick={() => onCancel(session)} icon={FiX} label="Cancel" variant="danger" />}
                  {session.status === "accepted" && (
                    <>
                      <ActionBtn onClick={() => navigate(`/chat/${session.id}`)} icon={FiMessageSquare} label="Chat"
                        badge={<UnreadBadge count={session.unread_messages} />} />
                      <ActionBtn onClick={() => onSetMeetingLink(session)} icon={FiLink}
                        label={session.meeting_link ? "Update Link" : "Add Link"} />
                    </>
                  )}
                </>
              )}
              {activeTab === "past" && (
                <>
                  <ActionBtn onClick={() => onUploadNotes(session.id, !!session.notes_file)}
                    icon={session.notes_file ? FiCheck : FiUpload}
                    label={session.notes_file ? "Notes ✓" : "Upload Notes"} />
                  <ActionBtn onClick={() => navigate(`/chat/${session.id}`)} icon={FiMessageSquare} label="Chat"
                    badge={<UnreadBadge count={session.unread_messages} />} />
                </>
              )}
            </div>
          </div>

          {/* Feedback (past only) */}
          {activeTab === "past" && (
            <div className="mt-3 pt-3" style={{ borderTop: "1px solid rgba(200,169,81,0.1)" }}>
              {session.feedback ? (
                <SessionFeedbackCard
                  title="Student review"
                  subtitle={session.feedback.student_name}
                  badgeLabel="Published"
                  rating={session.feedback.rating}
                  comment={session.feedback.comment}
                  date={new Date(session.feedback.created_at).toLocaleDateString()}
                  tone="gold"
                />
              ) : (
                <p className="text-xs text-center" style={{ color: "rgba(74,85,104,0.5)" }}>No feedback yet.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
};

// ─── Group Session Card (coach-facing) ──────────────────────────────────────────
const GroupCard = ({ s, index, onJoin, onChat, onRoster }) => {
  const date = new Date(s.start_datetime).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const time = new Date(s.start_datetime).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
  const cancelled = s.status === "cancelled";
  const upcoming = new Date(s.end_datetime) > new Date();
  // Joinable from 15 min before start until the scheduled end.
  const canJoin = !cancelled && upcoming && Date.now() >= new Date(s.start_datetime).getTime() - 15 * 60 * 1000;
  const badge = cancelled ? "cancelled" : upcoming ? "scheduled" : "completed";
  const badgeStyle = {
    scheduled: { bg: "rgba(52,168,83,0.1)",  color: "#2E7D32", border: "1px solid rgba(52,168,83,0.25)" },
    completed: { bg: "rgba(200,169,81,0.12)", color: "#A9863A", border: "1px solid rgba(200,169,81,0.3)" },
    cancelled: { bg: "rgba(239,68,68,0.08)", color: "#B91C1C", border: "1px solid rgba(239,68,68,0.2)" },
  }[badge];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, delay: index * 0.04 }}
      className="rounded-2xl overflow-hidden"
      style={{ background: "white", border: "1px solid rgba(200,169,81,0.18)", boxShadow: "0 2px 12px rgba(27,43,74,0.06)" }}
    >
      <div className="flex">
        <div className="w-1.5 shrink-0" style={{ background: "linear-gradient(180deg,#C8A951,#C8A95155)" }} />
        <div className="flex-1 px-4 sm:px-5 py-4">
          {/* Row 1: icon + title */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0" style={{ background: "#C8A951", color: "#14213D" }}>
              <FiUsers size={15} />
            </div>
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-xs font-semibold" style={{ color: "#A9863A" }}>{s.seats_taken}/{s.capacity} seats · ${s.price_per_seat}/seat</span>
              <span className="text-base font-normal text-[#1B2B4A] truncate" style={{ fontFamily: "'Playfair Display', serif" }}>{s.title}</span>
            </div>
          </div>
          {/* Badges row */}
          <div className="flex items-center gap-1.5 mt-2">
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background: "#F3ECD9", color: "#A9863A", border: "1px solid rgba(200,169,81,0.2)" }}>Group</span>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background: badgeStyle.bg, color: badgeStyle.color, border: badgeStyle.border }}>
              {badge.charAt(0).toUpperCase() + badge.slice(1)}
            </span>
          </div>

          <div className="mt-3 mb-3" style={{ borderTop: "1px solid rgba(200,169,81,0.1)" }} />

          {/* Date + time */}
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5 text-sm text-[#4A5568]"><FiCalendar size={13} style={{ color: "#C8A951" }} />{date}</span>
            <span className="flex items-center gap-1.5 text-sm text-[#4A5568]"><FiClock size={13} style={{ color: "#C8A951" }} />{time}</span>
          </div>
          {/* Actions */}
          <div className="flex items-center gap-2 flex-wrap mt-3">
            {!cancelled && upcoming && (
              canJoin
                ? <ActionBtn onClick={() => onJoin(s.id)} icon={FiVideo} label="Join Call" variant="primary" />
                : <ActionBtn onClick={() => {}} icon={FiVideo} label="Opens 15 min before" variant="default" />
            )}
            {!cancelled && <ActionBtn onClick={() => onChat(s.id)} icon={FiMessageSquare} label="Group Chat" />}
            <ActionBtn onClick={() => onRoster(s.id)} icon={FiUsers} label="Roster" />
          </div>
        </div>
      </div>
    </motion.div>
  );
};

const PAGE_SIZE = 4;

const Pagination = ({ page, totalPages, onChange }) => {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-2 mt-6">
      <button
        onClick={() => onChange(page - 1)}
        disabled={page === 1}
        className="px-4 py-2 rounded-xl text-sm font-semibold transition-all disabled:opacity-30"
        style={{ background: "white", border: "1px solid rgba(200,169,81,0.25)", color: "#4A5568" }}
      >
        ← Prev
      </button>
      {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
        <button
          key={p}
          onClick={() => onChange(p)}
          className="w-9 h-9 rounded-xl text-sm font-bold transition-all"
          style={{
            background: p === page ? "#C8A951" : "white",
            color: p === page ? "#14213D" : "#4A5568",
            border: `1px solid ${p === page ? "#C8A951" : "rgba(200,169,81,0.25)"}`,
          }}
        >
          {p}
        </button>
      ))}
      <button
        onClick={() => onChange(page + 1)}
        disabled={page === totalPages}
        className="px-4 py-2 rounded-xl text-sm font-semibold transition-all disabled:opacity-30"
        style={{ background: "white", border: "1px solid rgba(200,169,81,0.25)", color: "#4A5568" }}
      >
        Next →
      </button>
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────
const MySessions = () => {
  const [sessions, setSessions] = useState([]);
  const [groupSessions, setGroupSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("upcoming");
  const [page, setPage] = useState(1);

  // Group roster modal
  const [rosterSession, setRosterSession] = useState(null);
  const [roster, setRoster] = useState([]);
  const [rosterLoading, setRosterLoading] = useState(false);

  // Filters
  const [search, setSearch] = useState("");
  const [learnerFilter, setLearnerFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortOrder, setSortOrder] = useState("newest");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const navigate = useNavigate();
  const { isAuthenticated, isCoach, logout } = useAuth();

  const fetchSessions = useCallback(async () => {
    if (!isAuthenticated || !isCoach()) { logout(); return; }
    setLoading(true);
    try {
      const [res, gres] = await Promise.all([
        api.get("/bookings/"),
        api.get("/bookings/group-sessions/"),
      ]);
      setSessions(res.data);
      setGroupSessions(gres.data);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to load sessions.");
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, isCoach, logout]);

  const openRoster = async (id) => {
    setRosterSession(groupSessions.find(g => g.id === id) || { id });
    setRoster([]);
    setRosterLoading(true);
    try {
      const res = await api.get(`/bookings/group-sessions/${id}/roster/`);
      setRoster(res.data);
    } catch {
      toast.error("Failed to load roster.");
    } finally {
      setRosterLoading(false);
    }
  };

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  const now = new Date();
  const upcomingSessions = sessions.filter(s => {
    const dt = new Date(`${s.session_date}T${s.session_time}`);
    // Still upcoming only if not yet completed and the scheduled time hasn't passed
    return (s.status === "pending" || s.status === "accepted") && dt > now;
  });
  const pastSessions = sessions.filter(s => {
    const dt = new Date(`${s.session_date}T${s.session_time}`);
    // Completed sessions always belong here, plus accepted ones whose time has passed
    return s.status === "completed" || (s.status === "accepted" && dt <= now);
  });

  const [cancelTarget, setCancelTarget] = useState(null);
  const handleCancel = async () => {
    if (!cancelTarget) return;
    try {
      await api.patch(`/bookings/${cancelTarget.id}/coach-cancel/`);
      await fetchSessions();
      toast.success("Session cancelled. The client has been refunded.");
    } catch {
      toast.error("Failed to cancel session.");
    } finally {
      setCancelTarget(null);
    }
  };

  const [meetingTarget, setMeetingTarget] = useState(null);
  const [meetingLink, setMeetingLink] = useState("");
  const handleSaveMeetingLink = async () => {
    try {
      await api.patch(`/bookings/${meetingTarget.id}/`, { meeting_link: meetingLink });
      await fetchSessions();
      toast.success("Meeting link saved.");
    } catch {
      toast.error("Failed to save meeting link.");
    } finally {
      setMeetingTarget(null);
      setMeetingLink("");
    }
  };

  const handleUploadNotes = async (id, hasNotes) => {
    if (hasNotes) {
      const s = sessions.find(x => x.id === id);
      if (s?.notes_file) window.open(s.notes_file, "_blank");
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pdf,.doc,.docx,.txt";
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const fd = new FormData();
      fd.append("notes_file", file);
      try {
        await api.patch(`/bookings/upload-notes/${id}/`, fd, { headers: { "Content-Type": "multipart/form-data" } });
        toast.success("Notes uploaded.");
        await fetchSessions();
      } catch {
        toast.error("Failed to upload notes.");
      }
    };
    input.click();
  };

  const joinSession = (link) => {
    if (link) window.open(link, "_blank");
    else toast.error("No meeting link available yet.");
  };

  const totalEarnings = sessions
    .filter(s => s.status === "completed")
    .reduce((sum, s) => sum + (parseFloat(s.price) || 0), 0);

  const applyFilters = (list) => {
    let out = [...list];
    if (search.trim())
      out = out.filter(s => s.skill_title?.toLowerCase().includes(search.trim().toLowerCase()));
    if (learnerFilter.trim())
      out = out.filter(s => s.learner_username?.toLowerCase().includes(learnerFilter.trim().toLowerCase()));
    if (dateFrom)
      out = out.filter(s => s.session_date >= dateFrom);
    if (dateTo)
      out = out.filter(s => s.session_date <= dateTo);
    out.sort((a, b) => {
      const dtA = new Date(`${a.session_date}T${a.session_time}`);
      const dtB = new Date(`${b.session_date}T${b.session_time}`);
      return sortOrder === "newest" ? dtB - dtA : dtA - dtB;
    });
    return out;
  };

  const hasActiveFilters = search || learnerFilter || dateFrom || dateTo || sortOrder !== "newest";
  const resetFilters = () => { setSearch(""); setLearnerFilter(""); setDateFrom(""); setDateTo(""); setSortOrder("newest"); setPage(1); };

  const filteredSessions = applyFilters(activeTab === "upcoming" ? upcomingSessions : pastSessions);
  const totalPages = Math.ceil(filteredSessions.length / PAGE_SIZE);
  const pagedSessions = filteredSessions.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (loading) return (
    <div className="flex justify-center items-center min-h-screen" style={{ background: "#FAF6EC" }}>
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "#C8A951", borderTopColor: "transparent" }} />
        <p className="text-sm" style={{ color: "rgba(74,85,104,0.7)" }}>Loading sessions...</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen pt-36 pb-16 px-6" style={{ background: "#FAF6EC" }}>
      <div className="max-w-5xl mx-auto">

        {/* ── Header ──────────────────────────────────────── */}
        <motion.div
          className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-8"
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
        >
          <div>
            <h1 className="text-3xl md:text-4xl font-normal text-[#1B2B4A]" style={{ fontFamily: "'Playfair Display', serif" }}>My Sessions</h1>
          </div>

          {/* Earnings card */}
          <div className="rounded-2xl px-5 py-4 flex items-center gap-3" style={{ background: "#F3ECD9", border: "1px solid rgba(200,169,81,0.25)" }}>
            <FiDollarSign size={18} style={{ color: "#C8A951" }} />
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "rgba(74,85,104,0.7)" }}>Total Earnings</p>
              <p className="text-2xl font-bold text-[#1B2B4A]" style={{ fontFamily: "'Playfair Display', serif" }}>
                ${totalEarnings.toFixed(0)}
              </p>
            </div>
          </div>
        </motion.div>

        {/* ── Tabs ────────────────────────────────────────── */}
        <motion.div
          className="mb-6 -mx-6 sm:mx-0"
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1 }}
        >
          <div className="overflow-x-auto px-6 sm:px-0 pb-1">
            <div className="flex gap-2 min-w-max">
              {[
                { key: "upcoming", label: "Upcoming", count: upcomingSessions.length, icon: FiCalendar },
                { key: "past",     label: "Completed", count: pastSessions.length,   icon: FiCheck },
                { key: "group",    label: "Group Sessions", count: groupSessions.length, icon: FiUsers },
              ].map(tab => (
                <button
                  key={tab.key}
                  onClick={() => { setActiveTab(tab.key); setPage(1); }}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold transition-all duration-200 shrink-0"
                  style={{
                    background: activeTab === tab.key ? "#C8A951" : "white",
                    color: activeTab === tab.key ? "#14213D" : "#4A5568",
                    border: `1px solid ${activeTab === tab.key ? "#C8A951" : "rgba(200,169,81,0.25)"}`,
                  }}
                >
                  <tab.icon size={14} />
                  {tab.label}
                  <span className="text-xs opacity-70">({tab.count})</span>
                </button>
              ))}
            </div>
          </div>
        </motion.div>

        {/* ── Filters ─────────────────────────────────────── */}
        {activeTab !== "group" && (
        <motion.div className="mb-5" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.15 }}>
          {/* Search + toggle row */}
          <div className="flex gap-2 mb-2">
            <div className="flex-1 relative">
              <FiSearch size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "rgba(74,85,104,0.5)" }} />
              <input
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
                placeholder="Search by skill name…"
                className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm outline-none"
                style={{ background: "white", border: "1px solid rgba(200,169,81,0.25)", color: "#1B2B4A" }}
              />
            </div>
            <button
              onClick={() => setFiltersOpen(o => !o)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all"
              style={{
                background: filtersOpen || hasActiveFilters ? "rgba(200,169,81,0.15)" : "white",
                border: `1px solid ${hasActiveFilters ? "#C8A951" : "rgba(200,169,81,0.25)"}`,
                color: "#4A5568",
              }}
            >
              <FiFilter size={13} />
              Filters
              {hasActiveFilters && <span className="w-2 h-2 rounded-full bg-[#C8A951]" />}
              <FiChevronDown size={13} style={{ transform: filtersOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
            </button>
            {hasActiveFilters && (
              <button onClick={resetFilters} className="px-3 py-2.5 rounded-xl text-xs font-semibold transition-all" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#B91C1C" }}>
                Clear
              </button>
            )}
          </div>

          {/* Expanded filter panel */}
          <AnimatePresence>
            {filtersOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 rounded-xl mt-1" style={{ background: "white", border: "1px solid rgba(200,169,81,0.2)" }}>
                  <div>
                    <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wide" style={{ color: "rgba(74,85,104,0.7)" }}>Client name</label>
                    <input
                      value={learnerFilter}
                      onChange={e => { setLearnerFilter(e.target.value); setPage(1); }}
                      placeholder="e.g. john"
                      className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                      style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.2)", color: "#1B2B4A" }}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wide" style={{ color: "rgba(74,85,104,0.7)" }}>From date</label>
                    <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }}
                      className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                      style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.2)", color: "#1B2B4A" }} />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wide" style={{ color: "rgba(74,85,104,0.7)" }}>To date</label>
                    <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }}
                      className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                      style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.2)", color: "#1B2B4A" }} />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wide" style={{ color: "rgba(74,85,104,0.7)" }}>Sort by date</label>
                    <select value={sortOrder} onChange={e => { setSortOrder(e.target.value); setPage(1); }}
                      className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                      style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.2)", color: "#1B2B4A" }}>
                      <option value="newest">Newest first</option>
                      <option value="oldest">Oldest first</option>
                    </select>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Active filter summary */}
          {hasActiveFilters && (
            <p className="text-xs mt-2" style={{ color: "rgba(74,85,104,0.65)" }}>
              Showing <strong>{filteredSessions.length}</strong> result{filteredSessions.length !== 1 ? "s" : ""}
            </p>
          )}
        </motion.div>
        )}

        {/* ── Group Sessions List ──────────────────────────── */}
        {activeTab === "group" ? (
          groupSessions.length === 0 ? (
            <div className="text-center py-20 rounded-2xl" style={{ background: "white", border: "1px solid rgba(200,169,81,0.15)" }}>
              <p className="text-5xl mb-4">👥</p>
              <h3 className="text-xl font-normal text-[#1B2B4A] mb-2" style={{ fontFamily: "'Playfair Display', serif" }}>No group sessions yet</h3>
              <p className="text-sm text-[#4A5568]">Create a group session from the Availability page.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {groupSessions.map((s, i) => (
                <GroupCard
                  key={s.id} s={s} index={i}
                  onJoin={(id) => navigate(`/group-session/${id}/call`)}
                  onChat={(id) => navigate(`/group-chat/${id}`)}
                  onRoster={openRoster}
                />
              ))}
            </div>
          )
        ) : (
        <>
        {/* ── Sessions List / Empty ────────────────────────── */}
        <AnimatePresence mode="wait">
          {filteredSessions.length === 0 ? (
            <motion.div
              key="empty"
              className="text-center py-20 rounded-2xl"
              style={{ background: "white", border: "1px solid rgba(200,169,81,0.15)" }}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            >
              <p className="text-5xl mb-4">{activeTab === "upcoming" ? "📅" : "✅"}</p>
              <h3 className="text-xl font-normal text-[#1B2B4A] mb-2" style={{ fontFamily: "'Playfair Display', serif" }}>
                No {activeTab === "upcoming" ? "upcoming" : "completed"} sessions
              </h3>
              <p className="text-sm text-[#4A5568]">
                {activeTab === "upcoming"
                  ? "You don't have any upcoming sessions yet."
                  : "Your completed sessions will appear here."}
              </p>
            </motion.div>
          ) : (
            <motion.div
              key="list"
              className="space-y-4"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            >
              {pagedSessions.map((session, i) => (
                <SessionCard
                  key={session.id}
                  session={session}
                  index={i}
                  activeTab={activeTab}
                  onCancel={setCancelTarget}
                  onSetMeetingLink={(s) => { setMeetingTarget(s); setMeetingLink(s.meeting_link || ""); }}
                  onUploadNotes={handleUploadNotes}
                  onJoin={joinSession}
                  navigate={navigate}
                />
              ))}
            </motion.div>
          )}
        </AnimatePresence>
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
        </>
        )}
      </div>

      {/* ── Cancel Confirmation Modal ────────────────────── */}
      <AnimatePresence>
        {cancelTarget && (
          <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-4"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setCancelTarget(null)} />
            <motion.div
              className="relative rounded-2xl p-8 w-full max-w-sm text-center z-10"
              style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.2)" }}
              initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
            >
              <p className="text-4xl mb-4">⚠️</p>
              <h3 className="text-xl font-normal text-[#1B2B4A] mb-2" style={{ fontFamily: "'Playfair Display', serif" }}>Cancel Session</h3>
              <p className="text-sm text-[#4A5568] mb-6">
                Cancel your session with <strong>{cancelTarget.learner_username}</strong>? The time slot reopens and the client is refunded.
              </p>
              <div className="flex gap-3">
                <button onClick={() => setCancelTarget(null)} className="flex-1 py-2.5 rounded-full text-sm font-semibold border" style={{ borderColor: "rgba(200,169,81,0.3)", color: "#4A5568" }}>
                  Keep It
                </button>
                <button onClick={handleCancel} className="flex-1 py-2.5 rounded-full text-sm font-bold text-white" style={{ background: "#DC2626" }}>
                  Cancel Session
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Meeting Link Modal ───────────────────────────── */}
      <AnimatePresence>
        {meetingTarget && (
          <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-4"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setMeetingTarget(null)} />
            <motion.div
              className="relative rounded-2xl p-8 w-full max-w-md z-10"
              style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.2)" }}
              initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              onClick={e => e.stopPropagation()}
            >
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4" style={{ background: "rgba(200,169,81,0.15)" }}>
                <FiLink size={20} style={{ color: "#C8A951" }} />
              </div>
              <h3 className="text-xl font-normal text-[#1B2B4A] mb-2" style={{ fontFamily: "'Playfair Display', serif" }}>Meeting Link</h3>
              <p className="text-sm text-[#4A5568] mb-5">Add a Zoom, Google Meet, or Jitsi link for this session.</p>
              <input
                type="url"
                placeholder="https://meet.jit.si/your-room"
                value={meetingLink}
                onChange={e => setMeetingLink(e.target.value)}
                className="w-full px-4 py-3 rounded-xl text-sm focus:outline-none mb-5"
                style={{ background: "white", border: "1px solid rgba(200,169,81,0.3)", color: "#1B2B4A" }}
                onFocus={e => e.target.style.borderColor = "#C8A951"}
                onBlur={e => e.target.style.borderColor = "rgba(200,169,81,0.3)"}
              />
              <div className="flex gap-3">
                <button onClick={() => setMeetingTarget(null)} className="flex-1 py-2.5 rounded-full text-sm font-semibold border" style={{ borderColor: "rgba(200,169,81,0.3)", color: "#4A5568" }}>
                  Cancel
                </button>
                <button onClick={handleSaveMeetingLink} className="flex-1 gold-btn py-2.5 rounded-full text-sm font-bold">
                  Save Link
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Roster Modal ─────────────────────────────────── */}
      <AnimatePresence>
        {rosterSession && (
          <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-4"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setRosterSession(null)} />
            <motion.div
              className="relative rounded-2xl p-6 w-full max-w-md z-10"
              style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.2)" }}
              initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(200,169,81,0.15)" }}>
                  <FiUsers size={18} style={{ color: "#C8A951" }} />
                </div>
                <div className="min-w-0">
                  <h3 className="text-lg font-normal text-[#1B2B4A] truncate" style={{ fontFamily: "'Playfair Display', serif" }}>{rosterSession.title || "Roster"}</h3>
                  <p className="text-xs text-[#4A5568]">{roster.length} participant{roster.length !== 1 ? "s" : ""}</p>
                </div>
              </div>

              {rosterLoading ? (
                <p className="text-sm text-center py-8" style={{ color: "rgba(74,85,104,0.6)" }}>Loading…</p>
              ) : roster.length === 0 ? (
                <p className="text-sm text-center py-8" style={{ color: "rgba(74,85,104,0.6)" }}>No participants yet.</p>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto">
                  {roster.map(r => (
                    <div key={r.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl" style={{ background: "white", border: "1px solid rgba(200,169,81,0.15)" }}>
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ background: "#C8A951", color: "#14213D" }}>
                        {r.learner_username?.charAt(0).toUpperCase()}
                      </div>
                      <span className="text-sm font-medium text-[#1B2B4A] flex-1 truncate">{r.learner_username}</span>
                      <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{
                        background: r.status === "booked" ? "rgba(52,168,83,0.1)" : "rgba(251,191,36,0.12)",
                        color: r.status === "booked" ? "#2E7D32" : "#92400E",
                      }}>
                        {r.status === "booked" ? "Booked" : "Held"}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <button onClick={() => setRosterSession(null)} className="w-full mt-5 py-2.5 rounded-full text-sm font-semibold border" style={{ borderColor: "rgba(200,169,81,0.3)", color: "#4A5568" }}>
                Close
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default MySessions;
