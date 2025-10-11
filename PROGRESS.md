# 작업 진행 상황 (2025-01-09 14:40)

## ✅ 완료된 작업

### 1. Backend (Go) 구현
- ✅ 프로젝트 구조 생성 (`internal/domain`, `internal/repo`, `internal/services`, `internal/grpc`, `internal/http`)
- ✅ Profile 도메인 모델 정의
- ✅ ProfileRepository 구현 (JSON 파일 기반)
- ✅ ProfileService 비즈니스 로직 구현
- ✅ HTTP API 서버 구현 (임시, gRPC 전환 예정)
- ✅ 의존성 관리 (`go.mod`)
- ✅ 빌드 스크립트 추가
- ✅ 빌드 테스트 완료 (`backend/bin/hyenimc-backend`)

**주요 기능:**
- 프로필 생성, 조회, 목록, 수정, 삭제 API
- 데이터 저장 위치: `~/.hyenimc/profiles/`
- CORS 지원 (로컬 개발용)
- 동적 포트 할당 (127.0.0.1:0)

### 2. Electron Main 프로세스 구현
- ✅ 메인 엔트리 포인트 (`src/main/main.ts`)
- ✅ Backend 프로세스 관리자 (`src/main/backend/manager.ts`)
  - 백엔드 바이너리 자동 시작
  - 플랫폼별 바이너리 경로 처리
  - 프로세스 라이프사이클 관리
- ✅ IPC 핸들러 시스템 (`src/main/ipc/`)
  - Profile 핸들러 구현
  - Axios 기반 HTTP 클라이언트
- ✅ TypeScript 빌드 설정 (`tsconfig.main.json`)
- ✅ 빌드 테스트 완료

### 3. Preload 스크립트 구현
- ✅ Context Bridge 설정
- ✅ Profile API 노출
- ✅ Event 리스너 시스템
- ✅ TypeScript 타입 정의

### 4. React UI 구현
- ✅ 앱 구조 (`src/renderer/App.tsx`)
- ✅ 메인 엔트리 포인트 (`src/renderer/main.tsx`)
- ✅ Tailwind CSS 설정 및 스타일
- ✅ ProfileList 컴포넌트
  - 프로필 목록 표시
  - 빈 상태 처리
  - 로딩 및 에러 처리
- ✅ CreateProfileModal 컴포넌트
  - 폼 입력 처리
  - 유효성 검사
  - 에러 메시지 표시
- ✅ HTML 엔트리 포인트 (`index.html`)

### 5. 공유 타입 및 상수
- ✅ 타입 정의 (`src/shared/types/`)
  - Profile, Mod, ModSource, LoaderType 등
- ✅ IPC 채널 및 이벤트 상수 정의

### 6. 문서화
- ✅ DEVELOPMENT.md - 개발 가이드
- ✅ README.md 업데이트
- ✅ PROGRESS.md - 현재 문서
- ✅ 기존 문서 유지 (DESIGN.md, ARCHITECTURE.md, IMPLEMENTATION_GUIDE.md)

## 📊 프로젝트 통계

```
Backend (Go):
- 6개 파일 생성
- 4개 패키지 (domain, repo, services, grpc, http)
- ~600 줄 코드

Frontend (TypeScript/React):
- 11개 파일 생성
- 프로필 관리 완전 구현
- ~800 줄 코드

문서:
- 1개 신규 문서 (DEVELOPMENT.md)
- 2개 업데이트 (README.md, PROGRESS.md)
```

## 🎯 현재 동작하는 기능

### 백엔드 API
```bash
# 프로필 생성
POST http://localhost:PORT/api/profiles
Content-Type: application/json
{
  "name": "테스트 프로필",
  "gameVersion": "1.20.1",
  "loaderType": "vanilla"
}

# 프로필 목록
GET http://localhost:PORT/api/profiles

# 프로필 조회
GET http://localhost:PORT/api/profiles/{id}

# 프로필 수정
PATCH http://localhost:PORT/api/profiles/{id}

# 프로필 삭제
DELETE http://localhost:PORT/api/profiles/{id}

# 헬스 체크
GET http://localhost:PORT/health
```

### UI 기능
- 프로필 목록 표시
- 새 프로필 생성 모달
- 프로필 삭제
- 빈 상태 메시지
- 로딩 및 에러 처리

