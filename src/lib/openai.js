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
완제품 컴퓨터나 본체 전체 설명은 complete_system으로 기록하되 내부 부품과 중복 가격을 만들지 않는다. 노트북·서버·워크스테이션·모니터와 제조사/완제품 모델이 명시된 장비는 완제품 모델 검색에 사용할 수 있도록 제조사·정확 모델·구성 SKU를 complete_system 행의 model 제약조건과 searchKeywords에 보존한다. CPU·GPU·RAM·저장장치·화면·운영체제·배터리·중량·보증 같은 세부 조건도 각각 근거가 있는 requirements 행으로 분리한다.
각 구성의 CASE, MAINBOARD, CPU, CPU 쿨러, RAM, SSD/M.2, HDD, POWER, VGA, 운영체제, 주변기기, 소프트웨어와 서비스는 개별 행으로 분리한다.
한 문장에 여러 부품이 있으면 반드시 부품별 requirements 행으로 나눈다. 같은 종류라도 용량·모델·수량이 다르면 각각 독립 행으로 나눈다. 예: 'NVMe U.2 SSD 2개, 1.92TB 1개와 15.36TB 1개'는 M.2 1.92TB 1개와 M.2 15.36TB 1개의 두 행이다. 문장 앞의 부품명이 뒤 문장까지 이어지는 문맥을 보존한다.
장비 전체 납품수량은 systemQuantity, 장비 1대당 부품 수량은 unitQuantity, 전체 부품수량은 quantity에 기록한다.
수량이 원문에 없으면 1로 추정하지 말고 null로 둔다. 두 수량이 확인되면 quantity=systemQuantity*unitQuantity로 계산한다.
정확 모델과 '동급 이상' 사양을 구분한다. 용량·속도·전력·효율·규격은 constraints에 구조화하고 검색 핵심어를 searchKeywords에 기록한다.
GPU 서버라는 단어만 보고 VGA로 분류하지 않는다. 'ASUS 4U GPU Server ESC8000-E12, 최대 8x GPU 탑재 지원'처럼 랙 유닛(nU)·브랜드·모델명이 있는 문장은 그래픽카드가 아니라 섀시(CASE)이며, evidence에 근거가 있으면 condition에 '베어본 포함'을 명시해 메인보드·CPU 쿨러·전원공급장치를 이 섀시가 이미 포함하고 있음을 표시한다. 같은 그래픽카드 모델의 메모리 용량·대역폭·아키텍처·CUDA 코어 수·인터페이스/소비전력·지원 소프트웨어 라이브러리처럼 새 모델명 없이 스펙만 나열하는 문장은 별도 VGA 행이 아니라 그 모델을 명시한 VGA 행의 constraints로 합친다. Ubuntu·Windows·Linux는 software/운영체제, 성능검증·보고서·매뉴얼·교육·연동·설치완료 조건은 실제 부품 사양이 없으면 non_price, 장비 전체 목적·용도 문장은 complete_system으로 분류한다.
입찰자격·제출서류·검수조건·일반 납기 문장은 non_price로 분류한다. 별도 수량이나 비용 항목으로 명시된 설치·교육만 service로 분류한다.
CPU·GPU와 완제품처럼 원문에 정확 제조사·모델·SKU가 있으면 전체 문자열을 model 제약조건과 searchKeywords 첫 항목에 넣는다. '동급 이상'이어도 명시 모델을 기준 모델로 보존한다. 일반규격은 제품종류, 인터페이스, 용량, 속도, 전력, 효율등급 순서로 검색어를 만든다.
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
      properties:{category:{type:"string"},requestedModel:{type:"string"},matchedModel:{type:["string","null"]},specification:{type:["string","null"]},unitPrice:{type:["number","null"]},sourceName:{type:["string","null"],enum:["컴퓨존","가이드컴","다나와","에누리","쿠팡","네이버쇼핑","11번가","G마켓","옥션","SSG","롯데ON","삼성전자","LG전자","HP","Dell","Lenovo","ASUS","HPE","Acer","MSI","Apple","제조사",null]},sourceUrl:{type:["string","null"]},checkedAt:{type:"string"},confidence:{type:"string",enum:["high","medium","low"]},status:{type:"string"},compatibilityStatus:{type:"string",enum:["compatible","review","incompatible"]},compatibilityNotes:{type:"array",items:{type:"string"}}}
    }}
  }}
};

