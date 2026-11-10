import path from "node:path";

export function getConfig(env = process.env) {
  const storageMode = env.STORAGE_MODE === "local_admin" ? "local_admin" : "nas";
  const nasRoot = path.resolve(env.NAS_ROOT || "\\\\WITHUSNAS1\\입찰관리");
  return {
    port: Number(env.PORT || 4317),
    host: "127.0.0.1",
    dataRoot: path.resolve(env.DATA_ROOT || nasRoot),
    nasRoot,
    storageMode,
    localAdminMode: storageMode === "local_admin",
    localAdminEmail: String(env.LOCAL_ADMIN_EMAIL || "csyoo22@gmail.com").trim().toLowerCase(),
    localModeConsentAt: String(env.LOCAL_MODE_CONSENT_AT || "").trim() || null,
    maxUploadBytes: 30 * 1024 * 1024,
  };
}
