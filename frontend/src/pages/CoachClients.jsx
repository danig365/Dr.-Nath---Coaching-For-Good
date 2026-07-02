import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { FiSearch, FiUsers, FiMail, FiCalendar } from "react-icons/fi";
import { api } from "../utils/auth";
import { useAuth } from "../context/AuthContext";

export default function CoachClients() {
  const { isAuthenticated, isCoach, logout } = useAuth();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!isAuthenticated || !isCoach()) { logout(); return; }
    api.get("/clients/")
      .then((res) => setClients(Array.isArray(res.data) ? res.data : []))
      .catch(() => setClients([]))
      .finally(() => setLoading(false));
  }, [isAuthenticated, isCoach, logout]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(
      (c) =>
        (c.name || "").toLowerCase().includes(q) ||
        (c.email || "").toLowerCase().includes(q) ||
        (c.organisation || "").toLowerCase().includes(q)
    );
  }, [clients, query]);

  const fmtDate = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");

  return (
    <div className="min-h-screen pt-36 pb-16 px-6" style={{ background: "#FAF6EC" }}>
      <div className="max-w-5xl mx-auto">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <h1 className="text-3xl md:text-4xl font-normal mb-2 leading-tight" style={{ color: "#1B2B4A", fontFamily: "'Playfair Display', serif" }}>
            Your <em style={{ color: "#A9863A" }}>Clients</em>
          </h1>
          <p className="text-base" style={{ color: "#4A5568" }}>
            Everyone who has signed up — including people who haven't booked yet.
          </p>
        </motion.div>

        {/* Search + count */}
        <div className="flex flex-wrap items-center gap-3 mt-8 mb-5">
          <div className="relative flex-1 min-w-56">
            <FiSearch size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "#C8A951" }} />
            <input
              type="text"
              placeholder="Search by name, email or organisation…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-3 rounded-xl text-sm focus:outline-none"
              style={{ background: "white", border: "1px solid rgba(200,169,81,0.3)", color: "#1B2B4A" }}
            />
          </div>
          <span className="text-xs font-semibold uppercase tracking-wider px-3 py-2 rounded-full" style={{ background: "rgba(200,169,81,0.12)", color: "#A9863A" }}>
            <FiUsers size={12} className="inline mr-1" /> {filtered.length} {filtered.length === 1 ? "client" : "clients"}
          </span>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-10 h-10 rounded-full border-2 animate-spin" style={{ borderColor: "#C8A951", borderTopColor: "transparent" }} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 rounded-2xl" style={{ background: "white", border: "1px solid rgba(200,169,81,0.15)" }}>
            <p className="text-5xl mb-3">👥</p>
            <p className="text-sm" style={{ color: "#4A5568" }}>{clients.length === 0 ? "No clients have signed up yet." : "No clients match your search."}</p>
          </div>
        ) : (
          <div className="rounded-2xl overflow-hidden" style={{ background: "white", border: "1px solid rgba(200,169,81,0.15)", boxShadow: "0 2px 16px rgba(27,43,74,0.05)" }}>
            {/* Header row (desktop) */}
            <div className="hidden md:grid grid-cols-[1.6fr_1.4fr_0.9fr_0.9fr] gap-4 px-5 py-3 text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: "rgba(74,85,104,0.6)", background: "#FAF6EC", borderBottom: "1px solid rgba(200,169,81,0.15)" }}>
              <span>Client</span><span>Email</span><span>Joined</span><span>Sessions</span>
            </div>
            {filtered.map((c, i) => (
              <div key={c.user_id}
                className="grid grid-cols-1 md:grid-cols-[1.6fr_1.4fr_0.9fr_0.9fr] gap-1 md:gap-4 px-5 py-3.5 items-center"
                style={{ borderBottom: i < filtered.length - 1 ? "1px solid rgba(200,169,81,0.1)" : "none" }}>
                {/* Client */}
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold shrink-0" style={{ background: "#C8A951", color: "#14213D" }}>
                    {(c.name || "?").charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[#1B2B4A] truncate">{c.name}</p>
                    {(c.organisation || c.job_title) && (
                      <p className="text-xs truncate" style={{ color: "rgba(74,85,104,0.7)" }}>
                        {[c.job_title, c.organisation].filter(Boolean).join(" · ")}
                      </p>
                    )}
                  </div>
                </div>
                {/* Email */}
                <a href={`mailto:${c.email}`} className="text-sm truncate flex items-center gap-1.5 hover:underline" style={{ color: "#A9863A" }}>
                  <FiMail size={12} className="shrink-0 md:hidden" /> {c.email}
                </a>
                {/* Joined */}
                <span className="text-sm flex items-center gap-1.5" style={{ color: "#4A5568" }}>
                  <FiCalendar size={12} className="shrink-0 md:hidden" /> {fmtDate(c.joined)}
                </span>
                {/* Sessions */}
                <span className="text-sm" style={{ color: "#4A5568" }}>
                  <span className="font-bold text-[#1B2B4A]">{c.bookings_with_me}</span>
                  <span className="text-xs"> with you</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
