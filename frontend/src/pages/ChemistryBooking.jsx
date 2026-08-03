import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../utils/auth";
import { toast } from "react-toastify";
import { motion } from "framer-motion";
import MonthCalendar from "../components/MonthCalendar";
import { FiArrowRight, FiArrowLeft, FiCheckCircle, FiClock, FiCalendar } from "react-icons/fi";

const GOLD = "#C8A951";
const DARK = "#1B2B4A";
const BROWN = "#4A5568";
const CREAM = "#FAF6EC";

const pad = (n) => String(n).padStart(2, "0");
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtTime = (iso) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const fmtLong = (key) => key ? new Date(key + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) : "";

function QuestionField({ q, value, onChange }) {
  const base = { background: "white", border: "1px solid rgba(200,169,81,0.3)", color: DARK };
  const cls = "w-full px-4 py-2.5 rounded-xl text-sm focus:outline-none";
  if (q.type === "long_text")
    return <textarea rows={3} value={value || ""} onChange={(e) => onChange(e.target.value)} className={cls + " resize-none"} style={base} />;
  if (q.type === "number")
    return <input type="number" value={value || ""} onChange={(e) => onChange(e.target.value)} className={cls} style={base} />;
  if (q.type === "date")
    return <input type="date" value={value || ""} onChange={(e) => onChange(e.target.value)} className={cls} style={base} />;
  if (q.type === "yes_no")
    return (
      <div className="flex gap-2">
        {["Yes", "No"].map((o) => (
          <button key={o} type="button" onClick={() => onChange(o)}
            className="px-4 py-2 rounded-full text-sm font-semibold"
            style={value === o ? { background: GOLD, color: "#14213D" } : { background: "white", color: BROWN, border: "1px solid rgba(200,169,81,0.3)" }}>{o}</button>
        ))}
      </div>
    );
  if (q.type === "rating")
    return (
      <div className="flex gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" onClick={() => onChange(n)}
            className="w-9 h-9 rounded-full text-sm font-bold"
            style={Number(value) >= n ? { background: GOLD, color: "#14213D" } : { background: "white", color: BROWN, border: "1px solid rgba(200,169,81,0.3)" }}>{n}</button>
        ))}
      </div>
    );
  if (q.type === "single_choice")
    return (
      <div className="flex flex-wrap gap-2">
        {(q.options || []).map((o) => (
          <button key={o} type="button" onClick={() => onChange(o)}
            className="px-4 py-2 rounded-full text-sm font-semibold"
            style={value === o ? { background: GOLD, color: "#14213D" } : { background: "white", color: BROWN, border: "1px solid rgba(200,169,81,0.3)" }}>{o}</button>
        ))}
      </div>
    );
  if (q.type === "multi_choice") {
    const arr = Array.isArray(value) ? value : [];
    const toggle = (o) => onChange(arr.includes(o) ? arr.filter((x) => x !== o) : [...arr, o]);
    return (
      <div className="flex flex-wrap gap-2">
        {(q.options || []).map((o) => (
          <button key={o} type="button" onClick={() => toggle(o)}
            className="px-4 py-2 rounded-full text-sm font-semibold"
            style={arr.includes(o) ? { background: GOLD, color: "#14213D" } : { background: "white", color: BROWN, border: "1px solid rgba(200,169,81,0.3)" }}>{o}</button>
        ))}
      </div>
    );
  }
  return <input type="text" value={value || ""} onChange={(e) => onChange(e.target.value)} className={cls} style={base} />;
}

