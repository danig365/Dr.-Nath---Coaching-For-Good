import { useState, useEffect, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import { toast } from "react-toastify";
import { FiMail, FiSend, FiRefreshCw, FiSearch } from "react-icons/fi";
import { api } from "../utils/auth";
import { useAuth } from "../context/AuthContext";

const fmtWhen = (iso, tz) =>
  new Date(iso).toLocaleString([], {
    weekday: "short", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: tz || undefined,
  });

const fmtSent = (iso, tz) =>
  new Date(iso).toLocaleString([], {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    timeZone: tz || undefined,
  });

// Status pill styling per derived invite status.
const STATUS_STYLES = {
  pending: { label: "Pending", bg: "rgba(200,169,81,0.14)", color: "#A9863A", border: "rgba(200,169,81,0.3)" },
  booked:  { label: "Booked",  bg: "rgba(52,168,83,0.10)",  color: "#2E7D32", border: "rgba(52,168,83,0.25)" },
  filled:  { label: "Slot filled", bg: "rgba(74,85,104,0.10)", color: "#4A5568", border: "rgba(74,85,104,0.2)" },
  expired: { label: "Expired", bg: "rgba(176,0,32,0.08)", color: "#B00020", border: "rgba(176,0,32,0.2)" },
};

const StatusBadge = ({ status }) => {
  const s = STATUS_STYLES[status] || STATUS_STYLES.pending;
  return (
    <span className="text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap"
      style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>
      {s.label}
    </span>
  );
};

// Embeddable "Sent Invites" history + one-click resend.
// Rendered inside the Availability page's tab bar (no page chrome of its own).
// `tz` is the coach's display timezone; falls back to the auth context tz.
export default function SentInvitesPanel({ tz }) {
  const { timezone } = useAuth();
  const displayTz = tz || timezone;
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [resendingId, setResendingId] = useState(null);
  const [filter, setFilter] = useState("all");   // all | pending | booked | filled | expired
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/bookings/invites/");
      setInvites(Array.isArray(res.data) ? res.data : res.data.results || []);
    } catch {
      toast.error("Could not load your sent invites.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Counts per status drive the filter tab badges.
  const counts = useMemo(() => {
    const c = { all: invites.length, pending: 0, booked: 0, filled: 0, expired: 0 };
    for (const i of invites) c[i.status] = (c[i.status] || 0) + 1;
    return c;
  }, [invites]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return invites.filter(i =>
      (filter === "all" || i.status === filter) &&
      (!q || i.email.toLowerCase().includes(q) || (i.skill_title || "").toLowerCase().includes(q))
    );
  }, [invites, filter, query]);

  const resend = async (invite) => {
    setResendingId(invite.id);
    try {
      const res = await api.post(`/bookings/invites/${invite.id}/resend/`);
      toast.success(res.data?.detail || "Invite resent.");
      // Patch the row in place with the refreshed counters/timestamp.
      if (res.data?.invite) {
        setInvites(prev => prev.map(i => (i.id === invite.id ? res.data.invite : i)));
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || "Could not resend the invite.");
    } finally {
      setResendingId(null);
    }
  };

  if (loading) return (
    <div className="flex justify-center py-20">
      <div className="w-9 h-9 rounded-full border-2 animate-spin"
        style={{ borderColor: "#C8A951", borderTopColor: "transparent" }} />
    </div>
  );

  if (invites.length === 0) return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      className="rounded-2xl p-12 text-center"
      style={{ background: "white", border: "1px solid rgba(200,169,81,0.15)" }}>
      <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
        style={{ background: "rgba(200,169,81,0.12)" }}>
        <FiMail size={24} style={{ color: "#A9863A" }} />
      </div>
      <h3 className="text-lg font-semibold text-[#1B2B4A] mb-1">No invites sent yet</h3>
      <p className="text-sm" style={{ color: "rgba(74,85,104,0.7)" }}>
        Open the <span className="font-semibold">Calendar</span> tab and share a slot to invite people to book.
      </p>
    </motion.div>
  );

  return (
    <div>
      {/* Filters + search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div className="flex flex-wrap gap-2">
          {[
            ["all", "All"], ["pending", "Pending"], ["booked", "Booked"],
            ["filled", "Slot filled"], ["expired", "Expired"],
          ].filter(([key]) => key === "all" || counts[key] > 0).map(([key, label]) => (
            <button key={key} onClick={() => setFilter(key)}
              className="px-4 py-1.5 rounded-full text-xs font-semibold transition-all"
              style={filter === key
                ? { background: "#1B2B4A", color: "#FAF6EC" }
                : { background: "white", color: "#4A5568", border: "1px solid rgba(27,43,74,0.12)" }}>
              {label} <span style={{ opacity: 0.7 }}>{counts[key] || 0}</span>
            </button>
          ))}
        </div>
        <div className="relative">
          <FiSearch size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "rgba(74,85,104,0.5)" }} />
          <input value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search recipient or session…"
            className="pl-9 pr-4 py-2 rounded-full text-sm focus:outline-none w-full sm:w-64"
            style={{ background: "white", border: "1px solid rgba(27,43,74,0.12)", color: "#1B2B4A" }} />
        </div>
      </div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        className="rounded-2xl overflow-hidden"
        style={{ background: "white", border: "1px solid rgba(200,169,81,0.15)", boxShadow: "0 2px 16px rgba(27,43,74,0.05)" }}>
        {/* Header row (desktop) */}
        <div className="hidden md:grid grid-cols-[1.4fr_1.6fr_1fr_auto] gap-4 px-6 py-3 text-xs font-semibold uppercase tracking-wider"
          style={{ color: "rgba(74,85,104,0.6)", borderBottom: "1px solid rgba(200,169,81,0.15)", background: "#FAF6EC" }}>
          <span>Recipient</span>
          <span>Session</span>
          <span>Sent</span>
          <span className="text-right">Status / Action</span>
        </div>

        {visible.length === 0 && (
          <div className="px-6 py-10 text-center text-sm" style={{ color: "rgba(74,85,104,0.7)" }}>
            No invites match this filter.
          </div>
        )}

        {visible.map((inv) => (
          <div key={inv.id}
            className="grid grid-cols-1 md:grid-cols-[1.4fr_1.6fr_1fr_auto] gap-2 md:gap-4 px-6 py-4 items-center"
            style={{ borderBottom: "1px solid rgba(200,169,81,0.10)" }}>

            {/* Recipient */}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <FiMail size={13} style={{ color: "#C8A951" }} className="shrink-0" />
                <span className="text-sm font-medium text-[#1B2B4A] truncate" title={inv.email}>{inv.email}</span>
              </div>
              {inv.note && (
                <p className="text-xs mt-1 truncate" style={{ color: "rgba(74,85,104,0.6)" }} title={inv.note}>
                  “{inv.note}”
                </p>
              )}
            </div>

            {/* Session */}
            <div className="text-sm" style={{ color: "#4A5568" }}>
              <div className="font-medium text-[#1B2B4A]">{inv.skill_title || "—"}</div>
              <div className="text-xs mt-0.5">{fmtWhen(inv.slot_start, displayTz)}</div>
            </div>

            {/* Sent */}
            <div className="text-sm" style={{ color: "#4A5568" }}>
              <div className="text-xs">{fmtSent(inv.last_sent_at, displayTz)}</div>
              {inv.sent_count > 1 && (
                <div className="text-xs mt-0.5" style={{ color: "#A9863A" }}>Sent {inv.sent_count}×</div>
              )}
            </div>

            {/* Status + resend */}
            <div className="flex items-center justify-start md:justify-end gap-3">
              <StatusBadge status={inv.status} />
              {inv.can_resend && (
                <button onClick={() => resend(inv)} disabled={resendingId === inv.id}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all disabled:opacity-60"
                  style={{ background: "rgba(200,169,81,0.12)", color: "#A9863A", border: "1px solid rgba(200,169,81,0.3)" }}
                  title="Resend this invite email">
                  {resendingId === inv.id
                    ? <FiRefreshCw size={12} className="animate-spin" />
                    : <FiSend size={12} />}
                  Resend
                </button>
              )}
            </div>
          </div>
        ))}
      </motion.div>
    </div>
  );
}
