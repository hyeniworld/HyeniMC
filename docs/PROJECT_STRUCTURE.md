# HyeniMC 프로젝트 구조

## 📁 디렉토리 구조

```
HyeniMC/
├── .github/                    # GitHub 설정
│   └── workflows/              # GitHub Actions 워크플로우
│       └── release-launcher.yml
│
├── backend/                    # Go 백엔드
│   ├── cmd/                    # 실행 파일
│   ├── internal/               # 내부 패키지
│   └── gen/                    # 생성된 gRPC 코드
│
├── cloudflare-worker/          # CurseForge 프록시
│   └── src/
│
├── docs/                       # 📚 모든 문서
│   ├── README.md               # 문서 인덱스
│   ├── architecture/           # 아키텍처 설계
│   │   ├── ARCHITECTURE.md
│   │   ├── DESIGN.md
│   │   ├── THEME_SYSTEM.md
│   │   └── AUTH_PROTOCOL.md
│   ├── guides/                 # 사용자 가이드
│   │   ├── QUICKSTART.md
│   │   ├── SETUP_GUIDE.md
│   │   ├── USER_AUTH_GUIDE.md
│   │   └── MICROSOFT_AUTH_SETUP.md
│   ├── development/            # 개발 문서
│   │   ├── DEVELOPMENT.md
│   │   ├── IMPLEMENTATION_GUIDE.md
│   │   ├── TESTING.md
│   │   ├── PROGRESS.md
│   │   └── archive/            # 이전 개발 문서
│   └── deployment/             # 배포 문서
│       ├── VERSION_MANAGEMENT.md  ⭐
│       ├── RELEASE_SYSTEM.md
│       ├── DEPLOYMENT_GUIDE.md
│       └── AUTO_UPDATE_INSTALL.md
│
├── proto/                      # gRPC 프로토콜 정의
│   └── launcher/
│
├── public/                     # 정적 리소스
│   └── assets/
│
├── scripts/                    # 🔧 유틸리티 스크립트
│   ├── README.md               # 스크립트 가이드
│   ├── release.sh              # 릴리즈 스크립트 (macOS/Linux)
│   ├── release.ps1             # 릴리즈 스크립트 (Windows)
│   └── setup-auth.sh           # 인증 설정
│
├── src/                        # 소스 코드
│   ├── main/                   # Electron 메인 프로세스
│   │   ├── backend/            # 백엔드 관리
│   │   ├── grpc/               # gRPC 클라이언트
│   │   ├── ipc/                # IPC 핸들러
│   │   ├── protocol/           # 프로토콜 핸들러
│   │   ├── services/           # 비즈니스 로직
│   │   ├── auto-updater.ts     # 자동 업데이트
│   │   └── main.ts             # 진입점
│   ├── preload/                # Preload 스크립트
│   ├── renderer/               # React UI
│   │   ├── components/         # React 컴포넌트
│   │   ├── contexts/           # React Context
│   │   ├── hooks/              # Custom Hooks
│   │   ├── pages/              # 페이지
│   │   └── App.tsx
│   └── shared/                 # 공유 코드
│       ├── constants/
│       └── types/
│
├── dist/                       # 빌드 결과물 (gitignore)
├── release/                    # 패키징 결과물 (gitignore)
├── node_modules/               # 의존성 (gitignore)
│
├── .gitignore                  # Git 제외 파일
├── index.html                  # Vite 진입점
├── package.json                # 프로젝트 설정
├── README.md                   # 프로젝트 소개
├── tsconfig.json               # TypeScript 설정
├── vite.config.ts              # Vite 설정
└── tailwind.config.js          # TailwindCSS 설정
```

## 📝 파일 역할

### 루트 파일
- **README.md** - 프로젝트 소개 및 빠른 시작
- **package.json** - 의존성, 스크립트, 버전 관리
- **index.html** - Vite 진입점

