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

test("실행할 때마다 GitHub 최신 릴리스를 확인하며 이전 확인 캐시로 건너뛰지 않는다", async () => {
  const script = await fs.readFile(path.join(projectRoot, "start-withbid-ppbm.ps1"), "utf8");
  assert.doesNotMatch(script, /updateCheckIntervalMinutes/);
  assert.doesNotMatch(script, /update-check\.json/);
  assert.doesNotMatch(script, /최근 .*분 전에 확인했으므로 건너뜁니다/);
});

test("업데이트 후 실행 중인 이전 버전 서버를 종료하고 새 서버를 시작한다", async () => {
  const script = await fs.readFile(path.join(projectRoot, "start-withbid-ppbm.ps1"), "utf8");
  assert.match(script, /\$running\.version -ne \$installedVersion/);
  assert.match(script, /서버 버전.*설치 버전.*서버를 다시 시작합니다/);
  assert.match(script, /Stop-Process -Id \$listener\.OwningProcess/);
  assert.match(script, /\$installerPath, "-Silent"/);
});
