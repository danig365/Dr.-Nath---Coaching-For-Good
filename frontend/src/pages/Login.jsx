import { useState, useEffect } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  UserIcon,
  LockClosedIcon,
  EyeIcon,
  EyeSlashIcon,
  CheckCircleIcon,
} from "@heroicons/react/24/outline";
import { FcGoogle } from "react-icons/fc";
import { FaFacebook } from "react-icons/fa";
import { useAuth } from "../context/AuthContext";
import { toast } from "react-toastify";

const serif = "'Playfair Display', serif";

const quotes = [
  { text: "The journey of a thousand miles begins with a single step. Dr. Nath helped me take mine.", author: "Sarah M.", role: "VP of Operations" },
  { text: "Coaching for Impact gave me the clarity I had been searching for in years.", author: "James K.", role: "Entrepreneur" },
  { text: "I logged in for the first time and never looked back. Best decision of my career.", author: "Priya R.", role: "Founder, TechStart" },
];

function RotatingQuote() {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setIndex(i => (i + 1) % quotes.length), 4500);
    return () => clearInterval(t);
  }, []);
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={index}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        transition={{ duration: 0.5 }}
        className="rounded-2xl p-6"
        style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(200,169,81,0.2)" }}
      >
        <p className="text-sm italic leading-relaxed mb-4" style={{ color: "rgba(250,246,236,0.85)", fontFamily: serif }}>
          &ldquo;{quotes[index].text}&rdquo;
        </p>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ background: "#C8A951", color: "#14213D" }}>
            {quotes[index].author.split(" ").map(n => n[0]).join("")}
          </div>
          <div>
            <p className="text-xs font-semibold text-white">{quotes[index].author}</p>
            <p className="text-xs" style={{ color: "rgba(200,169,81,0.7)" }}>{quotes[index].role}</p>
          </div>
        </div>
        {/* Dot indicators */}
        <div className="flex gap-1.5 mt-4">
          {quotes.map((_, i) => (
            <div
              key={i}
              className="h-1 rounded-full transition-all duration-300"
              style={{ width: i === index ? "20px" : "6px", background: i === index ? "#C8A951" : "rgba(200,169,81,0.25)" }}
            />
          ))}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

