// Shared helpers for chat file-sharing across the standalone chat pages and the
// in-call chat panels. Keep MAX_UPLOAD_BYTES in sync with the backend guard
// (resources.serializers.validate_upload_file → 50 MB).

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export const formatBytes = (bytes) => {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const isImageType = (type) =>
  typeof type === "string" && type.startsWith("image/");
