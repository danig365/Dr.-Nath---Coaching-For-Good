import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "react-toastify";
import { FiPlus, FiCopy, FiUsers, FiCalendar, FiEdit2, FiBarChart2, FiX, FiSend, FiCheck } from "react-icons/fi";

import { api } from "../utils/auth";
import { useAccessGuard } from "../utils/accessGuard";

// Partner organisations (October Health Month): one participation code per
// practice, each with its own allocation of sessions. This is both where Dr Nath
// creates them and where she reads how each practice is using its 20 — the
// "dashboard per practice" she asked for.
//
// Everything a practice sees is counts, never coaching content: a patient's
// sessions are between them and their coach.

const NAVY = "#1B2B4A";
const SLATE = "#4A5568";
const serif = { fontFamily: "'Cormorant Garamond', Georgia, serif" };
const card = {
  background: "white",
  border: "1px solid rgba(200,169,81,0.2)",
  boxShadow: "0 8px 30px rgba(27,43,74,0.06)",
};

const emptyForm = {
  code: "",
  organisation: "",
  contact_name: "",
  contact_email: "",
  skill: "",
  audience: "patients",
  total_sessions: 20,
  max_per_client: 4,
  valid_from: "",
  valid_until: "",
  active: true,
  notes: "",
};

const inputCls = "w-full px-3.5 py-2.5 rounded-xl text-sm focus:outline-none";
const inputStyle = { background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.3)", color: NAVY };

const Field = ({ label, hint, children }) => (
  <div>
    <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "#A9863A" }}>
      {label}
    </label>
    {children}
    {hint && <p className="text-xs mt-1" style={{ color: "rgba(74,85,104,0.65)" }}>{hint}</p>}
  </div>
);

const Stat = ({ label, value, tone }) => (
  <div className="rounded-xl px-3 py-2.5 text-center" style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.15)" }}>
    <p className="text-lg font-bold" style={{ color: tone || NAVY }}>{value}</p>
    <p className="text-[11px] uppercase tracking-wider" style={{ color: "rgba(74,85,104,0.6)" }}>{label}</p>
  </div>
);

