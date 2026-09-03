import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openNoticeFolder, resolveNoticeFolder } from "../src/lib/folder-launcher.js";

test("공고 결과 폴더는 진행중 폴더 안에서만 계산한다", () => {
  const dataRoot = path.resolve("C:/withbid-data");
  assert.equal(
    resolveNoticeFolder(dataRoot, "20260910_R26BK01709164_국민대학교"),
    path.join(dataRoot, "진행중", "20260910_R26BK01709164_국민대학교"),
  );
  assert.throws(() => resolveNoticeFolder(dataRoot, "../비밀폴더"), /올바르지 않습니다/);
  assert.throws(() => resolveNoticeFolder(dataRoot, "하위/폴더"), /올바르지 않습니다/);
  assert.throws(() => resolveNoticeFolder(dataRoot, "C:외부폴더"), /올바르지 않습니다/);
});

test("존재하는 공고 폴더만 Windows 탐색기로 전달한다", async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "withbid-folder-"));
  const folderName = "20260910_R26BK01709164_국민대학교";
  const expected = path.join(dataRoot, "진행중", folderName);
  await fs.mkdir(expected, { recursive:true });
  let launchedPath = null;

  const opened = await openNoticeFolder({
    dataRoot,
    folderName,
    platform:"win32",
    launch:async (folderPath) => { launchedPath = folderPath; },
  });

  assert.equal(opened, expected);
  assert.equal(launchedPath, expected);
});

test("존재하지 않는 공고 폴더는 열지 않는다", async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "withbid-folder-missing-"));
  await assert.rejects(
    openNoticeFolder({ dataRoot, folderName:"없는_공고", platform:"win32", launch:async () => {} }),
    /결과 폴더를 찾을 수 없습니다/,
  );
});
