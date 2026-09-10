# HYOSAN LPM Pattern Library

기존 Drive 원본 index.html, Code.gs, README.md를 이어받았습니다.
Google Sheets → Apps Script → GitHub Pages. 최초 접속과 15초마다 재조회하며 시트 수정에 GitHub 재커밋은 필요하지 않습니다.

## 현재 상태
Apps Script 배포 URL이 없어 CONFIG.API_URL은 비어 있습니다. Pages는 배포 준비 상태이며 게시와 실시간 연결 성공을 의미하지 않습니다.
원본 시트: https://docs.google.com/spreadsheets/d/1RC-6ibPA86zaWOGt1rzgmQf9tLpT4OcgdI6K9XcUPTI/edit
시트 이미지가 비어 있으면 대체 이미지를 표시합니다.

## 최초 설정
1. 위 시트 → 확장 프로그램 → Apps Script에서 Code.gs를 붙여넣습니다. 원본 시트 ID는 코드에 지정되어 있습니다.
2. getAllData_를 실행하고 시트 읽기 권한을 승인합니다.
3. 배포 → 새 배포 → 웹 앱. 공개 사이트 조회에는 로그인 없이 읽을 수 있는 배포가 필요합니다.
4. /exec로 끝나는 배포 URL을 index.html의 CONFIG.API_URL에 입력해 커밋합니다.
5. URL에 ?action=data를 붙여 patterns/lpm/emboss/categories 배열이 반환되는지 확인합니다.
6. 저장소 Settings → Pages → Deploy from a branch → main → /(root) → Save.
7. 예상 주소 https://bychaeun.github.io/hyosan/ 에서 HYOSAN 화면을 확인하고 시트 수정이 약 15초 후 반영되는지 검사합니다.
8. Apps Script 코드 수정 후에는 배포 관리에서 새 버전으로 갱신합니다.

## 기능
패턴 상세 분류와 30개 페이지, 작은 이미지와 우측 이름 카드, 효산 LPM 전체/솔리드/우드/스톤/패브릭 필터(시트 추가 분류 포함), 상세 정보와 관련 항목 이동, 경면판 추천, 이미지 150% 확대, X/외부 클릭/Escape 닫기를 유지했습니다.
색상환 채도/명도 슬라이더는 선택색과 추천을 함께 갱신합니다. 30% 허용치는 프로젝트 근사 설정으로 ΔE76 ≤ 30을 사용하며 정확한 지각적 백분율이 아닙니다.
RELATIONS의 Pattern_ID/LPM_ID/EmbossPlate_ID를 기존 관계 열과 합칩니다.

## Slides 내보내기
효산 상세창 버튼이 POST action=exportToSlides를 호출합니다.
CONFIG 시트의 SLIDES_DESTINATION_ID가 있으면 해당 자료에 추가하고, 없으면 새 자료를 만듭니다. 실행 계정의 Slides 권한과 새 창 허용이 필요합니다.
공개 웹 앱을 소유자 권한으로 실행하면 방문자도 소유자 계정으로 내보내기를 호출할 수 있으므로 운영 대상에 맞게 접근을 설정하세요.
실제 배포에서 데이터 조회와 Slides 생성 모두 검증해야 합니다.

## 검증 범위
로컬 JavaScript 구문, 30개 페이지 경계, 슬라이더 갱신, 색상 검증/매칭, 관련 상세 열기, 내보내기 버튼, 카드 텍스트 처리, 관계 시트 병합을 확인했습니다.
실제 Apps Script 권한, 브라우저 간 요청, Slides 생성, Pages 게시 성공은 아직 확인하지 않았습니다.
.nojekyll 포함. 도메인이 정해지면 Pages Custom domain과 DNS를 설정합니다.

공식 안내:
https://developers.google.com/apps-script/guides/web
https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
