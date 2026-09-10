import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getConfig } from "./config.js";
import { ensureDataLayout, readJson, safeName, sha256, writeJson } from "./lib/files.js";
import { parsePriceList } from "./lib/price-list.js";
import { buildExternalSearches, rankCompanyPrices } from "./lib/pricing.js";
import { archiveNoticeFolder, createNotice, ensureNoticeFolder, restoreArchivedNoticeFolder, updateNoticeDetails } from "./lib/notices.js";
import { buildOpalBundle } from "./lib/opal.js";
import { analyzeBid, extractNotice, findExternalPrices, redactSettings, reportToMarkdown } from "./lib/openai.js";
import { inferredSpecificationGroup, isPriceableRequirement } from "./lib/quote-structure.js";
import { extractNoticeNumber, fetchNoticePage } from "./lib/web-source.js";
import { attachmentName, attachmentUrl, fetchG2bNotice, g2bNoticeMetadata, g2bToText, parseG2bLink } from "./lib/g2b.js";
import { quoteWorkbookBuffer, reportToDashboardHtml } from "./lib/result-artifacts.js";
import { convertHancomAttachments } from "./lib/hancom.js";
import { expandZipAttachments } from "./lib/archives.js";
import { convertExcelAttachments } from "./lib/excel.js";
import { cookieValue, createSession, newSecret, normalizeUsers, readSession, verifyGoogleCredential } from "./lib/auth.js";
import { openNoticeFolder } from "./lib/folder-launcher.js";
import { assessDocumentStructure, extractDocumentBlocks } from "./lib/document-analysis.js";
import { buildVerifiedQuotePlan, verifyExtraction } from "./lib/verified-quote.js";
import { buildCompatibilityContext, COMPONENT_RESEARCH_ORDER, pricingGroupName, sortRequirementsForPricing } from "./lib/compatibility.js";
import { completeCompatibilityRequirements, refineExtractedRequirements } from "./lib/requirement-refinement.js";

const config = getConfig();
const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const publicRoot = path.join(appRoot, "public");
const hancomConverterScript=path.join(appRoot,"scripts","convert-hancom-to-pdf.ps1");
const excelConverterScript=path.join(appRoot,"scripts","convert-excel-to-pdf.ps1");
const stateFile = path.join(config.dataRoot, "_데이터베이스", "app-state.json");
const openaiSettingsFile = path.join(config.dataRoot, "_설정", "openai.json");
const g2bSettingsFile = path.join(config.dataRoot, "_설정", "g2b.json");
const authSettingsFile = path.join(config.dataRoot, "_설정", "auth.json");
const authorizedUsersFile = process.env.AUTHORIZED_USERS_FILE || path.join(appRoot,"config","authorized-users.local.json");
const progressJobs=new Map();
function updateProgress(jobId,percent,stage,message,status="running"){if(!jobId)return;progressJobs.set(jobId,{jobId,percent,stage,message,status,updatedAt:new Date().toISOString()});setTimeout(()=>progressJobs.delete(jobId),30*60*1000).unref();}

function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
}

