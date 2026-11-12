import { coreModelKeywords } from "./pricing.js";
import { canonicalComponentCategory, inferredSpecificationGroup } from "./quote-structure.js";

const laptopPattern = /노트북|랩톱|LAPTOP|NOTEBOOK|MOBILE\s+WORKSTATION/i;
const serverPattern = /서버|SERVER/i;
const workstationPattern = /워크스테이션|WORKSTATION/i;
const monitorPattern = /모니터|MONITOR|DISPLAY/i;
const desktopPattern = /데스크[탑톱]|DESKTOP|미니\s*PC|MINI\s*PC|일체형|ALL[ -]?IN[ -]?ONE/i;
const completeProductHardwareCategories = new Set(["CASE", "MAINBOARD", "CPU", "CPU 쿨러", "RAM", "M.2", "HDD", "POWER", "VGA", "운영체제(O/S)", "모니터"]);

const PRODUCT_LABELS = Object.freeze({
  laptop:"노트북 완제품",
  server:"서버 완제품",
  workstation:"워크스테이션 완제품",
  monitor:"모니터 완제품",
  desktop:"데스크톱 완제품",
});

function productLabel(type) {
  return PRODUCT_LABELS[type] || "완제품";
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function unique(values) {
  return [...new Set(values.map(clean).filter(Boolean))];
}

function positive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function mode(values) {
  const counts = new Map();
  for (const value of values.map(positive).filter(Boolean)) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0] - right[0])[0]?.[0] || null;
}

function groupName(item) {
  return inferredSpecificationGroup(item) || item.specificationGroup || "공통 품목";
}

export function detectCompleteProductType({ group = "", title = "", items = [] } = {}) {
  const hasCompleteSystem = items.some((item) => item.priceRole === "complete_system");
  const hasHardwareSpecification = items.some((item) =>
    ["component", "peripheral", "software"].includes(item.priceRole)
    && completeProductHardwareCategories.has(canonicalComponentCategory(item)));
  if (!hasCompleteSystem && !hasHardwareSpecification) return null;
  const explicitSystems = items.filter((item) => item.priceRole === "complete_system");
  const explicitText = explicitSystems.map((item) => `${item.category || ""} ${item.condition || item.evidence || ""}`).join(" ");
  const identityText = `${group} ${explicitText} ${title}`;
  if (laptopPattern.test(identityText)) return "laptop";
  if (workstationPattern.test(identityText)) return "workstation";
  if (monitorPattern.test(identityText) && items.some((item) => canonicalComponentCategory(item) === "모니터" || item.priceRole === "complete_system")) return "monitor";
  if (serverPattern.test(identityText)) return "server";
  const hasExactCompleteIdentity = items.some((item) => item.priceRole === "complete_system" && clean(item.specifiedModel || item.searchProfile?.exactModel));
  if (desktopPattern.test(identityText) && hasExactCompleteIdentity) return "desktop";
  return null;
}

function categoryPriority(item) {
  const category = canonicalComponentCategory(item);
  return ({ CPU:0, VGA:1, RAM:2, "M.2":3, HDD:4, "운영체제(O/S)":5, 모니터:6 })[category] ?? 20;
}

function compactSpecifications(items) {
  return items
    .filter((item) => !["complete_system", "non_price", "service"].includes(item.priceRole))
    .sort((left, right) => categoryPriority(left) - categoryPriority(right))
    .map((item) => `${canonicalComponentCategory(item)}: ${clean(item.condition || item.evidence)}`)
    .filter((value) => !/:\s*$/.test(value));
}

function completeIdentityItem(type, items) {
  const explicit = items.find((item) => item.priceRole === "complete_system" && clean(item.specifiedModel || item.searchProfile?.exactModel));
  if (explicit) return explicit;
  if (type === "monitor") return items.find((item) => canonicalComponentCategory(item) === "모니터" && clean(item.specifiedModel || item.searchProfile?.exactModel));
  const pattern = type === "laptop" ? laptopPattern : type === "server" ? serverPattern : type === "workstation" ? workstationPattern : desktopPattern;
  return items.find((item) => pattern.test(`${item.category || ""} ${item.condition || ""}`) && clean(item.specifiedModel || item.searchProfile?.exactModel));
}

function specifiedManufacturer(item = {}) {
  const constraint = (item.constraints || []).find((value) => /제조사|브랜드|MANUFACTURER|BRAND/i.test(value.field || "") && clean(value.value));
  if (constraint) return clean(constraint.value);
  const text = clean(`${item.specifiedModel || ""} ${item.condition || ""}`);
  return text.match(/\b(?:DELL|HP(?:E)?|LENOVO|ASUS|ACER|MSI|APPLE|SAMSUNG|LG|SUPERMICRO|GIGABYTE)\b/i)?.[0] || text.match(/삼성전자|삼성|엘지전자|LG전자|레노버|에이수스|에이서|애플|슈퍼마이크로/i)?.[0] || null;
}

