import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { parsePriceList } from "../src/lib/price-list.js";

const require = createRequire(import.meta.url);

test("CSV company price list를 읽는다", async () => {
  const buffer = Buffer.from("구분,모델명,매입단가\nCPU,테스트 CPU,123000\n", "utf8");
  const rows = await parsePriceList(buffer, "prices.csv");
  assert.equal(rows[0].model, "테스트 CPU");
  assert.equal(rows[0].unitPrice, 123000);
});

test("XLSX company price list를 읽는다", async () => {
  const ExcelJS = require("exceljs");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("단가표");
  sheet.addRow(["구분", "모델명", "제조사부품번호", "매입단가"]);
  sheet.addRow(["SSD", "테스트 SSD", "SSD-001", 77000]);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const rows = await parsePriceList(buffer, "prices.xlsx");
  assert.equal(rows[0].mpn, "SSD-001");
  assert.equal(rows[0].unitPrice, 77000);
});
