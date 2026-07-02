import { useEffect, useState, useCallback } from "react";
import { api } from "../utils/auth";
import { useAuth } from "../context/AuthContext";
import { toast } from "react-toastify";
import { motion, AnimatePresence } from "framer-motion";
import { FiFileText, FiUploadCloud, FiDownload, FiEdit3, FiXCircle, FiCheckCircle, FiClock, FiX } from "react-icons/fi";
import { downloadFile } from "../utils/downloadFile";

const GOLD = "#C8A951";
const DARK = "#1B2B4A";
const BROWN = "#4A5568";

const STATUS = {
  sent:          { label: "Awaiting signature", bg: "rgba(251,191,36,0.14)", color: "#92400E", icon: FiClock },
  client_signed: { label: "Awaiting your counter-signature", bg: "rgba(200,169,81,0.14)", color: "#A9863A", icon: FiClock },
  completed:     { label: "Completed", bg: "rgba(52,168,83,0.12)", color: "#2E7D32", icon: FiCheckCircle },
  declined:      { label: "Declined", bg: "rgba(239,68,68,0.1)", color: "#B91C1C", icon: FiXCircle },
};

// Sign / counter-sign / decline modal.
function ActionModal({ mode, doc, onClose, onSubmit }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const isDecline = mode === "decline";
  const submit = async (e) => {
    e.preventDefault();
    if (!isDecline && !value.trim()) { toast.error("Type your full name to sign."); return; }
    setBusy(true);
    try { await onSubmit(value.trim()); } finally { setBusy(false); }
  };
  return (
    <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0" style={{ background: "rgba(20,33,61,0.6)" }} onClick={onClose} />
      <motion.form onSubmit={submit} initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        className="relative w-full max-w-md rounded-2xl p-6 z-10" style={{ background: "white" }}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-xl font-normal" style={{ color: DARK, fontFamily: "'Playfair Display', serif" }}>
            {isDecline ? "Decline document" : mode === "counter" ? "Counter-sign" : "Sign document"}
          </h3>
          <button type="button" onClick={onClose} className="p-1.5 rounded-full" style={{ background: "rgba(27,43,74,0.06)", color: BROWN }}><FiX size={16} /></button>
        </div>
        <p className="text-sm mb-4" style={{ color: BROWN }}>{doc.title}</p>
        {isDecline ? (
          <textarea value={value} onChange={(e) => setValue(e.target.value)} rows={3} placeholder="Reason (optional)…"
            className="w-full px-4 py-2.5 rounded-xl text-sm resize-none focus:outline-none mb-5"
            style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.3)", color: DARK }} />
        ) : (
          <>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "rgba(74,85,104,0.7)" }}>Type your full name</label>
            <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. Nathalie Chinje"
              className="w-full px-4 py-2.5 rounded-xl focus:outline-none mb-2"
              style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.3)", color: DARK, fontFamily: "'Playfair Display', serif", fontStyle: "italic", fontSize: "18px" }} />
            <p className="text-xs mb-5" style={{ color: "rgba(74,85,104,0.6)" }}>
              Typing your name and clicking below is your electronic signature (recorded with date, time and IP).
            </p>
          </>
        )}
        <div className="flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold" style={{ background: "rgba(27,43,74,0.06)", color: BROWN }}>Cancel</button>
          <button type="submit" disabled={busy}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold disabled:opacity-60"
            style={isDecline ? { background: "#DC2626", color: "white" } : { background: GOLD, color: "#14213D" }}>
            {busy ? "Submitting…" : isDecline ? "Decline" : "Sign"}
          </button>
        </div>
      </motion.form>
    </motion.div>
  );
}