const Login = () => {
  const [form, setForm] = useState({ username: "", password: "" });
  const [showPass, setShowPass] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Where to land after auth. Set by flows that send the user to log in mid-task
  // (e.g. a guest confirming a booking). Falls back to role-based defaults.
  const next = searchParams.get("next");
  const { login, isAuthenticated, isAdmin, isCoach, loading: authContextLoading } = useAuth();

  const redirectAfterAuth = (role) => {
    if (next) { navigate(next, { replace: true }); return; }
    if (role === "admin") navigate("/admin", { replace: true });
    else if (role === "coach") navigate("/my-skills", { replace: true });
    else navigate("/skills", { replace: true });
  };

  useEffect(() => {
    if (!authContextLoading && isAuthenticated) {
      if (next) { navigate(next, { replace: true }); return; }
      if (isAdmin()) navigate("/admin", { replace: true });
      else if (isCoach()) navigate("/my-skills", { replace: true });
      else navigate("/skills", { replace: true });
    }
  }, [authContextLoading, isAuthenticated, navigate]);

  const handleChange = e => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const loggedInUser = await login(form.username, form.password);
      if (loggedInUser) {
        redirectAfterAuth(loggedInUser.role);
      }
    } catch (err) {
      console.error("Login error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSocialLogin = (provider) => {
    toast.info(`Social login with ${provider} is not yet implemented.`);
  };

  if (authContextLoading || isAuthenticated) {
    return (
      <div className="flex justify-center items-center min-h-screen" style={{ background: "#14213D" }}>
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "#C8A951", borderTopColor: "transparent" }} />
          <p className="text-sm" style={{ color: "rgba(250,246,236,0.5)" }}>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex" style={{ background: "#14213D" }}>

      {/* ── LEFT PANEL ─────────────────────────────────── */}
      <div className="hidden lg:flex lg:w-5/12 flex-col justify-center pt-28 pb-12 px-12 relative overflow-hidden gap-10" style={{ background: "linear-gradient(160deg, #1B2B4A, #14213D)", minHeight: "100vh" }}>
        <div className="absolute top-0 right-0 w-64 h-64 rounded-full blur-3xl opacity-20" style={{ background: "#C8A951" }} />
        <div className="absolute bottom-0 left-0 w-48 h-48 rounded-full blur-3xl opacity-15" style={{ background: "#233A63" }} />

        <div className="relative">
          <Link to="/" className="flex items-center gap-3 mb-10">
            <img src="/dr-nath-logo.png" alt="Dr. Nath" className="h-14 w-auto object-contain" />
            <div className="flex flex-col leading-tight">
              <span className="font-bold text-white text-lg" style={{ fontFamily: serif }}>Dr. Nath</span>
              <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#C8A951" }}>Coaching for Impact</span>
            </div>
          </Link>

          <h2 className="text-5xl font-normal text-white leading-tight mb-4" style={{ fontFamily: serif }}>
            Welcome <br />
            <span style={{ color: "#C8A951", fontStyle: "italic" }}>Back.</span>
          </h2>
          <p className="text-sm leading-relaxed" style={{ color: "rgba(250,246,236,0.65)" }}>
            Your coaching journey continues here. Sign in to pick up right where you left off.
          </p>
        </div>

        <div className="relative">
          <p className="text-xs font-semibold uppercase tracking-widest mb-4" style={{ color: "rgba(200,169,81,0.6)" }}>What members say</p>
          <RotatingQuote />
        </div>
      </div>

      {/* ── RIGHT PANEL ────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center p-6 pt-28 pb-12">
        <motion.div
          className="w-full max-w-md"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          {/* Card */}
          <div className="rounded-2xl overflow-hidden" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(200,169,81,0.15)" }}>

            {/* Header */}
            <div className="px-8 py-6" style={{ borderBottom: "1px solid rgba(200,169,81,0.1)" }}>
              <h2 className="text-3xl font-normal text-white" style={{ fontFamily: serif }}>
                Sign In
              </h2>
              <p className="text-sm mt-1" style={{ color: "rgba(250,246,236,0.5)" }}>
                Access your Dr. Nath account
              </p>
            </div>

            {/* Mid-booking context: tell the user why they're here */}
            {next && next.startsWith("/book/") && (
              <div className="mx-8 mt-5 px-4 py-3 rounded-xl flex items-start gap-2.5"
                style={{ background: "rgba(200,169,81,0.12)", border: "1px solid rgba(200,169,81,0.3)" }}>
                <CheckCircleIcon className="w-5 h-5 shrink-0 mt-0.5" style={{ color: "#C8A951" }} />
                <p className="text-sm leading-relaxed" style={{ color: "rgba(250,246,236,0.85)" }}>
                  Almost there! Sign in to confirm your booking — your selected time and details are saved.
                </p>
              </div>
            )}

            <div className="px-8 py-6 space-y-5">

              {/* Social buttons */}
              <div className="space-y-3">
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => handleSocialLogin("google")}
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
                  onClick={() => handleSocialLogin("facebook")}
                  className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded-full text-sm font-medium text-white transition-all duration-200"
                  style={{ background: "#1877F2" }}
                >
                  <FaFacebook className="h-5 w-5" />
                  Continue with Facebook
                </motion.button>
              </div>

              {/* Divider */}
              <div className="relative flex items-center">
                <div className="flex-1 h-px" style={{ background: "rgba(200,169,81,0.2)" }} />
                <span className="px-4 text-xs" style={{ color: "rgba(250,246,236,0.4)" }}>or sign in with email</span>
                <div className="flex-1 h-px" style={{ background: "rgba(200,169,81,0.2)" }} />
              </div>

              {/* Form */}
              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Username */}
                <div>
                  <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: "rgba(200,169,81,0.8)" }}>
                    Username
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                      <UserIcon className="h-4 w-4" style={{ color: "#C8A951" }} />
                    </div>
                    <input
                      type="text"
                      name="username"
                      value={form.username}
                      onChange={handleChange}
                      placeholder="Enter your username"
                      required
                      className="block w-full pl-10 pr-4 py-3 rounded-xl text-sm focus:outline-none transition-all duration-200"
                      style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.3)", color: "#1B2B4A" }}
                      onFocus={e => e.target.style.borderColor = "#C8A951"}
                      onBlur={e => e.target.style.borderColor = "rgba(200,169,81,0.3)"}
                    />
                  </div>
                </div>

                {/* Password */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-semibold uppercase tracking-wider" style={{ color: "rgba(200,169,81,0.8)" }}>
                      Password
                    </label>
                    <a href="#" className="text-xs transition-colors hover:text-[#C8A951]" style={{ color: "rgba(200,169,81,0.5)" }}>
                      Forgot password?
                    </a>
                  </div>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                      <LockClosedIcon className="h-4 w-4" style={{ color: "#C8A951" }} />
                    </div>
                    <input
                      type={showPass ? "text" : "password"}
                      name="password"
                      value={form.password}
                      onChange={handleChange}
                      placeholder="Enter your password"
                      required
                      className="block w-full pl-10 pr-10 py-3 rounded-xl text-sm focus:outline-none transition-all duration-200"
                      style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.3)", color: "#1B2B4A" }}
                      onFocus={e => e.target.style.borderColor = "#C8A951"}
                      onBlur={e => e.target.style.borderColor = "rgba(200,169,81,0.3)"}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass(v => !v)}
                      className="absolute inset-y-0 right-0 pr-3.5 flex items-center"
                      style={{ color: "rgba(200,169,81,0.6)" }}
                    >
                      {showPass ? <EyeSlashIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Remember me */}
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded"
                    style={{ accentColor: "#C8A951" }}
                  />
                  <span className="text-xs" style={{ color: "rgba(250,246,236,0.5)" }}>Remember me</span>
                </label>

                {/* Submit */}
                <motion.button
                  type="submit"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  disabled={isLoading}
                  className="w-full py-3 rounded-full text-sm font-bold transition-all duration-300 gold-btn disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Signing in...
                    </span>
                  ) : "Sign In →"}
                </motion.button>
              </form>

              <p className="text-center text-xs pt-1" style={{ color: "rgba(250,246,236,0.4)" }}>
                Don&apos;t have an account?{" "}
                <Link to={next ? `/register?next=${encodeURIComponent(next)}` : "/register"} className="font-semibold transition-colors hover:text-[#C8A951]" style={{ color: "rgba(200,169,81,0.8)" }}>
                  Create one
                </Link>
              </p>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default Login;
