import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const appSource = await fs.readFile(new URL("../public/app.js", import.meta.url), "utf8");

test("비동기 폼 처리 후에도 보존한 form 참조로 입력값을 초기화한다", () => {
  assert.doesNotMatch(appSource, /event\.currentTarget\.reset\s*\(/);
  assert.match(appSource, /#userForm[\s\S]*?const form\s*=\s*event\.currentTarget;[\s\S]*?form\.reset\(\)/);
  assert.match(appSource, /#noticeForm[\s\S]*?const form\s*=\s*event\.currentTarget;[\s\S]*?form\.reset\(\)/);
});
