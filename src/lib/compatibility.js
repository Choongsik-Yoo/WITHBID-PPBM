import { canonicalComponentCategory, inferredSpecificationGroup } from "./quote-structure.js";

export const COMPONENT_RESEARCH_ORDER = Object.freeze([
  "CPU",
  "MAINBOARD",
  "CPU 쿨러",
  "RAM",
  "M.2",
  "HDD",
  "VGA",
  "POWER",
  "CASE",
  "운영체제(O/S)",
  "그 외",
]);

export function pricingGroupName(item = {}) {
  return inferredSpecificationGroup(item) || item.specificationGroup || "공통 품목";
}

export function componentResearchRank(item = {}) {
  const category = canonicalComponentCategory(item);
  const rank = COMPONENT_RESEARCH_ORDER.indexOf(category);
  return rank >= 0 ? rank : COMPONENT_RESEARCH_ORDER.length - 1;
}

export function sortRequirementsForPricing(requirements = []) {
  const groupRanks = new Map();
  requirements.forEach((item) => {
    const group = pricingGroupName(item);
    if (!groupRanks.has(group)) groupRanks.set(group, groupRanks.size);
  });
  return requirements
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const groupDifference = groupRanks.get(pricingGroupName(left.item)) - groupRanks.get(pricingGroupName(right.item));
      return groupDifference || componentResearchRank(left.item) - componentResearchRank(right.item) || left.index - right.index;
    })
    .map(({ item }) => item);
}

function candidateText(candidate = {}) {
  return [
    candidate.model,
    candidate.matchedModel,
    candidate.specification,
    candidate.status,
    candidate.requirement?.condition,
    candidate.requirement?.specification,
  ].filter(Boolean).join(" ");
}

function normalizedSocket(value) {
  const text = String(value || "").toUpperCase().replace(/[()]/g, " ");
  const lga = text.match(/\bLGA\s*[- ]?(\d{3,4})\b/);
  if (lga) return `LGA${lga[1]}`;
  const amd = text.match(/\b(S?TR5|TRX40|WRX80|AM[345]|SP[356])\b/i);
  return amd ? amd[1].toUpperCase() : null;
}

function memoryType(value) {
  return String(value || "").toUpperCase().match(/\bDDR[345]\b/)?.[0] || null;
}

function formFactor(value) {
  const text = String(value || "").toUpperCase().replace(/_/g, "-");
  if (/\b(?:E-?ATX|EXTENDED\s*ATX)\b/.test(text)) return "E-ATX";
  if (/\b(?:M-?ATX|MICRO\s*ATX)\b/.test(text)) return "M-ATX";
  if (/\b(?:MINI-?ITX|M-?ITX)\b/.test(text)) return "MINI-ITX";
  if (/\bATX\b/.test(text)) return "ATX";
  return null;
}

function powerCapacity(value) {
  const values = [...String(value || "").toUpperCase().matchAll(/\b(\d{3,4})\s*W\b/g)].map((match) => Number(match[1]));
  return values.length ? Math.max(...values) : null;
}

function recommendedPower(value) {
  const text = String(value || "").toUpperCase();
  const values = [...text.matchAll(/(?:권장|RECOMMENDED|정격)[^0-9]{0,24}(\d{3,4})\s*W\b/g)].map((match) => Number(match[1]));
  return values.length ? Math.max(...values) : null;
}

function caseSupports(caseFactor, boardFactor) {
  const supported = {
    "E-ATX": new Set(["E-ATX", "ATX", "M-ATX", "MINI-ITX"]),
    ATX: new Set(["ATX", "M-ATX", "MINI-ITX"]),
    "M-ATX": new Set(["M-ATX", "MINI-ITX"]),
    "MINI-ITX": new Set(["MINI-ITX"]),
  };
  return supported[caseFactor]?.has(boardFactor) ?? true;
}

