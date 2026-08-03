import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, downloadResource } from "../utils/auth";
import { toast } from "react-toastify";
import { motion } from "framer-motion";
import MonthCalendar from "../components/MonthCalendar";
import {
  FiArrowLeft, FiBell, FiFolder, FiCalendar, FiMessageSquare,
  FiTrash2, FiPlus, FiDownload, FiExternalLink, FiSend, FiBookOpen,
  FiFileText, FiList, FiX,
} from "react-icons/fi";

const GOLD = "#C8A951";
const DARK = "#1B2B4A";
const BROWN = "#4A5568";
const CREAM = "#FAF6EC";

const fmtDate = (iso) => iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
const fmtLong = (iso) => iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) : "";
const STATUS_LABEL = {
  pending: "Pending", accepted: "Upcoming", completed: "Completed",
  no_show: "No show", declined: "Declined", cancelled: "Cancelled",
  held_offline: "Held off-platform", not_held: "Did not take place", rescheduled: "Rescheduled",
};

const TABS = [
  { key: "announcements", label: "Announcements", icon: FiBell },
  { key: "resources", label: "Resources", icon: FiFolder },
  { key: "sessions", label: "Sessions", icon: FiCalendar },
  { key: "messages", label: "Messages", icon: FiMessageSquare },
];

function SessionRow({ s, isCoach, onChat }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl p-3" style={{ background: CREAM, border: "1px solid rgba(200,169,81,0.15)" }}>
      <div className="min-w-0">
        <p className="text-sm font-semibold" style={{ color: DARK }}>{fmtDate(s.date)}{s.time ? ` · ${s.time}` : ""}</p>
        <p className="text-xs" style={{ color: BROWN }}>{isCoach ? `with ${s.with}` : STATUS_LABEL[s.status] || s.status}</p>
      </div>
      <button onClick={onChat} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold shrink-0" style={{ background: "rgba(27,43,74,0.06)", color: DARK }}>
        <FiMessageSquare size={12} /> Chat
      </button>
    </div>
  );
}

function EmptyState({ icon: Icon, text }) {
  return (
    <div className="text-center py-12">
      <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3" style={{ background: "rgba(200,169,81,0.12)" }}>
        <Icon size={20} style={{ color: GOLD }} />
      </div>
      <p className="text-sm" style={{ color: BROWN }}>{text}</p>
    </div>
  );
}

