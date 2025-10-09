# HyeniMC 🚀

**아름답고 빠른 크로스플랫폼 마인크래프트 런처**

혜니월드 커뮤니티를 위한 프로필 기반 마인크래프트 런처입니다.

![Version](https://img.shields.io/badge/version-0.1.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)

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

### 🎨 UI/UX
- ✅ **모던 디자인**: 깔끔하고 직관적인 인터페이스
- ✅ **실시간 진행률**: 전체 & 개별 파일 진행률 표시
- ✅ **다크 모드**: 눈에 편한 다크 테마

---

## 📦 설치 및 개발

### 사전 요구사항
- **Node.js** 18+
- **Go** 1.21+
- **Java** 17+ (게임 실행용)
- **Azure AD 앱** (Microsoft 로그인용) - [빠른 설정 가이드](./QUICKSTART.md)

### 개발 환경 설정

```bash
# 1. 저장소 클론
git clone https://github.com/yourusername/HyeniMC.git
cd HyeniMC

# 2. 의존성 설치
npm install

# 3. 백엔드 빌드
cd src/main/backend
go build -o ../../../bin/backend main.go
cd ../../..

# 4. Microsoft 로그인 설정
# SETUP_GUIDE.md 참조하여 Azure AD 앱 등록 후
cd src/main/services
cp auth-config.example.ts auth-config.ts
# auth-config.ts 파일에 Client ID 입력
cd ../../..

# 5. 개발 모드 실행
npm run dev
```

### 빌드 및 패키징

```bash
# 프로덕션 빌드
npm run build

# 플랫폼별 패키징
npm run package:mac    # macOS
npm run package:win    # Windows
npm run package:linux  # Linux
```

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
- **Frontend**: React 18, TypeScript, TailwindCSS, Vite
- **Backend**: Electron, Node.js, Go
- **게임 로직**: Java 감지, 버전 관리, 프로세스 실행

---

## 🚀 성능 최적화

- **병렬 다운로드**: 20개 동시 연결로 4배 빠른 속도
- **체크섬 검증**: SHA1 해시로 파일 무결성 보장
- **증분 다운로드**: 이미 다운로드된 파일 스킵
- **메모리 최적화**: 스트리밍 다운로드로 메모리 사용 최소화

---

## 📋 로드맵

### ✅ Phase 1-4: 기본 런처 (완료)
- ✅ 프로필 관리
- ✅ 버전 관리
- ✅ Java 감지
- ✅ 바닐라 마인크래프트 실행
- ✅ 프로필 격리 및 경로 구조
- ✅ 병렬 다운로드 최적화

### ✅ Phase 5: 계정 관리 (완료)
- ✅ Microsoft OAuth 2.0 로그인
- ✅ 오프라인 계정 지원
- ✅ 멀티 계정 관리
- ✅ 자동 토큰 갱신
- ✅ 암호화 저장

### 🚧 Phase 6-8: 모드 지원 (진행중)
- 🔜 Fabric 로더 지원
- 🔜 Forge 로더 지원
- 🔜 모드 검색 및 설치 (Modrinth)
- 🔜 모드 관리 UI

### 📝 Phase 9-11: 고급 기능
- 🔜 모드팩 지원
- 🔜 스킨 관리
- 🔜 서버 목록
- 🔜 리소스팩 관리

---

## 🤝 기여하기

기여는 언제나 환영합니다! Pull Request를 보내주세요.

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📄 라이선스

MIT License - 자유롭게 사용, 수정, 배포 가능합니다.

---

## 👨‍💻 만든 사람

Made with ❤️ for 껄껄네

**⚠️ 면책 조항**: 이 프로젝트는 Mojang Studios와 공식적으로 연관되어 있지 않습니다. 마인크래프트는 Mojang Studios의 상표입니다.