export default function ChemistryBooking() {
  const navigate = useNavigate();
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [step, setStep] = useState("intake"); // intake | calendar | done

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [answers, setAnswers] = useState({});

  const [slots, setSlots] = useState([]);
  const [selDate, setSelDate] = useState(null);
  const [selSlot, setSelSlot] = useState(null);
  const [booking, setBooking] = useState(false);
  const [done, setDone] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get("/bookings/chemistry/");
        setInfo(res.data);
      } catch { setUnavailable(true); }
      finally { setLoading(false); }
    })();
  }, []);

  const loadSlots = async () => {
    try {
      const res = await api.get(`/bookings/slots/available/?skill=${info.skill_id}`);
      setSlots(Array.isArray(res.data) ? res.data : []);
    } catch { toast.error("Couldn't load available times."); }
  };

  const slotsByDate = useMemo(() => {
    const m = {};
    slots.forEach((s) => { const k = dayKey(new Date(s.start_datetime)); (m[k] ||= []).push(s); });
    Object.values(m).forEach((a) => a.sort((x, y) => new Date(x.start_datetime) - new Date(y.start_datetime)));
    return m;
  }, [slots]);
  const calEvents = useMemo(() => Object.keys(slotsByDate).map((date) => ({ date })), [slotsByDate]);

  const submitIntake = (e) => {
    e.preventDefault();
    if (!name.trim()) return toast.error("Please enter your name.");
    if (!email.trim()) return toast.error("Please enter your email.");
    for (const q of info.intake.questions || []) {
      if (q.required) {
        const v = answers[q.id];
        if (v === undefined || v === "" || (Array.isArray(v) && !v.length)) return toast.error(`Please answer: ${q.label}`);
      }
    }
    setStep("calendar");
    loadSlots();
  };

  const confirm = async () => {
    if (!selSlot) return toast.error("Please pick a time.");
    setBooking(true);
    try {
      const res = await api.post("/bookings/chemistry/book/", { name, email, answers, slot_id: selSlot.id });
      setDone(res.data);
      setStep("done");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Couldn't complete the booking.");
    } finally { setBooking(false); }
  };

  if (loading) return (
    <div className="flex justify-center items-center min-h-screen" style={{ background: CREAM }}>
      <div className="w-10 h-10 rounded-full border-2 animate-spin" style={{ borderColor: GOLD, borderTopColor: "transparent" }} />
    </div>
  );

  if (unavailable) return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center" style={{ background: CREAM }}>
      <FiCalendar size={40} style={{ color: GOLD }} />
      <h1 className="text-2xl font-normal mt-4 mb-1" style={{ color: DARK, fontFamily: "'Playfair Display', serif" }}>No free session right now</h1>
      <p className="text-sm mb-5" style={{ color: BROWN }}>A chemistry session isn't available at the moment. Please check back soon.</p>
      <button onClick={() => navigate("/")} className="px-5 py-2.5 rounded-full text-sm font-bold" style={{ background: GOLD, color: "#14213D" }}>Back home</button>
    </div>
  );

  const dayTimes = selDate ? (slotsByDate[selDate] || []) : [];

  return (
    <div className="min-h-screen pt-36 pb-16 px-4 sm:px-6" style={{ background: CREAM }}>
      <div className="max-w-2xl mx-auto">
        {/* Hero */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl px-5 py-5 mb-5" style={{ background: "linear-gradient(135deg,#1B2B4A,#14213D)", color: "white" }}>
          <p className="text-[11px] font-semibold uppercase tracking-widest mb-1" style={{ color: GOLD }}>Free discovery call</p>
          <h1 className="text-2xl font-normal mb-1" style={{ fontFamily: "'Playfair Display', serif" }}>{info.name}</h1>
          <p className="text-sm opacity-85">with {info.coach_name} · no charge</p>
        </motion.div>

        {/* Stepper */}
        <div className="flex items-center gap-2 mb-5 text-xs font-semibold">
          {["Your details", "Pick a time", "Done"].map((label, i) => {
            const idx = ["intake", "calendar", "done"].indexOf(step);
            const active = i <= idx;
            return (
              <div key={label} className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full flex items-center justify-center" style={active ? { background: GOLD, color: "#14213D" } : { background: "rgba(27,43,74,0.08)", color: BROWN }}>{i + 1}</span>
                <span style={{ color: active ? DARK : BROWN }}>{label}</span>
                {i < 2 && <span className="w-6 h-px" style={{ background: "rgba(27,43,74,0.15)" }} />}
              </div>
            );
          })}
        </div>

        <div className="rounded-2xl p-5 md:p-6" style={{ background: "white", border: "1px solid rgba(200,169,81,0.15)", boxShadow: "0 2px 12px rgba(27,43,74,0.04)" }}>
          {/* STEP 1 — INTAKE */}
          {step === "intake" && (
            <form onSubmit={submitIntake} className="space-y-4">
              {info.intake.description && <p className="text-sm" style={{ color: BROWN }}>{info.intake.description}</p>}
              <div>
                <label className="block text-sm font-semibold mb-1.5" style={{ color: DARK }}>Your name <span style={{ color: "#B91C1C" }}>*</span></label>
                <input value={name} onChange={(e) => setName(e.target.value)} className="w-full px-4 py-2.5 rounded-xl text-sm focus:outline-none" style={{ background: "white", border: "1px solid rgba(200,169,81,0.3)", color: DARK }} />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1.5" style={{ color: DARK }}>Your email <span style={{ color: "#B91C1C" }}>*</span></label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-4 py-2.5 rounded-xl text-sm focus:outline-none" style={{ background: "white", border: "1px solid rgba(200,169,81,0.3)", color: DARK }} />
              </div>
              {(info.intake.questions || []).map((q) => (
                <div key={q.id}>
                  <label className="block text-sm font-semibold mb-1.5" style={{ color: DARK }}>{q.label}{q.required && <span style={{ color: "#B91C1C" }}> *</span>}</label>
                  <QuestionField q={q} value={answers[q.id]} onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))} />
                </div>
              ))}
              <button type="submit" className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full text-sm font-bold" style={{ background: "linear-gradient(135deg,#C8A951,#F0D98C)", color: "#14213D" }}>
                Continue to calendar <FiArrowRight size={14} />
              </button>
            </form>
          )}

          {/* STEP 2 — CALENDAR */}
          {step === "calendar" && (
            <div>
              <button onClick={() => setStep("intake")} className="inline-flex items-center gap-1.5 text-xs font-semibold mb-4" style={{ color: BROWN }}><FiArrowLeft size={13} /> Back to your details</button>
              {slots.length === 0 ? (
                <p className="text-sm text-center py-8" style={{ color: BROWN }}>No open times right now — please check back soon.</p>
              ) : (
                <div className="grid sm:grid-cols-2 gap-5">
                  <div className="rounded-xl p-3 max-w-[340px]" style={{ background: CREAM, border: "1px solid rgba(200,169,81,0.15)" }}>
                    <MonthCalendar events={calEvents} selected={selDate} onSelect={(d) => { setSelDate(d); setSelSlot(null); }} initialMonth={calEvents[0]?.date?.slice(0, 7)} />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "rgba(74,85,104,0.55)" }}>{selDate ? fmtLong(selDate) : "Pick a date with a •"}</p>
                    {selDate ? (
                      <div className="flex flex-wrap gap-2">
                        {dayTimes.map((s) => (
                          <button key={s.id} onClick={() => setSelSlot(s)}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-sm font-semibold"
                            style={selSlot?.id === s.id ? { background: DARK, color: CREAM } : { background: "white", color: DARK, border: "1px solid rgba(200,169,81,0.3)" }}>
                            <FiClock size={12} /> {fmtTime(s.start_datetime)}
                          </button>
                        ))}
                      </div>
                    ) : <p className="text-sm" style={{ color: BROWN }}>Highlighted dates have open times.</p>}
                    {selSlot && (
                      <button onClick={confirm} disabled={booking} className="mt-5 w-full inline-flex items-center justify-center gap-2 px-6 py-3 rounded-full text-sm font-bold disabled:opacity-60" style={{ background: "linear-gradient(135deg,#C8A951,#F0D98C)", color: "#14213D" }}>
                        {booking ? "Booking…" : <>Confirm free session <FiCheckCircle size={15} /></>}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP 3 — DONE */}
          {step === "done" && (
            <div className="text-center py-8">
              <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: "rgba(52,168,83,0.12)" }}>
                <FiCheckCircle size={26} style={{ color: "#2E7D32" }} />
              </div>
              <h2 className="text-2xl font-normal mb-2" style={{ color: DARK, fontFamily: "'Playfair Display', serif" }}>You're booked!</h2>
              <p className="text-sm mb-1" style={{ color: BROWN }}>Your free chemistry session with {info.coach_name} is confirmed.</p>
              <p className="text-sm mb-6" style={{ color: BROWN }}>
                {done?.account_created
                  ? <>We've emailed <strong style={{ color: DARK }}>{email}</strong> a link to activate your account and view your session.</>
                  : <>Check <strong style={{ color: DARK }}>{email}</strong> for your booking confirmation.</>}
              </p>
              <button onClick={() => navigate("/login")} className="px-6 py-2.5 rounded-full text-sm font-bold" style={{ background: GOLD, color: "#14213D" }}>Go to sign in</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
