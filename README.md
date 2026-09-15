# HYOSAN LPM Pattern Library

Google Sheets 데이터를 실시간으로 읽는 효산 내부용 패턴·LPM·경면판 라이브러리입니다.

## 구성

- `index.html`: 웹·모바일 반응형 화면, Google 로그인, 카탈로그 기능
- `manifest.webmanifest`: PC 웹 앱 설치 설정
- `mobile.webmanifest`: Android·iPhone 홈 화면용 모바일 앱 설정
- `sw.js`: 앱 화면과 브랜드 자산 캐시
- `Code.gs`: Google Sheets 동기화, 사용자 승인, Google Slides 내보내기
- `appsscript.json`: Apps Script 권한 설정

## 배포 순서

1. 소스와 Apps Script 코드를 GitHub `main`에 반영합니다.
2. Apps Script에서 `Code.gs`와 `appsscript.json`을 갱신하고 웹 앱을 새 버전으로 배포합니다.
3. 기능 검증 후 GPT Sites에 최종 배포합니다.

## 앱 설치

- PC Chrome·Edge: 화면의 `웹 앱 설치` 또는 주소창 설치 아이콘
- Android Chrome: `모바일 앱 설치` 또는 브라우저 메뉴의 `앱 설치`
- iPhone Safari: 공유 메뉴의 `홈 화면에 추가`

ChatGPT 등 앱 내부 브라우저에서는 설치 메뉴가 제공되지 않을 수 있으므로 기본 브라우저로 열어야 합니다.

## HYOSAN_LPM 시트 열

- `SampleBook`: `SOLID_BOOK`, `CHART_COLLAB_2022`, `EXISTING_2021`, `NEW_2022` 중 하나
- `Category`: `WOOD`, `SOLID`, `STONE`, `FABRIC`, `OTHER` 중 하나
- `PaperNumber`: 팝업과 Slides의 `종이 넘버`에 표시
- `BasePaperCompany`: 팝업에서 `종이 넘버` 옆의 `원지 회사명`으로 표시

중복되던 `ProductCode`와 값이 없던 `Characteristics` 열은 제거했습니다. 기존 `PatternForm` 값은 `PaperNumber`로 이름을 바꿔 그대로 유지합니다.

## LPM 필터 관리

`CATEGORIES` 시트에서 아래 두 메뉴를 관리합니다.

- `LPM_BOOK`: 샘플북 필터 (`전체`, `솔리드`, `샤트콜라보`, `기존`, `신규`)
- `LPM_CATEGORY`: 디자인 필터 (`전체`, `우드`, `솔리드`, `스톤 · 타일`, `패브릭 · 텍스처`, `기타`)

## 동기화와 모바일 로그인

- 자동 동기화는 30분마다 실행됩니다.
- `지금 동기화`를 누르면 즉시 갱신되고 다음 자동 동기화 시간이 다시 30분 뒤로 설정됩니다.
- 모바일의 당겨서 새로고침을 막아 화면을 위로 움직일 때 로그인 화면으로 돌아가는 현상을 방지합니다.
- Apps Script 요청은 외부 웹앱에서도 404가 발생하지 않는 브라우저 호환 POST 형식을 사용합니다.

## 컬러리스트

- 색상 유사도는 5% 범위입니다.
- 화면 색상과 실제 샘플 색상이 다를 수 있다는 안내를 표시합니다.
- 최초 스포이드 위치는 색상환 중앙입니다.
- LPM 팝업의 컬러명은 등록 색상 중 가장 유사한 이름임을 안내합니다.

## 이미지 저장

Google Drive 이미지는 브라우저에서 원본 다운로드 주소로 바로 요청합니다. 일반 이미지 주소는 브라우저 다운로드를 먼저 시도하고, 서버의 교차 출처 제한이 있으면 직접 다운로드 방식으로 전환합니다.

## Slides 내보내기 권한

새 슬라이드는 Apps Script 실행 계정 소유로 생성됩니다. 관리자 본인의 내보내기는 별도 Drive 공유 호출 없이 열리고, 승인된 다른 사용자의 내보내기는 `drive.file` 범위로 생성 파일만 자동 공유합니다. 공유 권한이 일시적으로 실패해도 슬라이드 생성 결과는 유지됩니다.
