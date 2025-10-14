# HyeniMC 스크립트

이 디렉토리에는 HyeniMC 개발 및 배포에 필요한 스크립트들이 포함되어 있습니다.

## 📜 스크립트 목록

### 1. release.sh (macOS/Linux)

버전 업데이트 및 릴리즈를 자동화하는 스크립트입니다.

**사용법:**
```bash
./scripts/release.sh [patch|minor|major] [message]
```

**예시:**
```bash
# 버그 수정 릴리즈
./scripts/release.sh patch

# 기능 추가 릴리즈
./scripts/release.sh minor "새로운 테마 시스템"

# 주요 변경 릴리즈
./scripts/release.sh major "UI 전면 개편"
```

### 2. release.ps1 (Windows)

Windows용 릴리즈 스크립트입니다.

**사용법:**
```powershell
.\scripts\release.ps1 [patch|minor|major] [message]
```

**예시:**
```powershell
# 버그 수정 릴리즈
.\scripts\release.ps1 patch

# 기능 추가 릴리즈
.\scripts\release.ps1 minor "새로운 테마 시스템"

# 주요 변경 릴리즈
.\scripts\release.ps1 major "UI 전면 개편"
```

### 3. setup-auth.sh

Microsoft 인증 설정을 위한 스크립트입니다.

**사용법:**
```bash
./scripts/setup-auth.sh
```

## 🔧 스크립트 동작 방식

### release 스크립트

1. **버전 타입 검증**: patch, minor, major 중 하나인지 확인
2. **Git 상태 확인**: 커밋되지 않은 변경사항이 있는지 확인
3. **브랜치 확인**: main/master 브랜치인지 확인
4. **원격 동기화 확인**: 로컬과 원격이 동기화되어 있는지 확인
5. **버전 업데이트**: `package.json`의 버전을 자동으로 업데이트
6. **Git 커밋**: 버전 업데이트를 커밋
7. **태그 생성**: `v{version}` 형식의 Git 태그 생성
8. **푸시**: 커밋과 태그를 원격 저장소에 푸시
9. **GitHub Actions 트리거**: 태그 푸시로 자동 빌드 시작

## 📚 자세한 내용

버전 관리 및 릴리즈에 대한 자세한 내용은 [VERSION_MANAGEMENT.md](../VERSION_MANAGEMENT.md)를 참고하세요.

## ⚠️ 주의사항

- 릴리즈 스크립트는 **main/master 브랜치**에서 실행하는 것을 권장합니다.
- 실행 전 **모든 변경사항을 커밋**해야 합니다.
- 릴리즈 후 **GitHub Actions 빌드**가 완료될 때까지 기다려야 합니다 (~20분).
- 빌드 실패 시 태그를 삭제하고 문제를 해결한 후 다시 시도하세요.

## 🐛 문제 해결

### macOS/Linux에서 "Permission denied" 오류

```bash
chmod +x scripts/release.sh
```

### Windows에서 "스크립트 실행이 비활성화되어 있습니다" 오류

PowerShell을 관리자 권한으로 실행 후:
```powershell
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
```

## 📞 도움말

추가 도움이 필요하면 [VERSION_MANAGEMENT.md](../VERSION_MANAGEMENT.md)의 트러블슈팅 섹션을 참고하세요.
