import ExcelJS from "exceljs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const componentPattern = /CPU|프로세서|메인보드|마더보드|RAM|메모리|DDR[345]|SSD|NVMe|M\.2|HDD|그래픽|GPU|VGA|RTX|파워|전원공급|PSU|케이스|쿨러|운영체제|Windows/i;
const componentLabelPattern = /(?:^|[\n|;])\s*(?:[-*ㅇ■]\s*)?(?:CPU|프로세서|메인보드|마더보드|RAM|메모리|SSD|M\.2|HDD|그래픽(?:카드)?|GPU|VGA|파워(?:서플라이)?|전원공급장치|PSU|케이스|CPU\s*쿨러|운영체제)\s*[:：-]/i;
const groupPattern = /(?:본체|컴퓨터|PC|서버|워크스테이션)?\s*사양\s*\d+|본체\s*\d+|교사용|학생용/i;
const quantityPattern = /\b\d+(?:\.\d+)?\s*(?:대|개|식|세트|SET|EA|본|조|라이선스)\b/i;

function cleanText(value) {
  return String(value || "").replace(/\u0000/g, "").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

function safeId(value) {
  return String(value || "DOC").normalize("NFKC").replace(/[^0-9A-Za-z가-힣]+/g, "-").replace(/^-|-$/g, "").slice(0, 38) || "DOC";
}

function textParagraphs(text) {
  const normalized = String(text || "").replace(/\r\n?/g, "\n");
  const paragraphs = normalized.split(/\n\s*\n+/).flatMap((paragraph) => {
    const value = cleanText(paragraph);
    if (!value) return [];
    if (value.length <= 500) return [value];
    return value.split(/(?<=[.!?다요함됨임])\s+(?=[가-힣A-Z0-9(【\[])/).map(cleanText).filter(Boolean);
  });
  return paragraphs;
}

function pdfLines(items) {
  const rows = [];
  for (const item of items) {
    const text = cleanText(item.str);
    if (!text) continue;
    const x = Number(item.transform?.[4] || 0);
    const y = Number(item.transform?.[5] || 0);
    let row = rows.find((candidate) => Math.abs(candidate.y - y) <= 2.2);
    if (!row) {
      row = { y, items: [] };
      rows.push(row);
    }
    row.items.push({ x, text });
  }
  return rows
    .sort((a, b) => b.y - a.y)
    .map((row) => cleanText(row.items.sort((a, b) => a.x - b.x).map((item) => item.text).join(" ")))
    .filter(Boolean);
}

async function pdfBlocks(file, fileIndex) {
  const blocks = [];
  const task = getDocument({ data: new Uint8Array(file.buffer), useSystemFonts: true, isEvalSupported: false, verbosity: 0 });
  const pdf = await task.promise;
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const lines = pdfLines(content.items);
      lines.forEach((text, lineIndex) => blocks.push({
        id: `PDF-${fileIndex + 1}-P${pageNumber}-L${lineIndex + 1}`,
        sourceFile: file.filename,
        kind: "pdf_line",
        page: pageNumber,
        line: lineIndex + 1,
        location: `${file.filename} p.${pageNumber} line ${lineIndex + 1}`,
        text,
      }));
    }
  } finally {
    await pdf.destroy();
  }
  return blocks;
}

function cellText(cell) {
  if (cell.value == null) return "";
  if (typeof cell.text === "string" && cell.text.trim()) return cleanText(cell.text);
  if (typeof cell.value === "object" && cell.value.result != null) return cleanText(cell.value.result);
  return cleanText(cell.value);
}

async function xlsxBlocks(file, fileIndex) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(file.buffer);
  const blocks = [];
  workbook.worksheets.forEach((sheet, sheetIndex) => {
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const values = [];
      let firstColumn = null;
      let lastColumn = null;
      row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
        const text = cellText(cell);
        if (!text) return;
        firstColumn ??= columnNumber;
        lastColumn = columnNumber;
        values.push(`${cell.address}=${text}`);
      });
      if (!values.length) return;
      const start = sheet.getCell(rowNumber, firstColumn).address;
      const end = sheet.getCell(rowNumber, lastColumn).address;
      blocks.push({
        id: `XLSX-${fileIndex + 1}-S${sheetIndex + 1}-R${rowNumber}`,
        sourceFile: file.filename,
        kind: "xlsx_row",
        sheet: sheet.name,
        row: rowNumber,
        location: `${file.filename} ${sheet.name}!${start}:${end}`,
        text: values.join(" | "),
      });
    });
  });
  return blocks;
}

function noticeBlocks(sourceText) {
  return textParagraphs(sourceText).map((text, index) => ({
    id: `NOTICE-P${index + 1}`,
    sourceFile: "공고페이지.txt",
    kind: "notice_paragraph",
    paragraph: index + 1,
    location: `공고페이지 문단 ${index + 1}`,
    text,
  }));
}

