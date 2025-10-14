# HyeniMC 버전 관리 가이드

## 📋 목차

1. [버전 체계](#버전-체계)
2. [릴리즈 프로세스](#릴리즈-프로세스)
3. [자동 업데이트 시스템](#자동-업데이트-시스템)
4. [버전 업데이트 방법](#버전-업데이트-방법)
5. [트러블슈팅](#트러블슈팅)

---

## 🔢 버전 체계

HyeniMC는 **Semantic Versioning (SemVer)** 을 따릅니다.

```
MAJOR.MINOR.PATCH
  │     │     │
  │     │     └─ 버그 수정, 작은 개선
  │     └─────── 새로운 기능 추가 (하위 호환)
  └───────────── 주요 변경 (하위 호환 X)
```

### 예시

- `0.1.0` → `0.1.1`: 버그 수정
- `0.1.0` → `0.2.0`: 새로운 기능 추가
- `0.1.0` → `1.0.0`: 주요 변경 (API 변경 등)

### 버전 관리 위치

**단일 소스**: `package.json`의 `version` 필드

```json
{
  "name": "hyenimc",
  "version": "0.1.0",
  ...
}
```

이 버전이 다음 항목에 자동으로 반영됩니다:
- ✅ 런처 UI (설정 페이지)
- ✅ 빌드 파일명 (`HyeniMC-Setup-0.1.0.exe`)
- ✅ GitHub Release 태그 (`v0.1.0`)
- ✅ 자동 업데이트 메타데이터 (`latest.yml`)

---

## 🚀 릴리즈 프로세스

### 전체 흐름

```
1. 코드 변경 및 테스트
   ↓
2. 버전 업데이트 (package.json)
   ↓
3. Git 태그 생성 및 푸시
   ↓
4. GitHub Actions 자동 실행
   ↓
5. 빌드 및 패키징
   ↓
6. GitHub Release 생성
   ↓
7. 사용자 자동 업데이트 수신
```

### 자동화된 릴리즈

**릴리즈 스크립트 사용 (권장)**

#### macOS/Linux

```bash
# 실행 권한 부여 (최초 1회)
chmod +x scripts/release.sh

# 버그 수정 릴리즈
./scripts/release.sh patch

# 기능 추가 릴리즈
./scripts/release.sh minor "새로운 프로필 관리 기능"

# 주요 변경 릴리즈
./scripts/release.sh major "UI 전면 개편"
```

#### Windows (PowerShell)

```powershell
# 버그 수정 릴리즈
.\scripts\release.ps1 patch

# 기능 추가 릴리즈
.\scripts\release.ps1 minor "새로운 프로필 관리 기능"

# 주요 변경 릴리즈
.\scripts\release.ps1 major "UI 전면 개편"
```

### 수동 릴리즈

```bash
# 1. 버전 업데이트
npm version patch   # 또는 minor, major

# 2. 태그 푸시
git push origin main --tags

# 3. GitHub Actions 자동 실행 확인
# https://github.com/devbug/HyeniMC/actions
```

---

## 🔄 자동 업데이트 시스템

### 시스템 구조

```
┌─────────────────────────────────────────────────────────┐
│                    사용자 런처                           │
│  - 4시간마다 자동 체크                                   │
│  - 시작 시 체크                                          │
└────────────────┬────────────────────────────────────────┘
                 │
                 │ 1. 업데이트 확인
                 ↓
┌─────────────────────────────────────────────────────────┐
│              GitHub Releases API                         │
│  https://api.github.com/repos/devbug/HyeniMC/releases   │
└────────────────┬────────────────────────────────────────┘
                 │
                 │ 2. latest.yml 다운로드
                 ↓
┌─────────────────────────────────────────────────────────┐
│              electron-updater                            │
│  - 버전 비교                                             │
│  - 다운로드 관리                                         │
│  - 설치 및 재시작                                        │
└─────────────────────────────────────────────────────────┘
```

### 업데이트 메타데이터 (latest.yml)

GitHub Actions가 자동으로 생성하는 파일:

```yaml
version: 0.2.0
releaseDate: '2025-10-14T01:46:00.000Z'
files:
  - url: HyeniMC-Setup-0.2.0.exe
    sha512: abc123...
    size: 123456789
path: HyeniMC-Setup-0.2.0.exe
sha512: abc123...
releaseNotes: |
  ## 새로운 기능
  - 프로필 관리 개선
  - 모드 자동 업데이트
```

### 사용자 경험

1. **업데이트 알림**
   - 런처 상단에 배너 표시
   - "업데이트 다운로드" 버튼

2. **다운로드**
   - 진행률 표시
   - 백그라운드 다운로드 가능

3. **설치**
   - "지금 재시작" 또는 "나중에"
   - 종료 시 자동 설치

---

## 📝 버전 업데이트 방법

### 시나리오별 가이드

#### 1. 버그 수정 (Patch)

**예시**: 프로필 삭제 버그 수정

```bash
# 1. 버그 수정 코드 작성 및 커밋
git add .
git commit -m "fix: 프로필 삭제 시 크래시 수정"

# 2. 릴리즈
./scripts/release.sh patch "프로필 삭제 버그 수정"

# 결과: 0.1.0 → 0.1.1
```

#### 2. 기능 추가 (Minor)

**예시**: 새로운 테마 시스템 추가

```bash
# 1. 기능 개발 및 테스트
git add .
git commit -m "feat: 다크/라이트 테마 시스템 추가"

# 2. 릴리즈
./scripts/release.sh minor "테마 시스템 추가"

# 결과: 0.1.0 → 0.2.0
```

#### 3. 주요 변경 (Major)

**예시**: 새로운 인증 시스템으로 전환

```bash
# 1. 주요 변경 개발 및 테스트
git add .
git commit -m "feat!: Microsoft 인증 시스템으로 전환"

# 2. 릴리즈
./scripts/release.sh major "인증 시스템 개편"

# 결과: 0.9.0 → 1.0.0
```

### 릴리즈 체크리스트

릴리즈 전 확인사항:

- [ ] 모든 변경사항이 커밋됨
- [ ] 로컬 테스트 완료
- [ ] CHANGELOG 업데이트 (선택)
- [ ] 주요 변경사항 문서화
- [ ] 메인 브랜치에서 실행
- [ ] 원격 저장소와 동기화됨

---

## 🔧 GitHub Actions 워크플로우

### 트리거

```yaml
on:
  push:
    tags:
      - 'v*.*.*'  # v0.1.0, v1.2.3 등
```

### 빌드 프로세스

1. **Windows 빌드**
   - Go 백엔드 빌드 (Windows x64)
   - Electron 앱 패키징
   - `.exe` 파일 생성

2. **macOS 빌드**
   - Go 백엔드 빌드 (Universal Binary)
   - Electron 앱 패키징
   - `.dmg` 파일 생성

3. **Release 생성**
   - 모든 빌드 아티팩트 수집
   - GitHub Release 생성
   - `latest.yml` 업로드

### 빌드 시간

- Windows: ~10분
- macOS: ~15분
- 총 소요 시간: ~20분

---

## 🎯 베스트 프랙티스

### 1. 버전 업데이트 주기

- **Patch**: 주 1-2회 (긴급 버그 수정)
- **Minor**: 월 1-2회 (새 기능)
- **Major**: 분기 1회 또는 필요 시

### 2. 릴리즈 노트 작성

자동 생성되는 릴리즈 노트를 보완:

```markdown
## v0.2.0 - 2025-10-14

### ✨ 새로운 기능
- 다크/라이트 테마 시스템
- 프로필 백업/복원 기능

### 🐛 버그 수정
- 프로필 삭제 시 크래시 수정
- 모드 다운로드 진행률 표시 오류 수정

### 🔧 개선사항
- 시작 속도 30% 향상
- 메모리 사용량 감소

### ⚠️ 주의사항
- 이전 버전의 설정 파일이 자동으로 마이그레이션됩니다
```

### 3. 테스트 전략

릴리즈 전 필수 테스트:

```bash
# 1. 빌드 테스트
npm run build

# 2. 로컬 패키징 테스트
npm run package:mac  # 또는 package:win

# 3. 생성된 앱 실행 테스트
open release/mac/HyeniMC.app
```

### 4. 롤백 전략

문제 발생 시:

```bash
# 1. 태그 삭제 (로컬)
git tag -d v0.2.0

# 2. 태그 삭제 (원격)
git push origin :refs/tags/v0.2.0

# 3. GitHub Release 삭제 (수동)
# https://github.com/devbug/HyeniMC/releases

# 4. 이전 버전으로 복구
git reset --hard v0.1.0
```

---

## 🐛 트러블슈팅

### 문제 1: 태그가 이미 존재함

```
fatal: tag 'v0.1.0' already exists
```

**해결**:
```bash
# 기존 태그 삭제
git tag -d v0.1.0
git push origin :refs/tags/v0.1.0

# 다시 릴리즈
./scripts/release.sh patch
```

### 문제 2: GitHub Actions 빌드 실패

**확인사항**:
1. Go 버전 호환성 (1.21+)
2. Node.js 버전 (18+)
3. 백엔드 빌드 스크립트 정상 작동
4. GitHub Secrets 설정 확인

**로그 확인**:
```
https://github.com/devbug/HyeniMC/actions
```

### 문제 3: 자동 업데이트가 작동하지 않음

**체크리스트**:
- [ ] `package.json`의 `publish` 설정 확인
- [ ] GitHub Release가 정상 생성됨
- [ ] `latest.yml` 파일이 업로드됨
- [ ] 런처가 인터넷에 연결됨
- [ ] 개발 모드가 아님 (production 빌드)

**수동 확인**:
```bash
# latest.yml 다운로드 테스트
curl -L https://github.com/devbug/HyeniMC/releases/latest/download/latest.yml
```

### 문제 4: 버전이 업데이트되지 않음

**원인**: `package.json` 외 다른 곳에 하드코딩된 버전

**확인**:
```bash
# 하드코딩된 버전 검색
grep -r "0.1.0" src/
```

**해결**: 모든 버전 참조를 `package.json`에서 가져오도록 수정

---

## 📚 참고 자료

### 공식 문서
- [Semantic Versioning](https://semver.org/)
- [electron-updater](https://www.electron.build/auto-update)
- [GitHub Actions](https://docs.github.com/en/actions)

### 관련 파일
- `package.json` - 버전 정의
- `.github/workflows/release-launcher.yml` - 빌드 워크플로우
- `src/main/auto-updater.ts` - 자동 업데이트 로직
- `src/renderer/hooks/useLauncherUpdate.ts` - UI 업데이트 훅

---

## 🎓 요약

### 버전 올리기 (간단 버전)

```bash
# macOS/Linux
./scripts/release.sh patch

# Windows
.\scripts\release.ps1 patch
```

### 전체 프로세스

1. **개발 및 테스트**
2. **릴리즈 스크립트 실행**
3. **GitHub Actions 빌드 대기 (~20분)**
4. **사용자 자동 업데이트 수신**

### 핵심 포인트

- ✅ `package.json` 버전만 관리하면 됨
- ✅ 릴리즈 스크립트가 모든 과정 자동화
- ✅ GitHub Actions가 빌드 및 배포 담당
- ✅ electron-updater가 자동 업데이트 처리
- ✅ 사용자는 아무것도 하지 않아도 최신 버전 수신

---

**작성일**: 2025-10-14  
**버전**: 1.0.0  
**작성자**: HyeniMC Team
