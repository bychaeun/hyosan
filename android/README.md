# 효산 LPM Android 설치·확인용 앱

GPT 사이트 https://hyosan-lpm.chae-ni.chatgpt.site/ 만 엽니다. GitHub Pages로 연결하지 않습니다.

- Android 6.0 이상, Chrome/삼성 인터넷 등 호환 브라우저와 인터넷 필요.
- Custom Tabs 사용: Google 로그인과 다운로드를 브라우저가 처리하며 앱은 비밀번호·쿠키를 읽지 않습니다.
- 상단 브라우저 주소 표시줄이 있습니다. 완전한 전체화면 TWA가 아닙니다.
- GitHub Actions의 `Build Android preview APK` 산출물에서 APK를 내려받을 수 있습니다.
- 설치·확인용 debug 서명 APK입니다(디버깅은 비활성화). Play Store 배포용이 아닙니다.
- 실행마다 빌드 서명 키가 달라질 수 있으므로 다음 테스트 APK 설치 시 이전 앱 삭제가 필요할 수 있습니다. 정식 직원 배포 전 회사용 서명 키를 별도 안전하게 보관해야 합니다.
- 실제 Android 기기에서 로그인, 이미지 저장, PDF·슬라이드 링크를 최종 확인해야 합니다.

빌드: Java 17, Android SDK 35, Gradle 8.9 환경에서 `gradle -p android :app:assembleDebug`.
