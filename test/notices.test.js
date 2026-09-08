import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { archiveNoticeFolder, createNotice, ensureNoticeFolder, updateNoticeDetails } from "../src/lib/notices.js";

const noticeInput={noticeNumber:"R26BK01713210",title:"워크스테이션 구매",organization:"중앙대학교",deadline:"2026-09-09 10:00:00",sourceUrl:"https://example.com"};

test("동일 공고의 기존 폴더가 남아 있으면 재분석 전용 폴더를 만든다",async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"withbid-notice-repeat-"));
  try{
    const first=await createNotice(root,noticeInput);
    const second=await createNotice(root,noticeInput);
    assert.notEqual(second.folderName,first.folderName);
    assert.match(second.folderName,/_재분석_2$/);
    assert.equal((await fs.stat(path.join(root,"진행중",second.folderName))).isDirectory(),true);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});

test("누락된 공고 폴더와 필수 하위폴더를 다시 생성한다",async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"withbid-notice-ensure-"));
  try{
    const notice={...noticeInput,id:"test",status:"분석중",folderName:"20260909_R26BK01713210_중앙대학교_워크스테이션 구매"};
    await ensureNoticeFolder(root,notice);
    assert.equal((await fs.stat(path.join(root,"진행중",notice.folderName,"02_첨부파일"))).isDirectory(),true);
    assert.equal((await fs.stat(path.join(root,"진행중",notice.folderName,"06_분석결과"))).isDirectory(),true);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});

test("임시 공고 폴더를 공식 공고정보 이름으로 변경한다",async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"withbid-notice-update-"));
  try{
    const notice=await createNotice(root,{noticeNumber:"R26BK01713210",title:"공고정보 조회 중",organization:"기관 확인 중",deadline:"2026-09-08",status:"분석중"});
    const oldFolder=notice.folderName;
    await updateNoticeDetails(root,notice,noticeInput);
    assert.notEqual(notice.folderName,oldFolder);
    await assert.rejects(fs.stat(path.join(root,"진행중",oldFolder)),{code:"ENOENT"});
    assert.equal((await fs.stat(path.join(root,"진행중",notice.folderName))).isDirectory(),true);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});

test("삭제한 공고 폴더는 복구 가능한 종료 폴더로 이동한다",async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"withbid-notice-delete-"));
  try{
    const notice=await createNotice(root,noticeInput);
    const archived=await archiveNoticeFolder(root,notice,new Date("2026-09-08T01:02:03Z"));
    assert.match(archived.destination,new RegExp(`${path.sep === "\\" ? "\\\\" : "/"}종료`));
    await assert.rejects(fs.stat(archived.source),{code:"ENOENT"});
    assert.equal((await fs.stat(archived.destination)).isDirectory(),true);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
