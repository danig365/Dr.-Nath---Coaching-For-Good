import { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "react-toastify";
import { FiFolder, FiPlus, FiTrash2, FiUploadCloud, FiFile, FiUsers, FiUser, FiEdit2, FiX, FiDownload, FiInbox, FiCheckCircle, FiClock, FiLink, FiExternalLink } from "react-icons/fi";
import { api, downloadResource, downloadSubmission } from "../utils/auth";
import { useAuth } from "../context/AuthContext";

const card = { background: "white", border: "1px solid rgba(200,169,81,0.15)", boxShadow: "0 2px 16px rgba(27,43,74,0.05)" };
const inputStyle = { background: "#FAF6EC", border: "1px solid rgba(27,43,74,0.2)", color: "#1B2B4A" };
const serif = { fontFamily: "'Playfair Display', serif" };

// Mirror the backend allowlist + cap (resources/serializers.py).
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "application/pdf", "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain", "text/csv",
  "image/png", "image/jpeg", "image/gif", "image/webp",
  "video/mp4", "video/quicktime", "video/webm",
  "audio/mpeg", "audio/mp4", "application/zip",
]);
const ACCEPT = ".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.csv,.png,.jpg,.jpeg,.gif,.webp,.mp4,.mov,.webm,.mp3,.m4a,.zip";
const ALLOWED_HINT = "PDF, Word, PowerPoint, Excel, text/CSV, images, video, audio, ZIP · max 50 MB";

// Returns an error string if the file is invalid, else null. Empty content
// type (some browsers) is allowed through — the server makes the final call.
const fileError = (f) => {
  if (!f) return null;
  if (f.size > MAX_FILE_BYTES) return `"${f.name}" is larger than 50 MB.`;
  if (f.type && !ALLOWED_TYPES.has(f.type)) return `"${f.name}" is not an allowed file type.`;
  return null;
};

const SUB_STATUS_STYLE = {
  submitted: { background: "rgba(200,169,81,0.14)", color: "#A9863A", border: "1px solid rgba(200,169,81,0.25)" },
  reviewed: { background: "rgba(52,168,83,0.1)", color: "#2E7D32", border: "1px solid rgba(52,168,83,0.2)" },
};
const fmtDate = (iso) => new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });

