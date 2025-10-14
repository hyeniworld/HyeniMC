# 🚀 런처 자동 업데이트 시스템 설치 가이드

## ✅ 구현 완료 항목

### 1. 패키지 설치
```bash
npm install
```

새로 추가된 패키지:
- `electron-updater@^6.1.7` - 자동 업데이트 기능
- `electron-log@^5.0.1` - 업데이트 로깅

### 2. 생성된 파일

#### Backend (Main Process)
- ✅ `src/main/auto-updater.ts` - electron-updater 래퍼
- ✅ `src/main/ipc/launcher.ts` - IPC 핸들러
- ✅ `src/main/main.ts` - 자동 업데이트 초기화 추가

#### Frontend (Renderer Process)
- ✅ `src/renderer/hooks/useLauncherUpdate.ts` - 업데이트 상태 관리
- ✅ `src/renderer/components/launcher/LauncherUpdateBanner.tsx` - 전역 배너
- ✅ `src/renderer/components/launcher/LauncherUpdateModal.tsx` - 업데이트 모달
- ✅ `src/renderer/App.tsx` - 전역 배너 추가

#### Preload
- ✅ `src/preload/preload.ts` - launcher API 추가

#### Config
- ✅ `package.json` - 의존성 및 publish 설정 추가

---

## 🎯 사용 방법

### 개발 중 테스트

```bash
# 1. 의존성 설치
npm install

# 2. 빌드
npm run build

# 3. 실행
npm run dev
```

**시작 후 3초 뒤** 자동으로 업데이트 확인이 실행됩니다.

---

## 📦 프로덕션 빌드 및 배포

### 1. GitHub Repository 설정

```bash
# 1. GitHub에 리포지토리 생성
# 2. 로컬 연결
git remote add origin https://github.com/hyeniworld/HyeniMC.git
git push -u origin main
```

### 2. GitHub Personal Access Token 생성

1. GitHub → Settings → Developer settings → Personal access tokens
2. Generate new token (classic)
3. 권한 선택:
   - `repo` (전체)
   - `write:packages`
4. 토큰 복사

### 3. 환경 변수 설정

```bash
# Windows (PowerShell)
$env:GH_TOKEN="your_github_token_here"

# macOS/Linux
export GH_TOKEN="your_github_token_here"
```

### 4. 빌드 및 배포

```bash
# Windows
npm run package:win

# macOS
npm run package:mac
```

빌드 완료 후 `release/` 디렉토리에 생성됩니다:
- `HyeniMC Setup 0.1.0.exe` (설치 파일)
- `latest.yml` (업데이트 메타데이터)

### 5. GitHub Release 생성

```bash
# 1. GitHub 웹사이트에서 새 Release 생성
# 2. Tag: v0.1.0
# 3. 파일 업로드:
#    - HyeniMC Setup 0.1.0.exe
#    - latest.yml
# 4. Publish release
```

---

## 🔄 업데이트 시나리오

### 시나리오 1: 일반 업데이트

```
사용자가 런처 시작
  ↓
3초 후 자동으로 업데이트 확인
  ↓
새 버전 발견
  ↓
상단에 파란색 배너 표시
  ┌─────────────────────────────────────┐
  │ 🚀 HyeniMC v0.2.0 업데이트          │
  │ [지금 업데이트]  [×]                 │
  └─────────────────────────────────────┘
  ↓
사용자가 "지금 업데이트" 클릭
  ↓
백그라운드 다운로드 (진행률 표시)
  ┌─────────────────────────────────────┐
  │ 🚀 다운로드 중... 67%                │
  │ ▓▓▓▓▓▓▓░░░░░░   2.5 MB/s           │
  └─────────────────────────────────────┘
  ↓
다운로드 완료
  ┌─────────────────────────────────────┐
  │ 🚀 HyeniMC v0.2.0 준비 완료          │
  │ [재시작하여 적용]                    │
  └─────────────────────────────────────┘
  ↓
사용자가 "재시작" 클릭
  ↓
런처 종료 → 업데이트 설치 → 자동 재시작
  ↓
새 버전으로 실행 완료!
```

