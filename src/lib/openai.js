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

export const extractNotice = ({ settings, sourceText, fetchImpl }) => call({ settings, model:settings.extractionModel || defaults.extractionModel, instructions:"대한민국 조달공고를 근거 중심으로 구조화한다. 없는 값은 null로 두고 추측하지 않는다.", input:sourceText, schema:extractionSchema, fetchImpl });
export const analyzeBid = ({ settings, extraction, priceCandidates, certifications="", targetMargin=12, fetchImpl }) => call({ settings, model:settings.analysisModel || defaults.analysisModel, instructions:"입찰 참가 여부를 판단한다. 제공되지 않은 가격을 만들지 말고 필수 자격과 미확인 항목을 엄격히 처리한다.", input:JSON.stringify({extraction,priceCandidates,certifications,targetMargin}), schema:reportSchema, fetchImpl });

export function reportToMarkdown(notice, report) {
  const rows = report.configuration.map(i => `| ${i.category} | ${i.requirement} | ${i.selectedModel ?? "확인 필요"} | ${i.unitPrice ?? "-"} | ${i.quantity ?? "-"} | ${i.source} | ${i.status} |`).join("\n");
  return `# 입찰 참가 판단 리포트\n\n## 1. 결론\n**${report.decision}** — ${report.summary}\n\n## 2. 공고 개요\n- 공고번호: ${notice.noticeNumber}\n- 공고명: ${notice.title}\n- 수요기관: ${notice.organization || "확인 필요"}\n- 마감일: ${notice.deadline}\n\n## 3. 자격·인증 검토\n${report.qualificationReview.map(x=>`- ${x}`).join("\n")}\n\n## 4. 구성 견적\n| 구분 | 요구사양 | 선정 모델 | 단가 | 수량 | 가격 출처 | 상태 |\n|---|---|---|---:|---:|---|---|\n${rows}\n\n## 5. 리스크\n${report.risks.map(x=>`- ${x}`).join("\n")}\n\n## 6. 실무 확인 체크리스트\n${report.checklist.map(x=>`- [ ] ${x}`).join("\n")}\n\n---\n본 리포트는 AI 자동 분석 결과이며 최종 투찰 전 담당자의 원문 대조가 필요합니다.\n`;
}
