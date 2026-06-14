import { useState } from "react";
import axios from "../utils/axios";

const BookingModal = ({ skill, onClose }) => {
  const [sessionDate, setSessionDate] = useState("");
  const [sessionTime, setSessionTime] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(""); // ✅ error state

  const handleBooking = async () => {
    setError(""); // Clear old error
    try {
      setLoading(true);
      await axios.post("/bookings/", {
        skill: skill.id,
        session_date: sessionDate,
        session_time: sessionTime,
      });
      alert("Session booked!");
      onClose();
    } catch (err) {
      if (err.response?.data?.detail) {
        setError(err.response.data.detail);
      } else if (Array.isArray(err.response?.data)) {
        setError(err.response.data[0]);
      } else {
        setError("Booking failed. Try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = {
    background: "#FAF6EC",
    border: "1px solid rgba(200,169,81,0.3)",
    color: "#1B2B4A",
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: "rgba(20,33,61,0.6)" }}>
      <div className="p-6 rounded-2xl shadow-2xl w-full max-w-sm" style={{ background: "white", border: "1px solid rgba(200,169,81,0.2)" }}>
        <h2 className="text-2xl font-normal mb-4" style={{ color: "#1B2B4A", fontFamily: "'Playfair Display', serif" }}>
          Book: {skill.title}
        </h2>

        {/* ✅ Show error if exists */}
        {error && (
          <div className="mb-3 p-2.5 text-sm rounded-xl" style={{ background: "rgba(239,68,68,0.08)", color: "#B91C1C", border: "1px solid rgba(239,68,68,0.2)" }}>
            {error}
          </div>
        )}

        <label className="block mb-3 text-xs font-semibold uppercase tracking-wider" style={{ color: "#A9863A" }}>
          Date
          <input
            type="date"
            value={sessionDate}
            onChange={(e) => setSessionDate(e.target.value)}
            className="w-full mt-1.5 px-3 py-2.5 rounded-xl text-sm font-normal focus:outline-none"
            style={inputStyle}
          />
        </label>
        <label className="block mb-5 text-xs font-semibold uppercase tracking-wider" style={{ color: "#A9863A" }}>
          Time
          <input
            type="time"
            value={sessionTime}
            onChange={(e) => setSessionTime(e.target.value)}
            className="w-full mt-1.5 px-3 py-2.5 rounded-xl text-sm font-normal focus:outline-none"
            style={inputStyle}
          />
        </label>
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-full text-sm font-semibold border"
            style={{ borderColor: "rgba(200,169,81,0.3)", color: "#4A5568" }}
          >
            Cancel
          </button>
          <button
            onClick={handleBooking}
            disabled={loading}
            className="flex-1 gold-btn py-2.5 rounded-full text-sm font-bold disabled:opacity-60"
          >
            {loading ? "Booking..." : "Book"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default BookingModal;
