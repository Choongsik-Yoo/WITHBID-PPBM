# WITHBID-PPBM

조달공고 원문, 자사 단가표, 가격 근거와 분석 결과를 회사 NAS의 `\\WITHUSNAS1\입찰관리`에 보관하는 Windows용 업무 앱입니다. GitHub에는 코드와 테스트만 저장합니다.

## 현재 구현된 기능

- 로컬 전용 대시보드 (`127.0.0.1`)
- 승인된 Google 계정 로그인 및 관리자/일반 사용자 권한 분리
- `\\WITHUSNAS1\입찰관리` 공유폴더 저장
- 공고 기본정보 등록 및 공고별 작업 폴더 생성
- ZIP 첨부파일 자동 해제 및 압축 내부 HWP/HWPX의 PDF 자동 변환
- Excel 첨부파일(XLS/XLSX/XLSM/XLSB)의 PDF 자동 변환 및 분석 포함
- 분석 완료 공고의 `결과 폴더 열기` 버튼으로 해당 NAS 작업 폴더를 Windows 탐색기에서 바로 열기
- CSV/XLSX company price list 업로드, 원본·정규화 데이터 보관
- 자사 단가표 모델명/부품번호 우선 검색
- 자사 단가가 없을 때 컴퓨존 → 가이드컴 검색 링크 제공
- 공고 원문·단가표·인증현황을 합친 Opal 입력문 생성 및 복사
- Opal 분석 결과를 공고별 `06_분석결과` 폴더에 저장
- GitHub Actions 자동 검사

## 실행

Node.js 20 이상이 필요합니다.

```powershell
npm install
npm start
```

브라우저에서 `http://127.0.0.1:4317`을 엽니다. 또는 `scripts\start-withbid.cmd`를 더블클릭합니다.

다른 저장 위치를 시험하려면 실행 전에 `DATA_ROOT` 환경변수를 지정합니다. 운영 기본값은 `\\WITHUSNAS1\입찰관리`입니다. Windows에서 해당 NAS 공유폴더에 먼저 로그인되어 있어야 합니다.

## 데스크탑 설치 패키지

`npm run package:windows`를 실행하면 `dist/Install-WITHBID-PPBM-Online.cmd`, 릴리스용 앱 묶음, ZIP 보조 패키지가 생성됩니다. 회사 Windows 애플리케이션 제어 정책이 서명되지 않은 EXE를 차단하므로 EXE는 배포하지 않습니다. CMD 인코딩 오류를 방지하기 위해 온라인 설치 CMD는 파일명과 명령을 ASCII로 유지합니다. 사용자는 이 CMD 하나만 더블클릭하면 되며, Windows 기본 curl·PowerShell이 GitHub 릴리스에서 앱을 내려받아 진행 창과 함께 설치합니다. Node.js는 별도로 설치할 필요가 없습니다.

앱은 NAS 계정이나 비밀번호를 저장하지 않습니다. 사용자가 파일 탐색기에서 `\\Withusnas1\입찰관리`에 먼저 로그인하면, 바탕화면 실행기가 그 Windows 사용자 세션의 SMB 권한을 상속하고 읽기·쓰기 권한을 확인한 뒤 서버를 실행합니다.

## Google 사용자 인증

최초 실행 시 관리자가 Google Cloud Console에서 발급한 OAuth 2.0 웹 클라이언트 ID를 등록합니다. 승인 사용자 목록은 GitHub에 커밋하지 않으며, 최초 운영 설정 후 NAS의 `_설정/auth.json`에서 중앙 관리됩니다.

개발 PC에서 최초 승인목록을 준비할 때는 `config/authorized-users.local.json`을 사용합니다. 이 파일은 `.gitignore`에 포함되어 실제 Gmail 주소가 GitHub에 노출되지 않습니다. Google OAuth의 승인된 JavaScript 원본에는 `http://127.0.0.1:4317`을 등록해야 합니다.

## 단가표 열

샘플은 `samples/company_price_list_sample.csv`에 있습니다. 기본 열은 구분, 모델명, 제조사부품번호, 규격, 벤치마크점수, 매입단가, 재고상태, 단종위험, 갱신일입니다. 모델명 또는 제조사부품번호 중 하나는 있어야 합니다.

## 다음 개발 단계

나라장터 API/첨부파일 수집, 문서 텍스트 추출과 OCR, 쇼핑몰 상품 상세정보 수집, 견적서 및 PDF 리포트 생성을 순서대로 연결합니다. AI 분석은 별도 API 키 없이 Opal 입력문 복사와 결과 회수 방식으로 동작합니다.

자세한 구조는 `조달공고_분석시스템_재설계안.md`를 참고하세요.
