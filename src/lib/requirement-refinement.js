import { coreModelKeywords } from "./pricing.js";
import { canonicalComponentCategory, inferredSpecificationGroup } from "./quote-structure.js";

const HARDWARE_CATEGORIES = new Set(["CASE", "MAINBOARD", "CPU", "CPU 쿨러", "RAM", "M.2", "HDD", "POWER", "VGA"]);
const ESSENTIAL_BOM_CATEGORIES = ["CASE", "MAINBOARD", "CPU", "CPU 쿨러", "RAM", "M.2", "POWER"];

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

function explicitProductPattern(category) {
  return ({
    CPU: /\b(?:XEON|EPYC|RYZEN|CORE\s+ULTRA)\b[^\n,.;]{0,45}\b\d{3,5}[A-Z]?\b/i,
    VGA: /\b(?:RTX|RADEON|A\d{2,4}|L\d{2,4})\s*(?:PRO\s*)?\d{3,5}\b/i,
    RAM: /\b(?:DDR[345]|PC[345]-\d{4,5}|RDIMM|ECC)\b/i,
    "M.2": /\b(?:NVME|M\.2|U\.2|SSD)\b/i,
    HDD: /\b(?:HDD|SAS|SATA)\b/i,
    POWER: /\b\d{3,4}\s*W\b|80\s*PLUS|TITANIUM|REDUNDANT/i,
    CASE: /\b\d+U\b|RACK\s*MOUNT|랙\s*마운트|섀시|CHASSIS/i,
    MAINBOARD: /\b(?:LGA\s*\d{3,4}|SP[356]|WRX\d+|메인보드|MOTHERBOARD)\b/i,
    "CPU 쿨러": /\b(?:CPU\s*쿨러|COOLER|COOLING|냉각)\b/i,
  })[category] || /$^/;
}

function semanticClassification(requirement) {
  const originalCategory = canonicalComponentCategory(requirement);
  const text = clean(`${requirement.category || ""} ${requirement.condition || ""} ${requirement.evidence || ""}`);
  const hasOriginalProduct = explicitProductPattern(originalCategory).test(text);
  const explicitlyPricedService = /\d[\d,]*\s*원|별도\s*비용|서비스\s*단가|견적\s*항목/i.test(text);
  const osOnly = /\b(?:UBUNTU|WINDOWS|LINUX|RED\s*HAT|ROCKY\s*LINUX)\b|운영체제/i.test(text)
    && !/\b(?:RTX|RADEON)\s*(?:PRO\s*)?\d{3,5}\b/i.test(text);
  if (osOnly && !hasOriginalProduct) return { category:"운영체제(O/S)", priceRole:"software" };

  const complianceOnly = /(?:검수|검증|시험|테스트|성능\s*확인|결과\s*보고|보고서|매뉴얼|교육|사용법|하자|유지보수|기술지원|연동|설치\s*완료|구축\s*완료|초기\s*설정|환경\s*실사|납품\s*및\s*시스템\s*구축)/i.test(text)
    && !hasOriginalProduct && !explicitlyPricedService;
  if (complianceOnly) return { category:"검수·이행 조건", priceRole:"non_price" };

  const purposeOnly = /(?:연구개발|활용\s*목적|납품하여야|구축\s*목적)/i.test(text)
    && /(?:서버|워크스테이션|컴퓨터|PC)\s*\d*\s*(?:식|대)?/i.test(text)
    && !hasOriginalProduct;
  if (purposeOnly) return { category:requirement.category || "완제품 시스템", priceRole:"complete_system" };
  return { category:originalCategory, priceRole:requirement.priceRole };
}

