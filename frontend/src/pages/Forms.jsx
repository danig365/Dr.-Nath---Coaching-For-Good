import { useEffect, useState, useCallback } from "react";
import { api } from "../utils/auth";
import { useAuth } from "../context/AuthContext";
import WorkspaceTabs from "../components/WorkspaceTabs";
import { toast } from "react-toastify";
import { motion, AnimatePresence } from "framer-motion";
import {
  FiFileText, FiPlus, FiTrash2, FiSend, FiEdit3, FiCopy, FiArchive,
  FiX, FiChevronUp, FiChevronDown, FiCheckCircle, FiClock, FiEye,
} from "react-icons/fi";

const GOLD = "#C8A951";
const DARK = "#1B2B4A";
const BROWN = "#4A5568";
const CREAM = "#FAF6EC";

const Q_TYPES = [
  { value: "short_text", label: "Short text" },
  { value: "long_text", label: "Paragraph" },
  { value: "single_choice", label: "Single choice" },
  { value: "multi_choice", label: "Multiple choice" },
  { value: "rating", label: "Rating (1–5)" },
  { value: "yes_no", label: "Yes / No" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
];
const CHOICE = new Set(["single_choice", "multi_choice"]);
const KIND_LABEL = { intake: "Intake form", feedback: "Feedback survey", other: "Other" };

const input = { background: CREAM, border: "1px solid rgba(200,169,81,0.3)", color: DARK };
const card = { background: "white", border: "1px solid rgba(200,169,81,0.15)", boxShadow: "0 2px 12px rgba(27,43,74,0.04)" };

// Present a stored answer for a question type in a readable way.
function renderAnswer(q, a) {
  if (a === undefined || a === null || a === "" || (Array.isArray(a) && a.length === 0)) return "—";
  if (q.type === "multi_choice") return Array.isArray(a) ? a.join(", ") : String(a);
  if (q.type === "yes_no") return a === true || a === "true" ? "Yes" : "No";
  if (q.type === "rating") return `${a} / 5`;
  return String(a);
}

// ── Template builder (create / edit) ─────────────────────────────────────────
function TemplateModal({ template, onClose, onSaved }) {
  const editing = !!template?.id;
  const [title, setTitle] = useState(template?.title || "");
  const [kind, setKind] = useState(template?.kind || "intake");
  const [description, setDescription] = useState(template?.description || "");
  const [questions, setQuestions] = useState(
    (template?.questions || []).map((q) => ({ ...q, options: q.options || [] }))
  );
  const [saving, setSaving] = useState(false);

  const addQ = () => setQuestions((qs) => [...qs, { label: "", type: "short_text", required: false, options: [] }]);
  const updateQ = (i, patch) => setQuestions((qs) => qs.map((q, idx) => (idx === i ? { ...q, ...patch } : q)));
  const removeQ = (i) => setQuestions((qs) => qs.filter((_, idx) => idx !== i));
  const moveQ = (i, dir) => setQuestions((qs) => {
    const j = i + dir;
    if (j < 0 || j >= qs.length) return qs;
    const copy = [...qs]; [copy[i], copy[j]] = [copy[j], copy[i]]; return copy;
  });

  const save = async () => {
    if (!title.trim()) { toast.error("Give the template a title."); return; }
    if (questions.length === 0) { toast.error("Add at least one question."); return; }
    for (const q of questions) {
      if (!q.label.trim()) { toast.error("Every question needs a label."); return; }
      if (CHOICE.has(q.type) && (q.options || []).filter((o) => o.trim()).length < 2) {
        toast.error(`"${q.label || "A choice question"}" needs at least two options.`); return;
      }
    }
    const payload = {
      title: title.trim(), kind, description: description.trim(),
      questions: questions.map((q) => ({
        ...(q.id ? { id: q.id } : {}),
        label: q.label.trim(), type: q.type, required: !!q.required,
        ...(CHOICE.has(q.type) ? { options: q.options.filter((o) => o.trim()) } : {}),
      })),
    };
    setSaving(true);
    try {
      if (editing) await api.patch(`/forms/templates/${template.id}/`, payload);
      else await api.post("/forms/templates/", payload);
      toast.success(editing ? "Template updated." : "Template created.");
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.questions?.[0] || err.response?.data?.detail || "Could not save the template.");
    } finally { setSaving(false); }
  };

  return (
    <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0" style={{ background: "rgba(20,33,61,0.6)" }} onClick={onClose} />
      <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }}
        className="relative w-full max-w-2xl rounded-2xl z-10 flex flex-col" style={{ background: "white", maxHeight: "90vh" }}>
        <div className="flex items-center justify-between p-5 border-b" style={{ borderColor: "rgba(200,169,81,0.2)" }}>
          <h3 className="text-xl font-normal" style={{ color: DARK, fontFamily: "'Playfair Display', serif" }}>
            {editing ? "Edit template" : "New template"}
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-full" style={{ background: "rgba(27,43,74,0.06)", color: BROWN }}><FiX size={16} /></button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          <div className="grid sm:grid-cols-3 gap-3">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Template title"
              className="sm:col-span-2 px-4 py-2.5 rounded-xl text-sm focus:outline-none" style={input} />
            <select value={kind} onChange={(e) => setKind(e.target.value)}
              className="px-4 py-2.5 rounded-xl text-sm focus:outline-none" style={input}>
              <option value="intake">Intake form</option>
              <option value="feedback">Feedback survey</option>
              <option value="other">Other</option>
            </select>
          </div>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
            placeholder="Intro shown to the client (optional)…"
            className="w-full px-4 py-2.5 rounded-xl text-sm resize-none focus:outline-none" style={input} />

          <div className="space-y-3">
            {questions.map((q, i) => (
              <div key={i} className="rounded-xl p-4" style={{ background: CREAM, border: "1px solid rgba(200,169,81,0.2)" }}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-bold" style={{ color: GOLD }}>Q{i + 1}</span>
                  <div className="ml-auto flex items-center gap-1">
                    <button onClick={() => moveQ(i, -1)} disabled={i === 0} className="p-1 rounded disabled:opacity-30" style={{ color: BROWN }}><FiChevronUp size={14} /></button>
                    <button onClick={() => moveQ(i, 1)} disabled={i === questions.length - 1} className="p-1 rounded disabled:opacity-30" style={{ color: BROWN }}><FiChevronDown size={14} /></button>
                    <button onClick={() => removeQ(i)} className="p-1 rounded" style={{ color: "#B91C1C" }}><FiTrash2 size={14} /></button>
                  </div>
                </div>
                <input value={q.label} onChange={(e) => updateQ(i, { label: e.target.value })} placeholder="Question text"
                  className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none mb-2" style={{ ...input, background: "white" }} />
                <div className="flex items-center gap-3 flex-wrap">
                  <select value={q.type} onChange={(e) => updateQ(i, { type: e.target.value })}
                    className="px-3 py-1.5 rounded-lg text-xs focus:outline-none" style={{ ...input, background: "white" }}>
                    {Q_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                  <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: BROWN }}>
                    <input type="checkbox" checked={!!q.required} onChange={(e) => updateQ(i, { required: e.target.checked })} style={{ accentColor: GOLD }} />
                    Required
                  </label>
                </div>
                {CHOICE.has(q.type) && (
                  <textarea
                    value={(q.options || []).join("\n")}
                    onChange={(e) => updateQ(i, { options: e.target.value.split("\n") })}
                    rows={3} placeholder={"One option per line\ne.g. Career\nWellness"}
                    className="w-full mt-2 px-3 py-2 rounded-lg text-sm resize-none focus:outline-none" style={{ ...input, background: "white" }} />
                )}
              </div>
            ))}
            <button onClick={addQ} className="w-full py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2"
              style={{ border: "1px dashed rgba(200,169,81,0.4)", color: "#A9863A", background: "rgba(200,169,81,0.05)" }}>
              <FiPlus size={14} /> Add question
            </button>
          </div>
        </div>

        <div className="flex gap-3 p-5 border-t" style={{ borderColor: "rgba(200,169,81,0.2)" }}>
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold" style={{ background: "rgba(27,43,74,0.06)", color: BROWN }}>Cancel</button>
          <button onClick={save} disabled={saving} className="flex-1 py-2.5 rounded-xl text-sm font-bold disabled:opacity-60"
            style={{ background: `linear-gradient(135deg,${GOLD},#F0D98C)`, color: "#14213D" }}>
            {saving ? "Saving…" : editing ? "Save changes" : "Create template"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Assign a template to a client ────────────────────────────────────────────
function AssignModal({ template, clients, onClose, onAssigned }) {
  const [client, setClient] = useState("");
  const [busy, setBusy] = useState(false);
  const assign = async () => {
    if (!client) { toast.error("Choose a client."); return; }
    setBusy(true);
    try {
      await api.post("/forms/assignments/", { template: template.id, client });
      toast.success("Form sent to the client.");
      onAssigned();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Could not send the form.");
    } finally { setBusy(false); }
  };
  return (
    <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0" style={{ background: "rgba(20,33,61,0.6)" }} onClick={onClose} />
      <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }}
        className="relative w-full max-w-md rounded-2xl p-6 z-10" style={{ background: "white" }}>
        <h3 className="text-xl font-normal mb-1" style={{ color: DARK, fontFamily: "'Playfair Display', serif" }}>Send form</h3>
        <p className="text-sm mb-4" style={{ color: BROWN }}>{template.title}</p>
        <select value={client} onChange={(e) => setClient(e.target.value)}
          className="w-full px-4 py-2.5 rounded-xl text-sm focus:outline-none mb-5" style={input}>
          <option value="">Select client…</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.username}</option>)}
        </select>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold" style={{ background: "rgba(27,43,74,0.06)", color: BROWN }}>Cancel</button>
          <button onClick={assign} disabled={busy} className="flex-1 py-2.5 rounded-xl text-sm font-bold disabled:opacity-60"
            style={{ background: `linear-gradient(135deg,${GOLD},#F0D98C)`, color: "#14213D" }}>
            {busy ? "Sending…" : "Send"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── View a client's responses ────────────────────────────────────────────────
function ResponsesModal({ assignment, onClose }) {
  return (
    <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0" style={{ background: "rgba(20,33,61,0.6)" }} onClick={onClose} />
      <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }}
        className="relative w-full max-w-lg rounded-2xl z-10 flex flex-col" style={{ background: "white", maxHeight: "90vh" }}>
        <div className="flex items-center justify-between p-5 border-b" style={{ borderColor: "rgba(200,169,81,0.2)" }}>
          <div>
            <h3 className="text-lg font-normal" style={{ color: DARK, fontFamily: "'Playfair Display', serif" }}>{assignment.title}</h3>
            <p className="text-xs mt-0.5" style={{ color: BROWN }}>Response from {assignment.client_name}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-full" style={{ background: "rgba(27,43,74,0.06)", color: BROWN }}><FiX size={16} /></button>
        </div>
        <div className="p-5 overflow-y-auto space-y-4">
          {(assignment.questions_snapshot || []).map((q, i) => (
            <div key={q.id || i}>
              <p className="text-sm font-semibold" style={{ color: DARK }}>{i + 1}. {q.label}</p>
              <p className="text-sm mt-0.5 whitespace-pre-wrap" style={{ color: BROWN }}>{renderAnswer(q, assignment.answers?.[q.id])}</p>
            </div>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Client fills in an assigned form ─────────────────────────────────────────
function FillModal({ assignment, onClose, onSubmitted }) {
  const [answers, setAnswers] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (qid, val) => setAnswers((a) => ({ ...a, [qid]: val }));
  const toggleMulti = (qid, opt) => setAnswers((a) => {
    const cur = Array.isArray(a[qid]) ? a[qid] : [];
    return { ...a, [qid]: cur.includes(opt) ? cur.filter((o) => o !== opt) : [...cur, opt] };
  });

  const submit = async () => {
    for (const q of assignment.questions_snapshot || []) {
      const v = answers[q.id];
      const empty = v === undefined || v === "" || v === null || (Array.isArray(v) && v.length === 0);
      if (q.required && empty) { toast.error(`"${q.label}" is required.`); return; }
    }
    setBusy(true);
    try {
      await api.post(`/forms/assignments/${assignment.id}/submit/`, { answers });
      toast.success("Thanks — your responses were sent.");
      onSubmitted();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Could not submit. Please check your answers.");
    } finally { setBusy(false); }
  };

  return (
    <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0" style={{ background: "rgba(20,33,61,0.6)" }} onClick={onClose} />
      <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }}
        className="relative w-full max-w-lg rounded-2xl z-10 flex flex-col" style={{ background: "white", maxHeight: "90vh" }}>
        <div className="flex items-center justify-between p-5 border-b" style={{ borderColor: "rgba(200,169,81,0.2)" }}>
          <div className="min-w-0">
            <h3 className="text-lg font-normal truncate" style={{ color: DARK, fontFamily: "'Playfair Display', serif" }}>{assignment.title}</h3>
            <p className="text-xs mt-0.5" style={{ color: BROWN }}>From {assignment.coach_name}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-full" style={{ background: "rgba(27,43,74,0.06)", color: BROWN }}><FiX size={16} /></button>
        </div>

        <div className="p-5 overflow-y-auto space-y-5">
          {assignment.description && <p className="text-sm" style={{ color: BROWN }}>{assignment.description}</p>}
          {(assignment.questions_snapshot || []).map((q, i) => (
            <div key={q.id || i}>
              <label className="block text-sm font-semibold mb-1.5" style={{ color: DARK }}>
                {i + 1}. {q.label}{q.required && <span style={{ color: "#B91C1C" }}> *</span>}
              </label>

              {q.type === "short_text" && (
                <input value={answers[q.id] || ""} onChange={(e) => set(q.id, e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none" style={input} />
              )}
              {q.type === "long_text" && (
                <textarea rows={3} value={answers[q.id] || ""} onChange={(e) => set(q.id, e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-sm resize-none focus:outline-none" style={input} />
              )}
              {q.type === "number" && (
                <input type="number" value={answers[q.id] ?? ""} onChange={(e) => set(q.id, e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none" style={input} />
              )}
              {q.type === "date" && (
                <input type="date" value={answers[q.id] || ""} onChange={(e) => set(q.id, e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none" style={input} />
              )}
              {q.type === "yes_no" && (
                <div className="flex gap-2">
                  {[["Yes", true], ["No", false]].map(([lbl, val]) => (
                    <button key={lbl} onClick={() => set(q.id, val)}
                      className="px-4 py-1.5 rounded-full text-sm font-semibold"
                      style={answers[q.id] === val ? { background: `linear-gradient(135deg,${GOLD},#F0D98C)`, color: "#14213D" } : { background: CREAM, color: BROWN, border: "1px solid rgba(200,169,81,0.3)" }}>
                      {lbl}
                    </button>
                  ))}
                </div>
              )}
              {q.type === "rating" && (
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} onClick={() => set(q.id, n)}
                      className="w-9 h-9 rounded-full text-sm font-bold"
                      style={answers[q.id] === n ? { background: `linear-gradient(135deg,${GOLD},#F0D98C)`, color: "#14213D" } : { background: CREAM, color: BROWN, border: "1px solid rgba(200,169,81,0.3)" }}>
                      {n}
                    </button>
                  ))}
                </div>
              )}
              {q.type === "single_choice" && (
                <div className="space-y-1.5">
                  {(q.options || []).map((opt) => (
                    <label key={opt} className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: DARK }}>
                      <input type="radio" name={q.id} checked={answers[q.id] === opt} onChange={() => set(q.id, opt)} style={{ accentColor: GOLD }} />
                      {opt}
                    </label>
                  ))}
                </div>
              )}
              {q.type === "multi_choice" && (
                <div className="space-y-1.5">
                  {(q.options || []).map((opt) => (
                    <label key={opt} className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: DARK }}>
                      <input type="checkbox" checked={Array.isArray(answers[q.id]) && answers[q.id].includes(opt)} onChange={() => toggleMulti(q.id, opt)} style={{ accentColor: GOLD }} />
                      {opt}
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="flex gap-3 p-5 border-t" style={{ borderColor: "rgba(200,169,81,0.2)" }}>
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold" style={{ background: "rgba(27,43,74,0.06)", color: BROWN }}>Cancel</button>
          <button onClick={submit} disabled={busy} className="flex-1 py-2.5 rounded-xl text-sm font-bold disabled:opacity-60"
            style={{ background: `linear-gradient(135deg,${GOLD},#F0D98C)`, color: "#14213D" }}>
            {busy ? "Submitting…" : "Submit responses"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function Forms() {
  const { isAuthenticated, isCoach, logout } = useAuth();
  const coach = isCoach();
  const [tab, setTab] = useState("templates");
  const [templates, setTemplates] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editTemplate, setEditTemplate] = useState(null); // {} = new, {id...} = edit
  const [assignTemplate, setAssignTemplate] = useState(null);
  const [viewResponse, setViewResponse] = useState(null);
  const [fillTarget, setFillTarget] = useState(null); // client: form being filled in

  const fetchAll = useCallback(async () => {
    if (!isAuthenticated) { logout(); return; }
    setLoading(true);
    try {
      if (coach) {
        // Templates + the client picker are coach-only endpoints.
        const [t, a, c] = await Promise.all([
          api.get("/forms/templates/"),
          api.get("/forms/assignments/"),
          api.get("/resources/clients/"),
        ]);
        setTemplates(t.data); setAssignments(a.data); setClients(c.data);
      } else {
        const a = await api.get("/forms/assignments/");
        setAssignments(a.data);
      }
    } catch { toast.error("Failed to load forms."); }
    finally { setLoading(false); }
  }, [isAuthenticated, coach, logout]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const archive = async (t) => {
    if (!window.confirm(`Archive "${t.title}"? Existing responses are kept.`)) return;
    try { await api.delete(`/forms/templates/${t.id}/`); toast.success("Template archived."); fetchAll(); }
    catch { toast.error("Could not archive."); }
  };
  const duplicate = async (t) => {
    try { await api.post(`/forms/templates/${t.id}/duplicate/`); toast.success("Template duplicated."); fetchAll(); }
    catch { toast.error("Could not duplicate."); }
  };

  if (loading) return (
    <div className="min-h-screen pt-36 pb-16 px-6" style={{ background: CREAM }}>
      <div className="max-w-4xl mx-auto">
        <WorkspaceTabs />
        <div className="flex justify-center py-24">
          <div className="w-10 h-10 rounded-full border-2 animate-spin" style={{ borderColor: GOLD, borderTopColor: "transparent" }} />
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen pt-36 pb-16 px-6" style={{ background: CREAM }}>
      <div className="max-w-4xl mx-auto">
        <WorkspaceTabs />
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: GOLD }}>Template Builder</p>
          <h1 className="text-3xl font-normal" style={{ color: DARK, fontFamily: "'Playfair Display', serif" }}>Forms &amp; Surveys</h1>
          <p className="text-sm mt-1" style={{ color: BROWN }}>
            {coach
              ? "Build reusable intake forms and feedback surveys, then send them to clients and read their responses."
              : "Forms and surveys your coach has asked you to complete."}
          </p>
        </motion.div>

        {/* Tabs (coach only) */}
        {coach && (<>
        <div className="flex gap-2 mb-6">
          {[["templates", "Templates"], ["sent", "Sent forms"]].map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              className="px-4 py-2 rounded-full text-sm font-semibold transition-all"
              style={tab === key
                ? { background: `linear-gradient(135deg,${GOLD},#F0D98C)`, color: "#14213D" }
                : { background: "white", color: BROWN, border: "1px solid rgba(200,169,81,0.25)" }}>
              {label}
            </button>
          ))}
        </div>

        {/* Templates tab */}
        {tab === "templates" && (
          <div className="space-y-4">
            <button onClick={() => setEditTemplate({})}
              className="w-full py-3 rounded-2xl text-sm font-bold flex items-center justify-center gap-2"
              style={{ background: "white", border: "1px dashed rgba(200,169,81,0.4)", color: "#A9863A" }}>
              <FiPlus size={15} /> New template
            </button>

            {templates.length === 0 ? (
              <div className="text-center py-16 rounded-2xl" style={{ background: "white", border: "1px dashed rgba(200,169,81,0.3)" }}>
                <FiFileText size={22} style={{ color: GOLD }} className="mx-auto mb-3" />
                <p className="text-sm" style={{ color: BROWN }}>No templates yet — create your first intake form or survey.</p>
              </div>
            ) : templates.map((t) => (
              <div key={t.id} className="rounded-2xl p-5" style={card}>
                <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
                  <div className="min-w-0">
                    <h3 className="text-lg font-normal" style={{ color: DARK, fontFamily: "'Playfair Display', serif" }}>{t.title}</h3>
                    <p className="text-xs mt-0.5" style={{ color: BROWN }}>
                      {KIND_LABEL[t.kind] || t.kind} · {t.questions.length} question{t.questions.length !== 1 ? "s" : ""} · sent {t.assignment_count}×
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <button onClick={() => setAssignTemplate(t)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold"
                    style={{ background: `linear-gradient(135deg,${GOLD},#F0D98C)`, color: "#14213D" }}>
                    <FiSend size={12} /> Send to client
                  </button>
                  <button onClick={() => setEditTemplate(t)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold" style={{ background: "rgba(200,169,81,0.12)", color: "#A9863A" }}>
                    <FiEdit3 size={12} /> Edit
                  </button>
                  <button onClick={() => duplicate(t)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold" style={{ background: "rgba(27,43,74,0.06)", color: BROWN }}>
                    <FiCopy size={12} /> Duplicate
                  </button>
                  <button onClick={() => archive(t)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold" style={{ background: "rgba(239,68,68,0.08)", color: "#B91C1C" }}>
                    <FiArchive size={12} /> Archive
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Sent tab */}
        {tab === "sent" && (
          assignments.length === 0 ? (
            <div className="text-center py-16 rounded-2xl" style={{ background: "white", border: "1px dashed rgba(200,169,81,0.3)" }}>
              <FiSend size={22} style={{ color: GOLD }} className="mx-auto mb-3" />
              <p className="text-sm" style={{ color: BROWN }}>No forms sent yet. Send a template from the Templates tab.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {assignments.map((a) => {
                const done = a.status === "completed";
                return (
                  <div key={a.id} className="rounded-2xl p-4 flex items-center gap-3 flex-wrap" style={card}>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold truncate" style={{ color: DARK }}>{a.title}</h3>
                      <p className="text-xs mt-0.5" style={{ color: BROWN }}>
                        For {a.client_name} · sent {new Date(a.created_at).toLocaleDateString()}
                        {done && a.completed_at ? ` · completed ${new Date(a.completed_at).toLocaleDateString()}` : ""}
                      </p>
                    </div>
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full shrink-0"
                      style={done ? { background: "rgba(52,168,83,0.12)", color: "#2E7D32" } : { background: "rgba(251,191,36,0.14)", color: "#92400E" }}>
                      {done ? <FiCheckCircle size={12} /> : <FiClock size={12} />} {done ? "Completed" : "Awaiting"}
                    </span>
                    {done && (
                      <button onClick={() => setViewResponse(a)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold shrink-0"
                        style={{ background: "rgba(200,169,81,0.12)", color: "#A9863A" }}>
                        <FiEye size={12} /> View responses
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )
        )}
        </>)}

        {/* Client: forms assigned to me */}
        {!coach && (
          assignments.length === 0 ? (
            <div className="text-center py-16 rounded-2xl" style={{ background: "white", border: "1px dashed rgba(200,169,81,0.3)" }}>
              <FiFileText size={22} style={{ color: GOLD }} className="mx-auto mb-3" />
              <p className="text-sm" style={{ color: BROWN }}>No forms to complete right now. Anything your coach sends will appear here.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {assignments.map((a) => {
                const done = a.status === "completed";
                return (
                  <div key={a.id} className="rounded-2xl p-4 flex items-center gap-3 flex-wrap" style={card}>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold truncate" style={{ color: DARK }}>{a.title}</h3>
                      <p className="text-xs mt-0.5" style={{ color: BROWN }}>
                        From {a.coach_name}
                        {done && a.completed_at ? ` · completed ${new Date(a.completed_at).toLocaleDateString()}` : ` · ${(a.questions_snapshot || []).length} question${(a.questions_snapshot || []).length !== 1 ? "s" : ""}`}
                      </p>
                    </div>
                    {done ? (
                      <>
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full shrink-0" style={{ background: "rgba(52,168,83,0.12)", color: "#2E7D32" }}>
                          <FiCheckCircle size={12} /> Completed
                        </span>
                        <button onClick={() => setViewResponse(a)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold shrink-0"
                          style={{ background: "rgba(200,169,81,0.12)", color: "#A9863A" }}>
                          <FiEye size={12} /> My answers
                        </button>
                      </>
                    ) : (
                      <button onClick={() => setFillTarget(a)} className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold shrink-0"
                        style={{ background: `linear-gradient(135deg,${GOLD},#F0D98C)`, color: "#14213D" }}>
                        <FiEdit3 size={12} /> Fill in
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>

      <AnimatePresence>
        {editTemplate && <TemplateModal template={editTemplate} onClose={() => setEditTemplate(null)} onSaved={() => { setEditTemplate(null); fetchAll(); }} />}
        {assignTemplate && <AssignModal template={assignTemplate} clients={clients} onClose={() => setAssignTemplate(null)} onAssigned={() => { setAssignTemplate(null); setTab("sent"); fetchAll(); }} />}
        {viewResponse && <ResponsesModal assignment={viewResponse} onClose={() => setViewResponse(null)} />}
        {fillTarget && <FillModal assignment={fillTarget} onClose={() => setFillTarget(null)} onSubmitted={() => { setFillTarget(null); fetchAll(); }} />}
      </AnimatePresence>
    </div>
  );
}
