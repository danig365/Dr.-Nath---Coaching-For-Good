import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "react-toastify";
import {
  FiMic, FiMicOff, FiVideo, FiVideoOff,
  FiPhoneOff, FiMessageSquare, FiClock, FiSend, FiX, FiPaperclip, FiDownload, FiFile,
  FiAlertTriangle, FiRefreshCw, FiFileText, FiMonitor, FiUserPlus, FiCopy, FiTrash2,
} from "react-icons/fi";
import { Room, RoomEvent, Track } from "livekit-client";
import { api } from "../utils/auth";
import { MAX_UPLOAD_BYTES, formatBytes, isImageType } from "../utils/chatAttachments";
import { useAuth } from "../context/AuthContext";
import {
  getBookingCallToken,
  createGuestInvite, revokeGuestInvite, getGuestPending,
  admitGuest as admitGuestApi, denyGuest as denyGuestApi, removeGuest as removeGuestApi,
} from "../utils/livekit";
import BackgroundPicker from "../components/BackgroundPicker";
import { RemoteTile, ScreenView } from "../components/CallTiles";
import { applyBackground, getLocalVideoTrack, preloadBackgroundAssets } from "../utils/videoBackground";
import { SESSION_GRACE_MS, SESSION_REJOIN_MS } from "../utils/sessionTiming";
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
  // Multi-party (N4): every remote participant — the client AND any invited
  // guests — keyed by LiveKit sid. sid -> { name, identity, videoTrack, audioTrack }.
  const [remotes, setRemotes] = useState({});
  const [screenShare, setScreenShare] = useState(null); // a remote's shared screen { track, name }
  const [screenSharing, setScreenSharing] = useState(false);     // I'm sharing my screen
  const [screenBusy, setScreenBusy] = useState(false);
  // Screen share needs getDisplayMedia — desktop browsers only.
  const [canScreenShare] = useState(() =>
    typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia);
  const [timeLeft, setTimeLeft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [bgOption, setBgOption] = useState("none");
  const [bgBusy, setBgBusy] = useState(false);
  const customBgRef = useRef(null); // object-URL of an uploaded custom background
  const [overtime, setOvertime] = useState(false); // past scheduled end, still within the rejoin window
  const overtimeRef = useRef(false);
  const [needsResume, setNeedsResume] = useState(false); // session finalised but still resumable (N3)
  const [resuming, setResuming] = useState(false);
  const [endConfirm, setEndConfirm] = useState(false); // coach's "end early" choice
  const [coachPresent, setCoachPresent] = useState(false); // waiting-room: is the host in yet
  const [pendingJoin, setPendingJoin] = useState(null);    // coach: name of a client waiting to be let in
  const [admitBusy, setAdmitBusy] = useState(false);
  const isCoachUser = user?.role === "coach";
  // Guest invites (N4): the shareable link + guests waiting to be admitted.
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteLink, setInviteLink] = useState("");   // full shareable URL, or "" if link is off
  const [inviteBusy, setInviteBusy] = useState(false);
  const [guestWaiting, setGuestWaiting] = useState([]); // [{ guest_uid, name }]
  const [guestBusy, setGuestBusy] = useState("");       // guest_uid currently being admitted/denied
  const knownGuestUidsRef = useRef(new Set());          // to nudge only on NEW waiting guests

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
  const docInputRef = useRef(null); // "Share document" quick action in the controls

  const roomRef = useRef(null);
  const localVideoRef = useRef(null);
  const localVideoTrackRef = useRef(null);   // current local camera track (for re-attach)
  const remotesRef = useRef({});             // mirror of `remotes` for handler logic
  const timerRef = useRef(null);
  const endRef = useRef(null);   // effective end (ms epoch) — adjusts on connect
  const capRef = useRef(null);   // hard cap: scheduled end + grace
  const scheduledEndRef = useRef(null); // the booked end time (ms epoch), no grace
  const durationRef = useRef(null);
  const timerStartedRef = useRef(false);
  const connectedRef = useRef(false); // both sides present (set once)

  // Start pulling the virtual-background engine into cache now, while the user is
  // still in the lobby — so picking a background later applies instantly.
  useEffect(() => { preloadBackgroundAssets(); }, []);

  // ── Fetch booking ──────────────────────────────────────────────────────────
  useEffect(() => {
    api.get(`/bookings/${bookingId}/`)
      .then(res => {
        // Use the slot's absolute UTC end (converted to local by Date). Fall back
        // to session_date/time treated as UTC (append "Z") for legacy bookings.
        const sessionEnd = new Date(
          res.data.slot_end
            ? new Date(res.data.slot_end).getTime()
            : new Date(`${res.data.session_date}T${res.data.session_time}Z`).getTime() +
              res.data.duration * 60 * 1000
        );
        const withinWindow = sessionEnd.getTime() + SESSION_REJOIN_MS >= Date.now();
        const status = res.data.status;

        if (status !== "accepted") {
          // A finalised session can still be RESUMED on the same link while the
          // rejoin window is open (N3) — offer that instead of bouncing out.
          if ((status === "completed" || status === "no_show") && withinWindow) {
            setBooking(res.data);
            durationRef.current = res.data.duration * 60;
            scheduledEndRef.current = sessionEnd.getTime();
            capRef.current = sessionEnd.getTime() + SESSION_REJOIN_MS;
            setTimeLeft(res.data.duration * 60);
            setNeedsResume(true);
            return;
          }
          toast.error("This session is not active.");
          navigate(-1);
          return;
        }
        // The link stays live through the whole rejoin window (N3) so people can
        // run over or reconnect and continue — not just the short grace.
        if (!withinWindow) {
          toast.error("This session's time has already passed.");
          navigate(-1);
          return;
        }
        setBooking(res.data);
        durationRef.current = res.data.duration * 60;
        scheduledEndRef.current = sessionEnd.getTime();
        capRef.current = sessionEnd.getTime() + SESSION_REJOIN_MS;
        setTimeLeft(res.data.duration * 60);
      })
      .catch(() => { toast.error("Could not load session."); navigate(-1); })
      .finally(() => setLoading(false));
  }, [bookingId, navigate]);

  // ── Remote participant bookkeeping (multi-party, N4) ─────────────────────────
  const upsertParticipant = useCallback((p) => {
    setRemotes((prev) => {
      const next = { ...prev, [p.sid]: { ...(prev[p.sid] || {}), name: p.name || p.identity, identity: p.identity } };
      remotesRef.current = next;
      return next;
    });
  }, []);
  const dropParticipant = useCallback((p) => {
    setRemotes((prev) => { const n = { ...prev }; delete n[p.sid]; remotesRef.current = n; return n; });
  }, []);
  const setParticipantTrack = useCallback((p, track, attach) => {
    setRemotes((prev) => {
      const entry = { ...(prev[p.sid] || { name: p.name || p.identity, identity: p.identity }) };
      const key = track.kind === Track.Kind.Video ? "videoTrack" : "audioTrack";
      entry[key] = attach ? track : undefined;
      const next = { ...prev, [p.sid]: entry };
      remotesRef.current = next;
      return next;
    });
  }, []);

  // ── Cleanup ────────────────────────────────────────────────────────────────
  const cleanup = useCallback(() => {
    clearInterval(timerRef.current);
    try { transcriberRef.current?.stop(); } catch { /* noop */ }
    if (roomRef.current) { try { roomRef.current.disconnect(); } catch { /* noop */ } roomRef.current = null; }
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    remotesRef.current = {};
    setRemotes({});
    setScreenShare(null);
    setScreenSharing(false);
  }, []);

  const finishSession = useCallback(async (reason) => {
    cleanup();
    setCallState("ended");
    // Complete the booking when its time is up, OR when the coach deliberately
    // ends it early ("complete"). Merely leaving/dropping while the window is
    // still running does NOT complete it — it stays 'accepted' so either side
    // can rejoin.
    // Leaving/dropping only FINALISES the session once the rejoin window has
    // fully closed (the hard cap). Until then it stays 'accepted' so either side
    // can reconnect and continue on the same link (N3). "complete" = a deliberate
    // end by the coach; "timeout" only fires at the cap.
    const finish = reason === "timeout" || reason === "complete" ||
      (capRef.current != null && Date.now() >= capRef.current);
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
    // capped only by the (generous) rejoin window. Deterministic + identical for
    // both sides, so the timer never sits frozen waiting on the other party.
    endRef.current = Math.min(Date.now() + durationRef.current * 1000, capRef.current);
    timerRef.current = setInterval(() => {
      const now = Date.now();
      const remaining = Math.floor((endRef.current - now) / 1000);
      setTimeLeft(Math.min(durationRef.current, Math.max(remaining, 0)));
      // Scheduled time reached = a SOFT boundary. Don't end the call — show an
      // "overtime" notice and let them keep going / reconnect and continue (N3).
      if (now >= scheduledEndRef.current && !overtimeRef.current) { overtimeRef.current = true; setOvertime(true); }
      // Hard cap: the rejoin window has fully closed — finalise the session.
      if (now >= capRef.current) finishSession("timeout");
    }, 1000);
  }, [finishSession]);

  // Resume a finalised-but-still-in-window session (N3): flip it back to
  // 'accepted' on the server, then drop into the normal pre-join lobby.
  const handleResume = useCallback(async () => {
    setResuming(true);
    try {
      const res = await api.post(`/bookings/${bookingId}/reopen/`);
      setBooking(res.data);
      overtimeRef.current = false;
      setOvertime(false);
      setNeedsResume(false);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Couldn't resume this session — its window may have closed.");
      navigate(-1);
    } finally {
      setResuming(false);
    }
  }, [bookingId, navigate]);

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

  // Remote video/audio/screen are attached by the RemoteTile / ScreenView
  // components themselves (each owns its <video>/<audio>), so no re-attach effect
  // is needed here — only the local PiP below.

  // Bind the local PiP to the camera track. Retries briefly because the track
  // and the <video> element can become ready at slightly different moments on
  // join (which left the coach's self-view black).
  useEffect(() => {
    const active = callState === "connecting" || callState === "connected";
    if (!active || !camOn) return undefined;
    let tries = 0;
    const attach = () => {
      const t = localVideoTrackRef.current, el = localVideoRef.current;
      if (t && el) { try { t.attach(el); } catch { /* noop */ } return true; }
      return false;
    };
    if (attach()) return undefined;
    const id = setInterval(() => { tries += 1; if (attach() || tries > 12) clearInterval(id); }, 350);
    return () => clearInterval(id);
    // Re-run when the layout may have changed (a remote joining/leaving or a
    // screen share moves the local PiP), so the self-view re-binds.
  }, [camOn, callState, remotes, screenShare]);

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

      // Someone else is here. We're already "connected" the moment we join the
      // room ourselves (Meet-style: the call starts with one person); this marks
      // that at least one other participant (client or guest) is present.
      const markConnected = () => {
        connectedRef.current = true;
        setCallState("connected");
        startTimer();
      };

      // Remote media — route each participant's video/audio into their tile, and
      // any shared screen into the full-bleed main view (multi-party, N4).
      room
        .on(RoomEvent.ParticipantConnected, (p) => { upsertParticipant(p); markConnected(); })
        .on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
          if (publication?.source === Track.Source.ScreenShare) {
            setScreenShare({ track, name: participant?.name || participant?.identity });
          } else {
            setParticipantTrack(participant, track, true);
          }
          markConnected();
        })
        // Keep the local PiP live — a republished camera track (network change,
        // resolution switch) would otherwise leave the old, frozen one attached.
        // Also sync the "I'm sharing my screen" state to LiveKit's own events.
        .on(RoomEvent.LocalTrackPublished, (pub) => {
          if (pub.source === Track.Source.ScreenShare) { setScreenSharing(true); return; }
          if (pub.track?.kind === Track.Kind.Video) {
            localVideoTrackRef.current = pub.track;
            if (localVideoRef.current) pub.track.attach(localVideoRef.current);
          }
        })
        .on(RoomEvent.LocalTrackUnpublished, (pub) => {
          if (pub.source === Track.Source.ScreenShare) setScreenSharing(false);
        })
        .on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
          if (publication?.source === Track.Source.ScreenShare) {
            setScreenShare((cur) => (cur && cur.track === track ? null : cur));
          } else {
            setParticipantTrack(participant, track, false);
          }
        })
        .on(RoomEvent.ParticipantDisconnected, (p) => {
          // Someone dropped/left. Do NOT end the session — you stay in the call
          // (Meet-style); the clock keeps counting down. Just remove their tile
          // and clear their screen share if it was theirs.
          dropParticipant(p);
          setScreenShare((cur) => (cur && cur.name === (p.name || p.identity) ? null : cur));
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
      // We're in the room — the call has started (Meet-style: one person is
      // enough). Show our own video + controls immediately, not a blocking
      // "connecting" overlay.
      setCallState("connected");
      // Record real attendance now that we're actually connected (not on lobby
      // preview / token request) — this decides completed vs no-show.
      api.post(`/bookings/${bookingId}/mark-joined/`).catch(() => {});
      // Pick up anyone already in the room (they joined first) — seed their tiles
      // and mark the call active.
      if (room.remoteParticipants && room.remoteParticipants.size > 0) {
        room.remoteParticipants.forEach((p) => upsertParticipant(p));
        markConnected();
      }
    } catch (err) {
      // Only a genuine connection/token/network failure lands here.
      const detail = err?.response?.data?.detail;
      toast.error(detail || "Could not connect to the session. Please check your internet and try again.");
      cleanup();
      setCallState("idle");
      return;
    }

    // We're in the room — turn on our media. The session clock does NOT start
    // here: it begins only once the other participant is also present (see
    // markConnected), so it never counts down while you're waiting alone.
    await enableMedia();
  }, [bookingId, startTimer, finishSession, cleanup, enableMedia, upsertParticipant, dropParticipant, setParticipantTrack]);

  const handleEndCall = useCallback(() => {
    // With the rejoin window (N3), leaving never auto-completes a session that's
    // still within its window — it stays open so either side can reconnect and
    // continue on the same link. The coach always gets an explicit choice: finish
    // now (complete + AI summary) or just step out and keep it open.
    if (user?.role === "coach") { setEndConfirm(true); return; }
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
  // Coach is the host → joins straight away. Client → requests admission and
  // waits in the lobby until the coach lets them in.
  const joinFromLobby = async () => {
    if (isCoachUser) {
      stopPreview(); // free the devices so LiveKit can acquire them cleanly
      // Give the camera a moment to fully release — re-acquiring it too quickly
      // can hand LiveKit a frozen track (self video stuck / peers see black).
      await new Promise((r) => setTimeout(r, 200));
      handleJoin();
      return;
    }
    setCallState("waiting");  // the preview effect releases the camera here
    try {
      const res = await api.post(`/bookings/${bookingId}/request-join/`);
      setCoachPresent(!!res.data.coach_present);
      // Admission isn't persistent — the coach admits every join. The waiting
      // poll below takes it from here.
    } catch {
      toast.error("Couldn't reach the session. Please try again.");
      setCallState("idle");
    }
  };

  // While waiting for admission, poll until the coach admits (or denies) us.
  useEffect(() => {
    if (callState !== "waiting") return undefined;
    let active = true;
    const tick = async () => {
      try {
        const res = await api.get(`/bookings/${bookingId}/join-status/`);
        if (!active) return;
        setCoachPresent(!!res.data.coach_present);
        if (res.data.status === "admitted") { active = false; handleJoin(); }
        else if (res.data.status === "denied") {
          active = false;
          toast.info("The coach didn't let you in this time. You can ask again.");
          setCallState("idle");
        }
      } catch { /* transient — keep polling */ }
    };
    const id = setInterval(tick, 2500);
    tick();
    return () => { active = false; clearInterval(id); };
  }, [callState, bookingId, handleJoin]);

  // Coach (host): while in the call, poll for a client waiting to be admitted.
  useEffect(() => {
    if (!isCoachUser) return undefined;
    const inCallNow = callState === "connected" || callState === "connecting";
    if (!inCallNow) return undefined;
    let active = true;
    const tick = async () => {
      try {
        const res = await api.get(`/bookings/${bookingId}/pending-joins/`);
        if (active) setPendingJoin(res.data.waiting ? (res.data.client_name || "A student") : null);
      } catch { /* transient */ }
    };
    const id = setInterval(tick, 3000);
    tick();
    return () => { active = false; clearInterval(id); };
  }, [isCoachUser, callState, bookingId]);

  const handleAdmit = useCallback(async () => {
    setAdmitBusy(true);
    try { await api.post(`/bookings/${bookingId}/admit/`); setPendingJoin(null); toast.success("Admitted — they're joining now."); }
    catch { toast.error("Couldn't admit. Please try again."); }
    finally { setAdmitBusy(false); }
  }, [bookingId]);

  const handleDeny = useCallback(async () => {
    setAdmitBusy(true);
    try { await api.post(`/bookings/${bookingId}/deny/`); setPendingJoin(null); }
    catch { toast.error("Couldn't update. Please try again."); }
    finally { setAdmitBusy(false); }
  }, [bookingId]);

  // ── Guest invites (N4) — coach only ─────────────────────────────────────────
  const buildGuestLink = useCallback((token) =>
    `${window.location.origin}/session/${bookingId}/guest?t=${token}`, [bookingId]);

  const openInvitePanel = useCallback(async () => {
    setInviteOpen(true);
    if (inviteLink) return;              // already on
    setInviteBusy(true);
    try {
      const { token } = await createGuestInvite(bookingId);
      setInviteLink(buildGuestLink(token));
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Couldn't create an invite link.");
    } finally { setInviteBusy(false); }
  }, [bookingId, inviteLink, buildGuestLink]);

  const stopInvites = useCallback(async () => {
    setInviteBusy(true);
    try { await revokeGuestInvite(bookingId); setInviteLink(""); setGuestWaiting([]); toast.info("Guest link turned off."); }
    catch { toast.error("Couldn't turn the link off."); }
    finally { setInviteBusy(false); }
  }, [bookingId]);

  const copyInviteLink = useCallback(async () => {
    try { await navigator.clipboard.writeText(inviteLink); toast.success("Link copied."); }
    catch { toast.error("Couldn't copy — select and copy the link manually."); }
  }, [inviteLink]);

  const admitGuestFn = useCallback(async (uid) => {
    setGuestBusy(uid);
    try { await admitGuestApi(bookingId, uid); setGuestWaiting((w) => w.filter((g) => g.guest_uid !== uid)); toast.success("Guest admitted."); }
    catch { toast.error("Couldn't admit the guest."); }
    finally { setGuestBusy(""); }
  }, [bookingId]);

  const denyGuestFn = useCallback(async (uid) => {
    setGuestBusy(uid);
    try { await denyGuestApi(bookingId, uid); setGuestWaiting((w) => w.filter((g) => g.guest_uid !== uid)); }
    catch { toast.error("Couldn't update."); }
    finally { setGuestBusy(""); }
  }, [bookingId]);

  const removeGuestFn = useCallback(async (identity) => {
    try { await removeGuestApi(bookingId, identity); toast.info("Guest removed."); }
    catch { toast.error("Couldn't remove the guest."); }
  }, [bookingId]);

  // Coach polls for guests waiting to be admitted (while in the call).
  useEffect(() => {
    if (!isCoachUser) return undefined;
    const inCallNow = callState === "connected" || callState === "connecting";
    if (!inCallNow) return undefined;
    let active = true;
    const tick = async () => {
      try {
        const res = await getGuestPending(bookingId);
        if (!active) return;
        const waiting = res.waiting || [];
        // Nudge the coach when a genuinely new guest starts waiting.
        const newcomers = waiting.filter((g) => !knownGuestUidsRef.current.has(g.guest_uid));
        if (newcomers.length) toast.info(`${newcomers.map((g) => g.name).join(", ")} ${newcomers.length > 1 ? "want" : "wants"} to join`);
        knownGuestUidsRef.current = new Set(waiting.map((g) => g.guest_uid));
        setGuestWaiting(waiting);
        // Reflect the server's link state (e.g. link was never turned on).
        if (!res.link_active && inviteLink) setInviteLink("");
      } catch { /* transient */ }
    };
    const id = setInterval(tick, 3000);
    tick();
    return () => { active = false; clearInterval(id); };
  }, [isCoachUser, callState, bookingId, inviteLink]);

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
        if (bgOption !== "none") await applyBackground(getLocalVideoTrack(roomRef.current), bgOption, customBgRef.current);
      } else {
        localVideoTrackRef.current = null;
      }
    } catch { /* noop */ }
  };

  const toggleScreenShare = async () => {
    const room = roomRef.current;
    if (!room) return;
    setScreenBusy(true);
    try {
      await room.localParticipant.setScreenShareEnabled(!screenSharing);
      // screenSharing state is synced via LocalTrackPublished/Unpublished.
    } catch (err) {
      // The browser picker being cancelled throws NotAllowedError — ignore it.
      if (err?.name !== "NotAllowedError" && err?.name !== "AbortError") {
        toast.error("Couldn't share your screen. Please try again.");
      }
    } finally { setScreenBusy(false); }
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
      if (bgOption !== "none") await applyBackground(getLocalVideoTrack(room), bgOption, customBgRef.current);
    } catch { /* noop */ }
  }, [bgOption]);

  // Watchdog: only recover a camera track that has actually STOPPED (ended).
  // We deliberately do NOT react to `muted` — the browser mutes the track when
  // the tab is backgrounded or momentarily, and restarting then caused churn /
  // a black self-view. A truly ended track is the only reliable "restart" signal.
  useEffect(() => {
    const active = callState === "connected" || callState === "connecting";
    if (!active || !camOn) return undefined;
    const id = setInterval(() => {
      const mst = localVideoTrackRef.current?.mediaStreamTrack;
      if (mst && mst.readyState === "ended") restartCamera();
    }, 4000);
    return () => clearInterval(id);
  }, [callState, camOn, restartCamera]);

  const isTimeLow = timeLeft !== null && timeLeft <= 300;
  const inCall = callState === "connecting" || callState === "connected";
  // Multi-party derived layout (N4).
  const remoteList = Object.entries(remotes);
  const remotePresent = remoteList.length > 0 || !!screenShare;
  const cols = remoteList.length <= 1 ? 1 : remoteList.length <= 4 ? 2 : 3;
  const spacious = remoteList.length <= 1 && !screenShare; // keep the classic 1:1 look for a single remote
  const guestsInCall = remoteList.filter(([, data]) => (data.identity || "").startsWith("guest-")); // N4: removable guests

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen" style={{ background: "#0D0D0D" }}>
      <div className="w-10 h-10 rounded-full border-2 animate-spin" style={{ borderColor: "#C8A951", borderTopColor: "transparent" }} />
    </div>
  );

  // Session was ended/finalised but is still within its rejoin window (N3):
  // offer to reconnect on the same link and continue.
  if (needsResume) return (
    <div className="flex items-center justify-center min-h-screen px-6" style={{ background: "#0D0D0D" }}>
      <div className="w-full max-w-md text-center p-8 rounded-2xl" style={{ background: "rgba(20,33,61,0.6)", border: "1px solid rgba(200,169,81,0.25)" }}>
        <div className="w-14 h-14 mx-auto mb-5 rounded-full flex items-center justify-center" style={{ background: "rgba(200,169,81,0.15)" }}>
          <FiClock size={24} style={{ color: "#C8A951" }} />
        </div>
        <h2 className="text-xl font-bold text-white mb-2" style={{ fontFamily: "'Playfair Display', serif" }}>Resume this session?</h2>
        <p className="text-sm mb-6" style={{ color: "rgba(255,255,255,0.65)" }}>
          The scheduled time has passed, but you can reconnect on the same link and continue where you left off.
        </p>
        <button
          onClick={handleResume}
          disabled={resuming}
          className="w-full py-3 rounded-xl font-bold transition-all disabled:opacity-60 mb-3"
          style={{ background: "#C8A951", color: "#14213D" }}
        >
          {resuming ? "Resuming…" : "Resume session"}
        </button>
        <button onClick={() => navigate(-1)} className="text-sm font-semibold" style={{ color: "rgba(255,255,255,0.55)" }}>
          Not now
        </button>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-x-0 bottom-0 flex flex-col select-none overflow-hidden" style={{ top: "7rem", background: "#0D0D0D" }}>

      {/* Remote participants + any shared screen (multi-party, N4). Sits behind
          the top bar / controls (z-0). A single remote keeps the classic
          full-bleed 1:1 look; 2+ remotes tile into a grid; a shared screen
          becomes the main view with participants as a strip underneath. */}
      {inCall && remotePresent && (
        <div className="absolute inset-0 z-0">
          {screenShare ? (
            <div className="absolute inset-0 flex flex-col">
              <div className="flex-1 min-h-0"><ScreenView track={screenShare.track} name={screenShare.name} /></div>
              {remoteList.length > 0 && (
                <div className="shrink-0 h-24 sm:h-28 flex gap-2 p-2 overflow-x-auto">
                  {remoteList.map(([sid, data]) => (
                    <div key={sid} className="h-full aspect-video shrink-0"><RemoteTile data={data} /></div>
                  ))}
                </div>
              )}
            </div>
          ) : spacious ? (
            <div className="absolute inset-0">
              {remoteList.map(([sid, data]) => <RemoteTile key={sid} data={data} spacious />)}
            </div>
          ) : (
            <div className="absolute inset-0 grid gap-2 p-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))`, gridAutoRows: "1fr" }}>
              {remoteList.map(([sid, data]) => <RemoteTile key={sid} data={data} />)}
            </div>
          )}
        </div>
      )}

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
                <FiVideo size={20} /> {isCoachUser ? "Join now" : "Ask to join"}
              </motion.button>
              <p className="text-xs mt-4" style={{ color: "rgba(255,255,255,0.4)" }}>
                {previewError
                  ? "You can still join — you'll be able to turn your camera on once you're in."
                  : isCoachUser
                    ? "You're the host — the session starts when you join."
                    : "The coach will let you in once you ask to join."}
              </p>
            </motion.div>
          </div>
        )}

        {/* Client waiting to be admitted by the coach (host) */}
        {callState === "waiting" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
            <div className="w-20 h-20 rounded-full mb-5 flex items-center justify-center" style={{ background: "rgba(200,169,81,0.15)", border: "1px solid rgba(200,169,81,0.3)" }}>
              <FiClock size={30} style={{ color: "#C8A951" }} />
            </div>
            <p className="text-white font-semibold mb-1.5 text-lg">
              {coachPresent ? "Waiting for the coach to let you in…" : "Waiting for the coach to start the session…"}
            </p>
            <p className="text-sm mb-5" style={{ color: "rgba(255,255,255,0.5)" }}>
              {coachPresent
                ? "The coach has been notified. You'll join as soon as they admit you."
                : "You'll be let in once the coach joins and admits you."}
            </p>
            <div className="flex gap-2 justify-center mb-6">
              {[0, 1, 2].map(i => (
                <div key={i} className="w-2.5 h-2.5 rounded-full animate-bounce" style={{ background: "#C8A951", animationDelay: `${i * 0.18}s` }} />
              ))}
            </div>
            <button onClick={() => setCallState("idle")}
              className="px-5 py-2 rounded-full text-sm font-semibold" style={{ background: "rgba(255,255,255,0.1)", color: "white", border: "1px solid rgba(255,255,255,0.15)" }}>
              Cancel
            </button>
          </div>
        )}

        {/* Briefly connecting to the room */}
        {callState === "connecting" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
            <div className="w-16 h-16 rounded-full mb-4 flex items-center justify-center animate-pulse" style={{ background: "rgba(200,169,81,0.15)" }}>
              <FiVideo size={26} style={{ color: "#C8A951" }} />
            </div>
            <p className="text-white/80 text-sm">Connecting…</p>
          </div>
        )}

        {/* You're in the call, alone — the session has started (Meet-style) */}
        {callState === "connected" && !remotePresent && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
            <div className="w-20 h-20 rounded-full mb-5 flex items-center justify-center text-3xl font-bold" style={{ background: "#C8A951", color: "#14213D" }}>
              {booking?.skill_title?.charAt(0)}
            </div>
            <p className="text-white font-semibold mb-1.5 text-lg">You're in the session</p>
            <p className="text-sm mb-4" style={{ color: "rgba(255,255,255,0.5)" }}>Waiting for the other participant to join…</p>
            <div className="flex gap-2 justify-center">
              {[0, 1, 2].map(i => (
                <div key={i} className="w-2.5 h-2.5 rounded-full animate-bounce" style={{ background: "#C8A951", animationDelay: `${i * 0.18}s` }} />
              ))}
            </div>
          </div>
        )}

        {/* (A remote whose camera is off shows its own "Camera is off" tile via
            RemoteTile, so no separate full-screen overlay is needed here.) */}

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

        {/* Coach (host): a client is waiting to be let in — Admit / Deny */}
        <AnimatePresence>
          {inCall && isCoachUser && pendingJoin && (
            <motion.div
              initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}
              className="absolute top-4 left-1/2 -translate-x-1/2 z-30 w-[92%] max-w-md rounded-2xl p-4 shadow-2xl"
              style={{ background: "rgba(255,255,255,0.98)", border: "1px solid rgba(200,169,81,0.4)" }}
            >
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-sm font-bold" style={{ background: "#C8A951", color: "#14213D" }}>
                  {pendingJoin.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold" style={{ color: "#1B2B4A" }}>{pendingJoin} wants to join</p>
                  <p className="text-xs mt-0.5" style={{ color: "#4A5568" }}>They're waiting in the lobby.</p>
                  <div className="flex items-center gap-2 mt-3">
                    <button onClick={handleAdmit} disabled={admitBusy}
                      className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold disabled:opacity-60"
                      style={{ background: "linear-gradient(135deg,#C8A951,#F0D98C)", color: "#14213D" }}>
                      Admit
                    </button>
                    <button onClick={handleDeny} disabled={admitBusy}
                      className="px-4 py-1.5 rounded-full text-xs font-semibold disabled:opacity-60" style={{ background: "rgba(239,68,68,0.1)", color: "#B91C1C" }}>
                      Deny
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

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
          {isTimeLow && timeLeft > 0 && !overtime && callState === "connected" && (
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

          {canScreenShare && (
            <button onClick={toggleScreenShare} disabled={screenBusy}
              className="w-11 h-11 sm:w-12 sm:h-12 rounded-full flex items-center justify-center transition-all disabled:opacity-50"
              style={{ background: screenSharing ? "rgba(200,169,81,0.9)" : "rgba(255,255,255,0.1)" }}
              title={screenSharing ? "Stop sharing your screen" : "Share your screen"}>
              <FiMonitor size={18} style={{ color: screenSharing ? "#14213D" : "white" }} />
            </button>
          )}

          {/* Invite a guest (N4) — coach only */}
          {isCoachUser && (
            <button onClick={openInvitePanel}
              className="relative w-11 h-11 sm:w-12 sm:h-12 rounded-full flex items-center justify-center transition-all"
              style={{ background: inviteLink ? "rgba(200,169,81,0.9)" : "rgba(255,255,255,0.1)" }}
              title="Invite someone to this call">
              <FiUserPlus size={18} style={{ color: inviteLink ? "#14213D" : "white" }} />
              {guestWaiting.length > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center" style={{ background: "#EF4444", color: "white" }}>
                  {guestWaiting.length}
                </span>
              )}
            </button>
          )}

          {/* Share a document — opens the picker, then the chat with it staged */}
          <input type="file" ref={docInputRef} className="hidden"
            onChange={(e) => { handleChatFile(e); setChatOpen(true); }} />
          <button onClick={() => docInputRef.current?.click()}
            className="w-11 h-11 sm:w-12 sm:h-12 rounded-full flex items-center justify-center transition-all"
            style={{ background: "rgba(255,255,255,0.1)" }} title="Share a document">
            <FiPaperclip size={18} className="text-white" />
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

      {/* ── Invite-a-guest modal (N4) — coach only ───────────────── */}
      <AnimatePresence>
        {inviteOpen && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }}
            onClick={() => setInviteOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.96, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-2xl p-5" style={{ background: "#14213D", border: "1px solid rgba(200,169,81,0.3)" }}
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-white font-bold text-lg" style={{ fontFamily: "'Playfair Display', serif" }}>Invite to this call</h3>
                <button onClick={() => setInviteOpen(false)} className="p-1" style={{ color: "rgba(255,255,255,0.6)" }}><FiX size={18} /></button>
              </div>

              {inviteBusy && !inviteLink ? (
                <p className="text-sm py-4 text-center" style={{ color: "rgba(255,255,255,0.6)" }}>Creating link…</p>
              ) : inviteLink ? (
                <>
                  <p className="text-xs mb-2" style={{ color: "rgba(255,255,255,0.55)" }}>Share this link. Anyone who opens it can ask to join — you'll admit them.</p>
                  <div className="flex items-center gap-2 mb-3">
                    <input readOnly value={inviteLink} className="flex-1 px-3 py-2 rounded-lg text-xs text-white truncate outline-none" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }} />
                    <button onClick={copyInviteLink} className="px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 shrink-0" style={{ background: "#C8A951", color: "#14213D" }}><FiCopy size={13} />Copy</button>
                  </div>
                  <div className="flex gap-2 mb-4">
                    <a href={`https://wa.me/?text=${encodeURIComponent("Join my session: " + inviteLink)}`} target="_blank" rel="noreferrer" className="flex-1 text-center px-3 py-2 rounded-lg text-xs font-semibold text-white" style={{ background: "rgba(255,255,255,0.08)" }}>WhatsApp</a>
                    <a href={`mailto:?subject=${encodeURIComponent("Join my session")}&body=${encodeURIComponent("Join my session: " + inviteLink)}`} className="flex-1 text-center px-3 py-2 rounded-lg text-xs font-semibold text-white" style={{ background: "rgba(255,255,255,0.08)" }}>Email</a>
                    {typeof navigator !== "undefined" && navigator.share && (
                      <button onClick={() => navigator.share({ title: "Join my session", text: inviteLink }).catch(() => {})} className="flex-1 px-3 py-2 rounded-lg text-xs font-semibold text-white" style={{ background: "rgba(255,255,255,0.08)" }}>Share…</button>
                    )}
                  </div>
                  <button onClick={stopInvites} disabled={inviteBusy} className="text-xs font-semibold mb-4" style={{ color: "#F87171" }}>Turn off guest link</button>
                </>
              ) : (
                <button onClick={openInvitePanel} className="w-full py-2.5 rounded-lg text-sm font-bold mb-4" style={{ background: "#C8A951", color: "#14213D" }}>Create invite link</button>
              )}

              {guestWaiting.length > 0 && (
                <div className="mb-3 pt-3" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                  <p className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: "rgba(255,255,255,0.5)" }}>Waiting to join</p>
                  {guestWaiting.map((g) => (
                    <div key={g.guest_uid} className="flex items-center justify-between gap-2 py-1.5">
                      <span className="text-sm text-white truncate">{g.name}</span>
                      <div className="flex gap-1.5 shrink-0">
                        <button onClick={() => admitGuestFn(g.guest_uid)} disabled={guestBusy === g.guest_uid} className="px-3 py-1 rounded-full text-xs font-bold disabled:opacity-50" style={{ background: "#C8A951", color: "#14213D" }}>Admit</button>
                        <button onClick={() => denyGuestFn(g.guest_uid)} disabled={guestBusy === g.guest_uid} className="px-3 py-1 rounded-full text-xs font-semibold text-white disabled:opacity-50" style={{ background: "rgba(255,255,255,0.1)" }}>Deny</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {guestsInCall.length > 0 && (
                <div className="pt-3" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                  <p className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: "rgba(255,255,255,0.5)" }}>In the call</p>
                  {guestsInCall.map(([sid, data]) => (
                    <div key={sid} className="flex items-center justify-between gap-2 py-1.5">
                      <span className="text-sm text-white truncate">{data.name}</span>
                      <button onClick={() => removeGuestFn(data.identity)} className="p-1.5 rounded-full" style={{ background: "rgba(239,68,68,0.15)" }} title="Remove from call"><FiTrash2 size={13} style={{ color: "#F87171" }} /></button>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
