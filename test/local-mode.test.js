import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getConfig } from "../src/config.js";
import { ensureLocalAdmin } from "../src/lib/auth.js";
import { createSettingsStore } from "../src/lib/secure-settings.js";

const projectRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");

test("관리자 로컬 모드는 D드라이브 저장경로와 지정 관리자를 사용한다",()=>{
  const config=getConfig({
    STORAGE_MODE:"local_admin",
    DATA_ROOT:"D:\\입찰관리",
    NAS_ROOT:"\\\\Withusnas1\\입찰관리",
    LOCAL_ADMIN_EMAIL:"CSYOO22@GMAIL.COM",
  });
  assert.equal(config.storageMode,"local_admin");
  assert.equal(config.localAdminMode,true);
  assert.equal(config.localAdminEmail,"csyoo22@gmail.com");
  assert.match(config.dataRoot,/D:\\입찰관리$/i);
});

test("로컬 관리자 계정은 기존 사용자 설정과 관계없이 관리자 권한으로 보장한다",()=>{
  const users=ensureLocalAdmin([
    {name:"기존 사용자",email:"member@example.com",role:"member"},
    {name:"관리자",email:"csyoo22@gmail.com",role:"member",enabled:false},
  ],"csyoo22@gmail.com");
  assert.deepEqual(users[0],{name:"관리자",email:"csyoo22@gmail.com",role:"admin",enabled:true});
  assert.equal(users[1].email,"member@example.com");
});

test("관리자 로컬 설정의 비밀 필드는 평문이 아닌 보호값으로 저장한다",async()=>{
  const testRoot=path.join(projectRoot,".auth-test-data");
  await fs.mkdir(testRoot,{recursive:true});
  const root=await fs.mkdtemp(path.join(testRoot,"withbid-local-settings-"));
  const file=path.join(root,"openai.json");
  const store=createSettingsStore({
    protectedMode:true,
    protect:async(value)=>`dpapi:v1:${Buffer.from(value).toString("base64")}`,
    unprotect:async(value)=>Buffer.from(value.slice("dpapi:v1:".length),"base64").toString("utf8"),
  });
  await store.write(file,{apiKey:"secret-api-key",extractionModel:"model"},["apiKey"]);
  const raw=await fs.readFile(file,"utf8");
  assert.doesNotMatch(raw,/secret-api-key/);
  assert.match(raw,/dpapi:v1:/);
  assert.deepEqual(await store.read(file,{},["apiKey"]),{apiKey:"secret-api-key",extractionModel:"model"});
  await fs.rm(root,{recursive:true,force:true});
});

test("Windows 실행기는 NAS 실패 시 동의를 받고 관리자 로컬 모드 환경을 전달한다",async()=>{
  const launcher=await fs.readFile(path.join(projectRoot,"start-withbid-ppbm.ps1"),"utf8");
  assert.match(launcher,/Show-LocalModePrompt/);
  assert.match(launcher,/MessageBoxResult\]::Yes/);
  assert.match(launcher,/D:\\입찰관리/);
  assert.match(launcher,/STORAGE_MODE = \$storageMode/);
  assert.match(launcher,/LOCAL_ADMIN_EMAIL = \$localAdminEmail/);
  assert.match(launcher,/자동 동기화되지 않습니다/);
});

test("웹 화면은 관리자 로컬 저장 모드와 NAS 미동기화 경고를 지속 표시한다",async()=>{
  const [html,app]=await Promise.all([
    fs.readFile(path.join(projectRoot,"public","index.html"),"utf8"),
    fs.readFile(path.join(projectRoot,"public","app.js"),"utf8"),
  ]);
  assert.match(html,/관리자 로컬 모드 · NAS 미연결/);
  assert.match(html,/자동 동기화되지 않습니다/);
  assert.match(app,/local_admin/);
  assert.match(app,/관리자 로컬 저장/);
});
