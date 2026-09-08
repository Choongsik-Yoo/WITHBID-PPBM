import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");

test("온라인 설치 EXE는 버전별 GitHub 파일을 해시 검증 후 설치한다",async()=>{
  const source=await fs.readFile(path.join(projectRoot,"installer","WITHBID-PPBM-Online-Setup.cs"),"utf8");
  assert.match(source,/releases\/download\/v/);
  assert.match(source,/__APP_ZIP_SHA256__/);
  assert.match(source,/__INSTALLER_SHA256__/);
  assert.match(source,/VerifySha256\(appZip/);
  assert.match(source,/VerifySha256\(installerScript/);
});

test("Windows 패키지 빌드는 GUI 온라인 설치 EXE를 생성한다",async()=>{
  const script=await fs.readFile(path.join(projectRoot,"scripts","build-windows-package.ps1"),"utf8");
  assert.match(script,/WITHBID-PPBM-Online-Setup-\{0\}\.exe/);
  assert.match(script,/\/target:winexe/);
  assert.match(script,/function Get-Sha256Hex/);
  assert.match(script,/Security\.Cryptography\.SHA256/);
});
