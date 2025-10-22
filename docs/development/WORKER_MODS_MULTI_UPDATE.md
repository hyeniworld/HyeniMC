# Worker Mods 다중 모드 업데이트 시스템

## 📋 개요

Worker API v2를 사용하여 여러 모드를 동시에 확인하고 업데이트할 수 있는 시스템입니다.

### 주요 기능

- **Registry 기반**: Worker API에서 모든 모드 목록을 가져옴
- **다중 모드 지원**: 한 번에 여러 모드 업데이트 확인 및 설치
- **자동 업데이트**: 이미 설치된 모드는 자동으로 업데이트
- **카테고리 구분**: 필수/선택 모드 구분
- **일괄 설치**: 선택한 모드들을 한 번에 설치

## 🏗️ 아키텍처

### Backend (Main Process)

```
WorkerModRegistry
├── fetchModRegistry()          # Registry API 호출
├── getInstalledMods()          # 설치된 모드 확인
├── checkAllModUpdates()        # 모든 모드 업데이트 확인
├── checkModUpdate()            # 개별 모드 업데이트 확인
└── installMultipleMods()       # 여러 모드 동시 설치
```

### Frontend (Renderer Process)

```
useWorkerModUpdates Hook
├── checkForUpdates()           # 업데이트 확인
├── installSelected()           # 선택한 모드 설치
└── State Management
    ├── updates[]               # 업데이트 목록
    ├── isInstalling            # 설치 진행 중
    ├── installProgress         # 설치 진행률
    └── Computed Values
        ├── hasUpdates
        ├── installedUpdates    # 기존 모드 업데이트
        ├── newRequiredMods     # 신규 필수 모드
        └── newOptionalMods     # 신규 선택 모드
```

## 🔄 업데이트 로직

### 1. Registry 가져오기

```typescript
GET /api/v2/mods

Response:
{
  "version": "2.0",
  "mods": [
    {
      "id": "hyenihelper",
      "name": "HyeniHelper",
      "latestVersion": "1.0.2",
      "category": "required" | "optional",
      ...
    }
  ]
}
```

### 2. 업데이트 확인 규칙

```typescript
const hasAuthorizedServer = serverAddress && isAuthorizedServer(serverAddress);

for (const mod of registry.mods) {
  const isInstalled = installedMods.has(mod.id);
  
  if (isInstalled) {
    // ✅ Already installed → always check (regardless of server)
    checkModUpdate(mod.id);
  } else if (hasAuthorizedServer && mod.category === 'required') {
    // ✅ New required mod + authorized server → check
    checkModUpdate(mod.id);
  } else {
    // ❌ Skip: either no authorized server, or optional mod
    continue;
  }
}
```

### 3. 자동 업데이트 정책

- **이미 설치된 모드**: 서버 주소 상관없이 **항상** 업데이트 확인 및 자동 업데이트
- **신규 필수 모드**: 인증된 서버 주소가 있을 때만 설치 권장 (UI에 표시)
- **신규 선택 모드**: 표시하지 않음 (사용자가 명시적으로 설치해야 함)

## 🎨 UI 구조

### WorkerModUpdatePanel

```tsx
┌─────────────────────────────────────────────────────────────┐
│  ✨ 3개의 모드 업데이트 사용 가능                              │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ 🔄 설치된 모드 업데이트 (2개)                            ││
│  │   • 자동으로 업데이트됩니다                               ││
│  │                                                          ││
│  │ ☑ HyeniHelper                1.0.1 → 1.0.2             ││
│  │ ☑ HyeniCore                  0.9.5 → 1.0.0             ││
│  ├─────────────────────────────────────────────────────────┤│
│  │ 🔴 필수 모드 (1개)                                       ││
│  │   • 서버 접속에 필요합니다                               ││
│  │                                                          ││
│  │ ☐ HyeniUtils                 신규 설치                  ││
│  └─────────────────────────────────────────────────────────┘│
│                                                              │
│  [필수만] [모두 선택] [나중에]        [업데이트 (2개)]       │
└─────────────────────────────────────────────────────────────┘
```