const Agreements = () => {
  const { isAuthenticated, isCoach, logout } = useAuth();
  const coach = isCoach();
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [clients, setClients] = useState([]);
  const [form, setForm] = useState({ title: "", message: "", client: "", file: null });
  const [sending, setSending] = useState(false);
  const [modal, setModal] = useState(null); // { mode, doc }

  const fetchDocs = useCallback(async () => {
    if (!isAuthenticated) { logout(); return; }
    setLoading(true);
    try {
      const reqs = [api.get("/signatures/")];
      if (coach) reqs.push(api.get("/resources/clients/"));
      const [d, cs] = await Promise.all(reqs);
      setDocs(d.data);
      if (coach && cs) setClients(cs.data);
    } catch { toast.error("Failed to load documents."); }
    finally { setLoading(false); }
  }, [isAuthenticated, coach, logout]);

  useEffect(() => { fetchDocs(); }, [fetchDocs]);

  const send = async (e) => {
    e.preventDefault();
    if (!form.title.trim() || !form.client || !form.file) { toast.error("Title, client and file are required."); return; }
    setSending(true);
    try {
      const fd = new FormData();
      fd.append("title", form.title); fd.append("message", form.message);
      fd.append("client", form.client); fd.append("file", form.file);
      await api.post("/signatures/", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setForm({ title: "", message: "", client: "", file: null });
      toast.success("Sent to the client for signature.");
      fetchDocs();
    } catch (err) {
      toast.error(err.response?.data?.file?.[0] || err.response?.data?.detail || "Failed to send.");
    } finally { setSending(false); }
  };

  const runAction = async (mode, doc, value) => {
    try {
      const url = { sign: "sign", counter: "counter-sign", decline: "decline" }[mode];
      const body = mode === "decline" ? { reason: value } : { signature: value };
      const res = await api.post(`/signatures/${doc.id}/${url}/`, body);
      setDocs((ds) => ds.map((d) => (d.id === doc.id ? res.data : d)));
      setModal(null);
      toast.success(mode === "decline" ? "Document declined." : mode === "counter" ? "Counter-signed — document completed." : "Signed. Thank you!");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Action failed.");
    }
  };

  if (loading) return (
    <div className="flex justify-center items-center min-h-screen" style={{ background: "#FAF6EC" }}>
      <div className="w-10 h-10 rounded-full border-2 animate-spin" style={{ borderColor: GOLD, borderTopColor: "transparent" }} />
    </div>
  );

  return (
    <div className="min-h-screen pt-36 pb-16 px-6" style={{ background: "#FAF6EC" }}>
      <div className="max-w-3xl mx-auto">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: GOLD }}>E-Signatures</p>
          <h1 className="text-3xl font-normal" style={{ color: DARK, fontFamily: "'Playfair Display', serif" }}>Agreements</h1>
          <p className="text-sm mt-1" style={{ color: BROWN }}>
            {coach ? "Send documents to clients to sign, then counter-sign to complete." : "Review and sign documents your coach sent you."}
          </p>
        </motion.div>

        {/* Coach: send form */}
        {coach && (
          <form onSubmit={send} className="rounded-2xl p-5 mb-8 space-y-3"
            style={{ background: "white", border: "1px solid rgba(200,169,81,0.15)", boxShadow: "0 2px 12px rgba(27,43,74,0.04)" }}>
            <h3 className="flex items-center gap-2 text-sm font-bold" style={{ color: DARK }}><FiUploadCloud size={15} style={{ color: GOLD }} /> Send a document for signature</h3>
            <div className="grid sm:grid-cols-2 gap-3">
              <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Document title"
                className="px-4 py-2.5 rounded-xl text-sm focus:outline-none" style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.3)", color: DARK }} />
              <select value={form.client} onChange={(e) => setForm((f) => ({ ...f, client: e.target.value }))}
                className="px-4 py-2.5 rounded-xl text-sm focus:outline-none" style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.3)", color: DARK }}>
                <option value="">Select client…</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.username}</option>)}
              </select>
            </div>
            <textarea value={form.message} onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))} rows={2} placeholder="Message to the client (optional)…"
              className="w-full px-4 py-2.5 rounded-xl text-sm resize-none focus:outline-none" style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.3)", color: DARK }} />
            <div className="flex items-center gap-3 flex-wrap">
              <input type="file" onChange={(e) => setForm((f) => ({ ...f, file: e.target.files?.[0] || null }))}
                className="text-sm" style={{ color: BROWN }} />
              <button type="submit" disabled={sending} className="ml-auto px-5 py-2.5 rounded-full text-sm font-bold disabled:opacity-60"
                style={{ background: `linear-gradient(135deg,${GOLD},#F0D98C)`, color: "#14213D" }}>
                {sending ? "Sending…" : "Send for signature"}
              </button>
            </div>
          </form>
        )}

        {/* Documents list */}
        {docs.length === 0 ? (
          <div className="text-center py-20 rounded-2xl" style={{ background: "white", border: "1px dashed rgba(200,169,81,0.3)" }}>
            <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: "rgba(200,169,81,0.12)" }}>
              <FiFileText size={22} style={{ color: GOLD }} />
            </div>
            <h3 className="text-lg font-normal mb-1" style={{ color: DARK, fontFamily: "'Playfair Display', serif" }}>No documents yet</h3>
            <p className="text-sm" style={{ color: BROWN }}>{coach ? "Send a document above to get started." : "Documents your coach sends you will appear here."}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {docs.map((d) => {
              const st = STATUS[d.status] || STATUS.sent;
              const StIcon = st.icon;
              return (
                <div key={d.id} className="rounded-2xl p-5" style={{ background: "white", border: "1px solid rgba(200,169,81,0.15)", boxShadow: "0 2px 12px rgba(27,43,74,0.04)" }}>
                  <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
                    <div className="min-w-0">
                      <h3 className="text-lg font-normal" style={{ color: DARK, fontFamily: "'Playfair Display', serif" }}>{d.title}</h3>
                      <p className="text-xs mt-0.5" style={{ color: BROWN }}>
                        {coach ? `For ${d.client_name}` : `From ${d.coach_name}`}
                        {d.client_signed_at ? ` · client signed ${new Date(d.client_signed_at).toLocaleDateString()}` : ""}
                      </p>
                    </div>
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full shrink-0" style={{ background: st.bg, color: st.color }}>
                      <StIcon size={12} /> {st.label}
                    </span>
                  </div>
                  {d.message && <p className="text-sm mb-3" style={{ color: BROWN }}>{d.message}</p>}
                  {d.status === "declined" && d.decline_reason && (
                    <p className="text-sm mb-3" style={{ color: "#B91C1C" }}>Reason: {d.decline_reason}</p>
                  )}

                  <div className="flex items-center gap-2 flex-wrap">
                    <button onClick={() => downloadFile(`/signatures/${d.id}/download/`, `${d.title}.pdf`)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold" style={{ background: "rgba(200,169,81,0.12)", color: "#A9863A" }}>
                      <FiDownload size={12} /> Original
                    </button>

                    {/* Client actions */}
                    {!coach && d.status === "sent" && (
                      <>
                        <button onClick={() => setModal({ mode: "sign", doc: d })}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold" style={{ background: `linear-gradient(135deg,${GOLD},#F0D98C)`, color: "#14213D" }}>
                          <FiEdit3 size={12} /> Sign
                        </button>
                        <button onClick={() => setModal({ mode: "decline", doc: d })}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold" style={{ background: "rgba(239,68,68,0.08)", color: "#B91C1C" }}>
                          <FiXCircle size={12} /> Decline
                        </button>
                      </>
                    )}

                    {/* Coach action */}
                    {coach && d.status === "client_signed" && (
                      <button onClick={() => setModal({ mode: "counter", doc: d })}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold" style={{ background: `linear-gradient(135deg,${GOLD},#F0D98C)`, color: "#14213D" }}>
                        <FiEdit3 size={12} /> Counter-sign
                      </button>
                    )}

                    {/* Completed: signed download */}
                    {d.status === "completed" && d.has_signed_file && (
                      <button onClick={() => downloadFile(`/signatures/${d.id}/download-signed/`, `${d.title} (signed).pdf`)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold" style={{ background: "rgba(52,168,83,0.12)", color: "#2E7D32" }}>
                        <FiDownload size={12} /> Signed copy
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <AnimatePresence>
        {modal && (
          <ActionModal mode={modal.mode} doc={modal.doc} onClose={() => setModal(null)}
            onSubmit={(value) => runAction(modal.mode, modal.doc, value)} />
        )}
      </AnimatePresence>
    </div>
  );
};

export default Agreements;
