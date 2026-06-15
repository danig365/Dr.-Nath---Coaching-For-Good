import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "react-toastify";
import {
  FiMic, FiMicOff, FiVideo, FiVideoOff,
  FiPhoneOff, FiMessageSquare, FiClock, FiSend, FiX,
} from "react-icons/fi";
import { api } from "../utils/auth";
import { useAuth } from "../context/AuthContext";

const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

function formatTime(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export default function SessionCallPage() {
  const { bookingId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [booking, setBooking] = useState(null);
  const [callState, setCallState] = useState("idle"); // idle | connecting | connected | ended
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [remoteStream, setRemoteStream] = useState(null);
  const [timeLeft, setTimeLeft] = useState(null);
  const [loading, setLoading] = useState(true);

  // In-call chat
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [unreadChat, setUnreadChat] = useState(0);
  const chatEndRef = useRef(null);
  const chatOpenRef = useRef(false);

  const wsRef = useRef(null);
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const timerRef = useRef(null);
  const callStartRef = useRef(null);
  const durationRef = useRef(null);
  // Prevent re-sending ready acknowledgement in a loop
  const readyAckSentRef = useRef(false);

  // ── Fetch booking ──────────────────────────────────────────────────────────
  useEffect(() => {
    api.get(`/bookings/${bookingId}/`)
      .then(res => {
        if (!["accepted"].includes(res.data.status)) {
          toast.error("This session is not active.");
          navigate(-1);
          return;
        }
        const sessionEnd = new Date(
          new Date(`${res.data.session_date}T${res.data.session_time}`).getTime() +
          res.data.duration * 60 * 1000
        );
        if (sessionEnd < new Date()) {
          toast.error("This session's time has already passed.");
          navigate(-1);
          return;
        }
        setBooking(res.data);
        durationRef.current = res.data.duration * 60;
        setTimeLeft(res.data.duration * 60);
      })
      .catch(() => { toast.error("Could not load session."); navigate(-1); })
      .finally(() => setLoading(false));
  }, [bookingId, navigate]);

  // ── Cleanup ────────────────────────────────────────────────────────────────
  const cleanup = useCallback(() => {
    clearInterval(timerRef.current);
    if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    setRemoteStream(null);
  }, []);

  const finishSession = useCallback(async (reason) => {
    cleanup();
    setCallState("ended");

    if (reason === "timeout") toast.info("Session time is up.");
    else if (reason === "partner_left") toast.info("The other participant has left.");

    try { await api.patch(`/bookings/${bookingId}/complete/`); } catch (_) {}

    setTimeout(() => navigate(`/chat/${bookingId}`), 1800);
  }, [cleanup, bookingId, navigate]);

  // ── Signaling ──────────────────────────────────────────────────────────────
  const sendSignal = useCallback((signal) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "signal", signal }));
    }
  }, []);

  const startTimer = useCallback(() => {
    callStartRef.current = Date.now();
    const total = durationRef.current;
    timerRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - callStartRef.current) / 1000);
      const remaining = total - elapsed;
      setTimeLeft(remaining);
      if (remaining <= 0) finishSession("timeout");
    }, 1000);
  }, [finishSession]);

  const buildPC = useCallback(() => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    pc.onicecandidate = (e) => {
      if (e.candidate) sendSignal({ type: "ice-candidate", candidate: e.candidate });
    };

    pc.ontrack = (e) => setRemoteStream(e.streams[0]);

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        setCallState("connected");
        startTimer();
      } else if (["disconnected", "failed", "closed"].includes(pc.connectionState)) {
        finishSession("partner_left");
      }
    };

    pcRef.current = pc;
    return pc;
  }, [sendSignal, startTimer, finishSession]);

  // ── WebSocket ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!booking) return;

    const tokens = JSON.parse(localStorage.getItem("authTokens"));
    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${wsProto}//${window.location.host}/ws/chat/${bookingId}/?token=${tokens?.access}`);
    wsRef.current = ws;

    // The mentor (coach) of THIS booking is always the offer initiator.
    const isInitiator = booking.mentor_username === user?.username;

    ws.onmessage = async (e) => {
      const msg = JSON.parse(e.data);

      // Chat messages have no "signal" wrapper — they carry content/sender.
      if (msg.type !== "signal") {
        if (msg.content && msg.sender !== undefined) {
          setChatMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg]);
          if (msg.sender !== user?.user_id && !chatOpenRef.current) {
            setUnreadChat(c => c + 1);
          }
        }
        return;
      }
      const signal = msg.signal;

      if (signal.type === "ready") {
        // Other participant is in the room.
        // Echo ready back once so a late-joiner can trigger the coach.
        if (!readyAckSentRef.current && localStreamRef.current) {
          readyAckSentRef.current = true;
          sendSignal({ type: "ready" });
        }
        // Coach is always the offer initiator — create offer when the other side is ready.
        if (isInitiator && localStreamRef.current && !pcRef.current) {
          const pc = buildPC();
          localStreamRef.current.getTracks().forEach(track => pc.addTrack(track, localStreamRef.current));
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          sendSignal({ type: "offer", sdp: pc.localDescription });
        }

      } else if (signal.type === "offer") {
        // Client receives offer from coach.
        if (pcRef.current) return;
        const pc = buildPC();
        localStreamRef.current?.getTracks().forEach(track => pc.addTrack(track, localStreamRef.current));
        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendSignal({ type: "answer", sdp: pc.localDescription });

      } else if (signal.type === "answer") {
        await pcRef.current?.setRemoteDescription(new RTCSessionDescription(signal.sdp));

      } else if (signal.type === "ice-candidate") {
        try { await pcRef.current?.addIceCandidate(new RTCIceCandidate(signal.candidate)); }
        catch (_) {}

      } else if (signal.type === "end-call") {
        finishSession("partner_left");
      }
    };

    return () => { ws.close(); wsRef.current = null; };
  }, [booking, bookingId, buildPC, sendSignal, finishSession, user]);

  // ── Join — get media and announce presence ─────────────────────────────────
  const handleJoin = useCallback(async () => {
    try {
      setCallState("connecting");
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      // Tell the other side we're here. Coach will send offer upon receiving this.
      readyAckSentRef.current = false; // allow one ack response
      sendSignal({ type: "ready" });
    } catch {
      toast.error("Could not access camera or microphone.");
      setCallState("idle");
    }
  }, [sendSignal]);

  const handleEndCall = useCallback(() => {
    sendSignal({ type: "end-call" });
    finishSession("manual");
  }, [sendSignal, finishSession]);

  // ── Chat ───────────────────────────────────────────────────────────────────
  // Load message history once we have the booking
  useEffect(() => {
    if (!booking) return;
    api.get(`/messages/?booking=${bookingId}`)
      .then(res => {
        const list = Array.isArray(res.data) ? res.data : (res.data.results ?? []);
        setChatMessages(list.map(m => ({
          id: m.id,
          content: m.content,
          sender: m.sender,
          sender_username: m.sender_username,
          timestamp: m.timestamp,
        })));
      })
      .catch(() => {});
  }, [booking, bookingId]);

  const sendChat = useCallback((e) => {
    e?.preventDefault();
    const text = chatInput.trim();
    const ws = wsRef.current;
    if (!text || ws?.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "chat", content: text }));
    setChatInput("");
  }, [chatInput]);

  // Auto-scroll chat to bottom on new message
  useEffect(() => {
    if (chatOpen) chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, chatOpen]);

  // Keep ref in sync so onmessage can read it without stale closures
  useEffect(() => { chatOpenRef.current = chatOpen; }, [chatOpen]);

  // Clear unread badge when chat panel opens
  useEffect(() => {
    if (chatOpen) setUnreadChat(0);
  }, [chatOpen]);

  // ── Attach remote stream to video element ──────────────────────────────────
  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  // ── Cleanup on unmount ─────────────────────────────────────────────────────
  useEffect(() => () => {
    clearInterval(timerRef.current);
    pcRef.current?.close();
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    wsRef.current?.close();
  }, []);

  const toggleMic = () => {
    localStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = !micOn; });
    setMicOn(v => !v);
  };

  const toggleCam = () => {
    localStreamRef.current?.getVideoTracks().forEach(t => { t.enabled = !camOn; });
    setCamOn(v => !v);
  };

  const isTimeLow = timeLeft !== null && timeLeft <= 300;
  const inCall = callState === "connecting" || callState === "connected";

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen" style={{ background: "#0D0D0D" }}>
      <div className="w-10 h-10 rounded-full border-2 animate-spin" style={{ borderColor: "#C8A951", borderTopColor: "transparent" }} />
    </div>
  );

  return (
    <div className="fixed inset-x-0 bottom-0 flex flex-col select-none overflow-hidden" style={{ top: "5rem", background: "#0D0D0D" }}>

      {/* Remote video — full-bleed background filling the call area exactly */}
      <video
        ref={remoteVideoRef}
        autoPlay playsInline
        className="absolute inset-0 w-full h-full object-cover z-0"
        style={{ display: remoteStream ? "block" : "none", background: "#0D0D0D" }}
      />

      {/* ── Top bar ───────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 py-4 z-20 shrink-0" style={{ background: "rgba(0,0,0,0.7)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        {/* Session info */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold shrink-0" style={{ background: "#C8A951", color: "#14213D" }}>
            {booking?.skill_title?.charAt(0)}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#C8A951" }}>Session</p>
            <p className="text-sm font-bold text-white leading-tight">{booking?.skill_title}</p>
          </div>
        </div>

        {/* Timer — only visible once in call. Shows elapsed + remaining. */}
        {inCall && timeLeft !== null && (
          <div className="flex items-center gap-6">
            {/* Elapsed */}
            <div className="text-center">
              <p className="text-xs font-semibold uppercase tracking-widest mb-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>
                Elapsed
              </p>
              <p className="text-2xl font-bold tabular-nums text-white" style={{ fontFamily: "'Playfair Display', serif" }}>
                {formatTime((durationRef.current ?? 0) - timeLeft)}
              </p>
            </div>
            <div className="w-px h-8" style={{ background: "rgba(255,255,255,0.15)" }} />
            {/* Remaining */}
            <div className="text-center">
              <p className="text-xs font-semibold uppercase tracking-widest mb-0.5" style={{ color: isTimeLow ? "#F87171" : "rgba(255,255,255,0.4)" }}>
                {callState === "connecting" ? "Connecting…" : "Time Left"}
              </p>
              <p
                className="text-2xl font-bold tabular-nums"
                style={{ fontFamily: "'Playfair Display', serif", color: isTimeLow ? "#F87171" : "white" }}
              >
                {formatTime(timeLeft)}
              </p>
            </div>
          </div>
        )}

        {/* Duration badge */}
        <span className="text-xs font-semibold px-3 py-1.5 rounded-full" style={{ background: "rgba(200,169,81,0.12)", color: "#C8A951", border: "1px solid rgba(200,169,81,0.25)" }}>
          {booking?.duration} min
        </span>
      </div>

      {/* ── Video area ────────────────────────────────────────── */}
      <div className="flex-1 relative overflow-hidden z-10">

        {/* Idle — pre-join lobby */}
        {callState === "idle" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
            <motion.div
              className="w-28 h-28 rounded-full flex items-center justify-center text-5xl font-bold mb-6 shadow-2xl"
              style={{ background: "linear-gradient(135deg,#C8A951,#F0D98C)", color: "#14213D" }}
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 200 }}
            >
              {booking?.skill_title?.charAt(0)}
            </motion.div>
            <h1 className="text-4xl font-normal text-white mb-2" style={{ fontFamily: "'Playfair Display', serif" }}>
              {booking?.skill_title}
            </h1>
            <p className="text-sm mb-1" style={{ color: "rgba(255,255,255,0.5)" }}>
              {booking?.duration}-minute coaching session
            </p>
            <p className="text-xs mb-10" style={{ color: "rgba(255,255,255,0.3)" }}>
              Timer starts when both participants connect
            </p>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.97 }}
              onClick={handleJoin}
              className="flex items-center gap-3 px-10 py-4 rounded-full text-base font-bold shadow-lg"
              style={{ background: "linear-gradient(135deg,#C8A951,#F0D98C)", color: "#14213D" }}
            >
              <FiVideo size={20} />
              Join Session
            </motion.button>
          </div>
        )}

        {/* Connecting — waiting for partner */}
        {callState === "connecting" && !remoteStream && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
            <div className="w-20 h-20 rounded-full mb-5 flex items-center justify-center text-3xl font-bold" style={{ background: "#C8A951", color: "#14213D" }}>
              {booking?.skill_title?.charAt(0)}
            </div>
            <p className="text-white font-semibold mb-3 text-lg">Waiting for the other participant…</p>
            <div className="flex gap-2 justify-center">
              {[0, 1, 2].map(i => (
                <div key={i} className="w-2.5 h-2.5 rounded-full animate-bounce" style={{ background: "#C8A951", animationDelay: `${i * 0.18}s` }} />
              ))}
            </div>
          </div>
        )}

        {/* Session ended */}
        {callState === "ended" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
              <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: "rgba(200,169,81,0.15)", border: "1px solid rgba(200,169,81,0.3)" }}>
                <FiClock size={32} style={{ color: "#C8A951" }} />
              </div>
              <p className="text-3xl font-normal text-white mb-2" style={{ fontFamily: "'Playfair Display', serif" }}>Session Ended</p>
              <p className="text-sm" style={{ color: "rgba(255,255,255,0.4)" }}>Redirecting to session chat…</p>
            </motion.div>
          </div>
        )}

        {/* Local video PiP */}
        {inCall && (
          <video
            ref={localVideoRef}
            autoPlay playsInline muted
            className="absolute bottom-24 right-4 rounded-2xl object-cover shadow-2xl z-10"
            style={{ width: 168, height: 126, border: "2px solid rgba(255,255,255,0.15)" }}
          />
        )}

        {/* Low time warning */}
        <AnimatePresence>
          {isTimeLow && timeLeft > 0 && callState === "connected" && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="absolute top-4 left-1/2 -translate-x-1/2 z-20 px-5 py-2.5 rounded-xl flex items-center gap-2"
              style={{ background: "rgba(239,68,68,0.92)", backdropFilter: "blur(8px)" }}
            >
              <FiClock size={14} className="text-white" />
              <span className="text-white text-sm font-bold">{formatTime(timeLeft)} remaining</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Controls bar ─────────────────────────────────────── */}
      {inCall && (
        <div className="flex items-center justify-center gap-5 py-5 z-20 shrink-0 relative" style={{ background: "rgba(0,0,0,0.75)", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <button
            onClick={toggleMic}
            className="w-12 h-12 rounded-full flex items-center justify-center transition-all"
            style={{ background: micOn ? "rgba(255,255,255,0.1)" : "#EF4444" }}
            title={micOn ? "Mute microphone" : "Unmute microphone"}
          >
            {micOn ? <FiMic size={18} className="text-white" /> : <FiMicOff size={18} className="text-white" />}
          </button>

          <button
            onClick={handleEndCall}
            className="w-16 h-16 rounded-full flex items-center justify-center shadow-xl transition-transform hover:scale-105"
            style={{ background: "#EF4444" }}
            title="End session"
          >
            <FiPhoneOff size={22} className="text-white" />
          </button>

          <button
            onClick={toggleCam}
            className="w-12 h-12 rounded-full flex items-center justify-center transition-all"
            style={{ background: camOn ? "rgba(255,255,255,0.1)" : "#EF4444" }}
            title={camOn ? "Turn off camera" : "Turn on camera"}
          >
            {camOn ? <FiVideo size={18} className="text-white" /> : <FiVideoOff size={18} className="text-white" />}
          </button>

          {/* Chat toggle — opens in-call chat panel without leaving the call */}
          <button
            onClick={() => setChatOpen(o => !o)}
            className="absolute right-6 w-11 h-11 rounded-full flex items-center justify-center transition-all hover:scale-105"
            style={{
              background: chatOpen ? "#C8A951" : "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.12)",
            }}
            title="Toggle session chat"
          >
            <FiMessageSquare size={16} style={{ color: chatOpen ? "#14213D" : "white" }} />
            {unreadChat > 0 && !chatOpen && (
              <span
                className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-[10px] font-bold px-1"
                style={{ background: "#EF4444", color: "white" }}
              >
                {unreadChat > 99 ? "99+" : unreadChat}
              </span>
            )}
          </button>
        </div>
      )}

      {/* ── In-call chat panel ───────────────────────────────────── */}
      <AnimatePresence>
        {inCall && chatOpen && (
          <motion.div
            initial={{ x: 340, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 340, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
            className="absolute top-0 right-0 bottom-0 w-full max-w-sm z-30 flex flex-col"
            style={{ background: "rgba(13,13,13,0.96)", backdropFilter: "blur(10px)", borderLeft: "1px solid rgba(255,255,255,0.08)" }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
              <div className="flex items-center gap-2">
                <FiMessageSquare size={16} style={{ color: "#C8A951" }} />
                <span className="text-sm font-bold text-white">Session Chat</span>
              </div>
              <button onClick={() => setChatOpen(false)} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors">
                <FiX size={16} className="text-white" />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {chatMessages.length === 0 && (
                <p className="text-center text-xs mt-8" style={{ color: "rgba(255,255,255,0.35)" }}>
                  No messages yet. Say hello 👋
                </p>
              )}
              {chatMessages.map(m => {
                const mine = m.sender === user?.user_id;
                return (
                  <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <div
                      className="max-w-[80%] px-3.5 py-2 rounded-2xl text-sm"
                      style={{
                        background: mine ? "linear-gradient(135deg,#C8A951,#F0D98C)" : "rgba(255,255,255,0.08)",
                        color: mine ? "#14213D" : "white",
                        borderBottomRightRadius: mine ? 4 : 16,
                        borderBottomLeftRadius: mine ? 16 : 4,
                      }}
                    >
                      {!mine && <p className="text-[10px] font-bold mb-0.5" style={{ color: "#C8A951" }}>{m.sender_username}</p>}
                      <p className="leading-snug break-words">{m.content}</p>
                    </div>
                  </div>
                );
              })}
              <div ref={chatEndRef} />
            </div>

            {/* Input */}
            <form onSubmit={sendChat} className="flex items-center gap-2 px-4 py-3 shrink-0" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
              <input
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                placeholder="Type a message…"
                className="flex-1 px-4 py-2.5 rounded-full text-sm text-white outline-none"
                style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)" }}
              />
              <button
                type="submit"
                disabled={!chatInput.trim()}
                className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-all disabled:opacity-40"
                style={{ background: "linear-gradient(135deg,#C8A951,#F0D98C)" }}
              >
                <FiSend size={16} style={{ color: "#14213D" }} />
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
