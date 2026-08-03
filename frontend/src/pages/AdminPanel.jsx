import { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../utils/auth";
import { useAuth } from "../context/AuthContext";
import { toast } from "react-toastify";
import AdminUserActions from "../components/AdminUserActions";
import BackupsPanel from "../components/BackupsPanel";
import { motion, AnimatePresence } from "framer-motion";
import {
  FiCheckCircle, FiXCircle, FiUsers, FiClock,
  FiDollarSign, FiBriefcase, FiAward, FiShield,
  FiActivity, FiCalendar, FiTrendingUp, FiBarChart2,
  FiUserCheck, FiUserPlus, FiAlertCircle, FiTarget,
  FiMail, FiTrash2, FiCornerUpLeft, FiSend, FiEdit2, FiPlus, FiDatabase, FiEye, FiX,
} from "react-icons/fi";
import {
  ResponsiveContainer,
  AreaChart, Area,
  BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";

// ─── KPI Card ─────────────────────────────────────────────────────────────────
const KpiCard = ({ icon: Icon, label, value, sub, color = "#C8A951", index }) => (
  <motion.div
    initial={{ opacity: 0, y: 16 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.35, delay: index * 0.06 }}
    className="rounded-2xl p-5 flex flex-col gap-3"
    style={{ background: "white", border: "1px solid rgba(200,169,81,0.15)", boxShadow: "0 2px 12px rgba(27,43,74,0.04)" }}
  >
    <div className="flex items-center justify-between">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${color}18` }}>
        <Icon size={18} style={{ color }} />
      </div>
      {sub && <span className="text-xs font-semibold px-2 py-1 rounded-full" style={{ background: `${color}12`, color }}>{sub}</span>}
    </div>
    <div>
      <p className="text-2xl font-bold text-[#1B2B4A]" style={{ fontFamily: "'Playfair Display', serif" }}>{value}</p>
      <p className="text-xs font-semibold uppercase tracking-wider mt-0.5" style={{ color: "rgba(74,85,104,0.6)" }}>{label}</p>
    </div>
  </motion.div>
);

// ─── Status Bar ───────────────────────────────────────────────────────────────
const StatusBar = ({ label, count, total, color }) => {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="mb-3">
      <div className="flex justify-between items-center mb-1">
        <span className="text-xs font-semibold capitalize" style={{ color: "rgba(74,85,104,0.75)" }}>{label}</span>
        <span className="text-xs font-bold" style={{ color }}>{count} <span style={{ color: "rgba(74,85,104,0.5)" }}>({pct}%)</span></span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(200,169,81,0.1)" }}>
        <motion.div
          className="h-full rounded-full"
          style={{ background: color }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        />
      </div>
    </div>
  );
};

// ─── Coach Card ───────────────────────────────────────────────────────────────
const CoachCard = ({ coach, showActions, onApprove, onReject, index }) => (
  <motion.div
    className="rounded-2xl overflow-hidden"
    style={{ background: "white", border: "1px solid rgba(200,169,81,0.15)", boxShadow: "0 2px 16px rgba(27,43,74,0.05)" }}
    initial={{ opacity: 0, y: 14 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.3, delay: index * 0.05 }}
  >
    <div className="h-1" style={{
      background: coach.is_verified
        ? "linear-gradient(90deg,#34A853,#6BCB77)"
        : "linear-gradient(90deg,#C8A951,#F0D98C)",
    }} />
    <div className="p-6">
      <div className="flex items-start gap-4 mb-4">
        <div className="w-11 h-11 rounded-xl flex items-center justify-center font-bold text-lg shrink-0" style={{ background: "#C8A951", color: "#14213D" }}>
          {coach.username?.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-0.5">
            <h3 className="font-normal text-[#1B2B4A]" style={{ fontFamily: "'Playfair Display', serif" }}>{coach.username}</h3>
            {coach.is_verified && (
              <span className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: "rgba(52,168,83,0.1)", color: "#2E7D32", border: "1px solid rgba(52,168,83,0.2)" }}>
                <FiCheckCircle size={9} /> Verified
              </span>
            )}
          </div>
          {coach.email && <p className="text-xs text-[#4A5568]">{coach.email}</p>}
        </div>
        {showActions && (
          <div className="flex gap-2 shrink-0">
            <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
              onClick={() => onApprove(coach.user_id)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold"
              style={{ background: "rgba(52,168,83,0.1)", color: "#2E7D32", border: "1px solid rgba(52,168,83,0.25)" }}>
              <FiCheckCircle size={12} /> Approve
            </motion.button>
            <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
              onClick={() => onReject(coach.user_id)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold"
              style={{ background: "rgba(239,68,68,0.08)", color: "#B91C1C", border: "1px solid rgba(239,68,68,0.2)" }}>
              <FiXCircle size={12} /> Reject
            </motion.button>
          </div>
        )}
      </div>
      {coach.bio && <p className="text-sm leading-relaxed mb-4 line-clamp-2" style={{ color: "#4A5568" }}>{coach.bio}</p>}
      <div className="flex flex-wrap gap-2 mb-3">
        {coach.hourly_rate && (
          <span className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background: "#F3ECD9", color: "#A9863A", border: "1px solid rgba(200,169,81,0.2)" }}>
            <FiDollarSign size={10} /> ${coach.hourly_rate}/hr
          </span>
        )}
        {coach.years_experience && (
          <span className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background: "#F3ECD9", color: "#4A5568", border: "1px solid rgba(200,169,81,0.15)" }}>
            <FiBriefcase size={10} /> {coach.years_experience} yrs exp
          </span>
        )}
      </div>
      {coach.specialties?.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {coach.specialties.map(s => (
            <span key={s} className="text-xs px-2.5 py-1 rounded-full font-medium" style={{ background: "rgba(200,169,81,0.1)", color: "#A9863A", border: "1px solid rgba(200,169,81,0.2)" }}>{s}</span>
          ))}
        </div>
      )}
      {coach.certifications?.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {coach.certifications.map(c => (
            <span key={c} className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium" style={{ background: "rgba(52,168,83,0.08)", color: "#2E7D32", border: "1px solid rgba(52,168,83,0.18)" }}>
              <FiAward size={9} /> {c}
            </span>
          ))}
        </div>
      )}
      {coach.industries?.length > 0 && (
        <p className="text-xs" style={{ color: "rgba(74,85,104,0.65)" }}>Industries: {coach.industries.join(", ")}</p>
      )}
    </div>
  </motion.div>
);

// ─── Main ──────────────────────────────────────────────────────────────────────
export default function AdminPanel() {
  const { isAdmin, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") || "overview";
  const setTab = (key) => setSearchParams(key === "overview" ? {} : { tab: key });
  const [stats, setStats] = useState(null);
  const [pendingCoaches, setPendingCoaches] = useState([]);
  const [allCoaches, setAllCoaches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [rejectModal, setRejectModal] = useState({ open: false, userId: null });
  const [rejectReason, setRejectReason] = useState("");
  const [analyticsData, setAnalyticsData] = useState(null);
  const [analyticsExtra, setAnalyticsExtra] = useState(null); // retention, by_company, top_coaches, habit_consistency
  const [coachStats, setCoachStats] = useState([]);
  const [coachSearch, setCoachSearch] = useState("");
  const [coachStatusFilter, setCoachStatusFilter] = useState("all");
  const [clientStats, setClientStats] = useState([]);
  const [clientSearch, setClientSearch] = useState("");
  const [clientActivityFilter, setClientActivityFilter] = useState("all");
  const [sessions, setSessions] = useState([]);
  const [sessionSearch, setSessionSearch] = useState("");
  const [sessionStatusFilter, setSessionStatusFilter] = useState("all");
  const [sessionDateFrom, setSessionDateFrom] = useState("");
  const [sessionDateTo, setSessionDateTo] = useState("");
  const [sessionSort, setSessionSort] = useState("newest");
  const [messages, setMessages] = useState([]);
  const [newsletters, setNewsletters] = useState([]);
  const [subscriberInfo, setSubscriberInfo] = useState({ total: 0, active: 0, subscribers: [] });
  const [compose, setCompose] = useState({ id: null, subject: "", body_html: "" });
  const [composeSaving, setComposeSaving] = useState(false);
  const [sendModal, setSendModal] = useState({ open: false, newsletter: null });
  const [previewModal, setPreviewModal] = useState({ open: false, newsletter: null });
  const [sendAudience, setSendAudience] = useState("subscribers"); // subscribers | clients | both | custom
  const [customEmails, setCustomEmails] = useState("");
  const [sending, setSending] = useState(false);
  // Onboard clients (E2 pre-register)
  const [programs, setPrograms] = useState([]);
  const [onboardSkillId, setOnboardSkillId] = useState("");
  const [onboardText, setOnboardText] = useState("");
  const [onboardSubmitting, setOnboardSubmitting] = useState(false);
  const [onboardResults, setOnboardResults] = useState(null);

  useEffect(() => {
    if (!isAuthenticated || !isAdmin()) { navigate("/"); return; }
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const res = await api.get("/admin/stats/");
      setStats(res.data);
    } catch { /* stats optional */ }
  }, []);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await api.get("/admin/sessions/");
      setSessions(res.data);
    } catch { /* non-critical */ }
  }, []);

  const fetchMessages = useCallback(async () => {
    try {
      const res = await api.get("/contact/");
      setMessages(Array.isArray(res.data) ? res.data : (res.data.results ?? []));
    } catch { /* non-critical */ }
  }, []);

  const markMessageRead = async (id, is_read = true) => {
    try {
      await api.patch(`/contact/${id}/`, { is_read });
      setMessages((ms) => ms.map((m) => (m.id === id ? { ...m, is_read } : m)));
    } catch { toast.error("Failed to update message."); }
  };

  const deleteMessage = async (id) => {
    try {
      await api.delete(`/contact/${id}/`);
      setMessages((ms) => ms.filter((m) => m.id !== id));
    } catch { toast.error("Failed to delete message."); }
  };

  const fetchNewsletters = useCallback(async () => {
    try {
      const res = await api.get("/newsletter/admin/newsletters/");
      setNewsletters(Array.isArray(res.data) ? res.data : (res.data.results ?? []));
    } catch { /* non-critical */ }
  }, []);

  const fetchSubscribers = useCallback(async () => {
    try {
      const res = await api.get("/newsletter/admin/subscribers/");
      setSubscriberInfo(res.data);
    } catch { /* non-critical */ }
  }, []);

  const editDraft = (n) => setCompose({ id: n.id, subject: n.subject, body_html: n.body_html });
  const resetCompose = () => setCompose({ id: null, subject: "", body_html: "" });

  const saveDraft = async (e) => {
    e.preventDefault();
    if (!compose.subject.trim() || !compose.body_html.trim()) {
      toast.error("Subject and body are required.");
      return;
    }
    setComposeSaving(true);
    try {
      const payload = { subject: compose.subject, body_html: compose.body_html };
      if (compose.id) {
        await api.patch(`/newsletter/admin/newsletters/${compose.id}/`, payload);
        toast.success("Draft updated.");
      } else {
        await api.post("/newsletter/admin/newsletters/", payload);
        toast.success("Draft saved.");
      }
      resetCompose();
      await fetchNewsletters();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to save draft.");
    } finally {
      setComposeSaving(false);
    }
  };

  const deleteDraft = async (n) => {
    if (!window.confirm(`Delete the draft "${n.subject}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/newsletter/admin/newsletters/${n.id}/`);
      if (compose.id === n.id) resetCompose();
      await fetchNewsletters();
      toast.success("Draft deleted.");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to delete.");
    }
  };

  const confirmSend = async () => {
    const n = sendModal.newsletter;
    if (!n) return;
    if (sendAudience === "custom" && !customEmails.trim()) { toast.error("Enter at least one email address."); return; }
    setSending(true);
    try {
      const payload = { audience: sendAudience };
      if (sendAudience === "custom") payload.emails = customEmails;
      const res = await api.post(`/newsletter/admin/newsletters/${n.id}/send/`, payload);
      toast.success(`Sent to ${res.data.sent_count} recipient${res.data.sent_count === 1 ? "" : "s"} — a confirmation copy has been emailed to you.`);
      if (compose.id === n.id) resetCompose();
      setSendModal({ open: false, newsletter: null });
      setSendAudience("subscribers"); setCustomEmails("");
      await fetchNewsletters();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to send.");
    } finally {
      setSending(false);
    }
  };

  const fetchClientStats = useCallback(async () => {
    try {
      const res = await api.get("/admin/client-stats/");
      setClientStats(res.data);
    } catch { /* non-critical */ }
  }, []);

  const fetchCoachStats = useCallback(async () => {
    try {
      const res = await api.get("/admin/coach-stats/");
      setCoachStats(res.data);
    } catch { /* non-critical */ }
  }, []);

  const fetchAnalytics = useCallback(async () => {
    try {
      const res = await api.get("/admin/analytics/");
      setAnalyticsData(res.data.monthly);
      setAnalyticsExtra({
        retention: res.data.retention,
        by_company: res.data.by_company,
        top_coaches: res.data.top_coaches,
        habit_consistency: res.data.habit_consistency,
      });
    } catch { /* non-critical */ }
  }, []);

  const fetchCoaches = useCallback(async (which) => {
    if (which === "pending") {
      const res = await api.get("/admin/coaches/pending/");
      setPendingCoaches(res.data);
    } else {
      const res = await api.get("/coaches/");
      setAllCoaches(res.data);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    const load = async () => {
      try {
        if (tab === "overview") {
          await Promise.all([fetchStats(), fetchCoaches("pending")]);
        } else if (tab === "analytics") {
          await Promise.all([fetchStats(), fetchAnalytics()]);
        } else if (tab === "coaches") {
          await fetchCoachStats();
        } else if (tab === "clients") {
          await fetchClientStats();
        } else if (tab === "sessions") {
          await fetchSessions();
        } else if (tab === "messages") {
          await fetchMessages();
        } else if (tab === "newsletter") {
          await Promise.all([fetchNewsletters(), fetchSubscribers()]);
        } else if (tab === "pending") {
          await fetchCoaches("pending");
        } else if (tab === "onboard") {
          await fetchPrograms();
        } else {
          await fetchCoaches("all");
        }
      } catch { toast.error("Failed to load data."); }
      finally { setLoading(false); }
    };
    load();
  }, [tab]);

  const fetchPrograms = useCallback(async () => {
    try {
      const res = await api.get("/skills/public/");
      setPrograms(Array.isArray(res.data) ? res.data : (res.data.results ?? []));
    } catch { setPrograms([]); }
  }, []);

  // Parse the pasted list: one client per line, "email, First, Last"
  // (first/last optional). Returns [{email, first_name, last_name}].
  const parseOnboardRows = (text) =>
    (text || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(/[,\t]/).map((p) => p.trim());
        return { email: parts[0] || "", first_name: parts[1] || "", last_name: parts[2] || "" };
      })
      .filter((r) => r.email);

  const onboardRows = parseOnboardRows(onboardText);

  const submitOnboard = async () => {
    if (!onboardSkillId) { toast.error("Please choose a programme first."); return; }
    if (onboardRows.length === 0) { toast.error("Add at least one client (one email per line)."); return; }
    setOnboardSubmitting(true);
    setOnboardResults(null);
    try {
      const res = await api.post("/admin/pre-register-clients/", {
        skill_id: Number(onboardSkillId),
        clients: onboardRows,
      });
      setOnboardResults(res.data);
      const s = res.data.summary || {};
      toast.success(`${s.created || 0} created · ${s.exists || 0} existing · ${(s.invalid || 0) + (s.error || 0)} skipped`);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Could not pre-register clients.");
    } finally { setOnboardSubmitting(false); }
  };

  const handleApprove = async (userId) => {
    try {
      await api.patch(`/admin/coaches/${userId}/approve/`, { approval_status: "approved" });
      toast.success("Coach approved and verified.");
      await fetchCoaches("pending");
      if (tab === "overview") { await fetchStats(); }
    } catch { toast.error("Failed to approve coach."); }
  };

  const handleReject = async () => {
    try {
      await api.patch(`/admin/coaches/${rejectModal.userId}/approve/`, {
        approval_status: "rejected",
        rejection_reason: rejectReason,
      });
      toast.success("Coach rejected.");
      setRejectModal({ open: false, userId: null });
      setRejectReason("");
      await fetchCoaches("pending");
      if (tab === "overview") { await fetchStats(); }
    } catch { toast.error("Failed to reject coach."); }
  };

  const TABS = [
    { key: "overview", label: "Overview",          icon: FiBarChart2 },
    { key: "pending",  label: "Pending Approvals", icon: FiClock,
      badge: pendingCoaches.length },
    { key: "analytics", label: "Analytics",            icon: FiTrendingUp },
    { key: "coaches",   label: "Coach Management",    icon: FiUserCheck },
    { key: "clients",   label: "Client Management",   icon: FiUsers },
    { key: "onboard",   label: "Onboard Clients",     icon: FiUserPlus },
    { key: "sessions",  label: "All Sessions",         icon: FiCalendar },
    { key: "messages",  label: "Messages",             icon: FiMail,
      badge: messages.filter((m) => !m.is_read).length },
    { key: "newsletter", label: "Newsletter",          icon: FiSend },
    { key: "all",       label: "All Coaches",          icon: FiUsers },
    { key: "backups",   label: "Backups",              icon: FiDatabase },
  ];

  const statusColors = {
    pending:   "#F59E0B",
    accepted:  "#34A853",
    completed: "#C8A951",
    no_show:   "#B91C1C",
    declined:  "#EF4444",
  };

  return (
    <div className="min-h-screen pt-36 pb-16 px-4" style={{ background: "#FAF6EC" }}>

      <div className="max-w-6xl mx-auto">

        {/* ── Loading ───────────────────────────────────────────── */}
        {loading && (
          <div className="flex justify-center py-20">
            <div className="flex flex-col items-center gap-4">
              <div className="w-10 h-10 rounded-full border-2 animate-spin" style={{ borderColor: "#C8A951", borderTopColor: "transparent" }} />
              <p className="text-sm" style={{ color: "rgba(74,85,104,0.7)" }}>Loading...</p>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════
            OVERVIEW TAB
        ══════════════════════════════════════════════════════════ */}
        {!loading && tab === "overview" && (
          <div className="space-y-8">

            {/* ── KPI Grid ───────────────────────────────────────── */}
            {stats && (
              <>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest mb-4" style={{ color: "rgba(74,85,104,0.55)" }}>Platform Overview</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <KpiCard index={0} icon={FiUserCheck} label="Active Coaches" value={stats.total_coaches} color="#34A853" />
                    <KpiCard index={1} icon={FiUsers} label="Total Clients" value={stats.total_clients} color="#C8A951" />
                    <KpiCard index={2} icon={FiCalendar} label="Total Sessions" value={stats.total_sessions} color="#A9863A" />
                    <KpiCard index={3} icon={FiDollarSign} label="Total Revenue" value={`$${stats.total_revenue.toFixed(0)}`} color="#2E7D32" />
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <KpiCard index={4} icon={FiActivity} label="Sessions This Week" value={stats.sessions_this_week} sub="7 days" color="#C8A951" />
                  <KpiCard index={5} icon={FiTrendingUp} label="Sessions This Month" value={stats.sessions_this_month} sub="month" color="#C8A951" />
                  <KpiCard index={6} icon={FiClock} label="Total Hours Coached" value={`${stats.total_hours}h`} color="#A9863A" />
                  <KpiCard index={7} icon={FiAlertCircle} label="Pending Approvals" value={stats.pending_coaches} color={stats.pending_coaches > 0 ? "#EF4444" : "#34A853"} />
                </div>

                {/* ── Milestones strip ─────────────────────────────── */}
                {stats.total_milestones > 0 && (
                  <div className="rounded-2xl p-5 flex items-center justify-between"
                    style={{ background: "white", border: "1px solid rgba(200,169,81,0.15)" }}>
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                        style={{ background: "rgba(200,169,81,0.1)" }}>
                        <FiTarget size={16} style={{ color: "#C8A951" }} />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-[#1B2B4A]">Milestones & Goals</p>
                        <p className="text-xs" style={{ color: "rgba(74,85,104,0.6)" }}>
                          {stats.completed_milestones}/{stats.total_milestones} completed
                          {" · "}{Math.round((stats.completed_milestones / stats.total_milestones) * 100)}% completion rate
                        </p>
                      </div>
                    </div>
                    <div className="w-32">
                      <div className="h-2 rounded-full overflow-hidden" style={{ background: "rgba(200,169,81,0.12)" }}>
                        <div className="h-full rounded-full" style={{
                          width: `${Math.round((stats.completed_milestones / stats.total_milestones) * 100)}%`,
                          background: "linear-gradient(90deg, #C8A951, #34A853)"
                        }} />
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Session Status Breakdown ──────────────────── */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div className="rounded-2xl p-6" style={{ background: "white", border: "1px solid rgba(200,169,81,0.15)" }}>
                    <p className="text-sm font-bold text-[#1B2B4A] mb-1" style={{ fontFamily: "'Playfair Display', serif" }}>Session Status Breakdown</p>
                    <p className="text-xs mb-5" style={{ color: "rgba(74,85,104,0.6)" }}>All time across the platform</p>
                    {Object.entries(stats.status_counts).map(([s, count]) => (
                      <StatusBar key={s} label={s} count={count} total={stats.total_sessions} color={statusColors[s]} />
                    ))}
                  </div>

                  {/* ── Quick Actions ─────────────────────────────── */}
                  <div className="rounded-2xl p-6" style={{ background: "white", border: "1px solid rgba(200,169,81,0.15)" }}>
                    <p className="text-sm font-bold text-[#1B2B4A] mb-1" style={{ fontFamily: "'Playfair Display', serif" }}>Quick Actions</p>
                    <p className="text-xs mb-5" style={{ color: "rgba(74,85,104,0.6)" }}>Jump to key admin tasks</p>
                    <div className="space-y-3">
                      {[
                        { icon: FiClock, label: "Review pending coaches", count: stats.pending_coaches, action: () => setTab("pending"), urgent: stats.pending_coaches > 0 },
                        { icon: FiUsers, label: "Browse all coaches", count: stats.total_coaches, action: () => setTab("all") },
                        { icon: FiUserPlus, label: "Total registered clients", count: stats.total_clients, action: null },
                      ].map((item, i) => (
                        <div key={i}
                          onClick={item.action || undefined}
                          className="flex items-center justify-between px-4 py-3 rounded-xl transition-all"
                          style={{
                            background: item.urgent ? "rgba(239,68,68,0.05)" : "#FAF6EC",
                            border: `1px solid ${item.urgent ? "rgba(239,68,68,0.2)" : "rgba(200,169,81,0.15)"}`,
                            cursor: item.action ? "pointer" : "default",
                          }}
                        >
                          <div className="flex items-center gap-3">
                            <item.icon size={14} style={{ color: item.urgent ? "#EF4444" : "#C8A951" }} />
                            <span className="text-sm font-medium text-[#1B2B4A]">{item.label}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold" style={{ color: item.urgent ? "#EF4444" : "#A9863A" }}>{item.count}</span>
                            {item.action && <span className="text-xs" style={{ color: "rgba(74,85,104,0.5)" }}>→</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* ── Pending Approvals preview ─────────────────────── */}
            {pendingCoaches.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest mb-0.5" style={{ color: "rgba(74,85,104,0.55)" }}>Requires Attention</p>
                    <p className="text-lg font-bold text-[#1B2B4A]" style={{ fontFamily: "'Playfair Display', serif" }}>
                      Pending Coach Applications
                      <span className="ml-2 text-sm font-semibold px-2 py-0.5 rounded-full align-middle" style={{ background: "rgba(239,68,68,0.1)", color: "#DC2626" }}>
                        {pendingCoaches.length}
                      </span>
                    </p>
                  </div>
                  <button onClick={() => setTab("pending")} className="text-xs font-semibold px-4 py-2 rounded-xl transition-all"
                    style={{ background: "rgba(200,169,81,0.12)", color: "#A9863A", border: "1px solid rgba(200,169,81,0.25)" }}>
                    View all →
                  </button>
                </div>
                <div className="space-y-4">
                  {pendingCoaches.slice(0, 2).map((coach, i) => (
                    <CoachCard key={coach.user_id} coach={coach} index={i} showActions
                      onApprove={handleApprove}
                      onReject={(id) => setRejectModal({ open: true, userId: id })}
                    />
                  ))}
                  {pendingCoaches.length > 2 && (
                    <button onClick={() => setTab("pending")} className="w-full py-3 rounded-xl text-sm font-semibold transition-all"
                      style={{ background: "white", border: "1px dashed rgba(200,169,81,0.35)", color: "#A9863A" }}>
                      + {pendingCoaches.length - 2} more pending applications
                    </button>
                  )}
                </div>
              </div>
            )}

            {pendingCoaches.length === 0 && stats && (
              <div className="rounded-2xl px-6 py-5 flex items-center gap-3" style={{ background: "rgba(52,168,83,0.06)", border: "1px solid rgba(52,168,83,0.2)" }}>
                <FiCheckCircle size={18} style={{ color: "#34A853" }} />
                <div>
                  <p className="text-sm font-bold" style={{ color: "#2E7D32" }}>All caught up!</p>
                  <p className="text-xs" style={{ color: "rgba(52,168,83,0.7)" }}>No pending coach applications to review.</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════
            ANALYTICS TAB
        ══════════════════════════════════════════════════════════ */}
        {!loading && tab === "analytics" && (
          <div className="space-y-8">

            {/* ── Summary KPIs ─────────────────────────────────────── */}
            {stats && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <KpiCard index={0} icon={FiCalendar} label="Total Sessions" value={stats.total_sessions} color="#C8A951" />
                <KpiCard index={1} icon={FiCheckCircle} label="Completed" value={stats.status_counts.completed} color="#34A853" />
                <KpiCard index={2} icon={FiDollarSign} label="Total Revenue" value={`$${stats.total_revenue.toFixed(0)}`} color="#2E7D32" />
                <KpiCard index={3} icon={FiClock} label="Hours Coached" value={`${stats.total_hours}h`} color="#A9863A" />
              </div>
            )}

            {/* ── Sessions Area Chart ───────────────────────────────── */}
            <div className="rounded-2xl p-6" style={{ background: "white", border: "1px solid rgba(200,169,81,0.15)" }}>
              <p className="text-sm font-bold text-[#1B2B4A] mb-0.5" style={{ fontFamily: "'Playfair Display', serif" }}>
                Sessions Over Time
              </p>
              <p className="text-xs mb-6" style={{ color: "rgba(74,85,104,0.6)" }}>Total vs completed sessions — last 12 months</p>
              {analyticsData ? (
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={analyticsData} margin={{ top: 4, right: 16, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gradSessions" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#C8A951" stopOpacity={0.18} />
                        <stop offset="95%" stopColor="#C8A951" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gradCompleted" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#34A853" stopOpacity={0.18} />
                        <stop offset="95%" stopColor="#34A853" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(200,169,81,0.1)" />
                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: "rgba(74,85,104,0.6)" }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: "rgba(74,85,104,0.6)" }} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{ background: "#1B2B4A", border: "none", borderRadius: 10, fontSize: 12, color: "#fff" }}
                      labelStyle={{ color: "#C8A951", fontWeight: 600, marginBottom: 4 }}
                      itemStyle={{ color: "#fff" }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11, paddingTop: 12, color: "rgba(74,85,104,0.75)" }} />
                    <Area type="monotone" dataKey="sessions" name="Total Sessions" stroke="#C8A951" strokeWidth={2} fill="url(#gradSessions)" dot={false} />
                    <Area type="monotone" dataKey="completed" name="Completed" stroke="#34A853" strokeWidth={2} fill="url(#gradCompleted)" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-64 flex items-center justify-center">
                  <p className="text-sm" style={{ color: "rgba(74,85,104,0.5)" }}>No data available yet.</p>
                </div>
              )}
            </div>

            {/* ── Revenue Bar Chart ─────────────────────────────────── */}
            <div className="rounded-2xl p-6" style={{ background: "white", border: "1px solid rgba(200,169,81,0.15)" }}>
              <p className="text-sm font-bold text-[#1B2B4A] mb-0.5" style={{ fontFamily: "'Playfair Display', serif" }}>
                Revenue by Month
              </p>
              <p className="text-xs mb-6" style={{ color: "rgba(74,85,104,0.6)" }}>Earnings from completed sessions — last 12 months</p>
              {analyticsData ? (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={analyticsData} margin={{ top: 4, right: 16, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(200,169,81,0.1)" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: "rgba(74,85,104,0.6)" }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: "rgba(74,85,104,0.6)" }} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
                    <Tooltip
                      contentStyle={{ background: "#1B2B4A", border: "none", borderRadius: 10, fontSize: 12, color: "#fff" }}
                      labelStyle={{ color: "#C8A951", fontWeight: 600, marginBottom: 4 }}
                      itemStyle={{ color: "#fff" }}
                      formatter={v => [`$${v.toFixed(2)}`, "Revenue"]}
                    />
                    <Bar dataKey="revenue" name="Revenue" fill="#C8A951" radius={[6, 6, 0, 0]} maxBarSize={40} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-60 flex items-center justify-center">
                  <p className="text-sm" style={{ color: "rgba(74,85,104,0.5)" }}>No revenue data available yet.</p>
                </div>
              )}
            </div>

            {/* ── Retention ─────────────────────────────────────────── */}
            {analyticsExtra?.retention && (
              <div className="rounded-2xl p-6" style={{ background: "white", border: "1px solid rgba(200,169,81,0.15)" }}>
                <p className="text-sm font-bold text-[#1B2B4A] mb-0.5" style={{ fontFamily: "'Playfair Display', serif" }}>
                  Client Retention
                </p>
                <p className="text-xs mb-6" style={{ color: "rgba(74,85,104,0.6)" }}>
                  Share of coached clients who came back for more than one session
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="rounded-xl p-4 text-center" style={{ background: "linear-gradient(135deg,rgba(200,169,81,0.12),rgba(200,169,81,0.03))", border: "1px solid rgba(200,169,81,0.2)" }}>
                    <p className="text-3xl font-bold" style={{ color: "#A9863A" }}>{analyticsExtra.retention.retention_rate}%</p>
                    <p className="text-xs mt-1" style={{ color: "rgba(74,85,104,0.7)" }}>Retention rate</p>
                  </div>
                  <div className="rounded-xl p-4 text-center" style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.12)" }}>
                    <p className="text-3xl font-bold text-[#1B2B4A]">{analyticsExtra.retention.active_clients}</p>
                    <p className="text-xs mt-1" style={{ color: "rgba(74,85,104,0.7)" }}>Active clients</p>
                  </div>
                  <div className="rounded-xl p-4 text-center" style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.12)" }}>
                    <p className="text-3xl font-bold" style={{ color: "#2E7D32" }}>{analyticsExtra.retention.returning_clients}</p>
                    <p className="text-xs mt-1" style={{ color: "rgba(74,85,104,0.7)" }}>Returning</p>
                  </div>
                  <div className="rounded-xl p-4 text-center" style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.12)" }}>
                    <p className="text-3xl font-bold" style={{ color: "#4A5568" }}>{analyticsExtra.retention.one_time_clients}</p>
                    <p className="text-xs mt-1" style={{ color: "rgba(74,85,104,0.7)" }}>One-time</p>
                  </div>
                </div>
              </div>
            )}

            {/* ── Coachees by Company ───────────────────────────────── */}
            <div className="rounded-2xl p-6" style={{ background: "white", border: "1px solid rgba(200,169,81,0.15)" }}>
              <p className="text-sm font-bold text-[#1B2B4A] mb-0.5" style={{ fontFamily: "'Playfair Display', serif" }}>
                Coachees by Company
              </p>
              <p className="text-xs mb-6" style={{ color: "rgba(74,85,104,0.6)" }}>How many clients come from each organisation</p>
              {analyticsExtra?.by_company?.length ? (
                <ResponsiveContainer width="100%" height={Math.max(160, analyticsExtra.by_company.length * 42)}>
                  <BarChart data={analyticsExtra.by_company} layout="vertical" margin={{ top: 0, right: 24, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(200,169,81,0.1)" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10, fill: "rgba(74,85,104,0.6)" }} tickLine={false} axisLine={false} allowDecimals={false} />
                    <YAxis type="category" dataKey="company" width={130} tick={{ fontSize: 11, fill: "#1B2B4A" }} tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={{ background: "#1B2B4A", border: "none", borderRadius: 10, fontSize: 12, color: "#fff" }}
                      labelStyle={{ color: "#C8A951", fontWeight: 600, marginBottom: 4 }}
                      itemStyle={{ color: "#fff" }}
                      formatter={v => [v, "Clients"]}
                    />
                    <Bar dataKey="clients" name="Clients" fill="#C8A951" radius={[0, 6, 6, 0]} maxBarSize={26} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-40 flex items-center justify-center">
                  <p className="text-sm" style={{ color: "rgba(74,85,104,0.5)" }}>No company data yet.</p>
                </div>
              )}
            </div>

            {/* ── Best-performing Coaches ───────────────────────────── */}
            <div className="rounded-2xl p-6" style={{ background: "white", border: "1px solid rgba(200,169,81,0.15)" }}>
              <p className="text-sm font-bold text-[#1B2B4A] mb-0.5" style={{ fontFamily: "'Playfair Display', serif" }}>
                Best-performing Coaches
              </p>
              <p className="text-xs mb-5" style={{ color: "rgba(74,85,104,0.6)" }}>Ranked by client engagement, then rating</p>
              {analyticsExtra?.top_coaches?.length ? (
                <div className="space-y-2">
                  {analyticsExtra.top_coaches.map((co, i) => (
                    <div key={co.username} className="flex items-center gap-3 rounded-xl px-4 py-3"
                      style={{ background: i === 0 ? "linear-gradient(135deg,rgba(200,169,81,0.14),rgba(200,169,81,0.03))" : "#FAF6EC", border: "1px solid rgba(200,169,81,0.15)" }}>
                      <div className="flex items-center justify-center w-7 h-7 rounded-full shrink-0 text-sm font-bold"
                        style={{ background: i === 0 ? "#C8A951" : "rgba(27,43,74,0.08)", color: i === 0 ? "#14213D" : "#4A5568" }}>
                        {i + 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-[#1B2B4A] truncate">{co.name}</p>
                        <p className="text-xs" style={{ color: "rgba(74,85,104,0.6)" }}>@{co.username}</p>
                      </div>
                      <div className="flex items-center gap-4 text-xs shrink-0" style={{ color: "#4A5568" }}>
                        <span className="text-center"><span className="block font-bold text-sm text-[#1B2B4A]">{co.engaged_sessions}</span>sessions</span>
                        <span className="text-center"><span className="block font-bold text-sm" style={{ color: "#2E7D32" }}>${co.revenue.toFixed(0)}</span>revenue</span>
                        <span className="text-center"><span className="block font-bold text-sm" style={{ color: "#A9863A" }}>{co.avg_rating ?? "—"}</span>rating</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="h-24 flex items-center justify-center">
                  <p className="text-sm" style={{ color: "rgba(74,85,104,0.5)" }}>No coach data yet.</p>
                </div>
              )}
            </div>

            {/* ── Habit Consistency ─────────────────────────────────── */}
            {analyticsExtra?.habit_consistency && (
              <div className="rounded-2xl p-6" style={{ background: "white", border: "1px solid rgba(200,169,81,0.15)" }}>
                <div className="flex items-center justify-between flex-wrap gap-2 mb-0.5">
                  <p className="text-sm font-bold text-[#1B2B4A]" style={{ fontFamily: "'Playfair Display', serif" }}>
                    Habit Consistency
                  </p>
                  <div className="flex items-center gap-4 text-xs" style={{ color: "#4A5568" }}>
                    <span><span className="font-bold text-sm" style={{ color: "#A9863A" }}>{analyticsExtra.habit_consistency.avg_consistency}%</span> avg (30d)</span>
                    <span><span className="font-bold text-sm text-[#1B2B4A]">{analyticsExtra.habit_consistency.active_habits}</span> active habits</span>
                  </div>
                </div>
                <p className="text-xs mb-6" style={{ color: "rgba(74,85,104,0.6)" }}>Daily habit check-ins across all clients — last 14 days</p>
                {analyticsExtra.habit_consistency.active_habits > 0 && analyticsExtra.habit_consistency.checkins_30d > 0 ? (
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={analyticsExtra.habit_consistency.daily} margin={{ top: 4, right: 16, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(200,169,81,0.1)" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 9, fill: "rgba(74,85,104,0.6)" }} tickLine={false} axisLine={false} interval={1} />
                      <YAxis tick={{ fontSize: 10, fill: "rgba(74,85,104,0.6)" }} tickLine={false} axisLine={false} allowDecimals={false} />
                      <Tooltip
                        contentStyle={{ background: "#1B2B4A", border: "none", borderRadius: 10, fontSize: 12, color: "#fff" }}
                        labelStyle={{ color: "#C8A951", fontWeight: 600, marginBottom: 4 }}
                        itemStyle={{ color: "#fff" }}
                        formatter={v => [v, "Check-ins"]}
                      />
                      <Bar dataKey="checkins" name="Check-ins" fill="#34A853" radius={[6, 6, 0, 0]} maxBarSize={28} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-40 flex flex-col items-center justify-center gap-1">
                    <FiActivity size={22} style={{ color: "rgba(200,169,81,0.5)" }} />
                    <p className="text-sm" style={{ color: "rgba(74,85,104,0.5)" }}>No habit check-ins logged yet.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════
            PENDING / ALL COACHES TABS
        ══════════════════════════════════════════════════════════ */}
        {/* ══════════════════════════════════════════════════════════
            COACH MANAGEMENT TAB
        ══════════════════════════════════════════════════════════ */}
        {!loading && tab === "coaches" && (() => {
          const filtered = coachStats.filter(c => {
            const matchSearch = !coachSearch ||
              c.username.toLowerCase().includes(coachSearch.toLowerCase()) ||
              c.email.toLowerCase().includes(coachSearch.toLowerCase()) ||
              (c.specialties || []).some(s => s.toLowerCase().includes(coachSearch.toLowerCase()));
            const matchStatus = coachStatusFilter === "all" || c.approval_status === coachStatusFilter;
            return matchSearch && matchStatus;
          });

          const statusBadge = (s) => {
            const map = {
              approved: { bg: "rgba(52,168,83,0.1)", color: "#2E7D32", border: "rgba(52,168,83,0.25)", label: "Approved" },
              pending:  { bg: "rgba(245,158,11,0.1)", color: "#B45309", border: "rgba(245,158,11,0.25)", label: "Pending" },
              rejected: { bg: "rgba(239,68,68,0.08)", color: "#B91C1C", border: "rgba(239,68,68,0.2)", label: "Rejected" },
            };
            const st = map[s] || map.pending;
            return (
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                style={{ background: st.bg, color: st.color, border: `1px solid ${st.border}` }}>
                {st.label}
              </span>
            );
          };

          const stars = (rating) => {
            if (!rating) return <span style={{ color: "rgba(74,85,104,0.45)" }}>—</span>;
            return (
              <span className="flex items-center gap-1">
                <span style={{ color: "#C8A951" }}>★</span>
                <span className="font-semibold text-[#1B2B4A]">{rating}</span>
                <span style={{ color: "rgba(74,85,104,0.5)" }}>/5</span>
              </span>
            );
          };

          return (
            <div className="space-y-5">
              {/* Search + filter bar */}
              <div className="flex flex-wrap gap-3 items-center">
                <div className="flex-1 min-w-[180px] relative">
                  <input
                    type="text"
                    placeholder="Search by name, email, specialty…"
                    value={coachSearch}
                    onChange={e => setCoachSearch(e.target.value)}
                    className="w-full pl-4 pr-4 py-2.5 rounded-xl text-sm focus:outline-none"
                    style={{ background: "white", border: "1px solid rgba(200,169,81,0.3)", color: "#1B2B4A" }}
                    onFocus={e => e.target.style.borderColor = "#C8A951"}
                    onBlur={e => e.target.style.borderColor = "rgba(200,169,81,0.3)"}
                  />
                </div>
                {["all","approved","pending","rejected"].map(s => (
                  <button key={s} onClick={() => setCoachStatusFilter(s)}
                    className="px-4 py-2.5 rounded-xl text-xs font-semibold capitalize transition-all"
                    style={{
                      background: coachStatusFilter === s ? "#C8A951" : "white",
                      color: coachStatusFilter === s ? "#14213D" : "#4A5568",
                      border: `1px solid ${coachStatusFilter === s ? "#C8A951" : "rgba(200,169,81,0.25)"}`,
                    }}>
                    {s === "all" ? `All (${coachStats.length})` : s}
                  </button>
                ))}
              </div>

              <p className="text-xs" style={{ color: "rgba(74,85,104,0.6)" }}>
                Showing {filtered.length} of {coachStats.length} coaches
              </p>

              {/* Table */}
              <div className="rounded-2xl overflow-hidden" style={{ background: "white", border: "1px solid rgba(200,169,81,0.15)" }}>
                {/* Header */}
                <div className="grid text-xs font-semibold uppercase tracking-wider px-5 py-3"
                  style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1fr 1fr 0.6fr", color: "rgba(74,85,104,0.6)", borderBottom: "1px solid rgba(200,169,81,0.12)", background: "#FAF6EC" }}>
                  <span>Coach</span>
                  <span className="text-center">Status</span>
                  <span className="text-center">Sessions</span>
                  <span className="text-center">Completed</span>
                  <span className="text-center">Revenue</span>
                  <span className="text-center">Hours</span>
                  <span className="text-center">Rating</span>
                  <span className="text-center">Actions</span>
                </div>

                {filtered.length === 0 ? (
                  <div className="py-16 text-center">
                    <p className="text-3xl mb-2">🔍</p>
                    <p className="text-sm font-medium text-[#1B2B4A]">No coaches match your search</p>
                  </div>
                ) : (
                  filtered.map((coach, i) => (
                    <motion.div key={coach.user_id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: i * 0.03 }}
                      className="grid items-center px-5 py-4"
                      style={{
                        gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1fr 1fr 0.6fr",
                        borderBottom: i < filtered.length - 1 ? "1px solid rgba(200,169,81,0.08)" : "none",
                      }}
                    >
                      {/* Coach identity */}
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-lg flex items-center justify-center font-bold shrink-0 text-sm"
                          style={{ background: "#C8A951", color: "#14213D" }}>
                          {coach.username?.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-sm text-[#1B2B4A] truncate">{coach.username}</p>
                          <p className="text-xs truncate" style={{ color: "rgba(74,85,104,0.6)" }}>{coach.email}</p>
                          {coach.specialties?.length > 0 && (
                            <p className="text-xs truncate mt-0.5" style={{ color: "#A9863A" }}>{coach.specialties.slice(0,2).join(", ")}</p>
                          )}
                        </div>
                      </div>

                      <div className="text-center">{statusBadge(coach.approval_status)}</div>

                      <div className="text-center">
                        <span className="text-sm font-bold text-[#1B2B4A]">{coach.stats.total}</span>
                        {coach.stats.pending > 0 && (
                          <span className="ml-1 text-xs px-1.5 py-0.5 rounded-full font-semibold"
                            style={{ background: "rgba(245,158,11,0.12)", color: "#B45309" }}>
                            {coach.stats.pending} pend
                          </span>
                        )}
                      </div>

                      <div className="text-center">
                        <span className="text-sm font-bold" style={{ color: "#2E7D32" }}>{coach.stats.completed}</span>
                        {coach.stats.total > 0 && (
                          <p className="text-xs" style={{ color: "rgba(74,85,104,0.5)" }}>
                            {Math.round((coach.stats.completed / coach.stats.total) * 100)}%
                          </p>
                        )}
                      </div>

                      <div className="text-center">
                        <span className="text-sm font-bold text-[#1B2B4A]">${coach.stats.revenue.toFixed(0)}</span>
                      </div>

                      <div className="text-center">
                        <span className="text-sm font-bold text-[#1B2B4A]">{coach.stats.hours}h</span>
                      </div>

                      <div className="text-center text-sm">{stars(coach.stats.avg_rating)}
                        {coach.stats.review_count > 0 && (
                          <p className="text-xs" style={{ color: "rgba(74,85,104,0.5)" }}>({coach.stats.review_count})</p>
                        )}
                      </div>

                      <AdminUserActions userId={coach.user_id} isActive={coach.is_active !== false}
                        kind="coach" onDone={fetchCoachStats} />
                    </motion.div>
                  ))
                )}
              </div>

              {/* Summary footer */}
              {filtered.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2">
                  {[
                    { label: "Total Sessions", value: filtered.reduce((a,c) => a + c.stats.total, 0), color: "#C8A951" },
                    { label: "Total Completed", value: filtered.reduce((a,c) => a + c.stats.completed, 0), color: "#34A853" },
                    { label: "Total Revenue", value: `$${filtered.reduce((a,c) => a + c.stats.revenue, 0).toFixed(0)}`, color: "#2E7D32" },
                    { label: "Total Hours", value: `${filtered.reduce((a,c) => a + c.stats.hours, 0).toFixed(1)}h`, color: "#A9863A" },
                  ].map((item, i) => (
                    <div key={i} className="rounded-xl p-4 text-center"
                      style={{ background: "white", border: "1px solid rgba(200,169,81,0.15)" }}>
                      <p className="text-lg font-bold" style={{ color: item.color, fontFamily: "'Playfair Display', serif" }}>{item.value}</p>
                      <p className="text-xs font-semibold uppercase tracking-wider mt-0.5" style={{ color: "rgba(74,85,104,0.6)" }}>{item.label}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}

        {/* ══════════════════════════════════════════════════════════
            CLIENT MANAGEMENT TAB
        ══════════════════════════════════════════════════════════ */}
        {!loading && tab === "clients" && (() => {
          const filtered = clientStats.filter(c => {
            const matchSearch = !clientSearch ||
              c.username.toLowerCase().includes(clientSearch.toLowerCase()) ||
              c.email.toLowerCase().includes(clientSearch.toLowerCase()) ||
              (c.coaching_goals || []).some(g => g.toLowerCase().includes(clientSearch.toLowerCase()));
            const matchActivity =
              clientActivityFilter === "all" ||
              (clientActivityFilter === "active" && c.stats.total > 0) ||
              (clientActivityFilter === "inactive" && c.stats.total === 0) ||
              (clientActivityFilter === "completed" && c.stats.completed > 0);
            return matchSearch && matchActivity;
          });

          return (
            <div className="space-y-5">
              {/* Search + filter bar */}
              <div className="flex flex-wrap gap-3 items-center">
                <div className="flex-1 min-w-[180px]">
                  <input
                    type="text"
                    placeholder="Search by name, email, or goal…"
                    value={clientSearch}
                    onChange={e => setClientSearch(e.target.value)}
                    className="w-full pl-4 pr-4 py-2.5 rounded-xl text-sm focus:outline-none"
                    style={{ background: "white", border: "1px solid rgba(200,169,81,0.3)", color: "#1B2B4A" }}
                    onFocus={e => e.target.style.borderColor = "#C8A951"}
                    onBlur={e => e.target.style.borderColor = "rgba(200,169,81,0.3)"}
                  />
                </div>
                {[
                  { key: "all",       label: `All (${clientStats.length})` },
                  { key: "active",    label: "Has Bookings" },
                  { key: "completed", label: "Has Completed" },
                  { key: "inactive",  label: "No Bookings" },
                ].map(f => (
                  <button key={f.key} onClick={() => setClientActivityFilter(f.key)}
                    className="px-4 py-2.5 rounded-xl text-xs font-semibold transition-all"
                    style={{
                      background: clientActivityFilter === f.key ? "#C8A951" : "white",
                      color: clientActivityFilter === f.key ? "#14213D" : "#4A5568",
                      border: `1px solid ${clientActivityFilter === f.key ? "#C8A951" : "rgba(200,169,81,0.25)"}`,
                    }}>
                    {f.label}
                  </button>
                ))}
              </div>

              <p className="text-xs" style={{ color: "rgba(74,85,104,0.6)" }}>
                Showing {filtered.length} of {clientStats.length} clients
              </p>

              {/* Table */}
              <div className="rounded-2xl overflow-hidden" style={{ background: "white", border: "1px solid rgba(200,169,81,0.15)" }}>
                <div className="grid text-xs font-semibold uppercase tracking-wider px-5 py-3"
                  style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1fr 1fr 0.6fr", color: "rgba(74,85,104,0.6)", borderBottom: "1px solid rgba(200,169,81,0.12)", background: "#FAF6EC" }}>
                  <span>Client</span>
                  <span className="text-center">Bookings</span>
                  <span className="text-center">Completed</span>
                  <span className="text-center">Pending</span>
                  <span className="text-center">Declined</span>
                  <span className="text-center">Spent</span>
                  <span className="text-center">Coaches</span>
                  <span className="text-center">Actions</span>
                </div>

                {filtered.length === 0 ? (
                  <div className="py-16 text-center">
                    <p className="text-3xl mb-2">🔍</p>
                    <p className="text-sm font-medium text-[#1B2B4A]">No clients match your search</p>
                  </div>
                ) : (
                  filtered.map((client, i) => (
                    <motion.div key={client.user_id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: i * 0.03 }}
                      className="grid items-center px-5 py-4"
                      style={{
                        gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1fr 1fr 0.6fr",
                        borderBottom: i < filtered.length - 1 ? "1px solid rgba(200,169,81,0.08)" : "none",
                      }}
                    >
                      {/* Identity */}
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-lg flex items-center justify-center font-bold shrink-0 text-sm"
                          style={{ background: "rgba(200,169,81,0.15)", color: "#A9863A" }}>
                          {client.username?.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-sm text-[#1B2B4A] truncate">{client.username}</p>
                          <p className="text-xs truncate" style={{ color: "rgba(74,85,104,0.6)" }}>{client.email}</p>
                          {client.coaching_goals?.length > 0 && (
                            <p className="text-xs truncate mt-0.5" style={{ color: "#A9863A" }}>
                              {client.coaching_goals.slice(0,2).join(", ")}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="text-center">
                        <span className="text-sm font-bold text-[#1B2B4A]">{client.stats.total}</span>
                      </div>

                      <div className="text-center">
                        <span className="text-sm font-bold" style={{ color: "#2E7D32" }}>{client.stats.completed}</span>
                        {client.stats.total > 0 && (
                          <p className="text-xs" style={{ color: "rgba(74,85,104,0.5)" }}>
                            {Math.round((client.stats.completed / client.stats.total) * 100)}%
                          </p>
                        )}
                      </div>

                      <div className="text-center">
                        {client.stats.pending > 0 ? (
                          <span className="text-sm font-bold px-2 py-0.5 rounded-full"
                            style={{ background: "rgba(245,158,11,0.1)", color: "#B45309" }}>
                            {client.stats.pending}
                          </span>
                        ) : <span className="text-sm" style={{ color: "rgba(74,85,104,0.45)" }}>—</span>}
                      </div>

                      <div className="text-center">
                        {client.stats.declined > 0 ? (
                          <span className="text-sm font-bold" style={{ color: "#EF4444" }}>{client.stats.declined}</span>
                        ) : <span className="text-sm" style={{ color: "rgba(74,85,104,0.45)" }}>—</span>}
                      </div>

                      <div className="text-center">
                        <span className="text-sm font-bold text-[#1B2B4A]">${client.stats.spent.toFixed(0)}</span>
                      </div>

                      <div className="text-center">
                        <span className="text-sm font-bold text-[#1B2B4A]">{client.stats.unique_coaches}</span>
                        {client.stats.reviews_given > 0 && (
                          <p className="text-xs" style={{ color: "rgba(74,85,104,0.5)" }}>{client.stats.reviews_given} review{client.stats.reviews_given !== 1 ? "s" : ""}</p>
                        )}
                      </div>

                      <AdminUserActions userId={client.user_id} isActive={client.is_active !== false}
                        kind="client" onDone={fetchClientStats} />
                    </motion.div>
                  ))
                )}
              </div>

              {/* Summary footer */}
              {filtered.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2">
                  {[
                    { label: "Total Bookings",  value: filtered.reduce((a,c) => a + c.stats.total, 0),     color: "#C8A951" },
                    { label: "Total Completed", value: filtered.reduce((a,c) => a + c.stats.completed, 0), color: "#34A853" },
                    { label: "Total Spent",     value: `$${filtered.reduce((a,c) => a + c.stats.spent, 0).toFixed(0)}`, color: "#2E7D32" },
                    { label: "Active Clients",  value: filtered.filter(c => c.stats.total > 0).length,     color: "#A9863A" },
                  ].map((item, i) => (
                    <div key={i} className="rounded-xl p-4 text-center"
                      style={{ background: "white", border: "1px solid rgba(200,169,81,0.15)" }}>
                      <p className="text-lg font-bold" style={{ color: item.color, fontFamily: "'Playfair Display', serif" }}>{item.value}</p>
                      <p className="text-xs font-semibold uppercase tracking-wider mt-0.5" style={{ color: "rgba(74,85,104,0.6)" }}>{item.label}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}

        {/* ══════════════════════════════════════════════════════════
            ALL SESSIONS TAB
        ══════════════════════════════════════════════════════════ */}
        {!loading && tab === "sessions" && (() => {
          const statusColors = {
            pending:   { bg: "rgba(245,158,11,0.1)",  color: "#B45309",  border: "rgba(245,158,11,0.25)" },
            accepted:  { bg: "rgba(52,168,83,0.1)",   color: "#2E7D32",  border: "rgba(52,168,83,0.25)" },
            completed: { bg: "rgba(200,169,81,0.12)", color: "#A9863A",  border: "rgba(200,169,81,0.3)" },
            declined:  { bg: "rgba(239,68,68,0.08)",  color: "#B91C1C",  border: "rgba(239,68,68,0.2)" },
            no_show:   { bg: "rgba(239,68,68,0.08)",  color: "#B91C1C",  border: "rgba(239,68,68,0.2)" },
          };

          let filtered = sessions.filter(s => {
            const q = sessionSearch.toLowerCase();
            const matchSearch = !q ||
              s.coach.toLowerCase().includes(q) ||
              s.client.toLowerCase().includes(q) ||
              s.skill.toLowerCase().includes(q);
            const matchStatus = sessionStatusFilter === "all" || s.status === sessionStatusFilter;
            const matchFrom = !sessionDateFrom || s.session_date >= sessionDateFrom;
            const matchTo   = !sessionDateTo   || s.session_date <= sessionDateTo;
            return matchSearch && matchStatus && matchFrom && matchTo;
          });

          if (sessionSort === "newest")  filtered = [...filtered].sort((a,b) => b.id - a.id);
          if (sessionSort === "oldest")  filtered = [...filtered].sort((a,b) => a.id - b.id);
          if (sessionSort === "date_asc")  filtered = [...filtered].sort((a,b) => a.session_date.localeCompare(b.session_date));
          if (sessionSort === "date_desc") filtered = [...filtered].sort((a,b) => b.session_date.localeCompare(a.session_date));
          if (sessionSort === "price_desc") filtered = [...filtered].sort((a,b) => b.price - a.price);

          const handleStatusChange = async (id, newStatus) => {
            try {
              await api.patch(`/admin/sessions/${id}/`, { status: newStatus });
              setSessions(prev => prev.map(s => s.id === id ? { ...s, status: newStatus } : s));
              toast.success("Session status updated.");
            } catch { toast.error("Failed to update status."); }
          };

          const totalRevenue = filtered.filter(s => s.status === "completed").reduce((a,s) => a + s.price, 0);

          return (
            <div className="space-y-5">
              {/* Filters */}
              <div className="flex flex-wrap gap-3 items-center">
                <div className="flex-1 min-w-[160px]">
                  <input type="text" placeholder="Search coach, client, skill…"
                    value={sessionSearch} onChange={e => setSessionSearch(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl text-sm focus:outline-none"
                    style={{ background: "white", border: "1px solid rgba(200,169,81,0.3)", color: "#1B2B4A" }}
                    onFocus={e => e.target.style.borderColor = "#C8A951"}
                    onBlur={e => e.target.style.borderColor = "rgba(200,169,81,0.3)"}
                  />
                </div>
                <input type="date" value={sessionDateFrom} onChange={e => setSessionDateFrom(e.target.value)}
                  className="px-3 py-2.5 rounded-xl text-sm focus:outline-none"
                  style={{ background: "white", border: "1px solid rgba(200,169,81,0.3)", color: "#1B2B4A" }} />
                <input type="date" value={sessionDateTo} onChange={e => setSessionDateTo(e.target.value)}
                  className="px-3 py-2.5 rounded-xl text-sm focus:outline-none"
                  style={{ background: "white", border: "1px solid rgba(200,169,81,0.3)", color: "#1B2B4A" }} />
                <select value={sessionSort} onChange={e => setSessionSort(e.target.value)}
                  className="px-3 py-2.5 rounded-xl text-sm focus:outline-none"
                  style={{ background: "white", border: "1px solid rgba(200,169,81,0.3)", color: "#1B2B4A" }}>
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                  <option value="date_asc">Session date ↑</option>
                  <option value="date_desc">Session date ↓</option>
                  <option value="price_desc">Price ↓</option>
                </select>
              </div>

              {/* Status pills */}
              <div className="flex flex-wrap gap-2">
                {["all","pending","accepted","completed","no_show","declined"].map(s => {
                  const count = s === "all" ? sessions.length : sessions.filter(x => x.status === s).length;
                  const active = sessionStatusFilter === s;
                  const sc = statusColors[s] || {};
                  return (
                    <button key={s} onClick={() => setSessionStatusFilter(s)}
                      className="px-3 py-1.5 rounded-xl text-xs font-semibold capitalize transition-all"
                      style={{
                        background: active ? (sc.bg || "#C8A951") : "white",
                        color: active ? (sc.color || "#14213D") : "#4A5568",
                        border: `1px solid ${active ? (sc.border || "#C8A951") : "rgba(200,169,81,0.2)"}`,
                      }}>
                      {s === "all" ? "All" : s === "no_show" ? "No Show" : s} ({count})
                    </button>
                  );
                })}
                {(sessionSearch || sessionStatusFilter !== "all" || sessionDateFrom || sessionDateTo) && (
                  <button onClick={() => { setSessionSearch(""); setSessionStatusFilter("all"); setSessionDateFrom(""); setSessionDateTo(""); }}
                    className="px-3 py-1.5 rounded-xl text-xs font-semibold transition-all"
                    style={{ background: "rgba(239,68,68,0.08)", color: "#B91C1C", border: "1px solid rgba(239,68,68,0.2)" }}>
                    Clear filters
                  </button>
                )}
              </div>

              <div className="flex items-center justify-between">
                <p className="text-xs" style={{ color: "rgba(74,85,104,0.6)" }}>
                  {filtered.length} session{filtered.length !== 1 ? "s" : ""} shown
                </p>
                <p className="text-xs font-semibold" style={{ color: "#2E7D32" }}>
                  Filtered revenue: ${totalRevenue.toFixed(2)}
                </p>
              </div>

              {/* Table */}
              <div className="rounded-2xl overflow-hidden" style={{ background: "white", border: "1px solid rgba(200,169,81,0.15)" }}>
                <div className="grid text-xs font-semibold uppercase tracking-wider px-5 py-3"
                  style={{ gridTemplateColumns: "1fr 1fr 1.5fr 1fr 1fr 1fr 1.2fr", color: "rgba(74,85,104,0.6)", borderBottom: "1px solid rgba(200,169,81,0.12)", background: "#FAF6EC" }}>
                  <span>Coach</span>
                  <span>Client</span>
                  <span>Skill</span>
                  <span className="text-center">Date</span>
                  <span className="text-center">Duration</span>
                  <span className="text-center">Price</span>
                  <span className="text-center">Status</span>
                </div>

                {filtered.length === 0 ? (
                  <div className="py-16 text-center">
                    <p className="text-3xl mb-2">📋</p>
                    <p className="text-sm font-medium text-[#1B2B4A]">No sessions match your filters</p>
                  </div>
                ) : filtered.map((s, i) => {
                  const sc = statusColors[s.status] || statusColors.pending;
                  return (
                    <motion.div key={s.id}
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
                      className="grid items-center px-5 py-3.5"
                      style={{
                        gridTemplateColumns: "1fr 1fr 1.5fr 1fr 1fr 1fr 1.2fr",
                        borderBottom: i < filtered.length - 1 ? "1px solid rgba(200,169,81,0.08)" : "none",
                      }}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[#1B2B4A] truncate">{s.coach}</p>
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm text-[#1B2B4A] truncate">{s.client}</p>
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm text-[#1B2B4A] truncate">{s.skill}</p>
                        <p className="text-xs" style={{ color: "rgba(74,85,104,0.55)" }}>{s.created_at}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-sm text-[#1B2B4A]">{s.session_date}</p>
                        <p className="text-xs" style={{ color: "rgba(74,85,104,0.55)" }}>{s.session_time}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-sm text-[#1B2B4A]">{s.duration}m</p>
                      </div>
                      <div className="text-center">
                        <p className="text-sm font-semibold text-[#1B2B4A]">${s.price.toFixed(0)}</p>
                      </div>
                      <div className="text-center">
                        <select value={s.status}
                          onChange={e => handleStatusChange(s.id, e.target.value)}
                          className="text-xs font-semibold px-2 py-1 rounded-lg focus:outline-none cursor-pointer"
                          style={{ background: sc.bg, color: sc.color, border: `1px solid ${sc.border}` }}>
                          <option value="pending">Pending</option>
                          <option value="accepted">Accepted</option>
                          <option value="completed">Completed</option>
                          <option value="no_show">No Show</option>
                          <option value="declined">Declined</option>
                        </select>
                      </div>
                    </motion.div>
                  );
                })}
              </div>

              {/* Summary strip */}
              {filtered.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-1">
                  {["pending","accepted","completed","declined"].map(st => {
                    const sc = statusColors[st];
                    const cnt = filtered.filter(s => s.status === st).length;
                    return (
                      <div key={st} className="rounded-xl p-3 text-center"
                        style={{ background: sc.bg, border: `1px solid ${sc.border}` }}>
                        <p className="text-base font-bold" style={{ color: sc.color }}>{cnt}</p>
                        <p className="text-xs font-semibold capitalize mt-0.5" style={{ color: sc.color }}>{st}</p>
                      </div>
                    );
                  })}
                  <div className="rounded-xl p-3 text-center"
                    style={{ background: "rgba(52,168,83,0.08)", border: "1px solid rgba(52,168,83,0.2)" }}>
                    <p className="text-base font-bold" style={{ color: "#2E7D32" }}>${totalRevenue.toFixed(0)}</p>
                    <p className="text-xs font-semibold mt-0.5" style={{ color: "#2E7D32" }}>Revenue</p>
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {!loading && tab === "messages" && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-[#1B2B4A]">Contact Messages</h2>
              <span className="text-xs font-semibold px-3 py-1.5 rounded-full" style={{ background: "rgba(200,169,81,0.12)", color: "#A9863A" }}>
                {messages.length} total · {messages.filter((m) => !m.is_read).length} unread
              </span>
            </div>
            {messages.length === 0 ? (
              <div className="text-center py-16 rounded-2xl" style={{ background: "white", border: "1px solid rgba(200,169,81,0.15)" }}>
                <p className="text-4xl mb-3">📭</p>
                <p className="text-sm text-[#4A5568]">No contact messages yet.</p>
              </div>
            ) : (
              messages.map((m) => (
                <div key={m.id} className="rounded-2xl p-5"
                  style={{ background: "white", border: m.is_read ? "1px solid rgba(200,169,81,0.15)" : "1px solid rgba(200,169,81,0.5)", boxShadow: "0 2px 12px rgba(27,43,74,0.04)" }}>
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {!m.is_read && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: "#C8A951" }} />}
                        <h3 className="text-sm font-bold text-[#1B2B4A] truncate">{m.subject}</h3>
                      </div>
                      <p className="text-xs mt-0.5" style={{ color: "#4A5568" }}>
                        {m.name || "Anonymous"} · <a href={`mailto:${m.email}`} style={{ color: "#A9863A" }}>{m.email}</a>
                      </p>
                    </div>
                    <span className="text-xs whitespace-nowrap" style={{ color: "rgba(74,85,104,0.6)" }}>
                      {new Date(m.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed whitespace-pre-line mb-4" style={{ color: "#4A5568" }}>{m.message}</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <a href={`mailto:${m.email}?subject=Re: ${encodeURIComponent(m.subject)}`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold" style={{ background: "rgba(200,169,81,0.12)", color: "#A9863A" }}>
                      <FiCornerUpLeft size={12} /> Reply
                    </a>
                    <button onClick={() => markMessageRead(m.id, !m.is_read)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold" style={{ background: "rgba(27,43,74,0.06)", color: "#1B2B4A" }}>
                      <FiCheckCircle size={12} /> Mark as {m.is_read ? "unread" : "read"}
                    </button>
                    <button onClick={() => deleteMessage(m.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold ml-auto" style={{ background: "rgba(239,68,68,0.08)", color: "#B91C1C" }}>
                      <FiTrash2 size={12} /> Delete
                    </button>
                  </div>
                </div>
              ))
            )}
          </motion.div>
        )}

        {!loading && tab === "newsletter" && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-5">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-lg font-bold text-[#1B2B4A]">Newsletter</h2>
              <span className="text-xs font-semibold px-3 py-1.5 rounded-full" style={{ background: "rgba(200,169,81,0.12)", color: "#A9863A" }}>
                {subscriberInfo.active} active · {subscriberInfo.total} total subscribers
              </span>
            </div>

            <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_320px]">
              {/* Compose */}
              <form onSubmit={saveDraft} className="rounded-2xl p-5 space-y-4"
                style={{ background: "white", border: "1px solid rgba(200,169,81,0.15)", boxShadow: "0 2px 12px rgba(27,43,74,0.04)" }}>
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-[#1B2B4A]">{compose.id ? "Edit draft" : "Compose new"}</h3>
                  {compose.id && (
                    <button type="button" onClick={resetCompose}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold" style={{ background: "rgba(27,43,74,0.06)", color: "#1B2B4A" }}>
                      <FiPlus size={12} /> New
                    </button>
                  )}
                </div>
                <input type="text" placeholder="Subject" value={compose.subject}
                  onChange={(e) => setCompose({ ...compose, subject: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl text-sm focus:outline-none"
                  style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.3)", color: "#1B2B4A" }} />
                <textarea placeholder="Body (HTML allowed)…" value={compose.body_html} rows={12}
                  onChange={(e) => setCompose({ ...compose, body_html: e.target.value })}
                  className="w-full resize-y px-4 py-3 rounded-xl text-sm font-mono focus:outline-none"
                  style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.3)", color: "#1B2B4A" }} />
                <button type="submit" disabled={composeSaving}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-bold disabled:opacity-50"
                  style={{ background: "linear-gradient(135deg,#C8A951,#F0D98C)", color: "#14213D" }}>
                  <FiEdit2 size={14} /> {composeSaving ? "Saving…" : compose.id ? "Update draft" : "Save draft"}
                </button>
              </form>

              {/* Subscribers */}
              <div className="rounded-2xl p-5"
                style={{ background: "white", border: "1px solid rgba(200,169,81,0.15)", boxShadow: "0 2px 12px rgba(27,43,74,0.04)" }}>
                <h3 className="text-sm font-bold text-[#1B2B4A] mb-3">Subscribers</h3>
                {subscriberInfo.subscribers.length === 0 ? (
                  <p className="text-sm" style={{ color: "#4A5568" }}>No subscribers yet.</p>
                ) : (
                  <div className="space-y-2 max-h-80 overflow-y-auto">
                    {subscriberInfo.subscribers.map((s) => (
                      <div key={s.id} className="flex items-center justify-between gap-2 text-xs px-3 py-2 rounded-lg"
                        style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.12)", opacity: s.is_active ? 1 : 0.5 }}>
                        <span className="min-w-0 truncate text-[#1B2B4A]">{s.first_name ? `${s.first_name} · ` : ""}{s.email}</span>
                        {!s.is_active && <span className="shrink-0" style={{ color: "#B91C1C" }}>unsub</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Drafts & sent */}
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-[#1B2B4A]">Issues</h3>
              {newsletters.length === 0 ? (
                <div className="text-center py-12 rounded-2xl" style={{ background: "white", border: "1px solid rgba(200,169,81,0.15)" }}>
                  <p className="text-sm text-[#4A5568]">No newsletters yet. Compose one above.</p>
                </div>
              ) : (
                newsletters.map((n) => (
                  <div key={n.id} className="rounded-2xl p-4 flex items-start justify-between gap-3"
                    style={{ background: "white", border: "1px solid rgba(200,169,81,0.15)", boxShadow: "0 2px 12px rgba(27,43,74,0.04)" }}>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-bold text-[#1B2B4A] truncate">{n.subject}</h4>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase shrink-0"
                          style={n.status === "sent"
                            ? { background: "rgba(52,168,83,0.12)", color: "#2E7D32" }
                            : { background: "rgba(251,191,36,0.15)", color: "#92400E" }}>
                          {n.status}
                        </span>
                      </div>
                      <p className="text-xs mt-1" style={{ color: "rgba(74,85,104,0.7)" }}>
                        {n.status === "sent"
                          ? `Sent to ${n.sent_count} · ${new Date(n.sent_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
                          : `Draft · updated ${new Date(n.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button onClick={() => setPreviewModal({ open: true, newsletter: n })}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold" style={{ background: "rgba(27,43,74,0.06)", color: "#1B2B4A" }}>
                        <FiEye size={12} /> Preview
                      </button>
                      {n.status === "draft" && (
                        <>
                          <button onClick={() => setSendModal({ open: true, newsletter: n })}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold" style={{ background: "linear-gradient(135deg,#C8A951,#F0D98C)", color: "#14213D" }}>
                            <FiSend size={12} /> Send
                          </button>
                          <button onClick={() => editDraft(n)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold" style={{ background: "rgba(200,169,81,0.12)", color: "#A9863A" }}>
                            <FiEdit2 size={12} /> Edit
                          </button>
                          <button onClick={() => deleteDraft(n)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold" style={{ background: "rgba(239,68,68,0.08)", color: "#B91C1C" }}>
                            <FiTrash2 size={12} /> Delete
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}

        {!loading && (tab === "pending" || tab === "all") && (() => {
          const list = tab === "pending" ? pendingCoaches : allCoaches;
          return (
            <>
              <p className="text-xs font-semibold uppercase tracking-wider mb-5" style={{ color: "rgba(74,85,104,0.55)" }}>
                {list.length} {tab === "pending" ? "pending application" : "coach"}{list.length !== 1 ? "s" : ""}
              </p>
              {list.length === 0 ? (
                <motion.div className="text-center py-20 rounded-2xl"
                  style={{ background: "white", border: "1px solid rgba(200,169,81,0.15)" }}
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                >
                  <p className="text-5xl mb-3">{tab === "pending" ? "✅" : "👥"}</p>
                  <h3 className="text-xl font-normal text-[#1B2B4A] mb-1" style={{ fontFamily: "'Playfair Display', serif" }}>
                    {tab === "pending" ? "No pending applications" : "No coaches found"}
                  </h3>
                  <p className="text-sm text-[#4A5568]">
                    {tab === "pending" ? "All caught up — nothing to review right now." : "No coaches have registered yet."}
                  </p>
                </motion.div>
              ) : (
                <div className="space-y-4">
                  {list.map((coach, i) => (
                    <CoachCard key={coach.user_id} coach={coach} index={i}
                      showActions={tab === "pending"}
                      onApprove={handleApprove}
                      onReject={(id) => setRejectModal({ open: true, userId: id })}
                    />
                  ))}
                </div>
              )}
            </>
          );
        })()}

        {/* ────────────────────────────────────────────────────────────
            ONBOARD CLIENTS TAB (E2 pre-register + activation)
        ──────────────────────────────────────────────────────────── */}
        {tab === "backups" && <BackupsPanel />}

        {!loading && tab === "onboard" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-normal" style={{ color: "#1B2B4A", fontFamily: "'Playfair Display', serif" }}>Onboard clients to a programme</h2>
              <p className="text-sm mt-1" style={{ color: "#4A5568" }}>
                Pre-register clients and email each a welcome + set-password link. They'll be locked to the programme you choose and can only book that.
              </p>
            </div>

            <div className="rounded-2xl p-5 md:p-6 bg-white" style={{ border: "1px solid rgba(200,169,81,0.25)" }}>
              {/* Programme picker */}
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: "#A9863A" }}>Programme</label>
              <select value={onboardSkillId} onChange={(e) => setOnboardSkillId(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl text-sm mb-5 focus:outline-none"
                style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.3)", color: "#1B2B4A" }}>
                <option value="">Choose a programme…</option>
                {programs.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}{Number(s.price) > 0 ? ` ($${s.price})` : " (Free)"}
                  </option>
                ))}
              </select>

              {/* Client list */}
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: "#A9863A" }}>Clients</label>
              <p className="text-xs mb-2" style={{ color: "#4A5568" }}>One client per line: <code style={{ color: "#A9863A" }}>email, First name, Last name</code> — name is optional.</p>
              <textarea value={onboardText} onChange={(e) => setOnboardText(e.target.value)} rows={7}
                placeholder={"jane@example.com, Jane, Doe\nmark@example.com, Mark, Smith\nolivia@example.com"}
                className="w-full px-4 py-3 rounded-xl text-sm font-mono resize-y focus:outline-none"
                style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.3)", color: "#1B2B4A" }} />

              <div className="flex items-center justify-between mt-3 flex-wrap gap-3">
                <span className="text-xs font-semibold" style={{ color: onboardRows.length ? "#2E7D32" : "#9aa3b0" }}>
                  {onboardRows.length} client{onboardRows.length !== 1 ? "s" : ""} ready
                </span>
                <button onClick={submitOnboard} disabled={onboardSubmitting || !onboardRows.length || !onboardSkillId}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-bold disabled:opacity-50"
                  style={{ background: "linear-gradient(135deg,#C8A951,#F0D98C)", color: "#14213D" }}>
                  <FiUserPlus size={15} /> {onboardSubmitting ? "Sending…" : "Pre-register & send activation"}
                </button>
              </div>
            </div>

            {/* Results */}
            {onboardResults && (
              <div className="rounded-2xl p-5 bg-white" style={{ border: "1px solid rgba(200,169,81,0.25)" }}>
                <div className="flex items-center gap-3 flex-wrap mb-4 text-xs font-semibold">
                  {[
                    ["Created", onboardResults.summary?.created, "#2E7D32", "rgba(52,168,83,0.1)"],
                    ["Already existed", onboardResults.summary?.exists, "#B45309", "rgba(245,158,11,0.12)"],
                    ["Invalid", onboardResults.summary?.invalid, "#B91C1C", "rgba(239,68,68,0.1)"],
                    ["Errors", onboardResults.summary?.error, "#B91C1C", "rgba(239,68,68,0.1)"],
                  ].map(([label, n, color, bg]) => (
                    <span key={label} className="px-3 py-1 rounded-full" style={{ background: bg, color }}>{label}: {n || 0}</span>
                  ))}
                </div>
                <div className="space-y-1.5">
                  {(onboardResults.results || []).map((r, i) => {
                    const map = {
                      created: ["#2E7D32", "✓ Created & emailed"],
                      created_no_email: ["#B45309", "⚠ Created, email failed"],
                      exists: ["#B45309", "• Already existed — skipped"],
                      invalid: ["#B91C1C", "✕ Invalid"],
                      error: ["#B91C1C", "✕ Error"],
                    };
                    const [color, label] = map[r.status] || ["#4A5568", r.status];
                    return (
                      <div key={i} className="flex items-center justify-between gap-3 text-sm py-1.5 px-1 border-b" style={{ borderColor: "rgba(200,169,81,0.12)" }}>
                        <span className="truncate" style={{ color: "#1B2B4A" }}>{r.email || "—"}</span>
                        <span className="shrink-0 text-xs font-semibold" style={{ color }} title={r.detail}>{label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Reject Modal ──────────────────────────────────────────── */}
      <AnimatePresence>
        {sendModal.open && (
          <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-4"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          >
            <motion.div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => !sending && setSendModal({ open: false, newsletter: null })} />
            <motion.div
              className="relative rounded-2xl w-full max-w-md z-10 overflow-hidden"
              style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.2)" }}
              initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              onClick={e => e.stopPropagation()}
            >
              <div className="h-1" style={{ background: "linear-gradient(90deg,#C8A951,#F0D98C)" }} />
              <div className="p-8">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(200,169,81,0.15)" }}>
                    <FiSend size={18} style={{ color: "#A9863A" }} />
                  </div>
                  <div>
                    <h3 className="text-xl font-normal text-[#1B2B4A]" style={{ fontFamily: "'Playfair Display', serif" }}>Send newsletter</h3>
                    <p className="text-xs text-[#4A5568]">This cannot be undone.</p>
                  </div>
                </div>
                <p className="text-sm leading-relaxed mb-4" style={{ color: "#4A5568" }}>
                  Send <span className="font-bold text-[#1B2B4A]">&ldquo;{sendModal.newsletter?.subject}&rdquo;</span> to:
                </p>
                {(() => {
                  const subs = subscriberInfo.active || 0;
                  const clis = subscriberInfo.registered_clients || 0;
                  const opts = [
                    { key: "subscribers", label: "Newsletter subscribers", hint: `${subs} active` },
                    { key: "clients", label: "All registered clients", hint: `${clis} client${clis === 1 ? "" : "s"}` },
                    { key: "both", label: "Both subscribers and clients", hint: "one copy each — no duplicates" },
                    { key: "custom", label: "Specific email addresses", hint: "type the emails you want to reach" },
                  ];
                  return (
                    <div className="space-y-2 mb-6">
                      {opts.map((o) => (
                        <div key={o.key}>
                          <button type="button" onClick={() => setSendAudience(o.key)}
                            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition"
                            style={{
                              background: sendAudience === o.key ? "rgba(200,169,81,0.14)" : "white",
                              border: `1px solid ${sendAudience === o.key ? "#C8A951" : "rgba(200,169,81,0.25)"}`,
                            }}>
                            <span className="w-4 h-4 rounded-full shrink-0 flex items-center justify-center"
                              style={{ border: `2px solid ${sendAudience === o.key ? "#A9863A" : "rgba(27,43,74,0.25)"}` }}>
                              {sendAudience === o.key && <span className="w-2 h-2 rounded-full" style={{ background: "#A9863A" }} />}
                            </span>
                            <span className="min-w-0">
                              <span className="block text-sm font-semibold text-[#1B2B4A]">{o.label}</span>
                              <span className="block text-xs" style={{ color: "#4A5568" }}>{o.hint}</span>
                            </span>
                          </button>
                          {o.key === "custom" && sendAudience === "custom" && (
                            <textarea value={customEmails} onChange={(e) => setCustomEmails(e.target.value)} rows={3}
                              placeholder="email1@example.com, email2@example.com, …"
                              className="w-full mt-2 px-3 py-2 rounded-xl text-sm resize-none focus:outline-none"
                              style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.3)", color: "#1B2B4A" }} />
                          )}
                        </div>
                      ))}
                    </div>
                  );
                })()}
                <div className="flex gap-3">
                  <button onClick={() => setSendModal({ open: false, newsletter: null })} disabled={sending}
                    className="flex-1 py-3 rounded-xl text-sm font-semibold border disabled:opacity-50"
                    style={{ borderColor: "rgba(200,169,81,0.3)", color: "#4A5568" }}>
                    Cancel
                  </button>
                  <motion.button whileHover={!sending ? { scale: 1.02 } : {}} whileTap={!sending ? { scale: 0.97 } : {}}
                    onClick={confirmSend} disabled={sending}
                    className="flex-1 py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-60"
                    style={{ background: "linear-gradient(135deg,#C8A951,#F0D98C)", color: "#14213D" }}>
                    {sending
                      ? <div className="w-4 h-4 rounded-full border-2 animate-spin" style={{ borderColor: "#14213D", borderTopColor: "transparent" }} />
                      : <><FiSend size={13} /> Confirm Send</>}
                  </motion.button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}

        {rejectModal.open && (
          <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-4"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          >
            <motion.div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setRejectModal({ open: false, userId: null })} />
            <motion.div
              className="relative rounded-2xl w-full max-w-md z-10 overflow-hidden"
              style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.2)" }}
              initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              onClick={e => e.stopPropagation()}
            >
              <div className="h-1" style={{ background: "linear-gradient(90deg,#DC2626,#F87171)" }} />
              <div className="p-8">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(239,68,68,0.1)" }}>
                    <FiXCircle size={18} style={{ color: "#DC2626" }} />
                  </div>
                  <div>
                    <h3 className="text-xl font-normal text-[#1B2B4A]" style={{ fontFamily: "'Playfair Display', serif" }}>Reject Coach</h3>
                    <p className="text-xs text-[#4A5568]">This will notify the applicant.</p>
                  </div>
                </div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "rgba(74,85,104,0.7)" }}>
                  Reason (optional)
                </label>
                <textarea rows={3}
                  className="w-full px-4 py-3 rounded-xl text-sm resize-none focus:outline-none mb-6"
                  style={{ background: "white", border: "1px solid rgba(200,169,81,0.3)", color: "#1B2B4A" }}
                  placeholder="e.g. Insufficient credentials, incomplete profile..."
                  value={rejectReason}
                  onChange={e => setRejectReason(e.target.value)}
                  onFocus={e => e.target.style.borderColor = "#C8A951"}
                  onBlur={e => e.target.style.borderColor = "rgba(200,169,81,0.3)"}
                />
                <div className="flex gap-3">
                  <button onClick={() => setRejectModal({ open: false, userId: null })}
                    className="flex-1 py-3 rounded-xl text-sm font-semibold border"
                    style={{ borderColor: "rgba(200,169,81,0.3)", color: "#4A5568" }}>
                    Cancel
                  </button>
                  <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                    onClick={handleReject}
                    className="flex-1 py-3 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2"
                    style={{ background: "#DC2626" }}>
                    <FiXCircle size={13} /> Confirm Reject
                  </motion.button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Newsletter preview — portaled to <body> so it escapes any ancestor
          stacking context and always sits above the fixed navbar. */}
      {createPortal(
        <AnimatePresence>
          {previewModal.open && (
            <motion.div className="fixed inset-0 z-[100] flex items-start justify-center px-4 py-10 overflow-y-auto"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            >
              <motion.div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setPreviewModal({ open: false, newsletter: null })} />
              <motion.div
                className="relative w-full max-w-[640px] z-10"
                initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                onClick={e => e.stopPropagation()}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 text-white">
                    <FiEye size={16} />
                    <span className="text-sm font-semibold">Preview — how it arrives in the inbox</span>
                  </div>
                  <button onClick={() => setPreviewModal({ open: false, newsletter: null })}
                    className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "rgba(255,255,255,0.2)", color: "#fff" }}>
                    <FiX size={16} />
                  </button>
                </div>

                <div style={{ background: "#ffffff", borderRadius: "16px", overflow: "hidden", boxShadow: "0 8px 40px rgba(0,0,0,0.35)", fontFamily: "Georgia, 'Times New Roman', serif", color: "#1B2B4A" }}>
                  <div style={{ background: "linear-gradient(135deg,#1B2B4A,#14213D)", padding: "28px 32px", textAlign: "center" }}>
                    <div style={{ fontSize: "24px", fontWeight: "bold", color: "#fff", letterSpacing: ".5px" }}>
                      <a href="https://www.dr-nath.com" style={{ color: "#fff", textDecoration: "none" }}>dr-nath.com Newsletter</a>
                    </div>
                    <div style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "3px", color: "#C8A951", marginTop: "4px" }}>Coaching for Impact</div>
                  </div>
                  <div style={{ background: "linear-gradient(90deg,#C8A951,#F0D98C)", padding: "10px 32px", textAlign: "center" }}>
                    <span style={{ fontSize: "12px", fontWeight: "bold", letterSpacing: "3px", textTransform: "uppercase", color: "#14213D", fontFamily: "Arial, sans-serif" }}>1st Edition</span>
                  </div>
                  <div style={{ padding: "32px" }}>
                    <p style={{ margin: "0 0 18px", fontSize: "15px", lineHeight: 1.6, color: "#4A5568", fontFamily: "Arial, sans-serif" }}>Hi <span style={{ color: "#A9863A" }}>[First name]</span>,</p>
                    <div style={{ fontSize: "15px", lineHeight: 1.7, color: "#1B2B4A", fontFamily: "Arial, sans-serif" }}
                      dangerouslySetInnerHTML={{ __html: previewModal.newsletter?.body_html || "" }} />
                    <p style={{ margin: "28px 0 0", fontSize: "12px", lineHeight: 1.6, color: "#9aa3b0", fontFamily: "Arial, sans-serif" }}>
                      You're receiving this because you subscribed at dr-nath.com. <span style={{ color: "#A9863A" }}>Unsubscribe</span>.
                    </p>
                  </div>
                  <div style={{ background: "#FAF6EC", padding: "20px 32px", textAlign: "center", borderTop: "1px solid rgba(200,169,81,0.25)" }}>
                    <p style={{ margin: 0, fontSize: "12px", color: "#4A5568", fontFamily: "Arial, sans-serif" }}>© 2026 Dr. Nath · Coaching for Impact</p>
                  </div>
                </div>
                <p className="text-center text-xs mt-3" style={{ color: "rgba(255,255,255,0.75)" }}>
                  <strong>[First name]</strong> is a placeholder — each subscriber is greeted by their own name.
                </p>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}
