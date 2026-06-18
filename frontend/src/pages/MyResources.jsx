import { useState, useEffect, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import { toast } from "react-toastify";
import { FiFile, FiDownload, FiFolder, FiUploadCloud, FiTrash2, FiCheckCircle, FiClock, FiLink, FiExternalLink } from "react-icons/fi";
import { api, downloadResource, downloadSubmission } from "../utils/auth";
import { useAuth } from "../context/AuthContext";

const card = { background: "white", border: "1px solid rgba(200,169,81,0.15)", boxShadow: "0 2px 16px rgba(27,43,74,0.05)" };
const inputStyle = { background: "#FAF6EC", border: "1px solid rgba(27,43,74,0.2)", color: "#1B2B4A" };
const serif = { fontFamily: "'Playfair Display', serif" };
const fmtSize = (b) => (b == null ? "" : b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`);
const fmtDate = (iso) => new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const ACCEPT = ".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.csv,.png,.jpg,.jpeg,.gif,.webp,.mp4,.mov,.webm,.mp3,.m4a,.zip";

const STATUS_STYLE = {
  submitted: { background: "rgba(200,169,81,0.14)", color: "#A9863A", border: "1px solid rgba(200,169,81,0.25)" },
  reviewed: { background: "rgba(52,168,83,0.1)", color: "#2E7D32", border: "1px solid rgba(52,168,83,0.2)" },
};

const Field = ({ label, children }) => (
  <label className="flex flex-col gap-1">
    <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "rgba(74,85,104,0.7)" }}>{label}</span>
    {children}
  </label>
);

const emptyForm = { coach: "", title: "", note: "", in_response_to: "", file: null };

const MyResources = () => {
  const { isAuthenticated, logout } = useAuth();
  const [resources, setResources] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [coaches, setCoaches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [uploading, setUploading] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!isAuthenticated) { toast.error("Please log in."); logout(); return; }
    setLoading(true);
    try {
      const [shared, subs, cs] = await Promise.all([
        api.get("/resources/shared/"),
        api.get("/resources/submissions/"),
        api.get("/resources/submissions/coaches/"),
      ]);
      setResources(shared.data);
      setSubmissions(subs.data);
      setCoaches(cs.data);
      // Default the coach picker when there's only one option.
      if (cs.data.length === 1) setForm((f) => ({ ...f, coach: String(cs.data[0].id) }));
    } catch (err) {
      toast.error("Failed to load resources.");
      if (err.response?.status === 401) logout();
    } finally { setLoading(false); }
  }, [isAuthenticated, logout]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Shared resources grouped by coach → folder.
  const grouped = useMemo(() => {
    const byCoach = {};
    resources.forEach((r) => {
      const coach = r.coach_username || "Your coach";
      const folder = r.folder_name || "General";
      ((byCoach[coach] ||= {})[folder] ||= []).push(r);
    });
    return byCoach;
  }, [resources]);

  // Resources from the currently selected coach, offered as "responding to" options.
  const responseOptions = useMemo(
    () => resources.filter((r) => String(r.coach) === String(form.coach)),
    [resources, form.coach]
  );

  const download = async (r) => {
    setBusy(`r${r.id}`);
    try { await downloadResource(r.id, r.title); }
    catch { toast.error("Download failed."); }
    finally { setBusy(null); }
  };

  const downloadOwn = async (s) => {
    setBusy(`s${s.id}`);
    try { await downloadSubmission(s.id, s.title); }
    catch { toast.error("Download failed."); }
    finally { setBusy(null); }
  };

  const upload = async () => {
    if (!form.coach) { toast.error("Choose a coach to send this to."); return; }
    if (!form.title.trim() || !form.file) { toast.error("A title and a file are required."); return; }
    if (form.file.size > MAX_FILE_BYTES) { toast.error("File is larger than 50 MB."); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("coach", form.coach);
      fd.append("title", form.title.trim());
      fd.append("note", form.note || "");
      if (form.in_response_to) fd.append("in_response_to", form.in_response_to);
      fd.append("file", form.file);
      const res = await api.post("/resources/submissions/", fd);
      setSubmissions((s) => [res.data, ...s]);
      setForm((f) => ({ ...emptyForm, coach: f.coach }));
      toast.success("Uploaded to your coach.");
    } catch (err) {
      toast.error(err.response?.data?.file?.[0] || err.response?.data?.detail || "Upload failed.");
    } finally { setUploading(false); }
  };

  const deleteSubmission = async (id) => {
    try { await api.delete(`/resources/submissions/${id}/`); setSubmissions((s) => s.filter((x) => x.id !== id)); toast.success("Removed."); }
    catch (err) { toast.error(err.response?.data?.detail || "Failed to remove."); }
  };

  if (loading) return (
    <div className="flex justify-center items-center min-h-screen" style={{ background: "#FAF6EC" }}>
      <div className="w-10 h-10 rounded-full border-2 animate-spin" style={{ borderColor: "#C8A951", borderTopColor: "transparent" }} />
    </div>
  );

  return (
    <div className="min-h-screen pt-28 pb-16 px-6" style={{ background: "#FAF6EC" }}>
      <div className="max-w-4xl mx-auto">
        <motion.div className="mb-8" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] mb-2" style={{ color: "#A9863A" }}>Your workspace</p>
          <h1 className="text-3xl md:text-4xl font-normal text-[#1B2B4A]" style={serif}>Resources</h1>
        </motion.div>

        {/* ── Shared with you ─────────────────────────────────────────── */}
        <h2 className="text-lg font-normal text-[#1B2B4A] mb-3" style={serif}>Shared with you</h2>
        {resources.length === 0 ? (
          <div className="text-center py-12 rounded-2xl mb-10" style={card}>
            <p className="text-4xl mb-3">📂</p>
            <p className="text-sm text-[#4A5568]">Documents your coach shares with you will appear here.</p>
          </div>
        ) : (
          <div className="space-y-8 mb-12">
            {Object.entries(grouped).map(([coach, folders]) => (
              <div key={coach}>
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold" style={{ background: "#C8A951", color: "#14213D" }}>
                    {coach.charAt(0).toUpperCase()}
                  </span>
                  <h3 className="text-base font-normal text-[#1B2B4A]" style={serif}>{coach}</h3>
                </div>
                <div className="space-y-4">
                  {Object.entries(folders).map(([folder, items]) => (
                    <div key={folder} className="rounded-2xl p-5" style={card}>
                      <p className="flex items-center gap-2 text-sm font-semibold mb-3" style={{ color: "#A9863A" }}>
                        <FiFolder size={14} /> {folder}
                      </p>
                      <div className="space-y-2">
                        {items.map((r) => (
                          <div key={r.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl" style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.12)" }}>
                            {r.is_link ? <FiLink size={18} style={{ color: "#C8A951" }} /> : <FiFile size={18} style={{ color: "#C8A951" }} />}
                            <div className="min-w-0 flex-1">
                              <p className="font-semibold text-[#1B2B4A] truncate">{r.title}</p>
                              {r.description && <p className="text-xs truncate" style={{ color: "rgba(74,85,104,0.7)" }}>{r.description}</p>}
                            </div>
                            {!r.is_link && <span className="text-xs shrink-0" style={{ color: "rgba(74,85,104,0.6)" }}>{fmtSize(r.file_size)}</span>}
                            {r.is_link ? (
                              <a href={r.link_url} target="_blank" rel="noopener noreferrer"
                                className="px-4 py-2 rounded-full text-sm font-semibold flex items-center gap-1.5 shrink-0"
                                style={{ background: "rgba(200,169,81,0.12)", color: "#A9863A", border: "1px solid rgba(200,169,81,0.25)" }}>
                                <FiExternalLink size={13} /> Open
                              </a>
                            ) : (
                              <button onClick={() => download(r)} disabled={busy === `r${r.id}`}
                                className="px-4 py-2 rounded-full text-sm font-semibold flex items-center gap-1.5 shrink-0 disabled:opacity-60"
                                style={{ background: "rgba(200,169,81,0.12)", color: "#A9863A", border: "1px solid rgba(200,169,81,0.25)" }}>
                                <FiDownload size={13} /> {busy === `r${r.id}` ? "…" : "Download"}
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Upload to your coach ────────────────────────────────────── */}
        <h2 className="text-lg font-normal text-[#1B2B4A] mb-3" style={serif}>Send a file to your coach</h2>
        <div className="rounded-2xl p-6 mb-6" style={card}>
          <p className="flex items-center gap-2 text-sm mb-4" style={{ color: "rgba(74,85,104,0.85)" }}>
            <FiUploadCloud size={16} style={{ color: "#C8A951" }} /> Upload a signed contract, completed assessment, or assignment for your coach to review.
          </p>
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="Coach">
              <select value={form.coach} onChange={(e) => setForm((f) => ({ ...f, coach: e.target.value, in_response_to: "" }))}
                className="rounded-xl px-3 py-2 text-sm w-full" style={inputStyle}>
                <option value="">— Select —</option>
                {coaches.map((c) => <option key={c.id} value={c.id}>{c.username}</option>)}
              </select>
            </Field>
            <Field label="Title">
              <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Signed contract" className="rounded-xl px-3 py-2 text-sm w-full" style={inputStyle} />
            </Field>
            <div className="md:col-span-2">
              <Field label="Note (optional)">
                <textarea rows={2} value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                  className="rounded-xl px-3 py-2 text-sm w-full resize-none" style={inputStyle} />
              </Field>
            </div>
            {responseOptions.length > 0 && (
              <div className="md:col-span-2">
                <Field label="In response to (optional)">
                  <select value={form.in_response_to} onChange={(e) => setForm((f) => ({ ...f, in_response_to: e.target.value }))}
                    className="rounded-xl px-3 py-2 text-sm w-full" style={inputStyle}>
                    <option value="">— None —</option>
                    {responseOptions.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
                  </select>
                </Field>
              </div>
            )}
            <div className="md:col-span-2">
              <Field label="File">
                <input type="file" accept={ACCEPT} onChange={(e) => setForm((f) => ({ ...f, file: e.target.files[0] }))} className="text-sm w-full" />
                <span className="text-[11px] mt-1" style={{ color: "rgba(74,85,104,0.7)" }}>PDF, Word, images, etc. · max 50 MB</span>
              </Field>
            </div>
          </div>
          <div className="flex justify-end mt-4">
            <button onClick={upload} disabled={uploading} className="px-5 py-2.5 rounded-full text-sm font-bold gold-btn disabled:opacity-60">
              {uploading ? "Uploading…" : "Send to coach"}
            </button>
          </div>
        </div>

        {/* ── Your uploads ────────────────────────────────────────────── */}
        <h2 className="text-lg font-normal text-[#1B2B4A] mb-3" style={serif}>Your uploads ({submissions.length})</h2>
        {submissions.length === 0 ? (
          <div className="text-center py-10 rounded-2xl" style={card}>
            <p className="text-sm text-[#4A5568]">Files you send to your coach will appear here.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {submissions.map((s) => (
              <div key={s.id} className="rounded-xl px-4 py-3 flex flex-wrap items-center gap-3" style={card}>
                <FiFile size={18} style={{ color: "#C8A951" }} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-[#1B2B4A] truncate">{s.title}</p>
                  <p className="text-xs" style={{ color: "rgba(74,85,104,0.7)" }}>
                    To {s.coach_username} · {fmtDate(s.created_at)}{s.in_response_to_title ? ` · re: ${s.in_response_to_title}` : ""}
                  </p>
                </div>
                <span className="text-[11px] font-semibold uppercase tracking-wide px-2.5 py-1 rounded-full flex items-center gap-1" style={STATUS_STYLE[s.status]}>
                  {s.status === "reviewed" ? <FiCheckCircle size={11} /> : <FiClock size={11} />} {s.status}
                </span>
                <button onClick={() => downloadOwn(s)} disabled={busy === `s${s.id}`} title="Download" className="p-2 rounded-full" style={{ color: "#A9863A" }}>
                  <FiDownload size={15} />
                </button>
                <button onClick={() => deleteSubmission(s.id)} title="Remove" className="p-2 rounded-full" style={{ color: "#B91C1C" }}>
                  <FiTrash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default MyResources;
