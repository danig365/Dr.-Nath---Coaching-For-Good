import { useState } from "react";
import { FiChevronLeft, FiChevronRight } from "react-icons/fi";

const GOLD = "#C8A951";
const DARK = "#1B2B4A";
const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

const iso = (y, m, d) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/**
 * Lightweight month grid. `events` is a list of { date: 'YYYY-MM-DD' }; days with
 * an event get a dot. Clicking a day calls onSelect(dateStr) (toggles off if the
 * same day is clicked again).
 */
export default function MonthCalendar({ events = [], selected, onSelect, initialMonth }) {
  const today = new Date();
  const [cursor, setCursor] = useState(() => {
    if (initialMonth) { const [y, m] = initialMonth.split("-").map(Number); return { y, m: m - 1 }; }
    return { y: today.getFullYear(), m: today.getMonth() };
  });

  const eventDates = new Set(events.map((e) => e.date));
  const firstDay = new Date(cursor.y, cursor.m, 1).getDay();
  const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const todayIso = iso(today.getFullYear(), today.getMonth(), today.getDate());

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const prev = () => setCursor((c) => (c.m === 0 ? { y: c.y - 1, m: 11 } : { y: c.y, m: c.m - 1 }));
  const next = () => setCursor((c) => (c.m === 11 ? { y: c.y + 1, m: 0 } : { y: c.y, m: c.m + 1 }));

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <button onClick={prev} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "rgba(27,43,74,0.06)", color: DARK }}><FiChevronLeft size={16} /></button>
        <span className="text-sm font-bold" style={{ color: DARK, fontFamily: "'Playfair Display', serif" }}>{MONTHS[cursor.m]} {cursor.y}</span>
        <button onClick={next} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "rgba(27,43,74,0.06)", color: DARK }}><FiChevronRight size={16} /></button>
      </div>
      <div className="grid grid-cols-7 gap-1 mb-1">
        {WEEKDAYS.map((w, i) => <div key={i} className="text-center text-[10px] font-bold uppercase" style={{ color: "rgba(74,85,104,0.5)" }}>{w}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (!d) return <div key={i} />;
          const ds = iso(cursor.y, cursor.m, d);
          const hasEvent = eventDates.has(ds);
          const isSel = selected === ds;
          const isToday = todayIso === ds;
          return (
            <button
              key={i}
              onClick={() => onSelect(isSel ? null : ds)}
              className="aspect-square rounded-lg flex items-center justify-center text-sm relative transition-all"
              style={isSel
                ? { background: "linear-gradient(135deg,#C8A951,#F0D98C)", color: "#14213D", fontWeight: 700 }
                : { background: hasEvent ? "rgba(200,169,81,0.12)" : "transparent", color: DARK, border: isToday ? "1px solid #C8A951" : "1px solid transparent", cursor: hasEvent ? "pointer" : "default" }}
            >
              {d}
              {hasEvent && !isSel && <span className="absolute bottom-1 w-1 h-1 rounded-full" style={{ background: GOLD }} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
