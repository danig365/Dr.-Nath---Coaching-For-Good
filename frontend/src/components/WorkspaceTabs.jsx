import { useNavigate, useLocation } from "react-router-dom";
import { FiFolder, FiInbox, FiFileText, FiEdit3 } from "react-icons/fi";
import { useAuth } from "../context/AuthContext";

const GOLD = "#C8A951";
const BROWN = "#4A5568";

// One unified sub-navigation for the coach/client workspace, so the top navbar
// stays concise. Coach sees Library + Client Submissions (the two Resources
// sub-sections) alongside Agreements and Forms; client sees Resources, Agreements
// and Forms. The Resources page reads its active sub-section from ?tab=.
export default function WorkspaceTabs() {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const { isCoach } = useAuth();
  const onInbox = new URLSearchParams(search).get("tab") === "inbox";

  const tabs = isCoach()
    ? [
        { label: "Library", icon: FiFolder, path: "/my-resources", active: pathname === "/my-resources" && !onInbox },
        { label: "Client Submissions", icon: FiInbox, path: "/my-resources?tab=inbox", active: pathname === "/my-resources" && onInbox },
        { label: "Agreements", icon: FiFileText, path: "/agreements", active: pathname === "/agreements" },
        { label: "Forms", icon: FiEdit3, path: "/forms", active: pathname === "/forms" },
      ]
    : [
        { label: "Resources", icon: FiFolder, path: "/resources", active: pathname === "/resources" },
        { label: "Agreements", icon: FiFileText, path: "/agreements", active: pathname === "/agreements" },
        { label: "Forms", icon: FiEdit3, path: "/forms", active: pathname === "/forms" },
      ];

  return (
    <div className="flex gap-2 mb-6 flex-wrap">
      {tabs.map((t) => {
        const Icon = t.icon;
        return (
          <button
            key={t.label}
            onClick={() => navigate(t.path)}
            className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-all"
            style={t.active
              ? { background: `linear-gradient(135deg,${GOLD},#F0D98C)`, color: "#14213D" }
              : { background: "white", color: BROWN, border: "1px solid rgba(200,169,81,0.25)" }}
          >
            <Icon size={14} /> {t.label}
          </button>
        );
      })}
    </div>
  );
}
