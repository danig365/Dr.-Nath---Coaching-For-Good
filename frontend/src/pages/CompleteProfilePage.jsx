import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { toast } from "react-toastify";
import { FiUser, FiX, FiPlus } from "react-icons/fi";
import { api } from "../utils/auth";
import { useAuth } from "../context/AuthContext";

const BORDER_DEFAULT = "rgba(200,169,81,0.3)";
const BORDER_FOCUS = "#C8A951";
const FIELD_STYLE = { background: "#FAF6EC", border: `1px solid ${BORDER_DEFAULT}`, color: "#1B2B4A" };

const inputCls = "w-full px-4 py-3 rounded-xl text-sm focus:outline-none transition-all duration-200";

function onFocus(e) { e.target.style.borderColor = BORDER_FOCUS; }
function onBlur(e) { e.target.style.borderColor = BORDER_DEFAULT; }

function Label({ children, required }) {
  return (
    <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: "rgba(74,85,104,0.7)" }}>
      {children}{required && <span style={{ color: "#C8A951" }}> *</span>}
    </label>
  );
}

function SectionTitle({ children }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#C8A951" }}>
      {children}
    </p>
  );
}

function Divider() {
  return <div style={{ borderTop: "1px solid rgba(200,169,81,0.12)" }} />;
}

