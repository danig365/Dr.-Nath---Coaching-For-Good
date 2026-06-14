import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../context/AuthContext";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  FiMail, FiEdit, FiAward, FiStar, FiCheck,
  FiBriefcase, FiDollarSign, FiClock, FiGlobe,
} from "react-icons/fi";
import { toast } from "react-toastify";
import { api } from "../utils/auth";

// ─── Tag pill ────────────────────────────────────────────────────────────────
const Tag = ({ label, color = "gold" }) => {
  const styles = {
    gold: { background: "rgba(200,169,81,0.12)", color: "#A9863A", border: "1px solid rgba(200,169,81,0.25)" },
    rose: { background: "#F3ECD9", color: "#4A5568", border: "1px solid rgba(200,169,81,0.2)" },
    green: { background: "rgba(52,168,83,0.08)", color: "#2E7D32", border: "1px solid rgba(52,168,83,0.2)" },
  }[color];
  return (
    <span className="text-xs font-medium px-2.5 py-1 rounded-full" style={styles}>{label}</span>
  );
};

// ─── Section Card ─────────────────────────────────────────────────────────────
const Card = ({ children, className = "" }) => (
  <div
    className={`rounded-2xl p-6 ${className}`}
    style={{ background: "white", border: "1px solid rgba(200,169,81,0.15)", boxShadow: "0 2px 16px rgba(27,43,74,0.05)" }}
  >
    {children}
  </div>
);

