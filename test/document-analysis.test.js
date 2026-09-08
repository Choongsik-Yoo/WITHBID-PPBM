import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import {
  assessDocumentStructure,
  buildBlockManifest,
  extractDocumentBlocks,
} from "../src/lib/document-analysis.js";

test("표형 규격서와 장문형 규격서의 분석 모드를 구분한다", () => {
  const structured = ["CASE", "MAINBOARD", "CPU", "CPU 쿨러", "RAM", "SSD", "POWER", "GPU"].map((name, index) => ({
    id:"S" + (index + 1),
    kind:"xlsx_row",
    text:"본체사양 1 | " + name + ": 요구사양 | 수량 " + (index + 1) + "개",
  }));
  const prose = [{
    id:"P1",
    kind:"pdf_line",
    text:"본 장비는 CPU 프로세서와 메인보드, RAM DDR5 메모리, SSD NVMe 저장장치, GPU 그래픽카드 및 파워 전원공급장치를 포함하며 각각의 세부 조건은 이어지는 문장을 모두 충족해야 한다.".repeat(3),
  }];
  assert.equal(assessDocumentStructure(structured).mode, "structured");
  assert.equal(assessDocumentStructure(prose).mode, "enhanced_prose");
});

test("공고 문단과 Excel 셀을 추적 가능한 원문 블록으로 만든다", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("본체사양 1");
  sheet.addRow(["구분", "요구사양", "수량"]);
  sheet.addRow(["CPU", "Ultra 5 225 이상", 4]);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const result = await extractDocumentBlocks({
    sourceText:"공고번호 R1\n\n납품수량은 4대입니다.",
    files:[{filename:"규격서.xlsx",buffer}],
  });
  assert.equal(result.errors.length, 0);
  assert.ok(result.blocks.some((block) => block.id === "NOTICE-P2" && /4대/.test(block.text)));
  assert.ok(result.blocks.some((block) => block.kind === "xlsx_row" && /Ultra 5 225/.test(block.text) && /본체사양 1!/.test(block.location)));
});

test("긴 문서에서도 뒤쪽의 기술 사양 블록을 AI 입력에 보존한다", () => {
  const blocks = Array.from({length:1700}, (_, index) => ({
    id:"B" + (index + 1),
    kind:"pdf_line",
    location:"p." + (index + 1),
    text:index === 1699 ? "본체사양 2 CPU: Ultra 7 265K, 수량 5대" : "일반 계약조건 " + (index + 1),
  }));
  const manifest = buildBlockManifest(blocks, {mode:"enhanced_prose",score:40});
  assert.match(manifest, /\[B1700\].*Ultra 7 265K/);
});
