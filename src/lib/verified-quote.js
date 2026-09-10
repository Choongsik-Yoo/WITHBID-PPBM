import { coreModelKeywords, priceSourcePriority, scoreModelMatch } from "./pricing.js";
import {
  canonicalComponentCategory,
  inferredSpecificationGroup,
  isWholeSystemItem,
} from "./quote-structure.js";
import { normalizeEvidenceText } from "./document-analysis.js";

const allowedRoles = new Set([
  "component", "peripheral", "software", "service", "complete_system", "non_price",
]);
const singleSlotCategories = new Set([
  "CASE", "MAINBOARD", "CPU", "CPU 쿨러", "POWER", "운영체제(O/S)",
]);
const essentialCategories = ["CASE", "MAINBOARD", "CPU", "CPU 쿨러", "RAM", "M.2", "POWER"];

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function textTokens(value) {
  return new Set(String(value || "").toLowerCase().match(/[0-9a-z가-힣]+/g) || []);
}

function evidenceSimilarity(quote, source) {
  const normalizedQuote = normalizeEvidenceText(quote);
  const normalizedSource = normalizeEvidenceText(source);
  if (!normalizedQuote || !normalizedSource) return 0;
  if (normalizedSource.includes(normalizedQuote)) return 1;
  const quoteTokens = [...textTokens(quote)].filter((token) => token.length >= 2 || /^\d+$/.test(token));
  const sourceTokens = textTokens(source);
  if (!quoteTokens.length) return 0;
  return quoteTokens.filter((token) => sourceTokens.has(token)).length / quoteTokens.length;
}

