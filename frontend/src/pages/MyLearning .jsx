import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  FiCalendar, FiClock, FiCheckCircle, FiXCircle,
  FiEdit, FiMessageSquare, FiStar, FiDownload, FiFileText,
  FiArrowRight, FiVideo, FiBookOpen, FiUsers,
  FiSearch, FiFilter, FiChevronDown,
} from "react-icons/fi";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "react-toastify";
import { api } from "../utils/auth";
import { SESSION_REJOIN_MS, isSessionLive, isUpcomingSession, ordinal } from "../utils/sessionTiming";
import { useAuth } from "../context/AuthContext";
import SessionFeedbackCard from "../components/SessionFeedbackCard";
import AddToCalendar from "../components/AddToCalendar";
import SessionReflectionModal from "../components/SessionReflectionModal";
import SessionSummaryModal from "../components/SessionSummaryModal";
import GoogleCalendarCard from "../components/GoogleCalendarCard";
import { downloadFile } from "../utils/downloadFile";

// ─── Status Badge ─────────────────────────────────────────────────────────────
const STATUS_LABELS = {
  pending: "Pending", accepted: "Accepted", completed: "Completed",
  cancelled: "Cancelled", declined: "Declined", no_show: "No Show",
  held_offline: "Held off-platform", not_held: "Did not take place",
};

const StatusBadge = ({ status }) => {
  const map = {
    pending:   { bg: "rgba(251,191,36,0.12)", color: "#92400E", border: "1px solid rgba(251,191,36,0.3)" },
    accepted:  { bg: "rgba(52,168,83,0.1)",   color: "#2E7D32", border: "1px solid rgba(52,168,83,0.25)" },
    completed: { bg: "rgba(200,169,81,0.12)", color: "#A9863A", border: "1px solid rgba(200,169,81,0.3)" },
    held_offline: { bg: "rgba(52,168,83,0.1)", color: "#2E7D32", border: "1px solid rgba(52,168,83,0.25)" },
    cancelled: { bg: "rgba(239,68,68,0.08)", color: "#B91C1C", border: "1px solid rgba(239,68,68,0.2)" },
    declined:  { bg: "rgba(239,68,68,0.08)", color: "#B91C1C", border: "1px solid rgba(239,68,68,0.2)" },
    no_show:   { bg: "rgba(239,68,68,0.08)", color: "#B91C1C", border: "1px solid rgba(239,68,68,0.2)" },
    not_held:  { bg: "rgba(74,85,104,0.08)", color: "#4A5568", border: "1px solid rgba(74,85,104,0.2)" },
  };
  const s = map[status] || map.pending;
  const label = STATUS_LABELS[status] || (status.charAt(0).toUpperCase() + status.slice(1));
  return (
    <span className="text-xs font-semibold px-3 py-1 rounded-full shrink-0" style={{ background: s.bg, color: s.color, border: s.border }}>
      {label}
    </span>
  );
};

