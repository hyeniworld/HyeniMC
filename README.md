# HyeniMC - 혜니월드 전용 마인크래프트 런처

혜니월드 커뮤니티를 위한 프로필 기반 마인크래프트 런처

## 주요 기능

- ✅ **프로필 관리**: 서버별로 독립된 마인크래프트 인스턴스 관리
- ✅ **모드팩 지원**: Modrinth 및 CurseForge 모드팩 검색 및 설치
- ✅ **자동 업데이트**: 모드 자동 업데이트 (강제/선택적)
- ✅ **멀티플랫폼**: Windows, macOS (Intel & Apple Silicon) 지원
- ✅ **다양한 로더**: Vanilla, Fabric, Forge, NeoForge 지원
- 🔜 **혜니월드 인증**: 디스코드 연동 인증 시스템 (추후 구현)
- 🔜 **SPA 연동**: Single Packet Authorization 지원 (추후 구현)

## 기술 스택

- **Frontend**: Electron, React, TypeScript, TailwindCSS, shadcn/ui
- **Backend**: Go 1.22+, gRPC (Electron Main과 로컬 통신)
- **Build**: Vite, electron-builder
- **APIs**: Modrinth, CurseForge, Minecraft Launcher Meta

## 프로젝트 구조

```
HyeniMC/
├── src/
│   ├── main/              # Electron Main (Bridge: gRPC Client + IPC)
│   ├── renderer/          # React UI
│   ├── shared/            # 공유 타입 및 상수
│   └── preload/           # Electron Preload
├── backend/               # Go gRPC 서버 (Core Daemon)
│   ├── cmd/hyenimc/       # main 패키지
│   ├── internal/          # 서비스/도메인/인프라 구현
│   └── go.mod
├── proto/                 # Protobuf 정의 및 buf 설정
│   └── launcher/*.proto
├── resources/             # 리소스 파일
├── DESIGN.md              # 상세 설계 문서
└── README.md
```

## 개발 시작하기

### 요구사항

- Node.js 20+
- npm 또는 yarn
- Go 1.22+

### 설치

```bash
# 의존성 설치
npm install

# 개발 모드 실행
npm run dev

# 빌드
npm run build

# 패키징
npm run package

# (옵션) Go 백엔드 빌드
# macOS (arm64 예시)
GOOS=darwin GOARCH=arm64 go build -o backend/bin/hyenimc-backend ./backend
# Windows (x64 예시)
GOOS=windows GOARCH=amd64 go build -o backend/bin/hyenimc-backend.exe ./backend
```

## 문서

- [설계 문서](./DESIGN.md) - 전체 시스템 아키텍처 및 상세 설계

## 개발 로드맵

### Phase 1-4: 기본 런처 (진행 예정)
- 프로필 관리
- 버전 관리
- Java 관리
- 바닐라 마인크래프트 실행

### Phase 5-8: 모드 지원 (진행 예정)
- 모드 로더 지원
- 모드 검색 및 설치
- 모드 업데이트

### Phase 9-11: 고급 기능 (진행 예정)
- 모드팩 지원
- 외부 런처 가져오기
- 프로필 공유

### Phase 12-13: 배포 준비 (진행 예정)
- 최적화 및 테스트
- 빌드 및 배포

### Phase 14: 혜니월드 통합 (추후)
- 혜니월드 인증 연동
- SPA 연동

## 라이선스

MIT License

## 기여

이슈 및 PR은 언제나 환영합니다!
