import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { quoteWorkbookBuffer, reportToDashboardHtml } from "../src/lib/result-artifacts.js";

const notice={noticeNumber:"R1",title:"PC <구매>",organization:"수요기관",deadline:"2026-08-01"};
const extraction={budget:1100000,uncertainties:["확인 필요"]};
const report={decision:"조건부 참가",summary:"단가 확인 필요",qualificationReview:["소기업"],risks:["가격 미확인"],checklist:["단가표 확인"],configuration:[{category:"데스크탑 컴퓨터 본체 사양 1",requirement:"완제품",selectedModel:"완제품 모델",unitPrice:3000000,quantity:4,source:"상품 링크",status:"제외",specificationGroup:"본체사양 1",unitQuantity:1,systemQuantity:4,priceRole:"complete_system"},{category:"CPU 사양 1",requirement:"Ultra 7",selectedModel:"265K",unitPrice:100000,quantity:4,source:"company_price_list",status:"확인",specificationGroup:"본체사양 1",unitQuantity:1,systemQuantity:4,priceRole:"component"},{category:"메모리 사양 1",requirement:"DDR5 32GB",selectedModel:"DDR5",unitPrice:50000,quantity:8,source:"company_price_list",status:"확인",specificationGroup:"본체사양 1",unitQuantity:2,systemQuantity:4,priceRole:"component"},{category:"CPU 사양 2",requirement:"Ultra 5",selectedModel:"225",unitPrice:80000,quantity:5,source:"company_price_list",status:"확인",specificationGroup:"본체사양 2",unitQuantity:1,systemQuantity:5,priceRole:"component"}]};

test("참가 판단 대시보드는 안전한 HTML과 핵심 정보를 만든다",()=>{const html=reportToDashboardHtml(notice,report,extraction);assert.match(html,/입찰참가판단/);assert.match(html,/조건부 참가/);assert.match(html,/PC &lt;구매&gt;/);});
test("견적서는 사양별 부품 시트와 통합 합계를 만든다",async()=>{const buffer=await quoteWorkbookBuffer(notice,report,extraction,12);const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(buffer);assert.deepEqual(workbook.worksheets.map(s=>s.name),["통합견적","본체사양 1","본체사양 2","검토사항"]);const detail=workbook.getWorksheet("본체사양 1");assert.equal(detail.getCell("A10").value,"CASE");assert.equal(detail.getCell("E10").value,null);assert.equal(detail.getCell("A12").value,"CPU");assert.equal(detail.getCell("E14").value,2);assert.equal(detail.getCell("F30").formula,'IF(COUNT(F10:F29)=0,"",SUM(F10:F29))');assert.equal(detail.getCell("F31").formula,'IF(OR(F30="",E4="",F34>0),"",F30*E4)');const summary=workbook.getWorksheet("통합견적");assert.equal(summary.getCell("A10").value,"본체사양 1");assert.equal(summary.getCell("C10").formula,"'본체사양 1'!F30");assert.equal(summary.getCell("A11").value,"본체사양 2");assert.match(summary.getCell("E13").formula,/SUM\(H10:H11\)=0/);assert.doesNotMatch(JSON.stringify(workbook.model),/완제품 모델/);});

test("서버의 서로 다른 SSD 용량은 같은 M.2 위치에 연속 행으로 작성하고 데스크탑 기본비는 넣지 않는다",async()=>{
  const serverReport={...report,configuration:[
    {category:"CPU",requirement:"Xeon",selectedModel:"Xeon",unitPrice:null,quantity:2,source:"",status:"단가 미확인",specificationGroup:"GPU 서버",unitQuantity:2,systemQuantity:1,priceRole:"component"},
    {category:"RAM",requirement:"DDR5 ECC",selectedModel:"RAM",unitPrice:1,quantity:2,source:"",status:"확인",specificationGroup:"GPU 서버",unitQuantity:2,systemQuantity:1,priceRole:"component"},
    {category:"M.2",requirement:"NVMe U.2 1.92TB",selectedModel:"SSD 1.92TB",unitPrice:1,quantity:1,source:"",status:"확인",specificationGroup:"GPU 서버",unitQuantity:1,systemQuantity:1,priceRole:"component"},
    {category:"M.2",requirement:"NVMe U.2 15.36TB",selectedModel:"SSD 15.36TB",unitPrice:2,quantity:1,source:"",status:"확인",specificationGroup:"GPU 서버",unitQuantity:1,systemQuantity:1,priceRole:"component"},
    {category:"VGA",requirement:"RTX",selectedModel:"RTX",unitPrice:3,quantity:4,source:"",status:"확인",specificationGroup:"GPU 서버",unitQuantity:4,systemQuantity:1,priceRole:"component"},
  ]};
  const buffer=await quoteWorkbookBuffer(notice,serverReport,extraction,12);
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(buffer);
  const detail=workbook.getWorksheet("GPU 서버");
  assert.equal(detail.getCell("A15").value,"M.2");
  assert.equal(detail.getCell("B15").value,"NVMe U.2 1.92TB");
  assert.equal(detail.getCell("A16").value,"M.2");
  assert.equal(detail.getCell("B16").value,"NVMe U.2 15.36TB");
  const values=[];detail.eachRow((row)=>values.push(...row.values));
  assert.ok(!values.includes("데스크탑 입가공비"));
});
