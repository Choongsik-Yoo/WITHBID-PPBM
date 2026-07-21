import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { quoteWorkbookBuffer, reportToDashboardHtml } from "../src/lib/result-artifacts.js";

const notice={noticeNumber:"R1",title:"PC <구매>",organization:"수요기관",deadline:"2026-08-01"};
const extraction={budget:1100000,uncertainties:["확인 필요"]};
const report={decision:"조건부 참가",summary:"단가 확인 필요",qualificationReview:["소기업"],risks:["가격 미확인"],checklist:["단가표 확인"],configuration:[{category:"CPU",requirement:"Ultra 7",selectedModel:"265K",unitPrice:100000,quantity:2,source:"company_price_list",status:"확인"}]};

test("참가 판단 대시보드는 안전한 HTML과 핵심 정보를 만든다",()=>{const html=reportToDashboardHtml(notice,report,extraction);assert.match(html,/입찰참가판단/);assert.match(html,/조건부 참가/);assert.match(html,/PC &lt;구매&gt;/);});
test("견적서에는 계산식과 검토 시트가 포함된다",async()=>{const buffer=await quoteWorkbookBuffer(notice,report,extraction,12);const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(buffer);assert.deepEqual(workbook.worksheets.map(s=>s.name),["견적서","검토사항"]);assert.equal(workbook.getWorksheet("견적서").getCell("F10").formula,'IF(OR(D10="",E10=""),0,D10*E10)');});
