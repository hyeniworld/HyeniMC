# 🎉 런처 자동 업데이트 시스템 구현 완료!

## ✅ 완료된 작업

### 1. **패키지 추가**
```json
{
  "dependencies": {
    "electron-log": "^5.0.1",
    "electron-updater": "^6.1.7"
  },
  "build": {
    "publish": {
      "provider": "github",
      "owner": "hyeniworld",
      "repo": "HyeniMC"
    }
  }
}
```

### 2. **Backend (Main Process)**
- ✅ `src/main/auto-updater.ts` - electron-updater 래퍼 및 이벤트 핸들러
- ✅ `src/main/ipc/launcher.ts` - 런처 업데이트 IPC 핸들러
- ✅ `src/main/ipc/handlers.ts` - launcher 핸들러 등록
- ✅ `src/main/main.ts` - 앱 시작 시 auto-updater 초기화 및 3초 후 자동 체크

### 3. **Frontend (Renderer Process)**
- ✅ `src/renderer/hooks/useLauncherUpdate.ts` - 업데이트 상태 관리 훅
- ✅ `src/renderer/components/launcher/LauncherUpdateBanner.tsx` - 상단 전역 배너
- ✅ `src/renderer/components/launcher/LauncherUpdateModal.tsx` - 업데이트 모달 (필수 업데이트용)
- ✅ `src/renderer/App.tsx` - 배너 통합

### 4. **Preload Bridge**
- ✅ `src/preload/preload.ts` - launcher API 추가 및 타입 정의

### 5. **문서**
- ✅ `AUTO_UPDATE_INSTALL.md` - 설치 및 배포 가이드
- ✅ `LAUNCHER_UPDATE_SUMMARY.md` - 요약 문서 (이 파일)

---

## 🚀 다음 단계

### 1. 의존성 설치
```bash
npm install
```

### 2. 빌드 및 테스트
```bash
npm run build
npm run dev
```

### 3. GitHub 설정 (프로덕션 배포용)
1. GitHub Repository 생성/연결
2. Personal Access Token 생성 (`repo`, `write:packages` 권한)
3. 환경 변수 설정:
   ```bash
   # Windows
   $env:GH_TOKEN="your_token"
   
   # macOS/Linux
   export GH_TOKEN="your_token"
   ```

### 4. 프로덕션 빌드
```bash
npm run package:win  # Windows
npm run package:mac  # macOS
```

### 5. GitHub Release 생성
1. 웹사이트에서 새 Release 생성
2. Tag: `v0.1.0`
3. 파일 업로드:
   - `HyeniMC Setup 0.1.0.exe`
   - `latest.yml`
4. Publish

---

## 🎨 UI 미리보기

### 업데이트 알림 배너 (상단 고정)
```
┌──────────────────────────────────────────────────────────┐
│ 🚀 HyeniMC v0.2.0 업데이트             [지금 업데이트] [×] │
│    새로운 기능 및 개선사항                                  │
└──────────────────────────────────────────────────────────┘
```

### 다운로드 진행 중
```
┌──────────────────────────────────────────────────────────┐
│ 🚀 다운로드 중... 67%   ▓▓▓▓▓░░░   2.5 MB/s             │
│    10.2 MB / 15.4 MB                                     │
└──────────────────────────────────────────────────────────┘
```

### 다운로드 완료
```
┌──────────────────────────────────────────────────────────┐
│ 🚀 HyeniMC v0.2.0 준비 완료          [재시작하여 적용]     │
└──────────────────────────────────────────────────────────┘
```

---

## 🔄 업데이트 플로우

```
사용자 런처 시작
  ↓
3초 후 자동으로 GitHub Releases 확인
  ↓
업데이트 있음? → 상단 배너 표시
  ↓
사용자 "지금 업데이트" 클릭
  ↓
백그라운드 다운로드 (진행률 실시간 표시)
  ↓
다운로드 완료 → "재시작하여 적용" 버튼
  ↓
사용자 클릭 → 런처 종료 → 업데이트 설치 → 자동 재시작
  ↓
새 버전으로 실행! 🎉
```

---

## 🌟 주요 기능