function productSearchProfile(type, items, exactModel, manufacturer) {
  const category = productLabel(type);
  const prioritized = [...items].sort((left, right) => categoryPriority(left) - categoryPriority(right));
  const requiredKeywords = unique(prioritized.flatMap((item) => [
    ...(item.searchProfile?.requiredKeywords || []),
    ...(item.searchKeywords || []),
    ...coreModelKeywords(`${item.condition || ""} ${(item.constraints || []).map((value) => `${value.value || ""}${value.unit || ""}`).join(" ")}`),
  ])).slice(0, 24);
  const keyLines = compactSpecifications(prioritized).slice(0, type === "laptop" ? 9 : 12);
  const primaryQuery = clean(`${category} ${manufacturer || ""} ${requiredKeywords.slice(0, 12).join(" ")}`);
  return {
    productType:category,
    exactModel:exactModel || null,
    manufacturer:manufacturer || null,
    requiredKeywords,
    compatibilityKeywords:type === "monitor"
      ? ["모니터 완제품", "제조사 보증"]
      : type === "server" ? ["서버 완제품", "제조사 구성", "제조사 보증"] : [category, "정품", "제조사 보증"],
    queries:unique([clean(`${manufacturer || ""} ${exactModel || ""}`), exactModel, primaryQuery, `${category} ${keyLines.slice(0, 5).join(" ")}`]).slice(0, 4),
    specificationLines:keyLines,
  };
}

function buildCompleteRequirement(type, group, items, title) {
  const identityItem = completeIdentityItem(type, items);
  const exactModel = clean(identityItem?.specifiedModel || identityItem?.searchProfile?.exactModel) || null;
  const manufacturer = specifiedManufacturer(identityItem);
  const specifications = compactSpecifications(items);
  const systemQuantity = mode(items.flatMap((item) => [
    item.systemQuantity,
    item.priceRole === "complete_system" ? item.quantity : null,
  ]));
  const profile = productSearchProfile(type, items, exactModel, manufacturer);
  const category = productLabel(type);
  const evidenceBlockIds = unique(items.flatMap((item) => item.evidenceBlockIds || []));
  const evidenceLocations = unique(items.flatMap((item) => item.evidenceLocations || []));
  const searchableItems = items.filter((item) => !["non_price", "service"].includes(item.priceRole));
  const verifiedCount = searchableItems.filter((item) => item.verificationStatus === "verified").length;
  const searchableCount = searchableItems.length;
  const constraints = searchableItems.flatMap((item) => {
    const component = canonicalComponentCategory(item);
    const structured = (item.constraints || []).map((constraint) => ({
      ...constraint,
      field:`${component} ${constraint.field || "사양"}`.trim(),
    }));
    if (structured.length) return structured;
    const value = clean(item.condition || item.evidence);
    return value && item.priceRole !== "complete_system" ? [{ field:component, operator:"contains", value, unit:null }] : [];
  });
  return {
    id:`COMPLETE-${String(group).replace(/[^0-9a-z가-힣]+/gi, "-").replace(/^-|-$/g, "") || "SYSTEM"}`,
    category,
    condition:clean(`${category} 1대 구성 · ${specifications.join(" / ")}`).slice(0, 3500),
    quantity:systemQuantity,
    evidence:unique(items.map((item) => item.evidence)).join(" / ").slice(0, 3500),
    evidenceBlockIds,
    evidenceLocations,
    specificationGroup:group,
    unitQuantity:1,
    systemQuantity,
    priceRole:"complete_system",
    constraints,
    searchKeywords:profile.requiredKeywords,
    searchProfile:profile,
    specifiedModel:exactModel,
    specifiedManufacturer:manufacturer,
    selectionLabel:null,
    confidence:searchableCount ? verifiedCount / searchableCount : 0,
    verificationStatus:searchableCount > 0 && verifiedCount === searchableCount ? "verified" : "review",
    evidenceStatus:searchableCount > 0 && verifiedCount === searchableCount ? "verified" : "review",
    priceSearchAllowed:true,
    productSearchMode:"complete_product",
    completeProductType:type,
    completeProductTitle:clean(title),
    componentRequirementIds:searchableItems.filter((item) => item.priceRole !== "complete_system").map((item) => item.id).filter(Boolean),
  };
}

export function applyCompleteProductStrategy(extraction = {}) {
  const original = extraction.requirements || [];
  if (original.some((item) => item.productSearchMode === "complete_product")) return extraction;
  const grouped = new Map();
  for (const item of original) {
    const group = groupName(item);
    if (!grouped.has(group)) grouped.set(group, []);
    grouped.get(group).push(item);
  }
  const strategies = [];
  for (const [group, items] of grouped) {
    const type = detectCompleteProductType({ group, title:extraction.title, items });
    if (!type) continue;
    const completeRequirement = buildCompleteRequirement(type, group, items, extraction.title);
    strategies.push({ group, type, completeRequirement });
  }
  if (!strategies.length) return extraction;
  const byGroup = new Map(strategies.map((item) => [item.group, item]));
  const requirements = original.map((item) => {
    const strategy = byGroup.get(groupName(item));
    if (!strategy) return item;
    if (["service", "non_price"].includes(item.priceRole)) return item;
    return {
      ...item,
      priceSearchAllowed:false,
      includedInCompleteProduct:true,
      completeProductRequirementId:strategy.completeRequirement.id,
    };
  });
  requirements.push(...strategies.map((item) => item.completeRequirement));
  return {
    ...extraction,
    requirements,
    completeProductStrategy:strategies.map(({ group, type, completeRequirement }) => ({
      specificationGroup:group,
      productType:type,
      requirementId:completeRequirement.id,
      componentRequirementIds:completeRequirement.componentRequirementIds,
    })),
  };
}
