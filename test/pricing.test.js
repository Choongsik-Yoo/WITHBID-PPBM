import test from "node:test";
import assert from "node:assert/strict";
import { buildExternalSearches, normalizePriceRows, rankCompanyPrices } from "../src/lib/pricing.js";

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