### 자동 업데이트 체크
- ✅ 앱 시작 3초 후 자동 체크
- ✅ 이후 4시간마다 백그라운드 체크
- ✅ 수동 체크 가능

### 백그라운드 다운로드
- ✅ 사용 중에도 백그라운드 다운로드
- ✅ 실시간 진행률 표시 (%, 속도, 크기)
- ✅ 다운로드 중에도 런처 사용 가능

### 스마트 알림
- ✅ **선택적 업데이트**: 상단 배너 (닫기 가능)
- ✅ **필수 업데이트**: 모달 (닫기 불가능)
- ✅ 업데이트 내용(Release Notes) 표시

### 원클릭 설치
- ✅ "재시작하여 적용" 버튼 한 번
- ✅ 자동으로 종료 → 설치 → 재시작
- ✅ 사용자 데이터 보존

---

## 🎯 VS 모드 업데이트 비교

| 구분 | 모드 업데이트 | 런처 업데이트 |
|------|-------------|-------------|
| **대상** | HyeniHelper 모드 | HyeniMC 런처 |
| **위치** | 프로필 개요 탭 | 전역 (모든 페이지 상단) |
| **디자인** | 보라색/핑크 배너 | 파란색 배너 |
| **API** | Cloudflare Worker | GitHub Releases |
| **저장소** | R2 (Private) | GitHub (Public) |
| **인증** | Discord 토큰 필요 | 불필요 (Public) |
| **자동 체크** | 30분마다 | 4시간마다 |

---

## 💡 사용자 경험

### 이전 (수동)
1. Discord/웹사이트에서 새 버전 공지 확인
2. 다운로드 링크 클릭
3. 설치 파일 다운로드
4. 기존 런처 종료
5. 설치 실행
6. 런처 재시작

**⏱️ 소요 시간: 3-5분**

### 이후 (자동)
1. 런처 사용 중
2. 배너 알림: "새 버전 있음"
3. "지금 업데이트" 클릭
4. (백그라운드 다운로드)
5. "재시작" 클릭
6. 완료!

**⏱️ 소요 시간: 30초**

---

## 🔧 설정 옵션

### 업데이트 간격 조정
```typescript
// useLauncherUpdate.ts
const interval = setInterval(() => {
  checkForUpdates();
}, 2 * 60 * 60 * 1000); // 2시간마다
```

### 베타 채널 활성화
```typescript
// auto-updater.ts
autoUpdater.channel = 'beta';
```

### 자동 다운로드
```typescript
// auto-updater.ts
autoUpdater.autoDownload = true; // 감지 즉시 다운로드
```

---

## 📊 릴리스 예시

### v0.1.0 → v0.2.0 업데이트

**Release Notes:**
```markdown
## ✨ 새로운 기능
- 모드팩 지원 추가
- 다운로드 속도 2배 향상
- CurseForge API 통합

## 🐛 버그 수정
- 프로필 삭제 시 크래시 수정
- 다크 모드 색상 개선

## ⚡ 성능 개선
- 시작 시간 30% 단축
- 메모리 사용량 20% 감소
```

**사용자가 보는 것:**
```
┌──────────────────────────────────────────────────┐
│ 🚀 HyeniMC v0.2.0 업데이트                        │
│    새로운 기능: 모드팩 지원, 성능 개선             │
│                                                   │
│    ✨ 새로운 기능                                 │
│    • 모드팩 지원 추가                             │
│    • 다운로드 속도 2배 향상                       │
│                                                   │
│    [업데이트하고 재시작]    [나중에]               │
└──────────────────────────────────────────────────┘
```

---

## 🎉 완성!

이제 런처가 **자동으로 업데이트**됩니다!

다음 릴리스 때:
1. 코드 수정
2. `package.json` 버전 증가
3. `npm run package:win`
4. GitHub Release 생성
5. 모든 사용자에게 자동 알림!

---

## 📚 추가 자료

- 상세 가이드: `AUTO_UPDATE_INSTALL.md`
- electron-updater 문서: https://www.electron.build/auto-update
- GitHub Releases: https://docs.github.com/en/repositories/releasing-projects-on-github

---

**구현 완료일**: 2025-10-14  
**작성자**: Cascade AI  
**버전**: 1.0.0
