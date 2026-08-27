import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getConfig } from "./config.js";
import { ensureDataLayout, readJson, safeName, sha256, writeJson } from "./lib/files.js";
import { parsePriceList } from "./lib/price-list.js";
import { buildExternalSearches, rankCompanyPrices } from "./lib/pricing.js";
import { createNotice } from "./lib/notices.js";
import { buildOpalBundle } from "./lib/opal.js";
import { analyzeBid, extractNotice, findExternalPrices, redactSettings, reportToMarkdown } from "./lib/openai.js";
import { inferredSpecificationGroup, isPriceableRequirement } from "./lib/quote-structure.js";
import { extractNoticeNumber, fetchNoticePage } from "./lib/web-source.js";
import { attachmentName, attachmentUrl, fetchG2bNotice, g2bToText, parseG2bLink } from "./lib/g2b.js";
import { quoteWorkbookBuffer, reportToDashboardHtml } from "./lib/result-artifacts.js";
import { convertHancomAttachments } from "./lib/hancom.js";
import { expandZipAttachments } from "./lib/archives.js";
import { cookieValue, createSession, newSecret, normalizeUsers, readSession, verifyGoogleCredential } from "./lib/auth.js";

const config = getConfig();
const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const publicRoot = path.join(appRoot, "public");
const hancomConverterScript=path.join(appRoot,"scripts","convert-hancom-to-pdf.ps1");
const stateFile = path.join(config.dataRoot, "_데이터베이스", "app-state.json");
const openaiSettingsFile = path.join(config.dataRoot, "_설정", "openai.json");
const g2bSettingsFile = path.join(config.dataRoot, "_설정", "g2b.json");
const authSettingsFile = path.join(config.dataRoot, "_설정", "auth.json");
const authorizedUsersFile = process.env.AUTHORIZED_USERS_FILE || path.join(appRoot,"config","authorized-users.local.json");
const progressJobs=new Map();
function updateProgress(jobId,percent,stage,message,status="running"){if(!jobId)return;progressJobs.set(jobId,{jobId,percent,stage,message,status,updatedAt:new Date().toISOString()});setTimeout(()=>progressJobs.delete(jobId),30*60*1000).unref();}

await ensureDataLayout(config.dataRoot);
const initialAuth = await readJson(authSettingsFile, {});
const seededUsers = await readJson(authorizedUsersFile, []);
await writeJson(authSettingsFile, {
  clientId:String(process.env.GOOGLE_CLIENT_ID || initialAuth.clientId || "").trim(),
  sessionSecret:initialAuth.sessionSecret || newSecret(),
  users:Array.isArray(initialAuth.users) ? normalizeUsers(initialAuth.users) : normalizeUsers(seededUsers),
});