const externalPriceInstructions=`한국 PC 부품 가격 조사자다. 자사 단가표에서 찾지 못한 품목 하나를 조사한다.
검색 우선순위는 1) 컴퓨존, 2) 가이드컴이다. 두 사이트 모두 판매 가능한 후보가 없을 때만 3) 다나와 가격비교를 사용한다.
전체 작업은 같은 사양 그룹 안에서 CPU → MAINBOARD → CPU 쿨러 → RAM → 기본 SSD(M.2) → 추가 HDD → 별도 VGA → POWER → CASE → 운영체제(O/S) → 그 외 순서로 호출된다. 현재 품목을 실제 판매모델로 확정된 선행 부품에 맞춘다. 선행 부품이 미확정이면 호환을 추정하지 말고 review로 기록한다.
입력의 searchProfile.queries를 위에서부터 차례로 검색한다. exactModel이 있으면 정확 모델 상품을 가장 먼저 찾고, 없으면 requiredKeywords의 필수 규격이 많이 일치하는 대체모델을 최대 3개 반환한다. 한 요구사항에 서로 다른 용량/모델을 합쳐 반환하지 않는다. 제조사나 색상보다 칩셋·소켓·용량·속도·전력·효율등급을 우선한다.
핵심 키워드 예: 마이크로닉스 Classic II 850W 80PLUS GOLD는 850W·80PLUS·GOLD, RTX 5060 GAMING DUO D7 8GB는 RTX5060·D7·8GB, DDR5 PC5-48000 16GB는 DDR5-48000·16GB, Ultra 5 225는 Ultra5·225다.
입력의 compatibilityContext에는 같은 사양 그룹에서 앞서 선정한 CPU·메인보드·그래픽카드 등의 정보가 있다. CPU 소켓, 메모리 DDR 규격, CPU 쿨러 소켓, 그래픽카드 권장 출력, 메인보드와 케이스 폼팩터를 대조한다. 불일치 후보는 compatibilityStatus를 incompatible로 기록하고 선정 후보로 추천하지 않는다. 확인할 정보가 부족하면 review로 표시한다.
POWER 품목에 정격 출력(W)이 원문에 명시되지 않았으면, 구성된 CPU와 VGA(그래픽카드)의 공식 최대 소비전력(TDP/PL2)을 각각 검색해 확인하고 메인보드·메모리·저장장치·쿨러 등 나머지 구성 요소의 통상 소비전력을 더한 뒤 20~30% 이상의 여유율을 적용해 필요한 정격 출력을 계산한다. 계산한 용량 이상이면서 80PLUS 인증을 받은 실제 판매 중인 파워서플라이를 선정하고, status에 CPU/VGA 소비전력과 계산한 총 필요 용량을 구체적인 숫자로 기록한다.
각 부품의 필수조건을 하나라도 확인하지 못하면 compatible로 기록하지 않는다. 키워드 일부만 일치하는 상품을 실제 선정모델처럼 반환하지 않는다.
직접 상품 페이지에 표시된 현재 판매가격과 상품 상세 URL만 기록한다. 다나와는 prod.danawa.com/info/ 형식의 pcode가 있는 상품 상세 링크와 가격만 허용한다. 검색결과·카테고리·블로그 링크는 기록하지 않는다. 동일 제품 여러 개가 한 구성에 필요해도 unitPrice는 1개 가격이다.`;

const completeProductPriceInstructions=`현재 품목은 부품 조립 견적이 아니라 노트북·서버·워크스테이션·모니터·브랜드 데스크톱 중 하나의 완제품 한 대다. 서로 다른 판매 모델의 사양이나 가격을 조합하지 말고, 단일 완제품 모델의 제조사 모델명·구성 SKU로 모든 필수 조건을 검증한다.
제조사와 정확 모델 또는 구성 SKU가 명시되어 있으면 그 제품을 항상 가장 먼저 검색한다. 회사 단가표나 다른 쇼핑몰의 유사 모델보다 규격서 명시 모델을 우선한다. '동급 이상'일 때도 명시 모델을 먼저 확인하고 판매중단·가격 비공개·필수조건 미충족일 때만 대체모델을 반환한다.
노트북은 CPU, Laptop GPU와 VRAM, RAM, 저장장치, 화면 크기·해상도·주사율, 배터리, 무게, 운영체제, 전원 어댑터와 보증 조건을 상품 상세나 제조사 사양표에서 대조한다. 서버는 제조사 모델·구성 SKU 하나에 CPU, GPU, RAM, 저장장치, 섀시, 이중화 전원과 보증이 실제 포함되는지 대조한다.
완제품 판매 후보는 컴퓨존·가이드컴뿐 아니라 쿠팡, 네이버쇼핑, G마켓, 11번가, 다나와, 에누리, 옥션, SSG, 롯데ON 등 현재 검색 가능한 국내 판매·가격비교 사이트를 폭넓게 확인한다. 네이버는 검색결과가 아니라 쇼핑 카탈로그, 스마트스토어 또는 브랜드스토어의 개별 상품 페이지를 사용한다. 에누리는 검색 목록이 아니라 modelno 또는 catalog 번호가 있는 개별 상품 상세 페이지를 사용한다.
필수 조건을 모두 확인한 단일 완제품만 compatibilityStatus=compatible로 기록한다. 일부 조건이 상품 페이지에서 확인되지 않으면 review로 기록하고 compatibilityNotes에 미확인 조건을 구체적으로 적는다. 조건에 어긋나면 incompatible로 기록한다.
가격이 공개된 판매 상품은 현재 1대 판매가를 unitPrice에 기록한다. 제조사 공식 모델·구성은 확인되지만 가격이 공개되지 않은 경우 unitPrice는 null로 두고, 직접 제품 상세 URL과 status에 '제조사 구성견적 필요'를 기록한다.`;

