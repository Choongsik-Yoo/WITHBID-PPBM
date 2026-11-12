import test from "node:test";
import assert from "node:assert/strict";
import { buildExternalSearches, coreModelKeywords, normalizePriceRows, rankCompanyPrices, scoreModelMatch } from "../src/lib/pricing.js";
import { buildCompatibilityContext, evaluateCandidateCompatibility, sortRequirementsForPricing } from "../src/lib/compatibility.js";

test("단가표 한글 열을 표준 구조로 변환한다", () => {
  const items = normalizePriceRows([{ 구분:"CPU", 모델명:"Intel i5-14500", 제조사부품번호:"BX8071514500", 매입단가:"285,000원", 재고상태:"보유" }]);
  assert.equal(items[0].unitPrice, 285000);
  assert.equal(items[0].sourceType, "company_price_list");
});

test("부품번호 정확 일치를 최우선한다", () => {
  const items = normalizePriceRows([
    { 구분:"CPU", 모델명:"비슷한 모델", 제조사부품번호:"ABC", 매입단가:200 },
    { 구분:"CPU", 모델명:"다른 이름", 제조사부품번호:"TARGET", 매입단가:300 },
  ]);
  assert.equal(rankCompanyPrices(items, { category:"CPU", mpn:"TARGET" })[0].mpn, "TARGET");
});

test("카테고리만 같고 핵심 모델 정보가 없으면 자사 단가로 선택하지 않는다", () => {
  const items = normalizePriceRows([
    { 구분:"CPU", 모델명:"Intel i3-12100", 매입단가:100000 },
    { 구분:"RAM", 모델명:"DDR5-48000 16GB", 매입단가:80000 },
  ]);
  assert.deepEqual(rankCompanyPrices(items, {category:"CPU",model:"Ultra 5 225"}), []);
  assert.equal(rankCompanyPrices(items, {category:"RAM",model:"DDR5-48000 16GB"})[0].category, "RAM");
});

test("외부 검색은 컴퓨존, 가이드컴 다음 다나와 순이다", () => {
  const searches = buildExternalSearches({ model:"Intel i5" });
  assert.deepEqual(searches.map((item) => item.sourceType), ["compuzone", "guidecom", "danawa"]);
  assert.match(searches[2].searchUrl, /^https:\/\/search\.danawa\.com\/dsearch\.php\?query=/);
});

test("가격 조사는 사양 그룹별 CPU부터 운영체제와 기타 순으로 정렬한다",()=>{
  const requirements=[
    {id:"case",category:"CASE",specificationGroup:"본체사양 1"},
    {id:"ram",category:"RAM",specificationGroup:"본체사양 1"},
    {id:"cpu",category:"CPU",specificationGroup:"본체사양 1"},
    {id:"os",category:"운영체제",specificationGroup:"본체사양 1"},
    {id:"other",category:"NIC",specificationGroup:"본체사양 1"},
  ];
  assert.deepEqual(sortRequirementsForPricing(requirements).map((item)=>item.id),["cpu","ram","case","os","other"]);
});

test("선행 부품과 소켓·메모리·전력 규격이 충돌하는 후보를 제외한다",()=>{
  const context=buildCompatibilityContext([
    {requirement:{category:"CPU"},model:"AMD Ryzen 7 소켓 AM5 DDR5"},
    {requirement:{category:"MAINBOARD"},model:"B650 M-ATX 소켓 AM5 DDR5"},
    {requirement:{category:"VGA"},model:"RTX 5070 권장 파워 750W"},
  ],"본체사양 1");
  assert.equal(evaluateCandidateCompatibility({category:"RAM"},{model:"DDR4 32GB"},context).compatibilityStatus,"incompatible");
  assert.equal(evaluateCandidateCompatibility({category:"POWER"},{model:"정격 650W 80PLUS GOLD"},context).compatibilityStatus,"incompatible");
  const items=normalizePriceRows([{구분:"RAM",모델명:"DDR4 32GB",규격:"DDR4",매입단가:100000}]);
  assert.deepEqual(rankCompanyPrices(items,{requirement:{category:"RAM"},category:"RAM",model:"32GB",compatibilityContext:context}),[]);
});

