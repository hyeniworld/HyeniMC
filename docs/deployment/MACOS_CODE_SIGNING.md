# macOS 코드 서명 및 공증 가이드

## 문제 상황

macOS에서 자동 업데이트 시 다음과 같은 에러가 발생합니다:

```
Error: Code signature at URL file:///.../HyeniMC.app/ did not pass validation: 
코드에 리소스가 없지만 서명이 리소스를 나타내야 한다고 표시함
```

이는 macOS의 **Gatekeeper**가 서명되지 않은 앱의 자동 업데이트를 차단하기 때문입니다.

## 해결 방법

### 1. Apple Developer Program 가입 (필수)

macOS 앱의 자동 업데이트를 위해서는 **Apple Developer Program** 가입이 필요합니다.

- **비용**: 연간 $99 USD
- **가입 링크**: https://developer.apple.com/programs/

### 2. Developer ID 인증서 생성

1. **Apple Developer 계정**에 로그인
2. **Certificates, Identifiers & Profiles** 섹션으로 이동
3. **Certificates** → **+** 버튼 클릭
4. **Developer ID Application** 선택
5. 인증서 생성 및 다운로드
6. 다운로드한 인증서를 더블클릭하여 **키체인 접근**에 설치

### 3. App-Specific Password 생성

공증(Notarization)을 위해 App-Specific Password가 필요합니다:

1. https://appleid.apple.com 접속
2. **로그인 및 보안** → **앱 암호** 섹션
3. **암호 생성** 클릭
4. 이름 입력 (예: "HyeniMC Notarization")
5. 생성된 암호를 안전한 곳에 저장

### 4. 환경 변수 설정

#### 로컬 개발 환경

`.env` 파일에 다음 환경 변수를 추가:

```bash
# Apple Developer 계정 정보
APPLE_ID=your-apple-id@example.com
APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
APPLE_TEAM_ID=YOUR_TEAM_ID

# 코드 서명 인증서 (선택사항 - 자동으로 찾음)
# CSC_NAME="Developer ID Application: Your Name (TEAM_ID)"
```

**APPLE_TEAM_ID 찾는 방법**:
1. https://developer.apple.com/account 접속
2. **Membership** 섹션에서 **Team ID** 확인

#### GitHub Actions 환경

GitHub 저장소의 **Settings** → **Secrets and variables** → **Actions**에서 다음 시크릿을 추가:

- `APPLE_ID`: Apple Developer 계정 이메일
- `APPLE_APP_SPECIFIC_PASSWORD`: 생성한 App-Specific Password
- `APPLE_TEAM_ID`: Apple Developer Team ID

### 5. 빌드 및 배포

환경 변수가 설정되면 일반적인 빌드 명령어를 실행:

```bash
# macOS 빌드
npm run package:mac
```

electron-builder가 자동으로:
1. 앱에 코드 서명 적용
2. Apple에 공증 요청
3. 공증된 앱을 패키징

## 대안: 코드 서명 없이 사용

**주의**: 이 방법은 보안상 권장되지 않으며, 자동 업데이트가 작동하지 않습니다.

### 옵션 A: DMG 파일 수동 다운로드

사용자가 GitHub Releases에서 DMG 파일을 직접 다운로드하여 설치하도록 안내합니다.

사용자는 처음 실행 시:
1. DMG 파일을 마운트
2. 앱을 Applications 폴더로 드래그
3. 우클릭 → **열기**를 선택하여 Gatekeeper 경고 우회

### 옵션 B: 자동 업데이트 비활성화

`package.json`에서 macOS 자동 업데이트를 비활성화:

```json
{
  "build": {
    "mac": {
      "target": [
        {
          "target": "dmg",
          "arch": ["arm64", "x64", "universal"]
        }
      ]
    }
  }
}
```

그리고 앱 코드에서 macOS 자동 업데이트 체크를 비활성화:

```typescript
if (process.platform !== 'darwin') {
  autoUpdater.checkForUpdatesAndNotify();
}
```

## 트러블슈팅

### 서명 실패

```
Error: Command failed: codesign ...
```

**해결책**:
- 키체인 접근에서 인증서가 올바르게 설치되었는지 확인
- `CSC_NAME` 환경 변수가 정확한지 확인

### 공증 실패

```
Error: Notarization failed
```

**해결책**:
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`가 올바른지 확인
- Apple Developer 계정이 활성 상태인지 확인

### 공증 상태 확인

```bash
# 공증 상태 확인
xcrun altool --notarization-history 0 -u "your-apple-id@example.com" -p "xxxx-xxxx-xxxx-xxxx"

# 특정 공증 요청 상태 확인
xcrun altool --notarization-info <RequestUUID> -u "your-apple-id@example.com" -p "xxxx-xxxx-xxxx-xxxx"
```

## 참고 자료

- [Apple Developer Program](https://developer.apple.com/programs/)
- [electron-builder Code Signing](https://www.electron.build/code-signing)
- [Notarizing macOS Software](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution)
- [electron-updater Documentation](https://www.electron.build/auto-update)
