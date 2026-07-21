import test from "node:test";
import assert from "node:assert/strict";
import { noticeFolderName, safeName } from "../src/lib/files.js";

test("Windows 금지문자를 안전한 문자로 바꾼다", () => {
  assert.equal(safeName('A/B:C*D?E"F<G>H|I'), "A_B_C_D_E_F_G_H_I");
});

test("공고 폴더명은 마감일과 공고번호를 보존한다", () => {
  assert.equal(noticeFolderName({ deadline:"2026-08-05", noticeNumber:"2026/123", organization:"경기도교육청", title:"업무용 PC 구매" }), "20260805_2026_123_경기도교육청_업무용 PC 구매");
});
