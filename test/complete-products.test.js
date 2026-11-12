import test from "node:test";
import assert from "node:assert/strict";
import { applyCompleteProductStrategy, detectCompleteProductType } from "../src/lib/complete-products.js";
import { completeCompatibilityRequirements } from "../src/lib/requirement-refinement.js";

const requirement = (id, category, condition, overrides = {}) => ({
  id, category, condition, quantity:40, evidence:condition, evidenceBlockIds:[id], evidenceLocations:["규격서 p.1"],
  specificationGroup:"GPU 탑재 노트북", unitQuantity:1, systemQuantity:40, priceRole:"component",
  constraints:[], searchKeywords:[], confidence:0.95, verificationStatus:"verified", evidenceStatus:"verified",
  ...overrides,
});

test("노트북 사양은 부품 가격 대신 단일 완제품 검색 요구사항으로 합친다", () => {
  const extraction = applyCompleteProductStrategy({title:"GPU 탑재 노트북 구매",requirements:[
    requirement("SYSTEM","노트북","GPU 탑재 노트북 40대",{priceRole:"complete_system"}),
    requirement("CPU","CPU","AMD Ryzen 9 8945HX 이상"),
    requirement("GPU","VGA","NVIDIA GeForce RTX 5070 Ti Laptop GPU 12GB 이상"),
    requirement("RAM","RAM","DDR5 32GB 이상"),
    requirement("SSD","M.2","NVMe M.2 SSD 1TB 이상"),
    requirement("DISPLAY","디스플레이","16인치 2560 x 1600 240Hz 이상",{priceRole:"peripheral"}),
    requirement("SERVICE","납품설치","전 수량 정상작동 검사",{priceRole:"service"}),
  ]});
  const complete = extraction.requirements.find((item) => item.productSearchMode === "complete_product");
  assert.equal(complete.completeProductType,"laptop");
  assert.equal(complete.category,"노트북 완제품");
  assert.equal(complete.systemQuantity,40);
  assert.equal(complete.unitQuantity,1);
  assert.match(complete.condition,/RTX 5070 Ti Laptop/);
  assert.ok(complete.searchProfile.requiredKeywords.includes("RTX5070"));
  assert.equal(extraction.requirements.find((item) => item.id === "CPU").includedInCompleteProduct,true);
  assert.equal(extraction.requirements.find((item) => item.id === "SERVICE").includedInCompleteProduct,undefined);
});

test("서버 완제품 그룹에는 조립 부품 누락 보완행을 추가하지 않는다", () => {
  const extraction = applyCompleteProductStrategy({title:"고성능 GPU 서버 구매",requirements:[
    requirement("CPU","CPU","Intel Xeon 6960P 2개",{specificationGroup:"고성능 GPU 서버",quantity:2,unitQuantity:2,systemQuantity:1}),
    requirement("GPU","VGA","RTX PRO 6000 4개",{specificationGroup:"고성능 GPU 서버",quantity:4,unitQuantity:4,systemQuantity:1}),
    requirement("RAM","RAM","DDR5 ECC 64GB 2개",{specificationGroup:"고성능 GPU 서버",quantity:2,unitQuantity:2,systemQuantity:1}),
  ]});
  const completed = completeCompatibilityRequirements(extraction);
  assert.equal(detectCompleteProductType({group:"고성능 GPU 서버",title:extraction.title,items:extraction.requirements}),"server");
  assert.equal(completed.requirements.filter((item) => item.productSearchMode === "complete_product").length,1);
  assert.equal(completed.requirements.some((item) => item.derivedFromCompatibility),false);
});

test("조립형 데스크탑 사양은 기존 부품 견적 방식을 유지한다", () => {
  const extraction = applyCompleteProductStrategy({title:"데스크탑 컴퓨터 구매",requirements:[
    requirement("CPU","CPU","Ultra 5 225",{specificationGroup:"본체사양 1",systemQuantity:10,quantity:10}),
    requirement("RAM","RAM","DDR5 16GB",{specificationGroup:"본체사양 1",systemQuantity:10,quantity:20,unitQuantity:2}),
  ]});
  assert.equal(extraction.requirements.some((item) => item.productSearchMode === "complete_product"),false);
});
