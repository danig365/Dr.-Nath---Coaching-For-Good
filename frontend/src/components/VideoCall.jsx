import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FiVideo, FiVideoOff, FiMic, FiMicOff,
  FiPhoneOff, FiPhone,
} from "react-icons/fi";

const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

export default function VideoCall({ wsRef, signalRef, partnerName, enabled }) {
  const [callState, setCallState] = useState("idle"); // idle | calling | incoming | connected
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [remoteStream, setRemoteStream] = useState(null);

  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const pendingOfferRef = useRef(null);

  const sendSignal = useCallback((signal) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "signal", signal }));
    }
  }, [wsRef]);

  const cleanupCall = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    setRemoteStream(null);
    setCallState("idle");
    setMicOn(true);
    setCamOn(true);
    pendingOfferRef.current = null;
  }, []);

  const createPC = useCallback(() => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    pc.onicecandidate = (e) => {
      if (e.candidate) sendSignal({ type: "ice-candidate", candidate: e.candidate });
    };

    pc.ontrack = (e) => {
      setRemoteStream(e.streams[0]);
    };

    pc.onconnectionstatechange = () => {
      if (["disconnected", "failed", "closed"].includes(pc.connectionState)) {
        cleanupCall();
      }
    };

    pcRef.current = pc;
    return pc;
  }, [sendSignal, cleanupCall]);

  const getMedia = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localStreamRef.current = stream;
    if (localVideoRef.current) localVideoRef.current.srcObject = stream;
    return stream;
  }, []);

  const startCall = useCallback(async () => {
    if (!enabled) return;
    try {
      setCallState("calling");
      const pc = createPC();
      const stream = await getMedia();
      stream.getTracks().forEach(track => pc.addTrack(track, stream));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendSignal({ type: "offer", sdp: pc.localDescription });
    } catch (err) {
      console.error("Start call failed:", err);
      cleanupCall();
    }
  }, [enabled, createPC, getMedia, sendSignal, cleanupCall]);

  const acceptCall = useCallback(async () => {
    const offer = pendingOfferRef.current;
    if (!offer) return;
    try {
      setCallState("connected");
      const pc = createPC();
      const stream = await getMedia();
      stream.getTracks().forEach(track => pc.addTrack(track, stream));
      await pc.setRemoteDescription(new RTCSessionDescription(offer.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendSignal({ type: "answer", sdp: pc.localDescription });
    } catch (err) {
      console.error("Accept call failed:", err);
      cleanupCall();
    }
  }, [createPC, getMedia, sendSignal, cleanupCall]);

  const endCall = useCallback(() => {
    sendSignal({ type: "end-call" });
    cleanupCall();
  }, [sendSignal, cleanupCall]);

  const handleIncomingSignal = useCallback(async (signal) => {
    if (signal.type === "offer") {
      pendingOfferRef.current = signal;
      setCallState("incoming");
    } else if (signal.type === "answer") {
      if (pcRef.current) {
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        setCallState("connected");
      }
    } else if (signal.type === "ice-candidate") {
      if (pcRef.current) {
        try { await pcRef.current.addIceCandidate(new RTCIceCandidate(signal.candidate)); }
        catch (e) { console.warn("ICE candidate error:", e); }
      }
    } else if (signal.type === "end-call") {
      cleanupCall();
    }
  }, [cleanupCall]);

  useEffect(() => {
    signalRef.current = handleIncomingSignal;
  }, [handleIncomingSignal, signalRef]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  // Cleanup on unmount
  useEffect(() => () => cleanupCall(), [cleanupCall]);

  const toggleMic = () => {
    localStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = !micOn; });
    setMicOn(v => !v);
  };

  const toggleCam = () => {
    localStreamRef.current?.getVideoTracks().forEach(t => { t.enabled = !camOn; });
    setCamOn(v => !v);
  };

  if (!enabled) return null;

  return (
    <div className="rounded-3xl bg-white overflow-hidden shadow-sm" style={{ border: "1px solid rgba(200,169,81,0.2)" }}>
      {/* Header */}
      <div className="px-5 py-3.5 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(200,169,81,0.15)" }}>
        <div className="flex items-center gap-2">
          <div
            className="w-2 h-2 rounded-full transition-colors"
            style={{ background: callState === "connected" ? "#22C55E" : callState === "calling" ? "#F59E0B" : "#94A3B8" }}
          />
          <span className="text-sm font-semibold" style={{ color: "#1B2B4A" }}>
            {callState === "idle" && "Video Call"}
            {callState === "calling" && `Calling ${partnerName}…`}
            {callState === "incoming" && `${partnerName} is calling`}
            {callState === "connected" && `In call · ${partnerName}`}
          </span>
        </div>

        {callState === "idle" && (
          <button
            onClick={startCall}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-bold text-white transition-all hover:opacity-90"
            style={{ background: "#1B2B4A" }}
          >
            <FiVideo size={12} /> Start Call
          </button>
        )}
        {(callState === "calling" || callState === "connected") && (
          <button
            onClick={endCall}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-bold text-white transition-all"
            style={{ background: "#EF4444" }}
          >
            <FiPhoneOff size={12} /> End Call
          </button>
        )}
      </div>

      {/* Incoming call banner */}
      <AnimatePresence>
        {callState === "incoming" && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="px-5 py-4 flex items-center justify-between"
            style={{ background: "rgba(200,169,81,0.08)" }}
          >
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold" style={{ background: "#C8A951", color: "#14213D" }}>
                {partnerName?.charAt(0).toUpperCase()}
              </div>
              <span className="text-sm font-medium text-slate-800">Incoming call…</span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={acceptCall}
                className="flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-bold text-white"
                style={{ background: "#22C55E" }}
              >
                <FiPhone size={11} /> Accept
              </button>
              <button
                onClick={cleanupCall}
                className="flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-bold text-white"
                style={{ background: "#EF4444" }}
              >
                <FiPhoneOff size={11} /> Decline
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Video area */}
      <AnimatePresence>
        {(callState === "calling" || callState === "connected") && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="relative bg-slate-900"
          >
            {/* Remote video */}
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="w-full object-cover"
              style={{ height: 280, display: remoteStream ? "block" : "none" }}
            />

            {/* Waiting placeholder */}
            {!remoteStream && (
              <div className="flex items-center justify-center" style={{ height: 280 }}>
                <div className="text-center">
                  <div
                    className="w-16 h-16 rounded-full mx-auto mb-3 flex items-center justify-center text-2xl font-bold"
                    style={{ background: "#C8A951", color: "#14213D" }}
                  >
                    {partnerName?.charAt(0).toUpperCase()}
                  </div>
                  <p className="text-sm text-slate-400 mb-3">Waiting for {partnerName}…</p>
                  <div className="flex gap-1.5 justify-center">
                    {[0, 1, 2].map(i => (
                      <div
                        key={i}
                        className="w-2 h-2 rounded-full bg-slate-500 animate-bounce"
                        style={{ animationDelay: `${i * 0.15}s` }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Local video PiP */}
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="absolute bottom-14 right-3 rounded-xl object-cover border-2 border-white shadow-lg"
              style={{ width: 96, height: 72 }}
            />

            {/* Controls bar */}
            <div
              className="absolute bottom-0 left-0 right-0 flex items-center justify-center gap-3 py-3"
              style={{ background: "rgba(0,0,0,0.45)" }}
            >
              <button
                onClick={toggleMic}
                className="w-9 h-9 rounded-full flex items-center justify-center transition-all"
                style={{ background: micOn ? "rgba(255,255,255,0.15)" : "#EF4444" }}
                title={micOn ? "Mute mic" : "Unmute mic"}
              >
                {micOn ? <FiMic size={14} className="text-white" /> : <FiMicOff size={14} className="text-white" />}
              </button>
              <button
                onClick={toggleCam}
                className="w-9 h-9 rounded-full flex items-center justify-center transition-all"
                style={{ background: camOn ? "rgba(255,255,255,0.15)" : "#EF4444" }}
                title={camOn ? "Turn off camera" : "Turn on camera"}
              >
                {camOn ? <FiVideo size={14} className="text-white" /> : <FiVideoOff size={14} className="text-white" />}
              </button>
              <button
                onClick={endCall}
                className="w-10 h-10 rounded-full flex items-center justify-center"
                style={{ background: "#EF4444" }}
                title="End call"
              >
                <FiPhoneOff size={16} className="text-white" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
