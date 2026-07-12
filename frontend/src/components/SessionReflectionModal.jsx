import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "react-toastify";
import { FiX, FiPlus, FiTrash2, FiCheckCircle, FiZap } from "react-icons/fi";
import { api } from "../utils/auth";

const GOLD = "#C8A951";
const DARK = "#1B2B4A";
const BROWN = "#4A5568";

// Post-session reflection: the client captures takeaways + action items; the
// coach can view them read-only. Used from My Learning (client) and My Sessions
// (coach). `readOnly` = coach view.
export default function SessionReflectionModal({ session, readOnly = false, onClose, onSaved }) {
  const [takeaways, setTakeaways] = useState("");
  const [items, setItems] = useState([]);
  const [aiItems, setAiItems] = useState([]); // AI-suggested action items (client only)
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    api.get(`/bookings/${session.id}/reflection/`)
      .then((res) => {
        if (!alive) return;
        setTakeaways(res.data.takeaways || "");
        setItems(Array.isArray(res.data.action_items) ? res.data.action_items : []);
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    // Offer the AI-generated action items as a one-tap starting point (client only).
    if (!readOnly) {
      api.get(`/bookings/${session.id}/ai-summary/`)
        .then((res) => { if (alive && Array.isArray(res.data.action_items)) setAiItems(res.data.action_items); })
        .catch(() => {});
    }
    return () => { alive = false; };
  }, [session.id, readOnly]);

  const setItem = (i, patch) => setItems((arr) => arr.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const addItem = () => setItems((arr) => [...arr, { text: "", done: false }]);
  const removeItem = (i) => setItems((arr) => arr.filter((_, idx) => idx !== i));

  // Append any AI suggestions not already present in the client's list.
  const addAiSuggestions = () => setItems((arr) => {
    const existing = new Set(arr.map((it) => (it.text || "").trim().toLowerCase()));
    const additions = aiItems
      .filter((t) => t && !existing.has(String(t).trim().toLowerCase()))
      .map((t) => ({ text: String(t).slice(0, 500), done: false }));
    return [...arr, ...additions];
  });

  const save = async () => {
    setSaving(true);
    try {
      const clean = items.map((it) => ({ text: (it.text || "").trim(), done: !!it.done })).filter((it) => it.text);
      await api.put(`/bookings/${session.id}/reflection/`, { takeaways: takeaways.trim(), action_items: clean });
      toast.success("Your session notes were saved.");
      onSaved?.();
      onClose();
    } catch {
      toast.error("Couldn't save your notes. Please try again.");
    } finally { setSaving(false); }
  };

  return (
    <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0" style={{ background: "rgba(20,33,61,0.6)" }} onClick={onClose} />
      <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }}
        className="relative w-full max-w-lg rounded-2xl z-10 flex flex-col" style={{ background: "white", maxHeight: "90vh" }}>
        <div className="flex items-center justify-between p-5 border-b" style={{ borderColor: "rgba(200,169,81,0.2)" }}>
          <div className="min-w-0">
            <h3 className="text-lg font-normal truncate" style={{ color: DARK, fontFamily: "'Playfair Display', serif" }}>
              {readOnly ? "Client's session notes" : "Your session notes"}
            </h3>
            <p className="text-xs mt-0.5" style={{ color: BROWN }}>{session.skill_title}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-full" style={{ background: "rgba(27,43,74,0.06)", color: BROWN }}><FiX size={16} /></button>
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><div className="w-8 h-8 rounded-full border-2 animate-spin" style={{ borderColor: GOLD, borderTopColor: "transparent" }} /></div>
        ) : (
          <div className="p-5 overflow-y-auto space-y-5">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: "#A9863A" }}>Key takeaways</label>
              {readOnly ? (
                <p className="text-sm whitespace-pre-wrap" style={{ color: DARK }}>{takeaways || <span style={{ color: "rgba(74,85,104,0.5)" }}>No takeaways added.</span>}</p>
              ) : (
                <textarea value={takeaways} onChange={(e) => setTakeaways(e.target.value)} rows={4}
                  placeholder="What stood out? What did you learn or realise in this session?"
                  className="w-full px-4 py-2.5 rounded-xl text-sm resize-none focus:outline-none"
                  style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.3)", color: DARK }} />
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: "#A9863A" }}>Action items / next steps</label>
              {items.length === 0 && readOnly && (
                <p className="text-sm" style={{ color: "rgba(74,85,104,0.5)" }}>No action items added.</p>
              )}
              <div className="space-y-2">
                {items.map((it, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input type="checkbox" checked={!!it.done} disabled={readOnly}
                      onChange={(e) => setItem(i, { done: e.target.checked })} style={{ accentColor: GOLD }} className="shrink-0" />
                    {readOnly ? (
                      <span className="text-sm flex-1" style={{ color: DARK, textDecoration: it.done ? "line-through" : "none", opacity: it.done ? 0.6 : 1 }}>{it.text}</span>
                    ) : (
                      <input value={it.text} onChange={(e) => setItem(i, { text: e.target.value })} placeholder="e.g. Practise the breathing exercise daily"
                        className="flex-1 px-3 py-2 rounded-lg text-sm focus:outline-none"
                        style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.3)", color: DARK, textDecoration: it.done ? "line-through" : "none" }} />
                    )}
                    {!readOnly && (
                      <button onClick={() => removeItem(i)} className="p-1 rounded shrink-0" style={{ color: "#B91C1C" }}><FiTrash2 size={14} /></button>
                    )}
                  </div>
                ))}
              </div>
              {!readOnly && (
                <div className="mt-2 flex items-center gap-4 flex-wrap">
                  <button onClick={addItem} className="inline-flex items-center gap-1.5 text-xs font-semibold" style={{ color: "#A9863A" }}>
                    <FiPlus size={13} /> Add action item
                  </button>
                  {aiItems.length > 0 && (
                    <button onClick={addAiSuggestions} className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: "rgba(200,169,81,0.12)", color: "#A9863A" }}>
                      <FiZap size={12} /> Add AI suggestions
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {!readOnly && !loading && (
          <div className="flex gap-3 p-5 border-t" style={{ borderColor: "rgba(200,169,81,0.2)" }}>
            <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold" style={{ background: "rgba(27,43,74,0.06)", color: BROWN }}>Cancel</button>
            <button onClick={save} disabled={saving} className="flex-1 py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-60"
              style={{ background: `linear-gradient(135deg,${GOLD},#F0D98C)`, color: "#14213D" }}>
              <FiCheckCircle size={15} /> {saving ? "Saving…" : "Save notes"}
            </button>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