test("케이스는 선정 GPU 길이와 CPU 쿨러 높이를 모두 수용해야 한다",()=>{
  const context=buildCompatibilityContext([
    {requirement:{category:"MAINBOARD"},model:"E-ATX 메인보드"},
    {requirement:{category:"VGA"},model:"RTX GPU 길이 330mm 권장 파워 750W"},
    {requirement:{category:"CPU 쿨러"},model:"공랭 쿨러 높이 165mm"},
  ],"본체사양 1");
  assert.equal(evaluateCandidateCompatibility({category:"CASE"},{model:"ATX 케이스 그래픽카드 최대 300mm CPU 쿨러 최대 160mm"},context).compatibilityStatus,"incompatible");
  assert.equal(evaluateCandidateCompatibility({category:"CASE"},{model:"E-ATX TOWER 그래픽카드 최대 400mm CPU 쿨러 최대 180mm"},context).compatibilityStatus,"compatible");
});

test("기본 조립 케이스는 E-ATX 요구를 충족하고 파워는 요구 효율등급 이상이어야 한다",()=>{
  assert.equal(evaluateCandidateCompatibility({category:"CASE",condition:"TOWER형 ATX·E-ATX 지원"},{model:"ATX 미들타워 케이스"},{}).compatibilityStatus,"incompatible");
  assert.equal(evaluateCandidateCompatibility({category:"CASE",condition:"TOWER형 ATX·E-ATX 지원"},{model:"E-ATX 빅타워 케이스"},{}).compatibilityStatus,"compatible");
  assert.equal(evaluateCandidateCompatibility({category:"POWER",condition:"80PLUS GOLD 이상"},{model:"850W 80PLUS PLATINUM"},{}).compatibilityStatus,"compatible");
  assert.equal(evaluateCandidateCompatibility({category:"POWER",condition:"80PLUS GOLD 이상"},{model:"850W 80PLUS BRONZE"},{}).compatibilityStatus,"incompatible");
});

test("부품명에서 핵심 검색 키워드를 추출한다",()=>{
  assert.deepEqual(coreModelKeywords("[Colorful] 지포스 RTX 5060 GAMING DUO D7 8GB 피씨디렉트"),["RTX5060","D7","8GB"]);
  assert.deepEqual(coreModelKeywords("마이크로닉스 Classic II 850W 80PLUS GOLD"),["850W","80PLUS","GOLD"]);
  assert.deepEqual(coreModelKeywords("[PATRIOT] DDR5 PC5-48000 CL30 [16GB] (6000)"),["DDR5-48000","16GB"]);
  assert.deepEqual(coreModelKeywords("DDR5-5600MHz 32GB ECC PCIe Gen4"),["DDR5-5600","32GB","PCIE4","ECC"]);
});

test("동일 모델이 아니어도 핵심 키워드 일치율을 계산한다",()=>{
  const result=scoreModelMatch("인텔 코어 Ultra 5 프로세서 225 정품벌크","INTEL Ultra 5 225 애로우레이크 정품");
  assert.equal(result.matchScore,100); assert.deepEqual(result.matchedKeywords,["ULTRA5","225"]);
});

test("카테고리 이름만 같은 무관한 자사 품목은 자동 선택하지 않는다",()=>{
  const items=normalizePriceRows([{구분:"CPU",모델명:"Intel Xeon Gold 6430",매입단가:1000}]);
  assert.equal(rankCompanyPrices(items,{category:"CPU",model:"Intel Core Ultra 5 225"}).length,0);
});

test("핵심 사양이 일치해도 다른 부품 카테고리는 제외한다",()=>{
  const items=normalizePriceRows([
    {구분:"RAM",모델명:"DDR5 6000 16GB",매입단가:100},
    {구분:"SSD",모델명:"DDR5 6000 16GB 표기 오류",매입단가:50},
  ]);
  const result=rankCompanyPrices(items,{category:"RAM",model:"DDR5 PC5-48000 16GB",searchKeywords:["DDR5-48000","16GB"]});
  assert.deepEqual(result.map((item)=>item.category),["RAM"]);
});