function TagInput({ tags, onChange, placeholder }) {
  const [input, setInput] = useState("");

  const add = () => {
    const val = input.trim();
    if (val && !tags.includes(val)) onChange([...tags, val]);
    setInput("");
  };

  const remove = (tag) => onChange(tags.filter(t => t !== tag));

  const handleKey = (e) => {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); }
    if (e.key === "Backspace" && !input && tags.length) remove(tags[tags.length - 1]);
  };

  return (
    <div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {tags.map(t => (
            <span
              key={t}
              className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full"
              style={{ background: "rgba(200,169,81,0.12)", color: "#A9863A", border: "1px solid rgba(200,169,81,0.25)" }}
            >
              {t}
              <button type="button" onClick={() => remove(t)} className="hover:opacity-70">
                <FiX size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          onFocus={onFocus}
          onBlur={onBlur}
          placeholder={placeholder}
          className={inputCls}
          style={FIELD_STYLE}
        />
        <button
          type="button"
          onClick={add}
          className="px-3 py-2 rounded-xl shrink-0 transition-opacity hover:opacity-75"
          style={{ background: "rgba(200,169,81,0.15)", color: "#A9863A", border: "1px solid rgba(200,169,81,0.3)" }}
        >
          <FiPlus size={16} />
        </button>
      </div>
      <p className="text-xs mt-1" style={{ color: "rgba(74,85,104,0.45)" }}>Press Enter or comma to add</p>
    </div>
  );
}

export default function CompleteProfilePage() {
  const { role, isAuthenticated, profileComplete, markProfileComplete, logout } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const next = searchParams.get("next");

  const isCoach = role === "coach";
  const isClient = role === "client";

  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    bio: "",
    specialties: [],
    hourly_rate: "",
    job_title: "",
    organisation: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Inline error by the button — a top toast is easy to miss on mobile.
  const [formError, setFormError] = useState("");

  useEffect(() => {
    if (!isAuthenticated) { navigate("/login", { replace: true }); return; }
    if (profileComplete) { navigate(next || "/", { replace: true }); return; }

    api.get("/profile/").then(res => {
      const d = res.data;
      const p = d.profile;
      setForm(prev => ({
        ...prev,
        first_name: d.first_name || "",
        last_name: d.last_name || "",
        bio: p.bio || "",
        specialties: p.specialties || [],
        hourly_rate: p.hourly_rate ?? "",
        job_title: p.job_title || "",
        organisation: p.organisation || "",
      }));
    }).catch(() => {
      // Non-blocking — form still renders with empty fields
    }).finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  // Returns the first validation error, or "" if the form is valid.
  const validate = () => {
    if (!form.first_name.trim()) return "First name is required.";
    if (!form.last_name.trim()) return "Last name is required.";
    if (isCoach) {
      if (!form.bio.trim()) return "Please add a short bio.";
      if (!form.specialties.length) return "Add at least one specialty.";
      if (!form.hourly_rate) return "Hourly rate is required.";
    }
    if (isClient) {
      if (!form.job_title.trim()) return "Job title is required.";
      if (!form.organisation.trim()) return "Organisation is required.";
    }
    return "";
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError("");
    const err = validate();
    if (err) { setFormError(err); toast.error(err); return; }
    setSaving(true);
    try {
      const profilePatch = isCoach
        ? { bio: form.bio.trim(), specialties: form.specialties, hourly_rate: parseFloat(form.hourly_rate) }
        : { job_title: form.job_title.trim(), organisation: form.organisation.trim() };

      await api.patch("/profile/", {
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        profile: profilePatch,
      });

      await markProfileComplete();
      toast.success("Profile complete! Welcome aboard.");
      // Honour a deep-link destination (e.g. a program booking link); else route
      // through "/" so HomeGate sends them to the correct role dashboard.
      navigate(next || "/", { replace: true });
    } catch {
      setFormError("Couldn't save your profile — please check your connection and try again.");
      toast.error("Failed to save profile. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return (
    <div className="flex justify-center items-center min-h-screen" style={{ background: "#FAF6EC" }}>
      <div
        className="w-8 h-8 rounded-full border-2 animate-spin"
        style={{ borderColor: "#C8A951", borderTopColor: "transparent" }}
      />
    </div>
  );

  return (
    <div className="min-h-screen flex items-center justify-center px-4 pt-28 pb-16" style={{ background: "#FAF6EC" }}>
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-xl"
      >
        {/* Header */}
        <div className="text-center mb-8">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
            style={{ background: "linear-gradient(135deg, #C8A951, #F0D98C)" }}
          >
            <FiUser size={24} color="#14213D" />
          </div>
          <h1
            className="text-3xl font-normal text-[#1B2B4A] mb-2"
            style={{ fontFamily: "'Playfair Display', serif" }}
          >
            Complete Your Profile
          </h1>
          <p className="text-sm" style={{ color: "rgba(74,85,104,0.7)" }}>
            A few details before you get started.
          </p>
        </div>

        {/* Card */}
        <div
          className="rounded-2xl p-8"
          style={{
            background: "white",
            border: "1px solid rgba(200,169,81,0.15)",
            boxShadow: "0 4px 24px rgba(27,43,74,0.07)",
          }}
        >
          <form onSubmit={handleSubmit} className="space-y-6">

            {/* ── Name ── */}
            <div>
              <SectionTitle>Your Name</SectionTitle>
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div>
                  <Label required>First name</Label>
                  <input
                    type="text"
                    value={form.first_name}
                    onChange={e => set("first_name", e.target.value)}
                    placeholder="Jane"
                    className={inputCls}
                    style={FIELD_STYLE}
                    onFocus={onFocus}
                    onBlur={onBlur}
                  />
                </div>
                <div>
                  <Label required>Last name</Label>
                  <input
                    type="text"
                    value={form.last_name}
                    onChange={e => set("last_name", e.target.value)}
                    placeholder="Smith"
                    className={inputCls}
                    style={FIELD_STYLE}
                    onFocus={onFocus}
                    onBlur={onBlur}
                  />
                </div>
              </div>
            </div>

            <Divider />

            {/* ── Coach fields ── */}
            {isCoach && (
              <div className="space-y-5">
                <SectionTitle>Coach Details</SectionTitle>

                <div>
                  <Label required>Bio</Label>
                  <textarea
                    rows={4}
                    value={form.bio}
                    onChange={e => set("bio", e.target.value)}
                    placeholder="Tell clients about your background and coaching style..."
                    className={`${inputCls} resize-none`}
                    style={FIELD_STYLE}
                    onFocus={onFocus}
                    onBlur={onBlur}
                  />
                </div>

                <div>
                  <Label required>Specialties</Label>
                  <TagInput
                    tags={form.specialties}
                    onChange={val => set("specialties", val)}
                    placeholder="e.g. Leadership, Executive, Career..."
                  />
                </div>

                <div>
                  <Label required>Hourly rate (USD)</Label>
                  <div className="relative">
                    <span
                      className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-semibold pointer-events-none"
                      style={{ color: "#C8A951" }}
                    >$</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={form.hourly_rate}
                      onChange={e => set("hourly_rate", e.target.value)}
                      placeholder="150"
                      className={`${inputCls} pl-8`}
                      style={FIELD_STYLE}
                      onFocus={onFocus}
                      onBlur={onBlur}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* ── Client fields ── */}
            {isClient && (
              <div className="space-y-5">
                <SectionTitle>Work Details</SectionTitle>

                <div>
                  <Label required>Job title</Label>
                  <input
                    type="text"
                    value={form.job_title}
                    onChange={e => set("job_title", e.target.value)}
                    placeholder="e.g. Senior Product Manager"
                    className={inputCls}
                    style={FIELD_STYLE}
                    onFocus={onFocus}
                    onBlur={onBlur}
                  />
                </div>

                <div>
                  <Label required>Organisation</Label>
                  <input
                    type="text"
                    value={form.organisation}
                    onChange={e => set("organisation", e.target.value)}
                    placeholder="e.g. Acme Corp"
                    className={inputCls}
                    style={FIELD_STYLE}
                    onFocus={onFocus}
                    onBlur={onBlur}
                  />
                </div>
              </div>
            )}

            {/* Inline error — always visible right by the button */}
            {formError && (
              <div className="rounded-xl px-4 py-3 text-sm" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.35)", color: "#B91C1C" }}>
                {formError}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={saving}
              className="w-full gold-btn py-3.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2"
            >
              {saving && (
                <span
                  className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin"
                  style={{ borderColor: "#14213D", borderTopColor: "transparent" }}
                />
              )}
              {saving ? "Saving..." : "Complete Profile →"}
            </button>
          </form>
        </div>

        {/* Logout escape hatch */}
        <p className="text-center text-xs mt-5" style={{ color: "rgba(74,85,104,0.5)" }}>
          Not you?{" "}
          <button
            type="button"
            onClick={logout}
            className="underline hover:opacity-70 transition-opacity"
            style={{ color: "rgba(74,85,104,0.7)" }}
          >
            Log out
          </button>
        </p>
      </motion.div>
    </div>
  );
}
