import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const FORBIDDEN = /[\\/:*?"<>|]/g;

export function safeName(value, maxLength = 50) {
  const cleaned = String(value || "미지정")
    .replace(FORBIDDEN, "_")
    .replace(/[. ]+$/g, "")
    .trim();
  return (cleaned || "미지정").slice(0, maxLength);
}

export function noticeFolderName(notice) {
  const deadline = String(notice.deadline || "00000000").replace(/\D/g, "").slice(0, 8);
  return [
    deadline || "00000000",
    safeName(notice.noticeNumber, 30),
    safeName(notice.organization, 30),
    safeName(notice.title, 30),
  ].join("_");
}

export async function ensureDataLayout(root) {
  const folders = [
    "_설정", "_단가표/company_price_list", "_단가표/current", "_단가표/archive",
    "_데이터베이스/backup", "_가격캐시", "_로그", "진행중", "종료",
  ];
  await Promise.all(folders.map((folder) => fs.mkdir(path.join(root, folder), { recursive: true })));
}

export async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporary, filePath);
}

export async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

export function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}
