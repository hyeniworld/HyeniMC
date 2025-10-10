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