## 🔧 환경 설정

### .env 파일 (빌드 타임)

```bash
# Worker API URL
HYENIMC_WORKER_URL=https://your-worker.workers.dev

# 인증된 서버 도메인
AUTHORIZED_SERVER_DOMAINS=*.hyeniday.devbug.ing
```

### 사용자 설정 파일 (런타임)

**인증 토큰**: `config/hyenihelper-config.json`

```json
{
  "token": "user_specific_token_here",
  "enabled": true,
  "timeoutSeconds": 10,
  "serverStatusPort": 4444,
  "authPort": 35565,
  "serverStatusInterval": 180
}
```

- **위치**: 각 프로필의 `config/hyenihelper-config.json`
- **설정 방법**: Discord `/인증` 명령어로 자동 생성
- **사용자별 다른 값**: 각 사용자가 개별적으로 인증

## 📡 API 엔드포인트

### Registry API

```
GET /api/v2/mods
```

모든 모드 목록 반환

### Latest API

```
GET /api/v2/mods/{modId}/latest
```

특정 모드의 최신 버전 정보

### Download API

```
GET /download/v2/mods/{path}?token={token}
```

모드 파일 다운로드 (인증 필요)

## 🔍 트러블슈팅

### 1. 인증 토큰 오류

```
Error: 토큰이 설정되지 않았습니다
Error: 인증 설정 파일이 없습니다
```

**해결:**
1. Discord `/인증` 명령어 실행
2. `hyenimc://` URL 클릭하여 런처에 인증
3. 프로필의 `config/hyenihelper-config.json` 파일 생성 확인

### 2. 업데이트가 표시되지 않음

**확인 사항:**
- `profile.serverAddress`가 설정되어 있는가?
- 서버 주소가 `AUTHORIZED_SERVER_DOMAINS`에 포함되는가?
- Worker API가 정상 작동하는가?

### 3. 모드 다운로드 실패

```
Download failed: 401 Unauthorized
```

**해결:**
- 토큰이 만료되었을 수 있음
- Discord `/인증` 명령어로 재인증
- `config/hyenihelper-config.json` 파일 자동 업데이트 확인

### 4. name이 null인 모드

Worker API에서 `name: null`로 반환되는 경우:
- 자동으로 `modId`를 name으로 사용
- 크래시 방지 처리 완료

## 🚀 배포 체크리스트

1. ✅ Worker API 배포 및 테스트
2. ✅ Registry에 모든 모드 등록
3. ✅ `.env` 파일에 `HYENIMC_WORKER_URL` 설정
4. ✅ `npm run generate-config` 실행
5. ✅ 빌드 및 테스트
6. ✅ 사용자에게 Discord `/인증` 안내

## 📊 성능

- **동시 업데이트 확인**: 모든 모드를 병렬로 확인
- **순차 설치**: 모드는 순차적으로 설치 (안정성 우선)
- **SHA256 검증**: 다운로드된 파일의 무결성 확인
- **자동 재시도**: 실패 시 자동 재시도 없음 (사용자가 재시도)

## 🔄 기존 시스템과의 호환성

### HyeniUpdateNotification (Legacy)

기존 단일 모드 시스템은 유지:
- Worker Mods 업데이트가 없을 때만 표시
- 하위 호환성 보장

### 마이그레이션 전략

1. **Phase 1**: Worker Mods 시스템 추가 (현재)
2. **Phase 2**: 두 시스템 병행 운영
3. **Phase 3**: HyeniUpdateNotification 제거 (추후)

## 📝 개발자 노트

### 파일별 설명

- `worker-mod-registry.ts`: Backend 로직
- `useWorkerModUpdates.ts`: Frontend Hook
- `WorkerModUpdatePanel.tsx`: UI 컴포넌트
- `ModUpdateItem.tsx`: 개별 모드 아이템

### 확장 가능성

- [ ] 의존성 자동 해결
- [ ] 롤백 기능
- [ ] 업데이트 스케줄링
- [ ] 백그라운드 다운로드