## 🚀 실행 방법

### 1. 백엔드 빌드 (최초 1회)
```bash
npm run backend:build:mac-arm64
```

### 2. 개발 서버 실행
```bash
npm run dev
```

이제 다음이 실행됩니다:
1. Vite 개발 서버 (포트 5173)
2. Go 백엔드 서버 (동적 포트)
3. Electron 앱

### 3. 프로필 생성 테스트
1. "새 프로필" 버튼 클릭
2. 프로필 정보 입력
3. "프로필 만들기" 클릭
4. 프로필 카드에서 확인

### 7. 모드 로더 지원 (NEW!)
- ✅ **Fabric 로더 서비스** (`src/main/services/fabric-loader.ts`)
  - Fabric Meta API 연동
  - 로더 버전 목록 가져오기
  - 프로필 및 라이브러리 다운로드
  - 자동 설치 시스템
- ✅ **NeoForge 로더 서비스** (`src/main/services/neoforge-loader.ts`)
  - NeoForge Maven API 연동
  - 버전 호환성 확인
  - 프로필 생성 및 라이브러리 다운로드
- ✅ **로더 매니저** (`src/main/services/loader-manager.ts`)
  - Fabric, NeoForge 통합 관리
  - Forge deprecation 처리
  - 권장 버전 자동 선택
- ✅ **IPC 핸들러** (`src/main/ipc/loader.ts`)
  - 로더 버전 조회
  - 설치 진행률 스트리밍
  - 설치 여부 확인
- ✅ **UI 통합**
  - 프로필 생성 시 로더 버전 선택
  - Forge deprecation 경고
  - 실시간 버전 로딩
- ✅ **게임 실행 통합** (`src/main/ipc/profile.ts`)
  - 실행 전 자동 로더 설치
  - 권장 버전 자동 선택
  - 진행률 표시

### 8. 모드 관리 API (NEW!)
- ✅ **Modrinth API 클라이언트** (`src/main/services/modrinth-api.ts`)
  - 모드 검색 (필터링 지원)
  - 모드 상세 정보
  - 버전 목록 및 다운로드
  - 의존성 정보
  - 업데이트 확인
  - 카테고리 목록

## 🎯 최근 업데이트 (2025-10-10)

### 설계 문서 개선
- ✅ **모드팩 로컬 파일 설치 기능 설계 추가**
  - Modrinth 모드팩 (.mrpack) 형식 지원
  - CurseForge 모드팩 (.zip) 형식 지원
  - MultiMC/Prism 인스턴스 임포트 지원
  - ATLauncher 인스턴스 임포트 지원
  - 파일 검증 및 메타데이터 추출 로직 설계
  - 새로운 IPC API 정의:
    - `modpack:validate-file` - 모드팩 파일 검증
    - `modpack:extract-metadata` - 메타데이터 추출
    - `modpack:import-file` - 로컬 파일로 설치
    - `modpack:select-file` - 파일 다이얼로그 열기
  - UI 설계에 "파일 선택" 방식 추가

### 모드팩 로컬 파일 설치 구현 완료 ✅
- ✅ **ModpackManager 확장** (src/main/services/modpack-manager.ts)
  - `validateModpackFile()` - 파일 유효성 검증 및 형식 감지
  - `detectModpackFormat()` - 4가지 형식 자동 감지 (modrinth/curseforge/multimc/prism/atlauncher)
  - `extractModpackMetadata()` - 메타데이터 추출 (이름, 버전, 게임 버전, 로더 등)
  - `importModpackFromFile()` - 로컬 파일에서 모드팩 설치
  - 형식별 설치 메서드:
    - `installModrinthPack()` - Modrinth 모드팩 (.mrpack) 설치
    - `installCurseForgePack()` - CurseForge overrides 적용
    - `installMultiMCPack()` - MultiMC/Prism 인스턴스 복사
    - `installATLauncherPack()` - ATLauncher 인스턴스 복사
  - 형식별 메타데이터 추출:
    - `extractModrinthMetadata()` - modrinth.index.json 파싱
    - `extractCurseForgeMetadata()` - manifest.json 파싱
    - `extractMultiMCMetadata()` - instance.cfg/mmc-pack.json 파싱
    - `extractATLauncherMetadata()` - instance.json 파싱

