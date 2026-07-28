import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "react-toastify";
import {
  FiMic, FiMicOff, FiVideo, FiVideoOff,
  FiPhoneOff, FiMessageSquare, FiClock, FiSend, FiX, FiUsers, FiPaperclip, FiDownload, FiFile,
  FiAlertTriangle, FiRefreshCw, FiMonitor,
} from "react-icons/fi";
import { Room, RoomEvent, Track } from "livekit-client";
import { api } from "../utils/auth";
import { MAX_UPLOAD_BYTES, formatBytes, isImageType } from "../utils/chatAttachments";
import { useAuth } from "../context/AuthContext";
import { getGroupCallToken } from "../utils/livekit";
import BackgroundPicker from "../components/BackgroundPicker";
import { applyBackground, getLocalVideoTrack, preloadBackgroundAssets } from "../utils/videoBackground";
import { SESSION_REJOIN_MS } from "../utils/sessionTiming";
import {
  diag, resetDiag, logAudioDevices, logMicTrackSettings, startAudioStatsProbe,
} from "../utils/callDiagnostics";

const fmt = (s) => {
  const x = Math.max(0, Math.round(s));
  return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;
};

// Turn a getUserMedia / device error into plain, actionable guidance. Mirrors
// the 1:1 call page so both flows behave identically.
function describeMediaError(err) {
  const name = err?.name || "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError")
    return "Your camera & microphone are blocked. Click the camera icon in your browser's address bar, choose “Allow”, then tap Retry.";
  if (name === "NotFoundError" || name === "DevicesNotFoundError")
    return "No camera or microphone was found on this device. You can still see and hear others — plug one in and tap Retry to turn yours on.";
  if (name === "NotReadableError" || name === "TrackStartError")
    return "Your camera or microphone is being used by another app (Zoom, Teams, FaceTime…). Close it, then tap Retry.";
  if (name === "NotSupportedError" || (typeof window !== "undefined" && !window.isSecureContext))
    return "This browser is blocking camera access. Please open the session in Chrome or Edge, then tap Retry.";
  return "We couldn't turn on your camera/microphone. You're still connected — check your browser's camera permission and tap Retry.";
}

