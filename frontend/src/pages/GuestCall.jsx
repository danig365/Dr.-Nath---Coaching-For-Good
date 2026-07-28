import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { toast } from "react-toastify";
import {
  FiMic, FiMicOff, FiVideo, FiVideoOff, FiPhoneOff, FiMonitor, FiClock, FiAlertTriangle, FiRefreshCw,
} from "react-icons/fi";
import { Room, RoomEvent, Track } from "livekit-client";
import { RemoteTile, ScreenView } from "../components/CallTiles";
import { requestGuestJoin, getGuestJoinStatus, getGuestCallToken } from "../utils/livekit";
import { diag, logMicTrackSettings } from "../utils/callDiagnostics";

// Public join page for a guest the coach invited into a 1:1 call (N4). No
// account needed: the guest enters a name, asks to join, and — once the coach
// admits them — connects to the same room as an extra participant.
export default function GuestCall() {
  const { bookingId } = useParams();
  const [params] = useSearchParams();
  const linkToken = params.get("t") || "";

  const [stage, setStage] = useState("lobby"); // lobby | waiting | connecting | connected | ended | error
  const [name, setName] = useState("");
  const [coachPresent, setCoachPresent] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [previewError, setPreviewError] = useState("");
  const [mediaError, setMediaError] = useState("");
  const [remotes, setRemotes] = useState({});
  const [screenShare, setScreenShare] = useState(null);
  const [screenSharing, setScreenSharing] = useState(false);
  const [screenBusy, setScreenBusy] = useState(false);
  const [canScreenShare] = useState(() =>
    typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia);
  const [asking, setAsking] = useState(false);

  const guestUidRef = useRef(null);
  const roomRef = useRef(null);
  const previewRef = useRef(null);
  const previewStreamRef = useRef(null);
  const localVideoRef = useRef(null);
  const localVideoTrackRef = useRef(null);
  const camWantRef = useRef(true);
  const micWantRef = useRef(true);

  const inCall = stage === "connecting" || stage === "connected";
  const remoteList = Object.entries(remotes);
  const remotePresent = remoteList.length > 0 || !!screenShare;
  const cols = remoteList.length <= 1 ? 1 : remoteList.length <= 4 ? 2 : 3;
  const spacious = remoteList.length <= 1 && !screenShare;

  // ── Lobby camera/mic preview ────────────────────────────────────────────────
  const stopPreview = useCallback(() => {
    if (previewStreamRef.current) { previewStreamRef.current.getTracks().forEach((t) => t.stop()); previewStreamRef.current = null; }
    if (previewRef.current) previewRef.current.srcObject = null;
  }, []);

  const startPreview = useCallback(async () => {
    setPreviewError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      previewStreamRef.current = stream;
      if (previewRef.current) previewRef.current.srcObject = stream;
      stream.getVideoTracks().forEach((t) => (t.enabled = camWantRef.current));
      stream.getAudioTracks().forEach((t) => (t.enabled = micWantRef.current));
    } catch {
      setPreviewError("We couldn't access your camera or microphone. You can still join and turn them on later.");
    }
  }, []);

  useEffect(() => {
    if (stage === "lobby") startPreview();
    return () => stopPreview();
  }, [stage, startPreview, stopPreview]);

  const toggleLobbyCam = () => {
    const next = !camOn; setCamOn(next); camWantRef.current = next;
    previewStreamRef.current?.getVideoTracks().forEach((t) => (t.enabled = next));
  };
  const toggleLobbyMic = () => {
    const next = !micOn; setMicOn(next); micWantRef.current = next;
    previewStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = next));
  };

  // ── Remote bookkeeping ──────────────────────────────────────────────────────
  const upsert = useCallback((p) => {
    setRemotes((prev) => ({ ...prev, [p.sid]: { ...(prev[p.sid] || {}), name: p.name || p.identity, identity: p.identity } }));
  }, []);
  const drop = useCallback((p) => {
    setRemotes((prev) => { const n = { ...prev }; delete n[p.sid]; return n; });
  }, []);
  const setTrack = useCallback((p, track, attach) => {
    setRemotes((prev) => {
      const entry = { ...(prev[p.sid] || { name: p.name || p.identity, identity: p.identity }) };
      entry[track.kind === Track.Kind.Video ? "videoTrack" : "audioTrack"] = attach ? track : undefined;
      return { ...prev, [p.sid]: entry };
    });
  }, []);

  const cleanup = useCallback(() => {
    if (roomRef.current) { try { roomRef.current.disconnect(); } catch { /* noop */ } roomRef.current = null; }
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    setRemotes({}); setScreenShare(null); setScreenSharing(false);
  }, []);

  // ── Connect once admitted ───────────────────────────────────────────────────
  const connect = useCallback(async () => {
    setStage("connecting");
    let room;
    try {
      const { url, token } = await getGuestCallToken(bookingId, guestUidRef.current, linkToken);
      room = new Room({
        adaptiveStream: true, dynacast: true, disconnectOnPageLeave: false,
        audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        // Publish audio exactly like the coach/client pages do (this page was
        // previously falling back to the library defaults, so a guest's voice was
        // encoded differently from everyone else's on the same call): voice-tuned
        // bitrate, RED redundancy against packet loss, DTX off for a continuous
        // stream. See SessionCallLiveKit for the reasoning.
        publishDefaults: { audioPreset: { maxBitrate: 32_000 }, red: true, dtx: false },
      });
      roomRef.current = room;
      diag("join", "guest room created", { url });
      room
        .on(RoomEvent.ParticipantConnected, upsert)
        .on(RoomEvent.TrackSubscribed, (track, pub, p) => {
          if (pub?.source === Track.Source.ScreenShare) setScreenShare({ track, name: p?.name || p?.identity });
          else setTrack(p, track, true);
        })
        .on(RoomEvent.TrackUnsubscribed, (track, pub, p) => {
          if (pub?.source === Track.Source.ScreenShare) setScreenShare((cur) => (cur && cur.track === track ? null : cur));
          else setTrack(p, track, false);
        })
        .on(RoomEvent.LocalTrackPublished, (pub) => {
          if (pub.source === Track.Source.ScreenShare) { setScreenSharing(true); return; }
          if (pub.track?.kind === Track.Kind.Video) {
            localVideoTrackRef.current = pub.track;
            if (localVideoRef.current) pub.track.attach(localVideoRef.current);
          }
        })
        .on(RoomEvent.LocalTrackUnpublished, (pub) => { if (pub.source === Track.Source.ScreenShare) setScreenSharing(false); })
        .on(RoomEvent.ParticipantDisconnected, (p) => {
          drop(p);
          setScreenShare((cur) => (cur && cur.name === (p.name || p.identity) ? null : cur));
        })
        // Diagnostics, so a guest reporting bad audio leaves the same evidence
        // trail as the coach and client pages.
        .on(RoomEvent.ConnectionQualityChanged, (quality, p) => diag("net", "connection quality", {
          quality, who: p?.identity === room.localParticipant?.identity ? "local" : (p?.identity || "remote"),
        }))
        .on(RoomEvent.Reconnecting, () => diag("net", "reconnecting"))
        .on(RoomEvent.Reconnected, () => diag("net", "reconnected"))
        .on(RoomEvent.MediaDevicesError, (e) => diag("mic", "media devices error", { name: e?.name }))
        .on(RoomEvent.LocalAudioSilenceDetected, () => diag("mic", "LOCAL AUDIO SILENCE DETECTED"));
      await room.connect(url, token);
      diag("join", "guest connected", { name: room.name });
      setStage("connected");
      room.remoteParticipants.forEach((p) => upsert(p));
      // Publish our media (fail-soft — a permission problem must not drop us).
      try {
        // Microphone first and on its own (parity with the coach/client pages):
        // the audio device is acquired before the camera so a slow or failing
        // camera can never disturb the capture the conversation depends on.
        await room.localParticipant.setMicrophoneEnabled(micWantRef.current);
        logMicTrackSettings(
          room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track?.mediaStreamTrack,
          "guest after acquire");
        await room.localParticipant.setCameraEnabled(camWantRef.current);
        const camPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
        localVideoTrackRef.current = camPub?.track || null;
        camPub?.track?.attach(localVideoRef.current);
        setCamOn(camWantRef.current); setMicOn(micWantRef.current);
      } catch {
        setMediaError("Camera / microphone need permission. You can still see and hear the others.");
        setCamOn(false);
      }
    } catch (err) {
      const detail = err?.response?.data?.detail;
      toast.error(detail || "Couldn't join the call. Please try again.");
      cleanup();
      setStage("lobby");
    }
  }, [bookingId, linkToken, upsert, drop, setTrack, cleanup]);

  // ── Ask to join → poll for admission ────────────────────────────────────────
  const askToJoin = useCallback(async () => {
    if (!name.trim()) { toast.error("Please enter your name."); return; }
    setAsking(true);
    try {
      const { guest_uid } = await requestGuestJoin(bookingId, linkToken, name.trim());
      guestUidRef.current = guest_uid;
      stopPreview();
      setStage("waiting");
    } catch (err) {
      const detail = err?.response?.data?.detail;
      if (err?.response?.status === 403) { setErrorMsg(detail || "This guest link is invalid or has expired."); setStage("error"); }
      else toast.error(detail || "Couldn't ask to join. Please try again.");
    } finally { setAsking(false); }
  }, [bookingId, linkToken, name, stopPreview]);

  useEffect(() => {
    if (stage !== "waiting") return undefined;
    let active = true;
    const poll = async () => {
      try {
        const res = await getGuestJoinStatus(bookingId, guestUidRef.current);
        if (!active) return;
        setCoachPresent(!!res.coach_present);
        if (res.status === "admitted") { active = false; connect(); }
        else if (res.status === "denied") { active = false; toast.info("The coach didn't let you in."); setStage("lobby"); }
      } catch { /* keep polling */ }
    };
    poll();
    const id = setInterval(poll, 3000);
    return () => { active = false; clearInterval(id); };
  }, [stage, bookingId, connect]);

  useEffect(() => () => { cleanup(); stopPreview(); }, [cleanup, stopPreview]);

  // Bind the local PiP.
  useEffect(() => {
    if (!inCall || !camOn) return undefined;
    let tries = 0;
    const attach = () => {
      const t = localVideoTrackRef.current, el = localVideoRef.current;
      if (t && el) { try { t.attach(el); } catch { /* noop */ } return true; }
      return false;
    };
    if (attach()) return undefined;
    const id = setInterval(() => { tries += 1; if (attach() || tries > 12) clearInterval(id); }, 350);
    return () => clearInterval(id);
  }, [camOn, inCall, remotes, screenShare]);

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
        localVideoTrackRef.current = camPub?.track || null;
        camPub?.track?.attach(localVideoRef.current);
      } else localVideoTrackRef.current = null;
    } catch { /* noop */ }
  };
  const toggleScreenShare = async () => {
    const room = roomRef.current; if (!room) return;
    setScreenBusy(true);
    try { await room.localParticipant.setScreenShareEnabled(!screenSharing); }
    catch (err) { if (err?.name !== "NotAllowedError" && err?.name !== "AbortError") toast.error("Couldn't share your screen."); }
    finally { setScreenBusy(false); }
  };
  const leave = () => { cleanup(); setStage("ended"); };

  // ── Render ──────────────────────────────────────────────────────────────────
  if (stage === "error") return (
    <Centered>
      <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ background: "rgba(239,68,68,0.15)" }}>
        <FiAlertTriangle size={26} style={{ color: "#F87171" }} />
      </div>
      <p className="text-white font-semibold mb-1 text-lg">Can't join this session</p>
      <p className="text-sm text-center max-w-sm" style={{ color: "rgba(255,255,255,0.5)" }}>{errorMsg}</p>
    </Centered>
  );

  if (stage === "ended") return (
    <Centered>
      <div className="w-20 h-20 rounded-full flex items-center justify-center mb-4" style={{ background: "rgba(200,169,81,0.15)", border: "1px solid rgba(200,169,81,0.3)" }}>
        <FiClock size={30} style={{ color: "#C8A951" }} />
      </div>
      <p className="text-2xl font-normal text-white mb-1" style={{ fontFamily: "'Playfair Display', serif" }}>You've left the call</p>
      <p className="text-sm" style={{ color: "rgba(255,255,255,0.4)" }}>You can close this tab, or rejoin from your link.</p>
    </Centered>
  );

  if (stage === "lobby") return (
    <Centered>
      <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="w-full max-w-md text-center">
        <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: "#C8A951" }}>Guest</p>
        <h1 className="text-2xl md:text-3xl font-normal text-white mb-1" style={{ fontFamily: "'Playfair Display', serif" }}>Join the session</h1>
        <p className="text-xs mb-5" style={{ color: "rgba(255,255,255,0.4)" }}>Check your camera &amp; mic, then ask the coach to let you in.</p>

        <div className="relative rounded-2xl overflow-hidden mb-4" style={{ background: "#0b1220", aspectRatio: "4 / 3", border: "1px solid rgba(255,255,255,0.1)" }}>
          <video ref={previewRef} autoPlay playsInline muted className="w-full h-full object-cover" style={{ transform: "scaleX(-1)", display: camOn && !previewError ? "block" : "none" }} />
          {(!camOn || previewError) && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
              <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: "rgba(200,169,81,0.18)" }}>
                <FiVideoOff size={22} style={{ color: "#C8A951" }} />
              </div>
              <p className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>{previewError ? "Camera unavailable" : "Camera off"}</p>
            </div>
          )}
        </div>

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

        <div className="flex items-center justify-center gap-3 mb-4">
          <button onClick={toggleLobbyMic} disabled={!!previewError} className="w-12 h-12 rounded-full flex items-center justify-center disabled:opacity-40" style={{ background: micOn ? "rgba(255,255,255,0.1)" : "#EF4444" }}>
            {micOn ? <FiMic size={18} className="text-white" /> : <FiMicOff size={18} className="text-white" />}
          </button>
          <button onClick={toggleLobbyCam} disabled={!!previewError} className="w-12 h-12 rounded-full flex items-center justify-center disabled:opacity-40" style={{ background: camOn ? "rgba(255,255,255,0.1)" : "#EF4444" }}>
            {camOn ? <FiVideo size={18} className="text-white" /> : <FiVideoOff size={18} className="text-white" />}
          </button>
        </div>

        <input
          value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Your name"
          onKeyDown={(e) => e.key === "Enter" && askToJoin()}
          className="w-full px-4 py-3 rounded-xl mb-4 text-white text-center outline-none"
          style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.15)" }}
        />

        <motion.button
          whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }} onClick={askToJoin} disabled={asking}
          className="flex items-center justify-center gap-3 w-full px-10 py-4 rounded-full text-base font-bold shadow-lg disabled:opacity-60"
          style={{ background: "linear-gradient(135deg,#C8A951,#F0D98C)", color: "#14213D" }}
        >
          <FiVideo size={20} /> {asking ? "Please wait…" : "Ask to join"}
        </motion.button>
        <p className="text-xs mt-4" style={{ color: "rgba(255,255,255,0.4)" }}>The coach will let you in once you ask to join.</p>
      </motion.div>
    </Centered>
  );

  if (stage === "waiting") return (
    <Centered>
      <div className="w-20 h-20 rounded-full mb-5 flex items-center justify-center" style={{ background: "rgba(200,169,81,0.15)", border: "1px solid rgba(200,169,81,0.3)" }}>
        <FiClock size={30} style={{ color: "#C8A951" }} />
      </div>
      <p className="text-white font-semibold mb-1.5 text-lg">
        {coachPresent ? "Waiting for the coach to let you in…" : "Waiting for the coach…"}
      </p>
      <p className="text-sm mb-5 text-center max-w-sm" style={{ color: "rgba(255,255,255,0.5)" }}>
        The coach has been notified. You'll join as soon as they admit you.
      </p>
      <div className="flex gap-2 justify-center">
        {[0, 1, 2].map((i) => <div key={i} className="w-2.5 h-2.5 rounded-full animate-bounce" style={{ background: "#C8A951", animationDelay: `${i * 0.18}s` }} />)}
      </div>
    </Centered>
  );

  // connecting / connected
  return (
    <div className="fixed inset-0 flex flex-col select-none overflow-hidden" style={{ background: "#0D0D0D" }}>
      {/* Remote area */}
      {remotePresent ? (
        <div className="absolute inset-0 z-0">
          {screenShare ? (
            <div className="absolute inset-0 flex flex-col">
              <div className="flex-1 min-h-0"><ScreenView track={screenShare.track} name={screenShare.name} /></div>
              {remoteList.length > 0 && (
                <div className="shrink-0 h-24 sm:h-28 flex gap-2 p-2 overflow-x-auto">
                  {remoteList.map(([sid, data]) => <div key={sid} className="h-full aspect-video shrink-0"><RemoteTile data={data} /></div>)}
                </div>
              )}
            </div>
          ) : spacious ? (
            <div className="absolute inset-0">{remoteList.map(([sid, data]) => <RemoteTile key={sid} data={data} spacious />)}</div>
          ) : (
            <div className="absolute inset-0 grid gap-2 p-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))`, gridAutoRows: "1fr" }}>
              {remoteList.map(([sid, data]) => <RemoteTile key={sid} data={data} />)}
            </div>
          )}
        </div>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6 z-0">
          <div className="w-20 h-20 rounded-full mb-4 flex items-center justify-center" style={{ background: "rgba(200,169,81,0.15)" }}>
            <FiVideo size={26} style={{ color: "#C8A951" }} />
          </div>
          <p className="text-white/80 text-sm">{stage === "connecting" ? "Connecting…" : "You're in — waiting for others…"}</p>
        </div>
      )}

      {/* Media banner */}
      {mediaError && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 px-4 py-2 rounded-xl text-sm font-semibold" style={{ background: "rgba(255,255,255,0.97)", color: "#1B2B4A" }}>
          {mediaError}
        </div>
      )}

      {/* Local PiP */}
      <video ref={localVideoRef} autoPlay playsInline muted
        className="absolute bottom-24 right-3 sm:right-4 rounded-xl sm:rounded-2xl object-cover shadow-2xl z-10 w-[96px] h-[128px] sm:w-[168px] sm:h-[126px]"
        style={{ border: "2px solid rgba(255,255,255,0.15)", display: camOn ? "block" : "none" }} />

      {screenSharing && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2.5 px-4 py-2 rounded-full shadow-xl" style={{ background: "rgba(20,33,61,0.92)", border: "1px solid rgba(200,169,81,0.4)" }}>
          <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: "#C8A951" }} />
          <span className="text-xs font-semibold text-white">You're sharing your screen</span>
          <button onClick={toggleScreenShare} disabled={screenBusy} className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: "rgba(239,68,68,0.9)", color: "white" }}>Stop</button>
        </div>
      )}

      {/* Controls */}
      <div className="absolute bottom-0 inset-x-0 flex items-center justify-center gap-4 py-5 z-20" style={{ background: "rgba(0,0,0,0.75)", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <button onClick={toggleMic} className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: micOn ? "rgba(255,255,255,0.1)" : "#EF4444" }}>
          {micOn ? <FiMic size={18} className="text-white" /> : <FiMicOff size={18} className="text-white" />}
        </button>
        <button onClick={toggleCam} className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: camOn ? "rgba(255,255,255,0.1)" : "#EF4444" }}>
          {camOn ? <FiVideo size={18} className="text-white" /> : <FiVideoOff size={18} className="text-white" />}
        </button>
        {canScreenShare && (
          <button onClick={toggleScreenShare} disabled={screenBusy} className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: screenSharing ? "#C8A951" : "rgba(255,255,255,0.1)" }} title="Share screen">
            <FiMonitor size={18} style={{ color: screenSharing ? "#14213D" : "white" }} />
          </button>
        )}
        <button onClick={leave} className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: "#EF4444" }} title="Leave">
          <FiPhoneOff size={18} className="text-white" />
        </button>
      </div>
    </div>
  );
}

function Centered({ children }) {
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center px-6" style={{ background: "#0D0D0D" }}>
      {children}
    </div>
  );
}
