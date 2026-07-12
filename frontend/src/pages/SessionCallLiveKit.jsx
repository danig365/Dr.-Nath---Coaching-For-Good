import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "react-toastify";
import {
  FiMic, FiMicOff, FiVideo, FiVideoOff,
  FiPhoneOff, FiMessageSquare, FiClock, FiSend, FiX, FiPaperclip, FiDownload, FiFile,
  FiAlertTriangle, FiRefreshCw, FiFileText,
} from "react-icons/fi";
import { Room, RoomEvent, Track } from "livekit-client";
import { api } from "../utils/auth";
import { MAX_UPLOAD_BYTES, formatBytes, isImageType } from "../utils/chatAttachments";
import { useAuth } from "../context/AuthContext";
import { getBookingCallToken } from "../utils/livekit";
import BackgroundPicker from "../components/BackgroundPicker";
import { applyBackground, getLocalVideoTrack } from "../utils/videoBackground";
import { SESSION_GRACE_MS } from "../utils/sessionTiming";
import { isTranscriptionSupported, createTranscriber, buildTranscriptText } from "../utils/liveTranscribe";

function formatTime(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

// Turn a getUserMedia / device error into plain, actionable guidance a
// non-technical client can follow. They stay connected either way.
function describeMediaError(err) {
  const name = err?.name || "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError")
    return "Your camera & microphone are blocked. Click the camera icon in your browser's address bar, choose “Allow”, then tap Retry.";
  if (name === "NotFoundError" || name === "DevicesNotFoundError")
    return "No camera or microphone was found on this device. You can still see and hear your coach — plug one in and tap Retry to turn yours on.";
  if (name === "NotReadableError" || name === "TrackStartError")
    return "Your camera or microphone is being used by another app (Zoom, Teams, FaceTime…). Close it, then tap Retry.";
  if (name === "NotSupportedError" || (typeof window !== "undefined" && !window.isSecureContext))
    return "This browser is blocking camera access. Please open the session in Chrome or Safari, then tap Retry.";
  return "We couldn't turn on your camera/microphone. You're still connected — check your browser's camera permission and tap Retry.";
}

