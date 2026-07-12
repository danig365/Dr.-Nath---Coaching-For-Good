// "Add to calendar" helpers for a booked session — Google/Outlook web links and
// an .ics download (Apple / Outlook desktop / import-anywhere). Mirrors the
// backend bookings/calendar.py so in-app and email stay consistent.

const SITE = typeof window !== "undefined" ? window.location.origin : "https://dr-nath.com";

const fmtUTC = (d) => new Date(d).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""); // YYYYMMDDTHHMMSSZ
const fmtISO = (d) => new Date(d).toISOString().replace(/\.\d{3}/, "");                       // 2026-07-09T07:00:00Z

function fields(session) {
  const startRaw = session.slot_start || `${session.session_date}T${session.session_time}Z`;
  const startMs = new Date(startRaw).getTime();
  const endMs = session.slot_end
    ? new Date(session.slot_end).getTime()
    : startMs + (session.duration || 60) * 60000;
  return {
    id: session.id,
    start: new Date(startMs),
    end: new Date(endMs),
    title: session.skill_title || "Coaching session",  // program name (already descriptive)
    details: `Your online coaching session on the Dr. Nath platform. Join at ${SITE}/session/${session.id} (sign in first).`,
    location: "Online — Dr. Nath platform (dr-nath.com)",
  };
}

export function googleCalendarUrl(session) {
  const f = fields(session);
  const dates = `${fmtUTC(f.start)}/${fmtUTC(f.end)}`;
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(f.title)}&dates=${dates}&details=${encodeURIComponent(f.details)}&location=${encodeURIComponent(f.location)}`;
}

export function outlookCalendarUrl(session) {
  const f = fields(session);
  return `https://outlook.office.com/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent&subject=${encodeURIComponent(f.title)}&startdt=${fmtISO(f.start)}&enddt=${fmtISO(f.end)}&body=${encodeURIComponent(f.details)}&location=${encodeURIComponent(f.location)}`;
}

export function downloadIcs(session) {
  const f = fields(session);
  const esc = (t) => t.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Dr. Nath//Coaching for Impact//EN",
    "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "BEGIN:VEVENT",
    `UID:booking-${f.id}@dr-nath.com`,
    `DTSTAMP:${fmtUTC(new Date())}`,
    `DTSTART:${fmtUTC(f.start)}`,
    `DTEND:${fmtUTC(f.end)}`,
    `SUMMARY:${esc(f.title)}`,
    `DESCRIPTION:${esc(f.details)}`,
    `LOCATION:${esc(f.location)}`,
    "STATUS:CONFIRMED",
    "BEGIN:VALARM", "TRIGGER:-PT1H", "ACTION:DISPLAY",
    "DESCRIPTION:Your coaching session is in 1 hour", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n") + "\r\n";
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "session.ics";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
