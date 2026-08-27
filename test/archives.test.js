import test from "node:test";
import assert from "node:assert/strict";
import { expandZipAttachments, safeArchiveEntryPath } from "../src/lib/archives.js";

test("압축 내부 경로 탈출과 절대경로를 차단한다",()=>{
  assert.equal(safeArchiveEntryPath("규격/본문.hwp"),"규격/본문.hwp");
  assert.equal(safeArchiveEntryPath("../비밀.txt"),null);
  assert.equal(safeArchiveEntryPath("C:\\Windows\\비밀.txt"),null);
});

test("ZIP 첨부를 별도 폴더로 풀어 분석 파일 목록에 추가한다",async()=>{
  const openArchive=async()=>({files:[{path:"사양/규격서.hwp",type:"File",buffer:async()=>Buffer.from("hwp")},{path:"빈폴더/",type:"Directory",buffer:async()=>Buffer.alloc(0)}]});
  const original={filename:"입찰 붙임자료.zip",buffer:Buffer.from("PK\u0003\u0004")};
  const result=await expandZipAttachments([original],{openArchive});
  assert.equal(result.errors.length,0);
  assert.equal(result.extracted[0].filename,"입찰 붙임자료/사양/규격서.hwp");
  assert.equal(result.files.length,2);
});