export default function ProgrammeSpace() {
  const { skillId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [tab, setTab] = useState("announcements");

  const [annForm, setAnnForm] = useState(false);
  const [annTitle, setAnnTitle] = useState("");
  const [annBody, setAnnBody] = useState("");
  const [posting, setPosting] = useState(false);

  const [resForm, setResForm] = useState(false);
  const [resTitle, setResTitle] = useState("");
  const [resFile, setResFile] = useState(null);
  const [resLink, setResLink] = useState("");
  const [uploading, setUploading] = useState(false);

  const [busy, setBusy] = useState("");
  const [selDate, setSelDate] = useState(null);
  const [sessionView, setSessionView] = useState("calendar"); // calendar | list

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/programmes/${skillId}/space/`);
      setData(res.data);
    } catch (err) {
      if (err.response?.status === 403) setForbidden(true);
      else toast.error("Failed to load this programme.");
    } finally { setLoading(false); }
  }, [skillId]);

  useEffect(() => { load(); }, [load]);

  const isCoach = data?.role === "coach";

  const postAnnouncement = async (e) => {
    e.preventDefault();
    if (!annTitle.trim()) { toast.error("Give the announcement a title."); return; }
    setPosting(true);
    try {
      const res = await api.post(`/programmes/${skillId}/announcements/`, { title: annTitle.trim(), body: annBody.trim() });
      setData((d) => ({ ...d, announcements: [res.data, ...d.announcements] }));
      setAnnTitle(""); setAnnBody(""); setAnnForm(false);
      toast.success("Announcement posted.");
    } catch (err) { toast.error(err.response?.data?.detail || "Failed to post."); }
    finally { setPosting(false); }
  };

  const deleteAnnouncement = async (id) => {
    if (!window.confirm("Delete this announcement?")) return;
    setBusy(`a${id}`);
    try {
      await api.delete(`/programmes/announcements/${id}/`);
      setData((d) => ({ ...d, announcements: d.announcements.filter((a) => a.id !== id) }));
    } catch { toast.error("Failed to delete."); }
    finally { setBusy(""); }
  };

  const addResource = async (e) => {
    e.preventDefault();
    if (!resTitle.trim()) { toast.error("Give the resource a title."); return; }
    if (!resFile && !resLink.trim()) { toast.error("Attach a file or paste a link."); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("title", resTitle.trim());
      fd.append("skill", skillId);
      fd.append("visibility", "all_clients");
      if (resFile) fd.append("file", resFile);
      else fd.append("link_url", resLink.trim());
      const res = await api.post("/resources/", fd);
      setData((d) => ({ ...d, resources: [res.data, ...d.resources] }));
      setResTitle(""); setResFile(null); setResLink(""); setResForm(false);
      toast.success("Resource added.");
    } catch (err) { toast.error(err.response?.data?.detail || "Failed to add resource."); }
    finally { setUploading(false); }
  };

  const openResource = async (r) => {
    if (r.is_link || (!r.download_url && r.link_url)) { window.open(r.link_url, "_blank", "noopener"); return; }
    setBusy(`r${r.id}`);
    try { await downloadResource(r.id, r.title); }
    catch { toast.error("Failed to download."); }
    finally { setBusy(""); }
  };

  const sessions = data?.sessions || [];
  const dayEvents = useMemo(() => sessions.filter((s) => s.date), [sessions]);
  const shownSessions = selDate ? sessions.filter((s) => s.date === selDate) : sessions;

  if (loading) return (
    <div className="flex justify-center items-center min-h-screen" style={{ background: CREAM }}>
      <div className="w-10 h-10 rounded-full border-2 animate-spin" style={{ borderColor: GOLD, borderTopColor: "transparent" }} />
    </div>
  );

  if (forbidden) return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center" style={{ background: CREAM }}>
      <FiBookOpen size={40} style={{ color: GOLD }} />
      <h1 className="text-2xl font-normal mt-4 mb-1" style={{ color: DARK, fontFamily: "'Playfair Display', serif" }}>Not part of this programme</h1>
      <p className="text-sm mb-5" style={{ color: BROWN }}>You don't have access to this programme space.</p>
      <button onClick={() => navigate(-1)} className="px-5 py-2.5 rounded-full text-sm font-bold" style={{ background: GOLD, color: "#14213D" }}>Go back</button>
    </div>
  );

  const { overview, announcements, resources } = data;
  const latestSession = sessions[0];
  const stats = [
    { label: "Announcements", value: announcements.length },
    { label: "Resources", value: resources.length },
    { label: "Sessions", value: sessions.length },
  ];

  return (
    <div className="min-h-screen pt-32 pb-16 px-6" style={{ background: CREAM }}>
      <div className="max-w-3xl mx-auto">
        <button onClick={() => navigate(-1)} className="inline-flex items-center gap-1.5 text-sm font-semibold mb-3" style={{ color: BROWN }}>
          <FiArrowLeft size={14} /> Back
        </button>

        {/* Hero */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl p-6 md:p-8" style={{ background: "linear-gradient(135deg,#1B2B4A,#14213D)", color: "white" }}>
          <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: GOLD }}>Programme Space</p>
          <h1 className="text-2xl md:text-3xl font-normal mb-2" style={{ fontFamily: "'Playfair Display', serif" }}>{overview.name}</h1>
          {overview.description && <p className="text-sm leading-relaxed opacity-90 mb-4" style={{ maxWidth: "62ch" }}>{overview.description}</p>}
          <div className="flex items-center gap-6">
            {stats.map((s) => (
              <div key={s.label}>
                <div className="text-xl font-bold" style={{ color: GOLD }}>{s.value}</div>
                <div className="text-[11px] uppercase tracking-wider opacity-70">{s.label}</div>
              </div>
            ))}
            <div className="ml-auto text-xs opacity-75 text-right">with<br />{overview.coach_name}</div>
          </div>
        </motion.div>

        {/* Tabs */}
        <div className="flex gap-1 mt-5 mb-5 p-1 rounded-full overflow-x-auto" style={{ background: "rgba(27,43,74,0.05)" }}>
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <button key={t.key} onClick={() => setTab(t.key)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold whitespace-nowrap transition-all"
                style={active ? { background: "white", color: DARK, boxShadow: "0 1px 6px rgba(27,43,74,0.1)" } : { color: BROWN }}>
                <t.icon size={14} style={{ color: active ? GOLD : BROWN }} /> {t.label}
              </button>
            );
          })}
        </div>

        <div className="rounded-2xl p-5 md:p-6" style={{ background: "white", border: "1px solid rgba(200,169,81,0.15)", boxShadow: "0 2px 12px rgba(27,43,74,0.04)" }}>
          {/* ANNOUNCEMENTS */}
          {tab === "announcements" && (
            <div>
              {isCoach && (
                <div className="mb-4">
                  {!annForm ? (
                    <button onClick={() => setAnnForm(true)} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-bold" style={{ background: "linear-gradient(135deg,#C8A951,#F0D98C)", color: "#14213D" }}>
                      <FiPlus size={13} /> New announcement
                    </button>
                  ) : (
                    <form onSubmit={postAnnouncement} className="rounded-xl p-4" style={{ background: CREAM, border: "1px solid rgba(200,169,81,0.2)" }}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-bold" style={{ color: DARK }}>New announcement</span>
                        <button type="button" onClick={() => setAnnForm(false)} className="p-1 rounded-full" style={{ color: BROWN }}><FiX size={15} /></button>
                      </div>
                      <input value={annTitle} onChange={(e) => setAnnTitle(e.target.value)} placeholder="Title"
                        className="w-full px-3 py-2 rounded-lg text-sm mb-2 focus:outline-none" style={{ background: "white", border: "1px solid rgba(200,169,81,0.3)", color: DARK }} />
                      <textarea value={annBody} onChange={(e) => setAnnBody(e.target.value)} placeholder="Write an update for everyone on this programme…" rows={2}
                        className="w-full px-3 py-2 rounded-lg text-sm mb-2 resize-none focus:outline-none" style={{ background: "white", border: "1px solid rgba(200,169,81,0.3)", color: DARK }} />
                      <button type="submit" disabled={posting} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-bold disabled:opacity-60" style={{ background: GOLD, color: "#14213D" }}>
                        <FiSend size={12} /> {posting ? "Posting…" : "Post"}
                      </button>
                    </form>
                  )}
                </div>
              )}
              {announcements.length === 0 ? (
                <EmptyState icon={FiBell} text="No announcements yet." />
              ) : (
                <div className="space-y-3">
                  {announcements.map((a) => (
                    <div key={a.id} className="rounded-xl p-4" style={{ background: CREAM, border: "1px solid rgba(200,169,81,0.15)" }}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="text-sm font-bold" style={{ color: DARK }}>{a.title}</h3>
                          {a.body && <p className="text-sm mt-1 whitespace-pre-line" style={{ color: BROWN }}>{a.body}</p>}
                          <p className="text-xs mt-2" style={{ color: "rgba(74,85,104,0.6)" }}>{a.coach_name} · {new Date(a.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>
                        </div>
                        {isCoach && (
                          <button onClick={() => deleteAnnouncement(a.id)} disabled={busy === `a${a.id}`} className="p-1.5 rounded-full shrink-0" style={{ background: "rgba(239,68,68,0.08)", color: "#B91C1C" }}>
                            <FiTrash2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* RESOURCES */}
          {tab === "resources" && (
            <div>
              {isCoach && (
                <div className="mb-4">
                  {!resForm ? (
                    <button onClick={() => setResForm(true)} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-bold" style={{ background: "linear-gradient(135deg,#C8A951,#F0D98C)", color: "#14213D" }}>
                      <FiPlus size={13} /> Add resource
                    </button>
                  ) : (
                    <form onSubmit={addResource} className="rounded-xl p-4 space-y-2" style={{ background: CREAM, border: "1px solid rgba(200,169,81,0.2)" }}>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-bold" style={{ color: DARK }}>Add resource</span>
                        <button type="button" onClick={() => setResForm(false)} className="p-1 rounded-full" style={{ color: BROWN }}><FiX size={15} /></button>
                      </div>
                      <input value={resTitle} onChange={(e) => setResTitle(e.target.value)} placeholder="Resource title"
                        className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none" style={{ background: "white", border: "1px solid rgba(200,169,81,0.3)", color: DARK }} />
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input type="file" onChange={(e) => setResFile(e.target.files?.[0] || null)} className="flex-1 text-sm" style={{ color: BROWN }} />
                        <input value={resLink} onChange={(e) => setResLink(e.target.value)} placeholder="…or paste a link"
                          className="flex-1 px-3 py-2 rounded-lg text-sm focus:outline-none" style={{ background: "white", border: "1px solid rgba(200,169,81,0.3)", color: DARK }} />
                      </div>
                      <button type="submit" disabled={uploading} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-bold disabled:opacity-60" style={{ background: GOLD, color: "#14213D" }}>
                        <FiPlus size={12} /> {uploading ? "Adding…" : "Add"}
                      </button>
                    </form>
                  )}
                </div>
              )}
              {resources.length === 0 ? (
                <EmptyState icon={FiFolder} text="No resources for this programme yet." />
              ) : (
                <div className="grid sm:grid-cols-2 gap-3">
                  {resources.map((r) => {
                    const link = r.is_link || (!r.download_url && r.link_url);
                    return (
                      <button key={r.id} onClick={() => openResource(r)} disabled={busy === `r${r.id}`}
                        className="flex items-center gap-3 rounded-xl p-3 text-left transition-all" style={{ background: CREAM, border: "1px solid rgba(200,169,81,0.15)" }}>
                        <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: "rgba(200,169,81,0.15)", color: "#A9863A" }}>
                          {link ? <FiExternalLink size={16} /> : <FiFileText size={16} />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold truncate" style={{ color: DARK }}>{r.title}</p>
                          <p className="text-xs" style={{ color: BROWN }}>{link ? "Open link" : "Download"}</p>
                        </div>
                        {link ? <FiExternalLink size={14} style={{ color: GOLD }} /> : <FiDownload size={14} style={{ color: GOLD }} />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* SESSIONS */}
          {tab === "sessions" && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-bold flex items-center gap-2" style={{ color: DARK }}><FiCalendar size={16} style={{ color: GOLD }} /> Sessions</h2>
                <div className="flex items-center gap-2">
                  {!isCoach && <button onClick={() => navigate(`/book/${skillId}`)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold" style={{ background: GOLD, color: "#14213D" }}><FiPlus size={12} /> Book next</button>}
                  <div className="flex rounded-full p-0.5" style={{ background: "rgba(27,43,74,0.06)" }}>
                    <button onClick={() => { setSessionView("calendar"); }} className="px-2.5 py-1 rounded-full text-xs font-semibold" style={sessionView === "calendar" ? { background: "white", color: DARK } : { color: BROWN }}><FiCalendar size={12} /></button>
                    <button onClick={() => { setSessionView("list"); setSelDate(null); }} className="px-2.5 py-1 rounded-full text-xs font-semibold" style={sessionView === "list" ? { background: "white", color: DARK } : { color: BROWN }}><FiList size={12} /></button>
                  </div>
                </div>
              </div>

              {sessions.length === 0 ? (
                <EmptyState icon={FiCalendar} text="No sessions yet." />
              ) : sessionView === "calendar" ? (
                <>
                  <div className="mb-4 rounded-xl p-3 max-w-[340px] mx-auto" style={{ background: CREAM, border: "1px solid rgba(200,169,81,0.15)" }}>
                    <MonthCalendar events={dayEvents} selected={selDate} onSelect={setSelDate}
                      initialMonth={dayEvents[0]?.date?.slice(0, 7)} />
                  </div>
                  {selDate ? (
                    <>
                      <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "rgba(74,85,104,0.55)" }}>{fmtLong(selDate)}</p>
                      <div className="space-y-2">
                        {shownSessions.length === 0 ? (
                          <p className="text-sm py-3 text-center" style={{ color: BROWN }}>No sessions on this day.</p>
                        ) : shownSessions.map((s) => (
                          <SessionRow key={s.id} s={s} isCoach={isCoach} onChat={() => navigate(`/chat/${s.id}`)} />
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-center py-3" style={{ color: BROWN }}>Tap a highlighted date (•) to see its sessions.</p>
                  )}
                </>
              ) : (
                <>
                  <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "rgba(74,85,104,0.55)" }}>{sessions.length} session{sessions.length === 1 ? "" : "s"}</p>
                  <div className="space-y-2">
                    {sessions.map((s) => (
                      <SessionRow key={s.id} s={s} isCoach={isCoach} onChat={() => navigate(`/chat/${s.id}`)} />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* MESSAGES */}
          {tab === "messages" && (
            latestSession ? (
              <div className="text-center py-8">
                <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3" style={{ background: "rgba(200,169,81,0.12)" }}>
                  <FiMessageSquare size={20} style={{ color: GOLD }} />
                </div>
                <p className="text-sm mb-4" style={{ color: BROWN }}>Message {isCoach ? "your client" : overview.coach_name} directly about this programme.</p>
                <button onClick={() => navigate(`/chat/${latestSession.id}`)} className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full text-sm font-bold" style={{ background: GOLD, color: "#14213D" }}>
                  <FiMessageSquare size={13} /> Open chat
                </button>
              </div>
            ) : (
              <EmptyState icon={FiMessageSquare} text="Chat opens once there's a session on this programme." />
            )
          )}
        </div>
      </div>
    </div>
  );
}
