import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../utils/auth";
import { motion } from "framer-motion";
import {
  ArrowLeftIcon,
  CheckBadgeIcon,
  StarIcon,
  BriefcaseIcon,
  AcademicCapIcon,
  GlobeAltIcon,
  SparklesIcon,
  ArrowRightIcon,
} from "@heroicons/react/24/outline";

const NAVY = "#1B2B4A";
const NAVY_DEEP = "#14213D";
const GOLD = "#C8A951";
const GOLD_DEEP = "#A9863A";
const CREAM = "#FAF6EC";
const SLATE = "#4A5568";
const serif = "'Playfair Display', serif";

const TagSection = ({ icon: Icon, title, items }) => {
  if (!items?.length) return null;
  return (
    <div className="rounded-3xl bg-white p-6" style={{ border: "1px solid rgba(27,43,74,0.1)" }}>
      <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: GOLD_DEEP }}>
        <Icon className="w-4 h-4" /> {title}
      </h3>
      <div className="flex flex-wrap gap-2">
        {items.map(it => (
          <span
            key={it}
            className="text-xs px-3 py-1.5 rounded-full font-medium"
            style={{ background: "rgba(200,169,81,0.12)", color: GOLD_DEEP, border: "1px solid rgba(200,169,81,0.2)" }}
          >
            {it}
          </span>
        ))}
      </div>
    </div>
  );
};

export default function CoachProfile() {
  const { id } = useParams();
  const [coach, setCoach] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    api.get(`/coaches/${id}/`)
      .then(res => setCoach(res.data))
      .catch(() => setCoach(null))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen" style={{ background: CREAM }}>
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: GOLD, borderTopColor: "transparent" }} />
          <p className="text-sm" style={{ color: "rgba(74,85,104,0.7)" }}>Loading profile...</p>
        </div>
      </div>
    );
  }

  if (!coach) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6" style={{ background: CREAM }}>
        <p className="text-5xl mb-4">🔍</p>
        <h2 className="text-2xl font-normal mb-2" style={{ color: NAVY, fontFamily: serif }}>Coach not found</h2>
        <p className="text-sm mb-6" style={{ color: SLATE }}>This coach profile is unavailable.</p>
        <button onClick={() => navigate("/coaches")} className="gold-btn px-6 py-2.5 rounded-full text-sm font-bold">
          Back to Directory
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: CREAM }}>
      {/* ── Header banner ─────────────────────────────── */}
      <section className="pt-32 pb-24 px-6" style={{ background: `linear-gradient(135deg, ${NAVY}, ${NAVY_DEEP})` }}>
        <div className="max-w-3xl mx-auto">
          <button
            onClick={() => navigate("/coaches")}
            className="flex items-center gap-2 text-sm font-medium mb-8 transition-colors hover:text-[#C8A951]"
            style={{ color: "rgba(250,246,236,0.7)" }}
          >
            <ArrowLeftIcon className="w-4 h-4" /> Back to Directory
          </button>
        </div>
      </section>

      <div className="max-w-3xl mx-auto px-6 -mt-16 pb-16">
        {/* ── Profile card ───────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
          className="rounded-3xl bg-white p-8 mb-6" style={{ border: "1px solid rgba(27,43,74,0.1)", boxShadow: "0 8px 30px rgba(27,43,74,0.08)" }}
        >
          <div className="flex flex-col sm:flex-row items-start gap-5">
            <div
              className="w-20 h-20 rounded-2xl flex items-center justify-center text-3xl font-bold shrink-0"
              style={{ background: GOLD, color: NAVY_DEEP, fontFamily: serif }}
            >
              {(coach.display_name || coach.username)?.charAt(0).toUpperCase()}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-3 mb-2">
                <h1 className="text-3xl font-normal" style={{ color: NAVY, fontFamily: serif }}>{coach.display_name || coach.username}</h1>
                {coach.is_verified && (
                  <span className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background: "rgba(52,168,83,0.1)", color: "#2E7D32", border: "1px solid rgba(52,168,83,0.2)" }}>
                    <CheckBadgeIcon className="w-3.5 h-3.5" /> Verified
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-4 text-sm">
                {coach.avg_rating && (
                  <span className="flex items-center gap-1 font-semibold" style={{ color: GOLD_DEEP }}>
                    <StarIcon className="w-4 h-4" style={{ fill: GOLD, color: GOLD }} />
                    {parseFloat(coach.avg_rating).toFixed(1)}
                  </span>
                )}
                {coach.years_experience && (
                  <span style={{ color: SLATE }}>{coach.years_experience} yrs experience</span>
                )}
                {coach.hourly_rate && (
                  <span className="font-semibold" style={{ color: NAVY }}>
                    ${coach.hourly_rate}<span className="font-normal" style={{ color: SLATE }}>/hr</span>
                  </span>
                )}
              </div>
            </div>
          </div>

          <p className="leading-relaxed mt-6 whitespace-pre-line" style={{ color: SLATE }}>
            {coach.bio || "This coach hasn't added a bio yet."}
          </p>

          <button
            onClick={() => navigate("/skills")}
            className="gold-btn mt-7 inline-flex items-center gap-2 px-7 py-3 rounded-full text-sm font-bold"
          >
            Browse Sessions <ArrowRightIcon className="w-4 h-4" />
          </button>
        </motion.div>

        {/* ── Detail sections ────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1 }}
          className="space-y-6"
        >
          <TagSection icon={SparklesIcon} title="Specialties" items={coach.specialties} />
          <TagSection icon={AcademicCapIcon} title="Certifications" items={coach.certifications} />
          <TagSection icon={BriefcaseIcon} title="Industries" items={coach.industries} />
          <TagSection icon={GlobeAltIcon} title="Languages" items={coach.languages} />
        </motion.div>
      </div>
    </div>
  );
}
