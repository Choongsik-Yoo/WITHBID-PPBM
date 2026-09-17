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

test("표 형식 규격서처럼 단위어 없는 독립 수량도 근거로 인정한다", () => {
  const tableBlocks = [{id:"T1", location:"규격서 p.1", text:"11 COOLER AIO 360MM LIQUID COOLER 1 동급 교체 가능"}];
  const extraction = verifyExtraction({requirements:[rawRequirement({
    id:"REQ-COOLER", category:"CPU 쿨러", condition:"AIO 360MM LIQUID COOLER",
    evidence:"COOLER AIO 360MM LIQUID COOLER 1 동급 교체 가능", evidenceBlockIds:["T1"],
    unitQuantity:1, systemQuantity:1, quantity:1, searchKeywords:["AIO 360MM"],
  })],uncertainties:[]}, tableBlocks, {score:60,mode:"structured",reasons:[]});
  assert.equal(extraction.requirements[0].unitQuantity, 1);
  assert.equal(extraction.requirements[0].systemQuantity, 1);
});

test("RMT 지원 여부처럼 존재 유무만 묻는 문장은 같은 위치의 부품에 병합하고 별도 견적행을 만들지 않는다", () => {
  const ramBlocks = [
    {id:"R1", location:"규격서 p.3", text:"RAM : 128GB (4x32GB) DDR5 5600 DIMM ECC REG"},
    {id:"R2", location:"규격서 p.3", text:"메모리 : RMT(Reliable Memory Technology) 제공 가능"},
  ];
  const extraction = verifyExtraction({requirements:[
    rawRequirement({
      id:"REQ-RAM", category:"RAM", condition:"128GB (4x32GB) DDR5 5600 DIMM ECC REG",
      evidence:"RAM : 128GB (4x32GB) DDR5 5600 DIMM ECC REG", evidenceBlockIds:["R1"],
      unitQuantity:1, systemQuantity:3, quantity:3, constraints:[], searchKeywords:["DDR5", "5600"],
    }),
    rawRequirement({
      id:"REQ-RMT", category:"RAM", condition:"RMT(Reliable Memory Technology)를 제공할 수 있어야 함",
      evidence:"메모리 : RMT(Reliable Memory Technology) 제공 가능", evidenceBlockIds:["R2"],
      unitQuantity:null, systemQuantity:null, quantity:null,
      constraints:[{field:"RMT 지원", operator:"exists", value:"true", unit:null}], searchKeywords:["RMT"],
    }),
  ],uncertainties:[]}, ramBlocks, {score:60,mode:"structured",reasons:[]});
  assert.equal(extraction.requirements.filter((item) => item.category === "RAM").length, 1);
  assert.match(extraction.requirements[0].evidence, /RMT/);
  assert.ok(extraction.requirements[0].constraints.some((item) => item.field === "RMT 지원"));
});

test("구조화되지 않은 규격서에서 같은 GPU의 스펙을 나열한 여러 행은 모델이 확정된 VGA 행에 병합한다", () => {
  const vgaBlocks = [
    {id:"V1", location:"규격서 p.3", text:"NVIDIA RTX PRO 6000 Blackwell Server Edition 1개 장착"},
    {id:"V2", location:"규격서 p.3", text:"GPU 메모리 96GB GDDR7, 512-bit, 대역폭 1.6TB/s"},
    {id:"V3", location:"규격서 p.3", text:"CUDA 코어 24,064개"},
  ];
  const extraction = verifyExtraction({requirements:[
    rawRequirement({
      id:"REQ-GPU", category:"VGA", condition:"NVIDIA RTX PRO 6000 Blackwell Server Edition 1개 장착",
      evidence:"NVIDIA RTX PRO 6000 Blackwell Server Edition 1개 장착", evidenceBlockIds:["V1"],
      specifiedModel:"NVIDIA RTX PRO 6000 Blackwell Server Edition",
      unitQuantity:1, systemQuantity:1, quantity:1, constraints:[], searchKeywords:["RTX PRO 6000"],
    }),
    rawRequirement({
      id:"REQ-GPU-MEM", category:"VGA", condition:"GPU 메모리 96GB GDDR7, 512-bit, 대역폭 1.6TB/s",
      evidence:"GPU 메모리 96GB GDDR7, 512-bit, 대역폭 1.6TB/s", evidenceBlockIds:["V2"],
      unitQuantity:null, systemQuantity:null, quantity:null,
      constraints:[{field:"메모리", operator:"==", value:"96", unit:"GB"}], searchKeywords:["96GB"],
    }),
    rawRequirement({
      id:"REQ-GPU-CUDA", category:"VGA", condition:"CUDA 코어 24,064개",
      evidence:"CUDA 코어 24,064개", evidenceBlockIds:["V3"],
      unitQuantity:null, systemQuantity:null, quantity:null,
      constraints:[{field:"CUDA 코어", operator:"==", value:"24064", unit:"개"}], searchKeywords:["CUDA"],
    }),
  ],uncertainties:[]}, vgaBlocks, {score:60,mode:"structured",reasons:[]});
  const vgaItems = extraction.requirements.filter((item) => item.category === "VGA");
  assert.equal(vgaItems.length, 1);
  assert.equal(vgaItems[0].specifiedModel, "NVIDIA RTX PRO 6000 Blackwell Server Edition");
  assert.ok(vgaItems[0].constraints.some((item) => item.field === "메모리"));
  assert.ok(vgaItems[0].constraints.some((item) => item.field === "CUDA 코어"));
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

test("가격 후보를 못 찾아도 가격 출처에 수동 확인용 검색 링크를 채운다",()=>{
  const extraction={requirements:[
    {...rawRequirement(),specifiedModel:"Intel Xeon 6960P",verificationStatus:"verified"},
  ]};
  const plan=buildVerifiedQuotePlan(extraction,[]);
  assert.match(plan.configuration[0].source,/^https:\/\/.*compuzone/);
  assert.match(plan.configuration[0].status,/검색으로 수동 확인 필요/);
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