function json(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

async function bodyBuffer(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > config.maxUploadBytes) throw new Error("업로드 파일은 30MB를 넘을 수 없습니다.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function bodyJson(request) {
  const buffer = await bodyBuffer(request);
  return buffer.length ? JSON.parse(buffer.toString("utf8")) : {};
}

async function loadState() {
  return readJson(stateFile, { notices: [], priceList: { items: [], importedAt: null, filename: null } });
}

async function saveState(state) {
  await writeJson(stateFile, state);
}

async function loadAuthSettings() {
  const value = await readJson(authSettingsFile, {});
  return { ...value, users:Array.isArray(value.users) ? normalizeUsers(value.users) : [] };
}

function requireAdmin(request) {
  if (request.user?.role !== "admin") throw new Error("관리자 권한이 필요합니다.");
}

async function serveStatic(request, response) {
  const url = new URL(request.url, "http://localhost");
  const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const target = path.resolve(publicRoot, requested);
  if (!target.startsWith(publicRoot)) return false;
  try {
    const content = await fs.readFile(target);
    const type = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" }[path.extname(target)] || "application/octet-stream";
    response.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store, max-age=0" });
    response.end(content);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

const server = http.createServer(async (request, response) => {
  let activeJobId=null;
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const auth = await loadAuthSettings();
    const authEnabled = Boolean(auth.clientId);
    const sessionUser = authEnabled ? readSession(cookieValue(request, "withbid_session"), auth.sessionSecret, auth.users) : null;
    const publicAuthPaths = new Set(["/api/app-info", "/api/auth/config", "/api/auth/bootstrap", "/api/auth/google", "/api/auth/logout", "/api/auth/me"]);

    if (request.method === "GET" && url.pathname === "/api/app-info") {
      return json(response, 200, { app: "WITHBID-PPBM", version: "0.3.6", dataRoot: config.dataRoot });
    }

    if (request.method === "GET" && url.pathname === "/api/auth/config") {
      return json(response, 200, { configured:authEnabled, clientId:auth.clientId || null, userCount:auth.users.filter((item)=>item.enabled).length });
    }
    if (request.method === "POST" && url.pathname === "/api/auth/bootstrap") {
      if (authEnabled) throw new Error("Google 인증 설정은 이미 완료되었습니다.");
      const input=await bodyJson(request); const clientId=String(input.clientId || "").trim();
      if (!/^[0-9]+-[a-z0-9_-]+\.apps\.googleusercontent\.com$/i.test(clientId)) throw new Error("올바른 Google OAuth 웹 클라이언트 ID를 입력하세요.");
      await writeJson(authSettingsFile,{...auth,clientId});
      return json(response,200,{configured:true,clientId,userCount:auth.users.filter((item)=>item.enabled).length});
    }
    if (request.method === "POST" && url.pathname === "/api/auth/google") {
      if (!authEnabled) throw new Error("관리자가 Google OAuth Client ID를 먼저 등록해야 합니다.");
      const input=await bodyJson(request); const profile=await verifyGoogleCredential(input.credential,auth.clientId);
      const user=auth.users.find((item)=>item.email===profile.email&&item.enabled);
      if (!user) throw new Error("사용이 승인되지 않은 Google 계정입니다. 관리자에게 문의하세요.");
      response.setHeader("Set-Cookie",`withbid_session=${encodeURIComponent(createSession(user,auth.sessionSecret))}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`);
      return json(response,200,{user});
    }
    if (request.method === "POST" && url.pathname === "/api/auth/logout") {
      response.setHeader("Set-Cookie","withbid_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
      return json(response,200,{ok:true});
    }
    if (request.method === "GET" && url.pathname === "/api/auth/me") {
      return json(response,200,{configured:authEnabled,authenticated:Boolean(sessionUser),user:sessionUser});
    }
    if (url.pathname.startsWith("/api/") && !publicAuthPaths.has(url.pathname) && authEnabled && !sessionUser) {
      return json(response,401,{error:"Google 로그인이 필요합니다."});
    }
    request.user=sessionUser;

    if (request.method === "GET" && url.pathname === "/api/admin/users") {
      requireAdmin(request); return json(response,200,auth.users);
    }
    if (request.method === "POST" && url.pathname === "/api/admin/users") {
      requireAdmin(request); const input=await bodyJson(request);
      const email=String(input.email||"").trim().toLowerCase(); const name=String(input.name||"").trim(); const role=input.role==="admin"?"admin":"member";
      if(!/^\S+@\S+\.\S+$/.test(email)||!name)throw new Error("직원 이름과 올바른 Google 이메일을 입력하세요.");
      const users=auth.users.filter((item)=>item.email!==email);users.push({name,email,role,enabled:true});
      await writeJson(authSettingsFile,{...auth,users});return json(response,201,{name,email,role,enabled:true});
    }
    if (request.method === "DELETE" && url.pathname.startsWith("/api/admin/users/")) {
      requireAdmin(request); const email=decodeURIComponent(url.pathname.slice("/api/admin/users/".length)).toLowerCase();
      if(email===request.user.email)throw new Error("현재 로그인한 관리자 계정은 삭제할 수 없습니다.");
      const users=auth.users.filter((item)=>item.email!==email);if(users.length===auth.users.length)throw new Error("사용자를 찾지 못했습니다.");
      await writeJson(authSettingsFile,{...auth,users});return json(response,200,{ok:true});
    }
    if (request.method === "GET" && url.pathname === "/api/status") {
      const state = await loadState();
      return json(response, 200, { dataRoot: config.dataRoot, noticeCount: state.notices.length, priceCount: state.priceList.items.length, priceImportedAt: state.priceList.importedAt });
    }
    if(request.method==="GET"&&url.pathname==="/api/automation/progress"){const jobId=String(url.searchParams.get("id")||"");const progress=progressJobs.get(jobId);return progress?json(response,200,progress):json(response,200,{jobId,percent:1,stage:"공고 조회",message:"분석 요청을 준비하고 있습니다.",status:"waiting"});}
    if (request.method === "GET" && url.pathname === "/api/notices") {
      const state = await loadState();
      return json(response, 200, state.notices);
    }
    if (request.method === "GET" && url.pathname === "/api/settings/openai") {
      requireAdmin(request);
      return json(response, 200, redactSettings(await readJson(openaiSettingsFile, {})));
    }
    if (request.method === "POST" && url.pathname === "/api/settings/openai") {
      requireAdmin(request);
      const input = await bodyJson(request);
      const previous = await readJson(openaiSettingsFile, {});
      const settings = { apiKey:String(input.apiKey || previous.apiKey || "").trim(), extractionModel:String(input.extractionModel || "gpt-5.6-luna"), analysisModel:String(input.analysisModel || "gpt-5.6-terra") };
      if (!settings.apiKey) throw new Error("OpenAI API 키를 입력해 주세요.");
      await writeJson(openaiSettingsFile, settings);
      return json(response, 200, redactSettings(settings));
    }
    if (request.method === "GET" && url.pathname === "/api/settings/g2b") { requireAdmin(request); const value=await readJson(g2bSettingsFile,{}); return json(response,200,{configured:Boolean(value.apiKey),keyHint:value.apiKey?`${value.apiKey.slice(0,4)}…${value.apiKey.slice(-4)}`:""}); }
    if (request.method === "POST" && url.pathname === "/api/settings/g2b") { requireAdmin(request); const input=await bodyJson(request); const previous=await readJson(g2bSettingsFile,{}); const apiKey=String(input.apiKey||previous.apiKey||"").trim(); if(!apiKey) throw new Error("나라장터 API 키를 입력해 주세요."); await writeJson(g2bSettingsFile,{apiKey}); return json(response,200,{configured:true,keyHint:`${apiKey.slice(0,4)}…${apiKey.slice(-4)}`}); }
    if (request.method === "POST" && url.pathname === "/api/automation/analyze-link") {
      const input = await bodyJson(request);
      activeJobId=/^[a-zA-Z0-9-]{8,80}$/.test(String(input.jobId||""))?String(input.jobId):null;updateProgress(activeJobId,3,"공고 조회","API 설정과 공고 링크를 확인하고 있습니다.");
      const settings = await readJson(openaiSettingsFile, {});
      const g2bSettings = await readJson(g2bSettingsFile, {});
      if (!settings.apiKey) throw new Error("설정에서 OpenAI API 키를 먼저 등록해 주세요.");
      const sourceUrl = String(input.sourceUrl || "").trim();
      let sourceText, official=null, finalUrl=sourceUrl, downloadedFiles=[];
      updateProgress(activeJobId,10,"공고 조회","나라장터 공고정보를 조회하고 있습니다.");
      if (/g2b\.go\.kr/i.test(sourceUrl)) { if(!g2bSettings.apiKey) throw new Error("설정에서 공공데이터포털 나라장터 API 키를 먼저 등록해 주세요."); const ids=parseG2bLink(sourceUrl); official=await fetchG2bNotice({apiKey:g2bSettings.apiKey,...ids}); sourceText=g2bToText(official); for(const [index,item] of official.attachments.entries()){const url=attachmentUrl(item);if(!url)continue;try{const response=await fetch(url,{headers:{"User-Agent":"Mozilla/5.0 Chrome/138.0"}});if(response.ok)downloadedFiles.push({filename:safeName(attachmentName(item,index),100),buffer:Buffer.from(await response.arrayBuffer())});}catch{}} }
      else { const page=await fetchNoticePage(sourceUrl); sourceText=page.text; finalUrl=page.finalUrl; }
      updateProgress(activeJobId,25,"첨부 다운로드",`${downloadedFiles.length}개 첨부파일을 내려받았습니다.`);
      updateProgress(activeJobId,29,"압축파일 해제","ZIP 첨부파일을 안전하게 풀고 있습니다.");
      const archiveExpansion=await expandZipAttachments(downloadedFiles);
      if(archiveExpansion.errors.length)throw new Error(`첨부 ZIP 압축 해제 실패: ${archiveExpansion.errors.map(item=>`${item.filename} (${item.error})`).join(", ")}`);
      downloadedFiles=archiveExpansion.files;
      updateProgress(activeJobId,34,"한컴문서 변환","압축 내부를 포함한 HWP/HWPX 문서를 PDF로 변환하고 있습니다.");
      const hancomConversion=await convertHancomAttachments(downloadedFiles,{scriptPath:hancomConverterScript});
      downloadedFiles.push(...hancomConversion.converted);
      if(hancomConversion.errors.length)throw new Error(`HWP/HWPX PDF 변환 실패: ${hancomConversion.errors.map(item=>`${item.filename} (${item.error})`).join(", ")}`);
      updateProgress(activeJobId,43,"AI 문서 추출","공고문과 변환된 PDF에서 요구사항을 추출하고 있습니다.");
      const extraction = await extractNotice({ settings, sourceText, files:downloadedFiles });
      const state = await loadState(); const number=extraction.noticeNumber || extractNoticeNumber(sourceUrl) || `AUTO-${Date.now()}`;
      let notice=state.notices.find(item=>item.noticeNumber===number); if(!notice){notice=await createNotice(config.dataRoot,{noticeNumber:number,title:extraction.title||"공고명 확인 필요",organization:extraction.organization||"",deadline:extraction.deadline||"0000-00-00",sourceUrl:finalUrl});state.notices.unshift(notice);}
      const base = path.join(config.dataRoot, "진행중", notice.folderName);
      await fs.writeFile(path.join(base,"03_추출텍스트","공고페이지.txt"),sourceText,"utf8");
      if(official) { await writeJson(path.join(base,"04_구조화데이터","나라장터_API_원본.json"),official); await writeJson(path.join(base,"04_구조화데이터","압축해제_결과.json"),{extracted:archiveExpansion.extracted.map(file=>({filename:file.filename,extractedFrom:file.extractedFrom,size:file.buffer.length})),errors:archiveExpansion.errors,extractedAt:new Date().toISOString()}); await writeJson(path.join(base,"04_구조화데이터","한컴문서_변환결과.json"),{converted:hancomConversion.converted.map(file=>({filename:file.filename,convertedFrom:file.convertedFrom,size:file.buffer.length})),errors:hancomConversion.errors,convertedAt:new Date().toISOString()}); for(const file of downloadedFiles){const target=path.join(base,"02_첨부파일",...String(file.filename).replace(/\\/g,"/").split("/"));await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,file.buffer);} }
      await writeJson(path.join(base,"04_구조화데이터","AI_추출결과.json"),extraction);
      updateProgress(activeJobId,58,"단가표 조회","자사 단가표를 우선 조회하고 있습니다.");
      const priceableRequirements=extraction.requirements.filter(isPriceableRequirement);
      const companyByRequirement=priceableRequirements.map(requirement=>({requirement,matches:rankCompanyPrices(state.priceList.items,{category:requirement.category,model:requirement.condition}).filter(item=>item.unitPrice>0).slice(0,3)}));
      const priceCandidates=companyByRequirement.flatMap(({requirement,matches})=>matches.map(item=>({requirement,model:item.model,unitPrice:item.unitPrice,source:"company_price_list",sourceUrl:null,stock:item.stock,checkedAt:state.priceList.importedAt})));
      const unresolved=companyByRequirement.filter(({matches})=>matches.length===0).map(({requirement})=>({category:requirement.category,model:requirement.condition,quantity:requirement.quantity,specificationGroup:inferredSpecificationGroup(requirement),unitQuantity:requirement.unitQuantity,systemQuantity:requirement.systemQuantity,priceRole:requirement.priceRole}));
      updateProgress(activeJobId,66,"외부 가격 검색",`${unresolved.length}개 미등록 품목을 컴퓨존·가이드컴에서 검색하고 있습니다.`);
      const externalPrices=await findExternalPrices({settings,requirements:unresolved});
      priceCandidates.push(...externalPrices.map(item=>({requirement:{category:item.category,condition:item.requestedModel,specificationGroup:item.specificationGroup,unitQuantity:item.unitQuantity,systemQuantity:item.systemQuantity,priceRole:item.priceRole},model:item.matchedModel,unitPrice:item.unitPrice,source:item.sourceName,sourceUrl:item.sourceUrl,stock:"웹 판매 페이지 확인",checkedAt:item.checkedAt,confidence:item.confidence,matchScore:item.matchScore,matchedKeywords:item.matchedKeywords,matchType:item.matchType,status:`${item.matchType==="exact"?"동일모델":"대체모델 후보"} · 일치도 ${item.matchScore}% · ${item.status}`})));
      await writeJson(path.join(base,"05_가격근거","가격조사결과.json"),{companyPriceList:priceCandidates.filter(item=>item.source==="company_price_list"),externalPrices,checkedAt:new Date().toISOString()});
      updateProgress(activeJobId,82,"참가 판단","가격·자격·납기 조건을 종합하여 참가 여부를 판단하고 있습니다.");
      const report = await analyzeBid({settings,extraction,priceCandidates,certifications:String(input.certifications||""),targetMargin:Number(input.targetMargin||12)});
      updateProgress(activeJobId,92,"결과 저장","대시보드와 견적서를 NAS 입찰관리 폴더에 저장하고 있습니다.");
      await writeJson(path.join(base,"06_분석결과","AI_판단결과.json"),report);
      const reportPath=path.join(base,"06_분석결과","참가판단리포트.md"); await fs.writeFile(reportPath,reportToMarkdown(notice,report),"utf8");
      const dashboardPath=path.join(base,"06_분석결과","입찰참가판단_대시보드.html"); await fs.writeFile(dashboardPath,reportToDashboardHtml(notice,report,extraction),"utf8");
      const quotePath=path.join(base,"06_분석결과","견적서.xlsx"); await fs.writeFile(quotePath,Buffer.from(await quoteWorkbookBuffer(notice,report,extraction,Number(input.targetMargin||12))));
      notice.status="분석완료"; notice.analyzedAt=new Date().toISOString(); await saveState(state);
      updateProgress(activeJobId,100,"결과 저장","분석과 파일 저장을 완료했습니다.","completed");
      return json(response,200,{notice,report,reportPath,dashboardPath,quotePath});
    }
    if (request.method === "POST" && url.pathname === "/api/notices") {
      const notice = await createNotice(config.dataRoot, await bodyJson(request));
      const state = await loadState();
      state.notices.unshift(notice);
      await saveState(state);
      return json(response, 201, notice);
    }
    if (request.method === "POST" && url.pathname === "/api/price-list") {
      const filename = decodeURIComponent(request.headers["x-filename"] || "company_price_list.csv");
      const buffer = await bodyBuffer(request);
      const items = await parsePriceList(buffer, filename);
      if (!items.length) throw new Error("모델명 또는 부품번호가 있는 가격 행을 찾지 못했습니다.");
      const importedAt = new Date().toISOString();
      const originalPath = path.join(config.dataRoot, "_단가표", "company_price_list", `${Date.now()}_${path.basename(filename)}`);
      await fs.writeFile(originalPath, buffer);
      const state = await loadState();
      state.priceList = { filename, importedAt, sha256: sha256(buffer), items };
      await saveState(state);
      await writeJson(path.join(config.dataRoot, "_단가표", "current", "company_price_list.json"), state.priceList);
      return json(response, 200, { filename, importedAt, count: items.length });
    }
    if (request.method === "POST" && url.pathname === "/api/prices/search") {
      const query = await bodyJson(request);
      const state = await loadState();
      const companyMatches = rankCompanyPrices(state.priceList.items, query);
      const result = companyMatches.length
        ? { resolution: "company_price_list", companyMatches, externalSearches: [] }
        : { resolution: "external_search_required", companyMatches: [], externalSearches: buildExternalSearches(query) };
      return json(response, 200, { ...result, checkedAt: new Date().toISOString() });
    }
    if (request.method === "POST" && url.pathname === "/api/opal/bundle") {
      const input = await bodyJson(request);
      const state = await loadState();
      const notice = state.notices.find((item) => item.id === input.noticeId);
      if (!notice) throw new Error("분석할 공고를 찾지 못했습니다.");
      const bundle = buildOpalBundle({
        notice,
        sourceText: input.sourceText,
        certificationText: input.certificationText,
        targetMargin: input.targetMargin,
        priceItems: state.priceList.items,
      });
      const folder = path.join(config.dataRoot, "진행중", notice.folderName, "04_구조화데이터");
      await fs.writeFile(path.join(folder, "Opal_입력자료.md"), bundle, "utf8");
      return json(response, 200, { bundle, savedTo: path.join(folder, "Opal_입력자료.md") });
    }
    if (request.method === "POST" && url.pathname === "/api/opal/result") {
      const input = await bodyJson(request);
      const state = await loadState();
      const notice = state.notices.find((item) => item.id === input.noticeId);
      if (!notice) throw new Error("결과를 저장할 공고를 찾지 못했습니다.");
      if (!String(input.result || "").trim()) throw new Error("Opal 분석 결과를 붙여넣어 주세요.");
      const resultFolder = path.join(config.dataRoot, "진행중", notice.folderName, "06_분석결과");
      const filePath = path.join(resultFolder, "참가판단리포트.md");
      await fs.writeFile(filePath, String(input.result).trim(), "utf8");
      notice.status = "분석완료";
      notice.analyzedAt = new Date().toISOString();
      await saveState(state);
      return json(response, 200, { savedTo: filePath, analyzedAt: notice.analyzedAt });
    }
    if (request.method === "GET" && await serveStatic(request, response)) return;
    json(response, 404, { error: "요청한 기능을 찾을 수 없습니다." });
  } catch (error) {
    console.error(error);
    updateProgress(activeJobId,100,progressJobs.get(activeJobId)?.stage||"공고 조회",error.message||"처리 중 오류가 발생했습니다.","failed");
    json(response, 400, { error: error.message || "처리 중 오류가 발생했습니다." });
  }
});

server.listen(config.port, config.host, () => {
  console.log(`WITHBID-PPBM: http://${config.host}:${config.port}`);
  console.log(`데이터 저장 위치: ${config.dataRoot}`);
});
