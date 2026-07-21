import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { noticeFolderName, writeJson } from "./files.js";

const SUBFOLDERS = ["01_공고원문", "02_첨부파일", "03_추출텍스트", "04_구조화데이터", "05_가격근거", "06_분석결과"];

export async function createNotice(root, input) {
  const notice = {
    id: crypto.randomUUID(),
    noticeNumber: String(input.noticeNumber || "").trim(),
    title: String(input.title || "").trim(),
    organization: String(input.organization || "").trim(),
    deadline: String(input.deadline || "").trim(),
    sourceUrl: String(input.sourceUrl || "").trim(),
    status: "등록",
    createdAt: new Date().toISOString(),
  };
  if (!notice.noticeNumber || !notice.title || !notice.deadline) {
    throw new Error("공고번호, 공고명, 마감일은 필수입니다.");
  }
  const folderName = noticeFolderName(notice);
  const folder = path.join(root, "진행중", folderName);
  await Promise.all(SUBFOLDERS.map((name) => fs.mkdir(path.join(folder, name), { recursive: true })));
  notice.folderName = folderName;
  await writeJson(path.join(folder, "04_구조화데이터", "공고기본정보.json"), notice);
  return notice;
}
