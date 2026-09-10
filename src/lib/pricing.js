import { evaluateCandidateCompatibility } from "./compatibility.js";

const COLUMN_ALIASES = {
  category: ["구분", "분류", "category", "품목"],
  model: ["모델명", "모델", "model", "상품명"],
  mpn: ["제조사부품번호", "부품번호", "mpn", "part number", "part_number"],
  specification: ["규격", "사양", "specification", "spec"],
  benchmark: ["벤치마크점수", "벤치마크", "benchmark"],
  unitPrice: ["매입단가", "단가", "가격", "unitprice", "unit_price"],
  stock: ["재고상태", "재고", "stock"],
  discontinuedRisk: ["단종위험", "단종", "discontinuedrisk"],
  updatedAt: ["갱신일", "업데이트일", "updatedat", "updated_at"],
};

function normalizedKey(value) {
  return String(value || "").toLowerCase().replace(/[\s_-]/g, "");
}

function findValue(row, aliases) {
  const key = Object.keys(row).find((candidate) => aliases.some((alias) => normalizedKey(candidate) === normalizedKey(alias)));
  return key ? row[key] : "";
}

function numberOrNull(value) {
  const parsed = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizePriceRows(rows) {
  return rows
    .map((row, index) => ({
      id: `company-${index + 1}`,
      category: String(findValue(row, COLUMN_ALIASES.category) || "").trim(),
      model: String(findValue(row, COLUMN_ALIASES.model) || "").trim(),
      mpn: String(findValue(row, COLUMN_ALIASES.mpn) || "").trim(),
      specification: String(findValue(row, COLUMN_ALIASES.specification) || "").trim(),
      benchmark: numberOrNull(findValue(row, COLUMN_ALIASES.benchmark)),
      unitPrice: numberOrNull(findValue(row, COLUMN_ALIASES.unitPrice)),
      stock: String(findValue(row, COLUMN_ALIASES.stock) || "").trim(),
      discontinuedRisk: String(findValue(row, COLUMN_ALIASES.discontinuedRisk) || "").trim(),
      updatedAt: String(findValue(row, COLUMN_ALIASES.updatedAt) || "").trim(),
      sourceType: "company_price_list",
    }))
    .filter((row) => row.model || row.mpn);
}

export function rankCompanyPrices(items, query) {
  const qMpn = normalizedKey(query.mpn);
  const qModel = normalizedKey(query.model);
  const requestedText = [query.model, ...(query.searchKeywords || []), ...(query.constraints || []).map((item) => `${item.value || ""} ${item.unit || ""}`)].filter(Boolean).join(" ");
  const requiredKeywords = coreModelKeywords(requestedText);
  const categoryKey = (value) => {
    const text = String(value || "").toUpperCase();
    const mappings = [
      ["COOLER", /쿨러|COOLER|냉각/], ["MAINBOARD", /메인보드|마더보드|MAINBOARD|MOTHERBOARD/],
      ["CPU", /\bCPU\b|프로세서/], ["SSD", /SSD|NVME|M\.2/], ["HDD", /HDD|하드디스크/],
      ["POWER", /파워|POWER|PSU|전원공급/], ["GPU", /그래픽|GPU|VGA|RTX|RADEON/],
      ["RAM", /메모리|\bRAM\b|DDR[345]/], ["CASE", /케이스|\bCASE\b/],
      ["OS", /운영체제|WINDOWS|O\/S/], ["PERIPHERAL", /키보드|마우스|주변기기/],
    ];
    return mappings.find(([, pattern]) => pattern.test(text))?.[0] || null;
  };
  const qCategory = categoryKey(query.category);
  return items
    .map((item) => {
      let score = 0;
      const itemModel = normalizedKey(item.model);
      const exactMpn = Boolean(qMpn && normalizedKey(item.mpn) === qMpn);
      const exactModel = Boolean(qModel && itemModel && itemModel === qModel);
      const containedModel = Boolean(qModel && itemModel && (itemModel.includes(qModel) || qModel.includes(itemModel)));
      const candidateCategory = categoryKey(item.category);
      const categoryCompatible = !qCategory || !candidateCategory || candidateCategory === qCategory;
      const candidateText = `${item.model} ${item.mpn} ${item.specification}`;
      const match = scoreModelMatch(requestedText, candidateText);
      const compatibility = evaluateCandidateCompatibility(query.requirement || query, item, query.compatibilityContext || {});
      if (exactMpn) score += 120;
      if (exactModel) score += 100;
      else if (containedModel) score += 55;
      score += Math.round(match.matchScore * 0.55);
      if (qCategory && categoryKey(item.category) === qCategory) score += 15;
      if (/보유|재고있음|가능/i.test(item.stock)) score += 5;
      if (/높음|단종/i.test(item.discontinuedRisk)) score -= 20;
      score += compatibility.compatibilityScore;
      const minimumKeywordMatches = query.requirement?.derivedFromCompatibility
        ? Math.min(2, requiredKeywords.length)
        : requiredKeywords.length >= 4 ? 2 : 1;
      const identityMatched = exactMpn || exactModel || containedModel || match.matchedKeywords.length >= minimumKeywordMatches;
      return { ...item, matchScore: score, matchedKeywords:match.matchedKeywords, requiredKeywords, matchType:exactMpn || exactModel ? "exact" : match.matchType, identityMatched:identityMatched && (categoryCompatible || exactMpn), ...compatibility };
    })
    .filter((item) => item.identityMatched && item.matchScore > 0 && item.compatibilityStatus !== "incompatible")
    .sort((a, b) => b.matchScore - a.matchScore || (a.unitPrice ?? Infinity) - (b.unitPrice ?? Infinity));
}

export function buildExternalSearches(query) {
  const term = [query.mpn, query.model, query.specification].filter(Boolean).join(" ").trim();
  return [
    {
      sourceType: "compuzone",
      sourceName: "컴퓨존",
      query: term,
      searchUrl: `https://www.compuzone.co.kr/search/search.htm?SearchType=ALL&SearchKey=${encodeURIComponent(term)}`,
      status: "manual_verification_required",
    },
    {
      sourceType: "guidecom",
      sourceName: "가이드컴",
      query: term,
      searchUrl: `https://www.guidecom.co.kr/search.php?search_str=${encodeURIComponent(term)}`,
      status: "manual_verification_required",
    },
    {
      sourceType: "danawa",
      sourceName: "다나와",
      query: term,
      searchUrl: `https://search.danawa.com/dsearch.php?query=${encodeURIComponent(term)}`,
      status: "fallback_only_manual_verification_required",
    },
  ];
}

export function priceSourcePriority(source) {
  return ({ company_price_list:0, "컴퓨존":1, "가이드컴":2, "다나와":3 })[source] ?? 9;
}

export function coreModelKeywords(value) {
  const text=String(value||"").toUpperCase().replace(/[\[\]()_,/]+/g," ").replace(/\s+/g," ");
  const keywords=[]; const add=value=>{if(value&&!keywords.includes(value))keywords.push(value);};
  for(const match of text.matchAll(/(?:DDR5\s*)?PC5[- ]?(\d{4,5})/g))add(`DDR5-${match[1]}`);
  for(const match of text.matchAll(/RTX\s*(\d{4})/g))add(`RTX${match[1]}`);
  for(const match of text.matchAll(/RTX\s*PRO\s*(\d{4,5})/g)){add("RTXPRO");add(match[1]);}
  for(const match of text.matchAll(/\bXEON(?:\s+(?:PLATINUM|GOLD|SILVER|BRONZE))?\s+(\d{4,5}[A-Z]?)\b/g)){add("XEON");add(match[1]);}
  for(const match of text.matchAll(/\bEPYC(?:\s+\w+){0,2}\s+(\d{4,5}[A-Z]*)\b/g)){add("EPYC");add(match[1]);}
  for(const match of text.matchAll(/\b(D\d)\b/g))add(match[1]);
  for(const match of text.matchAll(/\b(\d{1,2})\s*GB\b/g))add(`${match[1]}GB`);
  for(const match of text.matchAll(/\b(\d+(?:\.\d+)?)\s*TB\b/g))add(`${match[1]}TB`);
  for(const match of text.matchAll(/\b(\d{3,4})\s*W\b/g))add(`${match[1]}W`);
  if(/80\s*PLUS/.test(text))add("80PLUS");
  for(const match of text.matchAll(/\b(\d{1,2})\s*U\b/g))add(`${match[1]}U`);
  if(/메인보드|MOTHERBOARD|MAINBOARD/.test(text))add("MAINBOARD");
  if(/CPU\s*쿨러|CPU\s*COOLER|PROCESSOR\s*COOLER/.test(text))add("COOLER");
  if(/랙\s*마운트|RACK\s*MOUNT|RACKMOUNT/.test(text))add("RACKMOUNT");
  if(/섀시|CHASSIS/.test(text))add("CHASSIS");
  for(const token of ["NVME","U.2","M.2","PCIE5","PCIE4","ECC","RDIMM","REGISTERED","REDUNDANT","RACKMOUNT","SATA","SAS","M-ATX","ATX"])if(text.includes(token.replace("-",""))||text.includes(token))add(token);
  for(const grade of ["TITANIUM","PLATINUM","GOLD","SILVER","BRONZE"])if(text.includes(grade))add(grade);
  const ultra=text.match(/ULTRA\s*([3579])\s+(?:프로세서\s+)?(\d{3}[A-Z]?)/);if(ultra){add(`ULTRA${ultra[1]}`);add(ultra[2]);}
  if(/\bDDR5\b/.test(text)&&!keywords.some(item=>item.startsWith("DDR5-")))add("DDR5");
  if(keywords.length<2)for(const token of text.match(/[A-Z0-9]+(?:-[A-Z0-9]+)*/g)||[])if(token.length>=3)add(token);
  return keywords;
}

export function scoreModelMatch(requestedModel,matchedModel) {
  const required=coreModelKeywords(requestedModel); const candidate=coreModelKeywords(matchedModel);
  const matched=required.filter(keyword=>candidate.includes(keyword));
  const normalized=value=>String(value||"").toUpperCase().replace(/[^A-Z0-9가-힣]/g,"");
  const exact=normalized(requestedModel)===normalized(matchedModel);
  return {matchScore:exact?100:(required.length?Math.round(matched.length/required.length*100):0),matchedKeywords:matched,requiredKeywords:required,matchType:exact?"exact":matched.length?"keyword":"none"};
}
