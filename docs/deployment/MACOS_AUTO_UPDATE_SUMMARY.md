# macOS 자동 업데이트 문제 해결 요약

## 문제 상황

macOS에서 자동 업데이트 시도 시 다음 에러 발생:

```
Error: Code signature at URL file:///.../HyeniMC.app/ did not pass validation: 
코드에 리소스가 없지만 서명이 리소스를 나타내야 한다고 표시함
```

## 원인

macOS의 **Gatekeeper**가 서명되지 않은 앱의 자동 업데이트를 차단합니다.

## 해결 방법

### ✅ 권장: Apple Developer Program 가입

**필요 사항**:
- Apple Developer Program 가입 (연간 $99 USD)
- Developer ID Application 인증서
- App-Specific Password (공증용)

**상세 가이드**: [MACOS_CODE_SIGNING.md](./MACOS_CODE_SIGNING.md)

### ⚠️ 대안: 자동 업데이트 비활성화

Apple Developer 계정 없이 사용하려면:

1. **수동 업데이트만 지원**
   - 사용자가 GitHub Releases에서 DMG 파일 다운로드
   - 수동으로 설치

2. **현재 상태 유지**
   - Windows: 자동 업데이트 작동 ✅
   - macOS: 수동 업데이트만 가능 ⚠️

## 적용된 변경사항

### 1. `package.json`
- macOS 코드 서명 설정 추가:
  - `hardenedRuntime: true`
  - `gatekeeperAssess: false`
  - `entitlements` 파일 참조

### 2. `build/entitlements.mac.plist`
- macOS 앱 권한 설정 파일 생성
- JIT, 네트워크, 파일 접근 권한 포함

### 3. `.env.example`
- Apple 계정 환경 변수 예시 추가:
  - `APPLE_ID`
  - `APPLE_APP_SPECIFIC_PASSWORD`
  - `APPLE_TEAM_ID`

### 4. `.github/workflows/release-launcher.yml`
- macOS 빌드 시 Apple 환경 변수 주입

### 5. `.gitignore`
- `!build/*.plist` 추가하여 entitlements 파일 추적

## 다음 단계

### Apple Developer 계정이 있는 경우

1. **인증서 생성**
   - Apple Developer Portal에서 Developer ID Application 인증서 생성
   - 키체인에 설치

2. **App-Specific Password 생성**
   - https://appleid.apple.com에서 생성
   - 안전한 곳에 저장

3. **환경 변수 설정**
   
   **로컬 개발**:
   ```bash
   # .env 파일에 추가
   APPLE_ID=your-apple-id@example.com
   APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
   APPLE_TEAM_ID=YOUR_TEAM_ID
   ```

   **GitHub Actions**:
   - Settings → Secrets and variables → Actions
   - `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` 추가

4. **빌드 및 배포**
   ```bash
   npm run package:mac
   ```

### Apple Developer 계정이 없는 경우

**옵션 1**: 현재 상태 유지
- Windows: 자동 업데이트 ✅
- macOS: 수동 업데이트 (DMG 다운로드)

**옵션 2**: macOS 자동 업데이트 비활성화
```typescript
// src/main/services/hyeni-updater.ts
if (process.platform !== 'darwin') {
  autoUpdater.checkForUpdatesAndNotify();
}
```

## 참고 문서

- [macOS 코드 서명 상세 가이드](./MACOS_CODE_SIGNING.md)
- [GitHub Actions Secrets 설정](./GITHUB_ACTIONS_SECRETS.md)
- [Apple Developer Program](https://developer.apple.com/programs/)
- [electron-builder Code Signing](https://www.electron.build/code-signing)

## FAQ

### Q: Apple Developer 계정 없이 자동 업데이트가 가능한가요?
**A**: 아니요. macOS의 보안 정책상 서명되지 않은 앱은 자동 업데이트가 불가능합니다.

### Q: 개발자 계정 비용은 얼마인가요?
**A**: 연간 $99 USD입니다.

### Q: 서명 없이 배포하면 어떻게 되나요?
**A**: 사용자가 앱을 처음 실행할 때 "확인되지 않은 개발자" 경고가 표시되며, 우클릭 → 열기로 실행해야 합니다. 자동 업데이트는 작동하지 않습니다.

### Q: Windows는 영향을 받나요?
**A**: 아니요. Windows는 별도의 서명 프로세스를 사용하며, 현재 자동 업데이트가 정상 작동합니다.