export default function SessionCallLiveKit() {
  const { bookingId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [booking, setBooking] = useState(null);
  const [callState, setCallState] = useState("idle"); // idle | connecting | connected | ended

  // ── AI note-taking (E7): browser transcribes the local speaker; both sides
  // exchange finalised segments over the LiveKit data channel to build one
  // merged transcript, summarised by AI at session end. ─────────────────────
  // Browser transcription runs on desktop only. On phones the OS plays a
  // "listening" beep each time SpeechRecognition (re)starts, which disturbs the
  // call — so mobile skips LOCAL capture but still receives the other side's
  // segments and gets the summary. AI notes stay ON by default.
  const [aiSupported] = useState(() => isTranscriptionSupported() && !/Mobi|Android|iPhone|iPad|iPod/i.test(
    typeof navigator !== "undefined" ? navigator.userAgent : ""));
  const [aiNotesOn, setAiNotesOn] = useState(true);
  const [showAiBanner, setShowAiBanner] = useState(true);
  const aiNotesOnRef = useRef(true);
  const transcriptRef = useRef([]);        // merged [{speaker, text, ts}]
  const transcriberRef = useRef(null);
  const myLabel = user?.role === "coach" ? "Coach" : "Client";
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [mediaError, setMediaError] = useState(""); // camera/mic couldn't start
  const [previewError, setPreviewError] = useState(""); // lobby camera/mic issue
  const previewRef = useRef(null);       // lobby preview <video>
  const previewStreamRef = useRef(null); // lobby MediaStream
  const camWantRef = useRef(true);       // desired camera state on join
  const micWantRef = useRef(true);       // desired mic state on join
  const [hasRemoteVideo, setHasRemoteVideo] = useState(false);
  const [timeLeft, setTimeLeft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [bgOption, setBgOption] = useState("none");
  const [bgBusy, setBgBusy] = useState(false);
  const [endConfirm, setEndConfirm] = useState(false); // coach's "end early" choice

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
  const localVideoTrackRef = useRef(null);   // current local camera track (for re-attach)
  const remoteVideoTrackRef = useRef(null);  // current remote camera track (for re-attach)
  const timerRef = useRef(null);
  const endRef = useRef(null);   // effective end (ms epoch) — adjusts on connect
  const capRef = useRef(null);   // hard cap: scheduled end + grace
  const scheduledEndRef = useRef(null); // the booked end time (ms epoch), no grace
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
        scheduledEndRef.current = sessionEnd.getTime();
        capRef.current = sessionEnd.getTime() + SESSION_GRACE_MS;
        setTimeLeft(res.data.duration * 60);
      })
      .catch(() => { toast.error("Could not load session."); navigate(-1); })
      .finally(() => setLoading(false));
  }, [bookingId, navigate]);

  // ── Cleanup ────────────────────────────────────────────────────────────────
  const cleanup = useCallback(() => {
    clearInterval(timerRef.current);
    try { transcriberRef.current?.stop(); } catch { /* noop */ }
    if (roomRef.current) { try { roomRef.current.disconnect(); } catch { /* noop */ } roomRef.current = null; }
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    setHasRemoteVideo(false);
  }, []);

  const finishSession = useCallback(async (reason) => {
    cleanup();
    setCallState("ended");
    // Complete the booking when its time is up, OR when the coach deliberately
    // ends it early ("complete"). Merely leaving/dropping while the window is
    // still running does NOT complete it — it stays 'accepted' so either side
    // can rejoin.
    const finish = reason === "timeout" || reason === "complete" ||
      (scheduledEndRef.current != null && Date.now() >= scheduledEndRef.current);
    if (finish) {
      if (reason === "timeout") toast.info("Session time is up.");
      let completed = false;
      try {
        await api.patch(`/bookings/${bookingId}/complete/`,
          reason === "complete" ? { force: true } : {});
        completed = true;
      } catch (err) {
        // A deliberate early end that the server refused (e.g. session not
        // started yet) — tell the coach honestly and keep it open.
        if (reason === "complete") {
          toast.info(err?.response?.data?.detail || "This session can't be completed yet — it stays open.");
          setTimeout(() => navigate("/"), 1600);
          return;
        }
      }
      if (reason === "complete" && completed) toast.success("Session ended — preparing your AI summary…");
      // Best-effort AI summary from the merged transcript (idempotent backend).
      try {
        const text = buildTranscriptText(transcriptRef.current);
        if (aiNotesOnRef.current && text.length >= 40) {
          api.post(`/bookings/${bookingId}/ai-summary/`, { transcript: text }).catch(() => {});
        }
      } catch { /* noop */ }
      setTimeout(() => navigate(`/chat/${bookingId}`), 1800);
    } else {
      toast.info("You've left the session. It stays open — you can rejoin any time before it ends.");
      setTimeout(() => navigate("/"), 1200);
    }
  }, [cleanup, bookingId, navigate]);

  const startTimer = useCallback(() => {
    if (timerStartedRef.current) return;
    timerStartedRef.current = true;
    // The clock starts the moment you join: a full booked duration from now,
    // but never past the scheduled end + grace. Deterministic + identical for
    // both sides, so the timer never sits frozen waiting on the other party.
    endRef.current = Math.min(Date.now() + durationRef.current * 1000, capRef.current);
    timerRef.current = setInterval(() => {
      const remaining = Math.floor((endRef.current - Date.now()) / 1000);
      setTimeLeft(Math.min(durationRef.current, remaining));
      if (remaining <= 0) finishSession("timeout");
    }, 1000);
  }, [finishSession]);

  // ── AI note-taking helpers ──────────────────────────────────────────────
  useEffect(() => { aiNotesOnRef.current = aiNotesOn; }, [aiNotesOn]);

  // Auto-hide the consent banner a few seconds after both sides connect.
  useEffect(() => {
    if (callState !== "connected" || !showAiBanner) return undefined;
    const t = setTimeout(() => setShowAiBanner(false), 9000);
    return () => clearTimeout(t);
  }, [callState, showAiBanner]);

  // A finalised local utterance: record it and broadcast to the other side.
  const handleLocalFinal = useCallback((text) => {
    const seg = { speaker: myLabel, text, ts: Date.now() };
    transcriptRef.current.push(seg);
    const room = roomRef.current;
    if (room?.localParticipant) {
      try {
        const payload = new TextEncoder().encode(JSON.stringify({ t: "sttseg", ...seg }));
        room.localParticipant.publishData(payload, { reliable: true });
      } catch { /* noop */ }
    }
  }, [myLabel]);

  // Run the transcriber while we're in-call, AI notes are on, the mic is live
  // and the browser supports it. Muting the mic pauses transcription.
  useEffect(() => {
    const inCallNow = callState === "connected" || callState === "connecting";
    const shouldRun = inCallNow && aiNotesOn && aiSupported && micOn;
    if (shouldRun) {
      if (!transcriberRef.current) {
        transcriberRef.current = createTranscriber({ onFinal: handleLocalFinal });
      }
      transcriberRef.current.start();
    } else {
      transcriberRef.current?.stop();
    }
  }, [callState, aiNotesOn, aiSupported, micOn, handleLocalFinal]);

  // Keep the video elements bound to their current tracks. Attaching only in the
  // event handlers is fragile (element may not be mounted yet, or React may
  // re-create it) — these re-attach whenever the relevant state changes.
  useEffect(() => {
    if (hasRemoteVideo && remoteVideoTrackRef.current && remoteVideoRef.current) {
      try { remoteVideoTrackRef.current.attach(remoteVideoRef.current); } catch { /* noop */ }
    }
  }, [hasRemoteVideo, callState]);

  useEffect(() => {
    const active = callState === "connecting" || callState === "connected";
    if (active && camOn && localVideoTrackRef.current && localVideoRef.current) {
      try { localVideoTrackRef.current.attach(localVideoRef.current); } catch { /* noop */ }
    }
  }, [camOn, callState]);

  // Turn on the local camera + mic. Failure here must NOT drop the call — the
  // user stays in the room (can see/hear the coach, use chat) and gets a clear
  // banner with a Retry. Used on join and by the banner's Retry button.
  const enableMedia = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    try {
      // Honour the choices the user made in the pre-join lobby.
      await room.localParticipant.setCameraEnabled(camWantRef.current);
      await room.localParticipant.setMicrophoneEnabled(micWantRef.current);
      const camPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
      localVideoTrackRef.current = camPub?.track || null;
      camPub?.track?.attach(localVideoRef.current);
      setCamOn(camWantRef.current);
      setMicOn(micWantRef.current);
      setMediaError("");
    } catch (err) {
      setCamOn(false);
      setMicOn(false);
      setMediaError(describeMediaError(err));
    }
  }, []);

  // ── Join — connect to the LiveKit room, then publish media (fail-soft) ───────
  const handleJoin = useCallback(async () => {
    let room;
    try {
      setCallState("connecting");
      setMediaError("");
      const { url, token } = await getBookingCallToken(bookingId);

      room = new Room({
        adaptiveStream: true,
        dynacast: true,
        // Keep the call alive when the user switches tabs/apps or browses
        // elsewhere — don't drop the room on pagehide/background.
        disconnectOnPageLeave: false,
        // Explicit echo cancellation / noise suppression to stop feedback loops
        // (esp. on phones or when both sides are in the same room).
        audioCaptureDefaults: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      roomRef.current = room;

      // The other side is present — flip the UI to "connected". The countdown is
      // driven purely by startTimer (join time), so it never depends on this.
      const markConnected = () => {
        connectedRef.current = true;
        setCallState("connected");
      };

      // Remote media — attach video/audio as tracks are subscribed.
      room
        .on(RoomEvent.TrackSubscribed, (track) => {
          if (track.kind === Track.Kind.Video) {
            remoteVideoTrackRef.current = track;
            if (remoteVideoRef.current) track.attach(remoteVideoRef.current);
            setHasRemoteVideo(true);
          } else if (track.kind === Track.Kind.Audio) {
            if (remoteAudioRef.current) track.attach(remoteAudioRef.current);
          }
          markConnected();
        })
        .on(RoomEvent.ParticipantConnected, markConnected)
        // Keep the local PiP live — a republished camera track (network change,
        // resolution switch) would otherwise leave the old, frozen one attached.
        .on(RoomEvent.LocalTrackPublished, (pub) => {
          if (pub.track?.kind === Track.Kind.Video) {
            localVideoTrackRef.current = pub.track;
            if (localVideoRef.current) pub.track.attach(localVideoRef.current);
          }
        })
        .on(RoomEvent.TrackUnsubscribed, (track) => {
          track.detach();
          if (track.kind === Track.Kind.Video) {
            remoteVideoTrackRef.current = null;
            setHasRemoteVideo(false);
          }
        })
        .on(RoomEvent.ParticipantDisconnected, () => {
          // The other person dropped/left. Do NOT end or complete the session —
          // keep the room open and show a waiting state so they can rejoin while
          // the booked time is still running. The clock keeps counting down.
          setHasRemoteVideo(false);
          setCallState("connecting");
        })
        .on(RoomEvent.DataReceived, (payload) => {
          // Transcript segments from the other participant (AI note-taking).
          try {
            const msg = JSON.parse(new TextDecoder().decode(payload));
            if (msg?.t === "sttseg" && msg.text) {
              transcriptRef.current.push({
                speaker: msg.speaker || "Participant",
                text: String(msg.text),
                ts: msg.ts || Date.now(),
              });
            }
          } catch { /* ignore non-JSON data */ }
        })
        .on(RoomEvent.Disconnected, () => { /* self disconnect handled by finishSession */ });

      await room.connect(url, token);
      // Record real attendance now that we're actually connected (not on lobby
      // preview / token request) — this decides completed vs no-show.
      api.post(`/bookings/${bookingId}/mark-joined/`).catch(() => {});
      // If the other side is already here (they joined first), start the clock
      // even if they have no published tracks yet.
      if (room.remoteParticipants && room.remoteParticipants.size > 0) markConnected();
    } catch (err) {
      // Only a genuine connection/token/network failure lands here.
      const detail = err?.response?.data?.detail;
      toast.error(detail || "Could not connect to the session. Please check your internet and try again.");
      cleanup();
      setCallState("idle");
      return;
    }

    // We're in the room. Start the scheduled-session clock (auto-ends at the
    // booked time regardless of the other side), then try to turn on media.
    startTimer();
    await enableMedia();
  }, [bookingId, startTimer, finishSession, cleanup, enableMedia]);

  const handleEndCall = useCallback(() => {
    const timeUp = scheduledEndRef.current != null && Date.now() >= scheduledEndRef.current;
    // Coach ending BEFORE the scheduled end gets a choice: finish the session now
    // (complete + generate the AI summary) or just step out and keep it open.
    if (user?.role === "coach" && !timeUp) { setEndConfirm(true); return; }
    finishSession("manual");
  }, [finishSession, user]);

  // ── Pre-join lobby: live camera/mic preview + device check ──────────────────
  const stopPreview = useCallback(() => {
    if (previewStreamRef.current) {
      previewStreamRef.current.getTracks().forEach((t) => t.stop());
      previewStreamRef.current = null;
    }
    if (previewRef.current) previewRef.current.srcObject = null;
  }, []);

  const startPreview = useCallback(async () => {
    setPreviewError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      previewStreamRef.current = stream;
      if (previewRef.current) previewRef.current.srcObject = stream;
      stream.getVideoTracks().forEach((t) => { t.enabled = camWantRef.current; });
      stream.getAudioTracks().forEach((t) => { t.enabled = micWantRef.current; });
    } catch (err) {
      setPreviewError(describeMediaError(err));
    }
  }, []);

  // Run the preview whenever we're sitting in the lobby with a loaded booking.
  useEffect(() => {
    if (loading || callState !== "idle" || !booking) return undefined;
    startPreview();
    return () => stopPreview();
  }, [loading, callState, booking, startPreview, stopPreview]);

  const toggleLobbyCam = () => {
    const next = !camOn; setCamOn(next); camWantRef.current = next;
    previewStreamRef.current?.getVideoTracks().forEach((t) => { t.enabled = next; });
  };
  const toggleLobbyMic = () => {
    const next = !micOn; setMicOn(next); micWantRef.current = next;
    previewStreamRef.current?.getAudioTracks().forEach((t) => { t.enabled = next; });
  };
  const joinFromLobby = async () => {
    stopPreview(); // free the devices so LiveKit can acquire them cleanly
    // Give the camera a moment to fully release — re-acquiring it too quickly can
    // hand LiveKit a frozen track (self video stuck / peers see a black frame).
    await new Promise((r) => setTimeout(r, 200));
    handleJoin();
  };

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
    try { transcriberRef.current?.stop(); } catch { /* noop */ }
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
        localVideoTrackRef.current = camPub?.track || null;
        camPub?.track?.attach(localVideoRef.current);
        // A fresh track is created on re-enable — re-apply the chosen background.
        if (bgOption !== "none") await applyBackground(getLocalVideoTrack(roomRef.current), bgOption);
      } else {
        localVideoTrackRef.current = null;
      }
    } catch { /* noop */ }
  };

  const changeBackground = useCallback(async (optionId) => {
    setBgBusy(true);
    setBgOption(optionId);
    await applyBackground(getLocalVideoTrack(roomRef.current), optionId);
    setBgBusy(false);
  }, []);

  // Re-acquire the local camera if it stalls (what the manual off→on does, but
  // automatic). LiveKit's restartTrack() gets a fresh device stream.
  const restartCamera = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    try {
      const track = localVideoTrackRef.current;
      if (track?.restartTrack) {
        await track.restartTrack();
      } else {
        await room.localParticipant.setCameraEnabled(false);
        await room.localParticipant.setCameraEnabled(true);
      }
      const camPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
      localVideoTrackRef.current = camPub?.track || null;
      camPub?.track?.attach(localVideoRef.current);
      if (bgOption !== "none") await applyBackground(getLocalVideoTrack(room), bgOption);
    } catch { /* noop */ }
  }, [bgOption]);

  // Watchdog: a camera track can freeze mid-call (browser/OS throttling) and
  // stay black for the other side until manually toggled. Detect a stopped or
  // stalled (muted) track and restart it automatically.
  useEffect(() => {
    const active = callState === "connected" || callState === "connecting";
    if (!active || !camOn) return undefined;
    let mutedSince = 0;
    const id = setInterval(() => {
      const mst = localVideoTrackRef.current?.mediaStreamTrack;
      if (!mst) return;
      if (mst.readyState === "ended") { restartCamera(); return; }
      if (mst.muted) {
        if (!mutedSince) mutedSince = Date.now();
        else if (Date.now() - mutedSince > 4000) { mutedSince = 0; restartCamera(); }
      } else {
        mutedSince = 0;
      }
    }, 3000);
    return () => clearInterval(id);
  }, [callState, camOn, restartCamera]);

  const isTimeLow = timeLeft !== null && timeLeft <= 300;
  const inCall = callState === "connecting" || callState === "connected";

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen" style={{ background: "#0D0D0D" }}>
      <div className="w-10 h-10 rounded-full border-2 animate-spin" style={{ borderColor: "#C8A951", borderTopColor: "transparent" }} />
    </div>
  );

  return (
    <div className="fixed inset-x-0 bottom-0 flex flex-col select-none overflow-hidden" style={{ top: "7rem", background: "#0D0D0D" }}>

      {/* Remote video — full-bleed background. IMPORTANT: never `display:none`
          — with adaptiveStream on, a hidden element makes LiveKit pause/skip the
          remote video, so it must stay in the layout (we hide it with opacity
          and layer a placeholder on top when there's no remote video). */}
      <video
        ref={remoteVideoRef}
        autoPlay playsInline
        className="absolute inset-0 w-full h-full object-contain z-0"
        style={{ opacity: hasRemoteVideo ? 1 : 0, background: "#0D0D0D" }}
      />
      {/* Remote audio (hidden) */}
      <audio ref={remoteAudioRef} autoPlay />

      {/* ── Top bar ───────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 px-3 sm:px-6 py-2.5 sm:py-4 z-20 shrink-0" style={{ background: "rgba(0,0,0,0.7)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center text-sm font-bold shrink-0" style={{ background: "#C8A951", color: "#14213D" }}>
            {booking?.skill_title?.charAt(0)}
          </div>
          <div className="min-w-0">
            <p className="text-[10px] sm:text-xs font-semibold uppercase tracking-widest" style={{ color: "#C8A951" }}>Session</p>
            <p className="text-xs sm:text-sm font-bold text-white leading-tight truncate max-w-[34vw] sm:max-w-xs">{booking?.skill_title}</p>
          </div>
        </div>

        {inCall && timeLeft !== null && (
          <div className="flex items-center gap-3 sm:gap-6 shrink-0">
            <div className="text-center">
              <p className="text-[9px] sm:text-xs font-semibold uppercase tracking-widest mb-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>Elapsed</p>
              <p className="text-base sm:text-2xl font-bold tabular-nums text-white" style={{ fontFamily: "'Playfair Display', serif" }}>
                {formatTime((durationRef.current ?? 0) - timeLeft)}
              </p>
            </div>
            <div className="w-px h-6 sm:h-8" style={{ background: "rgba(255,255,255,0.15)" }} />
            <div className="text-center">
              <p className="text-[9px] sm:text-xs font-semibold uppercase tracking-widest mb-0.5" style={{ color: isTimeLow ? "#F87171" : "rgba(255,255,255,0.4)" }}>
                {callState === "connecting" ? "Connecting…" : "Time Left"}
              </p>
              <p className="text-base sm:text-2xl font-bold tabular-nums" style={{ fontFamily: "'Playfair Display', serif", color: isTimeLow ? "#F87171" : "white" }}>
                {formatTime(timeLeft)}
              </p>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 shrink-0">
          {inCall && aiSupported && aiNotesOn && (
            <span className="hidden sm:flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full" style={{ background: "rgba(200,169,81,0.12)", color: "#C8A951", border: "1px solid rgba(200,169,81,0.25)" }} title="AI note-taking is on">
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#C8A951" }} />
              AI notes
            </span>
          )}
          <span className="hidden sm:inline-flex text-xs font-semibold px-3 py-1.5 rounded-full" style={{ background: "rgba(200,169,81,0.12)", color: "#C8A951", border: "1px solid rgba(200,169,81,0.25)" }}>
            {booking?.duration} min
          </span>
        </div>
      </div>

      {/* ── Video area ────────────────────────────────────────── */}
      <div className="flex-1 relative overflow-hidden z-10">

        {callState === "idle" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center px-6 py-8 overflow-y-auto">
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              className="w-full max-w-md text-center"
            >
              <h1 className="text-2xl md:text-3xl font-normal text-white mb-1" style={{ fontFamily: "'Playfair Display', serif" }}>{booking?.skill_title}</h1>
              <p className="text-xs mb-5" style={{ color: "rgba(255,255,255,0.4)" }}>{booking?.duration}-minute coaching session · check your camera &amp; mic below</p>

              {/* Camera preview */}
              <div className="relative rounded-2xl overflow-hidden mb-4" style={{ background: "#0b1220", aspectRatio: "4 / 3", border: "1px solid rgba(255,255,255,0.1)" }}>
                <video ref={previewRef} autoPlay playsInline muted
                  className="w-full h-full object-cover" style={{ transform: "scaleX(-1)", display: camOn && !previewError ? "block" : "none" }} />
                {(!camOn || previewError) && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                    <div className="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold" style={{ background: "linear-gradient(135deg,#C8A951,#F0D98C)", color: "#14213D" }}>
                      {booking?.skill_title?.charAt(0)}
                    </div>
                    <p className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>{previewError ? "Camera unavailable" : "Camera off"}</p>
                  </div>
                )}
              </div>

              {/* Permission guidance */}
              {previewError && (
                <div className="rounded-xl p-3 mb-4 text-left flex items-start gap-2" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(239,68,68,0.3)" }}>
                  <FiAlertTriangle size={15} style={{ color: "#F87171" }} className="shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs leading-relaxed" style={{ color: "rgba(255,255,255,0.8)" }}>{previewError}</p>
                    <button onClick={startPreview} className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold" style={{ background: "rgba(255,255,255,0.12)", color: "white" }}>
                      <FiRefreshCw size={11} /> Retry
                    </button>
                  </div>
                </div>
              )}

              {/* Device toggles */}
              <div className="flex items-center justify-center gap-3 mb-6">
                <button onClick={toggleLobbyMic} disabled={!!previewError} title={micOn ? "Mic on" : "Mic off"}
                  className="w-12 h-12 rounded-full flex items-center justify-center disabled:opacity-40" style={{ background: micOn ? "rgba(255,255,255,0.1)" : "#EF4444" }}>
                  {micOn ? <FiMic size={18} className="text-white" /> : <FiMicOff size={18} className="text-white" />}
                </button>
                <button onClick={toggleLobbyCam} disabled={!!previewError} title={camOn ? "Camera on" : "Camera off"}
                  className="w-12 h-12 rounded-full flex items-center justify-center disabled:opacity-40" style={{ background: camOn ? "rgba(255,255,255,0.1)" : "#EF4444" }}>
                  {camOn ? <FiVideo size={18} className="text-white" /> : <FiVideoOff size={18} className="text-white" />}
                </button>
              </div>

              <motion.button
                whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }} onClick={joinFromLobby}
                className="flex items-center justify-center gap-3 w-full px-10 py-4 rounded-full text-base font-bold shadow-lg"
                style={{ background: "linear-gradient(135deg,#C8A951,#F0D98C)", color: "#14213D" }}
              >
                <FiVideo size={20} /> Join now
              </motion.button>
              <p className="text-xs mt-4" style={{ color: "rgba(255,255,255,0.4)" }}>
                {previewError
                  ? "You can still join — you'll be able to turn your camera on once you're in."
                  : "Timer starts when both of you connect."}
              </p>
            </motion.div>
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

        {/* Connected but the other side's camera is off */}
        {callState === "connected" && !hasRemoteVideo && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
            <div className="w-20 h-20 rounded-full mb-3 flex items-center justify-center text-3xl font-bold" style={{ background: "#C8A951", color: "#14213D" }}>
              {booking?.skill_title?.charAt(0)}
            </div>
            <p className="text-sm" style={{ color: "rgba(255,255,255,0.55)" }}>Camera is off</p>
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
            className="absolute bottom-24 sm:bottom-24 right-3 sm:right-4 rounded-xl sm:rounded-2xl object-cover shadow-2xl z-10 w-[96px] h-[128px] sm:w-[168px] sm:h-[126px]"
            style={{ border: "2px solid rgba(255,255,255,0.15)", display: camOn ? "block" : "none" }}
          />
        )}

        {/* Camera/mic problem — clear, actionable, and never blocks the session */}
        <AnimatePresence>
          {inCall && mediaError && (
            <motion.div
              initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}
              className="absolute top-4 left-1/2 -translate-x-1/2 z-30 w-[92%] max-w-md rounded-2xl p-4 shadow-2xl"
              style={{ background: "rgba(255,255,255,0.98)", border: "1px solid rgba(239,68,68,0.3)" }}
            >
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: "rgba(239,68,68,0.12)" }}>
                  <FiAlertTriangle size={16} style={{ color: "#DC2626" }} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold" style={{ color: "#1B2B4A" }}>Camera / microphone need permission</p>
                  <p className="text-xs mt-1 leading-relaxed" style={{ color: "#4A5568" }}>{mediaError}</p>
                  <p className="text-xs mt-2 leading-relaxed" style={{ color: "#2E7D32" }}>
                    You're already connected — you can still see and hear your coach and use chat.
                  </p>
                  <div className="flex items-center gap-2 mt-3">
                    <button onClick={enableMedia}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold"
                      style={{ background: "linear-gradient(135deg,#C8A951,#F0D98C)", color: "#14213D" }}>
                      <FiRefreshCw size={12} /> Retry camera &amp; mic
                    </button>
                    <button onClick={() => setMediaError("")}
                      className="px-3 py-1.5 rounded-full text-xs font-semibold" style={{ background: "rgba(27,43,74,0.06)", color: "#4A5568" }}>
                      Continue without
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* AI note-taking consent banner — informs both parties, dismissible */}
        <AnimatePresence>
          {inCall && aiSupported && aiNotesOn && showAiBanner && !mediaError && (
            <motion.div
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }}
              className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 w-[92%] max-w-md rounded-2xl px-4 py-3 flex items-start gap-3 shadow-xl"
              style={{ background: "rgba(20,33,61,0.92)", backdropFilter: "blur(8px)", border: "1px solid rgba(200,169,81,0.35)" }}
            >
              <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: "rgba(200,169,81,0.15)" }}>
                <FiFileText size={15} style={{ color: "#C8A951" }} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-white">AI note-taking is on</p>
                <p className="text-xs mt-0.5 leading-relaxed" style={{ color: "rgba(255,255,255,0.7)" }}>
                  This session is being transcribed to create a private summary for you and your coach. You can turn it off anytime.
                </p>
                <div className="flex items-center gap-3 mt-2">
                  <button onClick={() => setShowAiBanner(false)} className="text-xs font-bold px-3 py-1 rounded-full" style={{ background: "linear-gradient(135deg,#C8A951,#F0D98C)", color: "#14213D" }}>Got it</button>
                  <button onClick={() => { setAiNotesOn(false); setShowAiBanner(false); }} className="text-xs font-semibold" style={{ color: "rgba(255,255,255,0.6)" }}>Turn off</button>
                </div>
              </div>
              <button onClick={() => setShowAiBanner(false)} className="p-1 rounded-full shrink-0" style={{ color: "rgba(255,255,255,0.5)" }}><FiX size={14} /></button>
            </motion.div>
          )}
        </AnimatePresence>

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
        <div className="flex items-center justify-center flex-wrap gap-2.5 sm:gap-5 py-3.5 sm:py-5 px-2 z-20 shrink-0 relative" style={{ background: "rgba(0,0,0,0.75)", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <button onClick={toggleMic} className="w-11 h-11 sm:w-12 sm:h-12 rounded-full flex items-center justify-center transition-all" style={{ background: micOn ? "rgba(255,255,255,0.1)" : "#EF4444" }} title={micOn ? "Mute microphone" : "Unmute microphone"}>
            {micOn ? <FiMic size={18} className="text-white" /> : <FiMicOff size={18} className="text-white" />}
          </button>

          <button onClick={handleEndCall} className="w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center shadow-xl transition-transform hover:scale-105" style={{ background: "#EF4444" }} title="End session">
            <FiPhoneOff size={22} className="text-white" />
          </button>

          <button onClick={toggleCam} className="w-11 h-11 sm:w-12 sm:h-12 rounded-full flex items-center justify-center transition-all" style={{ background: camOn ? "rgba(255,255,255,0.1)" : "#EF4444" }} title={camOn ? "Turn off camera" : "Turn on camera"}>
            {camOn ? <FiVideo size={18} className="text-white" /> : <FiVideoOff size={18} className="text-white" />}
          </button>

          <BackgroundPicker selected={bgOption} onSelect={changeBackground} busy={bgBusy} />

          {aiSupported && (
            <button onClick={() => { const next = !aiNotesOn; setAiNotesOn(next); setShowAiBanner(next); }}
              className="w-11 h-11 sm:w-12 sm:h-12 rounded-full flex items-center justify-center transition-all"
              style={{ background: aiNotesOn ? "rgba(200,169,81,0.9)" : "rgba(255,255,255,0.1)" }}
              title={aiNotesOn ? "AI note-taking on — tap to turn off" : "AI note-taking off — tap to turn on"}>
              <FiFileText size={18} style={{ color: aiNotesOn ? "#14213D" : "white" }} />
            </button>
          )}

          <button
            onClick={() => setChatOpen(o => !o)}
            className="relative w-11 h-11 sm:w-12 sm:h-12 rounded-full flex items-center justify-center transition-all hover:scale-105"
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

      {/* ── Coach "end session early" choice ─────────────────────── */}
      <AnimatePresence>
        {endConfirm && (
          <motion.div className="absolute inset-0 z-50 flex items-center justify-center p-4"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.6)" }} onClick={() => setEndConfirm(false)} />
            <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }}
              className="relative w-full max-w-sm rounded-2xl p-6 z-10" style={{ background: "white" }}>
              <h3 className="text-lg font-normal mb-1" style={{ color: "#1B2B4A", fontFamily: "'Playfair Display', serif" }}>End this session?</h3>
              <p className="text-sm mb-5" style={{ color: "#4A5568" }}>
                There's still time left. You can finish now — this completes the session and generates the AI summary — or just step out and keep it open.
              </p>
              <div className="space-y-2">
                <button onClick={() => { setEndConfirm(false); finishSession("complete"); }}
                  className="w-full py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2"
                  style={{ background: "linear-gradient(135deg,#C8A951,#F0D98C)", color: "#14213D" }}>
                  <FiFileText size={15} /> End &amp; save summary
                </button>
                <button onClick={() => { setEndConfirm(false); finishSession("manual"); }}
                  className="w-full py-2.5 rounded-xl text-sm font-semibold"
                  style={{ background: "rgba(27,43,74,0.06)", color: "#4A5568" }}>
                  Just leave (keep open)
                </button>
                <button onClick={() => setEndConfirm(false)}
                  className="w-full py-2 text-xs font-semibold" style={{ color: "#9aa3b0" }}>
                  Cancel
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
