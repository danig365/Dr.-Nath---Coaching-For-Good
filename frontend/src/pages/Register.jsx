import { useState, useEffect } from "react";
import { api } from "../utils/auth";
import { toast } from "react-toastify";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  UserIcon,
  EnvelopeIcon,
  LockClosedIcon,
  IdentificationIcon,
  PencilIcon,
  EyeIcon,
  EyeSlashIcon,
  CheckCircleIcon,
  BriefcaseIcon,
} from "@heroicons/react/24/outline";
import { FcGoogle } from "react-icons/fc";
import { FaFacebook } from "react-icons/fa";

const steps = ["Account", "Profile", "Details"];

const roleWords = ["Coach", "Client", "Leader", "Mentor"];

function RotatingRoleWord() {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setIndex(i => (i + 1) % roleWords.length), 2200);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="inline-block overflow-hidden h-[1.2em] align-middle">
      <AnimatePresence mode="wait">
        <motion.span
          key={roleWords[index]}
          initial={{ y: 30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -30, opacity: 0 }}
          transition={{ duration: 0.4 }}
          className="block"
          style={{ color: "#C8A951", fontStyle: "italic" }}
        >
          {roleWords[index]}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

function PasswordStrength({ password }) {
  const checks = [
    { label: "8+ characters", ok: password.length >= 8 },
    { label: "Uppercase letter", ok: /[A-Z]/.test(password) },
    { label: "Number", ok: /\d/.test(password) },
  ];
  if (!password) return null;
  return (
    <div className="mt-2 flex gap-3">
      {checks.map(c => (
        <span key={c.label} className="flex items-center gap-1 text-xs" style={{ color: c.ok ? "#C8A951" : "rgba(74,85,104,0.6)" }}>
          <CheckCircleIcon className="w-3.5 h-3.5" style={{ color: c.ok ? "#C8A951" : "rgba(74,85,104,0.4)" }} />
          {c.label}
        </span>
      ))}
    </div>
  );
}

function FloatingInput({ id, name, type = "text", placeholder, icon: Icon, value, onChange, required, rightEl }) {
  return (
    <div className="relative">
      <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
        <Icon className="h-4 w-4" style={{ color: "#C8A951" }} />
      </div>
      <input
        id={id}
        name={name}
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        required={required}
        className="block w-full pl-10 pr-10 py-3 rounded-xl text-sm transition-all duration-200 focus:outline-none focus:ring-2"
        style={{
          background: "#FAF6EC",
          border: "1px solid rgba(200,169,81,0.3)",
          color: "#1B2B4A",
        }}
        onFocus={e => e.target.style.borderColor = "#C8A951"}
        onBlur={e => e.target.style.borderColor = "rgba(200,169,81,0.3)"}
      />
      {rightEl && (
        <div className="absolute inset-y-0 right-0 pr-3.5 flex items-center">{rightEl}</div>
      )}
    </div>
  );
}

