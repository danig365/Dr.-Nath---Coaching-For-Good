import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { FiSend, FiX } from "react-icons/fi";
import { FaRobot } from "react-icons/fa";
import { api } from "../utils/auth";

const GOLD = "#C8A951";
const NAVY = "#1B2B4A";
const NAVY_DEEP = "#14213D";
const CREAM = "#FAF6EC";

const GREETING = {
  role: "assistant",
  content:
    "Hi! 👋 I'm the Dr. Nath assistant. Ask me about coaching, how booking works, or finding the right coach.",
};

const SUGGESTIONS = [
  "How do I book a session?",
  "What kinds of coaching are offered?",
  "How does Smart Match work?",
];

// Don't overlap the video-call UI.
const isHiddenPath = (path) =>
  /\/session\/|\/group-session\/|\/call$/.test(path);

export default function AssistantWidget() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([GREETING]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef(null);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open, loading]);

  if (isHiddenPath(location.pathname)) return null;

  const send = async (text) => {
    const content = (text ?? input).trim();
    if (!content || loading) return;
    const next = [...messages, { role: "user", content }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      // Send only user/assistant turns (drop the local greeting) to the API.
      const history = next.filter((m, i) => !(i === 0 && m === GREETING));
      const res = await api.post("/assistant/chat/", { messages: history });
      setMessages((m) => [...m, { role: "assistant", content: res.data.reply }]);
    } catch (err) {
      const msg = err.response?.status === 429
        ? "You're sending messages a bit fast — please wait a moment and try again."
        : "Sorry, I couldn't respond just now. Please try again shortly.";
      setMessages((m) => [...m, { role: "assistant", content: msg }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Floating button */}
      <motion.button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close assistant" : "Open assistant"}
        whileHover={{ scale: 1.06 }}
        whileTap={{ scale: 0.94 }}
        className="fixed z-[70] flex items-center justify-center rounded-full shadow-xl"
        style={{
          bottom: 24, right: 24, width: 56, height: 56,
          background: `linear-gradient(135deg, ${NAVY}, ${NAVY_DEEP})`,
          border: `2px solid ${GOLD}`, color: GOLD,
        }}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span key={open ? "x" : "bot"}
            initial={{ opacity: 0, rotate: -30 }} animate={{ opacity: 1, rotate: 0 }} exit={{ opacity: 0, rotate: 30 }}>
            {open ? <FiX size={24} /> : <FaRobot size={24} />}
          </motion.span>
        </AnimatePresence>
      </motion.button>

      {/* Chat panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="fixed z-[70] flex flex-col overflow-hidden rounded-2xl shadow-2xl"
            style={{
              bottom: 92, right: 24, width: "min(370px, calc(100vw - 32px))",
              height: "min(540px, calc(100vh - 140px))",
              background: CREAM, border: "1px solid rgba(200,169,81,0.3)",
            }}
          >
            {/* Header */}
            <div className="px-4 py-3 flex items-center gap-3" style={{ background: `linear-gradient(135deg, ${NAVY}, ${NAVY_DEEP})` }}>
              <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: "rgba(200,169,81,0.18)", color: GOLD }}>
                <FaRobot size={18} />
              </div>
              <div className="min-w-0">
                <p className="text-white text-sm font-bold leading-tight">Dr. Nath Assistant</p>
                <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.55)" }}>Here to help you get started</p>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {messages.map((m, i) => {
                const mine = m.role === "user";
                return (
                  <div key={i} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <div className="max-w-[85%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap"
                      style={mine
                        ? { background: `linear-gradient(135deg,${GOLD},#F0D98C)`, color: NAVY_DEEP, borderBottomRightRadius: 4 }
                        : { background: "white", color: NAVY, border: "1px solid rgba(200,169,81,0.2)", borderBottomLeftRadius: 4 }}>
                      {m.content}
                    </div>
                  </div>
                );
              })}

              {/* Suggestions (only before the first user turn) */}
              {messages.length === 1 && !loading && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} onClick={() => send(s)}
                      className="text-xs px-3 py-1.5 rounded-full transition-colors"
                      style={{ background: "white", border: `1px solid ${GOLD}`, color: "#A9863A" }}>
                      {s}
                    </button>
                  ))}
                </div>
              )}

              {loading && (
                <div className="flex justify-start">
                  <div className="px-4 py-3 rounded-2xl" style={{ background: "white", border: "1px solid rgba(200,169,81,0.2)" }}>
                    <span className="flex gap-1">
                      {[0, 1, 2].map((d) => (
                        <motion.span key={d} className="w-1.5 h-1.5 rounded-full" style={{ background: GOLD }}
                          animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1, repeat: Infinity, delay: d * 0.2 }} />
                      ))}
                    </span>
                  </div>
                </div>
              )}
              <div ref={endRef} />
            </div>

            {/* Input */}
            <form onSubmit={(e) => { e.preventDefault(); send(); }}
              className="px-3 py-3 flex items-center gap-2" style={{ borderTop: "1px solid rgba(200,169,81,0.2)", background: "white" }}>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Type your message…"
                maxLength={2000}
                className="flex-1 px-4 py-2.5 rounded-full text-sm focus:outline-none"
                style={{ background: CREAM, border: "1px solid rgba(200,169,81,0.3)", color: NAVY }}
              />
              <motion.button type="submit" disabled={!input.trim() || loading}
                whileHover={input.trim() && !loading ? { scale: 1.06 } : {}} whileTap={input.trim() && !loading ? { scale: 0.94 } : {}}
                className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 disabled:opacity-40"
                style={{ background: `linear-gradient(135deg,${GOLD},#F0D98C)`, color: NAVY_DEEP }}>
                <FiSend size={16} />
              </motion.button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
