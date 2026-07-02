import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FiImage } from "react-icons/fi";
import { BACKGROUND_OPTIONS } from "../utils/videoBackground";

// In-call control to pick a virtual background (None / Blur / preset images).
// `selected` is the current option id; `onSelect(id)` applies it; `busy` shows
// a spinner while the effect is loading (first apply downloads the ML model).
export default function BackgroundPicker({ selected, onSelect, busy }) {
  const [open, setOpen] = useState(false);

  const swatch = (opt) => {
    if (opt.id === "none") return { background: "rgba(255,255,255,0.08)" };
    if (opt.id === "blur") return { background: "rgba(255,255,255,0.18)", backdropFilter: "blur(2px)" };
    return { backgroundImage: `url('${opt.image}')`, backgroundSize: "cover", backgroundPosition: "center" };
  };

  return (
    <div className="absolute right-20">
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
              Background {busy && "· loading…"}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {BACKGROUND_OPTIONS.map((opt) => {
                const active = selected === opt.id;
                return (
                  <button
                    key={opt.id}
                    onClick={() => onSelect(opt.id)}
                    disabled={busy}
                    className="relative rounded-xl overflow-hidden h-16 flex items-end justify-start p-1.5 transition-all disabled:opacity-50"
                    style={{ ...swatch(opt), border: active ? "2px solid #C8A951" : "1px solid rgba(255,255,255,0.12)" }}
                  >
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded text-white" style={{ background: "rgba(0,0,0,0.55)" }}>
                      {opt.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