- ✅ **IPC 핸들러 추가** (src/main/ipc/modpack.ts)
  - `modpack:validate-file` - 파일 검증
  - `modpack:extract-metadata` - 메타데이터 추출
  - `modpack:import-file` - 로컬 파일 임포트
  - `modpack:select-file` - 파일 선택 다이얼로그
  - `modpack:import-progress` 이벤트 스트리밍

- ✅ **IPC 상수 추가** (src/shared/constants/ipc.ts)
  - `MODPACK_VALIDATE_FILE` 채널
  - `MODPACK_EXTRACT_METADATA` 채널
  - `MODPACK_SELECT_FILE` 채널
  - `MODPACK_IMPORT_PROGRESS` 이벤트

- ✅ **Preload API 추가** (src/preload/preload.ts)
  - `window.electronAPI.modpack.validateFile()` 노출
  - `window.electronAPI.modpack.extractMetadata()` 노출
  - `window.electronAPI.modpack.importFile()` 노출
  - `window.electronAPI.modpack.selectFile()` 노출
  - TypeScript 타입 정의 완료

## 📋 다음 작업 (우선순위순)

### Phase 1: 모드팩 로컬 파일 설치 ✅ 완료!
- ✅ **백엔드 구현 완료** (ModpackManager + IPC)
- ✅ **UI 구현 완료** (ImportModpackTab + CreateProfileModal 통합)
  - ✅ 프로필 생성 모달에 "파일" 탭 추가 (3개 탭: 커스텀/온라인/파일)
  - ✅ 파일 선택 버튼 및 드래그&드롭 지원
  - ✅ 메타데이터 미리보기 카드 (이름, 버전, 게임 버전, 로더, 모드 수, 파일 크기)
  - ✅ 프로필 이름 입력 (기본값: 모드팩 이름)
  - ✅ 실시간 진행률 표시 (validating → extracting → installing_mods → complete)
  - ✅ 에러 처리 및 사용자 안내
  - ✅ 프로필 자동 생성 후 모드팩 설치

### Phase 1.5: 프로필 설정 페이지 완성 ✅ 완료!
- ✅ **프로필 아이콘 선택** (15개 이모지 프리셋)
- ✅ **메모리 설정 개선** (src/renderer/components/profiles/ProfileSettingsTab.tsx)
  - ✅ 슬라이더 UI (256MB ~ 8GB)
  - ✅ 시스템 메모리 정보 표시
  - ✅ 메모리 할당 시각화 (그래디언트 바)
  - ✅ 실시간 MB/GB 변환 표시
- ✅ **Java 설정 개선**
  - ✅ 모든 감지된 Java 설치 목록 표시
  - ✅ Java 버전, 아키텍처 (x64/arm64 정확히 감지), Vendor 정보
  - ✅ 선택 가능한 카드 UI
  - ✅ "재감지" 버튼
- ✅ **JVM 인자 편집기**
  - ✅ Textarea 입력 (GC 옵션 등)
  - ✅ 사용 예시 placeholder
- ✅ **창 설정**
  - ✅ 전체화면 토글
  - ✅ 해상도 프리셋 (5가지: 480p ~ 4K)
  - ✅ 커스텀 해상도 입력 (너비/높이)
  - ✅ **실제 게임 실행 시 해상도/전체화면 적용** ⭐
- ✅ **게임 디렉토리 변경**
  - ✅ 경로 입력 (읽기 전용)
  - ✅ "변경" 버튼 (디렉토리 선택)
- ✅ **설정 저장 버튼**
  - ✅ Sticky bottom 배치
  - ✅ 로딩 상태 표시

### 버그 수정 및 개선 ✅
- ✅ **게임 실행 버튼 연타 방지**
  - ProfileList: 시작 중 상태 추가
  - ProfileDetailPage: 시작 중 상태 추가
  - 중복 실행 완전 차단
- ✅ **Java 아키텍처 정확한 감지**
  - 디렉토리 이름 분석 (_x64, _arm64)
  - `file` 명령어로 바이너리 분석
  - Rosetta 환경에서도 정확한 감지