function specifiedModel(requirement) {
  if (clean(requirement.specifiedModel)) return clean(requirement.specifiedModel);
  const category = canonicalComponentCategory(requirement);
  const text = clean(`${requirement.condition || ""} ${requirement.evidence || ""}`);
  const patterns = ({
    CPU: [
      /\b(?:INTEL\s+)?XEON(?:\s+(?:PLATINUM|GOLD|SILVER|BRONZE|W|D|E))?\s+\d{4,5}[A-Z]?\b/i,
      /\b(?:AMD\s+)?EPYC(?:\s+\w+){0,2}\s+\d{4,5}[A-Z]*\b/i,
      /\b(?:INTEL\s+)?CORE\s+ULTRA\s+[3579]\s+(?:프로세서\s+)?\d{3}[A-Z]?\b/i,
      /\b(?:AMD\s+)?RYZEN\s+(?:THREADRIPPER\s+PRO\s+)?[3579]\s+\d{4,5}[A-Z]*\b/i,
    ],
    VGA: [
      /\b(?:NVIDIA\s+)?(?:GEFORCE\s+)?RTX\s+PRO\s+\d{4,5}(?:\s+BLACKWELL)?(?:\s+SERVER\s+EDITION)?(?:\s+D\d)?(?:\s+\d+\s*GB)?\b/i,
      /\b(?:NVIDIA\s+)?(?:GEFORCE\s+)?RTX\s+\d{4}(?:\s+[A-Z0-9-]+){0,4}(?:\s+\d+\s*GB)?\b/i,
    ],
    "운영체제(O/S)": [
      /\bUBUNTU(?:\s+LINUX)?(?:\s+\d+(?:\.\d+)?)?(?:\s+LTS)?\b/i,
      /\bWINDOWS(?:\s+SERVER)?(?:\s+\d{2,4})?(?:\s+PRO)?\b/i,
      /\b(?:RED\s*HAT|ROCKY\s*LINUX)(?:\s+\d+(?:\.\d+)?)?\b/i,
    ],
  })[category] || [];
  return patterns.map((pattern) => text.match(pattern)?.[0]).find(Boolean)?.replace(/\s+/g, " ").trim() || null;
}

function storageCapacityPairs(requirement) {
  const category = canonicalComponentCategory(requirement);
  if (!new Set(["M.2", "HDD"]).has(category)) return [];
  const text = clean(requirement.condition || requirement.evidence);
  const pairs = [];
  const pattern = /\b(\d+(?:\.\d+)?)\s*(TB|GB)\b\s*(?:용량)?\s*(\d+(?:\.\d+)?)\s*(?:개|EA|대)/gi;
  for (const match of text.matchAll(pattern)) {
    const capacity = `${match[1]}${match[2].toUpperCase()}`;
    const count = positive(match[3]);
    if (count && !pairs.some((item) => item.capacity === capacity)) pairs.push({ capacity, count });
  }
  return pairs.length >= 2 ? pairs : [];
}

function storageBaseText(requirement) {
  const text = clean(requirement.condition || "");
  const interfaceName = text.match(/\b(?:NVME\s*)?(?:U\.2|M\.2)|\bSAS\b|\bSATA\b/i)?.[0] || "";
  const driveType = /\bHDD\b/i.test(text) ? "HDD" : "SSD";
  const qualifiers = unique([
    /ENTERPRISE|엔터프라이즈/i.test(text) ? "엔터프라이즈" : "",
    /DATACENTER|데이터센터/i.test(text) ? "데이터센터용" : "",
    /PCIE\s*(?:GEN\s*)?[345](?:\.0)?/i.exec(text)?.[0] || "",
  ]);
  return clean([interfaceName, driveType, ...qualifiers].join(" "));
}