// Why a session is a no-show (factual — same wording for coach + client).
const noShowReason = (session) => {
  const by = session.no_show_by;
  const fmtJoin = (ts) => (ts ? "joined" : "didn't join");
  const detail = `Coach ${fmtJoin(session.coach_joined_at)} · Client ${fmtJoin(session.client_joined_at)}.`;
  const lead = by === "both" ? "Neither of you joined, so the session didn't take place."
    : by === "coach" ? "The coach didn't join this session."
      : by === "client" ? "The client didn't join this session."
        : "This session wasn't attended by both parties.";
  return `${lead} ${detail} A session completes only when both people join.`;
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
const ActionBtn = ({ onClick, icon: Icon, label, badge, variant = "default", disabled = false }) => {
  const styles = {
    default: { background: "rgba(200,169,81,0.1)", color: "#A9863A", border: "1px solid rgba(200,169,81,0.25)" },
    danger:  { background: "rgba(239,68,68,0.08)", color: "#B91C1C", border: "1px solid rgba(239,68,68,0.2)" },
    primary: { background: "linear-gradient(135deg,#C8A951,#F0D98C)", color: "#14213D", border: "none" },
    muted:   { background: "rgba(200,169,81,0.05)", color: "rgba(74,85,104,0.5)", border: "1px solid rgba(200,169,81,0.15)", cursor: "not-allowed" },
  }[disabled ? "muted" : variant];
  return (
    <motion.button
      whileHover={!disabled ? { scale: 1.02 } : {}}
      whileTap={!disabled ? { scale: 0.97 } : {}}
      onClick={!disabled ? onClick : undefined}
      className="flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-full text-xs font-semibold whitespace-nowrap shrink-0 transition-all duration-200"
      style={styles}
    >
      <Icon size={13} />
      {label}
      {badge}
    </motion.button>
  );
};

// ─── Session Card (compact) ────────────────────────────────────────────────────
const SessionCard = ({ session, activeTab, onCancel, onFeedback, onDownload, onReflect, onSummary, navigate, index }) => {
  const { timezone } = useAuth(); // viewer's display timezone
  // Absolute UTC start, rendered in the viewer's timezone. slot_start is the
  // source of truth; fall back to session_date/time treated as UTC ("Z").
  const startDt = session.slot_start
    ? new Date(session.slot_start)
    : new Date(`${session.session_date}T${session.session_time}Z`);
  const date = startDt.toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", timeZone: timezone || undefined,
  });
  const time = startDt.toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", hour12: true, timeZone: timezone || undefined,
  });

  const accentColor = activeTab === "upcoming"
    ? (session.status === "accepted" ? "#34A853" : "#F59E0B")
    : "#C8A951";

  const sessionEndMs = session.slot_end
    ? new Date(session.slot_end).getTime()
    : startDt.getTime() + session.duration * 60 * 1000;
  // Joinable through the whole rejoin window so it can be reconnected / continued (N3).
  const expired = sessionEndMs + SESSION_REJOIN_MS < Date.now();

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: index * 0.04 }}
      className="rounded-2xl overflow-hidden"
      style={{ background: "white", border: "1px solid rgba(200,169,81,0.18)", boxShadow: "0 2px 12px rgba(27,43,74,0.06)" }}
    >
      <div className="flex">
        <div className="w-1.5 shrink-0" style={{ background: `linear-gradient(180deg, ${accentColor}, ${accentColor}55)` }} />

        <div className="flex-1 px-4 sm:px-5 py-4">
          {/* Row 1: avatar · coach + skill */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0" style={{ background: "#C8A951", color: "#14213D" }}>
              {(session.mentor_name || session.mentor_username)?.charAt(0).toUpperCase()}
            </div>
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-xs font-semibold" style={{ color: "#A9863A" }}>{session.mentor_name || session.mentor_username}</span>
              <span className="text-base font-normal text-[#1B2B4A] truncate" style={{ fontFamily: "'Playfair Display', serif" }}>{session.skill_title}</span>
            </div>
            <StatusBadge status={session.status} />
          </div>

          {/* Badges row */}
          <div className="flex items-center gap-1.5 flex-wrap mt-2">
            {session.duration && (
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background: "rgba(200,169,81,0.1)", color: "#A9863A", border: "1px solid rgba(200,169,81,0.2)" }}>
                {session.duration} min
              </span>
            )}
            {session.price && (
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background: "#F3ECD9", color: "#A9863A", border: "1px solid rgba(200,169,81,0.2)" }}>
                ${session.price}
              </span>
            )}
            {/* Which session this is on this programme (replaces the skill level). */}
            {session.session_number && (
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background: "#F3ECD9", color: "#4A5568", border: "1px solid rgba(200,169,81,0.15)" }}>
                {ordinal(session.session_number)} session
              </span>
            )}
          </div>

          {/* Divider */}
          <div className="mt-3 mb-3" style={{ borderTop: "1px solid rgba(200,169,81,0.1)" }} />

          {/* Date + time */}
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5 text-sm text-[#4A5568]">
              <FiCalendar size={13} style={{ color: "#C8A951" }} />{date}
            </span>
            <span className="flex items-center gap-1.5 text-sm text-[#4A5568]">
              <FiClock size={13} style={{ color: "#C8A951" }} />{time}
            </span>
          </div>

          {/* Action buttons — full width row below on mobile */}
          <div className="flex items-center gap-2 flex-wrap mt-3">
              {activeTab === "upcoming" && (
                <>
                  {session.status === "accepted" ? (
                    <ActionBtn onClick={() => navigate(`/session/${session.id}`)} icon={FiVideo}
                      label={expired ? "Expired" : "Join Session"} variant={expired ? "muted" : "primary"} disabled={expired} />
                  ) : (
                    <ActionBtn icon={FiVideo} label="Awaiting" disabled />
                  )}
                  {session.status === "accepted" && !expired && (
                    <ActionBtn onClick={() => navigate(`/chat/${session.id}`)} icon={FiMessageSquare} label="Chat"
                      badge={<UnreadBadge count={session.unread_messages} />} />
                  )}
                  {session.status === "accepted" && !expired && <AddToCalendar session={session} />}
                  {session.skill && <ActionBtn onClick={() => navigate(`/programme/${session.skill}`)} icon={FiBookOpen} label="Programme" />}
                  {!expired && <ActionBtn onClick={() => onCancel(session.id)} icon={FiXCircle} label="Cancel" variant="danger" />}
                  {session.notes_file && <ActionBtn onClick={() => onDownload(session)} icon={FiDownload} label="Notes" />}
                  {session.payment_status === "paid" && Number(session.amount_paid) > 0 && (
                    <ActionBtn onClick={() => downloadFile(`/bookings/${session.id}/invoice/`, "receipt.pdf")} icon={FiFileText} label="Receipt" />
                  )}
                </>
              )}
              {activeTab === "past" && (
                <>
                  {!session.feedback && (
                    <ActionBtn onClick={() => onFeedback(session.id)} icon={FiStar} label="Leave Feedback" variant="primary" />
                  )}
                  <ActionBtn onClick={() => navigate(`/chat/${session.id}`)} icon={FiMessageSquare} label="Chat"
                    badge={<UnreadBadge count={session.unread_messages} />} />
                  {session.notes_file && <ActionBtn onClick={() => onDownload(session)} icon={FiDownload} label="Notes" />}
                  <ActionBtn onClick={() => onReflect(session)} icon={FiEdit}
                    label={session.has_reflection ? "My Notes ✓" : "Add Notes"} />
                  {session.has_summary && (
                    <ActionBtn onClick={() => onSummary(session)} icon={FiFileText} label="AI Summary" />
                  )}
                  {session.skill && <ActionBtn onClick={() => navigate(`/programme/${session.skill}`)} icon={FiBookOpen} label="Programme" />}
                  {session.payment_status === "paid" && Number(session.amount_paid) > 0 && (
                    <ActionBtn onClick={() => downloadFile(`/bookings/${session.id}/invoice/`, "receipt.pdf")} icon={FiFileText} label="Receipt" />
                  )}
                  <ActionBtn onClick={() => navigate("/skills")} icon={FiArrowRight} label="Book Again" />
                </>
              )}
          </div>

          {/* No-show explanation */}
          {session.status === "no_show" && (
            <div className="mt-3 flex items-start gap-2 rounded-xl px-3 py-2.5" style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.15)" }}>
              <FiXCircle size={15} style={{ color: "#B91C1C" }} className="mt-0.5 shrink-0" />
              <p className="text-xs leading-relaxed" style={{ color: "#4A5568" }}>
                <span className="font-bold" style={{ color: "#B91C1C" }}>Marked no-show. </span>
                {noShowReason(session)}
              </p>
            </div>
          )}

          {/* Feedback display (past only) */}
          {activeTab === "past" && session.feedback && (
            <div className="mt-3 pt-3" style={{ borderTop: "1px solid rgba(200,169,81,0.1)" }}>
              <SessionFeedbackCard
                title="Your review"
                subtitle={`Shared with ${session.mentor_name || session.mentor_username}`}
                badgeLabel="Submitted"
                rating={session.feedback.rating}
                comment={session.feedback.comment}
                date={new Date(session.feedback.created_at).toLocaleDateString()}
                tone="gold"
              />
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
};

// ─── Group Session Card ─────────────────────────────────────────────────────────
const GroupCard = ({ e, index, onCancel, onJoin, onChat }) => {
  const { timezone } = useAuth();
  const date = new Date(e.start_datetime).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: timezone || undefined });
  const time = new Date(e.start_datetime).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: timezone || undefined });
  const cancelled = e.session_status === "cancelled";
  const upcoming = new Date(e.end_datetime).getTime() + SESSION_REJOIN_MS > Date.now();
  // Joinable from 15 min before start until the scheduled end.
  const canJoin = !cancelled && upcoming && Date.now() >= new Date(e.start_datetime).getTime() - 15 * 60 * 1000;
  const badge = cancelled ? "cancelled" : upcoming ? "upcoming" : "completed";
  const badgeStyle = {
    upcoming:  { bg: "rgba(52,168,83,0.1)",  color: "#2E7D32", border: "1px solid rgba(52,168,83,0.25)" },
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
          {/* Row 1: avatar + coach + title */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0" style={{ background: "#C8A951", color: "#14213D" }}>
              <FiUsers size={15} />
            </div>
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-xs font-semibold" style={{ color: "#A9863A" }}>{e.coach_username}</span>
              <span className="text-base font-normal text-[#1B2B4A] truncate" style={{ fontFamily: "'Playfair Display', serif" }}>{e.title}</span>
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

          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5 text-sm text-[#4A5568]"><FiCalendar size={13} style={{ color: "#C8A951" }} />{date}</span>
            <span className="flex items-center gap-1.5 text-sm text-[#4A5568]"><FiClock size={13} style={{ color: "#C8A951" }} />{time}</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap mt-3">
            {!cancelled && upcoming && (
              canJoin
                ? <ActionBtn onClick={() => onJoin(e.group_session)} icon={FiVideo} label="Join Call" variant="primary" />
                : <ActionBtn icon={FiVideo} label="Opens 15 min before" disabled />
            )}
            {!cancelled && <ActionBtn onClick={() => onChat(e.group_session)} icon={FiMessageSquare} label="Group Chat" />}
            {e.payment_status === "paid" && Number(e.amount_paid) > 0 && (
              <ActionBtn onClick={() => downloadFile(`/bookings/group-enrollments/${e.id}/invoice/`, "receipt.pdf")} icon={FiFileText} label="Receipt" />
            )}
            {!cancelled && upcoming && (
              <ActionBtn onClick={() => onCancel(e.id)} icon={FiXCircle} label="Cancel" variant="danger" />
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────
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

const MyLearning = () => {
  const [sessions, setSessions] = useState([]);
  const [groupEnrollments, setGroupEnrollments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("upcoming");
  const [page, setPage] = useState(1);

  // Filters
  const [search, setSearch] = useState("");
  const [coachFilter, setCoachFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortOrder, setSortOrder] = useState("newest");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [showCancelModal, setShowCancelModal] = useState(false);
  const [sessionToCancelId, setSessionToCancelId] = useState(null);
  const [cancelKind, setCancelKind] = useState("session"); // "session" | "group"
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedbackSession, setFeedbackSession] = useState(null);
  const [reflectSession, setReflectSession] = useState(null);
  const [summarySession, setSummarySession] = useState(null);
  const [feedbackRating, setFeedbackRating] = useState(5);
  const [feedbackComment, setFeedbackComment] = useState("");

  const navigate = useNavigate();
  const { isAuthenticated, isCoach, isAdmin } = useAuth();

  const fetchSessions = useCallback(async () => {
    // This is the client page. Send anyone else to their own area instead of
    // logging them out (a coach following a client link must not get bounced
    // out — that caused a login → "access denied" → logout loop).
    if (!isAuthenticated) { navigate("/login", { replace: true }); return; }
    if (isAdmin()) { navigate("/admin", { replace: true }); return; }
    if (isCoach()) { navigate("/my-sessions", { replace: true }); return; }
    setLoading(true);
    try {
      const [res, gres] = await Promise.all([
        api.get("/bookings/"),
        api.get("/bookings/group-sessions/mine/"),
      ]);
      setSessions(res.data);
      setGroupEnrollments(gres.data);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to load sessions.");
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, isCoach, isAdmin, navigate]);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  // Keep a session in "Upcoming" (with a working Join button) until its rejoin
  // window closes — so a session that has already started, or that you join a few
  // minutes late, stays joinable instead of dropping into Past at its start time.
  // Shared with the navbar badge so the nav count always matches this tab.
  const isLive = (s) => isSessionLive(s);
  const upcomingSessions = sessions.filter(isUpcomingSession);
  const pastSessions = sessions.filter(s =>
    s.status === "completed" || s.status === "held_offline" ||
    ((s.status === "pending" || s.status === "accepted") && !isLive(s))
  );
  const noShowSessions = sessions.filter(s => s.status === "no_show" || s.status === "not_held");

  const handleCancelSession = (id) => { setCancelKind("session"); setSessionToCancelId(id); setShowCancelModal(true); };
  const handleCancelGroup = (id) => { setCancelKind("group"); setSessionToCancelId(id); setShowCancelModal(true); };

  const confirmCancel = async () => {
    try {
      if (cancelKind === "group") {
        await api.patch(`/bookings/group-sessions/${sessionToCancelId}/leave/`, {});
        toast.success("Seat cancelled and refunded.");
      } else {
        await api.patch(`/bookings/${sessionToCancelId}/cancel/`, {});
        toast.success("Session cancelled.");
      }
      await fetchSessions();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to cancel.");
    } finally {
      setSessionToCancelId(null);
      setShowCancelModal(false);
    }
  };

  const handleLeaveFeedback = (id) => {
    setFeedbackSession(sessions.find(s => s.id === id));
    setFeedbackRating(5);
    setFeedbackComment("");
    setShowFeedbackModal(true);
  };

  const submitFeedback = async () => {
    if (!feedbackComment.trim()) { toast.warning("Please write a comment."); return; }
    try {
      await api.post("/bookings/reviews/", {
        mentor_profile: feedbackSession.mentor,
        rating: feedbackRating,
        comment: feedbackComment.trim(),
      });
      toast.success("Feedback submitted! Thank you.");
      setShowFeedbackModal(false);
      setFeedbackSession(null);
      await fetchSessions();
    } catch (err) {
      toast.error(err.response?.data?.detail || err.response?.data?.[0] || "Failed to submit feedback.");
    }
  };

  const handleDownload = (session) => {
    // Goes through the authenticated endpoint: /media/session_notes/ is no longer
    // public, since notes are confidential and their filenames were guessable.
    if (session?.notes_file) downloadFile(`/ops/media/session-notes/${session.id}/`, "session-notes.pdf");
    else toast.info("No notes uploaded yet.");
  };

  const uniqueSkills = [...new Set([...upcomingSessions, ...pastSessions].map(s => s.skill_title))].length;

  const applyFilters = (list) => {
    let out = [...list];
    if (search.trim())
      out = out.filter(s => s.skill_title?.toLowerCase().includes(search.trim().toLowerCase()));
    if (coachFilter.trim())
      out = out.filter(s => `${s.mentor_name || ""} ${s.mentor_username || ""}`.toLowerCase().includes(coachFilter.trim().toLowerCase()));
    if (dateFrom)
      out = out.filter(s => s.session_date >= dateFrom);
    if (dateTo)
      out = out.filter(s => s.session_date <= dateTo);
    out.sort((a, b) => {
      const dtA = new Date(a.slot_start || `${a.session_date}T${a.session_time}Z`);
      const dtB = new Date(b.slot_start || `${b.session_date}T${b.session_time}Z`);
      return sortOrder === "newest" ? dtB - dtA : dtA - dtB;
    });
    return out;
  };

  const hasActiveFilters = search || coachFilter || dateFrom || dateTo || sortOrder !== "newest";
  const resetFilters = () => { setSearch(""); setCoachFilter(""); setDateFrom(""); setDateTo(""); setSortOrder("newest"); setPage(1); };

  const filtered = applyFilters(
    activeTab === "upcoming" ? upcomingSessions
      : activeTab === "no_show" ? noShowSessions
        : pastSessions
  );
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pagedSessions = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (loading) return (
    <div className="flex justify-center items-center min-h-screen" style={{ background: "#FAF6EC" }}>
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "#C8A951", borderTopColor: "transparent" }} />
        <p className="text-sm" style={{ color: "rgba(74,85,104,0.7)" }}>Loading your learning journey...</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen pt-36 pb-16 px-4 sm:px-6 overflow-x-hidden" style={{ background: "#FAF6EC" }}>
      <div className="max-w-5xl mx-auto w-full min-w-0">

        {/* ── Header ──────────────────────────────────────── */}
        <motion.div className="mb-6" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <h1 className="text-2xl md:text-4xl font-normal text-[#1B2B4A]" style={{ fontFamily: "'Playfair Display', serif" }}>My Learning Journey</h1>
        </motion.div>

        {/* Google Calendar connect (auto-add sessions) */}
        <GoogleCalendarCard />

        {/* ── Stats ───────────────────────────────────────── */}
        <motion.div className="grid grid-cols-3 gap-2 sm:gap-4 mb-6" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1 }}>
          {[
            { label: "Upcoming", value: upcomingSessions.length, bg: "#F3ECD9" },
            { label: "Completed", value: pastSessions.length, bg: "white" },
            { label: "Skills", value: uniqueSkills, bg: "white" },
          ].map(s => (
            <div key={s.label} className="rounded-2xl p-3 sm:p-5" style={{ background: s.bg, border: "1px solid rgba(200,169,81,0.15)" }}>
              <p className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider mb-1 truncate" style={{ color: "rgba(74,85,104,0.6)" }}>{s.label}</p>
              <p className="text-2xl sm:text-3xl font-bold text-[#1B2B4A]" style={{ fontFamily: "'Playfair Display', serif" }}>{s.value}</p>
            </div>
          ))}
        </motion.div>

        {/* ── Tabs ────────────────────────────────────────── */}
        <motion.div className="mb-5 -mx-4 sm:mx-0" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.15 }}>
          <div className="overflow-x-auto px-4 sm:px-0 pb-1">
            <div className="flex gap-2 min-w-max">
              {[
                { key: "upcoming", label: "Upcoming", count: upcomingSessions.length, icon: FiCalendar },
                { key: "past",     label: "Past Sessions", count: pastSessions.length, icon: FiCheckCircle },
                { key: "no_show",  label: "No Show", count: noShowSessions.length, icon: FiXCircle },
                { key: "group",    label: "Group Sessions", count: groupEnrollments.length, icon: FiUsers },
              ].map(tab => (
                <button
                  key={tab.key}
                  onClick={() => { setActiveTab(tab.key); setPage(1); }}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-semibold transition-all duration-200 shrink-0"
                  style={{
                    background: activeTab === tab.key ? "#C8A951" : "white",
                    color: activeTab === tab.key ? "#14213D" : "#4A5568",
                    border: `1px solid ${activeTab === tab.key ? "#C8A951" : "rgba(200,169,81,0.25)"}`,
                  }}
                >
                  <tab.icon size={14} /> {tab.label}
                  <span className="text-xs opacity-70">({tab.count})</span>
                </button>
              ))}
            </div>
          </div>
        </motion.div>

        {/* ── Filters ─────────────────────────────────────── */}
        {activeTab !== "group" && (
        <motion.div className="mb-5" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.15 }}>
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

          <AnimatePresence>
            {filtersOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 rounded-xl mt-1" style={{ background: "white", border: "1px solid rgba(200,169,81,0.2)" }}>
                  <div>
                    <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wide" style={{ color: "rgba(74,85,104,0.7)" }}>Coach name</label>
                    <input
                      value={coachFilter}
                      onChange={e => { setCoachFilter(e.target.value); setPage(1); }}
                      placeholder="e.g. drsmith"
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

          {hasActiveFilters && (
            <p className="text-xs mt-2" style={{ color: "rgba(74,85,104,0.65)" }}>
              Showing <strong>{filtered.length}</strong> result{filtered.length !== 1 ? "s" : ""}
            </p>
          )}
        </motion.div>
        )}

        {/* ── Session List / Empty ─────────────────────────── */}
        {activeTab === "group" ? (
          groupEnrollments.length === 0 ? (
            <div className="text-center py-20 rounded-2xl" style={{ background: "white", border: "1px solid rgba(200,169,81,0.15)" }}>
              <p className="text-5xl mb-4">👥</p>
              <h3 className="text-xl font-normal text-[#1B2B4A] mb-2" style={{ fontFamily: "'Playfair Display', serif" }}>No group sessions yet</h3>
              <p className="text-sm text-[#4A5568] mb-6">Browse and reserve a seat in a group session.</p>
              <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={() => navigate("/group-sessions")}
                className="gold-btn inline-flex items-center gap-2 px-6 py-3 rounded-full text-sm font-bold">
                <FiUsers size={14} /> Browse Group Sessions
              </motion.button>
            </div>
          ) : (
            <div className="space-y-4">
              {groupEnrollments.map((e, i) => <GroupCard key={e.id} e={e} index={i} onCancel={handleCancelGroup} onJoin={(sid) => navigate(`/group-session/${sid}/call`)} onChat={(sid) => navigate(`/group-chat/${sid}`)} />)}
            </div>
          )
        ) : (
        <>
        <AnimatePresence mode="wait">
          {filtered.length === 0 ? (
            <motion.div
              key="empty"
              className="text-center py-20 rounded-2xl"
              style={{ background: "white", border: "1px solid rgba(200,169,81,0.15)" }}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            >
              <p className="text-5xl mb-4">{activeTab === "upcoming" ? "📚" : "🎓"}</p>
              <h3 className="text-xl font-normal text-[#1B2B4A] mb-2" style={{ fontFamily: "'Playfair Display', serif" }}>
                No {activeTab === "upcoming" ? "upcoming" : "past"} sessions
              </h3>
              <p className="text-sm text-[#4A5568] mb-6">
                {activeTab === "upcoming" ? "Book a session to start your learning journey." : "Your completed sessions will appear here."}
              </p>
              {activeTab === "upcoming" && (
                <motion.button
                  whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                  onClick={() => navigate("/skills")}
                  className="gold-btn inline-flex items-center gap-2 px-6 py-3 rounded-full text-sm font-bold"
                >
                  <FiBookOpen size={14} /> Browse Skills
                </motion.button>
              )}
            </motion.div>
          ) : (
            <motion.div key="list" className="space-y-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {pagedSessions.map((session, i) => (
                <SessionCard
                  key={session.id}
                  session={session}
                  index={i}
                  activeTab={activeTab}
                  onCancel={handleCancelSession}
                  onFeedback={handleLeaveFeedback}
                  onDownload={handleDownload}
                  onReflect={setReflectSession}
                  onSummary={setSummarySession}
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

      {/* ── Cancel Modal ─────────────────────────────────── */}
      <AnimatePresence>
        {showCancelModal && (
          <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowCancelModal(false)} />
            <motion.div
              className="relative rounded-2xl p-8 w-full max-w-sm text-center z-10"
              style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.2)" }}
              initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
            >
              <p className="text-4xl mb-3">⚠️</p>
              <h3 className="text-xl font-normal text-[#1B2B4A] mb-2" style={{ fontFamily: "'Playfair Display', serif" }}>Cancel Session?</h3>
              <p className="text-sm text-[#4A5568] mb-6">This action cannot be undone. Your coach will be notified.</p>
              <div className="flex gap-3">
                <button onClick={() => setShowCancelModal(false)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold border" style={{ borderColor: "rgba(200,169,81,0.3)", color: "#4A5568" }}>
                  Keep Session
                </button>
                <button onClick={confirmCancel} className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white" style={{ background: "#DC2626" }}>
                  Yes, Cancel
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Feedback Modal ───────────────────────────────── */}
      <AnimatePresence>
        {showFeedbackModal && feedbackSession && (
          <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowFeedbackModal(false)} />
            <motion.div
              className="relative rounded-2xl w-full max-w-lg z-10 overflow-hidden"
              style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.2)" }}
              initial={{ scale: 0.92, opacity: 0, y: 10 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.92, opacity: 0, y: 10 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              onClick={e => e.stopPropagation()}
            >
              <div className="h-1 w-full" style={{ background: "linear-gradient(90deg,#C8A951,#F0D98C)" }} />
              <div className="p-8">
                <div className="flex items-start justify-between gap-4 mb-6">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: "#C8A951" }}>Session Feedback</p>
                    <h3 className="text-2xl font-normal text-[#1B2B4A]" style={{ fontFamily: "'Playfair Display', serif" }}>Leave a Review</h3>
                    <p className="text-sm text-[#4A5568] mt-1">
                      For your session with <span className="font-semibold text-[#1B2B4A]">{feedbackSession.mentor_name || feedbackSession.mentor_username}</span>
                    </p>
                  </div>
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(200,169,81,0.15)" }}>
                    <FiStar size={18} style={{ color: "#C8A951" }} />
                  </div>
                </div>

                {/* Star rating */}
                <div className="rounded-xl p-4 mb-5" style={{ background: "white", border: "1px solid rgba(200,169,81,0.15)" }}>
                  <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "rgba(74,85,104,0.7)" }}>Your Rating</p>
                  <div className="flex gap-2">
                    {[1, 2, 3, 4, 5].map(star => (
                      <button
                        key={star}
                        onClick={() => setFeedbackRating(star)}
                        className="text-2xl transition-all duration-150"
                        style={{ color: star <= feedbackRating ? "#C8A951" : "rgba(200,169,81,0.25)" }}
                      >
                        ★
                      </button>
                    ))}
                    <span className="ml-2 text-sm self-center font-medium" style={{ color: "#A9863A" }}>{feedbackRating}/5</span>
                  </div>
                </div>

                {/* Comment */}
                <div className="mb-6">
                  <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "rgba(74,85,104,0.7)" }}>
                    Your Feedback
                  </label>
                  <textarea
                    value={feedbackComment}
                    onChange={e => setFeedbackComment(e.target.value)}
                    placeholder="Share what was helpful, what stood out, or how the session impacted you..."
                    rows={4}
                    className="w-full px-4 py-3 rounded-xl text-sm resize-none focus:outline-none transition-all duration-200"
                    style={{ background: "white", border: "1px solid rgba(200,169,81,0.3)", color: "#1B2B4A" }}
                    onFocus={e => e.target.style.borderColor = "#C8A951"}
                    onBlur={e => e.target.style.borderColor = "rgba(200,169,81,0.3)"}
                  />
                </div>

                <div className="flex gap-3">
                  <button onClick={() => setShowFeedbackModal(false)} className="flex-1 py-3 rounded-xl text-sm font-semibold border transition-all" style={{ borderColor: "rgba(200,169,81,0.3)", color: "#4A5568" }}>
                    Cancel
                  </button>
                  <button onClick={submitFeedback} className="flex-1 py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all" style={{ background: "linear-gradient(135deg,#C8A951,#F0D98C)", color: "#14213D" }}>
                    <FiStar size={13} /> Submit Feedback
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {reflectSession && (
          <SessionReflectionModal
            session={reflectSession}
            onClose={() => setReflectSession(null)}
            onSaved={fetchSessions}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {summarySession && (
          <SessionSummaryModal
            session={summarySession}
            onClose={() => setSummarySession(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

export default MyLearning;
