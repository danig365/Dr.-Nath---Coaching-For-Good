import { BrowserRouter as Router, Routes, Route, Navigate, Outlet, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css"; // Import the toast styles
import Register from "./pages/Register";
import Login from "./pages/Login";
// import Profile from "./pages/ProfilePage";
import Navbar from "./components/Navbar";
import AssistantWidget from "./components/AssistantWidget";
import SessionStartBanner from "./components/SessionStartBanner";
import SkillList from "./pages/SkillList";
import AddSkill from "./pages/AddSkill";
import Home from "./pages/Home";
import MyLearning from "./pages/MyLearning ";
import ProfilePage from "./pages/ProfilePage";

import MySessions from "./pages/MySessions";
import MySkills from "./pages/MySkills";
import BookSessionPage from "./pages/BookSessionPage";
import SessionChatPage from "./pages/SessionChatPage";
import CoachDirectory from "./pages/CoachDirectory";
import SmartMatch from "./pages/SmartMatch";
import AdminPanel from "./pages/AdminPanel";
import CoachProfile from "./pages/CoachProfile";
import EditSkill from "./pages/EditSkill";
import SessionCallPage from "./pages/SessionCallPage";
import SessionCallLiveKit from "./pages/SessionCallLiveKit";
import GuestCall from "./pages/GuestCall";
import Milestones from "./pages/Milestones";
import HabitTracker from "./pages/HabitTracker";
import ProgrammeSpace from "./pages/ProgrammeSpace";
import ChemistryBooking from "./pages/ChemistryBooking";
import Agreements from "./pages/Agreements";
import Forms from "./pages/Forms";
import MyAvailability from "./pages/MyAvailability";
import GroupSessions from "./pages/GroupSessions";
import GroupCallPage from "./pages/GroupCallPage";
import GroupCallLiveKit from "./pages/GroupCallLiveKit";
import GroupChatPage from "./pages/GroupChatPage";
import ResourcesManage from "./pages/ResourcesManage";
import MyResources from "./pages/MyResources";
import CoachClients from "./pages/CoachClients";
import Contact from "./pages/Contact";
import CompleteProfilePage from "./pages/CompleteProfilePage";
import MagicJoin from "./pages/MagicJoin";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import { GROUP_SESSIONS_ENABLED, VIDEO_PROVIDER } from "./config/features";

// Pick the video call implementation from the single VIDEO_PROVIDER flag.
const SessionCall = VIDEO_PROVIDER === "livekit" ? SessionCallLiveKit : SessionCallPage;
const GroupCall = VIDEO_PROVIDER === "livekit" ? GroupCallLiveKit : GroupCallPage;

// Logged-in users skip the marketing landing page and land on their dashboard.
function HomeGate() {
  const { isAuthenticated, isAdmin, isCoach } = useAuth();
  if (isAuthenticated) {
    const to = isAdmin() ? "/admin" : isCoach() ? "/my-skills" : "/skills";
    return <Navigate to={to} replace />;
  }
  return <Home />;
}

// Guards all protected routes: must be logged in AND have a complete profile.
// Preserves the intended destination via `?next=` so shareable deep-links
// (e.g. a program booking link) survive the login / profile-completion detour.
function RequireProfileComplete() {
  const { isAuthenticated, profileComplete } = useAuth();
  const location = useLocation();
  const next = encodeURIComponent(location.pathname + location.search);
  if (!isAuthenticated) return <Navigate to={`/login?next=${next}`} replace />;
  if (!profileComplete) return <Navigate to={`/complete-profile?next=${next}`} replace />;
  return <Outlet />;
}

export default function App() {
  return (
    <Router>
      <AuthProvider>
        <Navbar />
        <SessionStartBanner />
        <Routes>
          {/* Public routes — no auth required */}
          <Route path="/" element={<HomeGate />} />
          {/* Always shows the marketing home — lets signed-in users return to it
              via the logo without being bounced to their dashboard. */}
          <Route path="/home" element={<Home />} />
          <Route path="/register" element={<Register />} />
          <Route path="/login" element={<Login />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/complete-profile" element={<CompleteProfilePage />} />
          <Route path="/join/:token" element={<MagicJoin />} />
          {/* Guest join for a 1:1 call (N4) — no account required */}
          <Route path="/session/:bookingId/guest" element={<GuestCall />} />
          {/* Booking page — a visitor can browse the offering, see slots and pick
              a time without an account; BookSessionPage defers login to Confirm
              (it stashes the selection and auto-resumes after sign-in). */}
          <Route path="/book/:id" element={<BookSessionPage />} />
          <Route path="/chemistry" element={<ChemistryBooking />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password/:uid/:token" element={<ResetPassword />} />

          {/* Protected routes — must be logged in with a complete profile */}
          <Route element={<RequireProfileComplete />}>
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/skills" element={<SkillList />} />
            <Route path="/add-skill" element={<AddSkill />} />
            <Route path="/skills/edit/:id" element={<EditSkill />} />
            <Route path="/my-learning" element={<MyLearning />} />
            <Route path="/programme/:skillId" element={<ProgrammeSpace />} />
            <Route path="/my-sessions" element={<MySessions />} />
            <Route path="/my-skills" element={<MySkills />} />
            <Route path="/chat/:bookingId" element={<SessionChatPage />} />
            <Route path="/coaches" element={<CoachDirectory />} />
            <Route path="/match" element={<SmartMatch />} />
            <Route path="/admin" element={<AdminPanel />} />
            <Route path="/coaches/:id" element={<CoachProfile />} />
            <Route path="/session/:bookingId" element={<SessionCall />} />
            <Route path="/milestones" element={<Milestones />} />
            <Route path="/habits" element={<HabitTracker />} />
            <Route path="/agreements" element={<Agreements />} />
            <Route path="/forms" element={<Forms />} />
            <Route path="/my-availability" element={<MyAvailability />} />
            {GROUP_SESSIONS_ENABLED && (
              <>
                <Route path="/group-sessions" element={<GroupSessions />} />
                <Route path="/group-session/:id/call" element={<GroupCall />} />
                <Route path="/group-chat/:id" element={<GroupChatPage />} />
              </>
            )}
            <Route path="/clients" element={<CoachClients />} />
            <Route path="/my-resources" element={<ResourcesManage />} />
            <Route path="/resources" element={<MyResources />} />
          </Route>
        </Routes>
        <ToastContainer /> {/* Add this line for the Toast notifications */}
        <AssistantWidget />
      </AuthProvider>
    </Router>
  );
}