function isDirectProductUrl(value) {
  try {
    const url=new URL(value);
    if(url.protocol!=="https:")return false;
    const host=url.hostname.toLowerCase();
    if(host==="www.compuzone.co.kr"||host==="compuzone.co.kr")return /\/product\//i.test(url.pathname);
    if(host==="www.guidecom.co.kr"||host==="guidecom.co.kr")return !/\/search/i.test(url.pathname);
    if(host==="prod.danawa.com")return /^\/info\//i.test(url.pathname)&&Boolean(url.searchParams.get("pcode"));
    if(host.endsWith("coupang.com"))return /^\/vp\/products\//i.test(url.pathname);
    if(host==="search.shopping.naver.com")return /^\/catalog\/\d+/i.test(url.pathname);
    if(host.endsWith("smartstore.naver.com")||host.endsWith("brand.naver.com"))return /\/products\/\d+/i.test(url.pathname);
    if(host.endsWith("shopping.naver.com"))return /\/products\/\d+|\/catalog\/\d+/i.test(url.pathname)&&!/search/i.test(url.href);
    if(host.endsWith("11st.co.kr"))return /^\/products\//i.test(url.pathname);
    if(host==="item.gmarket.co.kr")return /\/item/i.test(url.pathname)&&Boolean(url.searchParams.get("goodscode"));
    if(host==="itempage3.auction.co.kr")return /detailview/i.test(url.pathname)&&Boolean(url.searchParams.get("itemno"));
    if(host.endsWith("ssg.com"))return /\/item\//i.test(url.pathname)||Boolean(url.searchParams.get("itemId"));
    if(host.endsWith("lotteon.com"))return /\/p\/product\//i.test(url.pathname);
    if(host==="price.enuri.com")return /^\/catalog\/\d+/i.test(url.pathname);
    if(host.endsWith("enuri.com"))return (/\/(?:detail|vip)\.jsp/i.test(url.pathname)&&Boolean(url.searchParams.get("modelno")))||/^\/m\/vip\.jsp/i.test(url.pathname)&&Boolean(url.searchParams.get("modelno"));
    if(host.endsWith("samsung.com"))return /\/sec\//i.test(url.pathname)&&!/search/i.test(url.href);
    if(host.endsWith("lge.co.kr"))return url.pathname.split("/").filter(Boolean).length>=1&&!/search/i.test(url.href);
    if(host.endsWith("hp.com"))return /\/shop\//i.test(url.pathname)&&!/search/i.test(url.href);
    if(host.endsWith("dell.com"))return /\/shop\//i.test(url.pathname)&&!/search/i.test(url.href);
    if(host.endsWith("lenovo.com"))return /\/p\//i.test(url.pathname)&&!/search/i.test(url.href);
    if(host.endsWith("asus.com"))return url.pathname.split("/").filter(Boolean).length>=3&&!/search/i.test(url.href);
    if(host.endsWith("hpe.com"))return !/search/i.test(url.href)&&url.pathname!=="/";
    if(host.endsWith("acer.com"))return !/search/i.test(url.href)&&url.pathname!=="/";
    if(host.endsWith("msi.com"))return !/search/i.test(url.href)&&url.pathname!=="/";
    if(host.endsWith("apple.com"))return /\/shop\//i.test(url.pathname)||/\/mac\//i.test(url.pathname);
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
    const completeProduct=requirement.productSearchMode==="complete_product";
    const requested=[requirement.searchProfile?.exactModel,requirement.model,...(requirement.searchProfile?.requiredKeywords||[]),...(requirement.searchKeywords||[])].filter(Boolean).join(" ");
    const searchSites=async(allowedDomains,phase,{allowMissingPrice=false}={})=>{
      const response=await fetchImpl("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:`Bearer ${settings.apiKey}`,"Content-Type":"application/json"},body:JSON.stringify({model:settings.extractionModel||defaults.extractionModel,reasoning:{effort:"low"},tools:[{type:"web_search",filters:{allowed_domains:allowedDomains}}],tool_choice:"required",include:["web_search_call.action.sources"],instructions:`${externalPriceInstructions}\n${completeProduct ? completeProductPriceInstructions : ""}\n이번 검색 단계: ${phase}`,input:JSON.stringify(requirement),store:false,text:{format:{type:"json_schema",name:externalPriceSchema.name,strict:true,schema:externalPriceSchema.value}}})});
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
        .filter(item=>item.compatibilityStatus!=="incompatible"&&(completeProduct
          ? Boolean(item.matchedModel)&&item.confidence!=="low"&&(item.matchType==="exact"||item.matchScore>=85)
          : item.matchType==="exact"||item.matchScore>=({CPU:80,MAINBOARD:80,VGA:85,POWER:75,CASE:75,"운영체제(O/S)":80}[requirement.category]??70)))
        .filter(item=>isDirectProductUrl(item.sourceUrl)&&(Number(item.unitPrice)>0||(completeProduct&&allowMissingPrice)))
        .sort((a,b)=>b.matchScore-a.matchScore||priceSourcePriority(a.sourceName)-priceSourcePriority(b.sourceName)||(Number(a.unitPrice)||Infinity)-(Number(b.unitPrice)||Infinity))
        .slice(0,3);
    };
    const primary=(await searchSites(["compuzone.co.kr","guidecom.co.kr"],"컴퓨존과 가이드컴만 검색한다."))
      .filter(item=>item.sourceName==="컴퓨존"||item.sourceName==="가이드컴");
    if(primary.length)return primary;
    if(!completeProduct)return (await searchSites(["danawa.com"],"앞 단계에 판매 가능한 후보가 없었다. 다나와 가격비교만 검색한다."))
      .filter(item=>item.sourceName==="다나와");
    const marketplaceNames=new Set(["다나와","에누리","쿠팡","네이버쇼핑","11번가","G마켓","옥션","SSG","롯데ON"]);
    const marketplace=await searchSites(["danawa.com","enuri.com","coupang.com","naver.com","11st.co.kr","gmarket.co.kr","auction.co.kr","ssg.com","lotteon.com"],"앞 단계에 적합한 완제품이 없었다. 쿠팡·네이버쇼핑·G마켓·11번가·다나와·에누리를 포함한 국내 가격비교·온라인 쇼핑몰에서 단일 완제품 모델을 검색한다.");
    const marketplaceProducts=marketplace.filter(item=>marketplaceNames.has(item.sourceName));
    if(marketplaceProducts.length)return marketplaceProducts;
    const manufacturerNames=new Set(["삼성전자","LG전자","HP","Dell","Lenovo","ASUS","HPE","Acer","MSI","Apple","제조사"]);
    return (await searchSites(["samsung.com","lge.co.kr","hp.com","dell.com","lenovo.com","asus.com","hpe.com","acer.com","msi.com","apple.com"],"판매몰에서 적합한 완제품을 찾지 못했다. 제조사 공식 제품 상세에서 모델·구성을 확인하고 공개 가격이 없으면 구성견적 필요로 기록한다.",{allowMissingPrice:true}))
      .filter(item=>manufacturerNames.has(item.sourceName));
  };
  const products=[];
  for(const requirement of requirements)products.push(...await searchOne(requirement));
  return products;
}

export function reportToMarkdown(notice, report) {
  const rows = report.configuration.map(i => `| ${i.category} | ${i.requirement} | ${i.selectedModel ?? "확인 필요"} | ${i.unitPrice ?? "-"} | ${i.quantity ?? "-"} | ${i.source} | ${i.status} |`).join("\n");
  return `# 입찰 참가 판단 리포트\n\n## 1. 결론\n**${report.decision}** — ${report.summary}\n\n## 2. 공고 개요\n- 공고번호: ${notice.noticeNumber}\n- 공고명: ${notice.title}\n- 수요기관: ${notice.organization || "확인 필요"}\n- 마감일: ${notice.deadline}\n\n## 3. 자격·인증 검토\n${report.qualificationReview.map(x=>`- ${x}`).join("\n")}\n\n## 4. 구성 견적\n| 구분 | 요구사양 | 선정 모델 | 단가 | 수량 | 가격 출처 | 상태 |\n|---|---|---|---:|---:|---|---|\n${rows}\n\n## 5. 리스크\n${report.risks.map(x=>`- ${x}`).join("\n")}\n\n## 6. 실무 확인 체크리스트\n${report.checklist.map(x=>`- [ ] ${x}`).join("\n")}\n\n---\n본 리포트는 AI 자동 분석 결과이며 최종 투찰 전 담당자의 원문 대조가 필요합니다.\n`;
}
