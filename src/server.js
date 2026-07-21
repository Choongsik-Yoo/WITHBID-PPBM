import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getConfig } from "./config.js";
import { ensureDataLayout, readJson, sha256, writeJson } from "./lib/files.js";
import { parsePriceList } from "./lib/price-list.js";
import { buildExternalSearches, rankCompanyPrices } from "./lib/pricing.js";
import { createNotice } from "./lib/notices.js";
import { buildOpalBundle } from "./lib/opal.js";
import { analyzeBid, extractNotice, redactSettings, reportToMarkdown } from "./lib/openai.js";
import { extractNoticeNumber, fetchNoticePage } from "./lib/web-source.js";

const config = getConfig();
const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const publicRoot = path.join(appRoot, "public");
const stateFile = path.join(config.dataRoot, "_데이터베이스", "app-state.json");
const openaiSettingsFile = path.join(config.dataRoot, "_설정", "openai.json");

await ensureDataLayout(config.dataRoot);

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

async function serveStatic(request, response) {
  const url = new URL(request.url, "http://localhost");
  const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const target = path.resolve(publicRoot, requested);
  if (!target.startsWith(publicRoot)) return false;
  try {
    const content = await fs.readFile(target);
    const type = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" }[path.extname(target)] || "application/octet-stream";
    response.writeHead(200, { "Content-Type": type });
    response.end(content);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (request.method === "GET" && url.pathname === "/api/status") {
      const state = await loadState();
      return json(response, 200, { dataRoot: config.dataRoot, noticeCount: state.notices.length, priceCount: state.priceList.items.length, priceImportedAt: state.priceList.importedAt });
    }
    if (request.method === "GET" && url.pathname === "/api/notices") {
      const state = await loadState();
      return json(response, 200, state.notices);
    }
    if (request.method === "GET" && url.pathname === "/api/settings/openai") {
      return json(response, 200, redactSettings(await readJson(openaiSettingsFile, {})));
    }
    if (request.method === "POST" && url.pathname === "/api/settings/openai") {
      const input = await bodyJson(request);
      const previous = await readJson(openaiSettingsFile, {});
      const settings = { apiKey:String(input.apiKey || previous.apiKey || "").trim(), extractionModel:String(input.extractionModel || "gpt-5.6-luna"), analysisModel:String(input.analysisModel || "gpt-5.6-terra") };
      if (!settings.apiKey) throw new Error("OpenAI API 키를 입력해 주세요.");
      await writeJson(openaiSettingsFile, settings);
      return json(response, 200, redactSettings(settings));
    }
    if (request.method === "POST" && url.pathname === "/api/automation/analyze-link") {
      const input = await bodyJson(request);
      const settings = await readJson(openaiSettingsFile, {});
      if (!settings.apiKey) throw new Error("설정에서 OpenAI API 키를 먼저 등록해 주세요.");
      const sourceUrl = String(input.sourceUrl || "").trim();
      const page = await fetchNoticePage(sourceUrl);
      const extraction = await extractNotice({ settings, sourceText:page.text });
      const notice = await createNotice(config.dataRoot, { noticeNumber:extraction.noticeNumber || extractNoticeNumber(sourceUrl) || `AUTO-${Date.now()}`, title:extraction.title || "공고명 확인 필요", organization:extraction.organization || "", deadline:extraction.deadline || "0000-00-00", sourceUrl:page.finalUrl });
      const state = await loadState(); state.notices.unshift(notice);
      const base = path.join(config.dataRoot, "진행중", notice.folderName);
      await fs.writeFile(path.join(base,"03_추출텍스트","공고페이지.txt"),page.text,"utf8");
      await writeJson(path.join(base,"04_구조화데이터","AI_추출결과.json"),extraction);
      const priceCandidates = extraction.requirements.flatMap(r => rankCompanyPrices(state.priceList.items,{category:r.category,model:r.condition}).slice(0,3).map(i=>({requirement:r,model:i.model,unitPrice:i.unitPrice,source:"company_price_list",stock:i.stock})));
      const report = await analyzeBid({settings,extraction,priceCandidates,certifications:String(input.certifications||""),targetMargin:Number(input.targetMargin||12)});
      await writeJson(path.join(base,"06_분석결과","AI_판단결과.json"),report);
      const reportPath=path.join(base,"06_분석결과","참가판단리포트.md"); await fs.writeFile(reportPath,reportToMarkdown(notice,report),"utf8");
      notice.status="분석완료"; notice.analyzedAt=new Date().toISOString(); await saveState(state);
      return json(response,200,{notice,report,reportPath});
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
    json(response, 400, { error: error.message || "처리 중 오류가 발생했습니다." });
  }
});

server.listen(config.port, config.host, () => {
  console.log(`WITHBID PPBM: http://${config.host}:${config.port}`);
  console.log(`데이터 저장 위치: ${config.dataRoot}`);
});
