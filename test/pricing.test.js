import test from "node:test";
import assert from "node:assert/strict";
import { buildExternalSearches, coreModelKeywords, normalizePriceRows, rankCompanyPrices, scoreModelMatch } from "../src/lib/pricing.js";

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

test("외부 검색은 컴퓨존 다음 가이드컴 순이다", () => {
  const searches = buildExternalSearches({ model:"Intel i5" });
  assert.deepEqual(searches.map((item) => item.sourceType), ["compuzone", "guidecom"]);
});

test("부품명에서 핵심 검색 키워드를 추출한다",()=>{
  assert.deepEqual(coreModelKeywords("[Colorful] 지포스 RTX 5060 GAMING DUO D7 8GB 피씨디렉트"),["RTX5060","D7","8GB"]);
  assert.deepEqual(coreModelKeywords("마이크로닉스 Classic II 850W 80PLUS GOLD"),["850W","80PLUS","GOLD"]);
  assert.deepEqual(coreModelKeywords("[PATRIOT] DDR5 PC5-48000 CL30 [16GB] (6000)"),["DDR5-48000","16GB"]);
});

test("동일 모델이 아니어도 핵심 키워드 일치율을 계산한다",()=>{
  const result=scoreModelMatch("인텔 코어 Ultra 5 프로세서 225 정품벌크","INTEL Ultra 5 225 애로우레이크 정품");
  assert.equal(result.matchScore,100); assert.deepEqual(result.matchedKeywords,["ULTRA5","225"]);
});
