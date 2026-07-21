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
  const qCategory = normalizedKey(query.category);
  return items
    .map((item) => {
      let score = 0;
      if (qMpn && normalizedKey(item.mpn) === qMpn) score += 100;
      if (qModel && normalizedKey(item.model) === qModel) score += 80;
      else if (qModel && normalizedKey(item.model).includes(qModel)) score += 40;
      if (qCategory && normalizedKey(item.category) === qCategory) score += 15;
      if (/보유|재고있음|가능/i.test(item.stock)) score += 5;
      if (/높음|단종/i.test(item.discontinuedRisk)) score -= 20;
      return { ...item, matchScore: score };
    })
    .filter((item) => item.matchScore > 0)
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
  ];
}