export default function PartnerCodes() {
  const { requireCoach } = useAccessGuard();
  const [codes, setCodes] = useState([]);
  const [skills, setSkills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [report, setReport] = useState(null); // { code, ...report }
  // The invitation being written: the practice it's for, plus the draft the
  // server filled in, which she can edit before it goes.
  const [invite, setInvite] = useState(null);
  const [patients, setPatients] = useState(null); // who registered under one code
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    if (requireCoach()) return;
    setLoading(true);
    try {
      const [c, s] = await Promise.all([
        api.get("/participation-codes/"),
        api.get("/skills/"),
      ]);
      setCodes(Array.isArray(c.data) ? c.data : c.data.results || []);
      setSkills(Array.isArray(s.data) ? s.data : s.data.results || []);
    } catch {
      toast.error("Couldn't load participation codes.");
    } finally {
      setLoading(false);
    }
  }, [requireCoach]);

  useEffect(() => { load(); }, [load]);

  const totals = useMemo(() => codes.reduce(
    (acc, c) => ({
      practices: acc.practices + 1,
      patients: acc.patients + (c.clients_registered || 0),
      used: acc.used + (c.sessions_used || 0),
      allocated: acc.allocated + (c.total_sessions || 0),
    }),
    { practices: 0, patients: 0, used: 0, allocated: 0 },
  ), [codes]);

  const startNew = () => {
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(true);
  };

  const startEdit = (c) => {
    setForm({
      code: c.code, organisation: c.organisation, contact_name: c.contact_name || "",
      contact_email: c.contact_email || "", skill: c.skill || "",
      audience: c.audience || "patients",
      total_sessions: c.total_sessions, max_per_client: c.max_per_client,
      valid_from: c.valid_from || "", valid_until: c.valid_until || "",
      active: c.active, notes: c.notes || "",
    });
    setEditingId(c.id);
    setShowForm(true);
  };

  const save = async (e) => {
    e.preventDefault();
    if (!form.code.trim() || !form.organisation.trim()) {
      toast.error("A code and the organisation's name are both needed.");
      return;
    }
    setSaving(true);
    const payload = {
      ...form,
      code: form.code.trim().toUpperCase(),
      skill: form.skill || null,
      valid_from: form.valid_from || null,
      valid_until: form.valid_until || null,
      total_sessions: Number(form.total_sessions) || 0,
      max_per_client: Number(form.max_per_client) || 0,
    };
    try {
      if (editingId) await api.patch(`/participation-codes/${editingId}/`, payload);
      else await api.post("/participation-codes/", payload);
      toast.success(editingId ? "Code updated." : "Code created.");
      setShowForm(false);
      setEditingId(null);
      setForm(emptyForm);
      load();
    } catch (err) {
      const data = err.response?.data;
      toast.error(data?.code?.[0] || data?.detail || "Couldn't save the code.");
    } finally {
      setSaving(false);
    }
  };

  const openInvite = async (c) => {
    try {
      const res = await api.get(`/participation-codes/${c.id}/invitation/`);
      setInvite({
        id: c.id,
        organisation: c.organisation,
        code: c.code,
        to: (res.data.to || []).join(", "),
        subject: res.data.subject || "",
        body: res.data.body || "",
        sent_at: res.data.sent_at,
        sent_count: res.data.sent_count,
      });
    } catch {
      toast.error("Couldn't prepare the invitation.");
    }
  };

  const sendInvite = async () => {
    if (!invite.to.trim()) { toast.error("Add at least one email address."); return; }
    setSending(true);
    try {
      const res = await api.post(`/participation-codes/${invite.id}/invitation/`, {
        to: invite.to, subject: invite.subject, body: invite.body,
      });
      const { sent, failed } = res.data;
      if (sent) toast.success(`Invitation sent to ${sent} recipient${sent === 1 ? "" : "s"}.`);
      if (failed?.length) toast.error(`Couldn't send to: ${failed.join(", ")}`);
      setInvite(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Couldn't send the invitation.");
    } finally {
      setSending(false);
    }
  };

  const openPatients = async (c) => {
    if (!c.clients_registered) return;
    try {
      const res = await api.get(`/participation-codes/${c.id}/patients/`);
      setPatients(res.data);
    } catch {
      toast.error("Couldn't load the patient list.");
    }
  };

  const openReport = async (c) => {
    try {
      const res = await api.get(`/participation-codes/${c.id}/report/`);
      setReport(res.data);
    } catch {
      toast.error("Couldn't load the report.");
    }
  };

  const copy = (code) => {
    navigator.clipboard?.writeText(code)
      .then(() => toast.success(`${code} copied.`))
      .catch(() => toast.info(code));
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen" style={{ background: "#FAF6EC" }}>
        <div className="w-10 h-10 rounded-full border-2 animate-spin" style={{ borderColor: "#C8A951", borderTopColor: "transparent" }} />
      </div>
    );
  }

  return (
    <div className="min-h-screen pt-36 pb-16 px-6" style={{ background: "#FAF6EC" }}>
      <div className="max-w-5xl mx-auto">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
          className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl md:text-4xl font-normal" style={{ ...serif, color: NAVY }}>Partner Organisations</h1>
            <p className="text-sm mt-1" style={{ color: "rgba(74,85,104,0.8)" }}>
              A code per practice, each with its own allocation of sessions. Patients enter it when they register.
            </p>
          </div>
          <button onClick={startNew}
            className="flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-bold shrink-0"
            style={{ background: "linear-gradient(135deg,#C8A951,#F0D98C)", color: NAVY }}>
            <FiPlus size={16} /> New code
          </button>
        </motion.div>

        {codes.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
            <Stat label="Practices" value={totals.practices} />
            <Stat label="Patients" value={totals.patients} />
            <Stat label="Sessions used" value={totals.used} tone="#2E7D32" />
            <Stat label="Allocated" value={totals.allocated} />
          </div>
        )}

        {showForm && (
          <motion.form onSubmit={save} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl p-6 mb-8 space-y-4" style={card}>
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-normal" style={{ ...serif, color: NAVY }}>
                {editingId ? "Edit code" : "New participation code"}
              </h2>
              <button type="button" onClick={() => { setShowForm(false); setEditingId(null); }}
                className="p-1.5 rounded-lg" style={{ color: SLATE }}>
                <FiX size={18} />
              </button>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Code" hint="What patients type when registering. Short and easy to read.">
                <input className={inputCls} style={inputStyle} value={form.code}
                  onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                  placeholder="KEAGAN" />
              </Field>
              <Field label="Organisation">
                <input className={inputCls} style={inputStyle} value={form.organisation}
                  onChange={e => setForm(f => ({ ...f, organisation: e.target.value }))}
                  placeholder="Keagan Medical Practice" />
              </Field>
              <Field label="Contact name">
                <input className={inputCls} style={inputStyle} value={form.contact_name}
                  onChange={e => setForm(f => ({ ...f, contact_name: e.target.value }))}
                  placeholder="Dr Keagan" />
              </Field>
              <Field label="Contact emails" hint="Separate several with commas — the doctor, the practice manager, reception.">
                <input className={inputCls} style={inputStyle} value={form.contact_email}
                  placeholder="doctor@practice.co.za, reception@practice.co.za"
                  onChange={e => setForm(f => ({ ...f, contact_email: e.target.value }))} />
              </Field>
              <Field label="They nominate" hint="A practice nominates patients; a company nominates employees. The invitation follows.">
                <select className={inputCls} style={inputStyle} value={form.audience}
                  onChange={e => setForm(f => ({ ...f, audience: e.target.value }))}>
                  <option value="patients">Patients</option>
                  <option value="employees">Employees</option>
                  <option value="clients">Clients</option>
                </select>
              </Field>
              <Field label="Offering" hint="The sessions this allocation pays for.">
                <select className={inputCls} style={inputStyle} value={form.skill}
                  onChange={e => setForm(f => ({ ...f, skill: e.target.value }))}>
                  <option value="">Any of my offerings</option>
                  {skills.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Sessions">
                  <input type="number" min="1" className={inputCls} style={inputStyle} value={form.total_sessions}
                    onChange={e => setForm(f => ({ ...f, total_sessions: e.target.value }))} />
                </Field>
                <Field label="Per patient">
                  <input type="number" min="1" className={inputCls} style={inputStyle} value={form.max_per_client}
                    onChange={e => setForm(f => ({ ...f, max_per_client: e.target.value }))} />
                </Field>
              </div>
              <Field label="Runs from">
                <input type="date" className={inputCls} style={inputStyle} value={form.valid_from}
                  onChange={e => setForm(f => ({ ...f, valid_from: e.target.value }))} />
              </Field>
              <Field label="Runs until">
                <input type="date" className={inputCls} style={inputStyle} value={form.valid_until}
                  onChange={e => setForm(f => ({ ...f, valid_until: e.target.value }))} />
              </Field>
            </div>

            <Field label="Notes" hint="Only you see these.">
              <textarea rows={2} className={inputCls} style={inputStyle} value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </Field>

            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.active}
                onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} />
              <span className="text-sm" style={{ color: SLATE }}>Active — patients can register with this code</span>
            </label>

            <button type="submit" disabled={saving}
              className="px-6 py-2.5 rounded-full text-sm font-bold disabled:opacity-60"
              style={{ background: NAVY, color: "#FAF6EC" }}>
              {saving ? "Saving…" : editingId ? "Save changes" : "Create code"}
            </button>
          </motion.form>
        )}

        {codes.length === 0 ? (
          <div className="rounded-2xl py-16 text-center" style={card}>
            <p className="text-3xl mb-3">🏥</p>
            <p className="text-sm font-semibold" style={{ color: NAVY }}>No partner organisations yet</p>
            <p className="text-sm mt-1" style={{ color: "rgba(74,85,104,0.7)" }}>
              Create a code for each practice, then send it to them with your invitation.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {codes.map(c => {
              const used = c.sessions_used || 0;
              const pct = c.total_sessions ? Math.min(100, Math.round((used / c.total_sessions) * 100)) : 0;
              return (
                <div key={c.id} className="rounded-2xl p-5" style={{ ...card, opacity: c.active ? 1 : 0.65 }}>
                  <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-2.5 py-1 rounded-lg text-sm font-bold tracking-wider"
                          style={{ background: "rgba(200,169,81,0.15)", color: "#A9863A" }}>{c.code}</span>
                        <button onClick={() => copy(c.code)} title="Copy code" style={{ color: SLATE }}>
                          <FiCopy size={14} />
                        </button>
                        {!c.active && (
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                            style={{ background: "rgba(239,68,68,0.08)", color: "#B91C1C" }}>Inactive</span>
                        )}
                      </div>
                      <p className="text-lg font-normal mt-1.5" style={{ ...serif, color: NAVY }}>{c.organisation}</p>
                      {c.invite_sent_at && (
                        <p className="text-xs mt-1 flex items-center gap-1.5" style={{ color: "#2E7D32" }}>
                          <FiCheck size={12} /> Invitation sent {new Date(c.invite_sent_at).toLocaleDateString()}
                          {c.invite_sent_count > 1 ? ` · ${c.invite_sent_count} emails` : ""}
                        </p>
                      )}
                      <p className="text-xs" style={{ color: "rgba(74,85,104,0.7)" }}>
                        {c.skill_name || "Any offering"}
                        {c.valid_from && c.valid_until && ` · ${c.valid_from} → ${c.valid_until}`}
                        {c.contact_email && ` · ${c.contact_email}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => openInvite(c)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold"
                        style={{ background: "linear-gradient(135deg,#C8A951,#F0D98C)", color: NAVY }}>
                        <FiSend size={13} /> {c.invite_sent_count ? "Send again" : "Send invitation"}
                      </button>
                      <button onClick={() => openReport(c)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold"
                        style={{ background: "rgba(200,169,81,0.12)", color: "#A9863A", border: "1px solid rgba(200,169,81,0.25)" }}>
                        <FiBarChart2 size={13} /> Report
                      </button>
                      <button onClick={() => startEdit(c)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold"
                        style={{ background: "rgba(27,43,74,0.06)", color: SLATE }}>
                        <FiEdit2 size={13} /> Edit
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-4 text-sm" style={{ color: SLATE }}>
                    <button onClick={() => openPatients(c)} disabled={!c.clients_registered}
                      className="flex items-center gap-1.5 disabled:cursor-default"
                      style={{ color: c.clients_registered ? "#A9863A" : SLATE,
                               textDecoration: c.clients_registered ? "underline" : "none" }}
                      title={c.clients_registered ? "See who registered with this code" : "Nobody has registered with this code yet"}>
                      <FiUsers size={14} style={{ color: "#C8A951" }} />
                      {c.clients_registered} patient{c.clients_registered === 1 ? "" : "s"}
                    </button>
                    <span className="flex items-center gap-1.5"><FiCalendar size={14} style={{ color: "#C8A951" }} />
                      max {c.max_per_client} each
                    </span>
                    <span className="font-semibold" style={{ color: NAVY }}>
                      {used} of {c.total_sessions} sessions used
                    </span>
                  </div>
                  <div className="h-2 rounded-full mt-2.5 overflow-hidden" style={{ background: "rgba(27,43,74,0.08)" }}>
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: pct >= 100 ? "#B91C1C" : "linear-gradient(90deg,#C8A951,#F0D98C)" }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {invite && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" style={{ background: "rgba(27,43,74,0.55)" }}
          onClick={() => !sending && setInvite(null)}>
          <div className="w-full max-w-2xl rounded-2xl p-6 max-h-[90vh] overflow-y-auto" style={{ background: "white" }}
            onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-1">
              <h2 className="text-2xl font-normal" style={{ ...serif, color: NAVY }}>Invite {invite.organisation}</h2>
              <button onClick={() => !sending && setInvite(null)} style={{ color: SLATE }}><FiX size={20} /></button>
            </div>
            <p className="text-xs mb-5" style={{ color: "rgba(74,85,104,0.7)" }}>
              Code {invite.code} — already written into the message. Edit anything before you send;
              each person gets their own copy.
              {invite.sent_count > 0 && ` Previously sent to ${invite.sent_count} recipient${invite.sent_count === 1 ? "" : "s"}.`}
            </p>

            <div className="space-y-4">
              <Field label="To" hint="Separate several addresses with commas.">
                <input className={inputCls} style={inputStyle} value={invite.to}
                  onChange={e => setInvite(v => ({ ...v, to: e.target.value }))}
                  placeholder="doctor@practice.co.za, reception@practice.co.za" />
              </Field>
              <Field label="Subject">
                <input className={inputCls} style={inputStyle} value={invite.subject}
                  onChange={e => setInvite(v => ({ ...v, subject: e.target.value }))} />
              </Field>
              <Field label="Message">
                <textarea rows={16} className={inputCls} style={{ ...inputStyle, lineHeight: 1.6 }} value={invite.body}
                  onChange={e => setInvite(v => ({ ...v, body: e.target.value }))} />
              </Field>
            </div>

            <div className="flex items-center gap-3 mt-5">
              <button onClick={sendInvite} disabled={sending}
                className="flex items-center gap-2 px-6 py-2.5 rounded-full text-sm font-bold disabled:opacity-60"
                style={{ background: "linear-gradient(135deg,#C8A951,#F0D98C)", color: NAVY }}>
                <FiSend size={15} /> {sending ? "Sending…" : "Send invitation"}
              </button>
              <button onClick={() => setInvite(null)} disabled={sending}
                className="px-5 py-2.5 rounded-full text-sm font-semibold"
                style={{ background: "rgba(27,43,74,0.06)", color: SLATE }}>
                Cancel
              </button>
            </div>
            <p className="text-xs mt-3" style={{ color: "rgba(74,85,104,0.6)" }}>
              Sent from dr-nath.com. Replies come back to your enquiries inbox.
            </p>
          </div>
        </div>
      )}

      {patients && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" style={{ background: "rgba(27,43,74,0.55)" }}
          onClick={() => setPatients(null)}>
          <div className="w-full max-w-2xl rounded-2xl p-6 max-h-[85vh] overflow-y-auto" style={{ background: "white" }}
            onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-1">
              <h2 className="text-2xl font-normal" style={{ ...serif, color: NAVY }}>{patients.organisation}</h2>
              <button onClick={() => setPatients(null)} style={{ color: SLATE }}><FiX size={20} /></button>
            </div>
            <p className="text-xs mb-5" style={{ color: "rgba(74,85,104,0.7)" }}>
              {patients.patients.length} registered with code {patients.code}. Contact details are yours only —
              the practice's report shows counts, never names.
            </p>

            {patients.patients.length === 0 ? (
              <p className="text-sm py-6 text-center" style={{ color: SLATE }}>Nobody has registered with this code yet.</p>
            ) : (
              <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(200,169,81,0.2)" }}>
                <div className="grid text-[11px] font-semibold uppercase tracking-wider px-4 py-2.5"
                  style={{ gridTemplateColumns: "1.4fr 1.8fr 1.2fr 0.8fr", background: "#FAF6EC", color: "rgba(74,85,104,0.6)" }}>
                  <span>Name</span><span>Email</span><span>Phone</span><span className="text-center">Sessions</span>
                </div>
                {patients.patients.map((p, i) => (
                  <div key={p.id} className="grid items-center px-4 py-3 text-sm"
                    style={{ gridTemplateColumns: "1.4fr 1.8fr 1.2fr 0.8fr",
                             borderTop: i === 0 ? "none" : "1px solid rgba(200,169,81,0.12)", color: SLATE }}>
                    <span className="font-semibold truncate" style={{ color: NAVY }}>{p.name}</span>
                    <a href={`mailto:${p.email}`} className="truncate hover:underline" style={{ color: "#A9863A" }}>{p.email}</a>
                    {p.phone
                      ? <a href={`tel:${p.phone}`} className="truncate hover:underline" style={{ color: "#A9863A" }}>{p.phone}</a>
                      : <span style={{ color: "rgba(74,85,104,0.45)" }}>Not given</span>}
                    <span className="text-center font-semibold" style={{ color: NAVY }}>
                      {p.sessions_booked} / {patients.max_per_client || "—"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {report && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" style={{ background: "rgba(27,43,74,0.55)" }}
          onClick={() => setReport(null)}>
          <div className="w-full max-w-lg rounded-2xl p-6" style={{ background: "white" }} onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-1">
              <h2 className="text-2xl font-normal" style={{ ...serif, color: NAVY }}>{report.organisation}</h2>
              <button onClick={() => setReport(null)} style={{ color: SLATE }}><FiX size={20} /></button>
            </div>
            <p className="text-xs mb-5" style={{ color: "rgba(74,85,104,0.7)" }}>
              Code {report.code}
              {report.window?.from && ` · ${report.window.from} → ${report.window.until}`}
            </p>

            <div className="grid grid-cols-3 gap-3 mb-4">
              <Stat label="Allocated" value={report.allocation.total} />
              <Stat label="Used" value={report.allocation.used} tone="#2E7D32" />
              <Stat label="Left" value={report.allocation.left} />
            </div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <Stat label="Patients" value={report.patients.registered} />
              <Stat label="Booked" value={report.patients.booked_at_least_one} />
              <Stat label="Avg each" value={report.patients.average_sessions_each} />
            </div>
            <div className="grid grid-cols-4 gap-3">
              <Stat label="Completed" value={report.sessions.completed} tone="#2E7D32" />
              <Stat label="Upcoming" value={report.sessions.upcoming} />
              <Stat label="Cancelled" value={report.sessions.cancelled} />
              <Stat label="Missed" value={report.sessions.missed} tone="#B91C1C" />
            </div>

            <p className="text-xs mt-5 leading-relaxed" style={{ color: "rgba(74,85,104,0.7)" }}>
              These are counts only — what a patient discusses in coaching is never shared with their
              practice. {report.patients.consented_to_share} of {report.patients.registered} patients
              agreed to be included in a summary shared with {report.organisation}.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
