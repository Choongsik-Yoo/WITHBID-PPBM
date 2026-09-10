import { priceSourcePriority, scoreModelMatch } from "./pricing.js";
import { evaluateCandidateCompatibility } from "./compatibility.js";
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
출력 전에 내부적으로 ①사양 그룹 경계 ②구매 가능한 개별 SKU ③수량 ④원문 근거를 차례로 점검하고, JSON만 출력한다.
본체사양 1, 본체사양 2, 서버, 워크스테이션, 교사용, 학생용처럼 수량 또는 사양이 다른 대상은 specificationGroup을 분리한다.
완제품 컴퓨터나 본체 전체 설명은 complete_system으로 기록하되 내부 부품과 중복 가격을 만들지 않는다.
각 구성의 CASE, MAINBOARD, CPU, CPU 쿨러, RAM, SSD/M.2, HDD, POWER, VGA, 운영체제, 주변기기, 소프트웨어와 서비스는 개별 행으로 분리한다.
한 문장에 여러 부품이 있으면 반드시 부품별 requirements 행으로 나눈다. 같은 종류라도 용량·모델·수량이 다르면 각각 독립 행으로 나눈다. 예: 'NVMe U.2 SSD 2개, 1.92TB 1개와 15.36TB 1개'는 M.2 1.92TB 1개와 M.2 15.36TB 1개의 두 행이다. 문장 앞의 부품명이 뒤 문장까지 이어지는 문맥을 보존한다.
장비 전체 납품수량은 systemQuantity, 장비 1대당 부품 수량은 unitQuantity, 전체 부품수량은 quantity에 기록한다.
수량이 원문에 없으면 1로 추정하지 말고 null로 둔다. 두 수량이 확인되면 quantity=systemQuantity*unitQuantity로 계산한다.
정확 모델과 '동급 이상' 사양을 구분한다. 용량·속도·전력·효율·규격은 constraints에 구조화하고 검색 핵심어를 searchKeywords에 기록한다.
GPU 서버라는 단어만 보고 VGA로 분류하지 않는다. Ubuntu·Windows·Linux는 software/운영체제, 성능검증·보고서·매뉴얼·교육·연동·설치완료 조건은 실제 부품 사양이 없으면 non_price, 장비 전체 목적·용도 문장은 complete_system으로 분류한다.
입찰자격·제출서류·검수조건·일반 납기 문장은 non_price로 분류한다. 별도 수량이나 비용 항목으로 명시된 설치·교육만 service로 분류한다.
CPU·GPU처럼 원문에 정확 모델이 있으면 모델 문자열 전체를 searchKeywords 첫 항목에 넣는다. 일반규격은 제품종류, 인터페이스, 용량, 속도, 전력, 효율등급 순서로 검색어를 만든다.
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
      required:["category","requestedModel","matchedModel","specification","unitPrice","sourceName","sourceUrl","checkedAt","confidence","status","compatibilityStatus","compatibilityNotes"],
      properties:{category:{type:"string"},requestedModel:{type:"string"},matchedModel:{type:["string","null"]},specification:{type:["string","null"]},unitPrice:{type:["number","null"]},sourceName:{type:["string","null"],enum:["컴퓨존","가이드컴","다나와",null]},sourceUrl:{type:["string","null"]},checkedAt:{type:"string"},confidence:{type:"string",enum:["high","medium","low"]},status:{type:"string"},compatibilityStatus:{type:"string",enum:["compatible","review","incompatible"]},compatibilityNotes:{type:"array",items:{type:"string"}}}
    }}
  }}
};

const externalPriceInstructions=`한국 PC 부품 가격 조사자다. 자사 단가표에서 찾지 못한 품목 하나를 조사한다.
검색 우선순위는 1) 컴퓨존, 2) 가이드컴이다. 두 사이트 모두 판매 가능한 후보가 없을 때만 3) 다나와 가격비교를 사용한다.
전체 작업은 같은 사양 그룹 안에서 CPU → MAINBOARD → CPU 쿨러 → RAM → M.2 → HDD → VGA → POWER → CASE → 운영체제(O/S) → 그 외 순서로 호출된다. 현재 품목을 앞서 선정된 부품에 맞춘다.
입력의 searchProfile.queries를 위에서부터 차례로 검색한다. exactModel이 있으면 정확 모델 상품을 가장 먼저 찾고, 없으면 requiredKeywords의 필수 규격이 많이 일치하는 대체모델을 최대 3개 반환한다. 한 요구사항에 서로 다른 용량/모델을 합쳐 반환하지 않는다. 제조사나 색상보다 칩셋·소켓·용량·속도·전력·효율등급을 우선한다.
핵심 키워드 예: 마이크로닉스 Classic II 850W 80PLUS GOLD는 850W·80PLUS·GOLD, RTX 5060 GAMING DUO D7 8GB는 RTX5060·D7·8GB, DDR5 PC5-48000 16GB는 DDR5-48000·16GB, Ultra 5 225는 Ultra5·225다.
입력의 compatibilityContext에는 같은 사양 그룹에서 앞서 선정한 CPU·메인보드·그래픽카드 등의 정보가 있다. CPU 소켓, 메모리 DDR 규격, CPU 쿨러 소켓, 그래픽카드 권장 출력, 메인보드와 케이스 폼팩터를 대조한다. 불일치 후보는 compatibilityStatus를 incompatible로 기록하고 선정 후보로 추천하지 않는다. 확인할 정보가 부족하면 review로 표시한다.
직접 상품 페이지에 표시된 현재 판매가격과 상품 상세 URL만 기록한다. 다나와는 prod.danawa.com/info/ 형식의 pcode가 있는 상품 상세 링크와 가격만 허용한다. 검색결과·카테고리·블로그 링크는 기록하지 않는다. 동일 제품 여러 개가 한 구성에 필요해도 unitPrice는 1개 가격이다.`;

