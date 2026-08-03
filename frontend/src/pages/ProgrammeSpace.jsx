import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, downloadResource } from "../utils/auth";
import { toast } from "react-toastify";
import { motion } from "framer-motion";
import {
  FiArrowLeft, FiBell, FiFolder, FiCalendar, FiMessageSquare,
  FiTrash2, FiPlus, FiDownload, FiExternalLink, FiSend, FiBookOpen,
} from "react-icons/fi";

const GOLD = "#C8A951";
const DARK = "#1B2B4A";
const BROWN = "#4A5568";

const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
const STATUS_LABEL = {
  pending: "Pending", accepted: "Upcoming", completed: "Completed",
  no_show: "No show", declined: "Declined", cancelled: "Cancelled",
  held_offline: "Held off-platform", not_held: "Did not take place", rescheduled: "Rescheduled",
};

function Section({ icon: Icon, title, children, action }) {
  return (
    <div className="rounded-2xl p-5 md:p-6" style={{ background: "white", border: "1px solid rgba(200,169,81,0.15)", boxShadow: "0 2px 12px rgba(27,43,74,0.04)" }}>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Icon size={16} style={{ color: GOLD }} />
          <h2 className="text-base font-bold" style={{ color: DARK }}>{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

export default function ProgrammeSpace() {
  const { skillId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);

  // coach announcement composer
  const [annTitle, setAnnTitle] = useState("");
  const [annBody, setAnnBody] = useState("");
  const [posting, setPosting] = useState(false);
  // coach resource composer
  const [resTitle, setResTitle] = useState("");
  const [resFile, setResFile] = useState(null);
  const [resLink, setResLink] = useState("");
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/programmes/${skillId}/space/`);
      setData(res.data);
    } catch (err) {
      if (err.response?.status === 403) setForbidden(true);
      else toast.error("Failed to load this programme.");
    } finally {
      setLoading(false);
    }
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
      setAnnTitle(""); setAnnBody("");
      toast.success("Announcement posted.");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to post.");
    } finally { setPosting(false); }
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
      setResTitle(""); setResFile(null); setResLink("");
      toast.success("Resource added.");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to add resource.");
    } finally { setUploading(false); }
  };

  const openResource = async (r) => {
    if (r.is_link || (!r.download_url && r.link_url)) { window.open(r.link_url, "_blank", "noopener"); return; }
    setBusy(`r${r.id}`);
    try { await downloadResource(r.id, r.title); }
    catch { toast.error("Failed to download."); }
    finally { setBusy(""); }
  };

  if (loading) return (
    <div className="flex justify-center items-center min-h-screen" style={{ background: "#FAF6EC" }}>
      <div className="w-10 h-10 rounded-full border-2 animate-spin" style={{ borderColor: GOLD, borderTopColor: "transparent" }} />
    </div>
  );

  if (forbidden) return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center" style={{ background: "#FAF6EC" }}>
      <FiBookOpen size={40} style={{ color: GOLD }} />
      <h1 className="text-2xl font-normal mt-4 mb-1" style={{ color: DARK, fontFamily: "'Playfair Display', serif" }}>Not part of this programme</h1>
      <p className="text-sm mb-5" style={{ color: BROWN }}>You don't have access to this programme space.</p>
      <button onClick={() => navigate(-1)} className="px-5 py-2.5 rounded-full text-sm font-bold" style={{ background: GOLD, color: "#14213D" }}>Go back</button>
    </div>
  );

  const { overview, announcements, resources, sessions } = data;
  const latestSession = sessions[0];

  return (
    <div className="min-h-screen pt-32 pb-16 px-6" style={{ background: "#FAF6EC" }}>
      <div className="max-w-3xl mx-auto space-y-5">
        <button onClick={() => navigate(-1)} className="inline-flex items-center gap-1.5 text-sm font-semibold mb-1" style={{ color: BROWN }}>
          <FiArrowLeft size={14} /> Back
        </button>

        {/* Overview */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl p-6 md:p-8" style={{ background: "linear-gradient(135deg,#1B2B4A,#14213D)", color: "white" }}>
          <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: GOLD }}>Programme Space</p>
          <h1 className="text-2xl md:text-3xl font-normal mb-2" style={{ fontFamily: "'Playfair Display', serif" }}>{overview.name}</h1>
          {overview.description && <p className="text-sm leading-relaxed opacity-90 mb-3" style={{ maxWidth: "60ch" }}>{overview.description}</p>}
          <p className="text-xs opacity-75">with {overview.coach_name}</p>
        </motion.div>

        {/* Announcements */}
        <Section icon={FiBell} title="Announcements">
          {isCoach && (
            <form onSubmit={postAnnouncement} className="mb-4 rounded-xl p-4" style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.2)" }}>
              <input value={annTitle} onChange={(e) => setAnnTitle(e.target.value)} placeholder="Announcement title"
                className="w-full px-3 py-2 rounded-lg text-sm mb-2 focus:outline-none" style={{ background: "white", border: "1px solid rgba(200,169,81,0.3)", color: DARK }} />
              <textarea value={annBody} onChange={(e) => setAnnBody(e.target.value)} placeholder="Write an update for everyone on this programme…" rows={2}
                className="w-full px-3 py-2 rounded-lg text-sm mb-2 resize-none focus:outline-none" style={{ background: "white", border: "1px solid rgba(200,169,81,0.3)", color: DARK }} />
              <button type="submit" disabled={posting} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-bold disabled:opacity-60" style={{ background: GOLD, color: "#14213D" }}>
                <FiSend size={12} /> {posting ? "Posting…" : "Post announcement"}
              </button>
            </form>
          )}
          {announcements.length === 0 ? (
            <p className="text-sm" style={{ color: BROWN }}>No announcements yet.</p>
          ) : (
            <div className="space-y-3">
              {announcements.map((a) => (
                <div key={a.id} className="rounded-xl p-4" style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.15)" }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-sm font-bold" style={{ color: DARK }}>{a.title}</h3>
                      {a.body && <p className="text-sm mt-1 whitespace-pre-line" style={{ color: BROWN }}>{a.body}</p>}
                      <p className="text-xs mt-2" style={{ color: "rgba(74,85,104,0.6)" }}>{a.coach_name} · {fmtDate(a.created_at)}</p>
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
        </Section>

        {/* Resources */}
        <Section icon={FiFolder} title="Resources">
          {isCoach && (
            <form onSubmit={addResource} className="mb-4 rounded-xl p-4 space-y-2" style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.2)" }}>
              <input value={resTitle} onChange={(e) => setResTitle(e.target.value)} placeholder="Resource title"
                className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none" style={{ background: "white", border: "1px solid rgba(200,169,81,0.3)", color: DARK }} />
              <div className="flex flex-col sm:flex-row gap-2">
                <input type="file" onChange={(e) => setResFile(e.target.files?.[0] || null)}
                  className="flex-1 text-sm" style={{ color: BROWN }} />
                <input value={resLink} onChange={(e) => setResLink(e.target.value)} placeholder="…or paste a link"
                  className="flex-1 px-3 py-2 rounded-lg text-sm focus:outline-none" style={{ background: "white", border: "1px solid rgba(200,169,81,0.3)", color: DARK }} />
              </div>
              <button type="submit" disabled={uploading} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-bold disabled:opacity-60" style={{ background: GOLD, color: "#14213D" }}>
                <FiPlus size={12} /> {uploading ? "Adding…" : "Add resource"}
              </button>
            </form>
          )}
          {resources.length === 0 ? (
            <p className="text-sm" style={{ color: BROWN }}>No resources for this programme yet.</p>
          ) : (
            <div className="space-y-2">
              {resources.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-3 rounded-xl p-3" style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.15)" }}>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: DARK }}>{r.title}</p>
                    {r.description && <p className="text-xs truncate" style={{ color: BROWN }}>{r.description}</p>}
                  </div>
                  <button onClick={() => openResource(r)} disabled={busy === `r${r.id}`} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold shrink-0" style={{ background: "rgba(200,169,81,0.15)", color: "#A9863A" }}>
                    {r.is_link || (!r.download_url && r.link_url) ? <><FiExternalLink size={12} /> Open</> : <><FiDownload size={12} /> Download</>}
                  </button>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Sessions */}
        <Section icon={FiCalendar} title="Sessions"
          action={!isCoach && <button onClick={() => navigate(`/book/${skillId}`)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold" style={{ background: GOLD, color: "#14213D" }}><FiPlus size={12} /> Book next</button>}>
          {sessions.length === 0 ? (
            <p className="text-sm" style={{ color: BROWN }}>No sessions yet.</p>
          ) : (
            <div className="space-y-2">
              {sessions.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-3 rounded-xl p-3" style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.15)" }}>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold" style={{ color: DARK }}>{fmtDate(s.date)}{s.time ? ` · ${s.time}` : ""}</p>
                    <p className="text-xs" style={{ color: BROWN }}>{isCoach ? `with ${s.with}` : STATUS_LABEL[s.status] || s.status}</p>
                  </div>
                  <button onClick={() => navigate(`/chat/${s.id}`)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold shrink-0" style={{ background: "rgba(27,43,74,0.06)", color: DARK }}>
                    <FiMessageSquare size={12} /> Chat
                  </button>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Messages shortcut */}
        {latestSession && (
          <Section icon={FiMessageSquare} title="Messages">
            <p className="text-sm mb-3" style={{ color: BROWN }}>Message {isCoach ? "your client" : overview.coach_name} directly about this programme.</p>
            <button onClick={() => navigate(`/chat/${latestSession.id}`)} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-bold" style={{ background: GOLD, color: "#14213D" }}>
              <FiMessageSquare size={13} /> Open chat
            </button>
          </Section>
        )}
      </div>
    </div>
  );
}