const ProfilePage = () => {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [formData, setFormData] = useState({});
  const [saving, setSaving] = useState(false);

  const { isAuthenticated, isCoach, isAdmin, logout } = useAuth();
  const navigate = useNavigate();

  const fetchData = useCallback(async () => {
    if (!isAuthenticated) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await api.get("/profile/");
      const d = res.data;
      const p = {
        fullName: d.full_name,
        email: d.email,
        bio: d.profile.bio,
        role: d.profile.role,
        specialties: d.profile.specialties || [],
        certifications: d.profile.certifications || [],
        hourly_rate: d.profile.hourly_rate,
        years_experience: d.profile.years_experience,
        languages: d.profile.languages || [],
        industries: d.profile.industries || [],
        approval_status: d.profile.approval_status,
        is_verified: d.profile.is_verified,
        organisation: d.profile.organisation,
        job_title: d.profile.job_title,
        coaching_goals: d.profile.coaching_goals || [],
      };
      setProfile(p);
      setFormData({ bio: p.bio || "" });
    } catch (err) {
      toast.error("Failed to load profile.");
      if (err.message?.includes("Session expired")) logout();
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, logout]);

  useEffect(() => { if (isAuthenticated) fetchData(); }, [fetchData, isAuthenticated]);

  const handleSubmit = async () => {
    setSaving(true);
    try {
      const res = await api.patch("/profile/", { profile: { bio: formData.bio } });
      setProfile(prev => ({ ...prev, bio: res.data.profile.bio }));
      setEditMode(false);
      toast.success("Profile updated.");
    } catch {
      toast.error("Failed to update profile.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return (
    <div className="flex justify-center items-center min-h-screen" style={{ background: "#FAF6EC" }}>
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "#C8A951", borderTopColor: "transparent" }} />
        <p className="text-sm" style={{ color: "rgba(74,85,104,0.7)" }}>Loading profile...</p>
      </div>
    </div>
  );

  if (!profile) return (
    <div className="flex justify-center items-center min-h-screen" style={{ background: "#FAF6EC" }}>
      <p className="text-[#4A5568]">Failed to load profile.</p>
    </div>
  );

  const initials = profile.fullName?.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase() || "?";

  const roleLabel = { coach: "Coach", client: "Client", admin: "Admin" }[profile.role] || profile.role;

  return (
    <div className="min-h-screen pt-28 pb-16 px-6" style={{ background: "#FAF6EC" }}>
      <div className="max-w-5xl mx-auto space-y-5">

        {/* ── PROFILE HEADER CARD ──────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <Card>
            <div className="flex flex-col sm:flex-row sm:items-start gap-5">

              {/* Avatar */}
              <div
                className="w-20 h-20 rounded-2xl flex items-center justify-center text-2xl font-bold shrink-0"
                style={{ background: "linear-gradient(135deg, #C8A951, #F0D98C)", color: "#14213D", fontFamily: "'Playfair Display', serif" }}
              >
                {initials}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <h1 className="text-3xl font-normal text-[#1B2B4A]" style={{ fontFamily: "'Playfair Display', serif" }}>
                    {profile.fullName}
                  </h1>
                  <Tag label={roleLabel} color="gold" />
                  {profile.is_verified && <Tag label="✓ Verified" color="green" />}
                  {profile.role === "coach" && !profile.is_verified && (
                    <Tag
                      label={profile.approval_status === "pending" ? "Pending Approval" : "Rejected"}
                      color="rose"
                    />
                  )}
                </div>

                <div className="flex items-center gap-2 text-sm mb-3" style={{ color: "#4A5568" }}>
                  <FiMail size={13} style={{ color: "#C8A951" }} />
                  <span>{profile.email}</span>
                </div>

                {profile.job_title && (
                  <div className="flex items-center gap-2 text-sm" style={{ color: "#4A5568" }}>
                    <FiBriefcase size={13} style={{ color: "#C8A951" }} />
                    <span>{profile.job_title}{profile.organisation ? ` · ${profile.organisation}` : ""}</span>
                  </div>
                )}
              </div>

              {/* Edit button */}
              {!isAdmin() && (
                <div className="shrink-0">
                  {editMode ? (
                    <div className="flex gap-2">
                      <button
                        onClick={() => setEditMode(false)}
                        className="px-4 py-2 rounded-full text-sm font-medium border transition-all duration-200"
                        style={{ borderColor: "rgba(200,169,81,0.3)", color: "#4A5568" }}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSubmit}
                        disabled={saving}
                        className="gold-btn px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2"
                      >
                        {saving ? (
                          <span className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: "#14213D", borderTopColor: "transparent" }} />
                        ) : <FiCheck size={14} />}
                        Save
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setEditMode(true)}
                      className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-all duration-200"
                      style={{ background: "rgba(200,169,81,0.1)", color: "#A9863A", border: "1px solid rgba(200,169,81,0.25)" }}
                    >
                      <FiEdit size={13} /> Edit Profile
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Bio */}
            <div className="mt-5 pt-5" style={{ borderTop: "1px solid rgba(200,169,81,0.15)" }}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "rgba(200,169,81,0.8)" }}>About</p>
              {editMode ? (
                <textarea
                  rows={4}
                  value={formData.bio}
                  onChange={e => setFormData(f => ({ ...f, bio: e.target.value }))}
                  placeholder="Tell us about yourself..."
                  className="w-full px-4 py-3 rounded-xl text-sm focus:outline-none resize-none transition-all duration-200"
                  style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.3)", color: "#1B2B4A" }}
                  onFocus={e => e.target.style.borderColor = "#C8A951"}
                  onBlur={e => e.target.style.borderColor = "rgba(200,169,81,0.3)"}
                />
              ) : (
                <p className="text-sm leading-relaxed" style={{ color: profile.bio ? "#4A5568" : "rgba(74,85,104,0.5)" }}>
                  {profile.bio || "No bio added yet. Click Edit Profile to add one."}
                </p>
              )}
            </div>
          </Card>
        </motion.div>

        {/* ── COACH DETAILS ─────────────────────────────────── */}
        {isCoach() && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1 }}>
            <Card>
              <p className="text-xs font-semibold uppercase tracking-wider mb-4" style={{ color: "rgba(200,169,81,0.8)" }}>
                Coach Details
              </p>

              {/* Stats row */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-5">
                {profile.hourly_rate && (
                  <div className="rounded-xl p-4" style={{ background: "#F3ECD9" }}>
                    <div className="flex items-center gap-2 mb-1">
                      <FiDollarSign size={14} style={{ color: "#C8A951" }} />
                      <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "rgba(74,85,104,0.7)" }}>Rate</span>
                    </div>
                    <p className="text-xl font-bold text-[#1B2B4A]" style={{ fontFamily: "'Playfair Display', serif" }}>
                      ${profile.hourly_rate}<span className="text-xs font-normal text-[#4A5568]">/hr</span>
                    </p>
                  </div>
                )}
                {profile.years_experience && (
                  <div className="rounded-xl p-4" style={{ background: "#F3ECD9" }}>
                    <div className="flex items-center gap-2 mb-1">
                      <FiClock size={14} style={{ color: "#C8A951" }} />
                      <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "rgba(74,85,104,0.7)" }}>Experience</span>
                    </div>
                    <p className="text-xl font-bold text-[#1B2B4A]" style={{ fontFamily: "'Playfair Display', serif" }}>
                      {profile.years_experience}<span className="text-xs font-normal text-[#4A5568]"> yrs</span>
                    </p>
                  </div>
                )}
              </div>

              {profile.specialties?.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "rgba(74,85,104,0.6)" }}>
                    <FiAward size={12} className="inline mr-1" /> Specialties
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {profile.specialties.map(s => <Tag key={s} label={s} color="gold" />)}
                  </div>
                </div>
              )}

              {profile.certifications?.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "rgba(74,85,104,0.6)" }}>
                    Certifications
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {profile.certifications.map(c => <Tag key={c} label={c} color="green" />)}
                  </div>
                </div>
              )}

              {profile.industries?.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "rgba(74,85,104,0.6)" }}>
                    Industries
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {profile.industries.map(i => <Tag key={i} label={i} color="rose" />)}
                  </div>
                </div>
              )}

              {profile.languages?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "rgba(74,85,104,0.6)" }}>
                    <FiGlobe size={12} className="inline mr-1" /> Languages
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {profile.languages.map(l => <Tag key={l} label={l} color="rose" />)}
                  </div>
                </div>
              )}
            </Card>
          </motion.div>
        )}

        {/* ── CLIENT DETAILS ────────────────────────────────── */}
        {!isCoach() && !isAdmin() && (profile.organisation || profile.job_title || profile.coaching_goals?.length > 0) && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1 }}>
            <Card>
              <p className="text-xs font-semibold uppercase tracking-wider mb-4" style={{ color: "rgba(200,169,81,0.8)" }}>
                <FiStar size={12} className="inline mr-1" /> Client Details
              </p>

              {profile.organisation && (
                <div className="flex items-center gap-2 text-sm mb-2" style={{ color: "#4A5568" }}>
                  <FiBriefcase size={13} style={{ color: "#C8A951" }} />
                  <span><span className="font-medium text-[#1B2B4A]">Organisation:</span> {profile.organisation}</span>
                </div>
              )}
              {profile.job_title && (
                <div className="flex items-center gap-2 text-sm mb-4" style={{ color: "#4A5568" }}>
                  <FiAward size={13} style={{ color: "#C8A951" }} />
                  <span><span className="font-medium text-[#1B2B4A]">Job Title:</span> {profile.job_title}</span>
                </div>
              )}

              {profile.coaching_goals?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "rgba(74,85,104,0.6)" }}>
                    Coaching Goals
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {profile.coaching_goals.map(g => <Tag key={g} label={g} color="gold" />)}
                  </div>
                </div>
              )}
            </Card>
          </motion.div>
        )}

        {/* ── ADMIN PANEL ───────────────────────────────────── */}
        {isAdmin() && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1 }}>
            <Card>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "rgba(200,169,81,0.8)" }}>Admin Account</p>
              <p className="text-sm mb-4" style={{ color: "#4A5568" }}>You have full platform management access.</p>
              <button
                onClick={() => navigate("/admin")}
                className="gold-btn px-6 py-2.5 rounded-full text-sm font-bold"
              >
                Go to Admin Panel →
              </button>
            </Card>
          </motion.div>
        )}

      </div>
    </div>
  );
};

export default ProfilePage;
