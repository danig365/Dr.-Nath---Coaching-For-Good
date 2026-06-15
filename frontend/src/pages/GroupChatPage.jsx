import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { FiArrowLeft, FiCalendar, FiClock, FiMessageSquare, FiSend, FiUsers, FiVideo } from "react-icons/fi";
import { motion } from "framer-motion";
import { toast } from "react-toastify";
import { api } from "../utils/auth";
import { useAuth } from "../context/AuthContext";

const GroupChatPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, isAuthenticated, isCoach, logout } = useAuth();
  const [session, setSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const endRef = useRef(null);
  const wsRef = useRef(null);
  const currentUserId = user?.user_id;

  const fetchAll = useCallback(async () => {
    if (!isAuthenticated) { toast.error("Please log in."); logout(); return; }
    setLoading(true);
    try {
      let found = null;
      if (isCoach()) {
        const r = await api.get("/bookings/group-sessions/");
        found = r.data.find((s) => s.id === parseInt(id));
      } else {
        const r = await api.get("/bookings/group-sessions/mine/");
        const e = r.data.find((x) => x.group_session === parseInt(id));
        if (e) found = { id: e.group_session, title: e.title, coach_username: e.coach_username, start_datetime: e.start_datetime, end_datetime: e.end_datetime, status: e.session_status };
      }
      if (!found) { toast.error("Session not found or you're not enrolled."); navigate(isCoach() ? "/my-availability" : "/my-learning", { replace: true }); return; }
      const msgs = await api.get(`/bookings/group-sessions/${id}/messages/`);
      setSession(found);
      setMessages(msgs.data);
    } catch (e) {
      toast.error("Failed to load chat.");
      navigate(isCoach() ? "/my-availability" : "/my-learning", { replace: true });
    } finally {
      setLoading(false);
    }
  }, [id, isAuthenticated, isCoach, logout, navigate]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    if (!session) return;
    const tokens = JSON.parse(localStorage.getItem("authTokens"));
    const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${wsProto}//${window.location.host}/ws/group-chat/${id}/?token=${tokens?.access}`);
    wsRef.current = ws;
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
    };
    return () => ws.close();
  }, [session, id]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const send = (e) => {
    e.preventDefault();
    const t = text.trim();
    const ws = wsRef.current;
    if (!t || ws?.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ content: t }));
    setText("");
  };

  const canJoinCall = session &&
    session.status !== "cancelled" &&
    new Date(session.end_datetime) > new Date() &&
    Date.now() >= new Date(session.start_datetime).getTime() - 15 * 60 * 1000;

  if (loading) return (
    <div className="flex justify-center items-center min-h-screen" style={{ background: "#FAF6EC" }}>
      <div className="w-10 h-10 rounded-full border-2 animate-spin" style={{ borderColor: "#C8A951", borderTopColor: "transparent" }} />
    </div>
  );
  if (!session) return null;

  const date = new Date(session.start_datetime).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const time = new Date(session.start_datetime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="min-h-screen pt-28 pb-10 px-4" style={{ background: "#FAF6EC" }}>
      <div className="mx-auto max-w-7xl">
        <motion.div className="flex items-center justify-between gap-4 mb-6" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <motion.button whileHover={{ x: -3 }} onClick={() => navigate(isCoach() ? "/my-availability" : "/my-learning")}
            className="flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-full border transition-all"
            style={{ borderColor: "rgba(200,169,81,0.3)", color: "#A9863A", background: "white" }}>
            <FiArrowLeft size={14} /> Back
          </motion.button>
          <div className="text-right hidden sm:block">
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#C8A951" }}>Group Chat</p>
            <h1 className="text-2xl font-normal text-[#1B2B4A]" style={{ fontFamily: "'Playfair Display', serif" }}>{session.title}</h1>
          </div>
        </motion.div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.7fr)_340px]">
          {/* Chat */}
          <motion.section className="rounded-2xl overflow-hidden flex flex-col"
            style={{ background: "white", border: "1px solid rgba(200,169,81,0.15)", boxShadow: "0 4px 24px rgba(27,43,74,0.07)" }}
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
            <div className="px-6 py-5 flex items-start justify-between gap-4" style={{ background: "linear-gradient(135deg, #1B2B4A, #14213D)" }}>
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: "#C8A951" }}>Group Conversation</p>
                <h2 className="text-2xl font-normal text-white" style={{ fontFamily: "'Playfair Display', serif" }}>{session.title}</h2>
                <p className="text-sm mt-0.5" style={{ color: "rgba(255,255,255,0.5)" }}>Everyone enrolled in this session can see these messages.</p>
              </div>
              <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(200,169,81,0.15)" }}>
                <FiUsers size={18} style={{ color: "#C8A951" }} />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-3" style={{ background: "#FAF6EC", minHeight: "52vh", maxHeight: "52vh" }}>
              {messages.length > 0 ? messages.map((m) => {
                const mine = m.sender === currentUserId;
                return (
                  <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <div className="max-w-[78%] px-4 py-3 rounded-2xl text-sm leading-relaxed"
                      style={mine
                        ? { background: "linear-gradient(135deg,#C8A951,#D4B86A)", color: "#14213D", borderBottomRightRadius: "4px" }
                        : { background: "white", color: "#1B2B4A", border: "1px solid rgba(200,169,81,0.2)", borderBottomLeftRadius: "4px", boxShadow: "0 1px 8px rgba(27,43,74,0.05)" }}>
                      <div className="flex items-center justify-between gap-4 mb-1.5 text-xs opacity-70 font-medium">
                        <span>{mine ? "You" : m.sender_username}</span>
                        <span>{new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                      </div>
                      <p className="whitespace-pre-wrap">{m.content}</p>
                    </div>
                  </div>
                );
              }) : (
                <div className="flex h-full items-center justify-center">
                  <div className="text-center px-6 py-10 rounded-2xl" style={{ border: "1px dashed rgba(200,169,81,0.3)", background: "white" }}>
                    <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: "rgba(200,169,81,0.12)" }}>
                      <FiMessageSquare size={22} style={{ color: "#C8A951" }} />
                    </div>
                    <h3 className="text-lg font-normal text-[#1B2B4A] mb-1" style={{ fontFamily: "'Playfair Display', serif" }}>Start the conversation</h3>
                    <p className="text-sm" style={{ color: "rgba(74,85,104,0.7)" }}>Share prep notes, links, or follow-ups with the group.</p>
                  </div>
                </div>
              )}
              <div ref={endRef} />
            </div>

            <form onSubmit={send} className="px-5 py-4" style={{ borderTop: "1px solid rgba(200,169,81,0.15)", background: "white" }}>
              <div className="flex gap-3">
                <textarea value={text} onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(e); } }}
                  placeholder="Write a message... (Enter to send)" rows={2}
                  className="flex-1 resize-none px-4 py-3 rounded-xl text-sm focus:outline-none"
                  style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.3)", color: "#1B2B4A" }} />
                <motion.button type="submit" disabled={!text.trim()}
                  whileHover={text.trim() ? { scale: 1.04 } : {}} whileTap={text.trim() ? { scale: 0.96 } : {}}
                  className="flex items-center gap-2 px-5 py-3 rounded-full text-sm font-bold transition-all disabled:opacity-40"
                  style={{ background: "linear-gradient(135deg,#C8A951,#F0D98C)", color: "#14213D" }}>
                  <FiSend size={14} /> Send
                </motion.button>
              </div>
            </form>
          </motion.section>

          {/* Sidebar */}
          <motion.aside className="space-y-4" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            <div className="rounded-2xl overflow-hidden" style={{ background: "white", border: "1px solid rgba(200,169,81,0.15)", boxShadow: "0 2px 16px rgba(27,43,74,0.05)" }}>
              <div className="h-1" style={{ background: "linear-gradient(90deg,#C8A951,#F0D98C)" }} />
              <div className="p-5">
                <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: "#C8A951" }}>Session</p>
                <h3 className="text-xl font-normal text-[#1B2B4A] mb-4" style={{ fontFamily: "'Playfair Display', serif" }}>{session.title}</h3>
                <div className="space-y-3">
                  <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl" style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.12)" }}>
                    <FiUsers size={13} style={{ color: "#C8A951" }} /><span className="text-sm font-medium text-[#1B2B4A]">{session.coach_username}</span>
                  </div>
                  <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl" style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.12)" }}>
                    <FiCalendar size={13} style={{ color: "#C8A951" }} /><span className="text-sm font-medium text-[#1B2B4A]">{date}</span>
                  </div>
                  <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl" style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.12)" }}>
                    <FiClock size={13} style={{ color: "#C8A951" }} /><span className="text-sm font-medium text-[#1B2B4A]">{time}</span>
                  </div>
                </div>
                <motion.button whileHover={canJoinCall ? { scale: 1.02 } : {}} whileTap={canJoinCall ? { scale: 0.97 } : {}}
                  onClick={() => canJoinCall && navigate(`/group-session/${id}/call`)} disabled={!canJoinCall}
                  className="mt-4 w-full flex items-center justify-center gap-2 py-2.5 rounded-full text-sm font-bold transition-all"
                  style={{
                    background: canJoinCall ? "linear-gradient(135deg,#C8A951,#F0D98C)" : "rgba(200,169,81,0.08)",
                    color: canJoinCall ? "#14213D" : "rgba(169,134,58,0.45)",
                    cursor: canJoinCall ? "pointer" : "not-allowed",
                    border: canJoinCall ? "none" : "1px solid rgba(200,169,81,0.2)",
                  }}>
                  <FiVideo size={13} /> {canJoinCall ? "Join Call" : "Call opens 15 min before"}
                </motion.button>
              </div>
            </div>
          </motion.aside>
        </div>
      </div>
    </div>
  );
};

export default GroupChatPage;
