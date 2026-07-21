import test from "node:test"; import assert from "node:assert/strict"; import { extractNoticeNumber,htmlToText } from "../src/lib/web-source.js";
test("링크에서 공고번호를 찾는다",()=>assert.equal(extractNoticeNumber("https://x.test/?bid=202607123456"),"202607123456"));
test("HTML 본문을 정리한다",()=>assert.equal(htmlToText("<h1>공고</h1><script>x()</script><p>내용</p>"),"공고 내용"));