// One remote participant's tile — attaches their LiveKit video + audio tracks.
// A shared screen shown as the main view.
function ScreenView({ track, name }) {
  const ref = useRef(null);
  useEffect(() => {
    const t = track;
    if (t && ref.current) { t.attach(ref.current); return () => { try { t.detach(ref.current); } catch { /* noop */ } }; }
  }, [track]);
  return (
    <div className="relative w-full h-full rounded-2xl overflow-hidden bg-black" style={{ border: "1px solid rgba(200,169,81,0.4)" }}>
      <video ref={ref} autoPlay playsInline className="w-full h-full object-contain" />
      <span className="absolute bottom-2 left-2 px-2 py-0.5 rounded-md text-xs font-semibold text-white" style={{ background: "rgba(0,0,0,0.6)" }}>
        {name ? `${name}'s screen` : "Shared screen"}
      </span>
    </div>
  );
}

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
  const [mediaError, setMediaError] = useState("");   // camera/mic couldn't start in-call
  const [previewError, setPreviewError] = useState(""); // lobby camera/mic issue
  const previewRef = useRef(null);       // lobby preview <video>
  const previewStreamRef = useRef(null); // lobby MediaStream
  const camWantRef = useRef(true);       // desired camera state on join
  const micWantRef = useRef(true);       // desired mic state on join
  const [remotes, setRemotes] = useState({}); // sid -> { name, videoTrack, audioTrack }
  const [screenShare, setScreenShare] = useState(null); // { track, name } — a remote shared screen
  const [screenSharing, setScreenSharing] = useState(false); // I'm sharing my screen
  const [screenBusy, setScreenBusy] = useState(false);
  const [canScreenShare] = useState(() =>
    typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia);
  const [timeLeft, setTimeLeft] = useState(null);
  const [bgOption, setBgOption] = useState("none");
  const [bgBusy, setBgBusy] = useState(false);
  const customBgRef = useRef(null); // object-URL of an uploaded custom background
  const [overtime, setOvertime] = useState(false); // past scheduled end, still within the rejoin window
  const overtimeRef = useRef(false);

  const [chatOpen, setChatOpen] = useState(false);
  const [chat, setChat] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [unread, setUnread] = useState(0);
  const [chatFile, setChatFile] = useState(null);
  const [chatUploading, setChatUploading] = useState(false);

  const roomRef = useRef(null);
  const joiningRef = useRef(false);   // guard: never build two Rooms
  const statsStopRef = useRef(null);
  const chatWsRef = useRef(null);
  const chatFileInputRef = useRef(null);
  const docInputRef = useRef(null); // "Share document" quick action in the controls
  const localVideoRef = useRef(null);
  const timerRef = useRef(null);
  const chatEndRef = useRef(null);
  const chatOpenRef = useRef(false);
  const endRef = useRef(null);

  // Start pulling the virtual-background engine into cache now, while the user is
  // still in the lobby — so picking a background later applies instantly.
  useEffect(() => { preloadBackgroundAssets(); }, []);

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
        // The same link stays live through the rejoin window (N3) so a group
        // session can run over / be reconnected and continued.
        if (new Date(found.end_datetime).getTime() + SESSION_REJOIN_MS < Date.now()) { toast.error("This session has already ended."); navigate(-1); return; }
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
    try { statsStopRef.current?.(); } catch { /* noop */ }
    statsStopRef.current = null;
    joiningRef.current = false;
    if (roomRef.current) { try { roomRef.current.disconnect(); } catch { /* noop */ } roomRef.current = null; }
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    setRemotes({});
    setScreenShare(null);
    setScreenSharing(false);
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
      const now = Date.now();
      // Countdown to the scheduled end (shows 00:00 once reached). The scheduled
      // end is a SOFT boundary — an "overtime" notice shows and the call keeps
      // going until the rejoin window fully closes (N3).
      const remaining = Math.floor((endRef.current - now) / 1000);
      setTimeLeft(Math.max(remaining, 0));
      if (now >= endRef.current && !overtimeRef.current) { overtimeRef.current = true; setOvertime(true); }
      if (now > endRef.current + SESSION_REJOIN_MS) finishSession("timeout");
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

  // Turn on the local camera + mic honouring the lobby choices. Failure must NOT
  // drop the call — you stay in the room and get a banner with a Retry.
  const enableMedia = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    try {
      // Microphone first and on its own (parity with SessionCallLiveKit): the
      // audio device is acquired before the camera and before any background
      // processor, so a slow or failing camera can never disturb the capture the
      // conversation depends on.
      await logAudioDevices("before mic acquire");
      await room.localParticipant.setMicrophoneEnabled(micWantRef.current);
      const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
      logMicTrackSettings(micPub?.track?.mediaStreamTrack, "after acquire");

      await room.localParticipant.setCameraEnabled(camWantRef.current);
      const camPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
      camPub?.track?.attach(localVideoRef.current);
      if (camWantRef.current && bgOption !== "none") await applyBackground(getLocalVideoTrack(room), bgOption, customBgRef.current);
      setCamOn(camWantRef.current);
      setMicOn(micWantRef.current);
      setMediaError("");
    } catch (err) {
      diag("mic", "enableMedia failed", { name: err?.name, message: err?.message });
      setCamOn(false);
      setMicOn(false);
      setMediaError(describeMediaError(err));
    }
  }, [bgOption]);

  // ── Pre-join lobby: live camera/mic preview + device check ──────────────────
  const stopPreview = useCallback(() => {
    if (previewStreamRef.current) {
      const tracks = previewStreamRef.current.getTracks();
      tracks.forEach((t) => t.stop());
      diag("mic", "lobby preview released", { tracks: tracks.map((t) => `${t.kind}:${t.readyState}`) });
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

  // ── Join: connect to the LiveKit room, then publish media (fail-soft) ────────
  const handleJoin = useCallback(async () => {
    // Re-entrancy guard: two overlapping joins would build two Rooms and acquire
    // the microphone twice (parity with SessionCallLiveKit).
    if (joiningRef.current || roomRef.current) { diag("join", "join ignored — already joining/joined"); return; }
    joiningRef.current = true;
    let room;
    try {
      resetDiag(`group session ${id}`);
      setCallState("connecting");
      const { url, token } = await getGroupCallToken(id);

      room = new Room({
        adaptiveStream: true,
        dynacast: true,
        // Keep the call alive when the user switches tabs/apps or browses elsewhere.
        disconnectOnPageLeave: false,
        audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        // Voice-optimised, packet-loss-resilient audio (see SessionCallLiveKit for
        // why 32 kbps rather than the 24 kbps speech preset).
        publishDefaults: { audioPreset: { maxBitrate: 32_000 }, red: true, dtx: false },
      });
      roomRef.current = room;
      diag("join", "room created", { url });

      room
        .on(RoomEvent.ParticipantConnected, (p) => upsertParticipant(p))
        .on(RoomEvent.ParticipantDisconnected, (p) => dropParticipant(p))
        .on(RoomEvent.TrackSubscribed, (track, pub, p) => {
          diag("track", "subscribed", { kind: track?.kind, source: pub?.source, who: p?.identity });
          if (pub?.source === Track.Source.ScreenShare) setScreenShare({ track, name: p.name || p.identity });
          else setTrack(p, track, true);
        })
        .on(RoomEvent.TrackUnsubscribed, (track, pub, p) => {
          if (pub?.source === Track.Source.ScreenShare) setScreenShare(null);
          else setTrack(p, track, false);
        })
        .on(RoomEvent.LocalTrackPublished, (pub) => {
          diag("track", "local track published", { source: pub.source, kind: pub.track?.kind });
          if (pub.source === Track.Source.Microphone) logMicTrackSettings(pub.track?.mediaStreamTrack, "published");
          if (pub.source === Track.Source.ScreenShare) setScreenSharing(true);
        })
        .on(RoomEvent.LocalTrackUnpublished, (pub) => {
          diag("track", "local track unpublished", { source: pub.source });
          if (pub.source === Track.Source.ScreenShare) setScreenSharing(false);
        })
        // Diagnostics so an intermittent audio report can be traced afterwards.
        .on(RoomEvent.ConnectionQualityChanged, (quality, p) => diag("net", "connection quality", {
          quality, who: p?.identity === room.localParticipant?.identity ? "local" : (p?.identity || "remote"),
        }))
        .on(RoomEvent.Reconnecting, () => diag("net", "reconnecting"))
        .on(RoomEvent.Reconnected, () => {
          diag("net", "reconnected");
          const micPub = room.localParticipant?.getTrackPublication(Track.Source.Microphone);
          logMicTrackSettings(micPub?.track?.mediaStreamTrack, "after reconnect");
        })
        .on(RoomEvent.MediaDevicesError, (e) => diag("mic", "media devices error", { name: e?.name, message: e?.message }))
        .on(RoomEvent.LocalAudioSilenceDetected, () => diag("mic", "LOCAL AUDIO SILENCE DETECTED — capture may have been lost"))
        .on(RoomEvent.Disconnected, () => { /* handled via finishSession */ });

      await room.connect(url, token);
      diag("join", "connected to room", { name: room.name, participants: room.remoteParticipants?.size ?? 0 });
      statsStopRef.current?.();
      statsStopRef.current = startAudioStatsProbe(room);
    } catch (err) {
      // Only a genuine connection/token/network failure lands here.
      diag("join", "connect failed", { name: err?.name, message: err?.message });
      const detail = err?.response?.data?.detail;
      toast.error(detail || "Could not connect to the session. Please check your internet and try again.");
      cleanup();
      setCallState("idle");
      joiningRef.current = false;
      return;
    }

    // We're in the room — the call is joined even if the camera/mic won't start.
    room.remoteParticipants.forEach((p) => upsertParticipant(p));
    setCallState("connected");
    connectChat();
    startTimer();
    try {
      await enableMedia();
    } finally {
      joiningRef.current = false;
    }
  }, [id, upsertParticipant, dropParticipant, setTrack, connectChat, startTimer, cleanup, enableMedia]);

  // Keep the local camera bound to its <video> — the element re-mounts when the
  // layout switches between grid and screen-share, which would otherwise leave
  // the self-view black.
  useEffect(() => {
    const active = callState === "connected" || callState === "connecting";
    if (!active || !camOn) return undefined;
    let tries = 0;
    const attach = () => {
      const t = roomRef.current?.localParticipant?.getTrackPublication(Track.Source.Camera)?.track;
      const el = localVideoRef.current;
      if (t && el) { try { t.attach(el); } catch { /* noop */ } return true; }
      return false;
    };
    if (attach()) return undefined;
    const id = setInterval(() => { tries += 1; if (attach() || tries > 12) clearInterval(id); }, 350);
    return () => clearInterval(id);
  }, [callState, camOn, screenShare]);

  // ── Lobby device toggles + join ─────────────────────────────────────────────
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
    // The browser releases capture devices asynchronously; re-acquiring before
    // the release completes is what leaves audio reconfigured and crackling.
    await new Promise((r) => setTimeout(r, 350));
    handleJoin();
  };

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

  // Run the lobby preview whenever we're sitting in the lobby with a loaded session.
  useEffect(() => {
    if (loading || callState !== "idle" || !session) return undefined;
    startPreview();
    return () => stopPreview();
  }, [loading, callState, session, startPreview, stopPreview]);

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
        if (bgOption !== "none") await applyBackground(getLocalVideoTrack(roomRef.current), bgOption, customBgRef.current);
      }
    } catch { /* noop */ }
  };

  const changeBackground = useCallback(async (optionId, image) => {
    setBgBusy(true);
    setBgOption(optionId);
    // Remember the uploaded image so it survives camera off→on / restarts.
    if (optionId === "custom" && image) customBgRef.current = image;
    const res = await applyBackground(getLocalVideoTrack(roomRef.current), optionId, customBgRef.current);
    if (res?.ok === false && res.reason === "unsupported") {
      toast.error("Virtual backgrounds aren't supported on this device or browser.");
      setBgOption("none");
    }
    setBgBusy(false);
  }, []);

  const toggleScreenShare = async () => {
    const room = roomRef.current;
    if (!room) return;
    setScreenBusy(true);
    try {
      await room.localParticipant.setScreenShareEnabled(!screenSharing);
    } catch (err) {
      if (err?.name !== "NotAllowedError" && err?.name !== "AbortError") {
        toast.error("Couldn't share your screen. Please try again.");
      }
    } finally { setScreenBusy(false); }
  };

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
          <div className="absolute inset-0 flex flex-col items-center justify-center px-6 py-8 overflow-y-auto">
            <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="w-full max-w-md text-center">
              <h1 className="text-2xl md:text-3xl font-normal text-white mb-1" style={{ fontFamily: "'Playfair Display', serif" }}>{session?.title}</h1>
              <p className="text-xs mb-5" style={{ color: "rgba(255,255,255,0.4)" }}>Group session · check your camera &amp; mic below</p>

              {/* Camera preview */}
              <div className="relative rounded-2xl overflow-hidden mb-4 mx-auto" style={{ background: "#0b1220", aspectRatio: "4 / 3", border: "1px solid rgba(255,255,255,0.1)", maxWidth: 420 }}>
                <video ref={previewRef} autoPlay playsInline muted
                  className="w-full h-full object-cover" style={{ transform: "scaleX(-1)", display: camOn && !previewError ? "block" : "none" }} />
                {(!camOn || previewError) && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                    <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: "rgba(200,169,81,0.18)" }}>
                      <FiUsers size={26} style={{ color: "#C8A951" }} />
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

              <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }} onClick={joinFromLobby}
                className="flex items-center justify-center gap-3 w-full px-10 py-4 rounded-full text-base font-bold shadow-lg"
                style={{ background: "linear-gradient(135deg,#C8A951,#F0D98C)", color: "#14213D" }}>
                <FiVideo size={20} /> Join Call
              </motion.button>
              <p className="text-xs mt-4" style={{ color: "rgba(255,255,255,0.4)" }}>
                {previewError
                  ? "You can still join — you'll be able to turn your camera on once you're in."
                  : "You'll join the group session with the others."}
              </p>
            </motion.div>
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

        {/* Grid layout — nobody is sharing a screen */}
        {inCall && !screenShare && (
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

        {/* Screen-share layout — the shared screen is the main view, people below */}
        {inCall && screenShare && (
          <div className="w-full h-full flex flex-col gap-3">
            <div className="flex-1 min-h-0">
              <ScreenView track={screenShare.track} name={screenShare.name} />
            </div>
            <div className="h-24 sm:h-28 flex gap-3 overflow-x-auto shrink-0">
              {/* Local tile (compact) */}
              <div className="relative rounded-xl overflow-hidden bg-black shrink-0 h-full aspect-video" style={{ border: "1px solid rgba(200,169,81,0.4)" }}>
                <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" style={{ visibility: camOn ? "visible" : "hidden" }} />
                {!camOn && (
                  <div className="absolute inset-0 flex items-center justify-center" style={{ background: "#14213D" }}>
                    <FiVideoOff size={20} style={{ color: "#C8A951" }} />
                  </div>
                )}
                <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded text-[10px] font-semibold text-white" style={{ background: "rgba(0,0,0,0.55)" }}>You</span>
              </div>
              {remoteList.map(([sid, data]) => (
                <div key={sid} className="shrink-0 h-full aspect-video"><RemoteTile data={data} /></div>
              ))}
            </div>
          </div>
        )}

        {/* "You're sharing your screen" indicator */}
        {inCall && screenSharing && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2.5 px-4 py-2 rounded-full shadow-xl"
            style={{ background: "rgba(20,33,61,0.92)", border: "1px solid rgba(200,169,81,0.4)" }}>
            <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: "#C8A951" }} />
            <span className="text-xs font-semibold text-white">You're sharing your screen</span>
            <button onClick={toggleScreenShare} disabled={screenBusy}
              className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: "rgba(239,68,68,0.9)", color: "white" }}>
              Stop
            </button>
          </div>
        )}

        {/* Camera/mic problem — clear, actionable, never blocks the session */}
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
                    You're already in the session — you can still see and hear others and use chat.
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

        {/* Overtime: scheduled time is up, but the call keeps going and the same
            link stays live so people can continue / reconnect (N3). */}
        <AnimatePresence>
          {overtime && callState === "connected" && (
            <motion.div
              initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="absolute top-4 left-1/2 -translate-x-1/2 z-20 px-5 py-2.5 rounded-xl flex items-center gap-2"
              style={{ background: "rgba(200,169,81,0.95)", backdropFilter: "blur(8px)" }}
            >
              <FiClock size={14} style={{ color: "#14213D" }} />
              <span className="text-sm font-bold" style={{ color: "#14213D" }}>
                Scheduled time is up — you can keep going or end the session.
              </span>
            </motion.div>
          )}
        </AnimatePresence>
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
          {canScreenShare && (
            <button onClick={toggleScreenShare} disabled={screenBusy}
              className="w-12 h-12 rounded-full flex items-center justify-center disabled:opacity-50"
              style={{ background: screenSharing ? "rgba(200,169,81,0.9)" : "rgba(255,255,255,0.1)" }}
              title={screenSharing ? "Stop sharing your screen" : "Share your screen"}>
              <FiMonitor size={18} style={{ color: screenSharing ? "#14213D" : "white" }} />
            </button>
          )}
          {/* Share a document — opens the picker, then the chat with it staged */}
          <input type="file" ref={docInputRef} className="hidden"
            onChange={(e) => { handleChatFile(e); setChatOpen(true); }} />
          <button onClick={() => docInputRef.current?.click()}
            className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: "rgba(255,255,255,0.1)" }}
            title="Share a document">
            <FiPaperclip size={18} className="text-white" />
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
