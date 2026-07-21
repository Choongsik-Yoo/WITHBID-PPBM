import path from "node:path";

export function getConfig(env = process.env) {
  return {
    port: Number(env.PORT || 4317),
    host: "127.0.0.1",
    dataRoot: path.resolve(env.DATA_ROOT || "D:\\입찰관리"),
    maxUploadBytes: 30 * 1024 * 1024,
  };
}
