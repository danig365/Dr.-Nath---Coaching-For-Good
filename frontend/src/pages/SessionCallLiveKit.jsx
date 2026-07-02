import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "react-toastify";
import {
  FiMic, FiMicOff, FiVideo, FiVideoOff,
  FiPhoneOff, FiMessageSquare, FiClock, FiSend, FiX, FiPaperclip, FiDownload, FiFile,
} from "react-icons/fi";
import { Room, RoomEvent, Track } from "livekit-client";
import { api } from "../utils/auth";
import { MAX_UPLOAD_BYTES, formatBytes, isImageType } from "../utils/chatAttachments";
import { useAuth } from "../context/AuthContext";
import { getBookingCallToken } from "../utils/livekit";
import BackgroundPicker from "../components/BackgroundPicker";
import { applyBackground, getLocalVideoTrack } from "../utils/videoBackground";
import { SESSION_GRACE_MS } from "../utils/sessionTiming";

function formatTime(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export default function SessionCallLiveKit() {
  const { bookingId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [booking, setBooking] = useState(null);
  const [callState, setCallState] = useState("idle"); // idle | connecting | connected | ended
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [hasRemoteVideo, setHasRemoteVideo] = useState(false);
  const [timeLeft, setTimeLeft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [bgOption, setBgOption] = useState("none");
  const [bgBusy, setBgBusy] = useState(false);

  // In-call chat (persisted, reuses the existing ws/chat socket)
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [unreadChat, setUnreadChat] = useState(0);
  const [chatFile, setChatFile] = useState(null);
  const [chatUploading, setChatUploading] = useState(false);
  const chatEndRef = useRef(null);
  const chatOpenRef = useRef(false);
  const chatWsRef = useRef(null);
  const chatFileInputRef = useRef(null);

  const roomRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const timerRef = useRef(null);
  const endRef = useRef(null);   // effective end (ms epoch) — adjusts on connect
  const capRef = useRef(null);   // hard cap: scheduled end + grace
  const durationRef = useRef(null);
  const timerStartedRef = useRef(false);
  const connectedRef = useRef(false); // both sides present (set once)

  // ── Fetch booking ──────────────────────────────────────────────────────────
  useEffect(() => {
    api.get(`/bookings/${bookingId}/`)
      .then(res => {
        if (!["accepted"].includes(res.data.status)) {
          toast.error("This session is not active.");
          navigate(-1);
          return;
        }
        // Use the slot's absolute UTC end (converted to local by Date). Fall back
        // to session_date/time treated as UTC (append "Z") for legacy bookings.
        const sessionEnd = new Date(
          res.data.slot_end
            ? new Date(res.data.slot_end).getTime()
            : new Date(`${res.data.session_date}T${res.data.session_time}Z`).getTime() +
              res.data.duration * 60 * 1000
        );
        if (sessionEnd.getTime() + SESSION_GRACE_MS < Date.now()) {
          toast.error("This session's time has already passed.");
          navigate(-1);
          return;
        }
        setBooking(res.data);
        durationRef.current = res.data.duration * 60;
        capRef.current = sessionEnd.getTime() + SESSION_GRACE_MS;
        setTimeLeft(res.data.duration * 60);
      })
      .catch(() => { toast.error("Could not load session."); navigate(-1); })
      .finally(() => setLoading(false));
  }, [bookingId, navigate]);

  // ── Cleanup ────────────────────────────────────────────────────────────────
  const cleanup = useCallback(() => {
    clearInterval(timerRef.current);
    if (roomRef.current) { try { roomRef.current.disconnect(); } catch { /* noop */ } roomRef.current = null; }
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    setHasRemoteVideo(false);
  }, []);

  const finishSession = useCallback(async (reason) => {
    cleanup();
    setCallState("ended");
    if (reason === "timeout") toast.info("Session time is up.");
    else if (reason === "partner_left") toast.info("The other participant has left.");
    try { await api.patch(`/bookings/${bookingId}/complete/`); } catch { /* noop */ }
    setTimeout(() => navigate(`/chat/${bookingId}`), 1800);
  }, [cleanup, bookingId, navigate]);

  const startTimer = useCallback(() => {
    if (timerStartedRef.current) return;
    timerStartedRef.current = true;
    // Until the other side connects, the end is the no-show cap (scheduled end +
    // grace). Once both are present we extend to a full booked duration from the
    // actual start — still capped — so a slightly late start keeps full time.
    endRef.current = capRef.current;
    timerRef.current = setInterval(() => {
      const remaining = Math.floor((endRef.current - Date.now()) / 1000);
      setTimeLeft(Math.min(durationRef.current, remaining));
      if (remaining <= 0) finishSession("timeout");
    }, 1000);
  }, [finishSession]);

  // ── Join — connect to the LiveKit room and publish media ────────────────────
  const handleJoin = useCallback(async () => {
    try {
      setCallState("connecting");
      const { url, token } = await getBookingCallToken(bookingId);

      const room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;

      // Remote media — attach video/audio as tracks are subscribed.
      room
        .on(RoomEvent.TrackSubscribed, (track) => {
          if (track.kind === Track.Kind.Video) {
            track.attach(remoteVideoRef.current);
            setHasRemoteVideo(true);
            setCallState("connected");
            // First time both are present: give a full booked duration from now,
            // capped at the grace. Set once so a later cam re-enable can't extend it.
            if (!connectedRef.current) {
              connectedRef.current = true;
              endRef.current = Math.min(Date.now() + durationRef.current * 1000, capRef.current);
            }
          } else if (track.kind === Track.Kind.Audio) {
            track.attach(remoteAudioRef.current);
          }
        })
        .on(RoomEvent.TrackUnsubscribed, (track) => {
          track.detach();
          if (track.kind === Track.Kind.Video) setHasRemoteVideo(false);
        })
        .on(RoomEvent.ParticipantDisconnected, () => finishSession("partner_left"))
        .on(RoomEvent.Disconnected, () => { /* self disconnect handled by finishSession */ });

      await room.connect(url, token);
      await room.localParticipant.setCameraEnabled(true);
      await room.localParticipant.setMicrophoneEnabled(true);

      // Local preview.
      const camPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
      camPub?.track?.attach(localVideoRef.current);

      // Start the scheduled-session clock as soon as we're in — it auto-ends at
      // the booked end time regardless of whether the other side joins.
      startTimer();
    } catch (err) {
      const detail = err?.response?.data?.detail;
      toast.error(detail || "Could not join the call. Check camera/microphone access.");
      cleanup();
      setCallState("idle");
    }
  }, [bookingId, startTimer, finishSession, cleanup]);

  const handleEndCall = useCallback(() => { finishSession("manual"); }, [finishSession]);

  // ── Chat (persisted via the existing ws/chat socket) ────────────────────────
  useEffect(() => {
    if (!booking) return;
    api.get(`/messages/?booking=${bookingId}`)
      .then(res => {
        const list = Array.isArray(res.data) ? res.data : (res.data.results ?? []);
        setChatMessages(list.map(m => ({
          id: m.id, content: m.content, sender: m.sender,
          sender_username: m.sender_username, timestamp: m.timestamp,
          attachment_url: m.attachment_url, attachment_name: m.attachment_name,
          attachment_size: m.attachment_size, content_type: m.content_type,
        })));
      })
      .catch(() => {});

    const tokens = JSON.parse(localStorage.getItem("authTokens"));
    const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${wsProto}//${window.location.host}/ws/chat/${bookingId}/?token=${tokens?.access}`);
    chatWsRef.current = ws;
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "signal") return; // ignore any stray signaling traffic
      if ((msg.content || msg.attachment_url) && msg.sender !== undefined) {
        setChatMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg]);
        if (msg.sender !== user?.user_id && !chatOpenRef.current) setUnreadChat(c => c + 1);
      }
    };
    return () => { ws.close(); chatWsRef.current = null; };
  }, [booking, bookingId, user]);

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
        form.append("booking", Number(bookingId));
        form.append("attachment", chatFile);
        const caption = chatInput.trim();
        if (caption) form.append("content", caption);
        const res = await api.post("/messages/", form, { headers: { "Content-Type": "multipart/form-data" } });
        setChatMessages(prev => prev.some(m => m.id === res.data.id) ? prev : [...prev, res.data]);
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
    ws.send(JSON.stringify({ type: "chat", content: text }));
    setChatInput("");
  }, [chatInput, chatFile, chatUploading, bookingId]);

  useEffect(() => { if (chatOpen) chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages, chatOpen]);
  useEffect(() => { chatOpenRef.current = chatOpen; if (chatOpen) setUnreadChat(0); }, [chatOpen]);

  // ── Cleanup on unmount ──────────────────────────────────────────────────────
  useEffect(() => () => {
    clearInterval(timerRef.current);
    try { roomRef.current?.disconnect(); } catch { /* noop */ }
    chatWsRef.current?.close();
  }, []);

  const toggleMic = async () => {
    const next = !micOn;
    try { await roomRef.current?.localParticipant.setMicrophoneEnabled(next); setMicOn(next); }
    catch { /* noop */ }
  };

  const toggleCam = async () => {
    const next = !camOn;
    try {
      await roomRef.current?.localParticipant.setCameraEnabled(next);
      setCamOn(next);
      if (next) {
        const camPub = roomRef.current?.localParticipant.getTrackPublication(Track.Source.Camera);
        camPub?.track?.attach(localVideoRef.current);
        // A fresh track is created on re-enable — re-apply the chosen background.
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

  const isTimeLow = timeLeft !== null && timeLeft <= 300;
  const inCall = callState === "connecting" || callState === "connected";

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen" style={{ background: "#0D0D0D" }}>
      <div className="w-10 h-10 rounded-full border-2 animate-spin" style={{ borderColor: "#C8A951", borderTopColor: "transparent" }} />
    </div>
  );

  return (
    <div className="fixed inset-x-0 bottom-0 flex flex-col select-none overflow-hidden" style={{ top: "7rem", background: "#0D0D0D" }}>

      {/* Remote video — full-bleed background */}
      <video
        ref={remoteVideoRef}
        autoPlay playsInline
        className="absolute inset-0 w-full h-full object-cover z-0"
        style={{ display: hasRemoteVideo ? "block" : "none", background: "#0D0D0D" }}
      />
      {/* Remote audio (hidden) */}
      <audio ref={remoteAudioRef} autoPlay />

      {/* ── Top bar ───────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 py-4 z-20 shrink-0" style={{ background: "rgba(0,0,0,0.7)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold shrink-0" style={{ background: "#C8A951", color: "#14213D" }}>
            {booking?.skill_title?.charAt(0)}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#C8A951" }}>Session</p>
            <p className="text-sm font-bold text-white leading-tight">{booking?.skill_title}</p>
          </div>
        </div>

        {inCall && timeLeft !== null && (
          <div className="flex items-center gap-6">
            <div className="text-center">
              <p className="text-xs font-semibold uppercase tracking-widest mb-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>Elapsed</p>
              <p className="text-2xl font-bold tabular-nums text-white" style={{ fontFamily: "'Playfair Display', serif" }}>
                {formatTime((durationRef.current ?? 0) - timeLeft)}
              </p>
            </div>
            <div className="w-px h-8" style={{ background: "rgba(255,255,255,0.15)" }} />
            <div className="text-center">
              <p className="text-xs font-semibold uppercase tracking-widest mb-0.5" style={{ color: isTimeLow ? "#F87171" : "rgba(255,255,255,0.4)" }}>
                {callState === "connecting" ? "Connecting…" : "Time Left"}
              </p>
              <p className="text-2xl font-bold tabular-nums" style={{ fontFamily: "'Playfair Display', serif", color: isTimeLow ? "#F87171" : "white" }}>
                {formatTime(timeLeft)}
              </p>
            </div>
          </div>
        )}

        <span className="text-xs font-semibold px-3 py-1.5 rounded-full" style={{ background: "rgba(200,169,81,0.12)", color: "#C8A951", border: "1px solid rgba(200,169,81,0.25)" }}>
          {booking?.duration} min
        </span>
      </div>

      {/* ── Video area ────────────────────────────────────────── */}
      <div className="flex-1 relative overflow-hidden z-10">

        {callState === "idle" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
            <motion.div
              className="w-28 h-28 rounded-full flex items-center justify-center text-5xl font-bold mb-6 shadow-2xl"
              style={{ background: "linear-gradient(135deg,#C8A951,#F0D98C)", color: "#14213D" }}
              initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 200 }}
            >
              {booking?.skill_title?.charAt(0)}
            </motion.div>
            <h1 className="text-4xl font-normal text-white mb-2" style={{ fontFamily: "'Playfair Display', serif" }}>{booking?.skill_title}</h1>
            <p className="text-sm mb-1" style={{ color: "rgba(255,255,255,0.5)" }}>{booking?.duration}-minute coaching session</p>
            <p className="text-xs mb-10" style={{ color: "rgba(255,255,255,0.3)" }}>Timer starts when both participants connect</p>
            <motion.button
              whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.97 }} onClick={handleJoin}
              className="flex items-center gap-3 px-10 py-4 rounded-full text-base font-bold shadow-lg"
              style={{ background: "linear-gradient(135deg,#C8A951,#F0D98C)", color: "#14213D" }}
            >
              <FiVideo size={20} /> Join Session
            </motion.button>
          </div>
        )}

        {callState === "connecting" && !hasRemoteVideo && (
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
            style={{ width: 168, height: 126, border: "2px solid rgba(255,255,255,0.15)", display: camOn ? "block" : "none" }}
          />
        )}

        <AnimatePresence>
          {isTimeLow && timeLeft > 0 && callState === "connected" && (
            <motion.div
              initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
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
          <button onClick={toggleMic} className="w-12 h-12 rounded-full flex items-center justify-center transition-all" style={{ background: micOn ? "rgba(255,255,255,0.1)" : "#EF4444" }} title={micOn ? "Mute microphone" : "Unmute microphone"}>
            {micOn ? <FiMic size={18} className="text-white" /> : <FiMicOff size={18} className="text-white" />}
          </button>

          <button onClick={handleEndCall} className="w-16 h-16 rounded-full flex items-center justify-center shadow-xl transition-transform hover:scale-105" style={{ background: "#EF4444" }} title="End session">
            <FiPhoneOff size={22} className="text-white" />
          </button>

          <button onClick={toggleCam} className="w-12 h-12 rounded-full flex items-center justify-center transition-all" style={{ background: camOn ? "rgba(255,255,255,0.1)" : "#EF4444" }} title={camOn ? "Turn off camera" : "Turn on camera"}>
            {camOn ? <FiVideo size={18} className="text-white" /> : <FiVideoOff size={18} className="text-white" />}
          </button>

          <BackgroundPicker selected={bgOption} onSelect={changeBackground} busy={bgBusy} />

          <button
            onClick={() => setChatOpen(o => !o)}
            className="absolute right-6 w-11 h-11 rounded-full flex items-center justify-center transition-all hover:scale-105"
            style={{ background: chatOpen ? "#C8A951" : "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}
            title="Toggle session chat"
          >
            <FiMessageSquare size={16} style={{ color: chatOpen ? "#14213D" : "white" }} />
            {unreadChat > 0 && !chatOpen && (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-[10px] font-bold px-1" style={{ background: "#EF4444", color: "white" }}>
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
            initial={{ x: 340, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 340, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
            className="absolute top-0 right-0 bottom-0 w-full max-w-sm z-30 flex flex-col"
            style={{ background: "rgba(13,13,13,0.96)", backdropFilter: "blur(10px)", borderLeft: "1px solid rgba(255,255,255,0.08)" }}
          >
            <div className="flex items-center justify-between px-5 py-4 shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
              <div className="flex items-center gap-2">
                <FiMessageSquare size={16} style={{ color: "#C8A951" }} />
                <span className="text-sm font-bold text-white">Session Chat</span>
              </div>
              <button onClick={() => setChatOpen(false)} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors">
                <FiX size={16} className="text-white" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {chatMessages.length === 0 && (
                <p className="text-center text-xs mt-8" style={{ color: "rgba(255,255,255,0.35)" }}>No messages yet. Say hello 👋</p>
              )}
              {chatMessages.map(m => {
                const mine = m.sender === user?.user_id;
                return (
                  <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <div className="max-w-[80%] px-3.5 py-2 rounded-2xl text-sm" style={{
                      background: mine ? "linear-gradient(135deg,#C8A951,#F0D98C)" : "rgba(255,255,255,0.08)",
                      color: mine ? "#14213D" : "white",
                      borderBottomRightRadius: mine ? 4 : 16, borderBottomLeftRadius: mine ? 16 : 4,
                    }}>
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
                <input
                  value={chatInput} onChange={e => setChatInput(e.target.value)}
                  placeholder={chatFile ? "Add a caption (optional)…" : "Type a message…"}
                  disabled={chatUploading}
                  className="flex-1 px-4 py-2.5 rounded-full text-sm text-white outline-none disabled:opacity-50"
                  style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)" }}
                />
                <button type="submit" disabled={chatUploading || (!chatInput.trim() && !chatFile)}
                  className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-all disabled:opacity-40"
                  style={{ background: "linear-gradient(135deg,#C8A951,#F0D98C)" }}>
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
