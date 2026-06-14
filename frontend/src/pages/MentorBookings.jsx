import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { FiUser, FiClock, FiCalendar, FiMessageSquare, FiCheck, FiX, FiVideo, FiSearch, FiFilter, FiChevronDown } from "react-icons/fi";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "react-toastify";
import { api } from "../utils/auth";
import { useAuth } from "../context/AuthContext";

// ─── Status Badge ─────────────────────────────────────────────────────────────
const StatusBadge = ({ status }) => {
  const styles = {
    pending:  { bg: "rgba(251,191,36,0.12)", color: "#92400E", border: "1px solid rgba(251,191,36,0.3)" },
    accepted: { bg: "rgba(52,168,83,0.1)",   color: "#2E7D32", border: "1px solid rgba(52,168,83,0.25)" },
    declined: { bg: "rgba(239,68,68,0.08)",  color: "#B91C1C", border: "1px solid rgba(239,68,68,0.2)" },
    confirmed:{ bg: "rgba(52,168,83,0.1)",   color: "#2E7D32", border: "1px solid rgba(52,168,83,0.25)" },
  };
  const s = styles[status] || styles.pending;
  return (
    <span className="text-xs font-semibold px-3 py-1 rounded-full" style={{ background: s.bg, color: s.color, border: s.border }}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
};

// ─── Booking Card ─────────────────────────────────────────────────────────────
const BookingCard = ({ request, onAccept, onDecline, onJoin, index }) => {
  const formattedDate = new Date(request.session_date).toLocaleDateString("en-US", {
    weekday: "long", month: "short", day: "numeric",
  });
  const formattedTime = new Date(`2000-01-01T${request.session_time}`).toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", hour12: true,
  });

  const isPending = request.status === "pending";

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
      className="rounded-2xl overflow-hidden"
      style={{ background: "white", border: "1px solid rgba(200,169,81,0.15)", boxShadow: "0 2px 16px rgba(27,43,74,0.05)" }}
    >
      {/* Top accent */}
      <div className="h-1" style={{
        background: isPending
          ? "linear-gradient(90deg,#F59E0B,#FCD34D)"
          : request.status === "accepted"
          ? "linear-gradient(90deg,#34A853,#6FCF97)"
          : "rgba(239,68,68,0.3)"
      }} />

      <div className="p-6">
        {/* Header row */}
        <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: "#C8A951", color: "#14213D" }}>
                {request.learner_username?.charAt(0).toUpperCase()}
              </div>
              <h3 className="text-lg font-normal text-[#1B2B4A]" style={{ fontFamily: "'Playfair Display', serif" }}>
                {request.learner_username}
              </h3>
            </div>
            <p className="text-sm text-[#4A5568]">
              Requested: <span className="font-semibold text-[#C8A951]">{request.skill_title}</span>
            </p>
          </div>
          <StatusBadge status={request.status} />
        </div>

        {/* Info grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
          <div className="flex items-center gap-2.5 rounded-xl px-4 py-3" style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.15)" }}>
            <FiCalendar size={14} style={{ color: "#C8A951" }} />
            <span className="text-sm text-[#1B2B4A] font-medium">{formattedDate}</span>
          </div>
          <div className="flex items-center gap-2.5 rounded-xl px-4 py-3" style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.15)" }}>
            <FiClock size={14} style={{ color: "#C8A951" }} />
            <span className="text-sm text-[#1B2B4A] font-medium">{formattedTime} · {request.duration} mins</span>
          </div>
          {request.skill_level && (
            <div className="flex items-center gap-2.5 rounded-xl px-4 py-3" style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.15)" }}>
              <FiUser size={14} style={{ color: "#C8A951" }} />
              <span className="text-sm text-[#1B2B4A]">Level: <span className="font-medium">{request.skill_level}</span></span>
            </div>
          )}
          {request.status === "accepted" && (() => {
            const sessionEnd = new Date(
              new Date(`${request.session_date}T${request.session_time}`).getTime() +
              request.duration * 60 * 1000
            );
            const expired = sessionEnd < new Date();
            return (
              <div
                className="flex items-center gap-2.5 rounded-xl px-4 py-3 transition-all"
                style={{
                  background: expired ? "rgba(200,169,81,0.04)" : "rgba(200,169,81,0.08)",
                  border: "1px solid rgba(200,169,81,0.2)",
                  cursor: expired ? "not-allowed" : "pointer",
                  opacity: expired ? 0.5 : 1,
                }}
                onClick={() => !expired && onJoin(request.id)}
              >
                <FiVideo size={14} style={{ color: "#C8A951" }} />
                <span className="text-sm font-semibold" style={{ color: "#A9863A" }}>
                  {expired ? "Session Expired" : "Start Session"}
                </span>
              </div>
            );
          })()}
        </div>

        {/* Message */}
        {request.message && (
          <div className="rounded-xl px-4 py-3 mb-5" style={{ background: "#F3ECD9", border: "1px solid rgba(200,169,81,0.2)" }}>
            <div className="flex items-start gap-2">
              <FiMessageSquare size={13} className="mt-0.5 shrink-0" style={{ color: "#C8A951" }} />
              <p className="text-sm italic text-[#4A5568]">"{request.message}"</p>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-3">
          {isPending && (
            <>
              <motion.button
                whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                onClick={() => onAccept(request.id)}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-full text-sm font-bold transition-all duration-200"
                style={{ background: "rgba(52,168,83,0.1)", color: "#2E7D32", border: "1px solid rgba(52,168,83,0.25)" }}
              >
                <FiCheck size={14} /> Accept Session
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                onClick={() => onDecline(request.id)}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-full text-sm font-bold transition-all duration-200"
                style={{ background: "rgba(239,68,68,0.08)", color: "#B91C1C", border: "1px solid rgba(239,68,68,0.2)" }}
              >
                <FiX size={14} /> Decline
              </motion.button>
            </>
          )}
          {request.status === "accepted" && (() => {
            const sessionEnd = new Date(
              new Date(`${request.session_date}T${request.session_time}`).getTime() +
              request.duration * 60 * 1000
            );
            const expired = sessionEnd < new Date();
            return (
              <motion.button
                whileHover={!expired ? { scale: 1.02 } : {}}
                whileTap={!expired ? { scale: 0.97 } : {}}
                onClick={() => !expired && onJoin(request.id)}
                disabled={expired}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-full text-sm font-bold transition-all"
                style={{
                  background: expired ? "rgba(200,169,81,0.08)" : "linear-gradient(135deg,#C8A951,#F0D98C)",
                  color: expired ? "rgba(169,134,58,0.45)" : "#14213D",
                  cursor: expired ? "not-allowed" : "pointer",
                  border: expired ? "1px solid rgba(200,169,81,0.2)" : "none",
                }}
              >
                <FiVideo size={14} />
                {expired ? "Session Expired" : "Start Session"}
              </motion.button>
            );
          })()}
        </div>
      </div>
    </motion.div>
  );
};

