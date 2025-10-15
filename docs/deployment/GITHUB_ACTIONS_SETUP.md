# GitHub Actions 설정 가이드

HyeniMC의 자동 빌드 및 배포를 위한 GitHub Actions 설정 가이드입니다.

---

## 📋 개요

GitHub Actions는 다음 작업을 자동으로 수행합니다:

1. **코드 체크아웃**
2. **환경 설정** (Node.js, Go)
3. **인증 설정** (GitHub Secrets 사용)
4. **Protobuf 코드 생성**
5. **백엔드 빌드** (Windows, macOS)
6. **프론트엔드 빌드 및 패키징**
7. **GitHub Release 생성**
8. **자동 업데이트 메타데이터 업로드**

---

## 🔐 필수 설정: GitHub Secrets

### 1. Secret 추가하기

릴리즈를 위해서는 GitHub 저장소에 다음 Secret을 추가해야 합니다:

1. **GitHub 저장소로 이동**
2. **Settings** → **Secrets and variables** → **Actions**
3. **New repository secret** 클릭
4. 다음 Secret 추가:

| Name | Value | 설명 |
|------|-------|------|
| `AZURE_CLIENT_ID` | `your-client-id-here` | Azure Portal의 Microsoft OAuth Client ID |
| `HYENIMC_WORKER_URL` | `https://hyenimc-worker.YOUR_ACCOUNT.workers.dev` | HyeniMC Worker URL |

> 💡 **참고**: `GITHUB_TOKEN`은 GitHub Actions에서 자동으로 제공되므로 별도 설정이 필요 없습니다.

> 📝 **상세 가이드**: [GITHUB_ACTIONS_SECRETS.md](./GITHUB_ACTIONS_SECRETS.md) 참조

### 2. Azure Client ID 찾기

