import { useState } from "react";
import { motion } from "framer-motion";
import { FiSend, FiCheckCircle, FiMail } from "react-icons/fi";
import { api } from "../utils/auth";
import { useAuth } from "../context/AuthContext";

const NAVY = "#1B2B4A";
const GOLD = "#C8A951";
const SLATE = "#4A5568";
const serif = "'Playfair Display', serif";

export default function Contact() {
  const { user } = useAuth();
  const [form, setForm] = useState({
    name: user?.username || "",
    email: "",
    subject: "",
    message: "",
  });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const onChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.email.trim() || !form.subject.trim() || !form.message.trim()) {
      setError("Please fill in your email, a subject and a message.");
      return;
    }
    setSending(true);
    try {
      await api.post("/contact/", {
        name: form.name.trim(),
        email: form.email.trim(),
        subject: form.subject.trim(),
        message: form.message.trim(),
      });
      setSent(true);
    } catch (err) {
      setError(err.response?.data?.detail || "Something went wrong. Please try again.");
    } finally {
      setSending(false);
    }
  };

  const inputCls = "w-full px-4 py-3 rounded-xl text-sm focus:outline-none focus:ring-2";
  const inputStyle = { background: "white", border: "1px solid rgba(200,169,81,0.3)", color: NAVY };

  return (
    <div className="min-h-screen pt-36 pb-20 px-6" style={{ background: "#FAF6EC" }}>
      <div className="max-w-2xl mx-auto">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="text-center mb-10">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] mb-3" style={{ color: "#A9863A" }}>Get in touch</p>
          <h1 className="text-4xl md:text-5xl font-normal mb-4" style={{ color: NAVY, fontFamily: serif }}>
            Contact <em style={{ color: "#A9863A" }}>Dr. Nath</em>
          </h1>
          <p className="text-base max-w-lg mx-auto" style={{ color: SLATE }}>
            Have a question about coaching, a program, or anything else? Send a message and we'll get back to you.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1 }}
          className="rounded-3xl p-8 md:p-10" style={{ background: "white", border: "1px solid rgba(200,169,81,0.2)", boxShadow: "0 8px 30px rgba(27,43,74,0.06)" }}
        >
          {sent ? (
            <div className="text-center py-8">
              <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: "rgba(52,168,83,0.12)" }}>
                <FiCheckCircle size={32} style={{ color: "#2E7D32" }} />
              </div>
              <h2 className="text-2xl font-normal mb-2" style={{ color: NAVY, fontFamily: serif }}>Message sent</h2>
              <p className="text-sm" style={{ color: SLATE }}>Thank you for reaching out — Dr. Nath will get back to you soon.</p>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "#A9863A" }}>Your name</label>
                  <input name="name" value={form.name} onChange={onChange} placeholder="Jane Doe" className={inputCls} style={inputStyle} />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "#A9863A" }}>Email <span style={{ color: "#B91C1C" }}>*</span></label>
                  <input name="email" type="email" value={form.email} onChange={onChange} placeholder="you@email.com" className={inputCls} style={inputStyle} required />
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "#A9863A" }}>Subject <span style={{ color: "#B91C1C" }}>*</span></label>
                <input name="subject" value={form.subject} onChange={onChange} placeholder="What's this about?" className={inputCls} style={inputStyle} required />
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "#A9863A" }}>Message <span style={{ color: "#B91C1C" }}>*</span></label>
                <textarea name="message" value={form.message} onChange={onChange} rows={6} placeholder="Write your message…" className={`${inputCls} resize-none`} style={inputStyle} required />
              </div>

              {error && <p className="text-sm" style={{ color: "#B91C1C" }}>{error}</p>}

              <button type="submit" disabled={sending}
                className="w-full gold-btn py-3.5 rounded-full text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-60">
                {sending ? "Sending…" : <><FiSend size={15} /> Send message</>}
              </button>
            </form>
          )}
        </motion.div>

        <p className="text-center text-xs mt-6 flex items-center justify-center gap-1.5" style={{ color: SLATE }}>
          <FiMail size={12} style={{ color: GOLD }} /> Your message goes straight to Dr. Nath's team.
        </p>
      </div>
    </div>
  );
}