async function saveAttachmentFiles(base, files) {
  const attachmentRoot = path.join(base, "02_첨부파일");
  await fs.mkdir(attachmentRoot, { recursive:true });
  for (const file of files) {
    const filename = safeName(path.posix.basename(String(file.filename || "첨부파일").replace(/\\/g,"/")), 120);
    await fs.writeFile(path.join(attachmentRoot, filename), file.buffer);
  }
}

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
  let activeNoticeId=null;
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const auth = await loadAuthSettings();
    const authEnabled = Boolean(auth.clientId);
    const sessionUser = authEnabled ? readSession(cookieValue(request, "withbid_session"), auth.sessionSecret, auth.users) : null;
    const publicAuthPaths = new Set(["/api/app-info", "/api/auth/config", "/api/auth/bootstrap", "/api/auth/google", "/api/auth/logout", "/api/auth/me"]);

    if (request.method === "GET" && url.pathname === "/api/app-info") {
      return json(response, 200, { app: "WITHBID-PPBM", version: "0.6.2", dataRoot: config.dataRoot });
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
    if (request.method === "POST" && url.pathname === "/api/notices/open-folder") {
      const input = await bodyJson(request);
      const state = await loadState();
      const notice = state.notices.find((item) => item.id === input.noticeId);
      if (!notice) throw new Error("결과 폴더를 열 공고를 찾지 못했습니다.");
      if (notice.status !== "분석완료") throw new Error("분석이 완료된 공고만 결과 폴더를 열 수 있습니다.");
      const folderPath = await openNoticeFolder({ dataRoot:config.dataRoot, folderName:notice.folderName });
      return json(response, 200, { opened:true, folderPath });
    }
    if (request.method === "DELETE" && url.pathname.startsWith("/api/notices/")) {
      const noticeId = decodeURIComponent(url.pathname.slice("/api/notices/".length));
      const state = await loadState();
      const index = state.notices.findIndex((item) => item.id === noticeId);
      if (index < 0) throw new Error("삭제할 공고를 찾지 못했습니다.");
      const notice = state.notices[index];
      const archived = await archiveNoticeFolder(config.dataRoot, notice);
      state.notices.splice(index, 1);
      try { await saveState(state); }
      catch (error) { await restoreArchivedNoticeFolder(archived); throw error; }
      return json(response, 200, { deleted:true, archivedTo:archived?.destination || null });
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
      let parsedSource;
      try { parsedSource = new URL(sourceUrl); }
      catch { throw new Error("올바른 조달공고 링크를 입력해 주세요."); }
      if (!/^https?:$/.test(parsedSource.protocol)) throw new Error("HTTP 또는 HTTPS 조달공고 링크만 사용할 수 있습니다.");

      const isG2b = /g2b\.go\.kr$/i.test(parsedSource.hostname) || /\.g2b\.go\.kr$/i.test(parsedSource.hostname);
      let g2bIds = null;
      if (isG2b) {
        if(!g2bSettings.apiKey) throw new Error("설정에서 공공데이터포털 나라장터 API 키를 먼저 등록해 주세요.");
        g2bIds = parseG2bLink(sourceUrl);
        if (!g2bIds.bidPbancNo) throw new Error("나라장터 링크에서 공고번호를 찾지 못했습니다.");
      }

      const initialNoticeNumber = g2bIds?.bidPbancNo || extractNoticeNumber(sourceUrl) || `WEB-${Date.now()}`;
      const state = await loadState();
      let notice = state.notices.find((item) => item.noticeNumber === initialNoticeNumber);
      if (notice) {
        notice.status="분석중"; notice.analysisStartedAt=new Date().toISOString(); delete notice.lastError; delete notice.failedAt;
        await ensureNoticeFolder(config.dataRoot, notice);
      } else {
        notice=await createNotice(config.dataRoot,{noticeNumber:initialNoticeNumber,title:"공고정보 조회 중",organization:"기관 확인 중",deadline:localDate(),sourceUrl,status:"분석중"});
        notice.analysisStartedAt=new Date().toISOString();
        state.notices.unshift(notice);
        await ensureNoticeFolder(config.dataRoot, notice);
      }
      activeNoticeId=notice.id;
      await saveState(state);
      let base=path.join(config.dataRoot,"진행중",notice.folderName);
      updateProgress(activeJobId,7,"공고 조회","공고 작업 폴더를 만들었습니다. 공식 공고정보를 조회하고 있습니다.");

      let sourceText, official=null, finalUrl=sourceUrl, downloadedFiles=[];
      if (isG2b) {
        official=await fetchG2bNotice({apiKey:g2bSettings.apiKey,...g2bIds});
        sourceText=g2bToText(official);
        base=await updateNoticeDetails(config.dataRoot,notice,g2bNoticeMetadata(official,{noticeNumber:initialNoticeNumber,title:notice.title,organization:notice.organization,deadline:notice.deadline,sourceUrl}));
        await saveState(state);
        await writeJson(path.join(base,"04_구조화데이터","나라장터_API_원본.json"),official);
        await fs.writeFile(path.join(base,"03_추출텍스트","공고페이지.txt"),sourceText,"utf8");
        for(const [index,item] of official.attachments.entries()){
          const fileUrl=attachmentUrl(item); if(!fileUrl)continue;
          try{const fileResponse=await fetch(fileUrl,{headers:{"User-Agent":"Mozilla/5.0 Chrome/138.0"}});if(fileResponse.ok)downloadedFiles.push({filename:safeName(attachmentName(item,index),100),buffer:Buffer.from(await fileResponse.arrayBuffer())});}catch{}
        }
        await saveAttachmentFiles(base,downloadedFiles);
      } else {
        const page=await fetchNoticePage(sourceUrl);sourceText=page.text;finalUrl=page.finalUrl;
        await fs.writeFile(path.join(base,"03_추출텍스트","공고페이지.txt"),sourceText,"utf8");
      }
      updateProgress(activeJobId,25,"첨부 다운로드",`${downloadedFiles.length}개 첨부파일을 내려받았습니다.`);
      updateProgress(activeJobId,29,"압축파일 해제","ZIP 첨부파일을 안전하게 풀고 있습니다.");
      const archiveExpansion=await expandZipAttachments(downloadedFiles);
      await writeJson(path.join(base,"04_구조화데이터","압축해제_결과.json"),{extracted:archiveExpansion.extracted.map(file=>({filename:file.filename,archivePath:file.archivePath,extractedFrom:file.extractedFrom,size:file.buffer.length})),errors:archiveExpansion.errors,extractedAt:new Date().toISOString()});
      await saveAttachmentFiles(base,archiveExpansion.extracted);
      if(archiveExpansion.errors.length)throw new Error(`첨부 ZIP 압축 해제 실패: ${archiveExpansion.errors.map(item=>`${item.filename} (${item.error})`).join(", ")}`);
      downloadedFiles=archiveExpansion.files;
      updateProgress(activeJobId,34,"한컴문서 변환","압축 내부를 포함한 HWP/HWPX 문서를 PDF로 변환하고 있습니다.");
      const hancomConversion=await convertHancomAttachments(downloadedFiles,{scriptPath:hancomConverterScript});
      downloadedFiles.push(...hancomConversion.converted);
      await writeJson(path.join(base,"04_구조화데이터","한컴문서_변환결과.json"),{converted:hancomConversion.converted.map(file=>({filename:file.filename,convertedFrom:file.convertedFrom,size:file.buffer.length})),errors:hancomConversion.errors,convertedAt:new Date().toISOString()});
      await saveAttachmentFiles(base,hancomConversion.converted);
      if(hancomConversion.errors.length)throw new Error(`HWP/HWPX PDF 변환 실패: ${hancomConversion.errors.map(item=>`${item.filename} (${item.error})`).join(", ")}`);
      updateProgress(activeJobId,39,"Excel 문서 변환","압축 내부를 포함한 Excel 문서를 PDF로 변환하고 있습니다.");
      const excelConversion=await convertExcelAttachments(downloadedFiles,{scriptPath:excelConverterScript});
      downloadedFiles.push(...excelConversion.converted);
      await writeJson(path.join(base,"04_구조화데이터","엑셀문서_변환결과.json"),{converted:excelConversion.converted.map(file=>({filename:file.filename,convertedFrom:file.convertedFrom,size:file.buffer.length})),errors:excelConversion.errors,convertedAt:new Date().toISOString()});
      await saveAttachmentFiles(base,excelConversion.converted);
      if(excelConversion.errors.length)throw new Error(`Excel PDF 변환 실패: ${excelConversion.errors.map(item=>`${item.filename} (${item.error})`).join(", ")}`);
      updateProgress(activeJobId,44,"문서 구조 판정","페이지·문단·표·셀 단위로 원문 근거를 정리하고 있습니다.");
      const blockExtraction=await extractDocumentBlocks({sourceText,files:downloadedFiles});
      const structureAssessment=assessDocumentStructure(blockExtraction.blocks);
      await writeJson(path.join(base,"04_구조화데이터","문서블록_추출결과.json"),blockExtraction);
      await writeJson(path.join(base,"04_구조화데이터","문서구조_평가.json"),structureAssessment);
      updateProgress(activeJobId,50,"AI 의미 분석",structureAssessment.mode==="enhanced_prose"?"문장형 규격서를 문맥과 사양 그룹별로 분석하고 있습니다.":"표 구조와 문장 근거를 함께 분석하고 있습니다.");
      const rawExtraction = await extractNotice({ settings, sourceText, files:downloadedFiles, blocks:blockExtraction.blocks, assessment:structureAssessment });
      await writeJson(path.join(base,"04_구조화데이터","AI_추출원본.json"),rawExtraction);
      updateProgress(activeJobId,54,"요구사양 정밀화","복합 문장을 부품·용량·수량별 독립 견적 항목으로 나누고 있습니다.");
      const refinedExtraction=refineExtractedRequirements(rawExtraction);
      await writeJson(path.join(base,"04_구조화데이터","AI_정밀화결과.json"),refinedExtraction);
      updateProgress(activeJobId,57,"원문 근거 검증","AI 추출값의 문장·수량·사양 그룹 근거를 대조하고 있습니다.");
      const extraction=completeCompatibilityRequirements(verifyExtraction(refinedExtraction,blockExtraction.blocks,structureAssessment));
      if(blockExtraction.errors.length)extraction.uncertainties.push(...blockExtraction.errors.map(item=>`${item.filename}: 텍스트 블록 추출 실패 (${item.error})`));
      base=await updateNoticeDetails(config.dataRoot,notice,{noticeNumber:extraction.noticeNumber||notice.noticeNumber,title:extraction.title||notice.title,organization:extraction.organization||notice.organization,deadline:extraction.deadline||notice.deadline,sourceUrl:finalUrl});
      await saveState(state);
      await fs.writeFile(path.join(base,"03_추출텍스트","공고페이지.txt"),sourceText,"utf8");
      await writeJson(path.join(base,"04_구조화데이터","AI_추출결과.json"),extraction);
      updateProgress(activeJobId,63,"단가표 조회",`사양 그룹별로 ${COMPONENT_RESEARCH_ORDER.join(" → ")} 순서의 가격 조사를 시작합니다.`);
      const priceableRequirements=sortRequirementsForPricing(extraction.requirements.filter(requirement=>isPriceableRequirement(requirement)&&requirement.priceSearchAllowed!==false));
      const priceCandidates=[];
      const externalPrices=[];
      const selectedByGroup=new Map();
      for(let index=0;index<priceableRequirements.length;index+=1){
        const requirement=priceableRequirements[index];
        const group=pricingGroupName(requirement);
        const selectedParts=selectedByGroup.get(group)||[];
        const compatibilityContext=buildCompatibilityContext(selectedParts,group);
        const percent=63+Math.round((index/Math.max(priceableRequirements.length,1))*17);
        updateProgress(activeJobId,percent,"단가표 조회",`${group} · ${requirement.category}: 자사 단가표와 선행 부품 호환성을 확인하고 있습니다.`);
        const companyMatches=rankCompanyPrices(state.priceList.items,{requirement,category:requirement.category,model:requirement.searchProfile?.exactModel||requirement.condition,searchKeywords:requirement.searchProfile?.requiredKeywords||requirement.searchKeywords,constraints:requirement.constraints,compatibilityContext}).filter(item=>item.unitPrice>0).slice(0,3);
        let currentCandidates=[];
        if(companyMatches.length){
          currentCandidates=companyMatches.map(item=>({requirementId:requirement.id,requirement,model:item.model,specification:item.specification,unitPrice:item.unitPrice,matchScore:item.matchScore,matchType:item.matchType,matchedKeywords:item.matchedKeywords,source:"company_price_list",sourceUrl:null,stock:item.stock,checkedAt:state.priceList.importedAt,compatibilityStatus:item.compatibilityStatus,compatibilityNotes:item.compatibilityNotes,status:`자사 단가표 · ${item.matchType==="exact"?"정확 모델":"핵심사양 후보"} · 호환성 ${item.compatibilityStatus==="compatible"?"확인":"검토 필요"}`}));
        }else{
          updateProgress(activeJobId,percent,"외부 가격 검색",`${group} · ${requirement.category}: 컴퓨존 → 가이드컴을 확인하고, 없으면 다나와까지 검색합니다.`);
          const found=await findExternalPrices({settings,requirements:[{id:requirement.id,category:requirement.category,model:requirement.searchProfile?.exactModel||requirement.condition,searchKeywords:requirement.searchKeywords,searchProfile:requirement.searchProfile,constraints:requirement.constraints,quantity:requirement.quantity,specificationGroup:group,unitQuantity:requirement.unitQuantity,systemQuantity:requirement.systemQuantity,priceRole:requirement.priceRole,derivedFromCompatibility:requirement.derivedFromCompatibility,compatibilityContext}]});
          externalPrices.push(...found);
          currentCandidates=found.map(item=>({requirementId:item.requirementId,requirement,model:item.matchedModel,specification:item.specification,unitPrice:item.unitPrice,source:item.sourceName,sourceUrl:item.sourceUrl,stock:"웹 판매 페이지 확인",checkedAt:item.checkedAt,confidence:item.confidence,matchScore:item.matchScore,matchedKeywords:item.matchedKeywords,matchType:item.matchType,compatibilityStatus:item.compatibilityStatus,compatibilityNotes:item.compatibilityNotes,status:`${item.matchType==="exact"?"동일모델":"대체모델 후보"} · 일치도 ${item.matchScore}% · 호환성 ${item.compatibilityStatus==="compatible"?"확인":"검토 필요"} · ${item.status}`}));
        }
        priceCandidates.push(...currentCandidates);
        const compatibilitySelection=currentCandidates[0]||{
          requirement,
          model:requirement.specifiedModel||requirement.condition,
          specification:(requirement.searchProfile?.requiredKeywords||[]).join(" "),
          source:"requirement_fallback",
        };
        selectedByGroup.set(group,[...selectedParts,compatibilitySelection]);
      }
      await writeJson(path.join(base,"05_가격근거","가격조사결과.json"),{researchOrder:COMPONENT_RESEARCH_ORDER,sourcePriority:["company_price_list","컴퓨존","가이드컴","다나와"],companyPriceList:priceCandidates.filter(item=>item.source==="company_price_list"),externalPrices,compatibilityContexts:Object.fromEntries([...selectedByGroup].map(([group,items])=>[group,buildCompatibilityContext(items,group)])),checkedAt:new Date().toISOString()});
      updateProgress(activeJobId,83,"견적 감사","부품 누락·중복·수량·완제품 이중계산 여부를 검사하고 있습니다.");
      const quotePlan=buildVerifiedQuotePlan(extraction,priceCandidates);
      await writeJson(path.join(base,"04_구조화데이터","검증된_견적계획.json"),quotePlan);
      updateProgress(activeJobId,88,"참가 판단","검증된 견적과 자격·납기 조건으로 참가 여부를 판단하고 있습니다.");
      let decision = await analyzeBid({settings,extraction,quotePlan,certifications:String(input.certifications||""),targetMargin:Number(input.targetMargin||12)});
      if(quotePlan.blockingIssueCount>0&&decision.decision==="참가")decision={...decision,decision:"조건부 참가",summary:`필수 확인사항 ${quotePlan.blockingIssueCount}건이 있어 조건부 참가로 조정했습니다. ${decision.summary}`};
      const auditMessages=quotePlan.audit.map(item=>item.message);
      const report={...decision,configuration:quotePlan.configuration,quoteAudit:quotePlan.audit,risks:[...new Set([...(decision.risks||[]),...auditMessages])],checklist:[...new Set([...(decision.checklist||[]),...auditMessages])],};
      updateProgress(activeJobId,94,"결과 저장","대시보드와 견적서를 NAS 입찰관리 폴더에 저장하고 있습니다.");
      await writeJson(path.join(base,"06_분석결과","AI_판단결과.json"),report);
      const reportPath=path.join(base,"06_분석결과","참가판단리포트.md"); await fs.writeFile(reportPath,reportToMarkdown(notice,report),"utf8");
      const dashboardPath=path.join(base,"06_분석결과","입찰참가판단_대시보드.html"); await fs.writeFile(dashboardPath,reportToDashboardHtml(notice,report,extraction),"utf8");
      const quotePath=path.join(base,"06_분석결과","견적서.xlsx"); await fs.writeFile(quotePath,Buffer.from(await quoteWorkbookBuffer(notice,report,extraction,Number(input.targetMargin||12))));
      notice.status="분석완료"; notice.analyzedAt=new Date().toISOString(); delete notice.lastError; delete notice.failedAt; await ensureNoticeFolder(config.dataRoot,notice); await saveState(state);
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
    if (activeNoticeId) {
      try {
        const failedState=await loadState();
        const failedNotice=failedState.notices.find((item)=>item.id===activeNoticeId);
        if(failedNotice){failedNotice.status="분석오류";failedNotice.lastError=error.message||"처리 중 오류가 발생했습니다.";failedNotice.failedAt=new Date().toISOString();await ensureNoticeFolder(config.dataRoot,failedNotice);await saveState(failedState);}
      } catch (stateError) { console.error("분석 오류 상태 저장 실패",stateError); }
    }
    updateProgress(activeJobId,100,progressJobs.get(activeJobId)?.stage||"공고 조회",error.message||"처리 중 오류가 발생했습니다.","failed");
    json(response, 400, { error: error.message || "처리 중 오류가 발생했습니다." });
  }
});

server.listen(config.port, config.host, () => {
  console.log(`WITHBID-PPBM: http://${config.host}:${config.port}`);
  console.log(`데이터 저장 위치: ${config.dataRoot}`);
});
