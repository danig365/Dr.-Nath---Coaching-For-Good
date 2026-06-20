import { Link } from "react-router-dom";
import { motion, AnimatePresence, useInView } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRightIcon,
  AcademicCapIcon,
  CalendarIcon,
  ChartBarIcon,
  SparklesIcon,
  UsersIcon,
  ChevronDownIcon,
  XMarkIcon,
  CheckIcon,
  BriefcaseIcon,
  GlobeAltIcon,
  CheckBadgeIcon,
} from "@heroicons/react/24/outline";
import { api } from "../utils/auth";

/* ── Brand tokens ─────────────────────────────────────────────── */
const NAVY = "#1B2B4A";
const NAVY_DEEP = "#14213D";
const GOLD = "#C8A951";
const GOLD_DEEP = "#A9863A";
const CREAM = "#FAF6EC";
const CREAM_WARM = "#F3ECD9";
const SLATE = "#4A5568";
const serif = "'Playfair Display', serif";

/* ── Animated Counter ─────────────────────────────────────────── */
function Counter({ end, suffix = "" }) {
  const [count, setCount] = useState(0);
  const ref = useRef(null);
  const inView = useInView(ref, { once: true });

  useEffect(() => {
    if (!inView) return;
    let start = 0;
    const duration = 1600;
    const step = Math.ceil(end / (duration / 16));
    const timer = setInterval(() => {
      start += step;
      if (start >= end) { setCount(end); clearInterval(timer); }
      else setCount(start);
    }, 16);
    return () => clearInterval(timer);
  }, [inView, end]);

  return <span ref={ref}>{count.toLocaleString()}{suffix}</span>;
}

/* ── Newsletter pop-up modal ──────────────────────────────────── */
function NewsletterModal({ onClose }) {
  const [email, setEmail] = useState("");
  const [first, setFirst] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    setSubmitted(true);
    setTimeout(onClose, 2000);
  };

  const inputCls = "w-full px-5 py-3 rounded-full border bg-white focus:outline-none focus:ring-2 text-[#1B2B4A] placeholder-[#1B2B4A]/40";

  return (
    <motion.div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      <motion.div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        className="relative rounded-2xl shadow-2xl w-full max-w-md p-8 z-10"
        style={{ background: CREAM }}
        initial={{ y: 60, opacity: 0, scale: 0.95 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 60, opacity: 0, scale: 0.95 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
      >
        <button onClick={onClose} className="absolute top-4 right-4 text-[#4A5568] hover:text-[#1B2B4A]">
          <XMarkIcon className="w-6 h-6" />
        </button>

        {submitted ? (
          <motion.div className="text-center py-8" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
            <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: GOLD }}>
              <CheckIcon className="w-8 h-8" style={{ color: NAVY }} />
            </div>
            <h3 className="text-2xl font-bold" style={{ color: NAVY, fontFamily: serif }}>You&apos;re in!</h3>
            <p className="text-[#4A5568] mt-2">Watch your inbox for coaching insights.</p>
          </motion.div>
        ) : (
          <>
            <h3 className="text-2xl font-bold mb-2 text-center" style={{ color: NAVY, fontFamily: serif }}>
              Dr-nath.com Newsletter
            </h3>
            <p className="text-[#4A5568] text-center text-sm mb-6">
              Clarity, growth and impact — practical coaching insights delivered to your inbox.
            </p>
            <form onSubmit={handleSubmit} className="space-y-4">
              <input type="text" placeholder="First Name" value={first} onChange={e => setFirst(e.target.value)} required
                className={inputCls} style={{ borderColor: "rgba(27,43,74,0.2)" }} />
              <input type="email" placeholder="Email Address" value={email} onChange={e => setEmail(e.target.value)} required
                className={inputCls} style={{ borderColor: "rgba(27,43,74,0.2)" }} />
              <button type="submit" className="gold-btn w-full py-3 rounded-xl text-base">Sign Me Up</button>
            </form>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}

/* ── Testimonials carousel ────────────────────────────────────── */
const testimonials = [
  { quote: "Dr. Nath helped me find clarity I'd been chasing for years. In three months I went from feeling stuck to leading my own team.", author: "Sarah M.", role: "VP of Operations" },
  { quote: "The most grounded, practical coaching I've ever experienced. Every session moved me forward — no fluff, real impact.", author: "James K.", role: "Founder & Entrepreneur" },
  { quote: "I finally understand my own values and how to build a career around them. It genuinely changed the way I lead.", author: "Priya R.", role: "Product Director" },
];

function TestimonialCarousel() {
  const [current, setCurrent] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setCurrent(i => (i + 1) % testimonials.length), 4500);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="relative overflow-hidden">
      <AnimatePresence mode="wait">
        <motion.div
          key={current}
          initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }}
          transition={{ duration: 0.5 }} className="text-center px-4 md:px-12"
        >
          <p className="text-2xl md:text-3xl leading-relaxed mb-8" style={{ color: NAVY, fontFamily: serif }}>
            {testimonials[current].quote}
          </p>
          <p className="font-bold text-lg" style={{ color: NAVY }}>{testimonials[current].author}</p>
          <p className="text-sm" style={{ color: GOLD_DEEP }}>{testimonials[current].role}</p>
        </motion.div>
      </AnimatePresence>
      <div className="flex justify-center gap-2 mt-10">
        {testimonials.map((_, i) => (
          <button key={i} onClick={() => setCurrent(i)} aria-label={`Testimonial ${i + 1}`}
            className="h-2 rounded-full transition-all duration-300"
            style={{ width: i === current ? "24px" : "8px", background: i === current ? GOLD_DEEP : "rgba(27,43,74,0.25)" }} />
        ))}
      </div>
    </div>
  );
}

