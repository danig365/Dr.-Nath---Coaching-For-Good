import { motion } from "framer-motion";
import { FiCheck, FiX, FiUser, FiClock, FiCalendar, FiMessageSquare } from "react-icons/fi";

const BookingCard = ({ request, onAccept, onDecline }) => {
  // ⭐ CORRECTED: Format date and time from separate backend fields
  const formattedDate = new Date(request.session_date).toLocaleDateString(
    "en-US",
    {
      weekday: "short",
      month: "short",
      day: "numeric",
    }
  );

  const formattedTime = new Date(`2000-01-01T${request.session_time}`).toLocaleTimeString(
    "en-US",
    {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`bg-white rounded-xl shadow-sm overflow-hidden border ${
        request.status === "accepted" ? "border-green-200" : "border-[#C8A951]/20"
      }`}
    >
      <div className="p-6">
        <div className="flex flex-col md:flex-row justify-between gap-6">
          <div className="flex-1">
            <div className="flex items-start justify-between">
              <h3 className="text-xl font-normal mb-2" style={{ color: "#1B2B4A", fontFamily: "'Playfair Display', serif" }}>
                {/* ⭐ CORRECTED: Use skill_title from backend */}
                {request.skill_title}
              </h3>
              {request.status === "accepted" && (
                <span className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded">
                  Accepted
                </span>
              )}
            </div>

            <div className="flex items-center mt-4">
              {/* ⭐ ADAPTED: Use learner's initial as a placeholder */}
              <div className="w-10 h-10 rounded-full mr-3 flex items-center justify-center font-bold text-lg" style={{ background: "#C8A951", color: "#14213D" }}>
                {request.learner_username.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="font-medium" style={{ color: "#1B2B4A" }}>
                  {/* ⭐ CORRECTED: Use learner_username from backend */}
                  {request.learner_username}
                </p>
                <p className="text-sm" style={{ color: "#7A8699" }}>
                  {/* ⭐ CORRECTED: Use skill_level from backend */}
                  Skill level: {request.skill_level}
                </p>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div className="flex items-center" style={{ color: "#4A5568" }}>
                <FiCalendar className="mr-2" style={{ color: "#C8A951" }} />
                {/* ⭐ CORRECTED: Use formattedDate based on session_date */}
                <span>{formattedDate}</span>
              </div>
              <div className="flex items-center" style={{ color: "#4A5568" }}>
                <FiClock className="mr-2" style={{ color: "#C8A951" }} />
                <span>
                  {/* ⭐ CORRECTED: Use formattedTime based on session_time */}
                  {formattedTime} ({request.duration} mins)
                </span>
              </div>
            </div>

            {request.message && (
              <div className="mt-4">
                <h4 className="text-sm font-semibold mb-1 flex items-center" style={{ color: "#1B2B4A" }}>
                  <FiMessageSquare className="mr-2" />
                  Learner's Message
                </h4>
                {/* ⭐ CORRECTED: Use message from backend */}
                <p style={{ color: "#4A5568" }}>{request.message}</p>
              </div>
            )}
          </div>

          {request.status === "pending" && (
            <div className="flex flex-col gap-2 w-full md:w-40">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => onAccept(request.id)}
                className="px-4 py-2 bg-green-600 text-white rounded-full hover:bg-green-700 flex items-center justify-center"
              >
                <FiCheck className="mr-2" />
                Accept
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => onDecline(request.id)}
                className="px-4 py-2 border border-red-300 text-red-700 rounded-full hover:bg-red-50 flex items-center justify-center"
              >
                <FiX className="mr-2" />
                Decline
              </motion.button>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
};

export default BookingCard;