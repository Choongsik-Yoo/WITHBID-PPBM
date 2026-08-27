import path from "node:path";
import unzipper from "unzipper";
import { safeName } from "./files.js";

const ZIP_SIGNATURES = ["504b0304", "504b0506", "504b0708"];
const isZip = (file) => /\.zip$/i.test(file.filename || "") || ZIP_SIGNATURES.includes(file.buffer?.subarray(0, 4).toString("hex"));

export function safeArchiveEntryPath(value) {
  const normalized = String(value || "").replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || /^[a-z]:/i.test(normalized)) return null;
  const segments = normalized.split("/").filter(Boolean);
  if (!segments.length || segments.some((segment) => segment === "." || segment === "..")) return null;
  return segments.map((segment) => safeName(segment, 100)).join("/");
}

function uniqueName(filename, used) {
  if (!used.has(filename.toLowerCase())) { used.add(filename.toLowerCase()); return filename; }
  const extension = path.posix.extname(filename);
  const stem = filename.slice(0, -extension.length || undefined);
  for (let index = 2; ; index += 1) {
    const candidate = `${stem}_${index}${extension}`;
    if (!used.has(candidate.toLowerCase())) { used.add(candidate.toLowerCase()); return candidate; }
  }
}

export async function expandZipAttachments(files, { openArchive = (buffer) => unzipper.Open.buffer(buffer), maxEntries = 500, maxBytes = 200 * 1024 * 1024, maxDepth = 3 } = {}) {
  const all = [...files];
  const extracted = [];
  const errors = [];
  const used = new Set(files.map((file) => String(file.filename).toLowerCase()));
  const queue = files.filter(isZip).map((file) => ({ file, depth: 1 }));
  let totalBytes = 0;

  while (queue.length) {
    const { file, depth } = queue.shift();
    if (depth > maxDepth) { errors.push({ filename: file.filename, error: `중첩 압축은 ${maxDepth}단계까지만 지원합니다.` }); continue; }
    try {
      const archive = await openArchive(file.buffer);
      const folder = safeName(path.posix.basename(String(file.filename).replace(/\\/g, "/"), path.posix.extname(file.filename)), 80);
      for (const entry of archive.files || []) {
        if (entry.type === "Directory") continue;
        if (extracted.length >= maxEntries) throw new Error(`압축 해제 파일은 최대 ${maxEntries}개까지 지원합니다.`);
        const relative = safeArchiveEntryPath(entry.path);
        if (!relative) throw new Error(`안전하지 않은 압축 내부 경로입니다: ${entry.path}`);
        const buffer = await entry.buffer();
        totalBytes += buffer.length;
        if (totalBytes > maxBytes) throw new Error(`압축 해제 전체 크기는 ${Math.round(maxBytes / 1024 / 1024)}MB를 넘을 수 없습니다.`);
        const extractedFile = { filename: uniqueName(`${folder}/${relative}`, used), buffer, extractedFrom: file.filename };
        extracted.push(extractedFile);
        all.push(extractedFile);
        if (isZip(extractedFile)) queue.push({ file: extractedFile, depth: depth + 1 });
      }
    } catch (error) {
      errors.push({ filename: file.filename, error: error.message });
    }
  }
  return { files: all, extracted, errors };
}
