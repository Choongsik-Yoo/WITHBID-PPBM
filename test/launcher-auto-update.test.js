import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("실행 스크립트는 매 실행마다 GitHub 최신 릴리스를 확인해 새 버전이면 조용히 설치한다", async () => {
  const script = await fs.readFile(path.join(projectRoot, "start-withbid-ppbm.ps1"), "utf8");
  assert.match(script, /api\.github\.com\/repos\/\$updateRepo\/releases\/latest/);
  assert.match(script, /Choongsik-Yoo\/WITHBID-PPBM/);
  assert.match(script, /Test-RemoteNewer/);
  assert.match(script, /WITHBID-PPBM-app\.zip/);
  assert.match(script, /Install-WITHBID-PPBM\.ps1/);
});

test("다운로드한 릴리스 자산은 설치 전 SHA256으로 무결성을 검증한다", async () => {
  const script = await fs.readFile(path.join(projectRoot, "start-withbid-ppbm.ps1"), "utf8");
  assert.match(script, /Test-AssetSha256/);
  assert.match(script, /Security\.Cryptography\.SHA256/);
  assert.match(script, /무결성 검증에 실패했습니다/);
});

test("자동 업데이트 확인·설치가 실패해도 앱 실행 자체는 막지 않는다", async () => {
  const script = await fs.readFile(path.join(projectRoot, "start-withbid-ppbm.ps1"), "utf8");
  assert.match(script, /try\s*\{\s*Invoke-AutoUpdate\s*\}\s*catch/);
  assert.match(script, /기존 버전으로 계속 실행합니다/);
});

test("반복 실행 시 매번 GitHub를 호출하지 않도록 확인 주기를 둔다", async () => {
  const script = await fs.readFile(path.join(projectRoot, "start-withbid-ppbm.ps1"), "utf8");
  assert.match(script, /updateCheckIntervalMinutes/);
  assert.match(script, /update-check\.json/);
});