1. [Azure Portal](https://portal.azure.com) 접속
2. **Azure Active Directory** → **앱 등록**
3. **HyeniMC** 앱 선택
4. **개요** 페이지에서 **애플리케이션 (클라이언트) ID** 복사

### 3. Secret 확인

Secret이 올바르게 설정되었는지 확인:

- Settings → Secrets and variables → Actions
- `AZURE_CLIENT_ID`가 목록에 표시되어야 함
- `HYENIMC_WORKER_URL`이 목록에 표시되어야 함
- 값은 보안상 표시되지 않음 (정상)

> ⚠️ **중요**: 이 Secret들이 없으면 빌드가 실패합니다!

---

## 🚀 워크플로우 구조

### 파일 위치

```
.github/
└── workflows/
    └── release-launcher.yml
```

### 트리거 조건

```yaml
on:
  push:
    tags:
      - 'v*.*.*'  # 예: v0.1.0, v1.2.3
```

태그를 푸시하면 자동으로 워크플로우가 실행됩니다.

---

## 🏗️ 빌드 프로세스

### Job 1: Windows 빌드 (`release-windows`)

**실행 환경**: `windows-latest`

**단계**:
1. ✅ 코드 체크아웃 (`actions/checkout@v3`)
2. ✅ Node.js 18 설치 (`actions/setup-node@v3`)
3. ✅ Go 1.21 설치 (`actions/setup-go@v4`)
4. ✅ 의존성 설치 (`npm install`)
5. ✅ 인증 설정 파일 생성 (`auth-config.ts`)
   - GitHub Secrets에서 `AZURE_CLIENT_ID` 가져오기
6. ✅ 환경 변수 파일 생성 (`.env`)
   - GitHub Secrets에서 `CURSEFORGE_PROXY_URL` 가져오기
7. ✅ Protobuf 코드 생성 (`npm run proto:gen`)
8. ✅ Go 백엔드 빌드 (`npm run backend:build:win-x64`)
9. ✅ Electron 앱 패키징 (`npm run package:win`)
10. ✅ 아티팩트 업로드 (`actions/upload-artifact@v4`)
   - `HyeniMC-Setup-*.exe`
   - `latest.yml`

### Job 2: macOS 빌드 (`release-macos`)

**실행 환경**: `macos-latest`

**단계**:
1. ✅ 코드 체크아웃
2. ✅ Node.js 18 설치
3. ✅ Go 1.21 설치
4. ✅ 의존성 설치
5. ✅ 인증 설정 파일 생성
6. ✅ 환경 변수 파일 생성 (`.env`)
7. ✅ Protobuf 코드 생성
8. ✅ Go 백엔드 빌드 (`npm run backend:build:mac-universal`)
   - ARM64 + x64 Universal Binary
9. ✅ Electron 앱 패키징 (`npm run package:mac`)
10. ✅ 아티팩트 업로드
   - `HyeniMC-*.dmg`
   - `latest-mac.yml`

### Job 3: Release 생성 (`create-release`)

**의존성**: `release-windows`, `release-macos` 완료 후 실행

**실행 환경**: `ubuntu-latest`

**단계**:
1. ✅ Windows 아티팩트 다운로드 (`actions/download-artifact@v4`)
2. ✅ macOS 아티팩트 다운로드
3. ✅ GitHub Release 생성 (`softprops/action-gh-release@v1`)
   - 모든 빌드 파일 업로드
   - 릴리즈 노트 자동 생성
   - `latest.yml` / `latest-mac.yml` 업로드

---

## ⏱️ 빌드 시간

| 플랫폼 | 예상 시간 |
|--------|-----------|
| Windows | 10-15분 |
| macOS | 15-20분 |
| **총 소요 시간** | **20-25분** |

---

## 🔍 빌드 모니터링

### 1. Actions 페이지 접속

```
https://github.com/YOUR_USERNAME/HyeniMC/actions
```

### 2. 워크플로우 실행 확인

- 최근 실행 목록에서 태그 이름 확인
- 진행 중: 🟡 노란색 아이콘
- 성공: ✅ 초록색 체크
- 실패: ❌ 빨간색 X

### 3. 로그 확인

- 워크플로우 실행 클릭
- 각 Job 클릭하여 상세 로그 확인
- 실패 시 에러 메시지 확인

---

## 🐛 일반적인 빌드 오류

### 오류 1: `auth-config.ts` 파일을 찾을 수 없음

```
Error: Cannot find module './auth-config' or its corresponding type declarations.
```

**원인**: GitHub Secrets에 `AZURE_CLIENT_ID`가 설정되지 않음

**해결**:
1. Settings → Secrets and variables → Actions
2. `AZURE_CLIENT_ID` Secret 추가
3. 값: Azure Portal의 Client ID

### 오류 2: Protobuf 코드 생성 실패

```
Error: package hyenimc/backend/gen/launcher is not in std
```

**원인**: `npm run proto:gen` 단계가 실행되지 않음

**해결**: 워크플로우 파일 확인
- `Install dependencies` 후 `Generate protobuf code` 단계가 있는지 확인

### 오류 3: Actions artifact v3 deprecated

```
This request has been automatically failed because it uses a deprecated version of actions/upload-artifact: v3
```

**원인**: `actions/upload-artifact@v3` 사용

**해결**: 워크플로우에서 v4로 업데이트
```yaml
- uses: actions/upload-artifact@v4  # v3 → v4
```

### 오류 4: Go 모듈 다운로드 실패

```
Error: go: module not found
```

**원인**: Go 의존성 문제

**해결**:
1. `backend/go.mod` 파일 확인
2. 로컬에서 `cd backend && go mod tidy` 실행
3. 변경사항 커밋 및 푸시

---

## 🔄 워크플로우 업데이트

### 워크플로우 파일 수정

```bash
# 1. 워크플로우 파일 편집
vim .github/workflows/release-launcher.yml

# 2. 변경사항 커밋
git add .github/workflows/release-launcher.yml
git commit -m "chore: update GitHub Actions workflow"

# 3. 푸시
git push origin main
```

### 변경사항 테스트

```bash
# 테스트 태그 생성
git tag v0.0.1-test
git push origin v0.0.1-test

# Actions 페이지에서 빌드 확인
# 문제 없으면 태그 삭제
git tag -d v0.0.1-test
git push origin :refs/tags/v0.0.1-test
```

---

## 📊 빌드 결과물

### Windows

- `HyeniMC-Setup-0.1.0.exe` - NSIS 설치 프로그램
- `latest.yml` - 자동 업데이트 메타데이터

### macOS

- `HyeniMC-0.1.0-arm64.dmg` - Apple Silicon
- `HyeniMC-0.1.0-x64.dmg` - Intel Mac
- `HyeniMC-0.1.0-universal.dmg` - Universal Binary
- `latest-mac.yml` - 자동 업데이트 메타데이터

---

## 🔐 보안 고려사항

### 1. Secret 관리

- ✅ GitHub Secrets는 암호화되어 저장됨
- ✅ 워크플로우 로그에 Secret 값이 표시되지 않음 (`***`로 마스킹)
- ✅ `auth-config.ts`는 빌드 시에만 임시로 생성됨
- ✅ 최종 빌드 파일에는 컴파일된 형태로만 포함됨

### 2. 권한 설정

워크플로우는 다음 권한이 필요합니다:

```yaml
permissions:
  contents: write  # Release 생성 및 파일 업로드
```

### 3. 토큰 사용

- `GITHUB_TOKEN`은 자동으로 제공됨
- Release 생성 시 사용됨
- 별도 설정 불필요

---

## 📚 관련 문서

- **[VERSION_MANAGEMENT.md](./VERSION_MANAGEMENT.md)** - 버전 관리 및 릴리즈 가이드
- **[AUTO_UPDATE_INSTALL.md](./AUTO_UPDATE_INSTALL.md)** - 자동 업데이트 시스템
- **[GitHub Actions 공식 문서](https://docs.github.com/en/actions)**
- **[electron-builder 문서](https://www.electron.build/)**

---

## ✅ 체크리스트

릴리즈 전 확인사항:

- [ ] GitHub Secrets에 `AZURE_CLIENT_ID` 설정됨
- [ ] GitHub Secrets에 `HYENIMC_WORKER_URL` 설정됨
- [ ] HyeniMC Worker가 정상 배포되어 있음
- [ ] 워크플로우 파일이 최신 버전 (`v4` 사용)
- [ ] 로컬에서 빌드 테스트 완료
- [ ] `package.json` 버전 업데이트됨
- [ ] 변경사항 모두 커밋됨

---

**작성일**: 2025-10-14  
**버전**: 1.0.0  
**작성자**: HyeniMC Team
