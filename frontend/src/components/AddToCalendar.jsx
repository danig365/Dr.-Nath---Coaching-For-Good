import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { FiCalendar } from "react-icons/fi";
import { googleCalendarUrl, outlookCalendarUrl, downloadIcs } from "../utils/calendarLinks";

// A compact "Add to Calendar" pill that opens a menu: Google / Outlook / Apple(.ics).
// Styled to sit alongside the other session-card action buttons.
export default function AddToCalendar({ session }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const itemCls = "block w-full text-left px-4 py-2 text-xs font-medium hover:bg-[#1B2B4A]/[0.06] transition-colors";

  return (
    <div className="relative" ref={ref}>
      <motion.button
        whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold transition-all duration-200"
        style={{ background: "rgba(200,169,81,0.1)", color: "#A9863A", border: "1px solid rgba(200,169,81,0.25)" }}
      >
        <FiCalendar size={13} /> Add to Calendar
      </motion.button>
      {open && (
        <div className="absolute right-0 mt-1 z-30 min-w-[180px] rounded-xl py-1.5 shadow-xl"
          style={{ background: "white", border: "1px solid rgba(200,169,81,0.3)" }}>
          <a href={googleCalendarUrl(session)} target="_blank" rel="noreferrer" onClick={() => setOpen(false)} className={itemCls} style={{ color: "#1B2B4A" }}>
            Google Calendar
          </a>
          <a href={outlookCalendarUrl(session)} target="_blank" rel="noreferrer" onClick={() => setOpen(false)} className={itemCls} style={{ color: "#1B2B4A" }}>
            Outlook
          </a>
          <button onClick={() => { downloadIcs(session); setOpen(false); }} className={itemCls} style={{ color: "#1B2B4A" }}>
            Apple / Download (.ics)
          </button>
        </div>
      )}
    </div>
  );
}
