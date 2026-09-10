import test from "node:test";
import assert from "node:assert/strict";
import { decodeArchiveEntryPath, expandZipAttachments, safeArchiveEntryPath } from "../src/lib/archives.js";

test("압축 내부 경로 탈출과 절대경로를 차단한다",()=>{
  assert.equal(safeArchiveEntryPath("규격/본문.hwp"),"규격/본문.hwp");
  assert.equal(safeArchiveEntryPath("../비밀.txt"),null);
  assert.equal(safeArchiveEntryPath("C:\\Windows\\비밀.txt"),null);
});

test("ZIP 첨부를 하위폴더 없이 첨부파일 목록에 추가한다",async()=>{
  const openArchive=async()=>({files:[{path:"사양/규격서.hwp",type:"File",buffer:async()=>Buffer.from("hwp")},{path:"빈폴더/",type:"Directory",buffer:async()=>Buffer.alloc(0)}]});
  const original={filename:"입찰 붙임자료.zip",buffer:Buffer.from("PK\u0003\u0004")};
  const result=await expandZipAttachments([original],{openArchive});
  assert.equal(result.errors.length,0);
  assert.equal(result.extracted[0].filename,"규격서.hwp");
  assert.equal(result.extracted[0].archivePath,"사양/규격서.hwp");
  assert.equal(result.files.length,2);
});

test("UTF-8 표시가 없는 국내 ZIP의 CP949 한글 파일명을 복원한다",async()=>{
  const cp949Name=Buffer.from([0xb1,0xd4,0xb0,0xdd,0xbc,0xad,0x2e,0x68,0x77,0x70]);
  const entry={path:cp949Name.toString("utf8"),pathBuffer:cp949Name,isUnicode:false,type:"File",buffer:async()=>Buffer.from("hwp")};
  assert.equal(decodeArchiveEntryPath(entry),"규격서.hwp");
  const result=await expandZipAttachments([{filename:"붙임.zip",buffer:Buffer.from("PK\u0003\u0004")}],{openArchive:async()=>({files:[entry]})});
  assert.equal(result.extracted[0].filename,"규격서.hwp");
});

test("동일한 파일명은 평면 폴더에서 덮어쓰지 않도록 번호를 붙인다",async()=>{
  const openArchive=async()=>({files:[
    {path:"사양1/규격서.hwp",type:"File",buffer:async()=>Buffer.from("one")},
    {path:"사양2/규격서.hwp",type:"File",buffer:async()=>Buffer.from("two")},
  ]});
  const result=await expandZipAttachments([{filename:"붙임.zip",buffer:Buffer.from("PK\u0003\u0004")}],{openArchive});
  assert.deepEqual(result.extracted.map(file=>file.filename),["규격서.hwp","규격서_2.hwp"]);
});

test("ZIP 컨테이너 형식인 HWPX와 XLSX는 일반 압축파일처럼 풀지 않는다",async()=>{
  let opened=0;
  const files=[
    {filename:"규격서.hwpx",buffer:Buffer.from("PK\u0003\u0004")},
    {filename:"구매내역.xlsx",buffer:Buffer.from("PK\u0003\u0004")},
  ];
  const result=await expandZipAttachments(files,{openArchive:async()=>{opened+=1;return{files:[]};}});
  assert.equal(opened,0);
  assert.equal(result.extracted.length,0);
  assert.equal(result.files.length,2);
});
