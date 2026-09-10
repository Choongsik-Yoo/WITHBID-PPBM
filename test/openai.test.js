import test from "node:test"; import assert from "node:assert/strict"; import { extractNotice,findExternalPrices,redactSettings,responseText } from "../src/lib/openai.js";
test("API 키를 노출하지 않는다",()=>{const v=redactSettings({apiKey:"sk-proj-abcdefghijklmnop"});assert.equal(v.configured,true);assert.equal("apiKey" in v,false);});
test("Responses 응답 텍스트를 읽는다",()=>assert.equal(responseText({output:[{content:[{type:"output_text",text:"{}"}]}]}),"{}"));
test("외부 가격 검색은 지정 쇼핑몰의 직접 링크만 허용한다",async()=>{let request;const products=[{category:"CPU",requestedModel:"265K",matchedModel:"Intel 265K",specification:"LGA1851 DDR5",unitPrice:499000,sourceName:"컴퓨존",sourceUrl:"https://www.compuzone.co.kr/product/product_detail.htm?ProductNo=1",checkedAt:"2026-07-21",confidence:"high",status:"판매중",compatibilityStatus:"compatible",compatibilityNotes:[]},{category:"CPU",requestedModel:"265K",matchedModel:"Intel 265K",specification:null,unitPrice:450000,sourceName:"컴퓨존",sourceUrl:"https://example.com/fake",checkedAt:"2026-07-21",confidence:"low",status:"확인",compatibilityStatus:"review",compatibilityNotes:[]}];const fetchImpl=async(url,options)=>{request=JSON.parse(options.body);return{ok:true,json:async()=>({output_text:JSON.stringify({products})})}};const result=await findExternalPrices({settings:{apiKey:"secret",extractionModel:"gpt-5.6-luna"},requirements:[{category:"CPU",model:"265K",quantity:1}],fetchImpl});assert.equal(result.length,1);assert.deepEqual(request.tools[0].filters.allowed_domains,["compuzone.co.kr","guidecom.co.kr"]);assert.equal(request.tool_choice,"required");});

test("컴퓨존과 가이드컴 후보가 없을 때 다나와 상세 상품을 사용한다",async()=>{
  const products=[{category:"VGA",requestedModel:"RTX 5060 8GB",matchedModel:"RTX 5060 8GB",specification:"PCIe 5.0, 권장 파워 650W",unitPrice:510000,sourceName:"다나와",sourceUrl:"https://prod.danawa.com/info/?pcode=123456",checkedAt:"2026-09-10",confidence:"high",status:"가격비교 판매중",compatibilityStatus:"compatible",compatibilityNotes:["PCIe 호환"]}];
  const requests=[];
  const fetchImpl=async(url,options)=>{const request=JSON.parse(options.body);requests.push(request);const isDanawa=request.tools[0].filters.allowed_domains.includes("danawa.com");return{ok:true,json:async()=>({output_text:JSON.stringify({products:isDanawa?products:[]})})}};
  const result=await findExternalPrices({settings:{apiKey:"secret"},requirements:[{id:"GPU",category:"VGA",model:"RTX 5060 8GB",compatibilityContext:{}}],fetchImpl});
  assert.equal(result[0].sourceName,"다나와");
  assert.match(result[0].sourceUrl,/prod\.danawa\.com\/info\/\?pcode=/);
  assert.deepEqual(requests.map((request)=>request.tools[0].filters.allowed_domains),[["compuzone.co.kr","guidecom.co.kr"],["danawa.com"]]);
});

test("호환성 보완 부품은 직접 상품이며 핵심 품목어가 맞으면 후보로 유지한다",async()=>{
  const products=[{category:"MAINBOARD",requestedModel:"Xeon 호환 서버 메인보드",matchedModel:"서버 MAINBOARD X13",specification:"DDR5 ECC 서버 메인보드",unitPrice:900000,sourceName:"컴퓨존",sourceUrl:"https://www.compuzone.co.kr/product/product_detail.htm?ProductNo=2",checkedAt:"2026-09-10",confidence:"medium",status:"판매중",compatibilityStatus:"review",compatibilityNotes:["CPU 소켓 확인 필요"]}];
  const fetchImpl=async()=>({ok:true,json:async()=>({output_text:JSON.stringify({products})})});
  const result=await findExternalPrices({settings:{apiKey:"secret"},requirements:[{id:"BOARD",category:"MAINBOARD",model:"서버용 MAINBOARD Intel Xeon 6960P 호환",derivedFromCompatibility:true,searchProfile:{exactModel:null,requiredKeywords:["MAINBOARD","XEON","6960P"]},compatibilityContext:{}}],fetchImpl});
  assert.equal(result.length,1);
  assert.equal(result[0].matchedModel,"서버 MAINBOARD X13");
});

test("문장형 규격서는 원문 블록 ID와 수량 근거를 요구한다",async()=>{
  let request;
  const payload={noticeNumber:"R1",title:"PC 구매",organization:"기관",deadline:null,budget:null,qualifications:[],requirements:[{id:"REQ-1",category:"CPU",condition:"Ultra 5 225",quantity:null,evidence:"CPU Ultra 5 225 이상",evidenceBlockIds:["B1"],specificationGroup:"본체사양 1",unitQuantity:null,systemQuantity:null,priceRole:"component",constraints:[],searchKeywords:["Ultra 5 225"],confidence:0.9}],uncertainties:["수량 확인"]};
  const fetchImpl=async(url,options)=>{request=JSON.parse(options.body);return{ok:true,json:async()=>({output_text:JSON.stringify(payload)})}};
  const result=await extractNotice({settings:{apiKey:"secret",extractionModel:"gpt-5.6-luna"},sourceText:"",files:[],blocks:[{id:"B1",location:"규격서 p.1",text:"CPU Ultra 5 225 이상"}],assessment:{mode:"enhanced_prose",score:40},fetchImpl});
  assert.equal(result.requirements[0].evidenceBlockIds[0],"B1");
  assert.ok(request.instructions.includes("수량이 원문에 없으면 1로 추정하지 말고 null"));
  assert.ok(request.input[0].content[0].text.includes("[B1]"));
});
