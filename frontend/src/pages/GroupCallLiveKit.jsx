import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "react-toastify";
import {
  FiMic, FiMicOff, FiVideo, FiVideoOff,
  FiPhoneOff, FiMessageSquare, FiClock, FiSend, FiX, FiUsers, FiPaperclip, FiDownload, FiFile,
} from "react-icons/fi";
import { Room, RoomEvent, Track } from "livekit-client";
import { api } from "../utils/auth";
import { MAX_UPLOAD_BYTES, formatBytes, isImageType } from "../utils/chatAttachments";
import { useAuth } from "../context/AuthContext";
import { getGroupCallToken } from "../utils/livekit";
import BackgroundPicker from "../components/BackgroundPicker";
import { applyBackground, getLocalVideoTrack } from "../utils/videoBackground";
import { SESSION_GRACE_MS } from "../utils/sessionTiming";

const fmt = (s) => {
  const x = Math.max(0, Math.round(s));
  return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;
};

// One remote participant's tile — attaches their LiveKit video + audio tracks.
function RemoteTile({ data }) {
  const videoRef = useRef(null);
  const audioRef = useRef(null);
  useEffect(() => {
    const v = data.videoTrack;
    if (v && videoRef.current) { v.attach(videoRef.current); return () => { try { v.detach(videoRef.current); } catch { /* noop */ } }; }
  }, [data.videoTrack]);
  useEffect(() => {
    const a = data.audioTrack;
    if (a && audioRef.current) { a.attach(audioRef.current); return () => { try { a.detach(audioRef.current); } catch { /* noop */ } }; }
  }, [data.audioTrack]);
  return (
    <div className="relative rounded-2xl overflow-hidden bg-black" style={{ border: "1px solid rgba(255,255,255,0.1)" }}>
      <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
      <audio ref={audioRef} autoPlay />
      {!data.videoTrack && (
        <div className="absolute inset-0 flex items-center justify-center" style={{ background: "#14213D" }}>
          <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: "rgba(200,169,81,0.18)" }}>
            <FiVideoOff size={22} style={{ color: "#C8A951" }} />
          </div>
        </div>
      )}
      <span className="absolute bottom-2 left-2 px-2 py-0.5 rounded-md text-xs font-semibold text-white" style={{ background: "rgba(0,0,0,0.55)" }}>
        {data.name || "Participant"}
      </span>
    </div>
  );
}

