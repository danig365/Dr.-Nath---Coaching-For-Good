import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { toast } from "react-toastify";
import { FiMoreVertical, FiUserX, FiUserCheck, FiTrash2 } from "react-icons/fi";
import { api } from "../utils/auth";

// Kebab menu of admin actions for a coach/client row: suspend / reactivate /
// delete. Rendered in a portal (fixed position) so it's never clipped by the
// table's overflow. `kind` is "coach" | "client". onDone() refetches.
export default function AdminUserActions({ userId, isActive, kind = "user", onDone }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pos, setPos] = useState(null); // {top, right}
  const btnRef = useRef(null);

  const place = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
  };
  const toggle = () => { if (!open) place(); setOpen((o) => !o); setConfirmDelete(false); };
  const close = () => { setOpen(false); setConfirmDelete(false); };

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
      toast.success(next ? "Account reactivated." : "Account suspended.");
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
            {!confirmDelete ? (
              <>
                {isActive ? (
                  <button onClick={() => setActive(false)} disabled={busy}
                    className="w-full flex items-center gap-2.5 px-4 py-2 text-sm hover:bg-[#1B2B4A]/[0.05]" style={{ color: "#B45309" }}>
                    <FiUserX size={15} /> Suspend account
                  </button>
                ) : (
                  <button onClick={() => setActive(true)} disabled={busy}
                    className="w-full flex items-center gap-2.5 px-4 py-2 text-sm hover:bg-[#1B2B4A]/[0.05]" style={{ color: "#2E7D32" }}>
                    <FiUserCheck size={15} /> Reactivate account
                  </button>
                )}
                <button onClick={() => setConfirmDelete(true)} disabled={busy}
                  className="w-full flex items-center gap-2.5 px-4 py-2 text-sm hover:bg-[#1B2B4A]/[0.05]" style={{ color: "#B91C1C" }}>
                  <FiTrash2 size={15} /> Delete permanently
                </button>
              </>
            ) : (
              <div className="px-3 py-2">
                <p className="text-xs mb-2" style={{ color: "#4A5568" }}>Delete this {kind} and all their data? This can't be undone.</p>
                <div className="flex gap-2">
                  <button onClick={remove} disabled={busy}
                    className="flex-1 py-1.5 rounded-lg text-xs font-bold" style={{ background: "#B91C1C", color: "white" }}>
                    {busy ? "Deleting…" : "Delete"}
                  </button>
                  <button onClick={() => setConfirmDelete(false)} disabled={busy}
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
