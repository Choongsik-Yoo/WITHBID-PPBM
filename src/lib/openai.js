import { scoreModelMatch } from "./pricing.js";
import { buildBlockManifest } from "./document-analysis.js";

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

const constraintSchema = {
  type:"object", additionalProperties:false,
  required:["field","operator","value","unit"],
  properties:{
    field:{type:"string"},
    operator:{type:"string",enum:[">=","<=",">","<","==","!=","contains","in","exists"]},
    value:{type:"string"},
    unit:{type:["string","null"]},
  },
};

const extractionSchema = {
  name:"procurement_notice_v2",
  value:{type:"object",additionalProperties:false,
    required:["noticeNumber","title","organization","deadline","budget","qualifications","requirements","uncertainties"],
    properties:{
      noticeNumber:{type:["string","null"]}, title:{type:["string","null"]}, organization:{type:["string","null"]},
      deadline:{type:["string","null"]}, budget:{type:["number","null"]},
      qualifications:{type:"array",items:{type:"string"}},
      requirements:{type:"array",items:{type:"object",additionalProperties:false,
        required:["id","category","condition","quantity","evidence","evidenceBlockIds","specificationGroup","unitQuantity","systemQuantity","priceRole","constraints","searchKeywords","confidence"],
        properties:{
          id:{type:"string"}, category:{type:"string"}, condition:{type:"string"}, quantity:{type:["number","null"]},
          evidence:{type:"string"}, evidenceBlockIds:{type:"array",items:{type:"string"}},
          specificationGroup:{type:["string","null"]}, unitQuantity:{type:["number","null"]}, systemQuantity:{type:["number","null"]},
          priceRole:{type:"string",enum:["component","peripheral","software","service","complete_system","non_price"]},
          constraints:{type:"array",items:constraintSchema}, searchKeywords:{type:"array",items:{type:"string"}},
          confidence:{type:"number",minimum:0,maximum:1},
        },
      }},
      uncertainties:{type:"array",items:{type:"string"}},
    },
  },
};

const reportSchema = {name:"bid_decision_v2",value:{type:"object",additionalProperties:false,
  required:["decision","summary","qualificationReview","risks","checklist"],properties:{
    decision:{type:"string",enum:["참가","조건부 참가","포기"]}, summary:{type:"string"},
    qualificationReview:{type:"array",items:{type:"string"}}, risks:{type:"array",items:{type:"string"}},
    checklist:{type:"array",items:{type:"string"}},
  },
}};

const extractionInstructions = `대한민국 조달공고와 첨부 문서의 의미 구조화 담당자다. 가격 선정과 입찰 판단은 하지 않는다.
제공된 [block ID] 원문을 근거로 독립 납품 대상과 그 내부 부품을 구분한다. 표뿐 아니라 문장·문단·각주도 끝까지 읽는다.
본체사양 1, 본체사양 2, 서버, 워크스테이션, 교사용, 학생용처럼 수량 또는 사양이 다른 대상은 specificationGroup을 분리한다.
완제품 컴퓨터나 본체 전체 설명은 complete_system으로 기록하되 내부 부품과 중복 가격을 만들지 않는다.
각 구성의 CASE, MAINBOARD, CPU, CPU 쿨러, RAM, SSD/M.2, HDD, POWER, VGA, 운영체제, 주변기기, 소프트웨어와 서비스는 개별 행으로 분리한다.
한 문장에 여러 부품이 있으면 반드시 부품별 requirements 행으로 나눈다. 문장 앞의 부품명이 뒤 문장까지 이어지는 문맥을 보존한다.
장비 전체 납품수량은 systemQuantity, 장비 1대당 부품 수량은 unitQuantity, 전체 부품수량은 quantity에 기록한다.
수량이 원문에 없으면 1로 추정하지 말고 null로 둔다. 두 수량이 확인되면 quantity=systemQuantity*unitQuantity로 계산한다.
정확 모델과 '동급 이상' 사양을 구분한다. 용량·속도·전력·효율·규격은 constraints에 구조화하고 검색 핵심어를 searchKeywords에 기록한다.
입찰자격·제출서류·검수조건·일반 납기 문장은 non_price로 분류한다. 설치·교육처럼 별도 비용 가능성이 있는 문장은 service로 분류한다.
evidence는 요약이 아니라 원문 구절을 인용하고, evidenceBlockIds에는 실제 근거 block ID만 기록한다. 원문에 없는 모델·수량·사양은 만들지 않는다.`;

