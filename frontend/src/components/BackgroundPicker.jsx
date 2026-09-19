import { useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FiImage, FiUpload } from "react-icons/fi";
import { toast } from "react-toastify";
import { BACKGROUND_OPTIONS, prepareCustomBackground } from "../utils/videoBackground";

// In-call control to pick a virtual background (None / Blur / preset images /
// an uploaded custom image). `selected` is the current option id;
// `onSelect(id, image?)` applies it — for the custom tile we pass the object-URL
// as the 2nd arg. `busy` shows a spinner while the effect loads (first apply
// downloads the ML model).
export default function BackgroundPicker({ selected, onSelect, busy }) {
  const [open, setOpen] = useState(false);
  const [customUrl, setCustomUrl] = useState(null);
  const [preparing, setPreparing] = useState(false);
  const fileRef = useRef(null);

  const swatch = (opt) => {
    if (opt.id === "none") return { background: "rgba(255,255,255,0.08)" };
    if (opt.id === "blur") return { background: "rgba(255,255,255,0.18)", backdropFilter: "blur(2px)" };
    return { backgroundImage: `url('${opt.image}')`, backgroundSize: "cover", backgroundPosition: "center" };
  };

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file.");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast.error("Image is too large (max 20 MB).");
      return;
    }
    // Decode + downscale here rather than handing the raw file to the
    // processor, which can't tell us why an image didn't work.
    setPreparing(true);
    try {
      const dataUrl = await prepareCustomBackground(file);
      setCustomUrl(dataUrl);
      onSelect("custom", dataUrl);
    } catch (err) {
      toast.error(err?.message || "That image couldn't be used as a background.");
    } finally {
      setPreparing(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-11 h-11 rounded-full flex items-center justify-center transition-all hover:scale-105"
        style={{ background: open || selected !== "none" ? "#C8A951" : "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}
        title="Change background"
      >
        <FiImage size={16} style={{ color: open || selected !== "none" ? "#14213D" : "white" }} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.96 }}
            transition={{ duration: 0.18 }}
            className="absolute bottom-14 right-0 p-3 rounded-2xl z-40"
            style={{ background: "rgba(13,13,13,0.97)", border: "1px solid rgba(255,255,255,0.1)", backdropFilter: "blur(10px)", width: 240 }}
          >
            <p className="text-[11px] font-semibold uppercase tracking-wider mb-2 px-1" style={{ color: "rgba(255,255,255,0.5)" }}>
              Background {(busy || preparing) && "· loading…"}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {BACKGROUND_OPTIONS.map((opt) => {
                const active = selected === opt.id;
                return (
                  <button
                    key={opt.id}
                    onClick={() => onSelect(opt.id)}
                    disabled={busy || preparing}
                    className="relative rounded-xl overflow-hidden h-16 flex items-end justify-start p-1.5 transition-all disabled:opacity-50"
                    style={{ ...swatch(opt), border: active ? "2px solid #C8A951" : "1px solid rgba(255,255,255,0.12)" }}
                  >
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded text-white" style={{ background: "rgba(0,0,0,0.55)" }}>
                      {opt.label}
                    </span>
                  </button>
                );
              })}

              {/* Uploaded custom background (shown once one has been chosen) */}
              {customUrl && (
                <button
                  onClick={() => onSelect("custom", customUrl)}
                  disabled={busy || preparing}
                  className="relative rounded-xl overflow-hidden h-16 flex items-end justify-start p-1.5 transition-all disabled:opacity-50"
                  style={{
                    backgroundImage: `url('${customUrl}')`, backgroundSize: "cover", backgroundPosition: "center",
                    border: selected === "custom" ? "2px solid #C8A951" : "1px solid rgba(255,255,255,0.12)",
                  }}
                >
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded text-white" style={{ background: "rgba(0,0,0,0.55)" }}>
                    Custom
                  </span>
                </button>
              )}

              {/* Upload tile */}
              <button
                onClick={() => fileRef.current?.click()}
                disabled={busy || preparing}
                className="relative rounded-xl h-16 flex flex-col items-center justify-center gap-1 transition-all disabled:opacity-50 hover:bg-white/5"
                style={{ border: "1px dashed rgba(255,255,255,0.25)" }}
                title="Upload your own background"
              >
                <FiUpload size={16} style={{ color: "rgba(255,255,255,0.7)" }} />
                <span className="text-[10px] font-semibold" style={{ color: "rgba(255,255,255,0.6)" }}>
                  {preparing ? "Loading…" : customUrl ? "Replace" : "Upload"}
                </span>
              </button>
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