### Phase 2: 모드 관리 UI 개선
1. **모드 브라우저 페이지**
   - 모드 검색 UI
   - 필터 (카테고리, 버전, 로더)
   - 검색 결과 카드 리스트
   - 페이지네이션

2. **모드 상세 페이지**
   - 모드 정보 표시
   - 버전 목록
   - 의존성 표시
   - 설치/제거 버튼

3. **프로필별 모드 관리**
   - 설치된 모드 목록
   - 모드 활성화/비활성화
   - 모드 업데이트 확인
   - 의존성 자동 해결

### Phase 3: 온라인 모드팩 지원 강화
1. **Modrinth 모드팩**
   - 모드팩 검색 UI 개선
   - 모드팩 상세 페이지
   - 버전 선택 UI

2. **CurseForge 모드팩**
   - API 키 설정 UI
   - 검색 및 설치

### Phase 4: 고급 기능
1. **설정 페이지**
   - 전역 Java 설정
   - 메모리 기본값
   - 테마 설정
   - API 키 관리

2. **다운로드 관리 UI**
   - 진행 중인 다운로드 표시
   - 일시정지/재개/취소

3. **로그 뷰어**
   - 게임 로그 실시간 표시
   - 로그 저장/내보내기
   - 크래시 리포트 분석

## 🐛 알려진 이슈

1. **TypeScript 경고**
   - CSS `@tailwind`, `@apply` 규칙 경고 (동작에는 문제 없음)
   
2. **개발 환경 전용**
   - 현재는 HTTP API 사용 (성능 최적화 필요)
   - gRPC 구현 후 개선 예정

3. **보안 취약점**
   - `npm audit`에서 10개 취약점 발견
   - 대부분 개발 의존성 관련 (프로덕션에 영향 없음)

## 📝 참고 사항

### 데이터 저장 위치
- **macOS**: `~/Library/Application Support/Electron/data/profiles/`
- **개발 모드**: `~/Library/Application Support/hyenimc-development/data/profiles/`

### 포트
- Vite: `5173`
- Backend: 동적 할당 (터미널에서 확인)

### 로그
- Backend: `[Backend]`, `[HTTP]` 태그
- IPC: `[IPC]`, `[IPC Profile]` 태그
- UI: 브라우저 개발자 도구

## 🎉 주요 성과

1. **완전한 프로젝트 구조** 수립
2. **프로필 관리 기능** 전체 구현 (CRUD)
3. **Backend-Frontend 통신** 구현
4. **UI/UX** 기본 디자인 완성
5. **빌드 시스템** 구축
6. **문서화** 완료

## 💡 개선 제안

### 단기 (1-2주)
- [ ] Proto 코드 생성 및 gRPC 전환
- [ ] Java 감지 및 관리
- [ ] 기본 게임 실행 기능

### 중기 (1개월)
- [ ] Modrinth 모드 검색/설치
- [ ] 다운로드 진행률 표시
- [ ] 에러 처리 개선

### 장기 (2-3개월)
- [ ] 모드팩 지원
- [ ] 자동 업데이트
- [ ] 혜니월드 인증 연동

---

**작성일**: 2025-10-09  
**작성자**: Cascade AI  
**프로젝트**: HyeniMC Launcher

---

## 로드맵 업데이트 (2025-10-11)

- **[핵심 목표]**
  - 강혜니 서버에 원클릭 접속을 지원하고, 전용 모드를 안전하게 배포/업데이트하며, 강혜니 아이덴티티를 표현하는 테마/스킨을 제공합니다. 또한 서버 보안 요구사항(SPA 등)을 런처에서 지원합니다.

- **[단계 로드맵]**
  1) gRPC 전환(서버·클라이언트·IPC 마이그레이션, 스트리밍 안정화)
  2) 캐싱/무결성/다운로드 안정화(Resume/재시도/체크섬/롤백)
  3) CurseForge/Modrinth 통합(설치/업데이트/의존성)
  4) UI/UX 강화(Modrinth 앱 수준의 검색/상세/버전 선택/진행률 UX)
  5) 강혜니 전용 기능(전용 모드 배포 채널/보안(SPA)/테마 시스템)