const VIS_LABEL = { all_platform: "All clients", all_clients: "Booked coachees", specific: "Specific clients", group: "Group session" };
const VIS_STYLE = {
  all_platform: { background: "rgba(52,168,83,0.1)", color: "#2E7D32", border: "1px solid rgba(52,168,83,0.2)" },
  all_clients: { background: "rgba(52,168,83,0.1)", color: "#2E7D32", border: "1px solid rgba(52,168,83,0.2)" },
  specific: { background: "rgba(200,169,81,0.14)", color: "#A9863A", border: "1px solid rgba(200,169,81,0.25)" },
  group: { background: "rgba(27,43,74,0.08)", color: "#1B2B4A", border: "1px solid rgba(27,43,74,0.18)" },
};
const fmtSize = (b) => (b == null ? "—" : b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`);

const Field = ({ label, children }) => (
  <label className="flex flex-col gap-1">
    <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "rgba(74,85,104,0.7)" }}>{label}</span>
    {children}
  </label>
);

const emptyForm = { title: "", description: "", folder: "", visibility: "all_clients", shared_clients: [], group_session: "", file: null, kind: "file", link_url: "" };

const ResourcesManage = () => {
  const { isAuthenticated, isCoach, logout } = useAuth();
  const [folders, setFolders] = useState([]);
  const [resources, setResources] = useState([]);
  const [clients, setClients] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newFolder, setNewFolder] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [uploading, setUploading] = useState(false);
  const [edit, setEdit] = useState(null); // resource being edited
  const [tab, setTab] = useState("manage"); // 'manage' | 'inbox'
  const [submissions, setSubmissions] = useState([]);

  const fetchAll = useCallback(async () => {
    if (!isAuthenticated || !isCoach()) { logout(); return; }
    setLoading(true);
    try {
      const [f, r, c, g, s] = await Promise.all([
        api.get("/resources/folders/"),
        api.get("/resources/"),
        api.get("/resources/clients/"),
        api.get("/bookings/group-sessions/"),
        api.get("/resources/submissions/"),
      ]);
      setFolders(f.data); setResources(r.data); setClients(c.data); setGroups(g.data); setSubmissions(s.data);
    } catch (err) {
      toast.error("Failed to load resources.");
      if (err.response?.status === 401) logout();
    } finally { setLoading(false); }
  }, [isAuthenticated, isCoach, logout]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const buildForm = (data) => {
    const fd = new FormData();
    fd.append("title", data.title);
    fd.append("description", data.description || "");
    if (data.folder) fd.append("folder", data.folder);
    fd.append("visibility", data.visibility);
    if (data.visibility === "specific") data.shared_clients.forEach((id) => fd.append("shared_clients", id));
    if (data.visibility === "group" && data.group_session) fd.append("group_session", data.group_session);
    if (data.kind === "link") fd.append("link_url", data.link_url || "");
    else if (data.file) fd.append("file", data.file);
    return fd;
  };

  const createFolder = async () => {
    if (!newFolder.trim()) return;
    try {
      const res = await api.post("/resources/folders/", { name: newFolder.trim() });
      setFolders((f) => [...f, res.data]); setNewFolder("");
      toast.success("Folder created.");
    } catch (err) { toast.error(err.response?.data?.name?.[0] || err.response?.data?.detail || "Failed to create folder."); }
  };

  const deleteFolder = async (id) => {
    try { await api.delete(`/resources/folders/${id}/`); setFolders((f) => f.filter((x) => x.id !== id)); fetchAll(); }
    catch (err) { toast.error(err.response?.data?.detail || "Failed to delete folder."); }
  };

  const upload = async () => {
    if (!form.title.trim()) { toast.error("A title is required."); return; }
    if (form.kind === "link") {
      if (!form.link_url.trim()) { toast.error("Enter a link URL."); return; }
    } else {
      if (!form.file) { toast.error("Choose a file to upload."); return; }
      const fe = fileError(form.file);
      if (fe) { toast.error(fe); return; }
    }
    if (form.visibility === "group" && !form.group_session) { toast.error("Pick a group session."); return; }
    if (form.visibility === "specific" && form.shared_clients.length === 0) { toast.error("Pick at least one client."); return; }
    setUploading(true);
    try {
      const res = await api.post("/resources/", buildForm(form));
      setResources((r) => [res.data, ...r]); setForm(emptyForm);
      toast.success("Resource uploaded.");
    } catch (err) {
      toast.error(err.response?.data?.file?.[0] || err.response?.data?.detail || "Upload failed.");
    } finally { setUploading(false); }
  };

  const deleteResource = async (id) => {
    try { await api.delete(`/resources/${id}/`); setResources((r) => r.filter((x) => x.id !== id)); toast.success("Deleted."); }
    catch (err) { toast.error(err.response?.data?.detail || "Failed to delete."); }
  };

  const saveEdit = async () => {
    const fe = fileError(edit.file);
    if (fe) { toast.error(fe); return; }
    try {
      let res;
      if (edit.file) {
        res = await api.patch(`/resources/${edit.id}/`, buildForm(edit));
      } else {
        const payload = {
          title: edit.title, description: edit.description || "",
          folder: edit.folder || null, visibility: edit.visibility,
          shared_clients: edit.visibility === "specific" ? edit.shared_clients : [],
          group_session: edit.visibility === "group" ? edit.group_session : null,
        };
        // Only a link resource may update its URL (sending link_url on a file
        // resource would switch it to a link and drop the file).
        if (edit.is_link) {
          if (!edit.link_url?.trim()) { toast.error("Enter a link URL."); return; }
          payload.link_url = edit.link_url.trim();
        }
        res = await api.patch(`/resources/${edit.id}/`, payload);
      }
      setResources((r) => r.map((x) => (x.id === edit.id ? res.data : x)));
      setEdit(null); toast.success("Saved.");
    } catch (err) { toast.error(err.response?.data?.detail || err.response?.data?.file?.[0] || "Failed to save."); }
  };

  const download = async (r) => {
    try { await downloadResource(r.id, r.title); }
    catch { toast.error("Download failed."); }
  };

  // ── Client submissions (inbox) ──
  const submissionsByClient = useMemo(() => {
    const m = {};
    submissions.forEach((s) => { (m[s.client_username || "Client"] ||= []).push(s); });
    return m;
  }, [submissions]);
  const pendingCount = useMemo(() => submissions.filter((s) => s.status === "submitted").length, [submissions]);

  const downloadSub = async (s) => {
    try { await downloadSubmission(s.id, s.title); }
    catch { toast.error("Download failed."); }
  };

  const markReviewed = async (s) => {
    try {
      const res = await api.patch(`/resources/submissions/${s.id}/mark-reviewed/`);
      setSubmissions((arr) => arr.map((x) => (x.id === s.id ? res.data : x)));
    } catch (err) { toast.error(err.response?.data?.detail || "Failed to update."); }
  };

  const deleteSubmission = async (s) => {
    try { await api.delete(`/resources/submissions/${s.id}/`); setSubmissions((arr) => arr.filter((x) => x.id !== s.id)); toast.success("Removed."); }
    catch (err) { toast.error(err.response?.data?.detail || "Failed to remove."); }
  };

  if (loading) return (
    <div className="flex justify-center items-center min-h-screen" style={{ background: "#FAF6EC" }}>
      <div className="w-10 h-10 rounded-full border-2 animate-spin" style={{ borderColor: "#C8A951", borderTopColor: "transparent" }} />
    </div>
  );

  return (
    <div className="min-h-screen pt-28 pb-16 px-6" style={{ background: "#FAF6EC" }}>
      <div className="max-w-5xl mx-auto">
        <motion.div className="mb-8" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] mb-2" style={{ color: "#A9863A" }}>Coach workspace</p>
          <h1 className="text-3xl md:text-4xl font-normal text-[#1B2B4A]" style={serif}>Resources</h1>
        </motion.div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          {[["manage", "Library", FiFolder], ["inbox", "Client Submissions", FiInbox]].map(([key, label, Icon]) => (
            <button key={key} onClick={() => setTab(key)}
              className="flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold transition-all"
              style={tab === key
                ? { background: "#1B2B4A", color: "#FAF6EC" }
                : { background: "white", color: "#4A5568", border: "1px solid rgba(27,43,74,0.12)" }}>
              <Icon size={14} /> {label}
              {key === "inbox" && pendingCount > 0 && (
                <span className="ml-0.5 px-2 py-0.5 rounded-full text-[10px] font-bold"
                  style={tab === key ? { background: "#C8A951", color: "#14213D" } : { background: "rgba(200,169,81,0.18)", color: "#A9863A" }}>
                  {pendingCount}
                </span>
              )}
            </button>
          ))}
        </div>

        {tab === "manage" && (<>
        {/* Folders */}
        <div className="rounded-2xl p-6 mb-6" style={card}>
          <h3 className="flex items-center gap-2 text-lg font-normal text-[#1B2B4A] mb-4" style={serif}>
            <FiFolder size={16} style={{ color: "#C8A951" }} /> Folders
          </h3>
          <div className="flex flex-wrap gap-2 mb-4">
            {folders.length === 0 && <span className="text-sm text-[#4A5568]">No folders yet.</span>}
            {folders.map((f) => (
              <span key={f.id} className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm" style={{ background: "rgba(200,169,81,0.12)", color: "#A9863A" }}>
                <FiFolder size={12} /> {f.name} <span className="opacity-60">({f.resource_count})</span>
                <button onClick={() => deleteFolder(f.id)} title="Delete folder"><FiX size={13} /></button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input value={newFolder} onChange={(e) => setNewFolder(e.target.value)} placeholder="New folder name (e.g. Month 1)"
              className="rounded-xl px-3 py-2 text-sm flex-1 max-w-xs" style={inputStyle} />
            <button onClick={createFolder} className="px-4 py-2 rounded-full text-sm font-semibold flex items-center gap-1.5"
              style={{ background: "rgba(200,169,81,0.12)", color: "#A9863A", border: "1px solid rgba(200,169,81,0.25)" }}>
              <FiPlus size={14} /> Add
            </button>
          </div>
        </div>

        {/* Upload */}
        <div className="rounded-2xl p-6 mb-6" style={card}>
          <h3 className="flex items-center gap-2 text-lg font-normal text-[#1B2B4A] mb-4" style={serif}>
            <FiUploadCloud size={16} style={{ color: "#C8A951" }} /> Upload a Resource
          </h3>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <Field label="Title"><input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                className="rounded-xl px-3 py-2 text-sm w-full" style={inputStyle} /></Field>
            </div>
            <div className="md:col-span-2">
              <Field label="Description (optional)"><textarea rows={2} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                className="rounded-xl px-3 py-2 text-sm w-full resize-none" style={inputStyle} /></Field>
            </div>
            <Field label="Folder (optional)">
              <select value={form.folder} onChange={(e) => setForm((f) => ({ ...f, folder: e.target.value }))} className="rounded-xl px-3 py-2 text-sm w-full" style={inputStyle}>
                <option value="">— None —</option>
                {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </Field>
            <Field label="Share with">
              <select value={form.visibility} onChange={(e) => setForm((f) => ({ ...f, visibility: e.target.value }))} className="rounded-xl px-3 py-2 text-sm w-full" style={inputStyle}>
                <option value="all_platform">All clients (incl. no booking)</option>
                <option value="all_clients">Clients with a booking (coachees)</option>
                <option value="specific">Specific clients</option>
                <option value="group">A group session</option>
              </select>
            </Field>
            {form.visibility === "specific" && (
              <div className="md:col-span-2">
                <Field label="Clients (Ctrl/Cmd-click to select multiple)">
                  <select multiple value={form.shared_clients} onChange={(e) => setForm((f) => ({ ...f, shared_clients: Array.from(e.target.selectedOptions, (o) => o.value) }))}
                    className="rounded-xl px-3 py-2 text-sm w-full h-28" style={inputStyle}>
                    {clients.map((c) => <option key={c.id} value={c.id}>{c.username}</option>)}
                  </select>
                </Field>
              </div>
            )}
            {form.visibility === "group" && (
              <div className="md:col-span-2">
                <Field label="Group session">
                  <select value={form.group_session} onChange={(e) => setForm((f) => ({ ...f, group_session: e.target.value }))} className="rounded-xl px-3 py-2 text-sm w-full" style={inputStyle}>
                    <option value="">— Select —</option>
                    {groups.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
                  </select>
                </Field>
              </div>
            )}
            <div className="md:col-span-2">
              <Field label="Type">
                <div className="flex gap-2">
                  {[["file", "File", FiFile], ["link", "Link", FiLink]].map(([key, label, Icon]) => (
                    <button key={key} type="button" onClick={() => setForm((f) => ({ ...f, kind: key }))}
                      className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-semibold transition-all"
                      style={form.kind === key
                        ? { background: "#1B2B4A", color: "#FAF6EC" }
                        : { background: "white", color: "#4A5568", border: "1px solid rgba(27,43,74,0.12)" }}>
                      <Icon size={13} /> {label}
                    </button>
                  ))}
                </div>
              </Field>
            </div>
            <div className="md:col-span-2">
              {form.kind === "link" ? (
                <Field label="Link URL">
                  <input type="url" value={form.link_url} onChange={(e) => setForm((f) => ({ ...f, link_url: e.target.value }))}
                    placeholder="https://… (e.g. the online assessment)" className="rounded-xl px-3 py-2 text-sm w-full" style={inputStyle} />
                </Field>
              ) : (
                <Field label="File">
                  <input type="file" accept={ACCEPT} onChange={(e) => setForm((f) => ({ ...f, file: e.target.files[0] }))} className="text-sm w-full" />
                  <span className="text-[11px] mt-1" style={{ color: "rgba(74,85,104,0.7)" }}>Allowed: {ALLOWED_HINT}</span>
                </Field>
              )}
            </div>
          </div>
          <div className="flex justify-end mt-4">
            <button onClick={upload} disabled={uploading} className="px-5 py-2.5 rounded-full text-sm font-bold gold-btn disabled:opacity-60">
              {uploading ? (form.kind === "link" ? "Saving…" : "Uploading…") : (form.kind === "link" ? "Add Link" : "Upload")}
            </button>
          </div>
        </div>

        {/* Resource list */}
        <h3 className="text-lg font-normal text-[#1B2B4A] mb-3" style={serif}>Your Resources ({resources.length})</h3>
        {resources.length === 0 ? (
          <div className="text-center py-16 rounded-2xl" style={card}>
            <p className="text-4xl mb-3">📁</p>
            <p className="text-sm text-[#4A5568]">No resources yet. Upload one above.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {resources.map((r) => (
              <div key={r.id} className="rounded-xl px-4 py-3 flex flex-wrap items-center gap-3" style={card}>
                {r.is_link ? <FiLink size={18} style={{ color: "#C8A951" }} /> : <FiFile size={18} style={{ color: "#C8A951" }} />}
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-[#1B2B4A] truncate">{r.title}</p>
                  <p className="text-xs" style={{ color: "rgba(74,85,104,0.7)" }}>
                    {r.folder_name ? `${r.folder_name} · ` : ""}{r.is_link ? "Link" : fmtSize(r.file_size)}
                    {r.visibility === "specific" && r.shared_client_usernames?.length ? ` · ${r.shared_client_usernames.join(", ")}` : ""}
                  </p>
                </div>
                <span className="text-[11px] font-semibold uppercase tracking-wide px-2.5 py-1 rounded-full" style={VIS_STYLE[r.visibility]}>
                  {VIS_LABEL[r.visibility]}
                </span>
                {r.is_link ? (
                  <a href={r.link_url} target="_blank" rel="noopener noreferrer" title="Open link" className="p-2 rounded-full" style={{ color: "#A9863A" }}><FiExternalLink size={15} /></a>
                ) : (
                  <button onClick={() => download(r)} title="Download" className="p-2 rounded-full" style={{ color: "#A9863A" }}><FiDownload size={15} /></button>
                )}
                <button onClick={() => setEdit({ ...r, folder: r.folder || "", group_session: r.group_session || "", shared_clients: [], file: null })}
                  title="Edit" className="p-2 rounded-full" style={{ color: "#1B2B4A" }}><FiEdit2 size={14} /></button>
                <button onClick={() => deleteResource(r.id)} title="Delete" className="p-2 rounded-full" style={{ color: "#B91C1C" }}><FiTrash2 size={14} /></button>
              </div>
            ))}
          </div>
        )}
        </>)}

        {/* Client Submissions inbox */}
        {tab === "inbox" && (
          submissions.length === 0 ? (
            <div className="text-center py-16 rounded-2xl" style={card}>
              <p className="text-4xl mb-3">📥</p>
              <p className="text-sm text-[#4A5568]">No client submissions yet. Files clients upload to you (signed contracts, assessments, assignments) appear here.</p>
            </div>
          ) : (
            <div className="space-y-8">
              {Object.entries(submissionsByClient).map(([clientName, items]) => (
                <div key={clientName}>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold" style={{ background: "#1B2B4A", color: "#FAF6EC" }}>
                      {clientName.charAt(0).toUpperCase()}
                    </span>
                    <h3 className="text-base font-normal text-[#1B2B4A]" style={serif}>{clientName}</h3>
                  </div>
                  <div className="space-y-2">
                    {items.map((s) => (
                      <div key={s.id} className="rounded-xl px-4 py-3 flex flex-wrap items-center gap-3" style={card}>
                        <FiFile size={18} style={{ color: "#C8A951" }} />
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-[#1B2B4A] truncate">{s.title}</p>
                          <p className="text-xs" style={{ color: "rgba(74,85,104,0.7)" }}>
                            {fmtDate(s.created_at)} · {fmtSize(s.file_size)}
                            {s.in_response_to_title ? ` · re: ${s.in_response_to_title}` : ""}
                          </p>
                          {s.note && <p className="text-xs mt-0.5 italic" style={{ color: "rgba(74,85,104,0.6)" }}>“{s.note}”</p>}
                        </div>
                        <span className="text-[11px] font-semibold uppercase tracking-wide px-2.5 py-1 rounded-full flex items-center gap-1" style={SUB_STATUS_STYLE[s.status]}>
                          {s.status === "reviewed" ? <FiCheckCircle size={11} /> : <FiClock size={11} />} {s.status}
                        </span>
                        <button onClick={() => downloadSub(s)} title="Download" className="p-2 rounded-full" style={{ color: "#A9863A" }}><FiDownload size={15} /></button>
                        {s.status === "submitted" && (
                          <button onClick={() => markReviewed(s)} title="Mark reviewed" className="p-2 rounded-full" style={{ color: "#2E7D32" }}><FiCheckCircle size={15} /></button>
                        )}
                        <button onClick={() => deleteSubmission(s)} title="Delete" className="p-2 rounded-full" style={{ color: "#B91C1C" }}><FiTrash2 size={14} /></button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>

      {/* Edit modal */}
      <AnimatePresence>
        {edit && (
          <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setEdit(null)} />
            <motion.div className="relative rounded-2xl w-full max-w-lg z-10 p-6 max-h-[85vh] overflow-y-auto" style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.2)" }}
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-normal text-[#1B2B4A]" style={serif}>Edit Resource</h3>
                <button onClick={() => setEdit(null)}><FiX size={18} className="text-[#4A5568]" /></button>
              </div>
              <div className="space-y-3">
                <Field label="Title"><input value={edit.title} onChange={(e) => setEdit((s) => ({ ...s, title: e.target.value }))} className="rounded-xl px-3 py-2 text-sm w-full" style={inputStyle} /></Field>
                <Field label="Description"><textarea rows={2} value={edit.description || ""} onChange={(e) => setEdit((s) => ({ ...s, description: e.target.value }))} className="rounded-xl px-3 py-2 text-sm w-full resize-none" style={inputStyle} /></Field>
                <Field label="Folder">
                  <select value={edit.folder} onChange={(e) => setEdit((s) => ({ ...s, folder: e.target.value }))} className="rounded-xl px-3 py-2 text-sm w-full" style={inputStyle}>
                    <option value="">— None —</option>
                    {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </Field>
                <Field label="Share with">
                  <select value={edit.visibility} onChange={(e) => setEdit((s) => ({ ...s, visibility: e.target.value }))} className="rounded-xl px-3 py-2 text-sm w-full" style={inputStyle}>
                    <option value="all_clients">All my coachees</option>
                    <option value="specific">Specific clients</option>
                    <option value="group">A group session</option>
                  </select>
                </Field>
                {edit.visibility === "specific" && (
                  <Field label="Clients (replaces current selection)">
                    <select multiple value={edit.shared_clients} onChange={(e) => setEdit((s) => ({ ...s, shared_clients: Array.from(e.target.selectedOptions, (o) => o.value) }))}
                      className="rounded-xl px-3 py-2 text-sm w-full h-28" style={inputStyle}>
                      {clients.map((c) => <option key={c.id} value={c.id}>{c.username}</option>)}
                    </select>
                  </Field>
                )}
                {edit.visibility === "group" && (
                  <Field label="Group session">
                    <select value={edit.group_session} onChange={(e) => setEdit((s) => ({ ...s, group_session: e.target.value }))} className="rounded-xl px-3 py-2 text-sm w-full" style={inputStyle}>
                      <option value="">— Select —</option>
                      {groups.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
                    </select>
                  </Field>
                )}
                {edit.is_link ? (
                  <Field label="Link URL">
                    <input type="url" value={edit.link_url || ""} onChange={(e) => setEdit((s) => ({ ...s, link_url: e.target.value }))}
                      placeholder="https://…" className="rounded-xl px-3 py-2 text-sm w-full" style={inputStyle} />
                  </Field>
                ) : (
                  <Field label="Replace file (optional)">
                    <input type="file" accept={ACCEPT} onChange={(e) => setEdit((s) => ({ ...s, file: e.target.files[0] }))} className="text-sm w-full" />
                    <span className="text-[11px] mt-1" style={{ color: "rgba(74,85,104,0.7)" }}>Allowed: {ALLOWED_HINT}</span>
                  </Field>
                )}
              </div>
              <div className="flex justify-end gap-2 mt-5">
                <button onClick={() => setEdit(null)} className="px-4 py-2 rounded-full text-sm font-semibold border" style={{ borderColor: "rgba(200,169,81,0.3)", color: "#4A5568" }}>Cancel</button>
                <button onClick={saveEdit} className="px-5 py-2 rounded-full text-sm font-bold gold-btn">Save</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ResourcesManage;
