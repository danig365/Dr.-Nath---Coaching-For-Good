import { api } from "./auth";
import { toast } from "react-toastify";

// Fetch an authenticated file (e.g. a PDF receipt) as a blob and trigger a
// browser download. Plain <a href> can't be used because the endpoint needs the
// JWT Authorization header.
export async function downloadFile(url, fallbackName = "download") {
  try {
    const res = await api.get(url, { responseType: "blob" });
    // Prefer the server-provided filename from Content-Disposition.
    let filename = fallbackName;
    const cd = res.headers["content-disposition"] || "";
    const match = cd.match(/filename="?([^"]+)"?/);
    if (match) filename = match[1];

    const blobUrl = window.URL.createObjectURL(res.data);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(blobUrl);
  } catch (err) {
    // Blob error responses need decoding to read the JSON message.
    let msg = "Download failed.";
    if (err.response?.data instanceof Blob) {
      try { msg = JSON.parse(await err.response.data.text()).error || msg; } catch { /* keep default */ }
    } else {
      msg = err.response?.data?.error || msg;
    }
    toast.error(msg);
  }
}
