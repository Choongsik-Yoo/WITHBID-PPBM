import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { noticeFolderName, writeJson } from "./files.js";
import { resolveNoticeFolder } from "./folder-launcher.js";

const SUBFOLDERS = ["01_공고원문", "02_첨부파일", "03_추출텍스트", "04_구조화데이터", "05_가격근거", "06_분석결과"];

async function pathExists(target) {
  try { await fs.stat(target); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

async function availableFolderName(root, preferredName) {
  for (let attempt = 1; ; attempt += 1) {
    const candidate = attempt === 1 ? preferredName : `${preferredName}_재분석_${attempt}`;
    if (!await pathExists(resolveNoticeFolder(root, candidate))) return candidate;
  }
}

export async function ensureNoticeFolder(root, notice) {
  if (!notice.folderName) notice.folderName = await availableFolderName(root, noticeFolderName(notice));
  const folder = resolveNoticeFolder(root, notice.folderName);
  await Promise.all(SUBFOLDERS.map((name) => fs.mkdir(path.join(folder, name), { recursive:true })));
  await writeJson(path.join(folder, "04_구조화데이터", "공고기본정보.json"), notice);
  return folder;
}

export async function createNotice(root, input) {
  const notice = {
    id: crypto.randomUUID(),
    noticeNumber: String(input.noticeNumber || "").trim(),
    title: String(input.title || "").trim(),
    organization: String(input.organization || "").trim(),
    deadline: String(input.deadline || "").trim(),
    sourceUrl: String(input.sourceUrl || "").trim(),
    status: String(input.status || "등록"),
    createdAt: new Date().toISOString(),
  };
  if (!notice.noticeNumber || !notice.title || !notice.deadline) {
    throw new Error("공고번호, 공고명, 마감일은 필수입니다.");
  }
  notice.folderName = await availableFolderName(root, noticeFolderName(notice));
  await ensureNoticeFolder(root, notice);
  return notice;
}

export async function updateNoticeDetails(root, notice, details = {}) {
  const updated = { ...notice };
  for (const key of ["noticeNumber", "title", "organization", "deadline", "sourceUrl"]) {
    const value = String(details[key] || "").trim();
    if (value) updated[key] = value;
  }

  const preferredName = noticeFolderName(updated);
  if (preferredName !== notice.folderName) {
    const previousFolder = resolveNoticeFolder(root, notice.folderName);
    const nextName = await availableFolderName(root, preferredName);
    const nextFolder = resolveNoticeFolder(root, nextName);
    try { await fs.rename(previousFolder, nextFolder); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    updated.folderName = nextName;
  }

  Object.assign(notice, updated);
  return ensureNoticeFolder(root, notice);
}

export async function archiveNoticeFolder(root, notice, now = new Date()) {
  if (!notice?.folderName) return null;
  const source = resolveNoticeFolder(root, notice.folderName);
  if (!await pathExists(source)) return null;

  const deletedRoot = path.resolve(root, "종료", "_삭제됨");
  await fs.mkdir(deletedRoot, { recursive:true });
  const timestamp = now.toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  let destination = path.join(deletedRoot, `${timestamp}_${notice.folderName}`);
  for (let attempt = 2; await pathExists(destination); attempt += 1) destination = path.join(deletedRoot, `${timestamp}_${notice.folderName}_${attempt}`);
  await fs.rename(source, destination);
  return { source, destination };
}

export async function restoreArchivedNoticeFolder(archived) {
  if (!archived) return;
  await fs.rename(archived.destination, archived.source);
}
