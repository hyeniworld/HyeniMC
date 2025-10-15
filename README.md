# HyeniMC 🚀

**아름답고 빠른 크로스플랫폼 마인크래프트 런처**

혜니월드 커뮤니티를 위한 프로필 기반 마인크래프트 런처입니다.

![Version](https://img.shields.io/badge/version-0.1.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)

**한국어** | [English](README_EN.md)

---

## ⚠️ 중요 공지

> **이미지 저작권 안내**  
> 본 프로젝트에 포함된 모든 강혜니 관련 이미지, 일러스트, 아트워크는 **강혜니에게 저작권**이 있습니다.  
> 무단 사용, 복제, 배포, 2차 창작은 금지되며, 본 런처는 **혜니월드 커뮤니티 전용**입니다.  
> 자세한 내용은 [LICENSE.md](LICENSE.md)를 참조하세요.

---

## ✨ 주요 기능

### 🎮 게임 관리
- ✅ **프로필 관리**: 여러 프로필 생성, 편집, 삭제
- ✅ **프로필 격리**: 각 프로필마다 독립된 세이브, 모드, 설정
- ✅ **버전 선택**: 모든 마인크래프트 버전 지원 (1.0 ~ 최신)
- ✅ **자동 다운로드**: 게임 파일, 라이브러리, 에셋 자동 다운로드
- ✅ **병렬 다운로드**: 최대 20개 파일 동시 다운로드로 **4배 빠른 속도!**

### 🔐 계정 관리
- ✅ **Microsoft 로그인**: 정품 계정으로 멀티플레이 가능
- ✅ **오프라인 모드**: 싱글플레이 및 크랙 서버 지원
- ✅ **멀티 계정**: 여러 계정 추가 및 전환
- ✅ **자동 토큰 갱신**: 로그인 상태 자동 유지
- ✅ **암호화 저장**: AES-256-GCM으로 토큰 안전 보관

### ⚙️ 시스템
- ✅ **자동 Java 감지**: 시스템의 모든 Java 설치 자동 탐지
- ✅ **플랫폼 최적화**: macOS (Apple Silicon/Intel), Windows, Linux 지원
- ✅ **재시도 로직**: 네트워크 오류 시 자동 재시도 (exponential backoff)
- ✅ **체크섬 검증**: SHA1 해시로 파일 무결성 보장
- ✅ **Shared 리소스**: 라이브러리/에셋 중복 방지로 디스크 절약

### 🧩 모드 & 모드팩
- ✅ **모드 로더**: Fabric, NeoForge, Quilt 완전 지원
- ✅ **모드 검색**: Modrinth, CurseForge 통합 검색
- ✅ **자동 업데이트**: 설치된 모드 최신 버전 확인 및 업데이트
- ✅ **의존성 해결**: 필수 모드 자동 설치
- ✅ **모드팩 지원**: .mrpack, .zip 가져오기 및 설치
- ✅ **HyeniHelper**: 혜니월드 전용 모드 자동 관리

### 🎨 리소스 & 커스터마이징
- ✅ **리소스팩**: 설치, 활성화, 관리
- ✅ **셰이더팩**: Optifine, Iris 셰이더 지원
- ✅ **실시간 감지**: 파일 변경 자동 감지 및 반영

### 🎨 UI/UX
- ✅ **모던 디자인**: 깔끔하고 직관적인 인터페이스
- ✅ **실시간 진행률**: 전체 & 개별 파일 진행률 표시
- ✅ **다크 모드**: 눈에 편한 다크 테마
- ✅ **강혜니 테마**: 혜니월드 전용 커스텀 테마

---

## 📦 설치 및 개발

### 사전 요구사항
- **Node.js** 18+
- **Go** 1.21+
- **Java** 17+ (게임 실행용)
- **Azure AD 앱** (Microsoft 로그인용) - [빠른 설정 가이드](docs/guides/QUICKSTART.md)
- **Buf CLI** (Protobuf 코드 생성용) - `npm install`로 자동 설치됨

### 개발 환경 설정

```bash
# 1. 저장소 클론
git clone https://github.com/yourusername/HyeniMC.git
cd HyeniMC

# 2. 의존성 설치
npm install

# 3. 환경변수 설정
cp .env.example .env
# .env 파일 편집하여 다음 값 입력:
# - HYENIMC_WORKER_URL: Cloudflare Worker 주소
# - AZURE_CLIENT_ID: Azure Portal의 Client ID
# 자세한 설정 방법은 .env.example 파일 참조

# 4. Protobuf 코드 생성
npm run proto:gen

# 5. 백엔드 빌드
npm run backend:build:mac-universal  # macOS
# 또는
npm run backend:build:win-x64        # Windows

# 6. 개발 모드 실행
npm run dev
```

### 빌드 및 패키징

```bash
# Protobuf 코드 생성 (필수)
npm run proto:gen

# 프로덕션 빌드
npm run build

# 플랫폼별 패키징 (백엔드 빌드 포함)
npm run package:mac    # macOS
npm run package:win    # Windows
npm run package:linux  # Linux
```

### GitHub Actions 자동 배포

릴리즈를 위해서는 GitHub Secrets 설정이 필요합니다:

1. **GitHub 저장소 → Settings → Secrets and variables → Actions**
2. 다음 Secret 추가:
   - `HYENIMC_WORKER_URL`: Cloudflare Worker 주소
   - `AZURE_CLIENT_ID`: Azure Portal의 Microsoft OAuth Client ID

자세한 내용은 [버전 관리 가이드](docs/deployment/VERSION_MANAGEMENT.md)를 참조하세요.

---

## 🏛️ 아키텍처

```
HyeniMC/
├── src/
│   ├── main/              # Electron 메인 프로세스
│   │   ├── backend/       # Go 백엔드 서버 (HTTP API)
│   │   ├── services/      # 게임 런처, 다운로드 매니저
│   │   └── ipc/           # IPC 핸들러
│   ├── renderer/          # React UI
│   │   ├── components/    # React 컴포넌트
│   │   └── pages/         # 페이지
│   └── shared/            # 공유 타입/상수
├── proto/                 # gRPC 프로토콜 정의
└── bin/                   # 빌드된 실행 파일
```

### 기술 스택
- **Frontend**: React 18, TypeScript, TailwindCSS, Vite, Zustand
- **Backend**: Electron 28, Node.js, Go 1.21
- **API 통합**: Modrinth API, CurseForge API (Cloudflare Worker)
- **모드 로더**: Fabric, NeoForge, Quilt
- **인증**: Microsoft OAuth 2.0, AES-256-GCM 암호화
- **자동 업데이트**: electron-updater, GitHub Releases

---

## 🚀 성능 최적화

**⚡ 2.3배 빠른 다운로드 속도!** (Modrinth 앱 분석 및 적용)

- **HTTP Keep-Alive**: TCP 연결 재사용으로 레이턴시 50-100ms 절약
- **Semaphore 병렬 처리**: 효율적인 동시성 제어 (다운로드 10개 + I/O 10개)
- **다운로드/I/O 분리**: 네트워크 다운로드와 파일 쓰기를 동시 처리
- **빠른 재시도**: 100ms 대기로 신속한 오류 복구
- **체크섬 검증**: SHA1 해시로 파일 무결성 보장
- **증분 다운로드**: 이미 다운로드된 파일 스킵
- **메모리 최적화**: 스트리밍 다운로드로 메모리 사용 최소화

📊 [다운로드 최적화 상세 문서](docs/performance/DOWNLOAD_OPTIMIZATION.md)

---

## 📋 개발 로드맵

### ✅ Phase 1-4: 기본 런처 (완료)
- ✅ 프로필 관리 (생성, 편집, 삭제, 복제)
- ✅ 버전 관리 (모든 마인크래프트 버전)
- ✅ Java 자동 감지 및 관리
- ✅ 바닐라 마인크래프트 실행
- ✅ 프로필 격리 및 독립 경로 구조
- ✅ 병렬 다운로드 최적화 (20개 동시)
- ✅ 자동 업데이트 시스템

### ✅ Phase 5: 계정 관리 (완료)
- ✅ Microsoft OAuth 2.0 로그인
- ✅ 오프라인 계정 지원
- ✅ 멀티 계정 관리 및 전환
- ✅ 자동 토큰 갱신
- ✅ AES-256-GCM 암호화 저장

### ✅ Phase 6-8: 모드 지원 (완료)
- ✅ **Fabric 로더** - 완전 지원
- ✅ **NeoForge 로더** - 완전 지원
- ✅ **Quilt 로더** - 완전 지원
- ✅ **모드 검색 및 설치** (Modrinth, CurseForge)
- ✅ **모드 관리 UI** - 활성화/비활성화, 삭제
- ✅ **모드 자동 업데이트** - 최신 버전 확인 및 업데이트
- ✅ **의존성 자동 해결** - 필수 모드 자동 설치
- ✅ **HyeniHelper 모드** - 자동 업데이트 및 관리

### ✅ Phase 9-10: 모드팩 & 리소스 (완료)
- ✅ **모드팩 검색 및 설치** (Modrinth, CurseForge)
- ✅ **모드팩 가져오기** - .mrpack, .zip 지원
- ✅ **리소스팩 관리** - 설치, 활성화, 삭제
- ✅ **셰이더팩 관리** - Optifine, Iris 셰이더 지원
- ✅ **파일 감시** - 실시간 모드/리소스팩 변경 감지

### 🚧 Phase 11: 추가 기능 (계획)
- 🔜 **스킨 관리** - 스킨 변경 및 미리보기
- 🔜 **서버 목록** - 즐겨찾기 서버 관리
- 🔜 **월드 백업** - 자동 백업 및 복원
- 🔜 **성능 프로파일** - 저사양/고사양 최적화 프리셋

---

## 📚 문서

모든 문서는 [docs/](docs/) 디렉토리에 정리되어 있습니다.

### 빠른 링크
- **[프로젝트 구조](docs/PROJECT_STRUCTURE.md)** 📁 - 전체 디렉토리 구조 및 파일 설명
- **[빠른 시작 가이드](docs/guides/QUICKSTART.md)** - Microsoft OAuth 설정
- **[개발 가이드](docs/development/DEVELOPMENT.md)** - 개발 환경 설정
- **[버전 관리](docs/deployment/VERSION_MANAGEMENT.md)** ⭐ - 릴리즈 및 배포 가이드
- **[테스트 가이드](docs/development/TESTING.md)** - 기능별 테스트 방법
- **[아키텍처](docs/architecture/DESIGN.md)** - 시스템 설계 및 기술 스택

### 전체 문서 목록
📖 [docs/README.md](docs/README.md) - 모든 문서 목록 및 구조

---

## 🤝 기여하기

기여는 언제나 환영합니다! Pull Request를 보내주세요.

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📄 라이선스 및 저작권

### 소프트웨어 라이선스
이 프로젝트의 소스 코드는 **MIT License**를 따릅니다.

### ⚠️ 중요: 이미지 및 아트워크 저작권

**본 프로젝트에 포함된 모든 강혜니 관련 이미지, 일러스트, 아트워크는 강혜니에게 저작권이 있습니다.**

- ❌ **무단 사용 금지**: 강혜니 이미지 및 일러스트는 저작권자의 명시적 허가 없이 사용할 수 없습니다.
- ❌ **상업적 이용 금지**: 어떠한 형태의 상업적 이용도 금지됩니다.
- ❌ **2차 창작 제한**: 저작권자의 허가 없는 2차 창작 및 변형은 금지됩니다.
- ✅ **허용 범위**: 본 런처는 강혜니 및 혜니월드 커뮤니티를 위한 용도로만 사용 가능합니다.
- 🔓 **특별 허가**: 저작권자(강혜니)의 명시적 서면 허가를 받은 경우, 허가 범위 내에서 사용 가능합니다.

### 사용 제한
본 프로그램은 **강혜니 및 혜니월드 커뮤니티 전용**으로 제작되었습니다.
- 다른 목적으로의 사용은 허가되지 않습니다.
- 다른 스트리머, 커뮤니티, 서버를 위한 용도로 사용할 수 없습니다.
- 본 프로그램을 기반으로 한 파생 런처 제작 시, 강혜니 관련 이미지 및 브랜딩을 제거해야 합니다.

자세한 내용은 [LICENSE.md](LICENSE.md)를 참조하세요.

---

## 👨‍💻 만든 사람

Made with ❤️ for 혜니월드

**⚠️ 면책 조항**: 이 프로젝트는 Mojang Studios와 공식적으로 연관되어 있지 않습니다. 마인크래프트는 Mojang Studios의 상표입니다.