function splitCompoundStorage(requirement) {
  const pairs = storageCapacityPairs(requirement);
  if (!pairs.length) return [requirement];
  const base = storageBaseText(requirement);
  const existingConstraints = requirement.constraints || [];
  return pairs.map((pair, index) => {
    const systemQuantity = positive(requirement.systemQuantity);
    const constraints = existingConstraints.filter((item) => !/(?:용량|capacity|storage)/i.test(item.field || ""));
    constraints.push({ field:"저장용량", operator:">=", value:pair.capacity.replace(/(?:TB|GB)$/i, ""), unit:pair.capacity.match(/TB|GB/i)?.[0].toUpperCase() || null });
    const condition = clean(`${base} ${pair.capacity}`);
    const originalSearchKeywords = (requirement.searchKeywords || []).filter((keyword) => {
      const capacities = String(keyword).match(/\d+(?:\.\d+)?\s*(?:TB|GB)/gi) || [];
      return !capacities.length || capacities.some((value) => value.replace(/\s+/g, "").toUpperCase() === pair.capacity);
    });
    return {
      ...requirement,
      id:`${requirement.id || "REQ-STORAGE"}-${index + 1}`,
      condition,
      quantity:systemQuantity ? systemQuantity * pair.count : pair.count,
      unitQuantity:pair.count,
      constraints,
      searchKeywords:unique([...originalSearchKeywords, ...coreModelKeywords(condition), pair.capacity]),
      compoundSourceId:requirement.id || null,
      refinementNote:`복합 저장장치 요구에서 ${pair.capacity} ${pair.count}개를 독립 견적행으로 분리`,
    };
  });
}

function searchProfile(requirement) {
  const category = canonicalComponentCategory(requirement);
  const exactModel = specifiedModel(requirement);
  const constraintText = (requirement.constraints || []).map((item) => `${item.value || ""}${item.unit || ""}`).join(" ");
  const requiredKeywords = unique([
    ...coreModelKeywords(`${requirement.condition || ""} ${constraintText}`),
    ...(requirement.searchKeywords || []),
  ]).slice(0, 14);
  const compatibilityKeywords = unique([
    ...(/서버|SERVER/i.test(requirement.condition || "") ? ["서버용"] : []),
    ...(/랙\s*마운트|RACK\s*MOUNT/i.test(requirement.condition || "") ? ["랙마운트"] : []),
  ]);
  const queries = unique([
    exactModel,
    `${category} ${requiredKeywords.slice(0, 7).join(" ")}`,
    `${category} ${compatibilityKeywords.join(" ")} ${requiredKeywords.slice(0, 5).join(" ")}`,
  ]);
  return { productType:category, exactModel, requiredKeywords, compatibilityKeywords, queries };
}

function selectionLabel(requirement) {
  const exact = specifiedModel(requirement);
  if (exact) return exact;
  const category = canonicalComponentCategory(requirement);
  const core = coreModelKeywords(requirement.condition || "");
  const profile = searchProfile(requirement);
  const summary = (core.length ? core : profile.requiredKeywords).slice(0, 6).join(" · ");
  return summary ? `${category} 규격 후보 (${summary})` : `${category} 호환 모델 확인 필요`;
}

export function refineExtractedRequirements(extraction = {}) {
  const refined = [];
  for (const raw of extraction.requirements || []) {
    const classification = semanticClassification(raw);
    const requirement = { ...raw, ...classification };
    for (const split of splitCompoundStorage(requirement)) {
      const model = specifiedModel(split);
      refined.push({
        ...split,
        specifiedModel:model,
        searchProfile:searchProfile(split),
        selectionLabel:selectionLabel(split),
      });
    }
  }
  return { ...extraction, requirements:refined };
}

function groupSystemQuantity(items) {
  const quantities = items.map((item) => positive(item.systemQuantity)).filter(Boolean);
  return quantities.sort((left, right) => quantities.filter((value) => value === right).length - quantities.filter((value) => value === left).length)[0] || null;
}

