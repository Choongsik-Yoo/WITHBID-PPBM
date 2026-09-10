import test from "node:test";
import assert from "node:assert/strict";
import { buildVerifiedQuotePlan, verifyExtraction } from "../src/lib/verified-quote.js";

const blocks = [
  {id:"B1",location:"규격서 p.1",text:"본체사양 1 납품수량 4대"},
  {id:"B2",location:"규격서 p.2",text:"CPU: Intel Core Ultra 5 225, 1대당 1개"},
  {id:"B3",location:"규격서 p.2",text:"SSD: NVMe 1TB 이상"},
];

function rawRequirement(overrides = {}) {
  return {
    id:"REQ-CPU",
    category:"CPU",
    condition:"Intel Core Ultra 5 225",
    quantity:4,
    evidence:"CPU: Intel Core Ultra 5 225, 1대당 1개",
    evidenceBlockIds:["B1", "B2"],
    specificationGroup:"본체사양 1",
    unitQuantity:1,
    systemQuantity:4,
    priceRole:"component",
    constraints:[],
    searchKeywords:["Ultra 5 225"],
    confidence:0.95,
    ...overrides,
  };
}

test("원문에 근거한 수량과 사양 그룹을 검증해 견적 행으로 전달한다", () => {
  const extraction = verifyExtraction({requirements:[rawRequirement()],uncertainties:[]}, blocks, {score:45,mode:"enhanced_prose",reasons:[]});
  assert.equal(extraction.requirements[0].verificationStatus, "verified");
  assert.equal(extraction.requirements[0].unitQuantity, 1);
  assert.equal(extraction.requirements[0].systemQuantity, 4);
  assert.equal(extraction.requirements[0].quantity, 4);
});

test("저장용량 숫자를 부품 수량으로 오인하지 않는다", () => {
  const extraction = verifyExtraction({requirements:[rawRequirement({
    id:"REQ-SSD",
    category:"SSD",
    condition:"NVMe 1TB",
    quantity:null,
    evidence:"SSD: NVMe 1TB 이상",
    evidenceBlockIds:["B3"],
    unitQuantity:1,
    systemQuantity:null,
    searchKeywords:["NVMe", "1TB"],
  })],uncertainties:[]}, blocks, {score:40,mode:"enhanced_prose",reasons:[]});
  assert.equal(extraction.requirements[0].unitQuantity, null);
  assert.equal(extraction.requirements[0].quantity, null);
});

test("완제품은 제외하고 자사 단가표 후보를 우선 선택한다", () => {
  const extraction = verifyExtraction({requirements:[
    rawRequirement({id:"REQ-SYSTEM",category:"본체사양 1",condition:"완제품 PC",evidence:"본체사양 1 납품수량 4대",evidenceBlockIds:["B1"],unitQuantity:null,priceRole:"complete_system"}),
    rawRequirement(),
  ],uncertainties:[]}, blocks, {score:80,mode:"structured",reasons:[]});
  const plan = buildVerifiedQuotePlan(extraction, [
    {requirementId:"REQ-CPU",model:"외부 후보",unitPrice:100000,source:"컴퓨존",matchScore:100,matchType:"exact"},
    {requirementId:"REQ-CPU",model:"자사 후보",unitPrice:120000,source:"company_price_list",matchScore:80,matchType:"keyword"},
  ]);
  assert.deepEqual(plan.configuration.map((item) => item.category), ["CPU"]);
  assert.equal(plan.configuration[0].selectedModel, "자사 후보");
  assert.equal(plan.configuration[0].unitPrice, 120000);
});

test("판매가격을 못 찾아도 규격서의 정확 모델과 규격 후보를 공란으로 두지 않는다",()=>{
  const extraction={requirements:[
    {...rawRequirement(),specifiedModel:"Intel Xeon 6960P",verificationStatus:"verified"},
    {...rawRequirement({id:"REQ-CASE",category:"CASE",condition:"5U 랙마운트 서버 섀시"}),specifiedModel:null,selectionLabel:"CASE 규격 후보 (5U · RACKMOUNT)",verificationStatus:"verified"},
  ]};
  const plan=buildVerifiedQuotePlan(extraction,[]);
  assert.equal(plan.configuration[0].selectedModel,"Intel Xeon 6960P");
  assert.match(plan.configuration[0].status,/규격서 명시 모델/);
  assert.equal(plan.configuration[1].selectedModel,"CASE 규격 후보 (5U · RACKMOUNT)");
});
