import { FiMessageSquare, FiStar } from "react-icons/fi";

const SessionFeedbackCard = ({
  title,
  subtitle,
  badgeLabel,
  rating,
  comment,
  date,
  tone = "gold",
}) => {
  const toneClasses = {
    gold: {
      outer: "border-[#C8A951]/25 bg-gradient-to-br from-[#FAF6EC] via-white to-[#F3ECD9]",
      header: "border-[#C8A951]/15",
      label: "text-[#A9863A]",
      badge: "bg-[#C8A951]/15 text-[#A9863A]",
      icon: "bg-[#C8A951]/15 text-[#A9863A]",
    },
    emerald: {
      outer: "border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-emerald-50",
      header: "border-emerald-100",
      label: "text-emerald-700",
      badge: "bg-emerald-100 text-emerald-800",
      icon: "bg-emerald-100 text-emerald-700",
    },
  };

  const styles = toneClasses[tone] || toneClasses.gold;

  return (
    <div className={`w-full overflow-hidden rounded-2xl border shadow-sm ${styles.outer}`}>
      <div className={`flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-start sm:justify-between ${styles.header}`}>
        <div className="flex min-w-0 items-start gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-full ${styles.icon}`}>
            <FiMessageSquare />
          </div>
          <div className="min-w-0">
            <p className={`text-[11px] font-semibold uppercase tracking-[0.16em] leading-4 ${styles.label}`}>
              {title}
            </p>
            {subtitle && <p className="mt-1 break-words text-sm leading-5 text-slate-600">{subtitle}</p>}
          </div>
        </div>
        {badgeLabel && (
          <span className={`self-start whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-semibold ${styles.badge}`}>
            {badgeLabel}
          </span>
        )}
      </div>

      <div className="px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            {Array.from({ length: 5 }).map((_, index) => (
              <FiStar
                key={index}
                style={{ color: index < rating ? "#C8A951" : "rgba(27,43,74,0.18)", fill: index < rating ? "#C8A951" : "transparent" }}
              />
            ))}
          </div>
          {date && <span className="text-xs font-medium" style={{ color: "#7A8699" }}>{date}</span>}
        </div>
        <p className="mt-3 whitespace-pre-wrap text-sm leading-6" style={{ color: "#4A5568" }}>
          {comment}
        </p>
      </div>
    </div>
  );
};

export default SessionFeedbackCard;