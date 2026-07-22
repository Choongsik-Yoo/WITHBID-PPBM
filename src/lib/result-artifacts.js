import ExcelJS from "exceljs";
import { buildQuoteGroups, isWholeSystemItem } from "./quote-structure.js";

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[ch]);
const won = (value) => value == null ? "미확인" : `${Number(value).toLocaleString("ko-KR")}원`;
const moneyFormat = '#,##0"원"';

export function reportToDashboardHtml(notice, report, extraction = {}) {
  const configuration = report.configuration.filter((item) => !isWholeSystemItem(item) && item.priceRole !== "non_price");
  const priced = configuration.filter((item) => Number.isFinite(item.unitPrice));
  const total = priced.reduce((sum, item) => sum + item.unitPrice * (item.quantity || 0), 0);
  const decisionClass = report.decision === "참가" ? "go" : report.decision === "포기" ? "stop" : "conditional";
  const list = (items) => items.map((item) => `<li>${esc(item)}</li>`).join("");
  const source = (value) => /^https:\/\//i.test(value || "") ? `<a href="${esc(value)}" target="_blank" rel="noreferrer">상품 링크 ↗</a>` : esc(value);
  const rows = configuration.map((item) => `<tr><td>${esc(item.specificationGroup || "공통")}</td><td>${esc(item.category)}</td><td>${esc(item.requirement)}</td><td>${esc(item.selectedModel || "확인 필요")}</td><td class="num">${item.unitPrice == null ? "-" : won(item.unitPrice)}</td><td class="num">${esc(item.quantity ?? "-")}</td><td>${source(item.source)}</td><td><span class="tag">${esc(item.status)}</span></td></tr>`).join("");
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(notice.title)} - 입찰참가판단 대시보드</title><style>
  :root{--navy:#12372a;--green:#0c694c;--cream:#f7f5ef;--line:#dce3dc;--text:#1e2923;--muted:#66736c;--amber:#b7791f;--red:#b33a2b}*{box-sizing:border-box}body{margin:0;background:var(--cream);color:var(--text);font-family:"Malgun Gothic",Arial,sans-serif}.wrap{max-width:1440px;margin:auto;padding:32px}.hero{padding:30px;border-radius:22px;background:linear-gradient(135deg,var(--navy),#195b43);color:white}.eyebrow{font-size:13px;letter-spacing:.12em;opacity:.8}.hero h1{margin:10px 0 18px;font-size:30px}.decision{display:inline-flex;padding:10px 16px;border-radius:999px;background:#fff;color:var(--navy);font-weight:800}.decision.conditional{color:var(--amber)}.decision.stop{color:var(--red)}.summary{max-width:1050px;line-height:1.75}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin:18px 0}.card,.panel{background:white;border:1px solid var(--line);border-radius:16px;padding:20px;box-shadow:0 7px 24px #153d2710}.card .label{color:var(--muted);font-size:13px}.card .value{margin-top:9px;font-size:20px;font-weight:800}.columns{display:grid;grid-template-columns:1fr 1fr;gap:18px}.panel{margin-bottom:18px}.panel h2{margin:0 0 14px;font-size:19px}.panel li{margin:9px 0;line-height:1.55}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;font-size:13px}th{background:#e8f0eb;text-align:left;padding:12px;white-space:nowrap}td{padding:12px;border-bottom:1px solid #e8ece9;vertical-align:top;line-height:1.45}.num{text-align:right;white-space:nowrap}.tag{display:inline-block;background:#edf2ef;border-radius:999px;padding:5px 8px}footer{color:var(--muted);font-size:12px;text-align:center;padding:12px}@media(max-width:900px){.grid{grid-template-columns:1fr 1fr}.columns{grid-template-columns:1fr}.wrap{padding:16px}}@media print{body{background:white}.wrap{max-width:none;padding:0}.card,.panel{box-shadow:none;break-inside:avoid}}
  </style></head><body><main class="wrap"><section class="hero"><div class="eyebrow">WITHBID-PPBM · PROCUREMENT DECISION</div><h1>${esc(notice.title)}</h1><div class="decision ${decisionClass}">${esc(report.decision)}</div><p class="summary">${esc(report.summary)}</p></section><section class="grid"><div class="card"><div class="label">공고번호</div><div class="value">${esc(notice.noticeNumber)}</div></div><div class="card"><div class="label">수요기관</div><div class="value">${esc(notice.organization || "확인 필요")}</div></div><div class="card"><div class="label">마감일</div><div class="value">${esc(notice.deadline)}</div></div><div class="card"><div class="label">예산 / 확인 원가</div><div class="value">${won(extraction.budget)} / ${won(total || null)}</div></div></section><section class="columns"><div><article class="panel"><h2>자격·인증 검토</h2><ul>${list(report.qualificationReview)}</ul></article><article class="panel"><h2>주요 리스크</h2><ul>${list(report.risks)}</ul></article></div><article class="panel"><h2>실무 확인 체크리스트</h2><ul>${list(report.checklist)}</ul></article></section><article class="panel"><h2>사양별 부품 구성 견적</h2><div class="table-wrap"><table><thead><tr><th>사양 그룹</th><th>구분</th><th>요구사양</th><th>선정 모델</th><th>단가</th><th>전체수량</th><th>가격 출처</th><th>상태</th></tr></thead><tbody>${rows}</tbody></table></div></article><footer>완제품 본체 가격은 제외하고, 사양별 구성 부품 원가를 합산한 결과입니다. 최종 투찰 전 원문과 담당자 검토가 필요합니다.</footer></main></body></html>`;
}

const componentTemplate = [
  ["CASE", { requirement:null, model:null, unitPrice:null, quantity:1 }],
  ["MAINBOARD", { requirement:null, model:null, unitPrice:null, quantity:1 }],
  ["CPU", { requirement:null, model:null, unitPrice:null, quantity:1 }],
  ["CPU 쿨러", { requirement:null, model:null, unitPrice:null, quantity:1 }],
  ["RAM", { requirement:null, model:null, unitPrice:null, quantity:1 }],
  ["M.2", { requirement:null, model:null, unitPrice:null, quantity:1 }],
  ["HDD", { requirement:null, model:null, unitPrice:null, quantity:1 }],
  ["POWER", { requirement:null, model:null, unitPrice:null, quantity:1 }],
  ["VGA", { requirement:null, model:null, unitPrice:null, quantity:1 }],
  ["운영체제(O/S)", { requirement:null, model:null, unitPrice:null, quantity:1 }],
  ["K/B(OEM)", { requirement:null, model:"WITHUS OEM K/B(USB)", unitPrice:10000, quantity:1 }],
  ["MOUSE(OEM)", { requirement:null, model:"WITHUS OEM MOUSE(USB)", unitPrice:5500, quantity:1 }],
  ["마우스패드", { requirement:null, model:"WITHUS MOUSE PAD", unitPrice:1100, quantity:1 }],
  ["옵션 1", { requirement:null, model:null, unitPrice:null, quantity:null }],
  ["옵션 2", { requirement:null, model:null, unitPrice:null, quantity:null }],
  ["옵션 3", { requirement:null, model:null, unitPrice:null, quantity:null }],
  ["박스(OEM)", { requirement:"데스크탑 미들박스", model:"데스크탑 미들박스", unitPrice:4000, quantity:1 }],
  ["배송비", { requirement:"배송비", model:"배송비", unitPrice:5000, quantity:1 }],
  ["입가공비", { requirement:"데스크탑 입가공비", model:"데스크탑 입가공비", unitPrice:13200, quantity:1 }],
  ["납품설치비", { requirement:"납품설치비", model:"납품설치비", unitPrice:30000, quantity:1 }],
];

function makeRows(group) {
  const used = new Set();
  const isComputerGroup = /^본체사양\s*\d+/i.test(group.name) || group.items.some((item) => ["CPU", "MAINBOARD", "RAM", "VGA"].includes(item.category));
  const rows = isComputerGroup ? componentTemplate.map(([category, defaults]) => {
    const index = group.items.findIndex((item, i) => !used.has(i) && item.category === category);
    const item = index >= 0 ? group.items[index] : null;
    if (index >= 0) used.add(index);
    const wholeSystemMistake = item && /데스크[탑톱]|완제품|워크스테이션|프로맥스/i.test(String(item.selectedModel || ""));
    return {
      category,
      requirement:item?.requirement || defaults.requirement,
      selectedModel:wholeSystemMistake ? null : item?.selectedModel || defaults.model,
      unitPrice:wholeSystemMistake ? null : item?.unitPrice ?? defaults.unitPrice,
      unitQuantity:item?.unitQuantity ?? defaults.quantity,
      source:wholeSystemMistake ? null : item?.source || null,
      status:wholeSystemMistake ? "완제품 가격 오인식 제외 · 해당 부품 단가 재확인" : item?.status || (defaults.requirement ? "기본 원가" : null),
    };
  }) : [];
  for (const [index, item] of group.items.entries()) if (!used.has(index)) rows.push({
    category:item.category, requirement:item.requirement || null, selectedModel:item.selectedModel || null,
    unitPrice:item.unitPrice, unitQuantity:item.unitQuantity, source:item.source || null, status:item.status || null,
  });
  return rows;
}

function safeSheetName(value, used) {
  const base = String(value || "사양").replace(/[\\/?*\[\]:]/g, " ").trim().slice(0, 27) || "사양";
  let name = base; let suffix = 2;
  while (used.has(name)) name = `${base.slice(0, 24)}_${suffix++}`;
  used.add(name); return name;
}

function styleTitle(sheet, title) {
  sheet.mergeCells("A1:H2"); sheet.getCell("A1").value = title;
  sheet.getCell("A1").font = { name:"맑은 고딕", size:22, bold:true, color:{argb:"FFFFFFFF"} };
  sheet.getCell("A1").alignment = { vertical:"middle", horizontal:"center" };
  sheet.getCell("A1").fill = { type:"pattern", pattern:"solid", fgColor:{argb:"FF12372A"} };
}

function styleHeader(row) {
  row.height = 28;
  row.eachCell((cell) => { cell.font={bold:true,color:{argb:"FFFFFFFF"}}; cell.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF0C694C"}}; cell.alignment={vertical:"middle",horizontal:"center"}; });
}

function addMetadata(sheet, notice, extraction, targetMargin, group = null) {
  const meta = group
    ? [["사양 그룹",group.name,"납품수량",group.systemQuantity],["공고번호",notice.noticeNumber,"수요기관",notice.organization || "확인 필요"],["목표마진",targetMargin / 100,"예산(부가세 포함)",extraction.budget ?? null]]
    : [["공고번호",notice.noticeNumber,"공고명",notice.title],["수요기관",notice.organization || "확인 필요","마감일",notice.deadline],["예산(부가세 포함)",extraction.budget ?? null,"목표마진",targetMargin / 100]];
  meta.forEach((values, index) => { const r=4+index; sheet.getCell(r,1).value=values[0]; sheet.mergeCells(r,2,r,3); sheet.getCell(r,2).value=values[1]; sheet.getCell(r,4).value=values[2]; sheet.mergeCells(r,5,r,8); sheet.getCell(r,5).value=values[3]; for(const c of [1,4]){sheet.getCell(r,c).font={bold:true,color:{argb:"FF385448"}};sheet.getCell(r,c).fill={type:"pattern",pattern:"solid",fgColor:{argb:"FFE8F0EB"}};} });
}

export async function quoteWorkbookBuffer(notice, report, extraction = {}, targetMargin = 12) {
  const workbook = new ExcelJS.Workbook(); workbook.creator="WITHBID-PPBM"; workbook.created=new Date();
  const groups = buildQuoteGroups(report.configuration);
  const usedSheetNames = new Set(["통합견적", "검토사항"]);
  const details = groups.map((group) => ({ group, rows:makeRows(group), sheetName:safeSheetName(group.name, usedSheetNames) }));

  const summary = workbook.addWorksheet("통합견적", { views:[{showGridLines:false,state:"frozen",ySplit:9}] });
  summary.columns=[{width:20},{width:42},{width:18},{width:13},{width:18},{width:17},{width:18},{width:15}];
  styleTitle(summary, "사양별 통합 견적서"); addMetadata(summary, notice, extraction, targetMargin);
  summary.getRow(9).values=["사양 그룹","구성 설명","1대당 원가","납품수량","공급가액","부가세","합계","미확인 단가"];
  styleHeader(summary.getRow(9));

  const detailRefs = [];
  for (const detail of details) {
    const { group, rows, sheetName } = detail;
    const sheet = workbook.addWorksheet(sheetName, { views:[{showGridLines:false,state:"frozen",ySplit:9}] });
    sheet.columns=[{width:18},{width:42},{width:38},{width:15},{width:12},{width:18},{width:20},{width:28}];
    styleTitle(sheet, `${group.name} 부품 구성 견적`); addMetadata(sheet, notice, extraction, targetMargin, group);
    sheet.getCell("B6").numFmt="0.0%"; sheet.getCell("E6").numFmt=moneyFormat;
    sheet.getRow(9).values=["구분","요구사양","선정모델","부품단가","1대당 수량","1대당 금액","가격 출처","매칭 상태"];
    styleHeader(sheet.getRow(9));
    const start=10;
    rows.forEach((item,index)=>{const r=start+index;sheet.getRow(r).values=[item.category,item.requirement,item.selectedModel,item.unitPrice,item.unitQuantity,{formula:`IF(OR(D${r}="",E${r}=""),0,D${r}*E${r})`},/^https:\/\//i.test(item.source||"")?{text:"상품 링크",hyperlink:item.source}:item.source,item.status];sheet.getRow(r).height=34;sheet.getRow(r).alignment={vertical:"middle",wrapText:true};if(/^https:\/\//i.test(item.source||""))sheet.getCell(r,7).font={color:{argb:"FF0563C1"},underline:true};});
    const end=start+rows.length-1; const subtotal=end+1; const groupTotal=subtotal+1; const vat=groupTotal+1; const grand=vat+1;
    sheet.mergeCells(subtotal,1,subtotal,5); sheet.getCell(subtotal,1).value="1대당 부품원가"; sheet.getCell(subtotal,6).value={formula:`SUM(F${start}:F${end})`};
    sheet.mergeCells(groupTotal,1,groupTotal,5); sheet.getCell(groupTotal,1).value=`공급가액 (${group.systemQuantity}대)`; sheet.getCell(groupTotal,6).value={formula:`F${subtotal}*E4`};
    sheet.mergeCells(vat,1,vat,5); sheet.getCell(vat,1).value="부가세"; sheet.getCell(vat,6).value={formula:`F${groupTotal}*10%`};
    sheet.mergeCells(grand,1,grand,5); sheet.getCell(grand,1).value="사양별 합계"; sheet.getCell(grand,6).value={formula:`F${groupTotal}+F${vat}`};
    const missingFormula=rows.map((item,index)=>item.requirement?`IF(AND(B${start+index}<>"",D${start+index}=""),1,0)`:null).filter(Boolean).join("+")||"0";
    sheet.getCell(grand+1,1).value="미확인 단가"; sheet.getCell(grand+1,6).value={formula:missingFormula};
    for(let r=start;r<=end;r++){sheet.getCell(r,4).numFmt=moneyFormat;sheet.getCell(r,5).numFmt="0.##";sheet.getCell(r,6).numFmt=moneyFormat;sheet.getCell(r,4).font={color:{argb:"FF0066CC"}};sheet.getCell(r,4).fill={type:"pattern",pattern:"solid",fgColor:{argb:"FFEAF3FF"}};for(let c=1;c<=8;c++)sheet.getCell(r,c).border={bottom:{style:"thin",color:{argb:"FFD9E0DB"}}};}
    for(let r=subtotal;r<=grand+1;r++){sheet.getCell(r,1).font={bold:true};sheet.getCell(r,6).font={bold:true};sheet.getCell(r,1).fill={type:"pattern",pattern:"solid",fgColor:{argb:"FFF0F3EF"}};sheet.getCell(r,6).fill={type:"pattern",pattern:"solid",fgColor:{argb:"FFFFF4D6"}};sheet.getCell(r,6).numFmt=r===grand+1?"0":moneyFormat;}
    sheet.autoFilter={from:{row:9,column:1},to:{row:end,column:8}}; sheet.pageSetup={orientation:"landscape",fitToPage:true,fitToWidth:1,fitToHeight:0};
    detailRefs.push({ group, sheetName, subtotal, groupTotal, vat, grand, missing:grand+1 });
  }

  detailRefs.forEach((ref,index)=>{const r=10+index;const q=`'${ref.sheetName.replace(/'/g,"''")}'`;summary.getRow(r).values=[ref.group.name,`${ref.group.items.length}개 구성 부품`,{formula:`${q}!F${ref.subtotal}`},{formula:`${q}!E4`},{formula:`${q}!F${ref.groupTotal}`},{formula:`${q}!F${ref.vat}`},{formula:`${q}!F${ref.grand}`},{formula:`${q}!F${ref.missing}`}];summary.getRow(r).height=30;});
  const summaryStart=10; const summaryEnd=Math.max(summaryStart,summaryStart+detailRefs.length-1); const totalRow=summaryEnd+2;
  summary.mergeCells(totalRow,1,totalRow,4); summary.getCell(totalRow,1).value="전체 공급가액"; summary.getCell(totalRow,5).value={formula:`SUM(E${summaryStart}:E${summaryEnd})`};
  summary.mergeCells(totalRow+1,1,totalRow+1,4); summary.getCell(totalRow+1,1).value="전체 부가세"; summary.getCell(totalRow+1,6).value={formula:`SUM(F${summaryStart}:F${summaryEnd})`};
  summary.mergeCells(totalRow+2,1,totalRow+2,4); summary.getCell(totalRow+2,1).value="전체 견적 합계"; summary.getCell(totalRow+2,7).value={formula:`SUM(G${summaryStart}:G${summaryEnd})`};
  summary.mergeCells(totalRow+3,1,totalRow+3,4); summary.getCell(totalRow+3,1).value="예상매출(목표마진)"; summary.getCell(totalRow+3,7).value={formula:`IF(E6>=100%,0,G${totalRow+2}/(1-E6))`};
  summary.mergeCells(totalRow+4,1,totalRow+4,4); summary.getCell(totalRow+4,1).value="예산대비 여유"; summary.getCell(totalRow+4,7).value={formula:`IF(B6="",0,B6-G${totalRow+3})`};
  for(let r=summaryStart;r<=summaryEnd;r++){for(const c of [3,5,6,7])summary.getCell(r,c).numFmt=moneyFormat;summary.getCell(r,4).numFmt="0";summary.getCell(r,8).numFmt="0";}
  for(let r=totalRow;r<=totalRow+4;r++){for(let c=1;c<=8;c++){summary.getCell(r,c).font={bold:true};summary.getCell(r,c).fill={type:"pattern",pattern:"solid",fgColor:{argb:c>=5?"FFFFF4D6":"FFF0F3EF"}};}for(const c of [5,6,7])summary.getCell(r,c).numFmt=moneyFormat;}
  summary.autoFilter={from:{row:9,column:1},to:{row:summaryEnd,column:8}}; summary.pageSetup={orientation:"landscape",fitToPage:true,fitToWidth:1,fitToHeight:1};

  const notes=workbook.addWorksheet("검토사항",{views:[{showGridLines:false,state:"frozen",ySplit:1}]});notes.columns=[{width:16},{width:110}];notes.addRow(["구분","내용"]);styleHeader(notes.getRow(1));
  report.qualificationReview.forEach((v)=>notes.addRow(["자격·인증",v]));report.risks.forEach((v)=>notes.addRow(["리스크",v]));report.checklist.forEach((v)=>notes.addRow(["체크리스트",`□ ${v}`]));extraction.uncertainties?.forEach((v)=>notes.addRow(["불확실성",v]));notes.eachRow((row,index)=>{row.alignment={vertical:"top",wrapText:true};if(index>1)row.height=35;});
  return workbook.xlsx.writeBuffer();
}
