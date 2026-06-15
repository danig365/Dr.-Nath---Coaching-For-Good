import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  FiArrowLeft, FiCalendar, FiClock,
  FiMessageSquare, FiSend, FiUser, FiVideo,
} from "react-icons/fi";
import { motion } from "framer-motion";
import { toast } from "react-toastify";
import { api } from "../utils/auth";
import { useAuth } from "../context/AuthContext";

const STATUS_STYLE = {
  accepted:  { bg: "rgba(52,168,83,0.1)",  color: "#2E7D32", border: "1px solid rgba(52,168,83,0.25)" },
  completed: { bg: "rgba(200,169,81,0.12)", color: "#A9863A", border: "1px solid rgba(200,169,81,0.3)" },
  pending:   { bg: "rgba(251,191,36,0.12)", color: "#92400E", border: "1px solid rgba(251,191,36,0.3)" },
  declined:  { bg: "rgba(239,68,68,0.08)", color: "#B91C1C", border: "1px solid rgba(239,68,68,0.2)" },
};

const SessionChatPage = () => {
  const { bookingId } = useParams();
  const navigate = useNavigate();
  const { user, isAuthenticated, isCoach, logout } = useAuth();
  const [booking, setBooking] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messageText, setMessageText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef(null);
  const currentUserId = user?.user_id;
  const wsRef = useRef(null);

  const fetchThread = useCallback(async () => {
    if (!isAuthenticated) { toast.error("Please log in."); logout(); return; }
    setLoading(true);
    try {
      const [bookingRes, messagesRes] = await Promise.all([
        api.get(`/bookings/${bookingId}/`),
        api.get(`/messages/?booking=${bookingId}`),
      ]);
      setBooking(bookingRes.data);
      setMessages(messagesRes.data);
    } catch (error) {
      const fallback = isCoach() ? "/my-sessions" : "/my-learning";
      toast.error(error.response?.data?.detail || "Failed to load chat.");
      navigate(fallback, { replace: true });
    } finally {
      setLoading(false);
    }
  }, [bookingId, isAuthenticated, isCoach, logout, navigate]);

  const isChatEnabled = booking?.status === "accepted" || booking?.status === "completed";

  useEffect(() => { fetchThread(); }, [fetchThread]);

  useEffect(() => {
    if (!booking || !isChatEnabled) return;
    const tokens = JSON.parse(localStorage.getItem("authTokens"));
    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${wsProto}//${window.location.host}/ws/chat/${bookingId}/?token=${tokens?.access}`);
    wsRef.current = ws;
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "signal") return; // signals handled on /session page
      setMessages(prev => prev.find(m => m.id === msg.id) ? prev : [...prev, msg]);
    };
    ws.onerror = () => console.error("WebSocket error");
    return () => ws.close();
  }, [booking, bookingId, isChatEnabled]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!messageText.trim()) return;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ content: messageText.trim() }));
      setMessageText("");
    } else {
      setSending(true);
      try {
        await api.post("/messages/", { booking: Number(bookingId), content: messageText.trim() });
        setMessageText("");
        await fetchThread();
      } catch { toast.error("Failed to send message."); }
      finally { setSending(false); }
    }
  };

  const getChatPartnerName = () => {
    if (!booking) return "";
    return isCoach() ? booking.learner_username : booking.mentor_username;
  };

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="flex justify-center items-center min-h-screen" style={{ background: "#FAF6EC" }}>
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 rounded-full border-2 animate-spin" style={{ borderColor: "#C8A951", borderTopColor: "transparent" }} />
        <p className="text-sm" style={{ color: "rgba(74,85,104,0.7)" }}>Loading chat...</p>
      </div>
    </div>
  );

  if (!booking) return null;

  const statusStyle = STATUS_STYLE[booking.status] || STATUS_STYLE.pending;
  const sessionDate = new Date(booking.session_date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const sessionTime = new Date(`2000-01-01T${booking.session_time}`).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="min-h-screen pt-28 pb-10 px-4" style={{ background: "#FAF6EC" }}>
      <div className="mx-auto max-w-7xl">

        {/* ── Top bar ─────────────────────────────────────── */}
        <motion.div
          className="flex items-center justify-between gap-4 mb-6"
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        >
          <motion.button
            whileHover={{ x: -3 }}
            onClick={() => navigate(isCoach() ? "/my-sessions" : "/my-learning")}
            className="flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-full border transition-all"
            style={{ borderColor: "rgba(200,169,81,0.3)", color: "#A9863A", background: "white" }}
          >
            <FiArrowLeft size={14} /> Back
          </motion.button>
          <div className="text-right hidden sm:block">
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#C8A951" }}>Session Chat</p>
            <h1 className="text-2xl font-normal text-[#1B2B4A]" style={{ fontFamily: "'Playfair Display', serif" }}>{booking.skill_title}</h1>
          </div>
        </motion.div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.7fr)_340px]">

          {/* ── Chat Panel ────────────────────────────────── */}
          <motion.section
            className="rounded-2xl overflow-hidden flex flex-col"
            style={{ background: "white", border: "1px solid rgba(200,169,81,0.15)", boxShadow: "0 4px 24px rgba(27,43,74,0.07)" }}
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          >
            {/* Chat header */}
            <div className="px-6 py-5 flex items-start justify-between gap-4" style={{ background: "linear-gradient(135deg, #1B2B4A, #14213D)" }}>
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: "#C8A951" }}>
                  Direct Session Chat
                </p>
                <h2 className="text-2xl font-normal text-white" style={{ fontFamily: "'Playfair Display', serif" }}>
                  {getChatPartnerName()}
                </h2>
                <p className="text-sm mt-0.5" style={{ color: "rgba(255,255,255,0.5)" }}>
                  Keep this conversation focused on the booked session.
                </p>
              </div>
              <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(200,169,81,0.15)" }}>
                <FiMessageSquare size={18} style={{ color: "#C8A951" }} />
              </div>
            </div>

            {/* Messages area */}
            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-3" style={{ background: "#FAF6EC", minHeight: "52vh", maxHeight: "52vh" }}>
              {messages.length > 0 ? messages.map(message => {
                const isMine = message.sender === currentUserId;
                return (
                  <div key={message.id} className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
                    <div
                      className="max-w-[78%] px-4 py-3 rounded-2xl text-sm leading-relaxed"
                      style={isMine
                        ? { background: "linear-gradient(135deg,#C8A951,#D4B86A)", color: "#14213D", borderBottomRightRadius: "4px" }
                        : { background: "white", color: "#1B2B4A", border: "1px solid rgba(200,169,81,0.2)", borderBottomLeftRadius: "4px", boxShadow: "0 1px 8px rgba(27,43,74,0.05)" }
                      }
                    >
                      <div className="flex items-center justify-between gap-4 mb-1.5 text-xs opacity-70 font-medium">
                        <span>{isMine ? "You" : message.sender_username}</span>
                        <span>{new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                      </div>
                      <p className="whitespace-pre-wrap">{message.content}</p>
                    </div>
                  </div>
                );
              }) : (
                <div className="flex h-full items-center justify-center">
                  <div className="text-center px-6 py-10 rounded-2xl" style={{ border: "1px dashed rgba(200,169,81,0.3)", background: "white" }}>
                    <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: "rgba(200,169,81,0.12)" }}>
                      <FiMessageSquare size={22} style={{ color: "#C8A951" }} />
                    </div>
                    <h3 className="text-lg font-normal text-[#1B2B4A] mb-1" style={{ fontFamily: "'Playfair Display', serif" }}>
                      Start the conversation
                    </h3>
                    <p className="text-sm" style={{ color: "rgba(74,85,104,0.7)" }}>
                      Send the first message to coordinate the session, share updates, or follow up on feedback.
                    </p>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <form
              onSubmit={sendMessage}
              className="px-5 py-4"
              style={{ borderTop: "1px solid rgba(200,169,81,0.15)", background: "white" }}
            >
              {!isChatEnabled && (
                <div className="mb-3 px-4 py-2.5 rounded-xl text-sm font-medium" style={{ background: "#F3ECD9", color: "#A9863A", border: "1px solid rgba(200,169,81,0.25)" }}>
                  Chat becomes available once the booking is accepted.
                </div>
              )}
              <div className="flex gap-3">
                <textarea
                  value={messageText}
                  onChange={e => setMessageText(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(e); } }}
                  placeholder={isChatEnabled ? "Write a message... (Enter to send)" : "Chat not available yet."}
                  disabled={!isChatEnabled || sending}
                  rows={2}
                  className="flex-1 resize-none px-4 py-3 rounded-xl text-sm focus:outline-none transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.3)", color: "#1B2B4A" }}
                  onFocus={e => e.target.style.borderColor = "#C8A951"}
                  onBlur={e => e.target.style.borderColor = "rgba(200,169,81,0.3)"}
                />
                <motion.button
                  type="submit"
                  disabled={!isChatEnabled || sending || !messageText.trim()}
                  whileHover={isChatEnabled && messageText.trim() ? { scale: 1.04 } : {}}
                  whileTap={isChatEnabled && messageText.trim() ? { scale: 0.96 } : {}}
                  className="flex items-center gap-2 px-5 py-3 rounded-full text-sm font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ background: "linear-gradient(135deg,#C8A951,#F0D98C)", color: "#14213D" }}
                >
                  {sending
                    ? <div className="w-4 h-4 rounded-full border-2 animate-spin" style={{ borderColor: "#14213D", borderTopColor: "transparent" }} />
                    : <><FiSend size={14} /> Send</>
                  }
                </motion.button>
              </div>
            </form>
          </motion.section>

          {/* ── Sidebar ───────────────────────────────────── */}
          <motion.aside
            className="space-y-4"
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          >
            {/* Booking overview */}
            <div className="rounded-2xl overflow-hidden" style={{ background: "white", border: "1px solid rgba(200,169,81,0.15)", boxShadow: "0 2px 16px rgba(27,43,74,0.05)" }}>
              <div className="h-1" style={{ background: "linear-gradient(90deg,#C8A951,#F0D98C)" }} />
              <div className="p-5">
                <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: "#C8A951" }}>Booking Overview</p>
                <h3 className="text-xl font-normal text-[#1B2B4A] mb-4" style={{ fontFamily: "'Playfair Display', serif" }}>
                  {booking.skill_title}
                </h3>

                <div className="space-y-3">
                  <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl" style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.12)" }}>
                    <FiUser size={13} style={{ color: "#C8A951", shrink: 0 }} />
                    <span className="text-sm font-medium text-[#1B2B4A]">
                      {isCoach() ? booking.learner_username : booking.mentor_username}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl" style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.12)" }}>
                    <FiCalendar size={13} style={{ color: "#C8A951" }} />
                    <span className="text-sm font-medium text-[#1B2B4A]">{sessionDate}</span>
                  </div>
                  <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl" style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.12)" }}>
                    <FiClock size={13} style={{ color: "#C8A951" }} />
                    <span className="text-sm font-medium text-[#1B2B4A]">{sessionTime} · {booking.duration} mins</span>
                  </div>
                </div>

                <div className="mt-4">
                  <span className="text-xs font-semibold px-3 py-1.5 rounded-full capitalize" style={{ background: statusStyle.bg, color: statusStyle.color, border: statusStyle.border }}>
                    {booking.status}
                  </span>
                </div>

                {booking.status === "accepted" && (() => {
                  const sessionEnd = new Date(
                    new Date(`${booking.session_date}T${booking.session_time}`).getTime() +
                    booking.duration * 60 * 1000
                  );
                  const expired = sessionEnd < new Date();
                  return (
                    <motion.button
                      whileHover={!expired ? { scale: 1.02 } : {}}
                      whileTap={!expired ? { scale: 0.97 } : {}}
                      onClick={() => !expired && navigate(`/session/${bookingId}`)}
                      disabled={expired}
                      className="mt-4 w-full flex items-center justify-center gap-2 py-2.5 rounded-full text-sm font-bold transition-all"
                      style={{
                        background: expired ? "rgba(200,169,81,0.08)" : "linear-gradient(135deg,#C8A951,#F0D98C)",
                        color: expired ? "rgba(169,134,58,0.45)" : "#14213D",
                        cursor: expired ? "not-allowed" : "pointer",
                        border: expired ? "1px solid rgba(200,169,81,0.2)" : "none",
                      }}
                    >
                      <FiVideo size={13} />
                      {expired ? "Session Expired" : "Join Session"}
                    </motion.button>
                  );
                })()}
              </div>
            </div>
          </motion.aside>
        </div>
      </div>
    </div>
  );
};

export default SessionChatPage;
