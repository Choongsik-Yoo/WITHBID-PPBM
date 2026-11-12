import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");

test("상단 사용자 옆에 버전번호와 배포일 배지를 표시한다",async()=>{
  const [html,app,styles,server]=await Promise.all([
    fs.readFile(path.join(projectRoot,"public","index.html"),"utf8"),
    fs.readFile(path.join(projectRoot,"public","app.js"),"utf8"),
    fs.readFile(path.join(projectRoot,"public","styles.css"),"utf8"),
    fs.readFile(path.join(projectRoot,"src","server.js"),"utf8"),
  ]);
  assert.match(html,/id="currentUser"[\s\S]*id="appVersion"/);
  assert.match(app,/v\$\{value\.version\}/);
  assert.match(app,/value\.versionDate/);
  assert.match(styles,/\.version-badge/);
  assert.match(server,/versionDate:"\d{4}-\d{2}-\d{2}"/);
});
