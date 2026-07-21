import fs from "node:fs/promises";
import path from "node:path";
import { getConfig } from "../src/config.js";
import { readJson } from "../src/lib/files.js";
import { quoteWorkbookBuffer, reportToDashboardHtml } from "../src/lib/result-artifacts.js";

const config=getConfig();
const state=await readJson(path.join(config.dataRoot,"_데이터베이스","app-state.json"),{notices:[]});
for(const notice of state.notices){
  const base=path.join(config.dataRoot,"진행중",notice.folderName,"06_분석결과");
  const structured=path.join(config.dataRoot,"진행중",notice.folderName,"04_구조화데이터","AI_추출결과.json");
  const [report,extraction]=await Promise.all([readJson(path.join(base,"AI_판단결과.json"),null),readJson(structured,{})]);
  if(!report) continue;
  await fs.writeFile(path.join(base,"입찰참가판단_대시보드.html"),reportToDashboardHtml(notice,report,extraction),"utf8");
  await fs.writeFile(path.join(base,"견적서.xlsx"),Buffer.from(await quoteWorkbookBuffer(notice,report,extraction,12)));
  console.log(`${notice.noticeNumber}: 대시보드와 견적서 저장 완료`);
}
