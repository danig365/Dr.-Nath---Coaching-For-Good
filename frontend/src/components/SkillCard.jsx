import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { FiStar, FiClock, FiUser } from "react-icons/fi";

const SkillCard = ({ skill }) => {
  return (
    <motion.div
      whileHover={{ y: -5 }}
      transition={{ duration: 0.2 }}
      className="bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-all duration-300 flex flex-col h-full"
      style={{ border: "1px solid rgba(200,169,81,0.15)" }}
    >
      <div className="h-1.5 w-full" style={{ background: "linear-gradient(90deg, #C8A951, #E8C96A)" }} />

      <div className="p-5 flex-1">
        <div className="flex justify-between items-start gap-3 mb-3">
          <h3
            className="text-lg font-normal line-clamp-2"
            style={{ color: "#1B2B4A", fontFamily: "'Playfair Display', serif" }}
          >
            {skill.title}
          </h3>
          <span
            className="text-xs font-bold px-2.5 py-1 rounded-full whitespace-nowrap"
            style={{ background: "rgba(200,169,81,0.14)", color: "#A9863A" }}
          >
            ${skill.price}/hr
          </span>
        </div>

        <p className="text-sm mb-4 line-clamp-3" style={{ color: "#4A5568" }}>
          {skill.description}
        </p>

        <div className="flex flex-wrap gap-2 mb-4">
          {skill.tags?.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="text-xs px-2.5 py-1 rounded-full font-medium"
              style={{ background: "rgba(200,169,81,0.1)", color: "#A9863A", border: "1px solid rgba(200,169,81,0.2)" }}
            >
              {tag}
            </span>
          ))}
        </div>

        <div
          className="flex items-center justify-between text-sm pt-3"
          style={{ color: "#7A8699", borderTop: "1px solid rgba(200,169,81,0.15)" }}
        >
          <div className="flex items-center">
            <FiStar className="mr-1" style={{ color: "#C8A951", fill: "#C8A951" }} />
            <span className="font-medium" style={{ color: "#1B2B4A" }}>
              {skill.rating || "New"}
            </span>
          </div>
          <div className="flex items-center">
            <FiClock className="mr-1" />
            <span>{skill.duration || 60} mins</span>
          </div>
          <div className="flex items-center">
            <FiUser className="mr-1" />
            <span>{skill.sessions || 0} sessions</span>
          </div>
        </div>
      </div>

      <Link
        to={`/skills/${skill.id}/book`}
        className="gold-btn block mx-4 mb-4 text-center px-4 py-2.5 text-sm font-bold rounded-full"
      >
        Book Session
      </Link>
    </motion.div>
  );
};

export default SkillCard;
