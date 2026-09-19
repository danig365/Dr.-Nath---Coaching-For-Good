import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { toast } from "react-toastify";
import { FiMoreVertical, FiUserX, FiUserCheck, FiTrash2 } from "react-icons/fi";
import { api } from "../utils/auth";

// Kebab menu of admin actions for a coach/client row: deactivate / reactivate /
// delete. Rendered in a portal (fixed position) so it's never clipped by the
// table's overflow. `kind` is "coach" | "client". onDone() refetches.
export default function AdminUserActions({ userId, isActive, kind = "user", onDone }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Which action is waiting to be confirmed: "deactivate" | "delete" | null.
  // Both change what other people can see or lose data, so neither fires on a
  // single click of a menu item. Reactivating is harmless and stays one click.
  const [confirming, setConfirming] = useState(null);
  const [pos, setPos] = useState(null); // {top, right}
  const btnRef = useRef(null);

  const place = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
  };
  const toggle = () => { if (!open) place(); setOpen((o) => !o); setConfirming(null); };
  const close = () => { setOpen(false); setConfirming(null); };

  useEffect(() => {
    if (!open) return undefined;
    const onScroll = () => close();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => { window.removeEventListener("scroll", onScroll, true); window.removeEventListener("resize", onScroll); };
  }, [open]);

  const setActive = async (next) => {
    setBusy(true);
    try {
      await api.patch(`/admin/users/${userId}/`, { is_active: next });
      toast.success(next ? "Account reactivated." : "Account deactivated.");
      close(); onDone?.();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Couldn't update the account.");
    } finally { setBusy(false); }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.delete(`/admin/users/${userId}/`);
      toast.success(`${kind === "coach" ? "Coach" : "Client"} deleted.`);
      close(); onDone?.();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Couldn't delete the account.");
    } finally { setBusy(false); }
  };

  return (
    <div className="flex justify-center">
      <button ref={btnRef} onClick={toggle} disabled={busy}
        className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-[#1B2B4A]/[0.06] disabled:opacity-50"
        style={{ color: "#4A5568" }} title="Actions">
        <FiMoreVertical size={16} />
      </button>

      {open && pos && createPortal(
        <>
          <div className="fixed inset-0 z-[90]" onClick={close} />
          <div className="fixed z-[91] min-w-[190px] rounded-xl py-1.5 shadow-xl"
            style={{ top: pos.top, right: pos.right, background: "white", border: "1px solid rgba(200,169,81,0.3)" }}>
            {!confirming ? (
              <>
                {isActive ? (
                  <button onClick={() => setConfirming("deactivate")} disabled={busy}
                    className="w-full flex items-center gap-2.5 px-4 py-2 text-sm hover:bg-[#1B2B4A]/[0.05]" style={{ color: "#B45309" }}>
                    <FiUserX size={15} /> Deactivate account
                  </button>
                ) : (
                  <button onClick={() => setActive(true)} disabled={busy}
                    className="w-full flex items-center gap-2.5 px-4 py-2 text-sm hover:bg-[#1B2B4A]/[0.05]" style={{ color: "#2E7D32" }}>
                    <FiUserCheck size={15} /> Reactivate account
                  </button>
                )}
                <button onClick={() => setConfirming("delete")} disabled={busy}
                  className="w-full flex items-center gap-2.5 px-4 py-2 text-sm hover:bg-[#1B2B4A]/[0.05]" style={{ color: "#B91C1C" }}>
                  <FiTrash2 size={15} /> Delete permanently
                </button>
              </>
            ) : (
              <div className="px-3 py-2.5" style={{ width: 250 }}>
                <p className="text-xs font-bold mb-1" style={{ color: "#1B2B4A" }}>
                  {confirming === "delete" ? `Delete this ${kind}?` : `Deactivate this ${kind}?`}
                </p>
                <p className="text-xs mb-2.5 leading-relaxed" style={{ color: "#4A5568" }}>
                  {confirming === "delete"
                    ? "This removes them and all their data permanently. It can't be undone."
                    : kind === "coach"
                      ? "They'll be removed from the coach directory and every booking page, and won't be able to sign in. Sessions already booked are unaffected. You can reactivate them at any time."
                      : "They won't be able to sign in. Sessions already booked are unaffected. You can reactivate them at any time."}
                </p>
                <div className="flex gap-2">
                  <button onClick={() => (confirming === "delete" ? remove() : setActive(false))} disabled={busy}
                    className="flex-1 py-1.5 rounded-lg text-xs font-bold"
                    style={{ background: confirming === "delete" ? "#B91C1C" : "#B45309", color: "white" }}>
                    {busy
                      ? (confirming === "delete" ? "Deleting…" : "Deactivating…")
                      : (confirming === "delete" ? "Delete" : "Deactivate")}
                  </button>
                  <button onClick={() => setConfirming(null)} disabled={busy}
                    className="flex-1 py-1.5 rounded-lg text-xs font-semibold" style={{ background: "rgba(27,43,74,0.06)", color: "#4A5568" }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