// ─── Meeting Link Modal ───────────────────────────────────────────────────────
const MeetingLinkModal = ({ onConfirm, onCancel, value, onChange }) => (
  <motion.div
    className="fixed inset-0 z-50 flex items-center justify-center p-4"
    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
  >
    <motion.div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onCancel} />
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
      <h3 className="text-xl font-normal text-[#1B2B4A] mb-2" style={{ fontFamily: "'Playfair Display', serif" }}>
        Add Meeting Link
      </h3>
      <p className="text-sm text-[#4A5568] mb-5">
        Optionally add a Zoom, Google Meet, or Jitsi link for this session.
      </p>
      <input
        type="url"
        placeholder="https://meet.jit.si/your-room (optional)"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full px-4 py-3 rounded-xl text-sm focus:outline-none mb-5 transition-all duration-200"
        style={{ background: "white", border: "1px solid rgba(200,169,81,0.3)", color: "#1B2B4A" }}
        onFocus={e => e.target.style.borderColor = "#C8A951"}
        onBlur={e => e.target.style.borderColor = "rgba(200,169,81,0.3)"}
      />
      <div className="flex gap-3">
        <button
          onClick={onCancel}
          className="flex-1 py-2.5 rounded-full text-sm font-semibold border transition-all duration-200"
          style={{ borderColor: "rgba(200,169,81,0.3)", color: "#4A5568" }}
        >
          Cancel
        </button>
        <button onClick={onConfirm} className="flex-1 gold-btn py-2.5 rounded-full text-sm font-bold">
          Accept & Save
        </button>
      </div>
    </motion.div>
  </motion.div>
);

