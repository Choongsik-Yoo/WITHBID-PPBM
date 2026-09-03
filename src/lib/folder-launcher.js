import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

export function resolveNoticeFolder(dataRoot, folderName) {
  const name = String(folderName || "").trim();
  if (!name || name === "." || name === ".." || path.basename(name) !== name || /[\\/:*?"<>|\u0000-\u001f]/.test(name)) {
    throw new Error("공고 결과 폴더 정보가 올바르지 않습니다.");
  }

  const noticesRoot = path.resolve(dataRoot, "진행중");
  const folderPath = path.resolve(noticesRoot, name);
  const relative = path.relative(noticesRoot, folderPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("공고 결과 폴더가 입찰관리 경로를 벗어났습니다.");
  }
  return folderPath;
}

export function launchWindowsExplorer(folderPath) {
  return new Promise((resolve, reject) => {
    const child = spawn("explorer.exe", [folderPath], {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

export async function openNoticeFolder({ dataRoot, folderName, platform = process.platform, launch = launchWindowsExplorer }) {
  if (platform !== "win32") throw new Error("결과 폴더 열기는 Windows 데스크탑 앱에서만 사용할 수 있습니다.");
  const folderPath = resolveNoticeFolder(dataRoot, folderName);

  try {
    const info = await fs.stat(folderPath);
    if (!info.isDirectory()) throw new Error("directory_expected");
  } catch (error) {
    if (error.message === "directory_expected" || error.code === "ENOENT") {
      throw new Error("해당 공고의 결과 폴더를 찾을 수 없습니다.");
    }
    throw new Error(`NAS 입찰관리 공유폴더에 접근할 수 없습니다. 파일 탐색기에서 \\\\Withusnas1\\입찰관리에 로그인한 뒤 다시 시도하세요. (${error.message})`);
  }

  try {
    await launch(folderPath);
  } catch (error) {
    throw new Error(`Windows 파일 탐색기를 실행하지 못했습니다. (${error.message})`);
  }
  return folderPath;
}
