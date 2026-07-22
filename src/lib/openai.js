import { scoreModelMatch } from "./pricing.js";

const defaults = { extractionModel: "gpt-5.6-luna", analysisModel: "gpt-5.6-terra" };

export function redactSettings(settings = {}) {
  return { configured: Boolean(settings.apiKey), extractionModel: settings.extractionModel || defaults.extractionModel, analysisModel: settings.analysisModel || defaults.analysisModel, keyHint: settings.apiKey ? `${settings.apiKey.slice(0, 7)}…${settings.apiKey.slice(-4)}` : "" };
}

export function responseText(payload) {
  if (typeof payload.output_text === "string") return payload.output_text;
  for (const item of payload.output || []) for (const content of item.content || []) if (content.type === "output_text") return content.text;
  throw new Error("OpenAI 응답에서 분석 결과를 찾지 못했습니다.");
}

async function call({ settings, model, instructions, input, schema, fetchImpl = fetch }) {
  const response = await fetchImpl("https://api.openai.com/v1/responses", { method:"POST", headers:{ Authorization:`Bearer ${settings.apiKey}`, "Content-Type":"application/json" }, body:JSON.stringify({ model, reasoning:{ effort:"medium" }, instructions, input, store:false, text:{ format:{ type:"json_schema", name:schema.name, strict:true, schema:schema.value } } }) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || `OpenAI API 오류 (${response.status})`);
  return JSON.parse(responseText(payload));
}

const extractionSchema = { name:"procurement_notice", value:{ type:"object", additionalProperties:false, required:["noticeNumber","title","organization","deadline","budget","qualifications","requirements","uncertainties"], properties:{ noticeNumber:{type:["string","null"]}, title:{type:["string","null"]}, organization:{type:["string","null"]}, deadline:{type:["string","null"]}, budget:{type:["number","null"]}, qualifications:{type:"array",items:{type:"string"}}, requirements:{type:"array",items:{type:"object",additionalProperties:false,required:["category","condition","quantity","evidence"],properties:{category:{type:"string"},condition:{type:"string"},quantity:{type:["number","null"]},evidence:{type:"string"}}}}, uncertainties:{type:"array",items:{type:"string"}} } } };
const reportSchema = { name:"bid_decision", value:{ type:"object", additionalProperties:false, required:["decision","summary","qualificationReview","configuration","risks","checklist"], properties:{ decision:{type:"string",enum:["참가","조건부 참가","포기"]}, summary:{type:"string"}, qualificationReview:{type:"array",items:{type:"string"}}, configuration:{type:"array",items:{type:"object",additionalProperties:false,required:["category","requirement","selectedModel","unitPrice","quantity","source","status"],properties:{category:{type:"string"},requirement:{type:"string"},selectedModel:{type:["string","null"]},unitPrice:{type:["number","null"]},quantity:{type:["number","null"]},source:{type:"string"},status:{type:"string"}}}}, risks:{type:"array",items:{type:"string"}}, checklist:{type:"array",items:{type:"string"}} } } };

export const extractNotice = ({ settings, sourceText, files=[], fetchImpl }) => { const content=[{type:"input_text",text:sourceText},...files.filter(file=>/\.pdf$/i.test(file.filename)&&file.buffer.length<=20*1024*1024).map(file=>({type:"input_file",filename:file.filename,file_data:`data:application/pdf;base64,${file.buffer.toString("base64")}`}))]; return call({ settings, model:settings.extractionModel || defaults.extractionModel, instructions:"대한민국 조달공고와 첨부 PDF를 근거 중심으로 구조화한다. 없는 값은 null로 두고 추측하지 않는다. 제품사양서의 하드웨어 부품, 주변기기, 운영체제, 소프트웨어 및 라이선스는 가격 검색이 가능하도록 모델별로 각각 별도의 requirements 행에 기록한다. SSD와 HDD, 케이스와 파워와 쿨러, 여러 소프트웨어를 한 행에 합치지 않는다. quantity는 전체 납품수량으로 계산한다. 예를 들어 PC 21대에 메모리 2개씩이면 메모리 수량은 42다.", input:[{role:"user",content}], schema:extractionSchema, fetchImpl }); };
export const analyzeBid = ({ settings, extraction, priceCandidates, certifications="", targetMargin=12, fetchImpl }) => call({ settings, model:settings.analysisModel || defaults.analysisModel, instructions:"입찰 참가 여부를 판단한다. 제공되지 않은 가격을 만들지 말고 필수 자격과 미확인 항목을 엄격히 처리한다. 가격 후보의 sourceUrl이 있으면 구성 견적의 source에 그 URL을 그대로 기록한다. 복합 요구사항에 제품별 가격 후보가 있으면 견적 행을 제품별로 분리한다.", input:JSON.stringify({extraction,priceCandidates,certifications,targetMargin}), schema:reportSchema, fetchImpl });

const externalPriceSchema={
  name:"external_product_prices",
  value:{type:"object",additionalProperties:false,required:["products"],properties:{
    products:{type:"array",items:{type:"object",additionalProperties:false,
      required:["category","requestedModel","matchedModel","unitPrice","sourceName","sourceUrl","checkedAt","confidence","status"],
      properties:{category:{type:"string"},requestedModel:{type:"string"},matchedModel:{type:["string","null"]},unitPrice:{type:["number","null"]},sourceName:{type:["string","null"],enum:["컴퓨존","가이드컴",null]},sourceUrl:{type:["string","null"]},checkedAt:{type:"string"},confidence:{type:"string",enum:["high","medium","low"]},status:{type:"string"}}
    }}
  }}
};

export async function findExternalPrices({settings,requirements,fetchImpl=fetch}) {
  if(!requirements.length)return [];
  const searchOne=async requirement=>{
    const response=await fetchImpl("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:`Bearer ${settings.apiKey}`,"Content-Type":"application/json"},body:JSON.stringify({model:settings.extractionModel||defaults.extractionModel,reasoning:{effort:"low"},tools:[{type:"web_search",filters:{allowed_domains:["compuzone.co.kr","guidecom.co.kr"]}}],tool_choice:"required",include:["web_search_call.action.sources"],instructions:"한국 PC 부품 가격 조사자다. 자사 단가표에서 찾지 못한 품목 하나를 조사한다. 1) 컴퓨존 동일 모델, 2) 가이드컴 동일 모델, 3) 동일 모델이 없으면 핵심 키워드가 많이 일치하는 대체모델 순으로 최대 3개를 반환한다. 핵심 키워드 예: 마이크로닉스 Classic II 850W 80PLUS GOLD는 850W·80PLUS·GOLD, RTX 5060 GAMING DUO D7 8GB는 RTX5060·D7·8GB, DDR5 PC5-48000 16GB는 DDR5-48000·16GB, Ultra 5 225는 Ultra5·225다. 제조사나 색상보다 칩셋·용량·속도·전력·효율등급을 우선한다. 정확 모델이 아니면 status에 '대체모델 후보'와 일치 핵심 키워드를 반드시 적는다. 직접 상품 페이지에 명시된 현재 판매가격과 직접 URL만 기록한다. 동일 제품 여러 개가 한 구성에 필요하면 unitPrice는 1개 가격이다.",input:JSON.stringify(requirement),store:false,text:{format:{type:"json_schema",name:externalPriceSchema.name,strict:true,schema:externalPriceSchema.value}}})});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(payload.error?.message||`외부 가격 검색 오류 (${response.status})`);
    return JSON.parse(responseText(payload)).products.map(item=>({...item,...scoreModelMatch(requirement.model,item.matchedModel)})).filter(item=>item.matchType==="exact"||item.matchScore>=60||item.matchedKeywords.length>=2).sort((a,b)=>b.matchScore-a.matchScore||Number(b.sourceName==="컴퓨존")-Number(a.sourceName==="컴퓨존")).slice(0,3);
  };
  const products=[];
  for(let index=0;index<requirements.length;index+=3){const batch=await Promise.all(requirements.slice(index,index+3).map(searchOne));products.push(...batch.flat());}
  return products.filter(item=>item.unitPrice>0&&/^https:\/\/(?:www\.)?(?:compuzone\.co\.kr|guidecom\.co\.kr)\//i.test(item.sourceUrl||""));
}

