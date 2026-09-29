# HYOSAN LPM Pattern Library

Google Sheets 데이터를 실시간으로 읽는 효산 내부용 패턴·LPM·경면판·건설사 현장 라이브러리입니다.

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

- `SampleBook`: 샘플북 이름. 입력된 값으로 샘플북 필터가 자동 생성됩니다.
- `Category`: 디자인 분류 이름. 입력된 값으로 디자인 필터가 자동 생성됩니다.
- `PaperNumber`: 팝업과 Slides의 `종이 넘버`에 표시
- `BasePaperCompany`: 팝업에서 `종이 넘버` 옆의 `원지 회사명`으로 표시
- `PreviousNames`: 제품명이 바뀌기 전에 쓰이던 이전 이름들 (쉼표로 구분). 값이 있으면 팝업의 제품명 바로 아래에 "이전 제품명: ..."으로 표시되고, 검색에도 포함됩니다. 비워두면 표시 안 됨

중복되던 `ProductCode`와 값이 없던 `Characteristics` 열은 제거했습니다. 기존 `PatternForm` 값은 `PaperNumber`로 이름을 바꿔 그대로 유지합니다.

## LPM 필터 관리

효산 LPM의 샘플북 및 디자인 필터는 `HYOSAN_LPM` 시트의 `SampleBook`, `Category` 값을 기준으로 자동 생성됩니다. 새 분류를 추가할 때 `CATEGORIES` 시트나 프로그램 코드를 별도로 수정할 필요가 없습니다.

패턴 디자인 필터도 `PATTERN_DESIGN` 시트의 `PrimaryCategory` 값을 기준으로 자동 생성됩니다. 별도의 `CATEGORIES` 시트는 사용하지 않습니다.

## 경면판 표시 여부

`EMBOSS_PLATE` 시트의 `Active` 열을 사용합니다.

- `TRUE`: 사이트에 표시
- `FALSE`: 사이트에서 숨김

## 건설사 현장 관리

`CONSTRUCTION_SITES` 시트에 아래 열 순서로 입력합니다.

- `Construction_ID`: 각 현장의 고유 ID
- `Company`: 건설사명. 이 값으로 사이트 필터가 자동 생성됩니다.
- `SiteName`: 현장명
- `SpecialSpecNumbers`: 건설사 화면에 표시할 특별넘버입니다. 여러 개는 줄바꿈으로 구분합니다.
- `LinkedSpecialSpec_IDs`: 각 특별넘버가 연결될 `SPECIAL_SPECS`의 `SpecialSpec_ID`입니다. `SpecialSpecNumbers`와 같은 순서로 줄바꿈해 입력하며 화면에는 표시되지 않습니다.
- `ImageURL`: 이미지 URL. 여러 장은 셀 안에서 줄바꿈으로 구분합니다.
- `MHOpenDate`: 모델하우스 오픈일
- `CompletionDate`: 완공일
- `Active`: `TRUE`면 표시, `FALSE`면 숨김

`Company`에 입력한 건설사명은 사이트의 건설사 필터에 자동 추가됩니다. 모바일에서는 건설사가 많아져도 길어지지 않도록 선택 목록으로 표시됩니다.

건설사 현장 팝업에는 종이번호·실제 제품번호·별도 경면 항목을 노출하지 않고, 괄호 안 경면 정보까지 포함된 적용 스펙만 표시합니다. 적용 스펙 버튼은 같은 줄 순서의 `LinkedSpecialSpec_IDs`를 이용합니다.

적용 스펙은 특별넘버 이미지가 위, 스펙 넘버가 아래인 작은 정사각형 카드로 표시됩니다. 카드를 누르면 해당 특별넘버 팝업으로 이동합니다.

팝업 안의 연결 버튼으로 다른 제품·경면판·특별넘버를 연 경우 왼쪽 상단의 뒤로 버튼으로 최근 2단계까지 돌아갈 수 있습니다.

## 특별넘버 관리

`SPECIAL_SPECS` 시트에서 특별넘버를 별도로 관리합니다.

- `SpecialSpec_ID`: 변경하지 않는 특별넘버 고유 ID
- `SpecialSpecNumber`: 괄호 안 경면 정보까지 포함한 전체 특별넘버
- `MajorCategory`: 특별넘버 대분류. 입력한 값이 대분류 필터로 자동 생성됩니다.
- `SubCategory`: 선택한 대분류 안의 소분류. 입력한 값이 소분류 필터로 자동 생성됩니다.
- `PaperNumber`: 종이 넘버
- `EmbossType`: 경면 종류. `EMBOSS_PLATE`의 경면 ID 또는 이름과 일치하면 클릭해서 해당 경면판 팝업으로 이동합니다. 여러 개는 줄바꿈이나 쉼표로 구분합니다.
- `Content`: 특별넘버 설명. 내용 안에 `LPM-806`처럼 LPM ID를 입력하면 해당 제품 팝업으로 이동하는 버튼으로 표시됩니다.
- `LinkedLPM_ID`: 기존 데이터 호환용 연결 ID입니다. 새 데이터는 필요하면 `Content`에 LPM ID를 입력하면 됩니다.
- `ImageURL`: 특별넘버 전용 이미지 URL. 여러 장은 셀 안에서 줄바꿈으로 구분합니다.
- `Active`: `TRUE`면 표시, `FALSE`면 숨김

`특별넘버`는 효산 LPM과 분리된 상단 메뉴로 표시됩니다. `MajorCategory`와 `SubCategory`에 새로운 분류명을 입력하면 대분류와 소분류 필터가 자동 생성되므로 코드 수정은 필요하지 않습니다. 빈 분류는 `미분류`로 표시됩니다.

## 동기화와 모바일 로그인

- 자동 동기화는 30분마다 실행됩니다.
- `지금 동기화`를 누르면 즉시 갱신되고 다음 자동 동기화 시간이 다시 30분 뒤로 설정됩니다.
- 모바일의 당겨서 새로고침을 막아 화면을 위로 움직일 때 로그인 화면으로 돌아가는 현상을 방지합니다.
- Apps Script 요청은 외부 웹앱에서도 404가 발생하지 않는 브라우저 호환 POST 형식을 사용합니다.

## 컬러리스트

- 색상 유사도는 8% 범위입니다.
- 화면 색상과 실제 샘플 색상이 다를 수 있다는 안내를 표시합니다.
- 최초 스포이드 위치는 색상환 중앙입니다.
- LPM 팝업의 컬러명은 등록 색상 중 가장 유사한 이름임을 안내합니다.

## 이미지 저장

Google Drive 이미지는 브라우저에서 원본 다운로드 주소로 바로 요청합니다. 일반 이미지 주소는 브라우저 다운로드를 먼저 시도하고, 서버의 교차 출처 제한이 있으면 직접 다운로드 방식으로 전환합니다.

## Slides 내보내기 권한

새 슬라이드는 Apps Script 실행 계정 소유로 생성됩니다. 관리자 본인의 내보내기는 별도 Drive 공유 호출 없이 열리고, 승인된 다른 사용자의 내보내기는 `drive.file` 범위로 생성 파일만 자동 공유합니다. 공유 권한이 일시적으로 실패해도 슬라이드 생성 결과는 유지됩니다.