export default function GroupCallLiveKit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isCoach, user } = useAuth();

  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [callState, setCallState] = useState("idle"); // idle | connecting | connected | ended
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [remotes, setRemotes] = useState({}); // sid -> { name, videoTrack, audioTrack }
  const [timeLeft, setTimeLeft] = useState(null);
  const [bgOption, setBgOption] = useState("none");
  const [bgBusy, setBgBusy] = useState(false);

  const [chatOpen, setChatOpen] = useState(false);
  const [chat, setChat] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [unread, setUnread] = useState(0);
  const [chatFile, setChatFile] = useState(null);
  const [chatUploading, setChatUploading] = useState(false);

  const roomRef = useRef(null);
  const chatWsRef = useRef(null);
  const chatFileInputRef = useRef(null);
  const localVideoRef = useRef(null);
  const timerRef = useRef(null);
  const chatEndRef = useRef(null);
  const chatOpenRef = useRef(false);
  const endRef = useRef(null);

  // ── Load session ────────────────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      try {
        let found = null;
        if (isCoach()) {
          const r = await api.get("/bookings/group-sessions/");
          found = r.data.find((s) => s.id === parseInt(id));
        } else {
          const r = await api.get("/bookings/group-sessions/mine/");
          const e = r.data.find((x) => x.group_session === parseInt(id));
          if (e) found = {
            id: e.group_session, title: e.title, coach_username: e.coach_username,
            start_datetime: e.start_datetime, end_datetime: e.end_datetime, status: e.session_status,
          };
        }
        if (!found) { toast.error("Session not found or you're not enrolled."); navigate(-1); return; }
        if (found.status === "cancelled") { toast.error("This session was cancelled."); navigate(-1); return; }
        if (new Date(found.end_datetime).getTime() + SESSION_GRACE_MS < Date.now()) { toast.error("This session has already ended."); navigate(-1); return; }
        endRef.current = new Date(found.end_datetime).getTime();
        setSession(found);
        setTimeLeft(Math.floor((endRef.current - Date.now()) / 1000));
      } catch {
        toast.error("Could not load session.");
        navigate(-1);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id, isCoach, navigate]);

  // ── Remote participant track bookkeeping ────────────────────────────────────
  const upsertParticipant = useCallback((p) => {
    setRemotes((prev) => ({
      ...prev,
      [p.sid]: { ...(prev[p.sid] || {}), name: p.name || p.identity },
    }));
  }, []);

  const dropParticipant = useCallback((p) => {
    setRemotes((prev) => { const n = { ...prev }; delete n[p.sid]; return n; });
  }, []);

  const setTrack = useCallback((p, track, attach) => {
    setRemotes((prev) => {
      const entry = { ...(prev[p.sid] || { name: p.name || p.identity }) };
      const key = track.kind === Track.Kind.Video ? "videoTrack" : "audioTrack";
      entry[key] = attach ? track : undefined;
      return { ...prev, [p.sid]: entry };
    });
  }, []);

  const cleanup = useCallback(() => {
    clearInterval(timerRef.current);
    if (roomRef.current) { try { roomRef.current.disconnect(); } catch { /* noop */ } roomRef.current = null; }
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    setRemotes({});
    chatWsRef.current?.close();
    chatWsRef.current = null;
  }, []);

  const finishSession = useCallback((reason) => {
    cleanup();
    setCallState("ended");
    if (reason === "timeout") toast.info("Session time is up.");
    setTimeout(() => navigate(isCoach() ? "/my-sessions" : "/my-learning"), 1600);
  }, [cleanup, navigate, isCoach]);

  const startTimer = useCallback(() => {
    timerRef.current = setInterval(() => {
      // Display counts to the scheduled end (shows 00:00 once reached), but the
      // call only force-closes after a grace window past it.
      const remaining = Math.floor((endRef.current - Date.now()) / 1000);
      setTimeLeft(remaining);
      if (Date.now() > endRef.current + SESSION_GRACE_MS) finishSession("timeout");
    }, 1000);
  }, [finishSession]);

  // ── Persisted group chat ────────────────────────────────────────────────────
  const connectChat = useCallback(async () => {
    try {
      const res = await api.get(`/bookings/group-sessions/${id}/messages/`);
      setChat(res.data);
    } catch { /* history is best-effort */ }
    const tokens = JSON.parse(localStorage.getItem("authTokens"));
    const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const cws = new WebSocket(`${wsProto}//${window.location.host}/ws/group-chat/${id}/?token=${tokens?.access}`);
    chatWsRef.current = cws;
    cws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      setChat((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
      if (m.sender !== user?.user_id && !chatOpenRef.current) setUnread((c) => c + 1);
    };
  }, [id, user]);

  // ── Join: connect to the LiveKit room and publish media ─────────────────────
  const handleJoin = useCallback(async () => {
    try {
      setCallState("connecting");
      const { url, token } = await getGroupCallToken(id);

      const room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;

      room
        .on(RoomEvent.ParticipantConnected, (p) => upsertParticipant(p))
        .on(RoomEvent.ParticipantDisconnected, (p) => dropParticipant(p))
        .on(RoomEvent.TrackSubscribed, (track, _pub, p) => setTrack(p, track, true))
        .on(RoomEvent.TrackUnsubscribed, (track, _pub, p) => setTrack(p, track, false))
        .on(RoomEvent.Disconnected, () => { /* handled via finishSession */ });

      await room.connect(url, token);
      await room.localParticipant.setCameraEnabled(true);
      await room.localParticipant.setMicrophoneEnabled(true);

      // Local preview.
      const camPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
      camPub?.track?.attach(localVideoRef.current);

      // Anyone already in the room when we joined.
      room.remoteParticipants.forEach((p) => upsertParticipant(p));

      setCallState("connected");
      connectChat();
      startTimer();
    } catch (err) {
      const detail = err?.response?.data?.detail;
      toast.error(detail || "Could not join the call. Check camera/microphone access.");
      cleanup();
      setCallState("idle");
    }
  }, [id, upsertParticipant, dropParticipant, setTrack, connectChat, startTimer, cleanup]);

  const handleChatFile = useCallback((e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) { toast.error("File exceeds the 50 MB limit."); return; }
    setChatFile(file);
  }, []);

  const sendChat = useCallback(async (e) => {
    e?.preventDefault();
    if (chatUploading) return;

    // Staged file → REST upload (with optional caption); backend broadcasts it.
    if (chatFile) {
      setChatUploading(true);
      try {
        const form = new FormData();
        form.append("attachment", chatFile);
        const caption = chatInput.trim();
        if (caption) form.append("content", caption);
        const res = await api.post(`/bookings/group-sessions/${id}/messages/`, form, { headers: { "Content-Type": "multipart/form-data" } });
        setChat((prev) => (prev.some((x) => x.id === res.data.id) ? prev : [...prev, res.data]));
        setChatFile(null);
        setChatInput("");
      } catch (err) {
        toast.error(err.response?.data?.detail || err.response?.data?.attachment?.[0] || "Failed to send file.");
      } finally {
        setChatUploading(false);
      }
      return;
    }

    const text = chatInput.trim();
    const ws = chatWsRef.current;
    if (!text || ws?.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ content: text }));
    setChatInput("");
  }, [chatInput, chatFile, chatUploading, id]);

  useEffect(() => { chatOpenRef.current = chatOpen; if (chatOpen) setUnread(0); }, [chatOpen]);
  useEffect(() => { if (chatOpen) chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chat, chatOpen]);
  useEffect(() => () => cleanup(), [cleanup]);

  const toggleMic = async () => {
    const next = !micOn;
    try { await roomRef.current?.localParticipant.setMicrophoneEnabled(next); setMicOn(next); } catch { /* noop */ }
  };
  const toggleCam = async () => {
    const next = !camOn;
    try {
      await roomRef.current?.localParticipant.setCameraEnabled(next);
      setCamOn(next);
      if (next) {
        const camPub = roomRef.current?.localParticipant.getTrackPublication(Track.Source.Camera);
        camPub?.track?.attach(localVideoRef.current);
        if (bgOption !== "none") await applyBackground(getLocalVideoTrack(roomRef.current), bgOption);
      }
    } catch { /* noop */ }
  };

  const changeBackground = useCallback(async (optionId) => {
    setBgBusy(true);
    setBgOption(optionId);
    await applyBackground(getLocalVideoTrack(roomRef.current), optionId);
    setBgBusy(false);
  }, []);

  const inCall = callState === "connecting" || callState === "connected";
  const remoteList = Object.entries(remotes);
  const isLow = timeLeft !== null && timeLeft <= 300;
  const tiles = remoteList.length + 1;
  const cols = tiles <= 1 ? 1 : tiles <= 4 ? 2 : 3;

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen" style={{ background: "#0D0D0D" }}>
      <div className="w-10 h-10 rounded-full border-2 animate-spin" style={{ borderColor: "#C8A951", borderTopColor: "transparent" }} />
    </div>
  );

  return (
    <div className="fixed inset-x-0 bottom-0 flex flex-col select-none overflow-hidden" style={{ top: "7rem", background: "#0D0D0D" }}>

      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-4 z-20 shrink-0" style={{ background: "rgba(0,0,0,0.7)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: "#C8A951", color: "#14213D" }}>
            <FiUsers size={16} />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#C8A951" }}>Group Session</p>
            <p className="text-sm font-bold text-white leading-tight">{session?.title}</p>
          </div>
        </div>
        {inCall && timeLeft !== null && (
          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-widest mb-0.5" style={{ color: isLow ? "#F87171" : "rgba(255,255,255,0.4)" }}>Time Left</p>
            <p className="text-2xl font-bold tabular-nums" style={{ fontFamily: "'Playfair Display', serif", color: isLow ? "#F87171" : "white" }}>{fmt(timeLeft)}</p>
          </div>
        )}
        <span className="text-xs font-semibold px-3 py-1.5 rounded-full" style={{ background: "rgba(200,169,81,0.12)", color: "#C8A951", border: "1px solid rgba(200,169,81,0.25)" }}>
          {remoteList.length + (inCall ? 1 : 0)} in call
        </span>
      </div>

      {/* Stage */}
      <div className="flex-1 relative overflow-hidden z-10 p-4">
        {callState === "idle" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
            <motion.div className="w-28 h-28 rounded-full flex items-center justify-center mb-6 shadow-2xl"
              style={{ background: "linear-gradient(135deg,#C8A951,#F0D98C)", color: "#14213D" }}
              initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 200 }}>
              <FiUsers size={42} />
            </motion.div>
            <h1 className="text-4xl font-normal text-white mb-2" style={{ fontFamily: "'Playfair Display', serif" }}>{session?.title}</h1>
            <p className="text-xs mb-10" style={{ color: "rgba(255,255,255,0.3)" }}>Camera and mic required</p>
            <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.97 }} onClick={handleJoin}
              className="flex items-center gap-3 px-10 py-4 rounded-full text-base font-bold shadow-lg"
              style={{ background: "linear-gradient(135deg,#C8A951,#F0D98C)", color: "#14213D" }}>
              <FiVideo size={20} /> Join Call
            </motion.button>
          </div>
        )}

        {callState === "ended" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
              <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: "rgba(200,169,81,0.15)", border: "1px solid rgba(200,169,81,0.3)" }}>
                <FiClock size={32} style={{ color: "#C8A951" }} />
              </div>
              <p className="text-3xl font-normal text-white mb-2" style={{ fontFamily: "'Playfair Display', serif" }}>Call Ended</p>
            </motion.div>
          </div>
        )}

        {inCall && (
          <div className="w-full h-full grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: "1fr" }}>
            {/* Local tile */}
            <div className="relative rounded-2xl overflow-hidden bg-black" style={{ border: "1px solid rgba(200,169,81,0.4)" }}>
              <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" style={{ visibility: camOn ? "visible" : "hidden" }} />
              {!camOn && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2" style={{ background: "#14213D" }}>
                  <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: "rgba(200,169,81,0.18)" }}>
                    <FiVideoOff size={26} style={{ color: "#C8A951" }} />
                  </div>
                  <span className="text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>Camera off</span>
                </div>
              )}
              <div className="absolute bottom-2 left-2 flex items-center gap-1.5">
                <span className="px-2 py-0.5 rounded-md text-xs font-semibold text-white" style={{ background: "rgba(0,0,0,0.55)" }}>You</span>
                {!micOn && (
                  <span className="w-6 h-6 rounded-md flex items-center justify-center" style={{ background: "#EF4444" }}>
                    <FiMicOff size={12} className="text-white" />
                  </span>
                )}
              </div>
            </div>
            {remoteList.map(([sid, data]) => <RemoteTile key={sid} data={data} />)}
            {remoteList.length === 0 && (
              <div className="flex items-center justify-center rounded-2xl" style={{ border: "1px dashed rgba(255,255,255,0.15)" }}>
                <p className="text-sm" style={{ color: "rgba(255,255,255,0.45)" }}>Waiting for others to join…</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Controls */}
      {inCall && (
        <div className="flex items-center justify-center gap-5 py-5 z-20 shrink-0 relative" style={{ background: "rgba(0,0,0,0.75)", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <button onClick={toggleMic} className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: micOn ? "rgba(255,255,255,0.1)" : "#EF4444" }}>
            {micOn ? <FiMic size={18} className="text-white" /> : <FiMicOff size={18} className="text-white" />}
          </button>
          <button onClick={() => finishSession("manual")} className="w-16 h-16 rounded-full flex items-center justify-center shadow-xl hover:scale-105 transition-transform" style={{ background: "#EF4444" }}>
            <FiPhoneOff size={22} className="text-white" />
          </button>
          <button onClick={toggleCam} className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: camOn ? "rgba(255,255,255,0.1)" : "#EF4444" }}>
            {camOn ? <FiVideo size={18} className="text-white" /> : <FiVideoOff size={18} className="text-white" />}
          </button>
          <BackgroundPicker selected={bgOption} onSelect={changeBackground} busy={bgBusy} />
          <button onClick={() => setChatOpen((o) => !o)} className="absolute right-6 w-11 h-11 rounded-full flex items-center justify-center"
            style={{ background: chatOpen ? "#C8A951" : "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}>
            <FiMessageSquare size={16} style={{ color: chatOpen ? "#14213D" : "white" }} />
            {unread > 0 && !chatOpen && (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-[10px] font-bold px-1" style={{ background: "#EF4444", color: "white" }}>
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </button>
        </div>
      )}

      {/* In-call chat */}
      <AnimatePresence>
        {inCall && chatOpen && (
          <motion.div initial={{ x: 340, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 340, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
            className="absolute top-0 right-0 bottom-0 w-full max-w-sm z-30 flex flex-col"
            style={{ background: "rgba(13,13,13,0.96)", backdropFilter: "blur(10px)", borderLeft: "1px solid rgba(255,255,255,0.08)" }}>
            <div className="flex items-center justify-between px-5 py-4 shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
              <div className="flex items-center gap-2"><FiMessageSquare size={16} style={{ color: "#C8A951" }} /><span className="text-sm font-bold text-white">Call Chat</span></div>
              <button onClick={() => setChatOpen(false)} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/10"><FiX size={16} className="text-white" /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {chat.length === 0 && <p className="text-center text-xs mt-8" style={{ color: "rgba(255,255,255,0.35)" }}>No messages yet. Say hello 👋</p>}
              {chat.map((m) => {
                const mine = m.sender === user?.user_id;
                return (
                  <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <div className="max-w-[80%] px-3.5 py-2 rounded-2xl text-sm" style={{ background: mine ? "linear-gradient(135deg,#C8A951,#F0D98C)" : "rgba(255,255,255,0.08)", color: mine ? "#14213D" : "white" }}>
                      {!mine && <p className="text-[10px] font-bold mb-0.5" style={{ color: "#C8A951" }}>{m.sender_username}</p>}
                      {m.attachment_url && (
                        isImageType(m.content_type) ? (
                          <a href={m.attachment_url} target="_blank" rel="noopener noreferrer" className="block mb-1">
                            <img src={m.attachment_url} alt={m.attachment_name || "attachment"} className="rounded-lg max-h-44 w-auto object-cover" />
                          </a>
                        ) : (
                          <a href={m.attachment_url} target="_blank" rel="noopener noreferrer" download={m.attachment_name || true}
                            className="flex items-center gap-2 px-2.5 py-2 rounded-lg mb-1 transition-opacity hover:opacity-80"
                            style={{ background: mine ? "rgba(20,33,61,0.12)" : "rgba(255,255,255,0.1)" }}>
                            <FiFile size={16} className="shrink-0" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-xs font-semibold">{m.attachment_name || "Attachment"}</span>
                              {m.attachment_size != null && <span className="block text-[10px] opacity-60">{formatBytes(m.attachment_size)}</span>}
                            </span>
                            <FiDownload size={13} className="shrink-0 opacity-70" />
                          </a>
                        )
                      )}
                      {m.content && <p className="leading-snug break-words">{m.content}</p>}
                    </div>
                  </div>
                );
              })}
              <div ref={chatEndRef} />
            </div>
            <form onSubmit={sendChat} className="px-4 py-3 shrink-0" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
              {chatFile && (
                <div className="mb-2 flex items-center gap-2 px-2.5 py-1.5 rounded-lg" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}>
                  <FiFile size={14} className="shrink-0" style={{ color: "#C8A951" }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold text-white">{chatFile.name}</span>
                    <span className="block text-[10px]" style={{ color: "rgba(255,255,255,0.5)" }}>{formatBytes(chatFile.size)} · ready to send</span>
                  </span>
                  <button type="button" onClick={() => setChatFile(null)} disabled={chatUploading} title="Remove file"
                    className="text-base leading-none px-1.5 shrink-0 text-white transition-opacity hover:opacity-60 disabled:opacity-30">×</button>
                </div>
              )}
              <div className="flex items-center gap-2">
                <input type="file" ref={chatFileInputRef} onChange={handleChatFile} className="hidden" disabled={chatUploading} />
                <button type="button" onClick={() => chatFileInputRef.current?.click()} disabled={chatUploading} title="Attach a file"
                  className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-all disabled:opacity-40"
                  style={{ background: chatFile ? "rgba(200,169,81,0.25)" : "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)", color: "#C8A951" }}>
                  <FiPaperclip size={16} />
                </button>
                <input value={chatInput} onChange={(e) => setChatInput(e.target.value)}
                  placeholder={chatFile ? "Add a caption (optional)…" : "Type a message…"} disabled={chatUploading}
                  className="flex-1 px-4 py-2.5 rounded-full text-sm text-white outline-none disabled:opacity-50" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)" }} />
                <button type="submit" disabled={chatUploading || (!chatInput.trim() && !chatFile)}
                  className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 disabled:opacity-40" style={{ background: "linear-gradient(135deg,#C8A951,#F0D98C)" }}>
                  {chatUploading
                    ? <div className="w-4 h-4 rounded-full border-2 animate-spin" style={{ borderColor: "#14213D", borderTopColor: "transparent" }} />
                    : <FiSend size={16} style={{ color: "#14213D" }} />
                  }
                </button>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
