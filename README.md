# HyeniMC 🚀

**혜니월드 커뮤니티 전용 마인크래프트 런처**

프로필 기반으로 마인크래프트를 관리·실행하고, 혜니월드 전용 모드팩(혜니팩)을 손쉽게 설치·업데이트합니다.

![Version](https://img.shields.io/badge/version-0.4.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-lightgrey)

**한국어** | [English](README_EN.md)

---

## ⚠️ 중요 공지

> **이미지 저작권 안내**  
> 본 프로젝트에 포함된 모든 강혜니 관련 이미지, 일러스트, 아트워크는 **강혜니에게 저작권**이 있습니다.  
> 무단 사용, 복제, 배포, 2차 창작은 금지되며, 본 런처는 **혜니월드 커뮤니티 전용**입니다.  
> 자세한 내용은 [LICENSE.md](LICENSE.md)를 참조하세요.

---

## 🧭 프로젝트 구성 (두 개의 앱)

HyeniMC는 **렌더러(React UI)와 SQLite 데이터베이스를 공유**하는 두 개의 앱으로 이루어져 있습니다.

| 앱 | 스택 | 대상 | 역할 |
|----|------|------|------|
| **사용자 런처** | **Tauri v2 + Rust** | 일반 사용자 | 프로필·게임 실행·혜니팩·워커 모드·리소스/셰이더팩·크래시 리포트. 경량 배포(자체 자동 업데이트). |
| **제작자 도구** | **Electron + Go** | 팩 제작자 | 혜니팩 제작/export, 모드·모드팩 검색·설치, 의존성 해결, 배포 관리. **기능 동결**(사용자 런처엔 진입점 숨김). |

> 기존 Electron 단일 런처를 **사용자 런처는 Tauri+Rust로 리뉴얼**하고, 기존 Electron은 **제작자 도구로 존치**하는 방향으로 전환했습니다. 두 앱은 같은 `~/.hyenimc`(`%APPDATA%\hyenimc`) 데이터를 in-place로 공유합니다. 상세 설계는 [docs/architecture/](docs/architecture/) 참조.

---

## ✨ 주요 기능

### 🎮 사용자 런처 (Tauri)
- ✅ **프로필 관리**: 생성·편집·삭제·즐겨찾기, 프로필별 독립 세이브/모드/설정
- ✅ **게임 실행**: 바닐라 · **Fabric · NeoForge · Forge** 로더 자동 설치 후 실행
- ✅ **Microsoft 로그인**: 정품 계정, 멀티 계정, 자동 토큰 갱신, **AES-256-GCM 암호화** 저장
- ✅ **Java 자동 감지**: 시스템 Java 설치 탐색(진입 지연 없이 탭 진입 시 감지)
- ✅ **혜니팩(모드팩)**: 온라인 목록/검색 설치 · 로컬 `.hyenipack` 가져오기 · 신버전 감지 → 적용(사용자 파일 보존, breaking 시 실행 차단)
- ✅ **워커 모드 자동 관리**: 혜니월드 서버 프로필의 필수 모드(HyeniHelper 등) sha256 검증 설치·업데이트
- ✅ **리소스팩/셰이더팩**: 팩 제공분/사용자 추가분 구분 표시(읽기전용) + 폴더 열기 + 실시간 파일 감시
- ✅ **크래시 리포트**: 로그/리포트 zip 내보내기 + 로그 폴더 열기
- ✅ **자동 업데이트**: 새 릴리스 감지 → 다운로드 → 교체 설치(기존 Electron 판 위 설치 시 자동 제거 + 데이터 보존)
- ✅ **병렬 다운로드**: 파일 동시 다운로드 + sha1/sha256 무결성 검증 + shared 리소스 중복 방지

### 🛠️ 제작자 도구 (Electron, 제작자 전용)
- ✅ **혜니팩 제작/Export** (매니페스트 기반)
- ✅ **모드 검색·설치** (Modrinth · CurseForge) + **의존성 자동 해결**
- ✅ **모드팩 검색·설치** (.mrpack · .zip · CurseForge)
- ✅ **배포 관리** (관리 패널 연동 — 모드/혜니팩 게시·롤백)

---

## 📦 개발 및 빌드

### 사전 요구사항
- **Node.js** 20+ (공용 렌더러 빌드)
- **Rust** stable (사용자 런처 — Tauri v2)
- **Java** 17+ (게임 실행용)
- **Azure AD 앱** (Microsoft 로그인용) — [빠른 설정 가이드](docs/guides/QUICKSTART.md)
- *(제작자 도구 빌드 시에만)* **Go** 1.21+, **Buf CLI**(`npm install`로 자동 설치)

### 환경변수
`build.rs`/`generate:config`가 빌드 시 `.env`를 읽어 주입합니다.
```bash
cp .env.example .env
# HYENIMC_WORKER_URL      : Cloudflare Worker 주소
# AZURE_CLIENT_ID         : Azure Portal의 OAuth Client ID
# AUTHORIZED_SERVER_DOMAINS : 인증 허용 서버 도메인
```

### 사용자 런처 (Tauri)
```bash
npm install
npm run dev:tauri      # 개발 실행 (vite + Rust 앱, 핫리로드)
npm run build:tauri    # 배포 번들 (Windows NSIS / macOS dmg)
```
> `sync-version`이 `package.json` 버전을 `tauri.conf.json`·`Cargo.toml`에 전파합니다(버전 단일 소스).

### 제작자 도구 (Electron)
```bash
npm run dev            # Electron 개발 실행 (Go 백엔드 필요)
npm run backend:build:win-x64   # Go 사이드카 빌드 (또는 :mac-arm64 / :mac-x64)
npm run package:win    # 패키징 (또는 :mac)
```
> 두 앱은 같은 SQLite를 공유하므로 **동시 실행은 비권장**합니다.

### 릴리스 (사용자 런처)
`v*.*.*` 태그를 push하면 [`.github/workflows/release-launcher.yml`](.github/workflows/release-launcher.yml)이 Windows/macOS 번들을 빌드·서명하고 GitHub Release에 번들 + `latest.json`(업데이트 피드)을 게시합니다.

필요한 리포지토리 Secret: `TAURI_SIGNING_PRIVATE_KEY`, `HYENIMC_WORKER_URL`, `AZURE_CLIENT_ID`, `AUTHORIZED_SERVER_DOMAINS`. 자세한 내용은 [QA & 배포 문서](docs/architecture/QA_AND_RELEASE.md).

---

## 🏛️ 아키텍처

```
HyeniMC/
├── apps/launcher/          # 사용자 런처 (Tauri v2)
│   └── src-tauri/          # Rust 앱 크레이트 (hyenimc-app) + tauri.conf.json
├── crates/                 # Rust 워크스페이스
│   ├── hyenimc-core/       # DB·설정·계정·토큰 저장소 등 코어
│   └── hyenimc-launcher/   # 다운로드·설치·로더·게임 실행·혜니팩·워커모드
├── src/
│   ├── renderer/           # React UI (두 앱 공용)
│   ├── main/               # 제작자 도구 Electron 메인 프로세스
│   └── shared/             # 공유 타입/상수
├── backend/                # 제작자 도구 Go 백엔드(사이드카)
├── cloudflare-worker/      # 배포 Worker + 관리 패널(/admin)
└── docs/                   # 설계·QA·가이드 문서
```

### 기술 스택
- **사용자 런처**: Tauri v2, Rust, rusqlite, reqwest, tauri-plugin-{updater,log,deep-link}
- **제작자 도구**: Electron, Node.js, Go 1.21 (gRPC 사이드카)
- **공용 렌더러**: React 18, TypeScript, TailwindCSS, Vite
- **모드 로더**: Fabric, NeoForge, Forge
- **인증**: Microsoft OAuth 2.0, AES-256-GCM 암호화, 혜니월드 딥링크 인증(`hyenimc://`)
- **배포/업데이트**: Tauri updater(사용자 런처, GitHub Releases + `latest.json`), electron-updater(제작자 도구)

---

## 📋 로드맵

### ✅ Tauri 리뉴얼 (M0~M6, 완료 — v0.4.0)
- ✅ Rust 워크스페이스 + Tauri v2 셸 + 기존 SQLite **in-place 호환**
- ✅ 프로필·계정·게임 실행(바닐라/Fabric/NeoForge/Forge)·Java 감지
- ✅ 혜니팩 설치/업데이트 · 워커 모드 자동 관리 · 리소스/셰이더팩 · 크래시 리포트
- ✅ 자동 업데이트 + Windows 교체 설치(Electron 판 자동 제거·데이터 보존)
- ✅ 릴리스 파이프라인 end-to-end 실증(태그 → 서명 번들 + `latest.json`)

### 🚧 남은 검증/작업
- 🔜 breaking 업데이트 차단 · 크래시 리포트 export 최종 QA
- 🔜 **macOS 교체 설치**(Developer ID 서명/공증 인프라)
- 🔜 Electron → Tauri **전환 브릿지**(마지막 electron-updater `latest.yml` 릴리스)

상세 진행 현황: [QA & 배포 매트릭스](docs/architecture/QA_AND_RELEASE.md)

### 💡 Phase 11: 추가 기능 (계획)
- 🔜 **스킨 관리** - 스킨 변경 및 미리보기
- 🔜 **서버 목록** - 즐겨찾기 서버 관리
- 🔜 **월드 백업** - 자동 백업 및 복원
- 🔜 **성능 프로파일** - 저사양/고사양 최적화 프리셋

---

## 📚 문서

모든 문서는 [docs/](docs/) 디렉토리에 있습니다.

- **[아키텍처/설계](docs/architecture/)** — 시스템 설계, 혜니팩 스펙, 인증 프로토콜, QA & 배포
- **[빠른 시작 가이드](docs/guides/QUICKSTART.md)** — Microsoft OAuth 설정
- **[전체 문서 목록](docs/README.md)**

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