/* ── FAQ accordion ────────────────────────────────────────────── */
const faqs = [
  { q: "Who is Dr. Nath?", a: "Dr. Nath is a certified executive and life coach who helps professionals find clarity, accelerate their growth and create lasting impact through a deeply personal, client-centered approach to coaching." },
  { q: "How does coaching work?", a: "You begin with a discovery session to map your goals and what's holding you back, then book focused 1-on-1 sessions. Between sessions you apply tailored frameworks and track real progress on your dashboard." },
  { q: "What can I expect from a session?", a: "Honest conversation, practical tools and a clear next step. Every session is built around where you are right now and where you want to be — no scripts, no generic advice." },
  { q: "Who is coaching for?", a: "Professionals navigating change, leaders building presence, and anyone ready to become a better version of themselves. Whether you're starting out or rebuilding after success, there's a path for you." },
  { q: "How do I get started?", a: "Create a free account, browse the offerings, and book your first session. You can also use the Smart Match tool to be paired with the right coach for your goals." },
];

function FaqItem({ q, a, isOpen, onToggle }) {
  return (
    <div style={{ borderBottom: "1px solid rgba(27,43,74,0.12)" }}>
      <button onClick={onToggle} className="w-full flex items-center justify-between gap-4 py-5 text-left">
        <span className="text-base md:text-lg font-semibold" style={{ color: NAVY }}>{q}</span>
        <motion.span animate={{ rotate: isOpen ? 180 : 0 }} transition={{ duration: 0.25 }} className="shrink-0">
          <ChevronDownIcon className="w-5 h-5" style={{ color: GOLD }} />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }} className="overflow-hidden"
          >
            <p className="pb-5 pr-10 leading-relaxed" style={{ color: SLATE }}>{a}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Main component ───────────────────────────────────────────── */
