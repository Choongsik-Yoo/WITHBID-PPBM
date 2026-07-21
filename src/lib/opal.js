function compactPriceItem(item) {
  return [item.category, item.model, item.mpn, item.specification, item.benchmark ?? "-", item.unitPrice ?? "가격 미기재", item.stock, item.discontinuedRisk]
    .map((value) => String(value ?? "").trim())
    .join(" | ");
}

export function buildOpalBundle({ notice, sourceText, priceItems, certificationText = "", targetMargin = 12 }) {
  const prices = priceItems.length
    ? priceItems.map(compactPriceItem).join("\n")
    : "등록된 자사 단가가 없습니다. 가격을 추정하지 말고 가격 확인 필요로 표시하세요.";

  return `# WITHBID 조달공고 분석 요청

너는 대한민국 공공조달 입찰 공고를 분석하는 전문가다. 아래 원문과 자사 정보를 근거로 분석하라.
원문에 없는 내용과 가격은 추측하지 말고 반드시 "확인 필요"로 표시한다.

## 공고 기본정보
- 공고번호: ${notice.noticeNumber}
- 공고명: ${notice.title}
- 수요기관: ${notice.organization || "미입력"}
- 마감일: ${notice.deadline}
- 원문 URL: ${notice.sourceUrl || "미입력"}
- 목표 마진율: ${Number(targetMargin) || 12}%

## 공고·규격 원문
${String(sourceText || "").trim() || "원문이 입력되지 않았습니다."}

## 자사 부품 단가표
구분 | 모델명 | 제조사부품번호 | 규격 | 벤치마크 | 매입단가 | 재고 | 단종위험
${prices}

## 자사 인증 보유현황
${String(certificationText || "").trim() || "인증 보유현황 미입력"}

## 가격 적용 규칙
1. 위 자사 단가표를 최우선으로 사용한다.
2. 자사 단가표에 정확히 일치하는 품목이 없으면 가격을 만들지 않는다.
3. 미등록 품목은 "컴퓨존 확인 필요", 그다음 "가이드컴 확인 필요"로 표시한다.
4. 외부 가격이 사용자에 의해 제공되면 판매처, 조회 시각, 상품 상세 링크를 함께 표시한다.
5. 부가세 포함 여부와 배송비가 불명확하면 별도 확인 항목으로 둔다.

## 출력 형식

# 입찰 참가 판단 리포트

## 1. 결론
참가 / 조건부 참가 / 포기 중 하나만 선택하고 핵심 근거를 한 문장으로 작성한다.

## 2. 공고 개요
공고번호, 공고명, 수요기관, 계약방법, 예산, 마감일시, 납품수량과 장소를 표로 작성한다.

## 3. 참가자격·인증 게이트
| 요구사항 | 필수 여부 | 자사 충족 | 원문 근거 | 판정 |
|---|---|---|---|---|

## 4. 요구사양과 구성 견적
| 구분 | 요구사양 | 선정 모델 | 충족 여부 | 단가 | 수량 | 금액 | 가격 출처 |
|---|---|---|---|---:|---:|---:|---|

## 5. 원가와 수익성
부품원가, 조립·검사·포장, 물류비, 총원가, 예상이익, 예상마진율을 표로 작성한다.

## 6. 치명 리스크와 주의사항
원문 근거와 함께 치명 항목을 먼저 제시한다.

## 7. 실무 확인 체크리스트
AI가 확인하지 못한 항목, 단가 미등록 품목, 원문이 모호한 항목을 - [ ] 형식으로 작성한다.

마지막에 "본 리포트는 AI 자동 분석 결과이며 최종 투찰 전 담당자의 원문 대조가 필요합니다."를 표시한다.`;
}
