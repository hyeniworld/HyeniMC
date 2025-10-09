# 개발 가이드

## 시작하기

### 1. 의존성 설치

```bash
# Node.js 의존성 설치
npm install

# Go 의존성 설치
cd backend
go mod download
cd ..
```

### 2. 백엔드 빌드

```bash
# macOS (현재 아키텍처에 맞게 빌드)
npm run backend:build:mac-arm64    # Apple Silicon
npm run backend:build:mac-x64      # Intel Mac

# Windows
npm run backend:build:win-x64

# 모든 플랫폼
npm run backend:build:all
```

### 3. 개발 서버 실행

```bash
# Vite 개발 서버와 Electron을 동시에 실행
npm run dev
```

또는 별도로 실행:

```bash
# 터미널 1: Vite 개발 서버
npm run dev:vite

# 터미널 2: Electron
npm run dev:electron
```

## 프로젝트 구조

```
HyeniMC/
├── backend/                    # Go 백엔드
│   ├── cmd/hyenimc/           # 메인 애플리케이션
│   ├── internal/
│   │   ├── domain/            # 도메인 모델
│   │   ├── repo/              # 데이터 저장소
│   │   ├── services/          # 비즈니스 로직
│   │   ├── grpc/              # gRPC 핸들러
│   │   └── http/              # HTTP API (임시)
│   ├── bin/                   # 빌드된 바이너리 (gitignore)
│   └── go.mod
│
├── src/
│   ├── main/                  # Electron Main 프로세스
│   │   ├── backend/           # 백엔드 프로세스 관리
│   │   ├── ipc/               # IPC 핸들러
│   │   └── main.ts            # 메인 엔트리
│   │
│   ├── renderer/              # React UI
│   │   ├── components/        # React 컴포넌트
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   └── index.css
│   │
│   ├── preload/               # Preload 스크립트
│   │   └── preload.ts
│   │
│   └── shared/                # 공유 타입/상수
│       ├── types/
│       └── constants/
│
├── proto/                     # Protobuf 정의
│   └── launcher/
│
├── dist/                      # 빌드 출력 (gitignore)
└── release/                   # 패키징 출력 (gitignore)
```

## 개발 워크플로우

### 프로필 관리 테스트

1. 앱 실행: `npm run dev`
2. "새 프로필" 버튼 클릭
3. 프로필 정보 입력:
   - 이름: 테스트 프로필
   - 설명: 테스트용 프로필입니다
   - 게임 버전: 1.20.1
   - 로더: Vanilla
4. "프로필 만들기" 클릭
5. 프로필 카드 확인

### 데이터 저장 위치

개발 모드에서 프로필 데이터는 다음 위치에 저장됩니다:

- **macOS**: `~/Library/Application Support/hyenimc-development/data/profiles/`
- **Windows**: `%APPDATA%\hyenimc-development\data\profiles\`
- **Linux**: `~/.config/hyenimc-development/data/profiles/`

### 로그 확인

- **Electron Main**: 터미널에 `[Backend]`, `[IPC]` 태그로 출력
- **Backend Server**: 터미널에 `[HTTP]` 태그로 출력
- **Renderer**: 브라우저 개발자 도구 콘솔

## 빌드 및 패키징

### 개발 빌드

```bash
# Main 프로세스만 빌드
npm run build:main

# Renderer (React)만 빌드
npm run build:renderer

# 전체 빌드
npm run build
```

### 프로덕션 패키징

```bash
# 현재 플랫폼용 패키지
npm run package

# macOS용
npm run package:mac

# Windows용
npm run package:win
```

패키징된 앱은 `release/` 디렉토리에 생성됩니다.

## 코드 스타일

### TypeScript/JavaScript

```bash
# Lint 검사
npm run lint

# 코드 포맷팅
npm run format
```

### Go

```bash
cd backend
go fmt ./...
go vet ./...
```

## 테스트

```bash
# 단위 테스트 실행
npm test

# UI 테스트
npm run test:ui
```

## 트러블슈팅

### 백엔드 서버가 시작되지 않음

1. 백엔드 바이너리가 빌드되었는지 확인:
   ```bash
   ls -la backend/bin/
   ```

2. 다시 빌드:
   ```bash
   npm run backend:build:mac-arm64
   ```

### Electron이 시작되지 않음

1. Main 프로세스가 빌드되었는지 확인:
   ```bash
   ls -la dist/main/
   ```

2. 다시 빌드:
   ```bash
   npm run build:main
   ```

### UI가 표시되지 않음

1. Vite 개발 서버가 실행 중인지 확인 (포트 5173)
2. 브라우저 개발자 도구에서 콘솔 에러 확인

### 프로필이 저장되지 않음

1. 백엔드 로그 확인
2. 데이터 디렉토리 권한 확인
3. 백엔드 API 응답 확인:
   ```bash
   curl http://localhost:PORT/health
   ```

## 다음 단계

현재 구현된 기능:
- ✅ 프로필 생성, 조회, 수정, 삭제
- ✅ Backend HTTP API (임시)
- ✅ Electron Main 프로세스
- ✅ React UI 기본 구조

구현 예정:
- 🔜 gRPC 통신 (Proto 코드 생성)
- 🔜 게임 실행 기능
- 🔜 Java 관리
- 🔜 모드 관리 (Modrinth/CurseForge)
- 🔜 모드팩 지원
- 🔜 자동 업데이트

자세한 내용은 [IMPLEMENTATION_GUIDE.md](./IMPLEMENTATION_GUIDE.md)를 참조하세요.
