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

- `SampleBook`: `솔리드`, `샤트콜라보2022`, `기존 2021`, `신규 2022` 중 하나
- `Category`: `WOOD`, `SOLID`, `STONE`, `FABRIC`, 그 외 값은 `기타`
- `PaperNumber` 또는 `PaperNo`: 팝업과 Slides의 `종이 넘버`에 표시

기존 `PatternForm` 값도 종이 넘버의 예비 값으로 계속 인식합니다.

## Slides 내보내기 권한

새 슬라이드는 Apps Script 실행 계정 소유로 생성됩니다. 관리자 본인의 내보내기는 별도 Drive 공유 호출 없이 열리고, 승인된 다른 사용자의 내보내기는 `drive.file` 범위로 생성 파일만 자동 공유합니다. 공유 권한이 일시적으로 실패해도 슬라이드 생성 결과는 유지됩니다.
