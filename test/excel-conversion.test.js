import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { convertExcelAttachments, pdfNameForExcel } from "../src/lib/excel.js";

test("Excel 파일명은 변환 PDF 이름으로 바뀐다", () => {
  assert.equal(pdfNameForExcel("물품내역.xlsx"), "물품내역_변환.pdf");
  assert.equal(pdfNameForExcel("산출표.XLSM"), "산출표_변환.pdf");
});

test("Excel 첨부를 PDF 버퍼로 변환한다", async () => {
  const convertFile = async (_input, output) => fs.writeFile(output, Buffer.from("%PDF-1.7\nmock"));
  const result = await convertExcelAttachments([{ filename: "물품내역.xlsx", buffer: Buffer.from("xlsx") }], { scriptPath: "mock.ps1", convertFile });
  assert.equal(result.errors.length, 0);
  assert.equal(result.converted[0].filename, "물품내역_변환.pdf");
  assert.equal(result.converted[0].convertedFrom, "물품내역.xlsx");
});

test("압축 폴더 안 Excel 문서는 같은 상대 폴더의 PDF 이름을 유지한다", async () => {
  const convertFile = async (_input, output) => fs.writeFile(output, Buffer.from("%PDF-1.7\nmock"));
  const result = await convertExcelAttachments([{ filename: "붙임자료/구입내역.xls", buffer: Buffer.from("xls") }], { scriptPath: "mock.ps1", convertFile });
  assert.equal(result.errors.length, 0);
  assert.equal(result.converted[0].filename, "붙임자료/구입내역_변환.pdf");
});