export function reportToMarkdown(notice, report) {
  const rows = report.configuration.map(i => `| ${i.category} | ${i.requirement} | ${i.selectedModel ?? "확인 필요"} | ${i.unitPrice ?? "-"} | ${i.quantity ?? "-"} | ${i.source} | ${i.status} |`).join("\n");
  return `# 입찰 참가 판단 리포트\n\n## 1. 결론\n**${report.decision}** — ${report.summary}\n\n## 2. 공고 개요\n- 공고번호: ${notice.noticeNumber}\n- 공고명: ${notice.title}\n- 수요기관: ${notice.organization || "확인 필요"}\n- 마감일: ${notice.deadline}\n\n## 3. 자격·인증 검토\n${report.qualificationReview.map(x=>`- ${x}`).join("\n")}\n\n## 4. 구성 견적\n| 구분 | 요구사양 | 선정 모델 | 단가 | 수량 | 가격 출처 | 상태 |\n|---|---|---|---:|---:|---|---|\n${rows}\n\n## 5. 리스크\n${report.risks.map(x=>`- ${x}`).join("\n")}\n\n## 6. 실무 확인 체크리스트\n${report.checklist.map(x=>`- [ ] ${x}`).join("\n")}\n\n---\n본 리포트는 AI 자동 분석 결과이며 최종 투찰 전 담당자의 원문 대조가 필요합니다.\n`;
}
