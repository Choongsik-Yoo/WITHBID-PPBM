import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { convertHancomAttachments,pdfNameForHancom } from "../src/lib/hancom.js";

test("HWP와 HWPX 파일명은 변환 PDF 이름으로 바뀐다",()=>{assert.equal(pdfNameForHancom("규격서.hwp"),"규격서_변환.pdf");assert.equal(pdfNameForHancom("사양서.HWPX"),"사양서_변환.pdf");});
test("한컴 첨부를 PDF 버퍼로 변환한다",async()=>{const convertFile=async(_input,output)=>fs.writeFile(output,Buffer.from("%PDF-1.7\nmock"));const result=await convertHancomAttachments([{filename:"규격서.hwp",buffer:Buffer.from("hwp")}],{scriptPath:"mock.ps1",convertFile});assert.equal(result.errors.length,0);assert.equal(result.converted[0].filename,"규격서_변환.pdf");assert.equal(result.converted[0].convertedFrom,"규격서.hwp");});
