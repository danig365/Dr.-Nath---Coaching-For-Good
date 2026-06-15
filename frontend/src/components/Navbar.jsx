import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bars3Icon, XMarkIcon } from "@heroicons/react/24/outline";
import { api } from "../utils/auth";

const Navbar = () => {
  const { user, logout, isAuthenticated, isCoach, isAdmin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const currentFull = location.pathname + location.search;
  const [isOpen, setIsOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [logoutFromMobile, setLogoutFromMobile] = useState(false);

  const handleLogout = () => {
    logout();
  };

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const [pendingCount, setPendingCount] = useState(0);
  const [upcomingCount, setUpcomingCount] = useState(0);
  const pollRef = useRef(null);

  useEffect(() => {
    if (!isAuthenticated) { setPendingCount(0); setUpcomingCount(0); return; }
    const fetchCounts = () =>
      api.get("/bookings/")
        .then(res => {
          const all = Array.isArray(res.data) ? res.data : (res.data.results ?? []);
          const now = new Date();
          setPendingCount(all.filter(b => b.status === "pending").length);
          setUpcomingCount(all.filter(b => b.status === "accepted" && new Date(b.session_date) >= now).length);
        })
        .catch(() => {});
    fetchCounts();
    pollRef.current = setInterval(fetchCounts, 30000);
    return () => clearInterval(pollRef.current);
  }, [isAuthenticated]);

  const navBg = scrolled
    ? "rgba(38,56,92,0.97)"
    : "rgba(38,56,92,0.90)";


  const desktopLinks = !isAuthenticated
    ? [
        { to: "/", label: "Home" },
        { to: "/#who", label: "Who is Dr Nath" },
        { to: "/#offerings", label: "Offerings" },
      ]
    : isAdmin()
    ? [
        { to: "/admin", label: "Overview" },
        { to: "/admin?tab=pending", label: "Approvals" },
        { to: "/admin?tab=analytics", label: "Analytics" },
        { to: "/admin?tab=coaches", label: "Coaches" },
        { to: "/admin?tab=clients", label: "Clients" },
        { to: "/admin?tab=sessions", label: "Sessions" },
        { to: "/admin?tab=all", label: "All Coaches" },
      ]
    : [
        { to: isCoach() ? "/my-skills" : "/skills", label: isCoach() ? "My Skills" : "Browse Skills" },
        ...(isCoach() ? [{ to: "/add-skill", label: "Add Skill" }, { to: "/my-availability", label: "Availability" }] : []),
        { to: isCoach() ? "/my-sessions" : "/my-learning", label: isCoach() ? "My Sessions" : "My Learning", badge: upcomingCount },
        ...(!isCoach() ? [{ to: "/group-sessions", label: "Group Sessions" }] : []),

        { to: "/milestones", label: "Milestones" },
        { to: "/coaches", label: "Coaches" },
        ...(!isCoach() ? [{ to: "/match", label: "Find Match" }] : []),
        { to: "/profile", label: "Profile" },
      ];

  return (
    <>
      <nav
        className="fixed w-full z-40 transition-all duration-300 backdrop-blur-md"
        style={{
          background: navBg,
          borderBottom: "1px solid rgba(200,169,81,0.2)",
          boxShadow: scrolled ? "0 6px 24px rgba(10,18,35,0.35)" : "0 2px 10px rgba(10,18,35,0.15)",
        }}
      >
        <div className="w-full px-6 sm:px-10 lg:px-20">
          <div className="flex items-center justify-between h-24">

            {/* Logo */}
            <Link
              to={isAuthenticated ? (isAdmin() ? "/admin" : isCoach() ? "/my-skills" : "/skills") : "/"}
              className="flex items-center gap-3 group"
            >
              <img
                src="/dr-nath-logo.png"
                alt="Dr. Nath — Coaching for Good"
                className="h-20 w-auto object-contain transition-opacity duration-300 group-hover:opacity-90 shrink-0"
              />
              {isAuthenticated && (
                <span
                  className="text-xs px-2 py-0.5 rounded-full font-semibold"
                  style={{
                    background: isAdmin() ? "rgba(200,169,81,0.2)" : isCoach() ? "rgba(200,169,81,0.15)" : "rgba(250,246,236,0.1)",
                    color: isAdmin() ? "#C8A951" : isCoach() ? "#C8A951" : "rgba(250,246,236,0.7)",
                    border: "1px solid rgba(200,169,81,0.3)",
                  }}
                >
                  {isAdmin() ? "Admin" : isCoach() ? "Coach" : "Client"}
                </span>
              )}
            </Link>

            {/* Desktop Nav */}
            <div className="hidden md:flex items-center gap-1">
              {desktopLinks.map(link => {
                const badgeNum = link.badge || 0;
                return (
                  <Link
                    key={link.to}
                    to={link.to}
                    className="relative px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 hover:text-[#C8A951] hover:bg-white/5"
                    style={{ color: link.to === currentFull ? "#C8A951" : "rgba(255,255,255,0.8)" }}
                  >
                    {link.label}
                    {badgeNum > 0 && (
                      <span
                        className="absolute -top-0.5 -right-0.5 min-w-[17px] h-[17px] flex items-center justify-center rounded-full text-[10px] font-bold px-1"
                        style={{ background: "#C8A951", color: "#14213D", lineHeight: 1 }}
                      >
                        {badgeNum > 99 ? "99+" : badgeNum}
                      </span>
                    )}
                  </Link>
                );
              })}

              {isAuthenticated ? (
                <button
                  onClick={() => { setShowLogoutModal(true); setLogoutFromMobile(false); }}
                  className="ml-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 border"
                  style={{ borderColor: "rgba(200,169,81,0.4)", color: "#C8A951" }}
                  onMouseEnter={e => e.currentTarget.style.background = "rgba(200,169,81,0.1)"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >
                  Logout →
                </button>
              ) : (
                <>
                  <Link
                    to="/login"
                    className="px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 hover:text-[#C8A951] hover:bg-white/5"
                    style={{ color: "rgba(255,255,255,0.8)" }}
                  >
                    Login
                  </Link>
                  <Link to="/#newsletter" className="gold-btn ml-2 px-5 py-2 rounded-full text-sm font-bold">
                    Newsletter Sign Up
                  </Link>
                </>
              )}
            </div>

            {/* Mobile burger */}
            <button
              onClick={() => setIsOpen(!isOpen)}
              className="md:hidden p-2 rounded-lg transition-colors duration-200"
              style={{ color: "rgba(255,255,255,0.8)" }}
            >
              {isOpen ? <XMarkIcon className="w-6 h-6" /> : <Bars3Icon className="w-6 h-6" />}
            </button>
          </div>
        </div>

        {/* Mobile Menu */}
        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="md:hidden overflow-hidden"
              style={{ background: "rgba(15,25,46,0.98)", borderTop: "1px solid rgba(200,169,81,0.15)" }}
            >
              <div className="px-4 py-4 space-y-1">
                {desktopLinks.map(link => {
                  const badgeNum = link.badge || 0;
                  return (
                    <Link
                      key={link.to}
                      to={link.to}
                      onClick={() => setIsOpen(false)}
                      className="relative flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 hover:text-[#C8A951] hover:bg-white/5"
                      style={{ color: "rgba(255,255,255,0.8)" }}
                    >
                      {link.label}
                      {badgeNum > 0 && (
                        <span
                          className="min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-[10px] font-bold px-1"
                          style={{ background: "#C8A951", color: "#14213D" }}
                        >
                          {badgeNum > 99 ? "99+" : badgeNum}
                        </span>
                      )}
                    </Link>
                  );
                })}

                <div className="pt-2">
                  {isAuthenticated ? (
                    <button
                      onClick={() => { setShowLogoutModal(true); setLogoutFromMobile(true); }}
                      className="w-full text-left px-3 py-2.5 rounded-lg text-sm font-semibold border transition-all duration-200"
                      style={{ borderColor: "rgba(200,169,81,0.3)", color: "#C8A951" }}
                    >
                      Logout →
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <Link
                        to="/login"
                        onClick={() => setIsOpen(false)}
                        className="block px-3 py-2.5 rounded-lg text-sm font-medium hover:text-[#C8A951] hover:bg-white/5"
                        style={{ color: "rgba(255,255,255,0.8)" }}
                      >
                        Login
                      </Link>
                      <Link
                        to="/#newsletter"
                        onClick={() => setIsOpen(false)}
                        className="gold-btn block text-center py-2.5 rounded-full text-sm font-bold"
                      >
                        Newsletter Sign Up
                      </Link>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </nav>

      {/* Logout Confirmation Modal */}
      <AnimatePresence>
        {showLogoutModal && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setShowLogoutModal(false)}
            />
            <motion.div
              className="relative rounded-2xl shadow-2xl p-8 w-full max-w-xs text-center z-10"
              style={{ background: "#FAF6EC" }}
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
            >
              <h2
                className="text-xl font-bold mb-3 text-[#1B2B4A]"
                style={{ fontFamily: "'Playfair Display', serif" }}
              >
                Confirm Logout
              </h2>
              <p className="mb-6 text-sm text-[#4A5568]">Are you sure you want to log out?</p>
              <div className="flex gap-3">
                <button
                  className="flex-1 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 border"
                  style={{ borderColor: "rgba(27,43,74,0.2)", color: "#4A5568" }}
                  onClick={() => setShowLogoutModal(false)}
                >
                  Cancel
                </button>
                <button
                  className="flex-1 px-4 py-2 rounded-xl text-sm font-bold transition-all duration-200 gold-btn"
                  onClick={() => {
                    setShowLogoutModal(false);
                    if (logoutFromMobile) setIsOpen(false);
                    handleLogout();
                  }}
                >
                  Logout
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

export default Navbar;