export default function Register() {
  const [searchParams] = useSearchParams();
  const [step, setStep] = useState(0);
  const [showPass, setShowPass] = useState(false);
  const [showPass2, setShowPass2] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [form, setForm] = useState(() => ({
    username: "", email: "", password: "", password2: "",
    role: searchParams.get("role") || "client",
    bio: "",
    specialties: [], certifications: [], hourly_rate: null,
    years_experience: null, languages: [], industries: [],
    organisation: "", job_title: "",
  }));
  const navigate = useNavigate();

  useEffect(() => {
    const roleParam = searchParams.get("role");
    if (roleParam === "coach" || roleParam === "client") {
      setForm(p => ({ ...p, role: roleParam }));
    }
  }, [searchParams]);

  const handleChange = e => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (form.password !== form.password2) { toast.error("Passwords do not match."); return; }
    setIsLoading(true);
    try {
      await api.post("/register/", form);
      if (form.role === "coach") {
        toast.info("Registration submitted. Your profile is under review.");
      } else {
        toast.success("Registered successfully! You can now log in.");
      }
      navigate("/login");
    } catch (err) {
      const d = err.response?.data;
      if (d) {
        if (d.username) toast.error(`Username: ${d.username[0]}`);
        if (d.email) toast.error(`Email: ${d.email[0]}`);
        if (d.password) toast.error(`Password: ${d.password[0]}`);
        if (d.non_field_errors) toast.error(d.non_field_errors[0]);
        else if (d.detail) toast.error(d.detail);
        else toast.error("Registration failed. Please check your input.");
      } else {
        toast.error("An unexpected error occurred.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleSocialRegister = (provider) => {
    toast.info(`Social login with ${provider} is not yet implemented.`);
  };

  const isStep0Valid = form.username && form.email && form.password && form.password2 && form.password === form.password2;
  const isStep1Valid = form.role;

  const stepVariants = {
    initial: { opacity: 0, x: 30 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -30 },
  };

  return (
    <div className="min-h-screen flex" style={{ background: "#14213D" }}>

      {/* ── LEFT PANEL ─────────────────────────────────── */}
      <div className="hidden lg:flex lg:w-5/12 flex-col justify-center pt-28 pb-12 px-12 relative overflow-hidden gap-10" style={{ background: "linear-gradient(160deg, #1B2B4A, #14213D)", minHeight: "100vh" }}>
        {/* Ambient glow */}
        <div className="absolute top-0 right-0 w-64 h-64 rounded-full blur-3xl opacity-20" style={{ background: "#C8A951" }} />
        <div className="absolute bottom-0 left-0 w-48 h-48 rounded-full blur-3xl opacity-15" style={{ background: "#233A63" }} />

        <div className="relative">
          <Link to="/" className="flex items-center gap-3 mb-10">
            <img src="/dr-nath-logo.png" alt="Dr. Nath" className="h-14 w-auto object-contain" />
            <div className="flex flex-col leading-tight">
              <span className="font-bold text-white text-lg" style={{ fontFamily: "'Playfair Display', serif" }}>Dr. Nath</span>
              <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#C8A951" }}>Coaching for Good</span>
            </div>
          </Link>

          <h2 className="text-5xl font-normal text-white leading-tight mb-4" style={{ fontFamily: "'Playfair Display', serif" }}>
            Become a <br /><RotatingRoleWord />
          </h2>
          <p className="text-sm leading-relaxed" style={{ color: "rgba(250,246,236,0.65)" }}>
            Join hundreds of professionals transforming their careers and lives through expert coaching.
          </p>
        </div>

        {/* Testimonial */}
        <div className="relative rounded-2xl p-6" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(200,169,81,0.2)" }}>
          <p className="text-sm italic leading-relaxed mb-4" style={{ color: "rgba(250,246,236,0.85)", fontFamily: "'Playfair Display', serif" }}>
            &ldquo;Signing up was the best decision of my career. Within weeks I had clarity and a plan I actually believed in.&rdquo;
          </p>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: "#C8A951", color: "#14213D" }}>AK</div>
            <div>
              <p className="text-xs font-semibold text-white">Aisha K.</p>
              <p className="text-xs" style={{ color: "rgba(200,169,81,0.7)" }}>Founder &amp; CEO</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── RIGHT PANEL ────────────────────────────────── */}
      <div className="flex-1 flex items-start justify-center p-6 pt-28 pb-12 overflow-y-auto">
        <div className="w-full max-w-md">

          {/* Step indicator */}
          <div className="flex items-center gap-2 mb-8">
            {steps.map((s, i) => (
              <div key={s} className="flex items-center gap-2">
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300"
                  style={{
                    background: i <= step ? "#C8A951" : "rgba(255,255,255,0.1)",
                    color: i <= step ? "#14213D" : "rgba(255,255,255,0.4)",
                  }}
                >
                  {i < step ? "✓" : i + 1}
                </div>
                <span className="text-xs font-medium hidden sm:block" style={{ color: i === step ? "#C8A951" : "rgba(255,255,255,0.4)" }}>{s}</span>
                {i < steps.length - 1 && (
                  <div className="w-8 h-px mx-1" style={{ background: i < step ? "#C8A951" : "rgba(255,255,255,0.15)" }} />
                )}
              </div>
            ))}
          </div>

          <div className="rounded-2xl overflow-hidden" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(200,169,81,0.15)" }}>
            {/* Header */}
            <div className="px-8 py-6" style={{ borderBottom: "1px solid rgba(200,169,81,0.1)" }}>
              <h2 className="text-3xl font-normal text-white" style={{ fontFamily: "'Playfair Display', serif" }}>
                {step === 0 ? "Create Your Account" : step === 1 ? "Choose Your Role" : "Complete Your Profile"}
              </h2>
              <p className="text-sm mt-1" style={{ color: "rgba(250,246,236,0.5)" }}>
                {step === 0 ? "Join Coaching for Good today" : step === 1 ? "How will you be using the platform?" : "Just a few more details"}
              </p>
            </div>

            <form onSubmit={step < 2 ? (e) => { e.preventDefault(); setStep(s => s + 1); } : handleSubmit} className="px-8 py-6 space-y-5">

              <AnimatePresence mode="wait">

                {/* ── STEP 0: Account ─── */}
                {step === 0 && (
                  <motion.div key="step0" variants={stepVariants} initial="initial" animate="animate" exit="exit" transition={{ duration: 0.3 }} className="space-y-4">

                    {/* Social buttons */}
                    <div className="space-y-3">
                      <motion.button
                        type="button"
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => handleSocialRegister("google")}
                        className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded-full text-sm font-medium transition-all duration-200"
                        style={{ background: "#FAF6EC", color: "#1B2B4A", border: "1px solid rgba(200,169,81,0.2)" }}
                      >
                        <FcGoogle className="h-5 w-5" />
                        Continue with Google
                      </motion.button>
                      <motion.button
                        type="button"
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => handleSocialRegister("facebook")}
                        className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded-full text-sm font-medium transition-all duration-200 text-white"
                        style={{ background: "#1877F2" }}
                      >
                        <FaFacebook className="h-5 w-5" />
                        Continue with Facebook
                      </motion.button>
                    </div>

                    <div className="relative flex items-center">
                      <div className="flex-1 h-px" style={{ background: "rgba(200,169,81,0.2)" }} />
                      <span className="px-4 text-xs" style={{ color: "rgba(250,246,236,0.4)" }}>or register with email</span>
                      <div className="flex-1 h-px" style={{ background: "rgba(200,169,81,0.2)" }} />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: "rgba(200,169,81,0.8)" }}>Username</label>
                      <FloatingInput id="username" name="username" placeholder="Choose a username" icon={UserIcon} value={form.username} onChange={handleChange} required />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: "rgba(200,169,81,0.8)" }}>Email</label>
                      <FloatingInput id="email" name="email" type="email" placeholder="your@email.com" icon={EnvelopeIcon} value={form.email} onChange={handleChange} required />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: "rgba(200,169,81,0.8)" }}>Password</label>
                      <FloatingInput
                        id="password" name="password" type={showPass ? "text" : "password"}
                        placeholder="Create a strong password" icon={LockClosedIcon}
                        value={form.password} onChange={handleChange} required
                        rightEl={
                          <button type="button" onClick={() => setShowPass(v => !v)} style={{ color: "rgba(200,169,81,0.6)" }}>
                            {showPass ? <EyeSlashIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
                          </button>
                        }
                      />
                      <PasswordStrength password={form.password} />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: "rgba(200,169,81,0.8)" }}>Confirm Password</label>
                      <FloatingInput
                        id="password2" name="password2" type={showPass2 ? "text" : "password"}
                        placeholder="Repeat your password" icon={LockClosedIcon}
                        value={form.password2} onChange={handleChange} required
                        rightEl={
                          <button type="button" onClick={() => setShowPass2(v => !v)} style={{ color: "rgba(200,169,81,0.6)" }}>
                            {showPass2 ? <EyeSlashIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
                          </button>
                        }
                      />
                      {form.password2 && form.password !== form.password2 && (
                        <p className="text-xs mt-1" style={{ color: "#E57373" }}>Passwords do not match</p>
                      )}
                    </div>
                  </motion.div>
                )}

                {/* ── STEP 1: Role ─── */}
                {step === 1 && (
                  <motion.div key="step1" variants={stepVariants} initial="initial" animate="animate" exit="exit" transition={{ duration: 0.3 }} className="space-y-4">
                    {[
                      { value: "client", icon: "🎯", title: "I'm a Client", desc: "I want to find a coach and work on my personal or professional growth." },
                      { value: "coach", icon: "🏆", title: "I'm a Coach", desc: "I want to offer my expertise and coach clients through their challenges." },
                    ].map(opt => (
                      <motion.button
                        key={opt.value}
                        type="button"
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => setForm(f => ({ ...f, role: opt.value }))}
                        className="w-full text-left p-5 rounded-xl transition-all duration-200"
                        style={{
                          background: form.role === opt.value ? "rgba(200,169,81,0.15)" : "rgba(255,255,255,0.04)",
                          border: `2px solid ${form.role === opt.value ? "#C8A951" : "rgba(255,255,255,0.08)"}`,
                        }}
                      >
                        <div className="flex items-start gap-4">
                          <span className="text-2xl">{opt.icon}</span>
                          <div>
                            <p className="font-semibold text-sm text-white mb-1">{opt.title}</p>
                            <p className="text-xs leading-relaxed" style={{ color: "rgba(250,246,236,0.55)" }}>{opt.desc}</p>
                          </div>
                          {form.role === opt.value && (
                            <CheckCircleIcon className="w-5 h-5 ml-auto shrink-0 mt-0.5" style={{ color: "#C8A951" }} />
                          )}
                        </div>
                      </motion.button>
                    ))}
                  </motion.div>
                )}

                {/* ── STEP 2: Details ─── */}
                {step === 2 && (
                  <motion.div key="step2" variants={stepVariants} initial="initial" animate="animate" exit="exit" transition={{ duration: 0.3 }} className="space-y-4">

                    {form.role === "coach" && (
                      <>
                        <div>
                          <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: "rgba(200,169,81,0.8)" }}>Specialties</label>
                          <input
                            placeholder="e.g. Leadership, Executive, Career"
                            className="block w-full px-4 py-3 rounded-xl text-sm focus:outline-none"
                            style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.3)", color: "#1B2B4A" }}
                            onChange={e => setForm({ ...form, specialties: e.target.value.split(",").map(s => s.trim()) })}
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: "rgba(200,169,81,0.8)" }}>Certifications</label>
                          <input
                            placeholder="e.g. ICF PCC, EMCC"
                            className="block w-full px-4 py-3 rounded-xl text-sm focus:outline-none"
                            style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.3)", color: "#1B2B4A" }}
                            onChange={e => setForm({ ...form, certifications: e.target.value.split(",").map(s => s.trim()) })}
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: "rgba(200,169,81,0.8)" }}>Hourly Rate (USD)</label>
                            <input name="hourly_rate" type="number" placeholder="150" className="block w-full px-4 py-3 rounded-xl text-sm focus:outline-none" style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.3)", color: "#1B2B4A" }} onChange={handleChange} />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: "rgba(200,169,81,0.8)" }}>Years Exp.</label>
                            <input name="years_experience" type="number" placeholder="5" className="block w-full px-4 py-3 rounded-xl text-sm focus:outline-none" style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.3)", color: "#1B2B4A" }} onChange={handleChange} />
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: "rgba(200,169,81,0.8)" }}>Industries</label>
                          <input
                            placeholder="e.g. Healthcare, Finance, Tech"
                            className="block w-full px-4 py-3 rounded-xl text-sm focus:outline-none"
                            style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.3)", color: "#1B2B4A" }}
                            onChange={e => setForm({ ...form, industries: e.target.value.split(",").map(s => s.trim()) })}
                          />
                        </div>
                      </>
                    )}

                    {form.role === "client" && (
                      <>
                        <div>
                          <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: "rgba(200,169,81,0.8)" }}>Organisation</label>
                          <FloatingInput name="organisation" placeholder="Your company or organisation" icon={BriefcaseIcon} value={form.organisation} onChange={handleChange} />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: "rgba(200,169,81,0.8)" }}>Job Title</label>
                          <FloatingInput name="job_title" placeholder="e.g. Product Manager" icon={IdentificationIcon} value={form.job_title} onChange={handleChange} />
                        </div>
                      </>
                    )}

                    <div>
                      <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: "rgba(200,169,81,0.8)" }}>About You <span style={{ color: "rgba(200,169,81,0.4)" }}>(Optional)</span></label>
                      <div className="relative">
                        <div className="absolute top-3 left-3.5">
                          <PencilIcon className="h-4 w-4" style={{ color: "#C8A951" }} />
                        </div>
                        <textarea
                          name="bio"
                          rows={3}
                          placeholder="Tell us a bit about yourself..."
                          className="block w-full pl-10 pr-4 py-3 rounded-xl text-sm focus:outline-none resize-none"
                          style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.3)", color: "#1B2B4A" }}
                          onChange={handleChange}
                          value={form.bio}
                        />
                      </div>
                    </div>
                  </motion.div>
                )}

              </AnimatePresence>

              {/* Navigation buttons */}
              <div className="flex gap-3 pt-2">
                {step > 0 && (
                  <button
                    type="button"
                    onClick={() => setStep(s => s - 1)}
                    className="flex-1 py-3 rounded-full text-sm font-semibold transition-all duration-200"
                    style={{ background: "rgba(255,255,255,0.06)", color: "rgba(250,246,236,0.7)", border: "1px solid rgba(255,255,255,0.1)" }}
                  >
                    ← Back
                  </button>
                )}
                <motion.button
                  type="submit"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  disabled={isLoading || (step === 0 && !isStep0Valid)}
                  className="flex-1 py-3 rounded-full text-sm font-bold transition-all duration-300 gold-btn disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                >
                  {isLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Creating Account...
                    </span>
                  ) : step < 2 ? "Continue →" : "Create Account →"}
                </motion.button>
              </div>

              <p className="text-center text-xs pt-1" style={{ color: "rgba(250,246,236,0.4)" }}>
                Already have an account?{" "}
                <Link to="/login" className="font-semibold transition-colors hover:text-[#C8A951]" style={{ color: "rgba(200,169,81,0.8)" }}>
                  Sign in
                </Link>
              </p>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
