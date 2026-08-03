import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { FiX, FiFileText, FiCheckCircle, FiDownload } from "react-icons/fi";
import { api } from "../utils/auth";
import { downloadFile } from "../utils/downloadFile";

const GOLD = "#C8A951";
const DARK = "#1B2B4A";
const BROWN = "#4A5568";

function StatTile({ label, value }) {
  return (
    <div className="rounded-xl p-3 text-center" style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.2)" }}>
      <div className="text-lg font-bold" style={{ color: DARK }}>{value != null && value !== "" ? value : "—"}</div>
      <div className="text-[10px] uppercase tracking-wider mt-0.5" style={{ color: "rgba(74,85,104,0.6)" }}>{label}</div>
    </div>
  );
}

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
            {data.analytics && (data.analytics.meeting_score != null || (data.analytics.deep_dive || []).length > 0) && (
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "#A9863A" }}>Meeting analytics</label>
                <div className="grid grid-cols-3 gap-2 mb-3">
                  <StatTile label="Meeting score" value={data.analytics.meeting_score != null ? `${data.analytics.meeting_score}` : null} />
                  <StatTile label="Engagement" value={data.analytics.engagement != null ? `${data.analytics.engagement}` : null} />
                  <StatTile label="Sentiment" value={data.analytics.sentiment} />
                </div>
                {(data.analytics.deep_dive || []).length > 0 && (
                  <div className="space-y-2.5">
                    {data.analytics.deep_dive.map((d, i) => (
                      <div key={i}>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="font-semibold" style={{ color: DARK }}>{d.indicator}</span>
                          {d.score != null && <span className="font-bold" style={{ color: "#A9863A" }}>{d.score}</span>}
                        </div>
                        {d.score != null && (
                          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(200,169,81,0.15)" }}>
                            <div className="h-full rounded-full" style={{ width: `${d.score}%`, background: "linear-gradient(90deg,#C8A951,#F0D98C)" }} />
                          </div>
                        )}
                        {d.explanation && <p className="text-xs mt-1 leading-relaxed" style={{ color: BROWN }}>{d.explanation}</p>}
                      </div>
                    ))}
                  </div>
                )}
                {(data.analytics.topics || []).length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {data.analytics.topics.map((t, i) => (
                      <span key={i} className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: "rgba(91,117,102,0.12)", color: "#5B7566" }}>{t}</span>
                    ))}
                  </div>
                )}
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
            {(data.reflection_points || []).length > 0 && (
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: "#A9863A" }}>Points to reflect on</label>
                <ul className="space-y-1.5">
                  {data.reflection_points.map((p, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm" style={{ color: DARK }}>
                      <span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: GOLD }} />
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {data.has_transcript && (
              <button onClick={() => downloadFile(`/bookings/${session.id}/transcript/`, `transcript-session-${session.id}.txt`)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold" style={{ background: "rgba(200,169,81,0.12)", color: "#A9863A" }}>
                <FiDownload size={13} /> Download transcript
              </button>
            )}
            <p className="text-[11px] leading-relaxed pt-1" style={{ color: "rgba(74,85,104,0.6)" }}>
              Generated automatically from the session transcript. Scores are AI estimates and may not be perfectly accurate — please treat them as a helpful aid.
            </p>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
