const wholeSystemPattern = /전산기자재\s*전체|컴퓨터\s*본체\s*(?:사양)?\s*\d*$|데스크[탑톱]\s*컴퓨터\s*본체|완제품\s*(?:PC|컴퓨터)|본체\s*전체/i;
const nonPricePattern = /입찰|보증서|사업자|등기부|인감|위임장|자격|대금\s*지급|공고\s*전체/i;

export function inferredSpecificationGroup(item = {}) {
  if (item.specificationGroup) return String(item.specificationGroup).trim();
  const text = `${item.category || ""} ${item.condition || item.requirement || ""}`;
  const match = text.match(/(?:데스크탑\s*컴퓨터\s*)?(?:본체\s*)?사양\s*([0-9]+)/i);
  return match ? `본체사양 ${match[1]}` : null;
}

export function isWholeSystemItem(item = {}) {
  if (item.priceRole === "complete_system") return true;
  return wholeSystemPattern.test(String(item.category || "").trim());
}

export function isPriceableRequirement(item = {}) {
  if (["complete_system", "non_price"].includes(item.priceRole)) return false;
  if (isWholeSystemItem(item)) return false;
  if (!item.priceRole && nonPricePattern.test(String(item.category || ""))) return false;
  return Number(item.quantity) > 0;
}

export function canonicalComponentCategory(item = {}) {
  const categoryText = String(item.category || "");
  const text = `${categoryText} ${item.requirement || item.condition || ""}`;
  const mappings = [
    ["CPU 쿨러", /CPU.*쿨러|COOLER/i], ["MAINBOARD", /메인보드|MAINBOARD|MOTHERBOARD/i],
    ["CPU", /CPU(?!.*쿨러)|프로세서/i], ["M.2", /M\.2|NVME|SSD/i],
    ["HDD", /HDD|하드디스크/i], ["POWER", /파워|POWER|PSU/i],
    ["VGA", /그래픽|VGA|GPU|RTX|RADEON/i], ["RAM", /메모리|\bRAM\b|DDR[45]/i],
    ["CASE", /케이스|CASE/i], ["운영체제(O/S)", /운영체제|WINDOWS|O\/S/i],
    ["K/B(OEM)", /키보드|K\/B/i], ["마우스패드", /마우스패드/i],
    ["MOUSE(OEM)", /마우스|MOUSE/i], ["모니터", /모니터|MONITOR/i],
  ];
  return mappings.find(([, pattern]) => pattern.test(categoryText))?.[0]
    || mappings.find(([, pattern]) => pattern.test(text))?.[0]
    || item.category || "기타";
}

function mode(values) {
  const counts = new Map();
  for (const value of values.filter((value) => Number(value) > 0)) counts.set(Number(value), (counts.get(Number(value)) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] || 1;
}

export function buildQuoteGroups(configuration = []) {
  const usable = configuration.filter((item) => !isWholeSystemItem(item) && item.priceRole !== "non_price");
  const explicitGroups = usable.map(inferredSpecificationGroup).filter(Boolean);
  const fallbackGroup = explicitGroups.length ? "공통 품목" : "본체사양 1";
  const grouped = new Map();
  for (const item of usable) {
    const groupName = inferredSpecificationGroup(item) || fallbackGroup;
    if (!grouped.has(groupName)) grouped.set(groupName, []);
    grouped.get(groupName).push(item);
  }
  return [...grouped.entries()].map(([name, items]) => {
    const systemQuantity = mode([
      ...items.map((item) => item.systemQuantity),
      ...items.filter((item) => !item.unitQuantity || Number(item.unitQuantity) === 1).map((item) => item.quantity),
    ]);
    return {
      name,
      systemQuantity,
      items: items.map((item) => ({
        ...item,
        category: canonicalComponentCategory(item),
        unitQuantity: Number(item.unitQuantity) > 0
          ? Number(item.unitQuantity)
          : Number(item.quantity) > 0 && Number(item.quantity) % systemQuantity === 0
            ? Number(item.quantity) / systemQuantity
            : Number(item.quantity) || null,
      })),
    };
  }).sort((a, b) => {
    const rank = (name) => /^본체사양\s*\d+/i.test(name) ? 0 : name === "공통 품목" ? 2 : 1;
    return rank(a.name) - rank(b.name) || a.name.localeCompare(b.name, "ko", { numeric: true });
  });
}
