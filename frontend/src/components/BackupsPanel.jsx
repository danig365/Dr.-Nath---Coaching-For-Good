import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "react-toastify";
import {
  FiDatabase, FiDownload, FiRefreshCw, FiTrash2, FiRotateCcw, FiShield,
  FiAlertTriangle, FiClock, FiCheckCircle, FiX,
} from "react-icons/fi";
import { api } from "../utils/auth";

const fmtWhen = (iso) =>
  new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

// Admin view of the nightly backups: see what exists, take one now, download a
// copy, and restore. Restore replaces ALL current data, so it sits behind a
// typed confirmation and shows live progress while the site is briefly down.
export default function BackupsPanel() {
  const [backups, setBackups] = useState([]);
  const [meta, setMeta] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState(null); // backup being restored
  const [confirmText, setConfirmText] = useState("");
  const [restore, setRestore] = useState({ state: "idle", message: "" });
  const pollRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get("/ops/backups/");
      setBackups(res.data.backups || []);
      setMeta(res.data);
    } catch {
      toast.error("Couldn't load backups.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // While a restore runs the API goes down and comes back — keep polling through
  // the outage rather than treating a failed request as an error.
  const startPolling = useCallback(() => {
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await api.get("/ops/backups/restore-status/");
        setRestore(res.data);
        if (res.data.state === "done" || res.data.state === "failed") {
          clearInterval(pollRef.current);
          if (res.data.state === "done") toast.success("Restore complete.");
          else toast.error(res.data.message || "Restore failed.");
          load();
        }
      } catch { /* the site is restarting — keep waiting */ }
    }, 2500);
  }, [load]);

  useEffect(() => {
    // If a restore was already running when this page opened, follow it.
    api.get("/ops/backups/restore-status/")
      .then((res) => { setRestore(res.data); if (res.data.state === "running") startPolling(); })
      .catch(() => {});
    return () => clearInterval(pollRef.current);
  }, [startPolling]);

  const createBackup = async () => {
    setBusy(true);
    try {
      await api.post("/ops/backups/");
      toast.success("Backup created.");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Backup failed.");
    } finally { setBusy(false); }
  };

  const download = (name) => {
    // Same-origin download that still carries the auth header.
    api.get(`/ops/backups/${name}/download/`, { responseType: "blob" })
      .then((res) => {
        const url = URL.createObjectURL(res.data);
        const a = document.createElement("a");
        a.href = url; a.download = name; a.click();
        URL.revokeObjectURL(url);
      })
      .catch(() => toast.error("Download failed."));
  };

  const remove = async (name) => {
    if (!window.confirm(`Delete ${name}? This cannot be undone.`)) return;
    try {
      await api.delete(`/ops/backups/${name}/delete/`);
      toast.info("Backup deleted.");
      load();
    } catch { toast.error("Couldn't delete."); }
  };

  const doRestore = async () => {
    if (confirmText.trim().toUpperCase() !== "RESTORE") return;
    setBusy(true);
    try {
      await api.post(`/ops/backups/${confirmTarget.name}/restore/`, { confirm: "RESTORE" });
      setRestore({ state: "running", message: "Starting restore…" });
      setConfirmTarget(null); setConfirmText("");
      startPolling();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't start the restore.");
    } finally { setBusy(false); }
  };

  const dbBackups = backups.filter((b) => b.kind === "database");
  const mediaBackups = backups.filter((b) => b.kind === "media");

  if (loading) return <p className="text-sm" style={{ color: "#4A5568" }}>Loading backups…</p>;

  return (
    <div>
      {/* Header + actions */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
        <div>
          <h2 className="text-xl font-normal text-[#1B2B4A]" style={{ fontFamily: "'Playfair Display', serif" }}>
            Backups
          </h2>
          <p className="text-sm mt-1" style={{ color: "#4A5568" }}>
            {meta.schedule} · {meta.database_count} database {meta.database_count === 1 ? "copy" : "copies"} available
          </p>
        </div>
        <button onClick={createBackup} disabled={busy || restore.state === "running"}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold disabled:opacity-50"
          style={{ background: "linear-gradient(135deg,#C8A951,#F0D98C)", color: "#14213D" }}>
          <FiRefreshCw size={14} /> Back up now
        </button>
      </div>

      {/* Live restore progress */}
      <AnimatePresence>
        {restore.state === "running" && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="rounded-xl p-4 mb-5 flex items-center gap-3"
            style={{ background: "rgba(200,169,81,0.1)", border: "1px solid rgba(200,169,81,0.35)" }}>
            <div className="w-5 h-5 rounded-full border-2 animate-spin shrink-0"
              style={{ borderColor: "#C8A951", borderTopColor: "transparent" }} />
            <div>
              <p className="text-sm font-bold" style={{ color: "#1B2B4A" }}>Restore in progress — don't close this page</p>
              <p className="text-xs mt-0.5" style={{ color: "#4A5568" }}>{restore.message}</p>
            </div>
          </motion.div>
        )}
        {restore.state === "done" && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="rounded-xl p-4 mb-5 flex items-start gap-3"
            style={{ background: "#F4F8F4", border: "1px solid rgba(52,168,83,0.3)" }}>
            <FiCheckCircle size={16} style={{ color: "#2E7D32" }} className="mt-0.5 shrink-0" />
            <p className="text-sm" style={{ color: "#1B2B4A" }}>{restore.message}</p>
            <button onClick={() => setRestore({ state: "idle", message: "" })} className="ml-auto" style={{ color: "#4A5568" }}>
              <FiX size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Database backups */}
      <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "rgba(74,85,104,0.7)" }}>
        Database
      </p>
      <div className="space-y-2 mb-6">
        {dbBackups.length === 0 && (
          <p className="text-sm" style={{ color: "#4A5568" }}>No database backups yet.</p>
        )}
        {dbBackups.map((b) => (
          <div key={b.name} className="flex items-center gap-3 flex-wrap rounded-xl px-4 py-3"
            style={{ background: "white", border: "1px solid rgba(200,169,81,0.2)" }}>
            <FiDatabase size={15} style={{ color: "#C8A951" }} className="shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[#1B2B4A] flex items-center gap-2 flex-wrap">
                {fmtWhen(b.created_at)}
                {b.is_safety_copy && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full inline-flex items-center gap-1"
                    style={{ background: "rgba(52,168,83,0.12)", color: "#2E7D32" }}>
                    <FiShield size={9} /> safety copy
                  </span>
                )}
              </p>
              <p className="text-xs" style={{ color: "rgba(74,85,104,0.7)" }}>{b.name} · {b.size_human}</p>
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <button onClick={() => download(b.name)} title="Download"
                className="p-2 rounded-full" style={{ background: "rgba(200,169,81,0.1)", color: "#A9863A" }}>
                <FiDownload size={13} />
              </button>
              <button onClick={() => { setConfirmTarget(b); setConfirmText(""); }}
                disabled={restore.state === "running"}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold disabled:opacity-40"
                style={{ background: "rgba(200,169,81,0.15)", color: "#A9863A", border: "1px solid rgba(200,169,81,0.3)" }}>
                <FiRotateCcw size={12} /> Restore
              </button>
              <button onClick={() => remove(b.name)} title="Delete"
                className="p-2 rounded-full" style={{ background: "rgba(239,68,68,0.08)", color: "#B91C1C" }}>
                <FiTrash2 size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Media backups — no restore button: these are files, not data */}
      <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "rgba(74,85,104,0.7)" }}>
        Uploaded files
      </p>
      <div className="space-y-2">
        {mediaBackups.map((b) => (
          <div key={b.name} className="flex items-center gap-3 rounded-xl px-4 py-2.5"
            style={{ background: "white", border: "1px solid rgba(200,169,81,0.15)" }}>
            <FiClock size={13} style={{ color: "rgba(74,85,104,0.5)" }} className="shrink-0" />
            <p className="text-sm text-[#1B2B4A]">{fmtWhen(b.created_at)}</p>
            <p className="text-xs" style={{ color: "rgba(74,85,104,0.6)" }}>{b.size_human}</p>
            <button onClick={() => download(b.name)} title="Download"
              className="ml-auto p-2 rounded-full" style={{ background: "rgba(200,169,81,0.1)", color: "#A9863A" }}>
              <FiDownload size={13} />
            </button>
          </div>
        ))}
      </div>

      {/* Restore confirmation */}
      <AnimatePresence>
        {confirmTarget && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: "rgba(0,0,0,0.5)" }} onClick={() => setConfirmTarget(null)}>
            <motion.div initial={{ scale: 0.96, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-2xl p-6" style={{ background: "white" }}>
              <div className="flex items-start gap-3 mb-4">
                <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: "rgba(239,68,68,0.1)" }}>
                  <FiAlertTriangle size={18} style={{ color: "#B91C1C" }} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-[#1B2B4A]">Restore this backup?</h3>
                  <p className="text-sm mt-1" style={{ color: "#4A5568" }}>
                    From <strong>{fmtWhen(confirmTarget.created_at)}</strong>
                  </p>
                </div>
              </div>

              <div className="rounded-xl p-3 mb-4 text-sm leading-relaxed"
                style={{ background: "#FDF2F2", border: "1px solid rgba(239,68,68,0.2)", color: "#4A5568" }}>
                This <strong>replaces all current data</strong> with this copy. Anything added since then
                — bookings, messages, clients — will be gone.
                <br /><br />
                A safety copy of the current data is taken first, so this can be undone.
                The site will be offline for about a minute.
              </div>

              <label className="block text-xs font-semibold mb-1.5" style={{ color: "#4A5568" }}>
                Type <strong>RESTORE</strong> to confirm
              </label>
              <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)}
                placeholder="RESTORE" autoFocus
                className="w-full px-3 py-2 rounded-lg text-sm outline-none mb-4"
                style={{ background: "#FAF6EC", border: "1px solid rgba(200,169,81,0.3)", color: "#1B2B4A" }} />

              <div className="flex items-center gap-2 justify-end">
                <button onClick={() => setConfirmTarget(null)}
                  className="px-4 py-2 rounded-full text-sm font-semibold" style={{ background: "rgba(27,43,74,0.06)", color: "#4A5568" }}>
                  Cancel
                </button>
                <button onClick={doRestore} disabled={busy || confirmText.trim().toUpperCase() !== "RESTORE"}
                  className="px-4 py-2 rounded-full text-sm font-bold disabled:opacity-40"
                  style={{ background: "#EF4444", color: "white" }}>
                  Restore now
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