function quantityGrounded(value, source) {
  if (value == null) return true;
  const number = Number(value);
  if (!Number.isFinite(number)) return false;
  const token = Number.isInteger(number) ? String(number) : String(number).replace(/0+$/, "").replace(/\.$/, "");
  const escaped = token.replace(".", "\\.");
  const text = String(source || "").replace(/,/g, "");
  return new RegExp(`(?:${escaped}\\s*(?:대|개|식|세트|set|ea|본|조|장|매|라이선스)|(?:수량|qty|납품수량|1대당|장비당|시스템당)[^0-9]{0,20}${escaped}(?:[^0-9]|$))`, "i").test(text);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeConstraint(value) {
  if (!value || typeof value !== "object") return null;
  const field = clean(value.field);
  const operator = clean(value.operator || value.op || "==");
  const constraintValue = clean(value.value);
  if (!field || !constraintValue) return null;
  return { field, operator, value: constraintValue, unit: clean(value.unit) || null };
}

function inferEvidenceIds(requirement, blocks) {
  const known = new Map(blocks.map((block) => [block.id, block]));
  const supplied = unique((requirement.evidenceBlockIds || []).map(String)).filter((id) => known.has(id));
  if (supplied.length) return supplied;
  const quote = clean(requirement.evidence);
  if (!quote) return [];
  return blocks
    .map((block) => ({ id: block.id, score: evidenceSimilarity(quote, block.text) }))
    .filter((item) => item.score >= 0.65)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((item) => item.id);
}

function requirementIdentity(requirement) {
  const category = canonicalComponentCategory(requirement);
  const group = inferredSpecificationGroup(requirement) || "공통 품목";
  return `${group}\u0000${category}`;
}

function sameRequirement(left, right) {
  if (requirementIdentity(left) !== requirementIdentity(right)) return false;
  const leftText = normalizeEvidenceText(left.condition);
  const rightText = normalizeEvidenceText(right.condition);
  if (leftText && rightText && (leftText === rightText || leftText.includes(rightText) || rightText.includes(leftText))) return true;
  const sharedEvidence = left.evidenceBlockIds.some((id) => right.evidenceBlockIds.includes(id));
  if (!sharedEvidence) return false;
  return scoreModelMatch(left.condition, right.condition).matchScore >= 75;
}

function mergeDuplicate(left, right) {
  const preferred = clean(right.condition).length > clean(left.condition).length ? right : left;
  const secondary = preferred === right ? left : right;
  return {
    ...preferred,
    evidence: clean(preferred.evidence).length >= clean(secondary.evidence).length ? preferred.evidence : secondary.evidence,
    evidenceBlockIds: unique([...preferred.evidenceBlockIds, ...secondary.evidenceBlockIds]),
    constraints: [...preferred.constraints, ...secondary.constraints].filter((value, index, array) =>
      index === array.findIndex((item) => JSON.stringify(item) === JSON.stringify(value))),
    searchKeywords: unique([...preferred.searchKeywords, ...secondary.searchKeywords]),
  };
}

function collapseRequirements(requirements, uncertainties) {
  const result = [];
  for (const requirement of requirements) {
    const duplicateIndex = result.findIndex((candidate) => sameRequirement(candidate, requirement));
    if (duplicateIndex >= 0) {
      result[duplicateIndex] = mergeDuplicate(result[duplicateIndex], requirement);
      continue;
    }
    const category = canonicalComponentCategory(requirement);
    const group = inferredSpecificationGroup(requirement) || "공통 품목";
    const conflictIndex = result.findIndex((candidate) =>
      singleSlotCategories.has(category)
      && canonicalComponentCategory(candidate) === category
      && (inferredSpecificationGroup(candidate) || "공통 품목") === group);
    if (conflictIndex >= 0) {
      const previous = result[conflictIndex];
      const conditions = unique([clean(previous.condition), clean(requirement.condition)]);
      result[conflictIndex] = {
        ...previous,
        condition: conditions.join(" / "),
        evidence: unique([previous.evidence, requirement.evidence]).join(" / "),
        evidenceBlockIds: unique([...previous.evidenceBlockIds, ...requirement.evidenceBlockIds]),
        constraints: [...previous.constraints, ...requirement.constraints],
        searchKeywords: unique([...previous.searchKeywords, ...requirement.searchKeywords]),
        verificationStatus: "conflict",
        priceSearchAllowed: false,
        quantity: null,
        unitQuantity: null,
      };
      uncertainties.push(`${group} ${category}: 서로 다른 요구조건이 같은 부품 위치에 있어 담당자 확인이 필요합니다.`);
      continue;
    }
    result.push(requirement);
  }
  return result;
}

function applyGroupQuantityContext(requirements, uncertainties) {
  const groups = new Map();
  for (const item of requirements) {
    const group = item.specificationGroup || "공통 품목";
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(item);
  }
  for (const [group, items] of groups) {
    const systemQuantities = unique(items.flatMap((item) => [
      finitePositive(item.systemQuantity),
      item.priceRole === "complete_system" ? finitePositive(item.quantity) : null,
    ])).map(Number);
    if (systemQuantities.length > 1) {
      uncertainties.push(`${group}: 서로 다른 납품수량(${systemQuantities.join(", ")})이 추출되어 확인이 필요합니다.`);
      continue;
    }
    const systemQuantity = systemQuantities[0] || null;
    if (!systemQuantity) continue;
    for (const item of items) {
      if (!item.systemQuantity) {
        item.systemQuantity = systemQuantity;
        item.quantityDerivation = "same_group_system_quantity";
      }
      if (!item.quantity && finitePositive(item.unitQuantity)) {
        item.quantity = systemQuantity * Number(item.unitQuantity);
        item.quantityDerivation = "group_quantity_times_unit_quantity";
      }
    }
  }
  return requirements;
}

export function verifyExtraction(extraction = {}, blocks = [], assessment = {}) {
  const blockMap = new Map(blocks.map((block) => [block.id, block]));
  const uncertainties = unique([...(extraction.uncertainties || []).map(clean), ...(assessment.reasons || [])]);
  const normalized = (extraction.requirements || []).map((item, index) => {
    const evidenceBlockIds = inferEvidenceIds(item, blocks);
    const evidenceText = evidenceBlockIds.map((id) => blockMap.get(id)?.text || "").join("\n");
    const evidenceScore = evidenceSimilarity(item.evidence, evidenceText);
    const evidenceStatus = evidenceBlockIds.length && evidenceScore >= 0.55 ? "verified" : "review";
    const requestedSystemQuantity = finitePositive(item.systemQuantity);
    const requestedUnitQuantity = finitePositive(item.unitQuantity);
    const requestedQuantity = finitePositive(item.quantity);
    const systemQuantity = requestedSystemQuantity && quantityGrounded(requestedSystemQuantity, evidenceText)
      ? requestedSystemQuantity : null;
    const unitQuantity = requestedUnitQuantity && quantityGrounded(requestedUnitQuantity, evidenceText)
      ? requestedUnitQuantity : null;
    let quantity = requestedQuantity && quantityGrounded(requestedQuantity, evidenceText) ? requestedQuantity : null;
    if (systemQuantity && unitQuantity) quantity = systemQuantity * unitQuantity;
    const priceRole = allowedRoles.has(item.priceRole) ? item.priceRole : "non_price";
    const specificationGroup = clean(item.specificationGroup) || inferredSpecificationGroup(item) || null;
    const condition = clean(item.condition);
    const constraints = (item.constraints || []).map(normalizeConstraint).filter(Boolean);
    const searchKeywords = unique([
      ...(item.searchKeywords || []).map(clean),
      ...coreModelKeywords(condition),
      ...constraints.flatMap((constraint) => coreModelKeywords(`${constraint.value} ${constraint.unit || ""}`)),
    ]).slice(0, 12);
    if (evidenceStatus !== "verified") uncertainties.push(
      `${specificationGroup || "공통"} ${item.category || "요구사항"}: 원문 근거 위치를 자동 확정하지 못했습니다.`);
    if (requestedSystemQuantity && !systemQuantity) uncertainties.push(
      `${specificationGroup || "공통"}: 납품수량 ${requestedSystemQuantity}의 원문 근거를 재확인해야 합니다.`);
    if (requestedUnitQuantity && !unitQuantity) uncertainties.push(
      `${specificationGroup || "공통"} ${item.category || "부품"}: 1대당 수량 ${requestedUnitQuantity}의 원문 근거를 재확인해야 합니다.`);
    return {
      ...item,
      id: clean(item.id) || `REQ-${String(index + 1).padStart(3, "0")}`,
      category: canonicalComponentCategory({ ...item, condition }),
      condition,
      quantity,
      specificationGroup,
      unitQuantity,
      systemQuantity,
      priceRole,
      evidence: clean(item.evidence),
      evidenceBlockIds,
      evidenceLocations: evidenceBlockIds.map((id) => blockMap.get(id)?.location).filter(Boolean),
      evidenceStatus,
      evidenceScore: Math.round(evidenceScore * 100),
      constraints,
      searchKeywords,
      confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0)),
      verificationStatus: evidenceStatus,
      priceSearchAllowed: evidenceStatus === "verified" && priceRole !== "complete_system" && priceRole !== "non_price",
    };
  });
  const requirements = applyGroupQuantityContext(collapseRequirements(normalized, uncertainties), uncertainties);
  return {
    ...extraction,
    requirements,
    uncertainties: unique(uncertainties),
    documentAnalysis: {
      structureScore: assessment.score ?? null,
      mode: assessment.mode || "enhanced_prose",
      blockCount: blocks.length,
      verifiedRequirementCount: requirements.filter((item) => item.verificationStatus === "verified").length,
      reviewRequirementCount: requirements.filter((item) => item.verificationStatus !== "verified").length,
    },
  };
}

