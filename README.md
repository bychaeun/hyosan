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

- `SampleBook`: `솔리드`, `샤트콜라보2022`, `기존 2021`, `신규 2022` 중 하나 (그 외 값을 입력하면 입력한 값 그대로 새 탭으로 표시됩니다)
- `Category`: `WOOD`, `SOLID`, `STONE`, `FABRIC`, 그 외 값은 입력한 값 그대로 새 탭으로 표시됩니다 (미입력 시 `기타`)
- `PaperNumber` 또는 `PaperNo`: 팝업과 Slides의 `종이 넘버`에 표시

기존 `PatternForm` 값도 종이 넘버의 예비 값으로 계속 인식합니다.

샘플 팝업창에는 더 이상 `품번`, `특징` 항목이 표시되지 않습니다 (패턴 디자인·경면판 팝업에는 계속 표시됩니다). 시트의 해당 열 자체는 검색·Slides 내보내기 등에서 계속 사용되므로 남겨두어도 됩니다.

## 효산 LPM 대분류 (샘플북 / 패턴 종류) 를 Google Sheets에서 관리하기

`CATEGORIES` 시트에 아래 두 `Menu` 값으로 행을 추가하면, 화면의 "샘플북"·"디자인(패턴 종류)" 탭 목록이 시트 내용을 그대로 따라갑니다. 행을 추가하지 않으면 기존 기본 목록이 그대로 사용됩니다.

- `Menu` = `LPM_BOOK`, `Code` = `HYOSAN_LPM.SampleBook`에 적는 값과 동일한 코드, `Label` = 탭에 표시할 이름 → 샘플북 분류
- `Menu` = `LPM_CATEGORY`, `Code` = `HYOSAN_LPM.Category`에 적는 값과 동일한 코드, `Label` = 탭에 표시할 이름 → 패턴 종류(우드/솔리드/스톤·타일/패브릭 등) 분류

예)

```
Menu,Code,Label
LPM_BOOK,ALL,전체
LPM_BOOK,SOLID_BOOK,솔리드
LPM_BOOK,NEW_2023,신규 2023
LPM_CATEGORY,ALL,전체
LPM_CATEGORY,WOOD,우드
LPM_CATEGORY,LEATHER,가죽
```

`PATTERN_DESIGN`(패턴 디자인) 탭 분류도 같은 방식으로 `Menu`=`PATTERN` 행을 추가해 관리할 수 있습니다 (기존 기능).

## 컬러리스트

- 색상 유사도 허용 범위는 5%로 설정되어 있습니다 (`index.html`의 `CONFIG.COLOR_TOLERANCE_PERCENT`).
- 컬러 목록 화면 좌측에 "모니터 화면과 실제 샘플의 색상은 다를 수 있으니 실물 확인을 권장드립니다" 문구가 표시됩니다.
- 색상환의 스포이드(선택 표시)는 처음 진입 시 색상환 정중앙에 위치합니다.
- 샘플 팝업의 컬러 항목에는 "컬러명은 가장 유사한 색상 이름으로 표기되었습니다" 안내 문구가 함께 표시됩니다.

## 동기화

- 자동 동기화 주기는 30분입니다 (`index.html`의 `CONFIG.SYNC_MS`).
- `지금 동기화` 버튼을 누르면 즉시 동기화되며, 다음 자동 동기화는 그 시점부터 다시 30분 뒤로 재설정됩니다.

## 모바일 로그인 유지

- 모바일 화면에서 위로 당겨도(pull-to-refresh) 브라우저가 페이지를 새로고침하지 않도록 `overscroll-behavior`를 적용했습니다. 승인된 로그인 세션은 화면을 위로 당겨도 다시 로그인 화면으로 돌아가지 않습니다.

## Slides 내보내기 권한

새 슬라이드는 Apps Script 실행 계정 소유로 생성됩니다. 관리자 본인의 내보내기는 별도 Drive 공유 호출 없이 열리고, 승인된 다른 사용자의 내보내기는 `drive.file` 범위로 생성 파일만 자동 공유합니다. 공유 권한이 일시적으로 실패해도 슬라이드 생성 결과는 유지됩니다.