const PAGE_SIZE = 4;

const Pagination = ({ page, totalPages, onChange }) => {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-2 mt-6">
      <button onClick={() => onChange(page - 1)} disabled={page === 1}
        className="px-4 py-2 rounded-xl text-sm font-semibold transition-all disabled:opacity-30"
        style={{ background: "white", border: "1px solid rgba(200,169,81,0.25)", color: "#4A5568" }}>
        ← Prev
      </button>
      {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
        <button key={p} onClick={() => onChange(p)}
          className="w-9 h-9 rounded-xl text-sm font-bold transition-all"
          style={{ background: p === page ? "#C8A951" : "white", color: p === page ? "#14213D" : "#4A5568", border: `1px solid ${p === page ? "#C8A951" : "rgba(200,169,81,0.25)"}` }}>
          {p}
        </button>
      ))}
      <button onClick={() => onChange(page + 1)} disabled={page === totalPages}
        className="px-4 py-2 rounded-xl text-sm font-semibold transition-all disabled:opacity-30"
        style={{ background: "white", border: "1px solid rgba(200,169,81,0.25)", color: "#4A5568" }}>
        Next →
      </button>
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────
const MentorBookings = () => {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);

  // Filters
  const [search, setSearch] = useState("");
  const [clientFilter, setClientFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortOrder, setSortOrder] = useState("newest");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const { isAuthenticated, isCoach, logout } = useAuth();
  const navigate = useNavigate();

  const fetchRequests = useCallback(async () => {
    if (!isAuthenticated || !isCoach()) { logout(); return; }
    setLoading(true);
    try {
      const res = await api.get("/bookings/");
      setRequests(res.data);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to load bookings.");
      if (err.response?.status === 401) logout();
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, isCoach, logout]);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  const updateStatus = async (id, status, extra = {}) => {
    try {
      const res = await api.patch(`/bookings/${parseInt(id)}/`, { status, ...extra });
      setRequests(r => r.map(x => x.id === parseInt(id) ? { ...x, ...res.data } : x));
      toast.success(`Booking ${status} successfully!`);
    } catch (err) {
      toast.error(err.response?.data?.detail || `Failed to ${status} booking.`);
    }
  };

  const handleAccept = (id) => updateStatus(id, "accepted");
  const handleDecline = (id) => updateStatus(id, "declined");
  const handleJoin = (id) => navigate(`/session/${id}`);

  const filters = ["all", "pending", "accepted", "declined"];

  const counts = {
    all: requests.length,
    pending: requests.filter(r => r.status === "pending").length,
    accepted: requests.filter(r => r.status === "accepted").length,
    declined: requests.filter(r => r.status === "declined").length,
  };

  const applyFilters = (list) => {
    let out = [...list];
    if (search.trim())
      out = out.filter(r => r.skill_title?.toLowerCase().includes(search.trim().toLowerCase()));
    if (clientFilter.trim())
      out = out.filter(r => r.learner_username?.toLowerCase().includes(clientFilter.trim().toLowerCase()));
    if (dateFrom)
      out = out.filter(r => r.session_date >= dateFrom);
    if (dateTo)
      out = out.filter(r => r.session_date <= dateTo);
    out.sort((a, b) => {
      const dtA = new Date(`${a.session_date}T${a.session_time}`);
      const dtB = new Date(`${b.session_date}T${b.session_time}`);
      return sortOrder === "newest" ? dtB - dtA : dtA - dtB;
    });
    return out;
  };

  const hasActiveFilters = search || clientFilter || dateFrom || dateTo || sortOrder !== "newest";
  const resetFilters = () => { setSearch(""); setClientFilter(""); setDateFrom(""); setDateTo(""); setSortOrder("newest"); setPage(1); };

  const tabFiltered = requests.filter(r => filter === "all" || r.status === filter);
  const filtered = applyFilters(tabFiltered);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pagedRequests = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (loading) return (
    <div className="flex justify-center items-center min-h-screen" style={{ background: "#FAF6EC" }}>
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "#C8A951", borderTopColor: "transparent" }} />
        <p className="text-sm" style={{ color: "rgba(74,85,104,0.7)" }}>Loading bookings...</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen pt-28 pb-16 px-6" style={{ background: "#FAF6EC" }}>
      <div className="max-w-5xl mx-auto">

        {/* ── Header ──────────────────────────────────────── */}
        <motion.div
          className="mb-8"
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
        >
          <h1 className="text-3xl md:text-4xl font-normal text-[#1B2B4A]" style={{ fontFamily: "'Playfair Display', serif" }}>Booking Requests</h1>
        </motion.div>

        {/* ── Stats row ────────────────────────────────────── */}
        <motion.div
          className="grid grid-cols-3 gap-4 mb-8"
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1 }}
        >
          {[
            { label: "Total", value: counts.all, color: "#1B2B4A" },
            { label: "Pending", value: counts.pending, color: "#92400E" },
            { label: "Accepted", value: counts.accepted, color: "#2E7D32" },
          ].map(s => (
            <div key={s.label} className="rounded-2xl p-5" style={{ background: "white", border: "1px solid rgba(200,169,81,0.15)" }}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: "rgba(74,85,104,0.6)" }}>{s.label}</p>
              <p className="text-3xl font-bold" style={{ fontFamily: "'Playfair Display', serif", color: s.color }}>{s.value}</p>
            </div>
          ))}
        </motion.div>

        {/* ── Filter tabs ──────────────────────────────────── */}
        <motion.div
          className="flex gap-2 flex-wrap mb-6"
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.15 }}
        >
          {filters.map(f => (
            <button
              key={f}
              onClick={() => { setFilter(f); setPage(1); }}
              className="px-4 py-2 rounded-full text-xs font-semibold transition-all duration-200 capitalize"
              style={{
                background: filter === f ? "#C8A951" : "white",
                color: filter === f ? "#14213D" : "#4A5568",
                border: `1px solid ${filter === f ? "#C8A951" : "rgba(200,169,81,0.25)"}`,
              }}
            >
              {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
              <span className="ml-1.5 text-xs opacity-70">({counts[f]})</span>
            </button>
          ))}
        </motion.div>

        {/* ── Search + Filters ─────────────────────────────── */}
        <motion.div className="mb-5" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.2 }}>
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
              <button onClick={resetFilters} className="px-3 py-2.5 rounded-xl text-xs font-semibold"
                style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#B91C1C" }}>
                Clear
              </button>
            )}
          </div>

          <AnimatePresence>
            {filtersOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }} className="overflow-hidden"
              >
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 rounded-xl mt-1" style={{ background: "white", border: "1px solid rgba(200,169,81,0.2)" }}>
                  <div>
                    <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wide" style={{ color: "rgba(74,85,104,0.7)" }}>Client name</label>
                    <input value={clientFilter} onChange={e => { setClientFilter(e.target.value); setPage(1); }}
                      placeholder="e.g. john"
                      className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                      style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.2)", color: "#1B2B4A" }} />
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

        {/* ── List / Empty ─────────────────────────────────── */}
        <AnimatePresence mode="wait">
          {filtered.length === 0 ? (
            <motion.div
              key="empty"
              className="text-center py-20 rounded-2xl"
              style={{ background: "white", border: "1px solid rgba(200,169,81,0.15)" }}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            >
              <p className="text-5xl mb-4">📅</p>
              <h3 className="text-xl font-normal text-[#1B2B4A] mb-2" style={{ fontFamily: "'Playfair Display', serif" }}>
                No {filter === "all" ? "" : filter} requests
              </h3>
              <p className="text-sm text-[#4A5568]">
                {filter === "pending" ? "No pending requests right now." : "Check back later for updates."}
              </p>
            </motion.div>
          ) : (
            <motion.div key="list" className="space-y-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {pagedRequests.map((req, i) => (
                <BookingCard
                  key={req.id}
                  request={req}
                  index={i}
                  onAccept={handleAccept}
                  onDecline={handleDecline}
                  onJoin={handleJoin}
                />
              ))}
            </motion.div>
          )}
        </AnimatePresence>
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      </div>
    </div>
  );
};

export default MentorBookings;
