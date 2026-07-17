import { useEffect, useRef } from "react";
import { FiVideoOff } from "react-icons/fi";

// Shared LiveKit video tiles, used by the 1:1 call (SessionCallLiveKit) and the
// guest call page (GuestCall). Each tile owns its own <video>/<audio> and
// attaches/detaches the tracks it's given.

// A single remote participant (the client, or an invited guest).
export function RemoteTile({ data, spacious }) {
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
    <div className={`relative w-full h-full overflow-hidden bg-black ${spacious ? "" : "rounded-2xl"}`} style={{ border: spacious ? "none" : "1px solid rgba(255,255,255,0.1)" }}>
      <video ref={videoRef} autoPlay playsInline className={`w-full h-full ${spacious ? "object-contain" : "object-cover"}`} style={{ background: "#0D0D0D" }} />
      <audio ref={audioRef} autoPlay />
      {!data.videoTrack && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2" style={{ background: "#14213D" }}>
          <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: "rgba(200,169,81,0.18)" }}>
            <FiVideoOff size={22} style={{ color: "#C8A951" }} />
          </div>
          <p className="text-xs" style={{ color: "rgba(255,255,255,0.55)" }}>Camera is off</p>
        </div>
      )}
      <span className="absolute bottom-2 left-2 px-2 py-0.5 rounded-md text-xs font-semibold text-white" style={{ background: "rgba(0,0,0,0.55)" }}>
        {data.name || "Participant"}
      </span>
    </div>
  );
}

// A shared screen (remote), shown full-bleed as the main view.
export function ScreenView({ track, name }) {
  const ref = useRef(null);
  useEffect(() => {
    const t = track;
    if (t && ref.current) { t.attach(ref.current); return () => { try { t.detach(ref.current); } catch { /* noop */ } }; }
  }, [track]);
  return (
    <div className="relative w-full h-full bg-black">
      <video ref={ref} autoPlay playsInline className="w-full h-full object-contain" />
      <span className="absolute bottom-3 left-3 px-2 py-0.5 rounded-md text-xs font-semibold text-white" style={{ background: "rgba(0,0,0,0.6)" }}>
        {name ? `${name}'s screen` : "Shared screen"}
      </span>
    </div>
  );
}
