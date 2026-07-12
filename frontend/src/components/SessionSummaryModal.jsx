import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { FiX, FiFileText, FiCheckCircle } from "react-icons/fi";
import { api } from "../utils/auth";

const GOLD = "#C8A951";
const DARK = "#1B2B4A";
const BROWN = "#4A5568";

// Read-only view of the AI-generated session summary (E7). Opened from the
// completed-session cards on My Learning (client) and My Sessions (coach).
export default function SessionSummaryModal({ session, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    api.get(`/bookings/${session.id}/ai-summary/`)
      .then((res) => { if (alive) setData(res.data); })
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [session.id]);

  const hasContent = data && (data.summary || (data.key_points || []).length || (data.action_items || []).length);

  return (
    <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0" style={{ background: "rgba(20,33,61,0.6)" }} onClick={onClose} />
      <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }}
        className="relative w-full max-w-lg rounded-2xl z-10 flex flex-col" style={{ background: "white", maxHeight: "90vh" }}>
        <div className="flex items-center justify-between p-5 border-b" style={{ borderColor: "rgba(200,169,81,0.2)" }}>
          <div className="min-w-0 flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: "rgba(200,169,81,0.15)" }}>
              <FiFileText size={17} style={{ color: GOLD }} />
            </div>
            <div className="min-w-0">
              <h3 className="text-lg font-normal truncate" style={{ color: DARK, fontFamily: "'Playfair Display', serif" }}>AI session summary</h3>
              <p className="text-xs mt-0.5" style={{ color: BROWN }}>{session.skill_title}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-full" style={{ background: "rgba(27,43,74,0.06)", color: BROWN }}><FiX size={16} /></button>
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><div className="w-8 h-8 rounded-full border-2 animate-spin" style={{ borderColor: GOLD, borderTopColor: "transparent" }} /></div>
        ) : !hasContent ? (
          <div className="p-8 text-center">
            <p className="text-sm" style={{ color: BROWN }}>No AI summary is available for this session.</p>
          </div>
        ) : (
          <div className="p-5 overflow-y-auto space-y-5">
            {data.summary && (
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: "#A9863A" }}>Overview</label>
                <p className="text-sm whitespace-pre-wrap leading-relaxed" style={{ color: DARK }}>{data.summary}</p>
              </div>
            )}
            {(data.key_points || []).length > 0 && (
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: "#A9863A" }}>Key points</label>
                <ul className="space-y-1.5">
                  {data.key_points.map((p, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm" style={{ color: DARK }}>
                      <span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: GOLD }} />
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(data.action_items || []).length > 0 && (
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: "#A9863A" }}>Action items</label>
                <ul className="space-y-1.5">
                  {data.action_items.map((p, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm" style={{ color: DARK }}>
                      <FiCheckCircle size={14} style={{ color: GOLD }} className="mt-0.5 shrink-0" />
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-[11px] leading-relaxed pt-1" style={{ color: "rgba(74,85,104,0.6)" }}>
              Generated automatically from the session transcript. It may not be perfectly accurate — please treat it as a helpful aid.
            </p>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