- **[대형 과제]**
  - gRPC 스트리밍 안정화: 서버 스트림 ↔ IPC 이벤트 브리지(백프레셔/하트비트/재연결), 이벤트 스키마 확정
  - 에러 체계: gRPC Status → IPC → UI 메시지 표준화 및 재시도 정책
  - 성능/캐시: 버전/에셋/라이브러리 공유 캐시, TTL/무효화, 대용량 부하 테스트
  - TS 서비스 이관: `src/main/services/*` 코어 기능을 Go로 이전, 호출부 정리
  - 보안: 입력/경로 검증, 다운로드 서명/체크섬 일관화, 로컬 채널 보안 검토
  - 패키징/배포: Windows/macOS 백엔드 바이너리 경로/권한/생명주기 검증
  - 통합/E2E 테스트: 프로필→로더→모드팩(온라인/로컬)→실행 시나리오 자동화
  - 자동 업데이트/코드서명: electron-updater, 채널 운영(베타/안정)
  - 관측성: 구조화 로깅/메트릭/크래시 리포트, 상관관계 ID 전파

- **[즉시 실행 체크리스트]**
  - [ ] `npm run proto:gen` 실행 및 생성물 반영
  - [ ] `backend/internal/grpc/`에 `download/version/instance/mod/modpack` 서버 구현(스트리밍 포함)
  - [ ] Electron gRPC 클라이언트 래퍼 추가(예: `src/main/grpc/clients.ts`), 스트림 → `IPC_EVENTS` 브릿지
  - [ ] `src/main/ipc/*.ts` 핸들러를 gRPC 호출로 마이그레이션
  - [ ] 다운로드/로그 이벤트 스키마 확정 및 `DownloadModal.tsx`·`useDownloadStore` 연동 검증
  - [ ] Windows 빌드 확인: `backend/bin/hyenimc-backend.exe` 포함 및 `manager.ts` 경로 검증

### gRPC 전환 1단계 진행상황 (2025-10-11)

- **[완료]** `DownloadService` 구현 및 적용
- **[완료]** 모드팩(.mrpack) 설치 경로 gRPC 전환, 개별 모드 설치 gRPC 전환
- **[완료]** 에셋 프리페치용 `AssetService.PrefetchAssets` 추가 및 연동 준비
- **[완료]** 스트림 `CANCELLED` 소음 무시 처리로 안정화
- **[진행 예정]** 리소스팩/셰이더팩 URL 설치 경로 gRPC 전환(로컬 파일 설치는 유지)
- **[진행 예정]** SettingService 도입(전역 설정), 런처 메인에서 gRPC 클라이언트 연결

### 전역(전체) 설정 설계 및 상속 규칙

- **[목표]** 프로필이 미지정한 항목은 전역 설정을 기본값으로 상속하여 사용
- **[SettingsService 스키마]**
  - `GlobalSettings`
    - `DownloadSettings`: `request_timeout_ms(기본 3000)`, `max_retries(기본 5)`, `max_parallel(기본 10)`
    - `JavaSettings`: `java_path`, `memory_min`, `memory_max`
    - `ResolutionSettings`: `width`, `height`, `fullscreen`
    - `CacheSettings`: `enabled`, `max_size_gb`, `ttl_days`
  - RPC: `GetSettings`, `UpdateSettings`, `ResetCache`
- **[상속 적용 지점]**
  - 게임 실행 직전, 메인 프로세스에서 `settingsRpc.getSettings()` 호출 후 프로필 값과 병합하여 `LaunchOptions` 생성
  - 예) `profile.memoryMin ?? global.java.memory_min`, `profile.width ?? global.resolution.width`

### 작업 순서 정리

1) gRPC 전환 마무리
   - 리소스팩/셰이더팩 URL 설치 gRPC 전환
   - SettingsService gRPC 추가 및 메인에서 사용
2) 캐시/무결성/다운로드 고급화(공유 캐시 인덱스, TTL, 리셋)
3) UI/설정 페이지(전역 설정 편집, 캐시 리셋 버튼 등)

- **[완료 기준]**
  - 런처에서 프로필 생성→권장 로더 자동 설치→모드/모드팩 설치·업데이트→게임 실행·로그 스트리밍 전 과정을 gRPC 기반으로 안정적으로 수행하며, 대형 모드팩 기준 중단복구·무결성 검증을 통과합니다.