export function buildCompatibilityContext(selectedParts = [], specificationGroup = "공통 품목") {
  const parts = selectedParts.map((part) => {
    const category = canonicalComponentCategory(part.requirement || part);
    const text = candidateText(part);
    return {
      category,
      model: part.model || part.matchedModel || null,
      specification: part.specification || null,
      socket: normalizedSocket(text),
      memoryType: memoryType(text),
      formFactor: category === "MAINBOARD" ? formFactor(text) : null,
      powerCapacityW: category === "POWER" ? powerCapacity(text) : null,
      recommendedPowerW: category === "VGA" ? recommendedPower(text) : null,
    };
  });
  const cpu = parts.find((part) => part.category === "CPU");
  const mainboard = parts.find((part) => part.category === "MAINBOARD");
  const vga = parts.find((part) => part.category === "VGA");
  const cpuSocket = cpu?.socket || null;
  const mainboardSocket = mainboard?.socket || null;
  const selectedMemoryType = mainboard?.memoryType || cpu?.memoryType || null;
  const mainboardFormFactor = mainboard?.formFactor || null;
  const minimumPowerW = vga?.recommendedPowerW || null;
  const summary = [
    cpuSocket ? `CPU 소켓 ${cpuSocket}` : null,
    mainboardSocket ? `메인보드 소켓 ${mainboardSocket}` : null,
    selectedMemoryType ? `메모리 ${selectedMemoryType}` : null,
    mainboardFormFactor ? `메인보드 크기 ${mainboardFormFactor}` : null,
    minimumPowerW ? `그래픽카드 권장 파워 ${minimumPowerW}W 이상` : null,
  ].filter(Boolean).join(" · ");
  return { specificationGroup, cpuSocket, mainboardSocket, memoryType:selectedMemoryType, mainboardFormFactor, minimumPowerW, selectedParts:parts, summary:summary || "선행 선택 부품 없음" };
}

export function evaluateCandidateCompatibility(requirement = {}, candidate = {}, context = {}) {
  const category = canonicalComponentCategory(requirement);
  const text = candidateText({ ...candidate, requirement });
  const notes = [];
  let checked = 0;
  let incompatible = false;
  const compare = (label, expected, actual) => {
    if (!expected) return;
    checked += 1;
    if (!actual) notes.push(`${label} 확인 필요 (${expected})`);
    else if (expected !== actual) {
      incompatible = true;
      notes.push(`${label} 불일치 (${expected} ≠ ${actual})`);
    } else notes.push(`${label} 일치 (${expected})`);
  };

  if (category === "MAINBOARD") compare("CPU 소켓", context.cpuSocket, normalizedSocket(text));
  if (category === "CPU 쿨러") compare("CPU 소켓", context.mainboardSocket || context.cpuSocket, normalizedSocket(text));
  if (category === "RAM") compare("메모리 규격", context.memoryType, memoryType(text));
  if (category === "POWER" && context.minimumPowerW) {
    checked += 1;
    const watts = powerCapacity(text);
    if (!watts) notes.push(`정격 출력 확인 필요 (${context.minimumPowerW}W 이상)`);
    else if (watts < context.minimumPowerW) {
      incompatible = true;
      notes.push(`정격 출력 부족 (${watts}W < ${context.minimumPowerW}W)`);
    } else notes.push(`정격 출력 충족 (${watts}W)`);
  }
  if (category === "CASE" && context.mainboardFormFactor) {
    checked += 1;
    const candidateFactor = formFactor(text);
    if (!candidateFactor) notes.push(`메인보드 장착 규격 확인 필요 (${context.mainboardFormFactor})`);
    else if (!caseSupports(candidateFactor, context.mainboardFormFactor)) {
      incompatible = true;
      notes.push(`케이스 규격 불일치 (${candidateFactor}에 ${context.mainboardFormFactor} 장착 불가)`);
    } else notes.push(`메인보드 장착 규격 충족 (${candidateFactor})`);
  }

  if (incompatible) return { compatibilityStatus:"incompatible", compatibilityScore:-1000, compatibilityNotes:notes };
  if (checked && notes.some((note) => note.includes("확인 필요"))) return { compatibilityStatus:"review", compatibilityScore:0, compatibilityNotes:notes };
  if (checked) return { compatibilityStatus:"compatible", compatibilityScore:30, compatibilityNotes:notes };
  if (["MAINBOARD", "CPU 쿨러", "RAM", "M.2", "HDD", "VGA", "POWER", "CASE", "운영체제(O/S)"].includes(category)) {
    return { compatibilityStatus:"review", compatibilityScore:0, compatibilityNotes:[`${category} 호환성 판정에 필요한 선행 부품 규격 확인 필요`] };
  }
  return { compatibilityStatus:"compatible", compatibilityScore:0, compatibilityNotes:[`${category} 선행 호환성 조건 없음`] };
}