const Home = () => {
  const [showModal, setShowModal] = useState(false);
  const [newsletter, setNewsletter] = useState({ first: "", last: "", email: "" });
  const [openFaq, setOpenFaq] = useState(0);
  const [showDrNathModal, setShowDrNathModal] = useState(false);
  const [drNathProfile, setDrNathProfile] = useState(null);
  const [drNathLoading, setDrNathLoading] = useState(false);

  const openDrNathProfile = () => {
    setShowDrNathModal(true);
    if (!drNathProfile) {
      setDrNathLoading(true);
      api.get("/coaches/51/")
        .then(res => setDrNathProfile(res.data))
        .catch(() => {})
        .finally(() => setDrNathLoading(false));
    }
  };

  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > window.innerHeight * 0.5 && !sessionStorage.getItem("newsletter_shown")) {
        setShowModal(true);
        sessionStorage.setItem("newsletter_shown", "true");
      }
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const stats = [
    { value: 500, suffix: "+", label: "Clients Coached" },
    { value: 1200, suffix: "+", label: "Sessions Delivered" },
    { value: 98, suffix: "%", label: "Client Satisfaction" },
    { value: 15, suffix: "+", label: "Years Experience" },
  ];

  const offerings = [
    {
      icon: <SparklesIcon className="w-9 h-9" />,
      title: "Health and Wellness Coaching",
      desc: "Holistic coaching to help you build sustainable habits, manage stress and thrive in every dimension of your health.",
      cta: "Book a Session", to: "/register",
    },
    {
      icon: <UsersIcon className="w-9 h-9" />,
      title: "Executive and Leadership Coaching",
      desc: "Develop your leadership presence, sharpen your decision-making and lead with authentic, lasting confidence.",
      cta: "Book a Session", to: "/register",
    },
    {
      icon: <ChartBarIcon className="w-9 h-9" />,
      title: "Business Coaching for Entrepreneurs",
      desc: "Practical coaching for founders: strategy, growth mindset and the resilience to build something that lasts.",
      cta: "Book a Session", to: "/register",
    },
    {
      icon: <AcademicCapIcon className="w-9 h-9" />,
      title: "Leadership and Management Program",
      desc: "A structured program for managers and emerging leaders to build the skills that drive teams and organizations forward.",
      cta: "Book a Session", to: "/register",
    },
  ];

  const promises = [
    "Gain real clarity on your values, strengths and direction",
    "Build authentic confidence and leadership presence",
    "Turn insight into a concrete, trackable plan of action",
    "Navigate change and uncertainty with steadiness",
  ];

  return (
    <div className="min-h-screen" style={{ fontFamily: "Inter, sans-serif", background: CREAM }}>

      {/* ── HERO (full-bleed photo, Suzy style) ────────────── */}
      <section
        id="top"
        className="relative min-h-screen flex items-end md:items-center overflow-hidden"
        style={{ backgroundColor: NAVY_DEEP }}
      >
        {/* Background photo — portrait on mobile, landscape on md+ */}
        <div
          className="absolute inset-0 md:hidden"
          style={{ backgroundImage: "url('/dr-nath-mobile.jpg')", backgroundSize: "cover", backgroundPosition: "center top", backgroundRepeat: "no-repeat" }}
        />
        <div
          className="absolute inset-0 hidden md:block"
          style={{ backgroundImage: "url('/dr-nath.jpg')", backgroundSize: "cover", backgroundPosition: "right 48px", backgroundRepeat: "no-repeat" }}
        />

        {/* Legibility overlays — stronger bottom wash on mobile, left wash on desktop */}
        <div className="absolute inset-0 md:hidden" style={{ background: "linear-gradient(to top, rgba(17,28,49,0.92) 8%, rgba(17,28,49,0.55) 40%, rgba(17,28,49,0.20) 70%, rgba(17,28,49,0.10) 100%)" }} />
        <div className="absolute inset-0 hidden md:block" style={{ background: "linear-gradient(110deg, rgba(17,28,49,0.80) 0%, rgba(17,28,49,0.55) 30%, rgba(17,28,49,0.12) 55%, rgba(17,28,49,0) 75%)" }} />
        <div className="absolute inset-0 hidden md:block" style={{ background: "linear-gradient(to top, rgba(17,28,49,0.45), transparent 40%)" }} />

        <div className="relative w-full px-8 sm:px-12 lg:px-20 pt-32 pb-20">
          <div className="max-w-2xl flex flex-col">
            <motion.p
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}
              className="text-sm font-semibold uppercase mb-6 flex items-center gap-3 order-last md:order-first mt-6 md:mt-0"
              style={{ color: GOLD, letterSpacing: "0.24em" }}
            >
              Clarity <span>•</span> Growth <span>•</span> Impact
            </motion.p>

            <motion.h1
              initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.1 }}
              className="font-normal leading-[1.02] mb-7 text-[3.25rem] sm:text-6xl lg:text-7xl xl:text-8xl"
              style={{ color: "#F5EEC9", fontFamily: serif }}
            >
              Become a better<br />
              <span style={{ fontStyle: "italic" }}>version</span> of{" "}
              <span style={{ fontStyle: "italic" }}>yourself</span>.
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.25 }}
              className="text-lg md:text-xl leading-relaxed mb-6 max-w-xl"
              style={{ color: "rgba(245,238,201,0.85)" }}
            >
              Through a client-centered approach to coaching, Dr Nath partners with you to help you find clarity,
              unlock your potential for growth, and create long-lasting impact on you, your teams and others.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.32 }}
              className="mb-9"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.2em] mb-3" style={{ color: GOLD }}>Offerings</p>
              <ul className="space-y-1.5">
                {[
                  "Health and Wellness Coaching",
                  "Executive and Leadership Coaching",
                  "Business and Entrepreneurship Coaching",
                  "Leadership and Management Program",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-2 text-base" style={{ color: "rgba(245,238,201,0.85)" }}>
                    <span style={{ color: GOLD }}>•</span> {item}
                  </li>
                ))}
              </ul>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.4 }}
              className="flex flex-col sm:flex-row gap-4"
            >
              <Link
                to="/register"
                className="px-8 py-4 rounded-full text-center font-semibold text-base inline-flex items-center justify-center gap-2 transition-all duration-300 hover:-translate-y-0.5"
                style={{ background: "#F5EEC9", color: NAVY }}
              >
                Book a Session <ArrowRightIcon className="w-5 h-5" />
              </Link>
              <a
                href="#offerings"
                className="px-8 py-4 rounded-full text-center font-semibold text-base inline-flex items-center justify-center gap-2 border transition-all duration-300 hover:-translate-y-0.5"
                style={{ borderColor: "rgba(245,238,201,0.6)", color: "#F5EEC9", background: "rgba(245,238,201,0.06)" }}
              >
                Explore Offerings <ArrowRightIcon className="w-5 h-5" />
              </a>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── STATS TICKER ───────────────────────────────────── */}
      <section className="py-5 overflow-hidden" style={{ background: NAVY }}>
        <div className="flex gap-16 animate-ticker whitespace-nowrap">
          {[...stats, ...stats].map((s, i) => (
            <div key={i} className="flex items-center gap-3 shrink-0">
              <span className="text-2xl font-bold" style={{ color: GOLD, fontFamily: serif }}>
                <Counter end={s.value} suffix={s.suffix} />
              </span>
              <span className="text-sm font-medium" style={{ color: "rgba(250,246,236,0.75)" }}>{s.label}</span>
              <span className="mx-4" style={{ color: "rgba(200,169,81,0.4)" }}>✦</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── WHO IS DR NATH ─────────────────────────────────── */}
      <section id="who" className="py-24 px-6" style={{ background: CREAM }}>
        <div className="max-w-6xl mx-auto grid md:grid-cols-2 gap-14 items-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }}
            transition={{ duration: 0.7 }} className="relative mx-auto w-full max-w-sm order-2 md:order-1"
          >
            <div className="absolute -inset-3 rounded-[2.2rem] opacity-25 blur-2xl" style={{ background: GOLD }} />
            <div
              className="relative aspect-[4/5] rounded-[2rem] overflow-hidden"
              style={{ border: `1px solid ${GOLD}`, background: NAVY_DEEP }}
            >
              <img src="/dr-nath.jpg" alt="Dr. Nath" className="w-full h-full object-cover" style={{ objectPosition: "70% center" }} />
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }}
            transition={{ duration: 0.7 }} className="order-1 md:order-2"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.22em] mb-4" style={{ color: GOLD_DEEP }}>Who is Dr. Nath</p>
            <h2 className="text-4xl md:text-5xl font-normal leading-[1.1] mb-6" style={{ color: NAVY, fontFamily: serif }}>
              A coach who helps you <em>become</em> more you.
            </h2>
            <p className="leading-relaxed mb-5" style={{ color: SLATE }}>
              Dr. Nath holds a PhD and an MBA, and is a certified executive and life coach with a simple belief: real growth is personal.
              Through a client-centered approach, every session is built around your story, your goals and your
              potential — never a one-size-fits-all formula.
            </p>
            <ul className="space-y-3 mb-8">
              {promises.map((p, i) => (
                <li key={i} className="flex items-start gap-3">
                  <CheckIcon className="w-5 h-5 shrink-0 mt-0.5" style={{ color: GOLD }} />
                  <span style={{ color: NAVY }}>{p}</span>
                </li>
              ))}
            </ul>
            <button onClick={openDrNathProfile} className="navy-btn inline-flex items-center gap-2 px-7 py-3 rounded-full">
              Explore More <ArrowRightIcon className="w-5 h-5" />
            </button>
          </motion.div>
        </div>
      </section>

      {/* ── NEWSLETTER BAND ────────────────────────────────── */}
      <section id="newsletter" className="py-20 px-6" style={{ background: `linear-gradient(135deg, ${NAVY}, ${NAVY_DEEP})` }}>
        <div className="max-w-3xl mx-auto text-center">
          <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.7 }}>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] mb-5" style={{ color: GOLD }}>Stay Inspired</p>
            <h2 className="text-4xl md:text-6xl font-normal text-white mb-5 leading-[1.08]" style={{ fontFamily: serif }}>
              A newsletter to help you <em style={{ color: GOLD }}>grow</em>, one week at a time.
            </h2>
            <p className="mb-8 max-w-xl mx-auto" style={{ color: "rgba(250,246,236,0.7)" }}>
              Practical coaching insights, career strategies and the occasional story — clarity, growth and impact in one tidy package.
            </p>
            <form onSubmit={e => e.preventDefault()} className="flex flex-col sm:flex-row gap-3 max-w-2xl mx-auto">
              <input type="text" placeholder="First Name" value={newsletter.first}
                onChange={e => setNewsletter({ ...newsletter, first: e.target.value })}
                className="flex-1 px-5 py-3 rounded-full text-white placeholder-white/40 focus:outline-none"
                style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(200,169,81,0.3)" }} />
              <input type="email" placeholder="Email Address" required value={newsletter.email}
                onChange={e => setNewsletter({ ...newsletter, email: e.target.value })}
                className="flex-1 px-5 py-3 rounded-full text-white placeholder-white/40 focus:outline-none"
                style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(200,169,81,0.3)" }} />
              <button type="submit" className="gold-btn px-8 py-3 rounded-full font-bold shrink-0">Sign Me Up</button>
            </form>
          </motion.div>
        </div>
      </section>

      {/* ── OFFERINGS ──────────────────────────────────────── */}
      <section id="offerings" className="py-24 px-6" style={{ background: CREAM_WARM }}>
        <div className="max-w-6xl mx-auto">
          <motion.div className="text-center mb-16" initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] mb-4" style={{ color: GOLD_DEEP }}>What We Offer</p>
            <h2 className="text-4xl md:text-6xl font-normal leading-tight" style={{ color: NAVY, fontFamily: serif }}>
              Ways to work <em>together</em>
            </h2>
          </motion.div>

          <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-8">
            {offerings.map((o, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 25 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
                transition={{ delay: i * 0.12 }} whileHover={{ y: -6 }}
                className="px-8 py-12 rounded-[2rem] bg-white flex flex-col items-center text-center transition-all duration-300 hover:shadow-xl"
                style={{ border: "1px solid rgba(27,43,74,0.1)" }}
              >
                <div className="w-20 h-20 rounded-full flex items-center justify-center mb-6" style={{ background: "rgba(200,169,81,0.14)", color: GOLD_DEEP }}>
                  {o.icon}
                </div>
                <h3 className="text-2xl font-normal mb-3" style={{ color: NAVY, fontFamily: serif }}>{o.title}</h3>
                <p className="leading-relaxed mb-8 flex-1" style={{ color: SLATE }}>{o.desc}</p>
                <Link
                  to={o.to}
                  className="px-7 py-3 rounded-full font-semibold text-sm inline-flex items-center gap-2 transition-all duration-300 hover:-translate-y-0.5"
                  style={{ background: "rgba(200,169,81,0.16)", color: GOLD_DEEP }}
                >
                  {o.cta} <ArrowRightIcon className="w-4 h-4" />
                </Link>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ───────────────────────────────────── */}
      <section className="py-24 px-6" style={{ background: CREAM }}>
        <div className="max-w-6xl mx-auto">
          <motion.div className="text-center mb-16" initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] mb-4" style={{ color: GOLD_DEEP }}>The Process</p>
            <h2 className="text-4xl md:text-6xl font-normal leading-tight" style={{ color: NAVY, fontFamily: serif }}>How coaching <em>works</em></h2>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              { num: "01", icon: <AcademicCapIcon className="w-9 h-9" />, title: "Discover Your Goals", desc: "We start by exploring your vision, your values and what's truly holding you back." },
              { num: "02", icon: <CalendarIcon className="w-9 h-9" />, title: "Book Your Sessions", desc: "Schedule focused 1-on-1 coaching at times that work for your life and your pace." },
              { num: "03", icon: <ChartBarIcon className="w-9 h-9" />, title: "Grow & Track Impact", desc: "Apply tailored frameworks, track real progress and become who you're meant to be." },
            ].map((step, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 25 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
                transition={{ delay: i * 0.15 }} whileHover={{ y: -4 }}
                className="p-8 rounded-3xl bg-white transition-all duration-300 hover:shadow-md"
                style={{ border: "1px solid rgba(27,43,74,0.1)" }}
              >
                <span className="text-6xl font-normal" style={{ color: "rgba(200,169,81,0.35)", fontFamily: serif }}>{step.num}</span>
                <div className="mt-4 mb-3" style={{ color: GOLD_DEEP }}>{step.icon}</div>
                <h3 className="text-2xl font-normal mb-3" style={{ color: NAVY, fontFamily: serif }}>{step.title}</h3>
                <p className="leading-relaxed" style={{ color: SLATE }}>{step.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── TESTIMONIALS (Suzy cream quote-card) ───────────── */}
      <section className="py-24 px-6" style={{ background: CREAM }}>
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6 }}
            className="relative rounded-[2.5rem] px-6 py-16 md:px-16 md:py-20"
            style={{ background: CREAM_WARM, border: "1px solid rgba(200,169,81,0.3)" }}
          >
            <span className="absolute top-6 left-8 text-7xl leading-none select-none" style={{ color: GOLD, fontFamily: serif }}>&ldquo;</span>
            <span className="absolute bottom-2 right-10 text-7xl leading-none select-none" style={{ color: GOLD, fontFamily: serif }}>&rdquo;</span>
            <TestimonialCarousel />
          </motion.div>
        </div>
      </section>

      {/* ── FINAL CTA ──────────────────────────────────────── */}
      <section className="py-24 px-6" style={{ background: CREAM_WARM }}>
        <motion.div
          className="max-w-4xl mx-auto text-center"
          initial={{ opacity: 0, scale: 0.96 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }} transition={{ duration: 0.7 }}
        >
          <h2 className="text-4xl md:text-6xl font-normal mb-6 leading-tight" style={{ color: NAVY, fontFamily: serif }}>
            Ready to begin your <em>transformation?</em>
          </h2>
          <p className="text-lg mb-10 max-w-2xl mx-auto" style={{ color: SLATE }}>
            Join other professionals.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}>
              <Link to="/register" className="gold-btn px-10 py-4 rounded-full text-base inline-flex items-center gap-2">
                Get Started <ArrowRightIcon className="w-5 h-5" />
              </Link>
            </motion.div>
          </div>
        </motion.div>
      </section>

      {/* ── FOOTER ─────────────────────────────────────────── */}
      <footer className="py-16 px-6" style={{ background: NAVY_DEEP }}>
        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-10 mb-12">
          {[
            { title: "Offerings", links: [{ label: "1-on-1 Coaching", to: "/register" }, { label: "Skill Programs", to: "/skills" }, { label: "Smart Match", to: "/match" }, { label: "Browse Coaches", to: "/coaches" }] },
            { title: "Explore", links: [{ label: "Who is Dr. Nath", to: "/#who" },{ label: "Newsletter", to: "/#newsletter" }] },
            { title: "Account", links: [{ label: "Sign Up", to: "/register" }, { label: "Log In", to: "/login" }, { label: "My Learning", to: "/my-learning" }] },
          ].map((col, i) => (
            <div key={i}>
              <h4 className="text-xl font-normal mb-4" style={{ color: GOLD, fontFamily: serif }}>{col.title}</h4>
              <ul className="space-y-2">
                {col.links.map(l => (
                  <li key={l.label}>
                    <Link to={l.to} className="text-sm transition-colors duration-200 hover:text-[#C8A951]" style={{ color: "rgba(250,246,236,0.5)" }}>{l.label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="pt-8 text-center text-sm" style={{ borderTop: "1px solid rgba(255,255,255,0.1)", color: "rgba(250,246,236,0.3)" }}>
          &copy; {new Date().getFullYear()} Dr. Nath · Coaching for Impact. All rights reserved.
        </div>
      </footer>

      {/* ── NEWSLETTER MODAL ───────────────────────────────── */}
      <AnimatePresence>
        {showModal && <NewsletterModal onClose={() => setShowModal(false)} />}
      </AnimatePresence>

      {/* ── DR. NATH PROFILE MODAL ─────────────────────────── */}
      <AnimatePresence>
        {showDrNathModal && (
          <motion.div
            className="fixed inset-0 z-[60] flex items-center justify-center p-4"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          >
            <motion.div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowDrNathModal(false)} />
            <motion.div
              className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl shadow-2xl z-10"
              style={{ background: CREAM }}
              initial={{ y: 60, opacity: 0, scale: 0.95 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 60, opacity: 0, scale: 0.95 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
            >
              {/* Modal header band */}
              <div className="rounded-t-3xl px-8 pt-8 pb-6" style={{ background: `linear-gradient(135deg, ${NAVY}, ${NAVY_DEEP})` }}>
                <button
                  onClick={() => setShowDrNathModal(false)}
                  className="absolute top-5 right-5 p-1.5 rounded-full transition-colors hover:bg-white/10"
                  style={{ color: "rgba(250,246,236,0.7)" }}
                >
                  <XMarkIcon className="w-5 h-5" />
                </button>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] mb-3" style={{ color: GOLD }}>Meet Your Coach</p>
                {drNathLoading ? (
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: GOLD, borderTopColor: "transparent" }} />
                    <span className="text-sm" style={{ color: "rgba(250,246,236,0.6)" }}>Loading profile…</span>
                  </div>
                ) : drNathProfile ? (
                  <div className="flex items-start gap-5">
                    <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-bold shrink-0" style={{ background: GOLD, color: NAVY_DEEP, fontFamily: serif }}>
                      {(drNathProfile.display_name || drNathProfile.username)?.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h2 className="text-2xl font-normal text-white mb-1" style={{ fontFamily: serif }}>
                        {drNathProfile.display_name || drNathProfile.username}
                      </h2>
                      <div className="flex flex-wrap items-center gap-3 text-sm">
                        {drNathProfile.is_verified && (
                          <span className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background: "rgba(52,168,83,0.2)", color: "#6EE79B", border: "1px solid rgba(52,168,83,0.3)" }}>
                            <CheckBadgeIcon className="w-3.5 h-3.5" /> Verified
                          </span>
                        )}
                        {drNathProfile.years_experience && (
                          <span style={{ color: "rgba(250,246,236,0.6)" }}>{drNathProfile.years_experience} yrs experience</span>
                        )}
                        {drNathProfile.hourly_rate && (
                          <span className="font-semibold" style={{ color: GOLD }}>${drNathProfile.hourly_rate}/hr</span>
                        )}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>

              {/* Modal body */}
              {!drNathLoading && drNathProfile && (
                <div className="px-8 py-6 space-y-6">
                  {/* Bio */}
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: GOLD_DEEP }}>About</p>
                    <p className="leading-relaxed whitespace-pre-line text-sm" style={{ color: SLATE }}>
                      {drNathProfile.bio || ""}
                    </p>
                  </div>

                  {/* Specialties */}
                  {drNathProfile.specialties?.length > 0 && (
                    <div className="rounded-2xl bg-white p-5" style={{ border: "1px solid rgba(27,43,74,0.08)" }}>
                      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: GOLD_DEEP }}>
                        <SparklesIcon className="w-4 h-4" /> Specialties
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {drNathProfile.specialties.map(s => (
                          <span key={s} className="text-xs px-3 py-1.5 rounded-full font-medium" style={{ background: "rgba(200,169,81,0.12)", color: GOLD_DEEP, border: "1px solid rgba(200,169,81,0.2)" }}>{s}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Certifications */}
                  {drNathProfile.certifications?.length > 0 && (
                    <div className="rounded-2xl bg-white p-5" style={{ border: "1px solid rgba(27,43,74,0.08)" }}>
                      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: GOLD_DEEP }}>
                        <AcademicCapIcon className="w-4 h-4" /> Certifications
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {drNathProfile.certifications.map(c => (
                          <span key={c} className="text-xs px-3 py-1.5 rounded-full font-medium" style={{ background: "rgba(200,169,81,0.12)", color: GOLD_DEEP, border: "1px solid rgba(200,169,81,0.2)" }}>{c}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Industries */}
                  {drNathProfile.industries?.length > 0 && (
                    <div className="rounded-2xl bg-white p-5" style={{ border: "1px solid rgba(27,43,74,0.08)" }}>
                      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: GOLD_DEEP }}>
                        <BriefcaseIcon className="w-4 h-4" /> Industries
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {drNathProfile.industries.map(ind => (
                          <span key={ind} className="text-xs px-3 py-1.5 rounded-full font-medium" style={{ background: "rgba(200,169,81,0.12)", color: GOLD_DEEP, border: "1px solid rgba(200,169,81,0.2)" }}>{ind}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Languages */}
                  {drNathProfile.languages?.length > 0 && (
                    <div className="rounded-2xl bg-white p-5" style={{ border: "1px solid rgba(27,43,74,0.08)" }}>
                      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: GOLD_DEEP }}>
                        <GlobeAltIcon className="w-4 h-4" /> Languages
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {drNathProfile.languages.map(l => (
                          <span key={l} className="text-xs px-3 py-1.5 rounded-full font-medium" style={{ background: "rgba(200,169,81,0.12)", color: GOLD_DEEP, border: "1px solid rgba(200,169,81,0.2)" }}>{l}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* CTA */}
                  <Link
                    to="/register"
                    onClick={() => setShowDrNathModal(false)}
                    className="gold-btn flex items-center justify-center gap-2 w-full py-3.5 rounded-2xl text-sm font-bold"
                  >
                    Start Your Journey with Dr. Nath <ArrowRightIcon className="w-4 h-4" />
                  </Link>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Home;
