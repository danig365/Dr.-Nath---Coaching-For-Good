import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import axios from "axios";
import { toast } from "react-toastify";
import { FiLock, FiEye, FiEyeOff, FiArrowLeft } from "react-icons/fi";

const GOLD = "#C8A951";

export default function ResetPassword() {
  const { uid, token } = useParams();
  const navigate = useNavigate();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (pw.length < 8) { setError("Your new password must be at least 8 characters."); return; }
    if (pw !== pw2) { setError("The two passwords don't match."); return; }
    setBusy(true);
    try {
      const base = axios.create({ baseURL: "/api/" });
      await base.post("password-reset/confirm/", { uid, token, new_password: pw });
      toast.success("Password reset! Please sign in with your new password.");
      navigate("/login", { replace: true });
    } catch (err) {
      setError(err.response?.data?.detail || "Couldn't reset your password. Please try again.");
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6" style={{ background: "#14213D" }}>
      <div className="w-full max-w-md rounded-2xl p-8" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(200,169,81,0.2)" }}>
        <h1 className="text-2xl font-normal text-white mb-1" style={{ fontFamily: "'Playfair Display', serif" }}>Choose a new password</h1>
        <p className="text-sm mb-6" style={{ color: "rgba(250,246,236,0.6)" }}>Enter a new password for your account below.</p>
        <form onSubmit={submit} className="space-y-4">
          {[["New password", pw, setPw], ["Confirm password", pw2, setPw2]].map(([label, val, setter], i) => (
            <div key={label}>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: "rgba(250,246,236,0.5)" }}>{label}</label>
              <div className="relative">
                <FiLock size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: GOLD }} />
                <input type={show ? "text" : "password"} value={val} onChange={(e) => { setError(""); setter(e.target.value); }}
                  placeholder="••••••••"
                  className="w-full pl-10 pr-10 py-3 rounded-xl text-sm focus:outline-none"
                  style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(200,169,81,0.25)", color: "#fff" }} />
                {i === 0 && (
                  <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: "rgba(250,246,236,0.5)" }}>
                    {show ? <FiEyeOff size={16} /> : <FiEye size={16} />}
                  </button>
                )}
              </div>
            </div>
          ))}
          {error && (
            <div className="rounded-xl px-4 py-3 text-sm" style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.4)", color: "#FCA5A5" }}>
              {error}
            </div>
          )}
          <button type="submit" disabled={busy} className="w-full py-3 rounded-full text-sm font-bold gold-btn disabled:opacity-50">
            {busy ? "Saving…" : "Reset password"}
          </button>
        </form>
        <div className="text-center mt-5">
          <Link to="/login" className="inline-flex items-center gap-2 text-sm font-semibold" style={{ color: "rgba(200,169,81,0.8)" }}>
            <FiArrowLeft size={14} /> Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
