import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css"; // Import the toast styles
import Register from "./pages/Register";
import Login from "./pages/Login";
// import Profile from "./pages/ProfilePage";
import Navbar from "./components/Navbar";
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
import Milestones from "./pages/Milestones";
import MyAvailability from "./pages/MyAvailability";
import GroupSessions from "./pages/GroupSessions";
import GroupCallPage from "./pages/GroupCallPage";
import GroupChatPage from "./pages/GroupChatPage";

export default function App() {
  return (
    <Router>
      <AuthProvider>
        <Navbar />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/register" element={<Register />} />
          <Route path="/login" element={<Login />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/skills" element={<SkillList />} />
          <Route path="/add-skill" element={<AddSkill />} />
          <Route path="/skills/edit/:id" element={<EditSkill />} />
          <Route path="/my-learning" element={<MyLearning />} />
          <Route path="/my-sessions" element={<MySessions />} />
          <Route path="/my-skills" element={<MySkills />} />
{/* <Route path="/skills/:id/book" element={<BookSessionPage />} /> */}
          <Route path="/book/:id" element={<BookSessionPage />} />
          <Route path="/chat/:bookingId" element={<SessionChatPage />} />
          <Route path="/coaches" element={<CoachDirectory />} />
<Route path="/match" element={<SmartMatch />} />
<Route path="/admin" element={<AdminPanel />} />
<Route path="/coaches/:id" element={<CoachProfile />} />
<Route path="/session/:bookingId" element={<SessionCallPage />} />
<Route path="/milestones" element={<Milestones />} />
<Route path="/my-availability" element={<MyAvailability />} />
<Route path="/group-sessions" element={<GroupSessions />} />
<Route path="/group-session/:id/call" element={<GroupCallPage />} />
<Route path="/group-chat/:id" element={<GroupChatPage />} />
        </Routes>
        <ToastContainer /> {/* Add this line for the Toast notifications */}
      </AuthProvider>
    </Router>
  );
}
