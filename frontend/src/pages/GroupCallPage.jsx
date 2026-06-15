import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "react-toastify";
import {
  FiMic, FiMicOff, FiVideo, FiVideoOff,
  FiPhoneOff, FiMessageSquare, FiClock, FiSend, FiX, FiUsers,
} from "react-icons/fi";
import { api } from "../utils/auth";
import { useAuth } from "../context/AuthContext";

const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

const fmt = (s) => {
  const x = Math.max(0, Math.round(s));
  return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;
};

// One remote participant's video tile.
function RemoteTile({ stream, username }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current && stream) ref.current.srcObject = stream; }, [stream]);
  return (
    <div className="relative rounded-2xl overflow-hidden bg-black" style={{ border: "1px solid rgba(255,255,255,0.1)" }}>
      <video ref={ref} autoPlay playsInline className="w-full h-full object-cover" />
      <span className="absolute bottom-2 left-2 px-2 py-0.5 rounded-md text-xs font-semibold text-white" style={{ background: "rgba(0,0,0,0.55)" }}>
        {username || "Participant"}
      </span>
    </div>
  );
}

export default function GroupCallPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isCoach, user } = useAuth();

  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [callState, setCallState] = useState("idle"); // idle | connecting | connected | ended
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [remoteStreams, setRemoteStreams] = useState({}); // peerId -> { stream, username }
  const [timeLeft, setTimeLeft] = useState(null);

  const [chatOpen, setChatOpen] = useState(false);
  const [chat, setChat] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [unread, setUnread] = useState(0);

  const wsRef = useRef(null);
  const chatWsRef = useRef(null);       // persisted group-chat socket
  const peersRef = useRef(new Map());   // peerId -> RTCPeerConnection
  const localStreamRef = useRef(null);
  const localVideoRef = useRef(null);
  const timerRef = useRef(null);
  const chatEndRef = useRef(null);
  const chatOpenRef = useRef(false);
  const endRef = useRef(null);

  // ── Load session details (coach list vs client enrolments) ──────────────────
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
        if (new Date(found.end_datetime) < new Date()) { toast.error("This session has already ended."); navigate(-1); return; }
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

  const sendSignal = useCallback((target, signal) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "signal", target, signal }));
  }, []);

  const removePeer = useCallback((peerId) => {
    const pc = peersRef.current.get(peerId);
    if (pc) { try { pc.close(); } catch { /* noop */ } peersRef.current.delete(peerId); }
    setRemoteStreams((prev) => {
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
  }, []);

  const createPeer = useCallback((peerId, username, initiator) => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pc.onicecandidate = (e) => { if (e.candidate) sendSignal(peerId, { type: "ice-candidate", candidate: e.candidate }); };
    pc.ontrack = (e) => setRemoteStreams((prev) => ({ ...prev, [peerId]: { stream: e.streams[0], username } }));
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") setCallState("connected");
      else if (["failed", "closed", "disconnected"].includes(pc.connectionState)) removePeer(peerId);
    };
    localStreamRef.current?.getTracks().forEach((t) => pc.addTrack(t, localStreamRef.current));
    peersRef.current.set(peerId, pc);
    if (initiator) {
      pc.createOffer()
        .then((o) => pc.setLocalDescription(o))
        .then(() => sendSignal(peerId, { type: "offer", sdp: pc.localDescription }))
        .catch(() => {});
    }
    return pc;
  }, [sendSignal, removePeer]);

  // Persisted group chat (shared with the standalone chat page).
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

  const cleanup = useCallback(() => {
    clearInterval(timerRef.current);
    peersRef.current.forEach((pc) => { try { pc.close(); } catch { /* noop */ } });
    peersRef.current.clear();
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    setRemoteStreams({});
    wsRef.current?.close();
    wsRef.current = null;
    chatWsRef.current?.close();
    chatWsRef.current = null;
  }, []);

  const finishSession = useCallback((reason) => {
    cleanup();
    setCallState("ended");
    if (reason === "timeout") toast.info("Session time is up.");
    setTimeout(() => navigate(isCoach() ? "/my-availability" : "/my-learning"), 1600);
  }, [cleanup, navigate, isCoach]);

  const startTimer = useCallback(() => {
    timerRef.current = setInterval(() => {
      const remaining = Math.floor((endRef.current - Date.now()) / 1000);
      setTimeLeft(remaining);
      if (remaining <= 0) finishSession("timeout");
    }, 1000);
  }, [finishSession]);

  // ── Join: media + WebSocket + mesh signaling ────────────────────────────────
  const handleJoin = useCallback(async () => {
    try {
      setCallState("connecting");
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;

      const tokens = JSON.parse(localStorage.getItem("authTokens"));
      const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${wsProto}//${window.location.host}/ws/group-call/${id}/?token=${tokens?.access}`);
      wsRef.current = ws;

      ws.onopen = () => ws.send(JSON.stringify({ type: "ready" }));

      ws.onclose = (ev) => {
        if (ev.code === 4429) toast.error("This call is full (max 5 participants).");
        else if (ev.code === 4403) toast.error("You can't join this call right now.");
      };

      ws.onmessage = async (e) => {
        const msg = JSON.parse(e.data);

        if (msg.type === "peer-here") {
          // An existing participant advertised — we initiate the offer to them.
          if (!peersRef.current.has(msg.peer_id)) createPeer(msg.peer_id, msg.username, true);

        } else if (msg.type === "peer-left") {
          removePeer(msg.peer_id);

        } else if (msg.type === "signal") {
          const { peer_id, username, signal } = msg;
          if (signal.type === "offer") {
            let pc = peersRef.current.get(peer_id);
            if (!pc) pc = createPeer(peer_id, username, false);
            await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
            const ans = await pc.createAnswer();
            await pc.setLocalDescription(ans);
            sendSignal(peer_id, { type: "answer", sdp: pc.localDescription });
          } else if (signal.type === "answer") {
            await peersRef.current.get(peer_id)?.setRemoteDescription(new RTCSessionDescription(signal.sdp));
          } else if (signal.type === "ice-candidate") {
            try { await peersRef.current.get(peer_id)?.addIceCandidate(new RTCIceCandidate(signal.candidate)); }
            catch { /* noop */ }
          }
        }
      };

      connectChat();
      startTimer();
    } catch {
      toast.error("Could not access camera or microphone.");
      setCallState("idle");
    }
  }, [id, createPeer, removePeer, sendSignal, startTimer, connectChat]);

  // Send a persisted group-chat message
  const sendChat = useCallback((e) => {
    e?.preventDefault();
    const text = chatInput.trim();
    const ws = chatWsRef.current;
    if (!text || ws?.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ content: text }));
    setChatInput("");
  }, [chatInput]);

  useEffect(() => { chatOpenRef.current = chatOpen; if (chatOpen) setUnread(0); }, [chatOpen]);
  useEffect(() => { if (chatOpen) chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chat, chatOpen]);
  useEffect(() => () => cleanup(), [cleanup]); // unmount cleanup

  const toggleMic = () => { localStreamRef.current?.getAudioTracks().forEach((t) => { t.enabled = !micOn; }); setMicOn((v) => !v); };
  const toggleCam = () => { localStreamRef.current?.getVideoTracks().forEach((t) => { t.enabled = !camOn; }); setCamOn((v) => !v); };

  const inCall = callState === "connecting" || callState === "connected";
  const remotes = Object.entries(remoteStreams);
  const isLow = timeLeft !== null && timeLeft <= 300;
  // tile count = local + remotes → choose grid columns
  const tiles = remotes.length + 1;
  const cols = tiles <= 1 ? 1 : tiles <= 4 ? 2 : 3;

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen" style={{ background: "#0D0D0D" }}>
      <div className="w-10 h-10 rounded-full border-2 animate-spin" style={{ borderColor: "#C8A951", borderTopColor: "transparent" }} />
    </div>
  );

  return (
    <div className="fixed inset-x-0 bottom-0 flex flex-col select-none overflow-hidden" style={{ top: "5rem", background: "#0D0D0D" }}>

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
          {remotes.length + (inCall ? 1 : 0)} in call
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
            <p className="text-xs mb-10" style={{ color: "rgba(255,255,255,0.3)" }}>Up to 5 participants · camera and mic required</p>
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
              <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
              <span className="absolute bottom-2 left-2 px-2 py-0.5 rounded-md text-xs font-semibold text-white" style={{ background: "rgba(0,0,0,0.55)" }}>You</span>
            </div>
            {remotes.map(([peerId, info]) => (
              <RemoteTile key={peerId} stream={info.stream} username={info.username} />
            ))}
            {remotes.length === 0 && (
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
                      <p className="leading-snug break-words">{m.content}</p>
                    </div>
                  </div>
                );
              })}
              <div ref={chatEndRef} />
            </div>
            <form onSubmit={sendChat} className="flex items-center gap-2 px-4 py-3 shrink-0" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
              <input value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder="Type a message…"
                className="flex-1 px-4 py-2.5 rounded-full text-sm text-white outline-none" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)" }} />
              <button type="submit" disabled={!chatInput.trim()} className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 disabled:opacity-40" style={{ background: "linear-gradient(135deg,#C8A951,#F0D98C)" }}>
                <FiSend size={16} style={{ color: "#14213D" }} />
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
