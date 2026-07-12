import { useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { FiMail, FiArrowLeft, FiCheckCircle } from "react-icons/fi";

const GOLD = "#C8A951";
const DARK = "#1B2B4A";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!email.trim()) { setError("Please enter your email."); return; }
    setBusy(true);
    try {
      const base = axios.create({ baseURL: "/api/" });
      await base.post("password-reset/", { email: email.trim() });
      setSent(true);
    } catch (err) {
      const s = err.response?.status;
      setError(s === 429 ? "Too many attempts. Please wait a minute and try again." : "Something went wrong. Please try again.");
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6" style={{ background: "#14213D" }}>
      <div className="w-full max-w-md rounded-2xl p-8" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(200,169,81,0.2)" }}>
        {sent ? (
          <div className="text-center">
            <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: "rgba(52,168,83,0.15)" }}>
              <FiCheckCircle size={26} style={{ color: "#34A853" }} />
            </div>
            <h1 className="text-2xl font-normal text-white mb-2" style={{ fontFamily: "'Playfair Display', serif" }}>Check your inbox</h1>
            <p className="text-sm mb-6" style={{ color: "rgba(250,246,236,0.6)" }}>
              If an account exists for <span style={{ color: "#fff" }}>{email}</span>, we've sent a link to reset your password. It may take a minute to arrive — do check your spam folder too.
            </p>
            <Link to="/login" className="inline-flex items-center gap-2 text-sm font-semibold" style={{ color: GOLD }}>
              <FiArrowLeft size={14} /> Back to sign in
            </Link>
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-normal text-white mb-1" style={{ fontFamily: "'Playfair Display', serif" }}>Forgot your password?</h1>
            <p className="text-sm mb-6" style={{ color: "rgba(250,246,236,0.6)" }}>
              Enter your account email and we'll send you a link to reset it.
            </p>
            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: "rgba(250,246,236,0.5)" }}>Email</label>
                <div className="relative">
                  <FiMail size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: GOLD }} />
                  <input type="email" value={email} onChange={(e) => { setError(""); setEmail(e.target.value); }}
                    placeholder="you@email.com"
                    className="w-full pl-10 pr-4 py-3 rounded-xl text-sm focus:outline-none"
                    style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(200,169,81,0.25)", color: "#fff" }} />
                </div>
              </div>
              {error && (
                <div className="rounded-xl px-4 py-3 text-sm" style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.4)", color: "#FCA5A5" }}>
                  {error}
                </div>
              )}
              <button type="submit" disabled={busy}
                className="w-full py-3 rounded-full text-sm font-bold gold-btn disabled:opacity-50">
                {busy ? "Sending…" : "Send reset link"}
              </button>
            </form>
            <div className="text-center mt-5">
              <Link to="/login" className="inline-flex items-center gap-2 text-sm font-semibold" style={{ color: "rgba(200,169,81,0.8)" }}>
                <FiArrowLeft size={14} /> Back to sign in
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