function isDirectProductUrl(value) {
  try {
    const url=new URL(value);
    if(url.protocol!=="https:")return false;
    const host=url.hostname.toLowerCase();
    if(host==="www.compuzone.co.kr"||host==="compuzone.co.kr")return /\/product\//i.test(url.pathname);
    if(host==="www.guidecom.co.kr"||host==="guidecom.co.kr")return !/\/search/i.test(url.pathname);
    if(host==="prod.danawa.com")return /^\/info\//i.test(url.pathname)&&Boolean(url.searchParams.get("pcode"));
    return false;
  } catch { return false; }
}

function mergeCompatibility(requirement,item) {
  const local=evaluateCandidateCompatibility(requirement,item,requirement.compatibilityContext||{});
  const aiStatus=item.compatibilityStatus||"review";
  const compatibilityStatus=local.compatibilityStatus==="incompatible"||aiStatus==="incompatible"
    ? "incompatible"
    : local.compatibilityStatus==="compatible"||aiStatus==="compatible" ? "compatible" : "review";
  return {...local,compatibilityStatus,compatibilityNotes:[...new Set([...(item.compatibilityNotes||[]),...(local.compatibilityNotes||[])])]};
}

export async function findExternalPrices({settings,requirements,fetchImpl=fetch}) {
  if(!requirements.length)return [];
  const searchOne=async requirement=>{
    const requested=[requirement.searchProfile?.exactModel,requirement.model,...(requirement.searchProfile?.requiredKeywords||[]),...(requirement.searchKeywords||[])].filter(Boolean).join(" ");
    const searchSites=async(allowedDomains,phase)=>{
      const response=await fetchImpl("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:`Bearer ${settings.apiKey}`,"Content-Type":"application/json"},body:JSON.stringify({model:settings.extractionModel||defaults.extractionModel,reasoning:{effort:"low"},tools:[{type:"web_search",filters:{allowed_domains:allowedDomains}}],tool_choice:"required",include:["web_search_call.action.sources"],instructions:`${externalPriceInstructions}\n이번 검색 단계: ${phase}`,input:JSON.stringify(requirement),store:false,text:{format:{type:"json_schema",name:externalPriceSchema.name,strict:true,schema:externalPriceSchema.value}}})});
      const payload=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(payload.error?.message||`외부 가격 검색 오류 (${response.status})`);
      return JSON.parse(responseText(payload)).products
        .map(item=>{
          const candidateText=[item.matchedModel,item.specification].filter(Boolean).join(" ");
          const directMatch=scoreModelMatch(requirement.model,candidateText);
          const keywordMatch=scoreModelMatch(requested,candidateText);
          const match=directMatch.matchType==="exact"?directMatch:keywordMatch;
          return {...item,requirementId:requirement.id,specificationGroup:requirement.specificationGroup,unitQuantity:requirement.unitQuantity,systemQuantity:requirement.systemQuantity,priceRole:requirement.priceRole,...match,...mergeCompatibility(requirement,item)};
        })
        .filter(item=>item.compatibilityStatus!=="incompatible"&&(item.matchType==="exact"||item.matchScore>=60||item.matchedKeywords.length>=2||(requirement.derivedFromCompatibility&&item.confidence!=="low"&&item.matchedKeywords.length>=1)))
        .filter(item=>Number(item.unitPrice)>0&&isDirectProductUrl(item.sourceUrl))
        .sort((a,b)=>b.matchScore-a.matchScore||priceSourcePriority(a.sourceName)-priceSourcePriority(b.sourceName)||a.unitPrice-b.unitPrice)
        .slice(0,3);
    };
    const primary=(await searchSites(["compuzone.co.kr","guidecom.co.kr"],"컴퓨존과 가이드컴만 검색한다."))
      .filter(item=>item.sourceName==="컴퓨존"||item.sourceName==="가이드컴");
    if(primary.length)return primary;
    return (await searchSites(["danawa.com"],"앞 단계에 판매 가능한 후보가 없었다. 다나와 가격비교만 검색한다."))
      .filter(item=>item.sourceName==="다나와");
  };
  const products=[];
  for(const requirement of requirements)products.push(...await searchOne(requirement));
  return products;
}

export function reportToMarkdown(notice, report) {
  const rows = report.configuration.map(i => `| ${i.category} | ${i.requirement} | ${i.selectedModel ?? "확인 필요"} | ${i.unitPrice ?? "-"} | ${i.quantity ?? "-"} | ${i.source} | ${i.status} |`).join("\n");
  return `# 입찰 참가 판단 리포트\n\n## 1. 결론\n**${report.decision}** — ${report.summary}\n\n## 2. 공고 개요\n- 공고번호: ${notice.noticeNumber}\n- 공고명: ${notice.title}\n- 수요기관: ${notice.organization || "확인 필요"}\n- 마감일: ${notice.deadline}\n\n## 3. 자격·인증 검토\n${report.qualificationReview.map(x=>`- ${x}`).join("\n")}\n\n## 4. 구성 견적\n| 구분 | 요구사양 | 선정 모델 | 단가 | 수량 | 가격 출처 | 상태 |\n|---|---|---|---:|---:|---|---|\n${rows}\n\n## 5. 리스크\n${report.risks.map(x=>`- ${x}`).join("\n")}\n\n## 6. 실무 확인 체크리스트\n${report.checklist.map(x=>`- [ ] ${x}`).join("\n")}\n\n---\n본 리포트는 AI 자동 분석 결과이며 최종 투찰 전 담당자의 원문 대조가 필요합니다.\n`;
}
