import { spawn } from "node:child_process";
import path from "node:path";
import { readJson, writeJson } from "./files.js";

const PREFIX = "dpapi:v1:";

function powershellPath(env = process.env) {
  return env.SystemRoot
    ? path.join(env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    : "powershell.exe";
}

function runPowerShell(script, input, { spawnImpl = spawn, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(powershellPath(env), ["-NoProfile", "-NonInteractive", "-Command", script], {
      windowsHide:true,
      stdio:["pipe", "pipe", "pipe"],
    });
    const output = [];
    const errors = [];
    child.stdout.on("data", (chunk) => output.push(chunk));
    child.stderr.on("data", (chunk) => errors.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`Windows 보안 저장소 처리 실패 (${code}): ${Buffer.concat(errors).toString("utf8").trim()}`));
      resolve(Buffer.concat(output).toString("utf8").trim());
    });
    child.stdin.end(String(input || ""), "utf8");
  });
}

const protectScript = `
Add-Type -AssemblyName System.Security
$plain = [Console]::In.ReadToEnd()
$bytes = [Text.Encoding]::UTF8.GetBytes($plain)
$cipher = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([Convert]::ToBase64String($cipher))
`;

const unprotectScript = `
Add-Type -AssemblyName System.Security
$encoded = [Console]::In.ReadToEnd()
$cipher = [Convert]::FromBase64String($encoded)
$bytes = [Security.Cryptography.ProtectedData]::Unprotect($cipher, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([Text.Encoding]::UTF8.GetString($bytes))
`;

export function isProtectedValue(value) {
  return String(value || "").startsWith(PREFIX);
}

export async function protectForCurrentWindowsUser(value, options = {}) {
  if (!String(value || "")) return "";
  if (process.platform !== "win32" && !options.spawnImpl) throw new Error("관리자 로컬 모드의 보안 설정은 Windows에서만 사용할 수 있습니다.");
  return `${PREFIX}${await runPowerShell(protectScript, value, options)}`;
}

export async function unprotectForCurrentWindowsUser(value, options = {}) {
  const text = String(value || "");
  if (!isProtectedValue(text)) return text;
  if (process.platform !== "win32" && !options.spawnImpl) throw new Error("관리자 로컬 모드의 보안 설정은 Windows에서만 사용할 수 있습니다.");
  return runPowerShell(unprotectScript, text.slice(PREFIX.length), options);
}

export function createSettingsStore({ protectedMode = false, protect = protectForCurrentWindowsUser, unprotect = unprotectForCurrentWindowsUser } = {}) {
  return {
    async read(filePath, fallback = {}, protectedFields = []) {
      const value = await readJson(filePath, fallback);
      if (!protectedMode || !value || typeof value !== "object") return value;
      const result = { ...value };
      for (const field of protectedFields) {
        if (isProtectedValue(result[field])) result[field] = await unprotect(result[field]);
      }
      return result;
    },
    async write(filePath, value, protectedFields = []) {
      if (!protectedMode) return writeJson(filePath, value);
      const stored = { ...value };
      for (const field of protectedFields) {
        const plain = String(stored[field] || "");
        stored[field] = plain ? await protect(plain) : "";
      }
      return writeJson(filePath, stored);
    },
  };
}
