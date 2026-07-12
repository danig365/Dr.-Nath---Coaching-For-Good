import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "react-toastify";
import { FiCalendar, FiCheckCircle, FiAlertTriangle } from "react-icons/fi";
import { api } from "../utils/auth";
import { useAuth } from "../context/AuthContext";

// Coach-only card to connect / disconnect a Google Calendar (two-way sync).
// Sits on the My Availability page.
export default function GoogleCalendarCard() {
  const [status, setStatus] = useState(null); // { connected, email, is_active, configured }
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const { isCoach } = useAuth();
  const subtitle = isCoach && isCoach()
    ? "Sync your bookings and block busy times automatically."
    : "Automatically add your booked sessions to your calendar.";

  const fetchStatus = useCallback(async () => {
    try {
      const res = await api.get("/integrations/google/status/");
      setStatus(res.data);
    } catch { setStatus({ connected: false, configured: false }); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  // Handle the redirect back from Google (?google=connected|error).
  useEffect(() => {
    const g = searchParams.get("google");
    if (!g) return;
    if (g === "connected") toast.success("Google Calendar connected.");
    else if (g === "error") toast.error("Couldn't connect Google Calendar. Please try again.");
    const next = new URLSearchParams(searchParams);
    next.delete("google");
    setSearchParams(next, { replace: true });
    fetchStatus();
  }, [searchParams, setSearchParams, fetchStatus]);

  const connect = async () => {
    setBusy(true);
    try {
      const res = await api.get("/integrations/google/connect/");
      if (res.data.authorize_url) window.location.assign(res.data.authorize_url);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Google Calendar isn't available right now.");
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await api.post("/integrations/google/disconnect/");
      toast.success("Google Calendar disconnected.");
      await fetchStatus();
    } catch { toast.error("Couldn't disconnect. Please try again."); }
    finally { setBusy(false); }
  };

  // Hide entirely if the server has no Google integration configured.
  if (loading) return null;
  if (status && status.configured === false && !status.connected) return null;

  const connected = status?.connected;
  const needsReconnect = connected && status?.is_active === false;
  const coach = !!(isCoach && isCoach());

  const patchSetting = async (field, value) => {
    setStatus((s) => ({ ...s, [field]: value })); // optimistic
    try {
      await api.patch("/integrations/google/settings/", { [field]: value });
    } catch {
      setStatus((s) => ({ ...s, [field]: !value })); // revert
      toast.error("Couldn't update that setting.");
    }
  };

  const Toggle = ({ field, label }) => (
    <label className="flex items-center gap-2 cursor-pointer text-xs" style={{ color: "#4A5568" }}>
      <input type="checkbox" checked={!!status?.[field]} onChange={(e) => patchSetting(field, e.target.checked)}
        style={{ accentColor: "#C8A951" }} />
      {label}
    </label>
  );

  return (
    <div className="rounded-2xl p-5 mb-6 flex flex-col gap-3"
      style={{ background: "white", border: "1px solid rgba(200,169,81,0.3)" }}>
     <div className="flex items-center justify-between gap-4 flex-wrap">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: "rgba(200,169,81,0.14)" }}>
          <FiCalendar size={20} style={{ color: "#C8A951" }} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold" style={{ color: "#1B2B4A" }}>Google Calendar</p>
          {connected ? (
            needsReconnect ? (
              <p className="text-xs mt-0.5 flex items-center gap-1" style={{ color: "#B45309" }}>
                <FiAlertTriangle size={12} /> Access expired — please reconnect.
              </p>
            ) : (
              <p className="text-xs mt-0.5 flex items-center gap-1" style={{ color: "#2E7D32" }}>
                <FiCheckCircle size={12} /> Connected{status.email ? ` · ${status.email}` : ""}
              </p>
            )
          ) : (
            <p className="text-xs mt-0.5" style={{ color: "rgba(74,85,104,0.8)" }}>
              {subtitle}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {connected && !needsReconnect && (
          <button onClick={disconnect} disabled={busy}
            className="px-4 py-2 rounded-full text-xs font-semibold disabled:opacity-50"
            style={{ background: "rgba(27,43,74,0.06)", color: "#4A5568" }}>
            Disconnect
          </button>
        )}
        {(!connected || needsReconnect) && (
          <button onClick={connect} disabled={busy}
            className="px-5 py-2 rounded-full text-xs font-bold disabled:opacity-50"
            style={{ background: "linear-gradient(135deg,#C8A951,#F0D98C)", color: "#14213D" }}>
            {busy ? "Opening…" : needsReconnect ? "Reconnect" : "Connect Google Calendar"}
          </button>
        )}
      </div>
     </div>

      {/* Preferences (connected only) */}
      {connected && !needsReconnect && (
        <div className="flex items-center gap-5 flex-wrap pt-3" style={{ borderTop: "1px solid rgba(200,169,81,0.18)" }}>
          <Toggle field="sync_bookings_out" label="Add my sessions to this calendar" />
          {coach && <Toggle field="block_busy_times" label="Block my busy times from bookings" />}
        </div>
      )}
    </div>
  );
}