### 설정 파일
- **tsconfig.json** - TypeScript 컴파일러 설정
- **vite.config.ts** - Vite 빌드 설정
- **tailwind.config.js** - TailwindCSS 설정
- **postcss.config.js** - PostCSS 설정

### 문서 (docs/)
모든 프로젝트 문서가 카테고리별로 정리되어 있습니다.
- **architecture/** - 시스템 설계
- **guides/** - 사용자 가이드
- **development/** - 개발 문서
- **deployment/** - 배포 및 릴리즈

### 스크립트 (scripts/)
프로젝트 관리 및 배포 스크립트
- **release.sh/ps1** - 버전 업데이트 및 릴리즈
- **setup-auth.sh** - 인증 설정

## 🎯 주요 경로

### 개발 시작
1. [README.md](../README.md) - 프로젝트 소개
2. [guides/QUICKSTART.md](guides/QUICKSTART.md) - 빠른 시작
3. [development/DEVELOPMENT.md](development/DEVELOPMENT.md) - 개발 환경

### 기능 구현
1. [architecture/DESIGN.md](architecture/DESIGN.md) - 시스템 설계
2. [development/IMPLEMENTATION_GUIDE.md](development/IMPLEMENTATION_GUIDE.md) - 구현 가이드
3. [development/TESTING.md](development/TESTING.md) - 테스트

### 배포
1. [deployment/VERSION_MANAGEMENT.md](deployment/VERSION_MANAGEMENT.md) ⭐ - 버전 관리
2. [../scripts/release.sh](../scripts/release.sh) - 릴리즈 스크립트
3. [../.github/workflows/release-launcher.yml](../.github/workflows/release-launcher.yml) - CI/CD

## 📚 문서 찾기

### 주제별 문서
- **인증**: architecture/AUTH_PROTOCOL.md, guides/USER_AUTH_GUIDE.md
- **테마**: architecture/THEME_SYSTEM.md
- **배포**: deployment/VERSION_MANAGEMENT.md
- **테스트**: development/TESTING.md
- **진행상황**: development/PROGRESS.md

### 전체 문서 목록
📖 [docs/README.md](README.md)

## 🔧 유지보수

### 새 문서 추가 시
1. 적절한 카테고리 선택 (architecture/guides/development/deployment)
2. 파일 생성 및 작성
3. docs/README.md에 링크 추가
4. 필요시 루트 README.md에도 링크 추가

### 문서 이동 시
1. Git으로 이동: `git mv old/path new/path`
2. 모든 참조 링크 업데이트
3. docs/README.md 업데이트

## 🎨 명명 규칙

### 파일명
- **대문자 + 언더스코어**: `VERSION_MANAGEMENT.md`
- **명확하고 설명적**: `CURSEFORGE_PROXY_DEPLOYMENT.md`
- **약어 최소화**: `IMPLEMENTATION_GUIDE.md` (not `IMPL_GUIDE.md`)

### 디렉토리명
- **소문자**: `docs/`, `scripts/`
- **복수형**: `guides/`, `workflows/`
- **명확한 목적**: `architecture/`, `deployment/`

## 📦 빌드 결과물

### dist/
TypeScript 컴파일 결과
```
dist/
├── main/       # Electron 메인 프로세스
├── preload/    # Preload 스크립트
├── renderer/   # React 앱
└── shared/     # 공유 코드
```

### release/
electron-builder 패키징 결과
```
release/
├── HyeniMC-Setup-0.1.0.exe    # Windows 설치 파일
├── HyeniMC-0.1.0.dmg          # macOS 설치 파일
└── latest*.yml                # 자동 업데이트 메타데이터
```

## 🚫 제외 파일 (.gitignore)

- **빌드 결과물**: dist/, release/, build/
- **의존성**: node_modules/, backend/bin/
- **로그**: *.log
- **환경 설정**: .env, auth-config.ts
- **OS 파일**: .DS_Store, Thumbs.db

---

**마지막 업데이트**: 2025-10-14  
**버전**: 1.0.0
