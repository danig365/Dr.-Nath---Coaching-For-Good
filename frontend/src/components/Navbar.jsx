import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bars3Icon, XMarkIcon, ChevronDownIcon } from "@heroicons/react/24/outline";
import { api } from "../utils/auth";
import { isUpcomingSession } from "../utils/sessionTiming";
import { GROUP_SESSIONS_ENABLED } from "../config/features";

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
          setPendingCount(all.filter(b => b.status === "pending").length);
          // Same rule as the Upcoming tab in My Sessions / My Learning — see
          // isUpcomingSession. Never re-implement it here: the badge and the list
          // must always show the same number.
          setUpcomingCount(all.filter(isUpcomingSession).length);
        })
        .catch(() => {});
    fetchCounts();
    pollRef.current = setInterval(fetchCounts, 30000);
    return () => clearInterval(pollRef.current);
  }, [isAuthenticated]);

  const navBg = scrolled
    ? "linear-gradient(180deg, rgba(243,233,205,0.98), rgba(230,210,156,0.98))"
    : "linear-gradient(180deg, rgba(243,233,205,0.94), rgba(230,210,156,0.92))";


  // Guest + admin keep a flat link bar. Signed-in coach/client are consolidated
  // into ≤4 dropdown categories (client request: "at most 4 main tabs").
  const guestLinks = [
    { to: "/", label: "Home" },
    { to: "/#who", label: "Who is Dr Nath" },
    { to: "/#offerings", label: "Offerings" },
    { to: "/contact", label: "Contact" },
  ];
  const adminGroups = [
    { label: "Dashboard", items: [
      { to: "/admin", label: "Overview" },
      { to: "/admin?tab=analytics", label: "Analytics" },
    ]},
    { label: "Coaches", items: [
      { to: "/admin?tab=pending", label: "Approvals" },
      { to: "/admin?tab=coaches", label: "Coach Management" },
      { to: "/admin?tab=all", label: "All Coaches" },
    ]},
    { label: "Clients", items: [
      { to: "/admin?tab=clients", label: "Client Management" },
      { to: "/admin?tab=onboard", label: "Onboard Clients" },
    ]},
    { label: "Activity", items: [
      { to: "/admin?tab=sessions", label: "Sessions" },
      { to: "/admin?tab=messages", label: "Messages" },
      { to: "/admin?tab=newsletter", label: "Newsletter" },
      { to: "/admin?tab=backups", label: "Backups" },
    ]},
  ];

  const coachGroups = [
    { label: "Sessions", badge: upcomingCount, items: [
      { to: "/my-sessions", label: "My Sessions", badge: upcomingCount },
      { to: "/my-availability", label: "My Availability" },
      ...(GROUP_SESSIONS_ENABLED ? [{ to: "/group-sessions", label: "Group Sessions" }] : []),
    ]},
    { label: "Clients", items: [
      { to: "/clients", label: "My Clients" },
      { to: "/coaches", label: "Coaches" },
    ]},
    { label: "Offerings", items: [
      { to: "/my-skills", label: "My Skills" },
      { to: "/add-skill", label: "Add Skill" },
    ]},
    { label: "Workspace", items: [
      { to: "/my-resources", label: "Resources" },
      { to: "/milestones", label: "Milestones" },
      { to: "/habits", label: "Habits" },
    ]},
  ];
  const clientGroups = [
    { label: "Sessions", badge: upcomingCount, items: [
      { to: "/my-learning", label: "My Learning", badge: upcomingCount },
      ...(GROUP_SESSIONS_ENABLED ? [{ to: "/group-sessions", label: "Group Sessions" }] : []),
    ]},
    { label: "Coaches", items: [
      { to: "/coaches", label: "Browse Coaches" },
      { to: "/match", label: "Find Match" },
      { to: "/skills", label: "Browse Skills" },
    ]},
    { label: "Workspace", items: [
      { to: "/resources", label: "Resources" },
      { to: "/milestones", label: "Milestones" },
      { to: "/habits", label: "Habits" },
    ]},
  ];

  const useGroups = isAuthenticated;
  const navGroups = isAdmin() ? adminGroups : (isCoach() ? coachGroups : clientGroups);
  const flatLinks = !isAuthenticated ? guestLinks : [];
  const pathOf = (to) => to.split("?")[0];
  // Active when the URL matches exactly (query-string tabs like /admin?tab=x) or,
  // for a plain link, the path matches and no tab query is present.
  const isActive = (to) =>
    to === currentFull || (!to.includes("?") && location.pathname === pathOf(to) && !location.search);

  return (
    <>
      <nav
        className="fixed w-full z-40 transition-all duration-300 backdrop-blur-md"
        style={{
          background: navBg,
          borderBottom: "1px solid rgba(122,94,34,0.45)",
          boxShadow: scrolled ? "0 6px 24px rgba(27,43,74,0.16)" : "0 2px 10px rgba(27,43,74,0.08)",
        }}
      >
        <div className="w-full px-6 sm:px-10 lg:px-20">
          <div className="flex items-center justify-between h-28">

            {/* Logo → the home page (signed-in users land on the marketing home
                via /home instead of being bounced to their dashboard). */}
            <Link
              to={isAuthenticated ? "/home" : "/"}
              className="flex items-center gap-3 group"
            >
              <img
                src="/dr-nath-logo.png"
                alt="Dr. Nath — Coaching for Impact"
                className="h-24 w-auto object-contain transition-opacity duration-300 group-hover:opacity-90 shrink-0"
              />
              {isAuthenticated && (
                <span
                  className="text-xs px-2 py-0.5 rounded-full font-semibold"
                  style={{
                    background: "rgba(27,43,74,0.08)",
                    color: isAdmin() ? "#7A5E22" : isCoach() ? "#7A5E22" : "#1B2B4A",
                    border: "1px solid rgba(122,94,34,0.45)",
                  }}
                >
                  {isAdmin() ? "Admin" : isCoach() ? "Coach" : "Client"}
                </span>
              )}
            </Link>

            {/* Desktop Nav */}
            <div className="hidden md:flex items-center gap-1">
              {useGroups ? (
                <>
                  {navGroups.map(group => {
                    const active = group.items.some(i => isActive(i.to));
                    return (
                      <div key={group.label} className="relative group">
                        <button
                          className="relative flex items-center gap-1 px-3.5 py-2.5 rounded-lg text-[15px] transition-all duration-200 hover:text-[#7A5E22] hover:bg-[#1B2B4A]/[0.06]"
                          style={{ color: active ? "#7A5E22" : "#1B2B4A", fontWeight: active ? 700 : 500 }}
                        >
                          {group.label}
                          <ChevronDownIcon className="w-3.5 h-3.5 transition-transform duration-200 group-hover:rotate-180" />
                          {group.badge > 0 && (
                            <span className="absolute -top-0.5 -right-0.5 min-w-[17px] h-[17px] flex items-center justify-center rounded-full text-[10px] font-bold px-1" style={{ background: "#1B2B4A", color: "#E6D29C", lineHeight: 1 }}>
                              {group.badge > 99 ? "99+" : group.badge}
                            </span>
                          )}
                        </button>
                        <div className="absolute top-full left-0 pt-1.5 hidden group-hover:block min-w-[200px] z-50">
                          <div className="rounded-xl py-1.5 shadow-xl" style={{ background: "#FAF6EC", border: "1px solid rgba(122,94,34,0.35)" }}>
                            {group.items.map(item => (
                              <Link key={item.to} to={item.to}
                                className="flex items-center justify-between gap-3 px-4 py-2 text-[14px] transition-colors hover:bg-[#1B2B4A]/[0.06]"
                                style={{ color: isActive(item.to) ? "#7A5E22" : "#1B2B4A", fontWeight: isActive(item.to) ? 700 : 500 }}>
                                {item.label}
                                {item.badge > 0 && (
                                  <span className="min-w-[17px] h-[17px] flex items-center justify-center rounded-full text-[10px] font-bold px-1" style={{ background: "#1B2B4A", color: "#E6D29C" }}>
                                    {item.badge > 99 ? "99+" : item.badge}
                                  </span>
                                )}
                              </Link>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {/* Profile avatar menu */}
                  <div className="relative group ml-2">
                    <button className="w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold transition-transform hover:scale-105" style={{ background: "#1B2B4A", color: "#F3E9C9" }}>
                      {(user?.first_name || user?.username || "U").charAt(0).toUpperCase()}
                    </button>
                    <div className="absolute top-full right-0 pt-1.5 hidden group-hover:block min-w-[170px] z-50">
                      <div className="rounded-xl py-1.5 shadow-xl" style={{ background: "#FAF6EC", border: "1px solid rgba(122,94,34,0.35)" }}>
                        <Link to="/profile" className="block px-4 py-2 text-[14px] hover:bg-[#1B2B4A]/[0.06]" style={{ color: "#1B2B4A" }}>My Profile</Link>
                        <button onClick={() => { setShowLogoutModal(true); setLogoutFromMobile(false); }} className="w-full text-left px-4 py-2 text-[14px] font-semibold hover:bg-[#1B2B4A]/[0.06]" style={{ color: "#B91C1C" }}>
                          Logout →
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  {flatLinks.map(link => (
                    <Link key={link.to} to={link.to}
                      className="relative px-3.5 py-2.5 rounded-lg text-[15px] transition-all duration-200 hover:text-[#7A5E22] hover:bg-[#1B2B4A]/[0.06]"
                      style={{ color: link.to === currentFull ? "#7A5E22" : "#1B2B4A", fontWeight: link.to === currentFull ? 700 : 500 }}>
                      {link.label}
                    </Link>
                  ))}
                  {isAuthenticated ? (
                    <button
                      onClick={() => { setShowLogoutModal(true); setLogoutFromMobile(false); }}
                      className="ml-2 px-4 py-2.5 rounded-lg text-[15px] font-semibold transition-all duration-200 border"
                      style={{ borderColor: "rgba(27,43,74,0.45)", color: "#1B2B4A" }}
                    >
                      Logout →
                    </button>
                  ) : (
                    <>
                      <Link to="/login" className="px-3.5 py-2.5 rounded-lg text-[15px] font-medium transition-all duration-200 hover:text-[#7A5E22] hover:bg-[#1B2B4A]/[0.06]" style={{ color: "#1B2B4A" }}>
                        Login
                      </Link>
                      <Link to="/#newsletter" className="ml-2 px-6 py-2.5 rounded-full text-[15px] font-bold transition-all duration-200 hover:-translate-y-0.5" style={{ background: "#1B2B4A", color: "#F3E9C9" }}>
                        Newsletter Sign Up
                      </Link>
                    </>
                  )}
                </>
              )}
            </div>

            {/* Mobile burger */}
            <button
              onClick={() => setIsOpen(!isOpen)}
              className="md:hidden p-2 rounded-lg transition-colors duration-200"
              style={{ color: "#1B2B4A" }}
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
              style={{ background: "linear-gradient(180deg, rgba(243,233,205,0.98), rgba(230,210,156,0.98))", borderTop: "1px solid rgba(122,94,34,0.4)" }}
            >
              <div className="px-4 py-4 space-y-1">
                {useGroups ? (
                  <>
                    {navGroups.map(group => (
                      <div key={group.label} className="pb-1">
                        <p className="px-3 pt-2 pb-1 text-[11px] font-bold uppercase tracking-wider" style={{ color: "#7A5E22" }}>{group.label}</p>
                        {group.items.map(item => (
                          <Link key={item.to} to={item.to} onClick={() => setIsOpen(false)}
                            className="relative flex items-center gap-2 px-4 py-2.5 rounded-lg text-[15px] font-medium transition-all duration-200 hover:text-[#7A5E22] hover:bg-[#1B2B4A]/[0.06]"
                            style={{ color: isActive(item.to) ? "#7A5E22" : "#1B2B4A" }}>
                            {item.label}
                            {item.badge > 0 && (
                              <span className="min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-[10px] font-bold px-1" style={{ background: "#1B2B4A", color: "#E6D29C" }}>
                                {item.badge > 99 ? "99+" : item.badge}
                              </span>
                            )}
                          </Link>
                        ))}
                      </div>
                    ))}
                    <div className="pt-1">
                      <Link to="/profile" onClick={() => setIsOpen(false)} className="block px-4 py-2.5 rounded-lg text-[15px] font-medium hover:bg-[#1B2B4A]/[0.06]" style={{ color: "#1B2B4A" }}>My Profile</Link>
                    </div>
                  </>
                ) : (
                  flatLinks.map(link => (
                    <Link key={link.to} to={link.to} onClick={() => setIsOpen(false)}
                      className="relative flex items-center gap-2 px-3 py-3 rounded-lg text-[15px] font-medium transition-all duration-200 hover:text-[#7A5E22] hover:bg-[#1B2B4A]/[0.06]"
                      style={{ color: "#1B2B4A" }}>
                      {link.label}
                    </Link>
                  ))
                )}

                <div className="pt-2">
                  {isAuthenticated ? (
                    <button
                      onClick={() => { setShowLogoutModal(true); setLogoutFromMobile(true); }}
                      className="w-full text-left px-3 py-3 rounded-lg text-[15px] font-semibold border transition-all duration-200"
                      style={{ borderColor: "rgba(27,43,74,0.45)", color: "#1B2B4A" }}
                    >
                      Logout →
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <Link
                        to="/login"
                        onClick={() => setIsOpen(false)}
                        className="block px-3 py-3 rounded-lg text-[15px] font-medium hover:text-[#7A5E22] hover:bg-[#1B2B4A]/[0.06]"
                        style={{ color: "#1B2B4A" }}
                      >
                        Login
                      </Link>
                      <Link
                        to="/#newsletter"
                        onClick={() => setIsOpen(false)}
                        className="block text-center py-3 rounded-full text-[15px] font-bold"
                        style={{ background: "#1B2B4A", color: "#F3E9C9" }}
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
