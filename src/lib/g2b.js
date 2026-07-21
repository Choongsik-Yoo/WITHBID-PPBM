const BASE = "https://apis.data.go.kr/1230000/ad/BidPublicInfoService";
const DETAIL_OPERATIONS = ["getBidPblancListInfoThngPPSSrch","getBidPblancListInfoServcPPSSrch","getBidPblancListInfoCnstwkPPSSrch","getBidPblancListInfoFrgcptPPSSrch","getBidPblancListInfoEtcPPSSrch"];

export function parseG2bLink(value) {
  const url=new URL(value); return { bidPbancNo:url.searchParams.get("bidPbancNo")||"", bidPbancOrd:url.searchParams.get("bidPbancOrd")||"000" };
}
function items(payload) { const value=payload?.response?.body?.items; if(Array.isArray(value)) return value; if(Array.isArray(value?.item)) return value.item; if(value?.item) return [value.item]; return []; }
async function query(operation, key, params, fetchImpl) { const url=new URL(`${BASE}/${operation}`); let decodedKey=key; try{decodedKey=decodeURIComponent(key);}catch{} Object.entries({serviceKey:decodedKey,pageNo:"1",numOfRows:"100",type:"json",...params}).forEach(([k,v])=>url.searchParams.set(k,v)); const response=await fetchImpl(url); if(!response.ok) throw new Error(`나라장터 API 오류 (${response.status})`); return items(await response.json()); }

export async function fetchG2bNotice({apiKey,bidPbancNo,bidPbancOrd="000",fetchImpl=fetch}) {
  let detail=[];
  for(const operation of DETAIL_OPERATIONS) { detail=await query(operation,apiKey,{bidPbancNo,bidPbancOrd},fetchImpl); if(detail.length) break; }
  if(!detail.length) throw new Error("공식 API에서 공고 정보를 찾지 못했습니다. API 활용신청 상태와 공고번호를 확인하세요.");
  let attachments=[]; try { attachments=await query("getBidPblancListInfoEorderAtchFileInfo",apiKey,{bidPbancNo,bidPbancOrd},fetchImpl); } catch { attachments=[]; }
  return { detail:detail[0], attachments };
}

export function g2bToText(result) { return `나라장터 공식 API 공고정보\n${JSON.stringify(result.detail,null,2)}\n\n첨부파일정보\n${JSON.stringify(result.attachments,null,2)}`; }
export function attachmentUrl(item) { const entry=Object.entries(item||{}).find(([key,value])=>/url/i.test(key)&&/^https?:/i.test(String(value))); return entry?.[1]||""; }
export function attachmentName(item,index) { const entry=Object.entries(item||{}).find(([key])=>/(file.*nm|atch.*nm|filename)/i.test(key)); return String(entry?.[1]||`첨부파일_${index+1}`); }
