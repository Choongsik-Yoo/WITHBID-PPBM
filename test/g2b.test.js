import test from "node:test"; import assert from "node:assert/strict"; import { parseG2bLink,attachmentUrl } from "../src/lib/g2b.js";
test("실제 나라장터 링크에서 공고번호와 차수를 읽는다",()=>assert.deepEqual(parseG2bLink("https://www.g2b.go.kr/link/PNPE027_01/single/?bidPbancNo=R26BK01640471&bidPbancOrd=000"),{bidPbancNo:"R26BK01640471",bidPbancOrd:"000"}));
test("첨부정보에서 URL을 찾는다",()=>assert.equal(attachmentUrl({atchFileUrl:"https://g2b.go.kr/file"}),"https://g2b.go.kr/file"));
