import test from "node:test";
import assert from "node:assert/strict";
import { completeCompatibilityRequirements, refineExtractedRequirements } from "../src/lib/requirement-refinement.js";
import { buildVerifiedQuotePlan, verifyExtraction } from "../src/lib/verified-quote.js";

function requirement(overrides = {}) {
  return {
    id:"REQ-1", category:"M.2", condition:"NVMe U.2 SSD 2개를 제공하며 1.92TB 1개와 15.36TB 1개로 구성",
    quantity:2, evidence:"NVMe U.2 SSD 2개를 제공하며 1.92TB 1개와 15.36TB 1개로 구성", evidenceBlockIds:["B1"],
    specificationGroup:"고성능 GPU 서버", unitQuantity:2, systemQuantity:1, priceRole:"component", constraints:[], searchKeywords:[], confidence:0.9,
    ...overrides,
  };
}

test("한 문장에 서로 다른 용량의 저장장치가 있으면 독립 견적행으로 분리한다",()=>{
  const extraction=refineExtractedRequirements({requirements:[requirement({searchKeywords:["NVMe U.2", "1.92TB", "15.36TB"]})]});
  assert.deepEqual(extraction.requirements.map((item)=>item.condition),["NVMe U.2 SSD 1.92TB","NVMe U.2 SSD 15.36TB"]);
  assert.deepEqual(extraction.requirements.map((item)=>item.unitQuantity),[1,1]);
  assert.deepEqual(extraction.requirements.map((item)=>item.id),["REQ-1-1","REQ-1-2"]);
  assert.ok(!extraction.requirements[0].searchProfile.requiredKeywords.includes("15.36TB"));
  assert.ok(!extraction.requirements[1].searchProfile.requiredKeywords.includes("1.92TB"));
});

test("정확 CPU 모델은 가격 미확인 때 사용할 명시 모델로 보존한다",()=>{
  const extraction=refineExtractedRequirements({requirements:[requirement({category:"CPU",condition:"서버 전용 CPU Intel Xeon 6960P 또는 동급 이상",evidence:"Intel Xeon 6960P 또는 동급 이상"})]});
  assert.equal(extraction.requirements[0].specifiedModel,"Intel Xeon 6960P");
  assert.deepEqual(extraction.requirements[0].searchProfile.requiredKeywords.slice(0,2),["XEON","6960P"]);
});

test("GPU 서버 이행조건과 운영체제를 VGA 부품으로 오분류하지 않는다",()=>{
  const extraction=refineExtractedRequirements({requirements:[
    requirement({id:"OS",category:"VGA",condition:"Ubuntu Linux LTS 설치 및 GPU 소프트웨어 환경 제공",evidence:"Ubuntu Linux LTS 설치"}),
    requirement({id:"TEST",category:"VGA",condition:"GPU 정상 작동 검증 후 결과 보고서를 제출",evidence:"GPU 정상 작동 검증"}),
  ]});
  assert.equal(extraction.requirements[0].category,"운영체제(O/S)");
  assert.equal(extraction.requirements[0].priceRole,"software");
  assert.equal(extraction.requirements[1].priceRole,"non_price");
});

test("부품형 서버 사양에 빠진 메인보드와 쿨러는 호환 구성 보완항목으로 만든다",()=>{
  const base={requirements:[
    requirement({id:"CPU",category:"CPU",condition:"Intel Xeon 6960P",specifiedModel:"Intel Xeon 6960P",unitQuantity:2,quantity:2}),
    requirement({id:"RAM",category:"RAM",condition:"DDR5 ECC RDIMM 64GB",unitQuantity:2,quantity:2}),
    requirement({id:"GPU",category:"VGA",condition:"RTX PRO 6000 96GB",unitQuantity:4,quantity:4}),
  ]};
  const completed=completeCompatibilityRequirements(base);
  const derived=completed.requirements.filter((item)=>item.derivedFromCompatibility);
  assert.ok(derived.some((item)=>item.category==="MAINBOARD"));
  assert.ok(derived.some((item)=>item.category==="CPU 쿨러"));
  assert.equal(derived.find((item)=>item.category==="CPU 쿨러").unitQuantity,2);
  assert.ok(derived.every((item)=>item.priceSearchAllowed));
});

test("GPU 서버 문장형 사양을 정밀화하면 정확 모델·복수 SSD·호환 보완부품이 견적에 남는다",()=>{
  const sourceRequirements=[
    requirement({id:"SYSTEM",category:"VGA",condition:"고성능 GPU 서버 1식을 연구개발 용도로 납품하여야 한다",evidence:"고성능 GPU 서버 1식을 연구개발 용도로 납품하여야 한다",priceRole:"component",unitQuantity:1,quantity:1}),
    requirement({id:"CASE",category:"CASE",condition:"GPU 서버 본체는 5U 랙마운트 섀시이어야 한다",evidence:"GPU 서버 본체는 5U 랙마운트 섀시이어야 한다",unitQuantity:1,quantity:1}),
    requirement({id:"CPU",category:"CPU",condition:"서버 전용 고성능 CPU 2개, Intel Xeon 6960P 또는 동급 이상",evidence:"서버 전용 고성능 CPU 2개, Intel Xeon 6960P 또는 동급 이상",unitQuantity:2,quantity:2}),
    requirement({id:"RAM",category:"RAM",condition:"DDR5 64GB ECC Registered DIMM 메모리 2개",evidence:"DDR5 64GB ECC Registered DIMM 메모리 2개",unitQuantity:2,quantity:2}),
    requirement(),
    requirement({id:"GPU",category:"VGA",condition:"NVIDIA RTX PRO 6000 Blackwell Server Edition D7 96GB 4개",evidence:"NVIDIA RTX PRO 6000 Blackwell Server Edition D7 96GB 4개",unitQuantity:4,quantity:4}),
    requirement({id:"POWER",category:"POWER",condition:"2700W Redundant Titanium Level 전원공급장치 6개",evidence:"2700W Redundant Titanium Level 전원공급장치 6개",unitQuantity:6,quantity:6}),
    requirement({id:"VERIFY",category:"VGA",condition:"GPU 정상 작동 검증 후 결과 보고서를 제출",evidence:"GPU 정상 작동 검증 후 결과 보고서를 제출",priceRole:"component",unitQuantity:null,quantity:null}),
  ];
  const blocks=sourceRequirements.map((item,index)=>({id:`B${index+1}`,location:`규격서 p.${index+1}`,text:item.evidence}));
  sourceRequirements.forEach((item,index)=>{item.evidenceBlockIds=[`B${index+1}`];});
  const refined=refineExtractedRequirements({requirements:sourceRequirements,uncertainties:[]});
  const verified=verifyExtraction(refined,blocks,{score:40,mode:"enhanced_prose",reasons:[]});
  const completed=completeCompatibilityRequirements(verified);
  const plan=buildVerifiedQuotePlan(completed,[]);
  assert.equal(plan.configuration.filter((item)=>item.category==="M.2").length,2);
  assert.equal(plan.configuration.find((item)=>item.category==="CPU").selectedModel,"Intel Xeon 6960P");
  assert.equal(plan.configuration.find((item)=>item.category==="CPU").quantity,2);
  assert.ok(plan.configuration.some((item)=>item.category==="MAINBOARD"&&item.derivedFromCompatibility));
  assert.ok(plan.configuration.some((item)=>item.category==="CPU 쿨러"&&item.derivedFromCompatibility));
  assert.ok(!plan.configuration.some((item)=>item.requirement.includes("결과 보고서")));
  assert.ok(!plan.configuration.some((item)=>item.priceRole==="service"));
});
