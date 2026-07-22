import ExcelJS from "exceljs";

const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[ch]);
const won = value => value == null ? "미확인" : `${Number(value).toLocaleString("ko-KR")}원`;

export function reportToDashboardHtml(notice, report, extraction = {}) {
  const priced = report.configuration.filter(item => Number.isFinite(item.unitPrice));
  const total = priced.reduce((sum,item) => sum + item.unitPrice * (item.quantity || 0), 0);
  const decisionClass = report.decision === "참가" ? "go" : report.decision === "포기" ? "stop" : "conditional";
  const list = items => items.map(item => `<li>${esc(item)}</li>`).join("");
  const source=value=>/^https:\/\//i.test(value||"")?`<a href="${esc(value)}" target="_blank" rel="noreferrer">상품 링크 ↗</a>`:esc(value);
  const rows = report.configuration.map(item => `<tr><td>${esc(item.category)}</td><td>${esc(item.requirement)}</td><td>${esc(item.selectedModel || "확인 필요")}</td><td class="num">${item.unitPrice == null ? "-" : won(item.unitPrice)}</td><td class="num">${esc(item.quantity ?? "-")}</td><td>${source(item.source)}</td><td><span class="tag">${esc(item.status)}</span></td></tr>`).join("");
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(notice.title)} - 입찰참가판단 대시보드</title><style>
  :root{--navy:#12372a;--green:#0c694c;--cream:#f7f5ef;--line:#dce3dc;--text:#1e2923;--muted:#66736c;--amber:#b7791f;--red:#b33a2b}*{box-sizing:border-box}body{margin:0;background:var(--cream);color:var(--text);font-family:"Malgun Gothic",Arial,sans-serif}.wrap{max-width:1440px;margin:auto;padding:32px}.hero{padding:30px;border-radius:22px;background:linear-gradient(135deg,var(--navy),#195b43);color:white}.eyebrow{font-size:13px;letter-spacing:.12em;opacity:.8}.hero h1{margin:10px 0 18px;font-size:30px}.decision{display:inline-flex;align-items:center;gap:10px;padding:10px 16px;border-radius:999px;background:#fff;color:var(--navy);font-weight:800}.decision.conditional{color:var(--amber)}.decision.stop{color:var(--red)}.summary{max-width:1050px;line-height:1.75}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin:18px 0}.card,.panel{background:white;border:1px solid var(--line);border-radius:16px;padding:20px;box-shadow:0 7px 24px #153d2710}.card .label{color:var(--muted);font-size:13px}.card .value{margin-top:9px;font-size:20px;font-weight:800}.columns{display:grid;grid-template-columns:1fr 1fr;gap:18px}.panel{margin-bottom:18px}.panel h2{margin:0 0 14px;font-size:19px}.panel li{margin:9px 0;line-height:1.55}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;font-size:13px}th{background:#e8f0eb;text-align:left;padding:12px;white-space:nowrap}td{padding:12px;border-bottom:1px solid #e8ece9;vertical-align:top;line-height:1.45}.num{text-align:right;white-space:nowrap}.tag{display:inline-block;background:#edf2ef;border-radius:999px;padding:5px 8px}.check li{list-style:none;margin-left:-20px}.check li:before{content:'□';margin-right:9px;color:var(--green)}footer{color:var(--muted);font-size:12px;text-align:center;padding:12px}@media(max-width:900px){.grid{grid-template-columns:1fr 1fr}.columns{grid-template-columns:1fr}.wrap{padding:16px}}@media print{body{background:white}.wrap{max-width:none;padding:0}.card,.panel{box-shadow:none;break-inside:avoid}}
  </style></head><body><main class="wrap"><section class="hero"><div class="eyebrow">WITHBID-PPBM · PROCUREMENT DECISION</div><h1>${esc(notice.title)}</h1><div class="decision ${decisionClass}">${esc(report.decision)}</div><p class="summary">${esc(report.summary)}</p></section><section class="grid"><div class="card"><div class="label">공고번호</div><div class="value">${esc(notice.noticeNumber)}</div></div><div class="card"><div class="label">수요기관</div><div class="value">${esc(notice.organization || "확인 필요")}</div></div><div class="card"><div class="label">마감일</div><div class="value">${esc(notice.deadline)}</div></div><div class="card"><div class="label">예산 / 확인 원가</div><div class="value">${won(extraction.budget)} / ${won(total || null)}</div></div></section><section class="columns"><div><article class="panel"><h2>자격·인증 검토</h2><ul>${list(report.qualificationReview)}</ul></article><article class="panel"><h2>주요 리스크</h2><ul>${list(report.risks)}</ul></article></div><article class="panel check"><h2>실무 확인 체크리스트</h2><ul>${list(report.checklist)}</ul></article></section><article class="panel"><h2>구성 견적</h2><div class="table-wrap"><table><thead><tr><th>구분</th><th>요구사양</th><th>선정 모델</th><th>단가</th><th>수량</th><th>가격 출처</th><th>상태</th></tr></thead><tbody>${rows}</tbody></table></div></article><footer>AI 자동 분석 결과입니다. 최종 투찰 전 공고 원문과 담당자 검토가 필요합니다.</footer></main></body></html>`;
}

export async function quoteWorkbookBuffer(notice, report, extraction = {}, targetMargin = 12) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "WITHBID-PPBM"; workbook.created = new Date();
  const sheet = workbook.addWorksheet("견적서", { views:[{showGridLines:false,state:"frozen",ySplit:10}] });
  sheet.columns = [{width:16},{width:44},{width:34},{width:16},{width:11},{width:17},{width:17},{width:17},{width:25},{width:26}];
  sheet.mergeCells("A1:J2"); sheet.getCell("A1").value="입찰 견적서";
  sheet.getCell("A1").font={name:"맑은 고딕",size:22,bold:true,color:{argb:"FFFFFFFF"}}; sheet.getCell("A1").alignment={vertical:"middle",horizontal:"center"}; sheet.getCell("A1").fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF12372A"}};
  const meta=[["공고번호",notice.noticeNumber,"공고명",notice.title],["수요기관",notice.organization||"확인 필요","마감일",notice.deadline],["예산(부가세 포함)",extraction.budget??null,"목표마진",targetMargin/100]];
  meta.forEach((row,index)=>{const r=4+index; sheet.getCell(r,1).value=row[0]; sheet.getCell(r,2).value=row[1]; sheet.getCell(r,4).value=row[2]; sheet.mergeCells(r,2,r,3); sheet.mergeCells(r,5,r,10); sheet.getCell(r,5).value=row[3]; [1,4].forEach(c=>{sheet.getCell(r,c).font={bold:true,color:{argb:"FF385448"}};sheet.getCell(r,c).fill={type:"pattern",pattern:"solid",fgColor:{argb:"FFE8F0EB"}};});});
  sheet.getCell("B6").numFmt='#,##0"원"'; sheet.getCell("E6").numFmt="0.0%";
  const headers=["구분","요구사양","선정 모델","단가(입력)","수량","공급가액","부가세","합계","가격 출처/링크","상태"];
  sheet.getRow(9).values=headers; sheet.getRow(9).height=28;
  sheet.getRow(9).eachCell(cell=>{cell.font={bold:true,color:{argb:"FFFFFFFF"}};cell.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF0C694C"}};cell.alignment={vertical:"middle",horizontal:"center"};});
  const start=10;
  report.configuration.forEach((item,index)=>{const r=start+index; sheet.getRow(r).values=[item.category,item.requirement,item.selectedModel||"확인 필요",item.unitPrice??null,item.quantity??null,{formula:`IF(OR(D${r}="",E${r}=""),0,D${r}*E${r})`},{formula:`F${r}*10%`},{formula:`F${r}+G${r}`},/^https:\/\//i.test(item.source||"")?{text:"상품 링크",hyperlink:item.source}:item.source,item.status]; sheet.getRow(r).alignment={vertical:"top",wrapText:true}; sheet.getRow(r).height=42;if(/^https:\/\//i.test(item.source||""))sheet.getCell(r,9).font={color:{argb:"FF0563C1"},underline:true};});
  const end=Math.max(start,start+report.configuration.length-1); const totalRow=end+2;
  sheet.getCell(totalRow,5).value="합계"; sheet.getCell(totalRow,6).value={formula:`SUM(F${start}:F${end})`}; sheet.getCell(totalRow,7).value={formula:`SUM(G${start}:G${end})`}; sheet.getCell(totalRow,8).value={formula:`SUM(H${start}:H${end})`};
  sheet.getCell(totalRow+1,5).value="예상 매출(목표마진)"; sheet.getCell(totalRow+1,8).value={formula:`IF(B6="",0,H${totalRow}/(1-E6))`};
  sheet.getCell(totalRow+2,5).value="예산 대비 여유"; sheet.getCell(totalRow+2,8).value={formula:`IF(B6="",0,B6-H${totalRow+1})`};
  for(let r=start;r<=totalRow+2;r++){for(const c of [4,6,7,8])sheet.getCell(r,c).numFmt='#,##0"원"';sheet.getCell(r,5).numFmt='#,##0"개"';}
  for(let r=start;r<=end;r++){sheet.getCell(r,4).font={color:{argb:"FF0066CC"}};sheet.getCell(r,4).fill={type:"pattern",pattern:"solid",fgColor:{argb:"FFEAF3FF"}};}
  for(let r=totalRow;r<=totalRow+2;r++){for(let c=5;c<=8;c++){sheet.getCell(r,c).font={bold:true};sheet.getCell(r,c).fill={type:"pattern",pattern:"solid",fgColor:{argb:"FFFFF4D6"}};}}
  sheet.autoFilter={from:{row:9,column:1},to:{row:end,column:10}};
  sheet.pageSetup={orientation:"landscape",fitToPage:true,fitToWidth:1,fitToHeight:0,margins:{left:.25,right:.25,top:.5,bottom:.5,header:.2,footer:.2}};
  const notes=workbook.addWorksheet("검토사항",{views:[{showGridLines:false,state:"frozen",ySplit:2}]}); notes.columns=[{width:16},{width:110}]; notes.addRow(["구분","내용"]); notes.getRow(1).eachCell(c=>{c.font={bold:true,color:{argb:"FFFFFFFF"}};c.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF12372A"}};});
  report.qualificationReview.forEach(v=>notes.addRow(["자격·인증",v])); report.risks.forEach(v=>notes.addRow(["리스크",v])); report.checklist.forEach(v=>notes.addRow(["체크리스트",`□ ${v}`])); extraction.uncertainties?.forEach(v=>notes.addRow(["불확실성",v]));
  notes.eachRow((row,index)=>{row.alignment={vertical:"top",wrapText:true};if(index>1)row.height=35;});
  return workbook.xlsx.writeBuffer();
}