function derivedCondition(category, items) {
  const get = (wanted) => items.find((item) => !["complete_system", "non_price"].includes(item.priceRole) && canonicalComponentCategory(item) === wanted);
  const cpu = get("CPU");
  const ram = get("RAM");
  const vga = get("VGA");
  const board = get("MAINBOARD");
  const ramKeywords = (ram?.searchProfile?.requiredKeywords || coreModelKeywords(ram?.condition || "")).slice(0, 5).join(" ");
  if (category === "MAINBOARD") return clean(`서버용 메인보드, CPU ${cpu?.specifiedModel || cpu?.condition || "요구 CPU"} 호환, ${ramKeywords ? `${ramKeywords} 메모리 지원,` : ""} ${vga?.unitQuantity ? `GPU ${vga.unitQuantity}개 장착 지원` : "GPU 장착 지원"}`);
  if (category === "CPU 쿨러") return clean(`서버용 CPU 쿨러, CPU ${cpu?.specifiedModel || cpu?.condition || "요구 CPU"} 소켓 및 TDP 호환`);
  if (category === "CASE") return clean(`서버 섀시, ${board?.condition ? `메인보드 ${board.condition} 장착,` : ""} ${vga?.unitQuantity ? `GPU ${vga.unitQuantity}개 장착 지원` : "GPU 장착 지원"}`);
  if (category === "POWER") return clean(`서버용 전원공급장치, CPU ${cpu?.specifiedModel || "요구 CPU"} 및 ${vga?.condition || "GPU"} 구성의 정격 출력·보조전원 충족`);
  if (category === "RAM") return clean(`서버용 메모리, CPU ${cpu?.specifiedModel || cpu?.condition || "요구 CPU"} 및 메인보드 호환`);
  if (category === "M.2") return "서버용 운영체제 저장장치, 메인보드 인터페이스 호환";
  return `${category} 호환 구성품`;
}

function derivedUnitQuantity(category, items) {
  if (category !== "CPU 쿨러") return 1;
  const cpu = items.find((item) => item.priceRole === "component" && canonicalComponentCategory(item) === "CPU");
  return positive(cpu?.unitQuantity) || 1;
}

export function completeCompatibilityRequirements(extraction = {}) {
  const requirements = [...(extraction.requirements || [])];
  const groups = new Map();
  for (const item of requirements) {
    const group = inferredSpecificationGroup(item) || item.specificationGroup || "공통 품목";
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(item);
  }
  const added = [];
  for (const [group, items] of groups) {
    const categories = new Set(items.filter((item) => !["complete_system", "non_price"].includes(item.priceRole) && HARDWARE_CATEGORIES.has(canonicalComponentCategory(item))).map(canonicalComponentCategory));
    const hardwareCount = categories.size;
    const isComposableComputer = categories.has("CPU") && hardwareCount >= 3;
    if (!isComposableComputer) continue;
    const systemQuantity = groupSystemQuantity(items);
    for (const category of ESSENTIAL_BOM_CATEGORIES.filter((value) => !categories.has(value))) {
      const condition = derivedCondition(category, items);
      const unitQuantity = derivedUnitQuantity(category, items);
      const requirement = {
        id:`DERIVED-${String(added.length + 1).padStart(3, "0")}`,
        category,
        condition,
        quantity:systemQuantity ? systemQuantity * unitQuantity : null,
        evidence:"규격서 직접 명시 없음 — 명시 부품의 호환 구성에 필요한 보완 항목",
        evidenceBlockIds:[],
        evidenceLocations:[],
        specificationGroup:group === "공통 품목" ? null : group,
        unitQuantity,
        systemQuantity,
        priceRole:"component",
        constraints:[],
        searchKeywords:unique(coreModelKeywords(condition)),
        confidence:0.5,
        evidenceStatus:"derived",
        evidenceScore:0,
        verificationStatus:"derived",
        priceSearchAllowed:true,
        derivedFromCompatibility:true,
        refinementNote:"전체 부품 구성 누락을 막기 위해 명시 부품 호환성 기준으로 생성",
      };
      requirement.specifiedModel = specifiedModel(requirement);
      requirement.searchProfile = searchProfile(requirement);
      requirement.selectionLabel = selectionLabel(requirement);
      requirements.push(requirement);
      items.push(requirement);
      added.push(requirement);
      categories.add(category);
    }
  }
  return {
    ...extraction,
    requirements,
    requirementRefinement:{
      ...(extraction.requirementRefinement || {}),
      derivedCompatibilityRequirementCount:added.length,
      derivedRequirementIds:added.map((item) => item.id),
    },
  };
}