export const extractNotice = ({settings,sourceText,files=[],blocks=[],assessment={},fetchImpl}) => {
  const manifest = blocks.length ? buildBlockManifest(blocks,assessment) : sourceText;
  const content=[{type:"input_text",text:manifest},...files.filter(file=>/\.pdf$/i.test(file.filename)&&file.buffer.length<=20*1024*1024).map(file=>({type:"input_file",filename:file.filename,file_data:`data:application/pdf;base64,${file.buffer.toString("base64")}`}))];
  return call({settings,model:settings.extractionModel||defaults.extractionModel,instructions:extractionInstructions,input:[{role:"user",content}],schema:extractionSchema,fetchImpl});
};

export const analyzeBid = ({settings,extraction,quotePlan,certifications="",targetMargin=12,fetchImpl}) => call({
  settings,model:settings.analysisModel||defaults.analysisModel,
  instructions:"검증된 조달 요구사항과 결정론적으로 작성된 견적 계획을 바탕으로 입찰 참가 여부만 판단한다. 부품, 모델, 단가, 수량 또는 사양 그룹을 새로 만들거나 변경하지 않는다. 단가·수량·원문근거 미확인 및 견적 감사의 blocking 항목은 엄격히 위험과 체크리스트에 반영한다.",
  input:JSON.stringify({extraction,quotePlan,certifications,targetMargin}),schema:reportSchema,fetchImpl,
});

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
    const requested=[requirement.model,...(requirement.searchKeywords||[])].filter(Boolean).join(" ");
    return JSON.parse(responseText(payload)).products.map(item=>({...item,requirementId:requirement.id,specificationGroup:requirement.specificationGroup,unitQuantity:requirement.unitQuantity,systemQuantity:requirement.systemQuantity,priceRole:requirement.priceRole,...scoreModelMatch(requested,item.matchedModel)})).filter(item=>item.matchType==="exact"||item.matchScore>=60||item.matchedKeywords.length>=2).sort((a,b)=>b.matchScore-a.matchScore||Number(b.sourceName==="컴퓨존")-Number(a.sourceName==="컴퓨존")).slice(0,3);
  };
  const products=[];
  for(let index=0;index<requirements.length;index+=3){const batch=await Promise.all(requirements.slice(index,index+3).map(searchOne));products.push(...batch.flat());}
  return products.filter(item=>item.unitPrice>0&&/^https:\/\/(?:www\.)?(?:compuzone\.co\.kr|guidecom\.co\.kr)\//i.test(item.sourceUrl||""));
}

export function reportToMarkdown(notice, report) {
  const rows = report.configuration.map(i => `| ${i.category} | ${i.requirement} | ${i.selectedModel ?? "확인 필요"} | ${i.unitPrice ?? "-"} | ${i.quantity ?? "-"} | ${i.source} | ${i.status} |`).join("\n");
  return `# 입찰 참가 판단 리포트\n\n## 1. 결론\n**${report.decision}** — ${report.summary}\n\n## 2. 공고 개요\n- 공고번호: ${notice.noticeNumber}\n- 공고명: ${notice.title}\n- 수요기관: ${notice.organization || "확인 필요"}\n- 마감일: ${notice.deadline}\n\n## 3. 자격·인증 검토\n${report.qualificationReview.map(x=>`- ${x}`).join("\n")}\n\n## 4. 구성 견적\n| 구분 | 요구사양 | 선정 모델 | 단가 | 수량 | 가격 출처 | 상태 |\n|---|---|---|---:|---:|---|---|\n${rows}\n\n## 5. 리스크\n${report.risks.map(x=>`- ${x}`).join("\n")}\n\n## 6. 실무 확인 체크리스트\n${report.checklist.map(x=>`- [ ] ${x}`).join("\n")}\n\n---\n본 리포트는 AI 자동 분석 결과이며 최종 투찰 전 담당자의 원문 대조가 필요합니다.\n`;
}
