import test from "node:test";
import assert from "node:assert/strict";
import { createSession, normalizeUsers, readSession, verifyGoogleCredential } from "../src/lib/auth.js";

const approvedUsers=normalizeUsers([
  {name:"관리자",email:"admin@example.com",role:"admin",enabled:true},
  {name:"담당자",email:"member@example.com",role:"member",enabled:true},
]);

test("승인 사용자 목록은 이메일을 정규화하고 역할을 보존한다",()=>{
  assert.deepEqual(approvedUsers[0],{name:"관리자",email:"admin@example.com",role:"admin",enabled:true});
  assert.equal(approvedUsers[1].role,"member");
});

test("서명 세션은 승인된 활성 사용자만 복원한다",()=>{
  const user=approvedUsers[1];const token=createSession(user,"test-secret",1000);
  assert.equal(readSession(token,"test-secret",approvedUsers,2000).email,user.email);
  assert.equal(readSession(`${token}x`,"test-secret",approvedUsers,2000),null);
  assert.equal(readSession(token,"test-secret",normalizeUsers([{...user,enabled:false}]),2000),null);
});

test("Google ID 토큰의 대상 클라이언트와 인증 이메일을 검사한다",async()=>{
  const fetchImpl=async()=>({ok:true,json:async()=>({aud:"client.apps.googleusercontent.com",email_verified:true,email:"ADMIN@example.com",name:"관리자"})});
  const profile=await verifyGoogleCredential("token","client.apps.googleusercontent.com",fetchImpl);
  assert.equal(profile.email,"admin@example.com");
  await assert.rejects(()=>verifyGoogleCredential("token","wrong-client",fetchImpl),/이 앱용/);
});