function candidateRequirementId(candidate) {
  return candidate.requirementId || candidate.requirement?.id || null;
}

function candidateScore(requirement, candidate) {
  const requested = [requirement.condition, ...(requirement.searchKeywords || [])].filter(Boolean).join(" ");
  const match = scoreModelMatch(requested, `${candidate.model || ""} ${candidate.specification || ""}`);
  const sourceRank = candidate.source === "company_price_list" ? 1000 : 300-(priceSourcePriority(candidate.source)*10);
  const matchRank = candidate.matchType === "exact" ? 200 : 100;
  const compatibilityRank = candidate.compatibilityStatus === "incompatible" ? -10000 : candidate.compatibilityStatus === "compatible" ? 40 : 0;
  return sourceRank + matchRank + compatibilityRank + Number(candidate.matchScore ?? match.matchScore ?? 0);
}

function selectCandidate(requirement, candidates) {
  return candidates
    .filter((candidate) => candidateRequirementId(candidate) === requirement.id)
    .filter((candidate) => Number(candidate.unitPrice) > 0)
    .filter((candidate) => candidate.compatibilityStatus !== "incompatible")
    .sort((left, right) => candidateScore(requirement, right) - candidateScore(requirement, left))[0] || null;
}

function auditConfiguration(configuration, sourceRequirements) {
  const issues = [];
  const groups = new Map();
  for (const item of configuration) {
    const group = item.specificationGroup || "공통 품목";
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(item);
  }
  for (const [group, items] of groups) {
    const categories = items.map((item) => canonicalComponentCategory(item));
    const coreCount = categories.filter((category) => essentialCategories.includes(category) || category === "VGA" || category === "HDD").length;
    if (coreCount >= 3) {
      for (const category of essentialCategories.filter((value) => !categories.includes(value))) {
        issues.push({ severity: "blocking", code: "ESSENTIAL_BOM_MISSING", group, category, message: `${group}: ${category} 요구사양이 문서에서 확인되지 않았습니다.` });
      }
    }
    for (const category of singleSlotCategories) {
      const count = categories.filter((value) => value === category).length;
      if (count > 1) issues.push({ severity: "blocking", code: "DUPLICATE_SINGLE_SLOT", group, category, message: `${group}: ${category}가 ${count}개 견적행으로 중복되었습니다.` });
    }
    if (!items.some((item) => finitePositive(item.systemQuantity))) {
      issues.push({ severity: "blocking", code: "SYSTEM_QUANTITY_UNKNOWN", group, message: `${group}: 전체 납품수량을 확정하지 못했습니다.` });
    }
  }
  for (const requirement of sourceRequirements) {
    if (["complete_system", "non_price"].includes(requirement.priceRole)) continue;
    if (requirement.verificationStatus === "conflict") issues.push({ severity: "blocking", code: "REQUIREMENT_CONFLICT", group: requirement.specificationGroup || "공통 품목", category: requirement.category, message: `${requirement.specificationGroup || "공통 품목"} ${requirement.category}: 요구조건 충돌을 확인해야 합니다.` });
    else if (requirement.verificationStatus !== "verified") issues.push({ severity: "warning", code: "EVIDENCE_REVIEW", group: requirement.specificationGroup || "공통 품목", category: requirement.category, message: `${requirement.specificationGroup || "공통 품목"} ${requirement.category}: 원문 근거를 확인해야 합니다.` });
    if (!finitePositive(requirement.unitQuantity)) issues.push({ severity: "blocking", code: "UNIT_QUANTITY_UNKNOWN", group: requirement.specificationGroup || "공통 품목", category: requirement.category, message: `${requirement.specificationGroup || "공통 품목"} ${requirement.category}: 1대당 수량을 확인해야 합니다.` });
  }
  for (const item of configuration.filter((value) => value.unitPrice == null)) {
    issues.push({ severity: "blocking", code: "PRICE_UNKNOWN", group: item.specificationGroup || "공통 품목", category: item.category, message: `${item.specificationGroup || "공통 품목"} ${item.category}: 단가를 확인하지 못했습니다.` });
  }
  for (const item of configuration.filter((value) => value.selectedModel && value.compatibilityStatus === "review")) {
    issues.push({ severity: "warning", code: "COMPATIBILITY_REVIEW", group: item.specificationGroup || "공통 품목", category: item.category, message: `${item.specificationGroup || "공통 품목"} ${item.category}: ${item.compatibilityNotes?.join(", ") || "선행 부품과의 호환성을 확인해야 합니다."}` });
  }
  return issues.filter((issue, index, array) => index === array.findIndex((candidate) => candidate.code === issue.code && candidate.group === issue.group && candidate.category === issue.category));
}