### 시나리오 2: 필수 업데이트

```
사용자가 런처 시작
  ↓
필수 업데이트 감지
  ↓
모달 다이얼로그 표시 (닫기 버튼 없음)
  ┌─────────────────────────────┐
  │    ✨ HyeniMC 업데이트       │
  │       v0.1.0 → v0.2.0       │
  │                             │
  │ ⚠️ 이 업데이트는 필수입니다  │
  │                             │
  │ [업데이트하고 재시작]        │
  └─────────────────────────────┘
  ↓
자동 다운로드 및 재시작
```

---

## 🎨 UI 미리보기

### 배너 (일반 업데이트)
```
┌────────────────────────────────────────────────────────────────┐
│ 🚀 HyeniMC v0.2.0 업데이트            [지금 업데이트]  [×]      │
│    새로운 기능 및 개선사항                                        │
└────────────────────────────────────────────────────────────────┘
```

### 다운로드 중
```
┌────────────────────────────────────────────────────────────────┐
│ 🚀 HyeniMC v0.2.0 업데이트   67%   2.5 MB/s   ▓▓▓▓▓░░░░░       │
│    10.2 MB / 15.4 MB                                           │
└────────────────────────────────────────────────────────────────┘
```

### 다운로드 완료
```
┌────────────────────────────────────────────────────────────────┐
│ 🚀 HyeniMC v0.2.0 준비 완료               [재시작하여 적용]      │
│    업데이트가 다운로드되었습니다                                  │
└────────────────────────────────────────────────────────────────┘
```

---

## 🧪 테스트 방법

### 로컬 테스트 (dev-app-update.yml)

1. `dev-app-update.yml` 생성:
```yaml
version: 0.2.0
files:
  - url: HyeniMC Setup 0.2.0.exe
    sha512: ...
path: HyeniMC Setup 0.2.0.exe
sha512: ...
releaseDate: '2025-10-14T00:00:00.000Z'
```

2. 테스트 서버 실행:
```bash
# release/ 디렉토리에서
python -m http.server 8080
```

3. `auto-updater.ts` 수정:
```typescript
autoUpdater.setFeedURL({
  provider: 'generic',
  url: 'http://localhost:8080'
});
```

4. 런처 실행 → 업데이트 감지 확인

---

## 🛠️ 문제 해결

### Q: 업데이트 확인이 안 됨
**A:** 
1. GitHub Release가 `Published` 상태인지 확인
2. `latest.yml` 파일이 올바르게 업로드되었는지 확인
3. 콘솔에서 에러 로그 확인

### Q: 다운로드가 시작되지 않음
**A:**
1. GitHub token 권한 확인
2. Release 파일이 public인지 확인
3. 네트워크 연결 확인

### Q: 설치 후 자동 시작 안 됨
**A:**
`autoUpdater.quitAndInstall(false, true)` 
- 첫 번째 `false`: 강제 종료 안 함
- 두 번째 `true`: 설치 후 자동 시작

---

## 📚 추가 설정 (선택사항)

### 베타/알파 채널

```typescript
// auto-updater.ts
autoUpdater.channel = 'beta'; // 베타 업데이트 받기
```

### 업데이트 간격 조정

```typescript
// useLauncherUpdate.ts
const interval = setInterval(() => {
  checkForUpdates();
}, 2 * 60 * 60 * 1000); // 2시간마다
```

### 자동 다운로드 활성화

```typescript
// auto-updater.ts
autoUpdater.autoDownload = true; // 자동으로 다운로드
```

---

## 🎉 완료!

이제 런처가 자동으로 업데이트됩니다!

**다음 릴리스 시:**
1. 코드 수정
2. `package.json` 버전 증가 (`0.1.0` → `0.2.0`)
3. `npm run package:win`
4. GitHub Release 생성 및 파일 업로드
5. 사용자가 자동으로 업데이트 알림 받음!

---

**작성일**: 2025-10-14  
**작성자**: Cascade AI
