import test from "node:test";
import assert from "node:assert/strict";
import { buildOpalBundle } from "../src/lib/opal.js";

test("Opal 입력문에 공고와 자사 단가 우선 규칙을 포함한다", () => {
  const bundle = buildOpalBundle({
    notice: { noticeNumber:"N-1", title:"컴퓨터 구매", organization:"기관", deadline:"2026-08-05" },
    sourceText: "CPU는 14코어 이상",
    certificationText: "ISO9001 | 보유",
    targetMargin: 15,
    priceItems: [{ category:"CPU", model:"i5", unitPrice:285000, stock:"보유" }],
  });
  assert.match(bundle, /N-1/);
  assert.match(bundle, /목표 마진율: 15%/);
  assert.match(bundle, /자사 단가표를 최우선/);
  assert.match(bundle, /285000/);
});