export function buildVerifiedQuotePlan(extraction = {}, priceCandidates = []) {
  const sourceRequirements = extraction.requirements || [];
  const quoteRequirements = sourceRequirements.filter((requirement) =>
    !isWholeSystemItem(requirement) && requirement.priceRole !== "complete_system" && requirement.priceRole !== "non_price");
  const configuration = quoteRequirements.map((requirement) => {
    const candidate = requirement.priceSearchAllowed === false ? null : selectCandidate(requirement, priceCandidates);
    const selectedModel = candidate?.model || null;
    const source = candidate?.sourceUrl || candidate?.source || "";
    let status = "단가 미확인";
    if (requirement.verificationStatus === "conflict") status = "요구조건 충돌 · 원문 확인 필요";
    else if (requirement.verificationStatus !== "verified") status = "원문 근거 확인 필요";
    else if (candidate?.source === "company_price_list") status = `자사 단가표 ${candidate.matchType === "exact" ? "정확 모델" : "핵심사양 후보"} · 일치도 ${candidate.matchScore ?? 0}% · ${candidate.stock || "재고 확인"}`;
    else if (candidate) status = candidate.status || `${candidate.matchType === "exact" ? "동일모델" : "대체모델 후보"} · 일치도 ${candidate.matchScore ?? 0}%`;
    return {
      requirementId: requirement.id,
      category: canonicalComponentCategory(requirement),
      requirement: requirement.condition || requirement.evidence || "원문 확인 필요",
      selectedModel,
      unitPrice: candidate ? Number(candidate.unitPrice) : null,
      quantity: finitePositive(requirement.quantity),
      source,
      status,
      specificationGroup: requirement.specificationGroup || inferredSpecificationGroup(requirement),
      unitQuantity: finitePositive(requirement.unitQuantity),
      systemQuantity: finitePositive(requirement.systemQuantity),
      priceRole: requirement.priceRole,
      evidence: requirement.evidence,
      evidenceBlockIds: requirement.evidenceBlockIds || [],
      evidenceLocations: requirement.evidenceLocations || [],
      verificationStatus: requirement.verificationStatus,
      searchKeywords: requirement.searchKeywords || [],
      constraints: requirement.constraints || [],
      compatibilityStatus: candidate?.compatibilityStatus || null,
      compatibilityNotes: candidate?.compatibilityNotes || [],
    };
  });
  const audit = auditConfiguration(configuration, sourceRequirements);
  return {
    schemaVersion: "2.1",
    generatedAt: new Date().toISOString(),
    configuration,
    audit,
    blockingIssueCount: audit.filter((item) => item.severity === "blocking").length,
    warningIssueCount: audit.filter((item) => item.severity !== "blocking").length,
  };
}
