import path from "node:path";
import { createRequire } from "node:module";
import { normalizePriceRows } from "./pricing.js";

const require = createRequire(import.meta.url);

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"' && quoted && text[index + 1] === '"') { field += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(field); field = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field); field = "";
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
    } else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const headers = rows.shift() || [];
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header.trim(), values[index] ?? ""])));
}

export async function parsePriceList(buffer, filename) {
  const extension = path.extname(filename).toLowerCase();
  let rows;
  if (extension === ".csv") {
    rows = parseCsv(buffer.toString("utf8").replace(/^\uFEFF/, ""));
  } else if ([".xlsx", ".xls"].includes(extension)) {
    const ExcelJS = require("exceljs");
    const workbook = new ExcelJS.Workbook();
    if (extension === ".xls") {
      throw new Error("보안을 위해 구형 XLS는 지원하지 않습니다. Excel에서 XLSX 또는 CSV로 저장해 주세요.");
    }
    await workbook.xlsx.load(buffer);
    rows = [];
    workbook.eachSheet((worksheet) => {
      const headers = [];
      worksheet.getRow(1).eachCell({ includeEmpty: true }, (cell, column) => { headers[column] = String(cell.text || "").trim(); });
      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const value = {};
        headers.forEach((header, column) => { if (header) value[header] = row.getCell(column).text; });
        rows.push(value);
      });
    });
  } else {
    throw new Error("CSV, XLSX 또는 XLS 형식만 지원합니다.");
  }
  return normalizePriceRows(rows);
}