function uniqueFilesForBlocks(files) {
  const originalExcel = new Set(files.filter((file) => /\.xlsx$/i.test(file.filename)).map((file) => file.filename.toLowerCase()));
  return files.filter((file) => {
    if (!/\.pdf$/i.test(file.filename) && !/\.xlsx$/i.test(file.filename)) return false;
    if (/\.pdf$/i.test(file.filename) && file.convertedFrom && /\.xlsx$/i.test(file.convertedFrom)) {
      return !originalExcel.has(String(file.convertedFrom).toLowerCase());
    }
    return true;
  });
}

export async function extractDocumentBlocks({ sourceText = "", files = [] } = {}) {
  const blocks = noticeBlocks(sourceText);
  const errors = [];
  const candidates = uniqueFilesForBlocks(files);
  for (let index = 0; index < candidates.length; index += 1) {
    const file = candidates[index];
    try {
      if (/\.pdf$/i.test(file.filename)) blocks.push(...await pdfBlocks(file, index));
      else if (/\.xlsx$/i.test(file.filename)) blocks.push(...await xlsxBlocks(file, index));
    } catch (error) {
      errors.push({ filename: file.filename, error: error.message });
    }
  }
  return { blocks, errors };
}

export function assessDocumentStructure(blocks = []) {
  const meaningful = blocks.filter((block) => cleanText(block.text));
  const technical = meaningful.filter((block) => componentPattern.test(block.text));
  const labeled = meaningful.filter((block) => componentLabelPattern.test(block.text));
  const tabular = meaningful.filter((block) => block.kind === "xlsx_row" || /\|/.test(block.text));
  const grouped = meaningful.filter((block) => groupPattern.test(block.text));
  const quantities = meaningful.filter((block) => quantityPattern.test(block.text));
  const longTechnical = technical.filter((block) => block.text.length > 280 && (block.text.match(/CPU|RAM|SSD|HDD|GPU|VGA|파워|메모리|그래픽/gi) || []).length >= 3);
  let score = 35;
  score += Math.min(20, labeled.length * 3);
  score += Math.min(15, tabular.length * 2);
  score += Math.min(12, grouped.length * 3);
  score += Math.min(10, quantities.length * 2);
  score -= Math.min(30, longTechnical.length * 10);
  if (technical.length && !labeled.length) score -= 15;
  score = Math.max(0, Math.min(100, score));
  const mode = score >= 70 ? "structured" : "enhanced_prose";
  return {
    score,
    mode,
    blockCount: meaningful.length,
    technicalBlockCount: technical.length,
    labeledComponentBlockCount: labeled.length,
    tabularBlockCount: tabular.length,
    groupHintCount: grouped.length,
    quantityBlockCount: quantities.length,
    longMixedTechnicalBlockCount: longTechnical.length,
    reasons: [
      ...(technical.length && !labeled.length ? ["부품 사양이 있으나 명시적 항목 라벨이 부족함"] : []),
      ...(longTechnical.length ? ["여러 부품 사양이 긴 문장에 함께 포함됨"] : []),
      ...(!quantities.length ? ["납품 또는 부품 수량 표현이 부족함"] : []),
      ...(!grouped.length && technical.length ? ["사양 그룹 경계가 명확하지 않음"] : []),
    ],
  };
}

export function buildBlockManifest(blocks = [], assessment = {}) {
  const maxBlocks = 1600;
  const maxChars = 420_000;
  const lines = [
    "[문서 구조 분석 정보]",
    `분석 모드: ${assessment.mode || "enhanced_prose"}`,
    `구조 점수: ${assessment.score ?? "미측정"}`,
    "아래 각 줄의 [ID]와 원문을 사용하고, 모든 요구사항에 근거 block ID를 기록하세요.",
  ];
  let length = lines.join("\n").length;
  const selectedIndexes = new Set();
  if (blocks.length > maxBlocks) {
    blocks.forEach((block, index) => {
      const important = componentPattern.test(block.text)
        || groupPattern.test(block.text)
        || quantityPattern.test(block.text)
        || block.kind === "xlsx_row";
      if (!important) return;
      for (const neighbor of [index - 1, index, index + 1]) {
        if (neighbor >= 0 && neighbor < blocks.length) selectedIndexes.add(neighbor);
      }
    });
  }
  for (let index = 0; index < blocks.length && selectedIndexes.size < maxBlocks; index += 1) {
    selectedIndexes.add(index);
  }
  const selected = blocks.length > maxBlocks
    ? [...selectedIndexes].sort((left, right) => left - right).slice(0, maxBlocks).map((index) => blocks[index])
    : blocks;
  for (const block of selected) {
    const text = cleanText(block.text).slice(0, 2500);
    const line = `[${block.id}] (${block.location}) ${text}`;
    if (length + line.length > maxChars) break;
    lines.push(line);
    length += line.length;
  }
  return lines.join("\n");
}

export function normalizeEvidenceText(value) {
  return cleanText(value).normalize("NFKC").toLowerCase().replace(/[^0-9a-z가-힣]+/g, "");
}

export function documentBlockId(value) {
  return safeId(value);
}
