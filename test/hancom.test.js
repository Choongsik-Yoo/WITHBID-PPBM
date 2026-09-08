import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { convertHancomAttachments,pdfNameForHancom } from "../src/lib/hancom.js";

const projectRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");

test("HWP와 HWPX 파일명은 변환 PDF 이름으로 바뀐다",()=>{assert.equal(pdfNameForHancom("규격서.hwp"),"규격서_변환.pdf");assert.equal(pdfNameForHancom("사양서.HWPX"),"사양서_변환.pdf");});
test("한컴 첨부를 PDF 버퍼로 변환하고 임시파일 잠금 오류는 무시한다",async()=>{const convertFile=async(_input,output)=>fs.writeFile(output,Buffer.from("%PDF-1.7\nmock"));const cleanupTemp=async()=>{throw Object.assign(new Error("busy"),{code:"EBUSY"})};const result=await convertHancomAttachments([{filename:"규격서.hwp",buffer:Buffer.from("hwp")}],{scriptPath:"mock.ps1",convertFile,cleanupTemp});assert.equal(result.errors.length,0);assert.equal(result.converted[0].filename,"규격서_변환.pdf");assert.equal(result.converted[0].convertedFrom,"규격서.hwp");});
test("압축 폴더 안 한컴 문서는 같은 상대 폴더의 PDF 이름을 유지한다",async()=>{const convertFile=async(_input,output)=>fs.writeFile(output,Buffer.from("%PDF-1.7\nmock"));const result=await convertHancomAttachments([{filename:"붙임자료/규격서.hwp",buffer:Buffer.from("hwp")}],{scriptPath:"mock.ps1",convertFile});assert.equal(result.errors.length,0);assert.equal(result.converted[0].filename,"붙임자료/규격서_변환.pdf");});
test("한컴 변환은 신버전 문서 경고창을 표시하지 않도록 연다",async()=>{const script=await fs.readFile(path.join(projectRoot,"scripts","convert-hancom-to-pdf.ps1"),"utf8");assert.match(script,/SetMessageBoxMode\(\[int\]0x00214411\)/);assert.match(script,/versionwarning:false/);assert.match(script,/lock:false/);});
