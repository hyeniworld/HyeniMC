# ⚡ 빠른 시작 가이드

Microsoft 로그인 설정을 3분 안에!

---

## 📋 필요한 것

- Microsoft 계정 (무료)
- 5분의 시간

---

## 🚀 3단계로 설정하기

### 1️⃣ Azure AD 앱 등록

1. https://portal.azure.com 접속
2. **Azure Active Directory** → **앱 등록** → **새 등록**
3. 입력:
   - 이름: `HyeniMC`
   - 계정 유형: **개인 Microsoft 계정만**
   - 리디렉션 URI: `http://localhost:3000/auth/callback` (공용 클라이언트)
4. **등록** → **Client ID 복사**

### 2️⃣ 환경변수 설정

```bash
# .env 파일 생성
cp .env.example .env

# .env 파일 편집 (텍스트 에디터로 열기)
# HYENIMC_WORKER_URL과 AZURE_CLIENT_ID 입력
```

**.env 파일 내용**:
```env
HYENIMC_WORKER_URL=https://your-worker.workers.dev
AZURE_CLIENT_ID=여기에_복사한_Client_ID_붙여넣기
```

### 3️⃣ 코드 생성 및 빌드

```bash
# Protobuf 코드 생성 (필수)
npm run proto:gen

# 백엔드 빌드
npm run backend:build:mac-universal  # macOS
# 또는
npm run backend:build:win-x64        # Windows
```

### 4️⃣ 실행 및 테스트

```bash
npm run dev
```

헤더 → **"Microsoft 로그인"** → 계정 입력 → 완료! 🎉

---

## 🔍 상세 가이드

더 자세한 내용은 다음 문서를 참고하세요:

- **[SETUP_GUIDE.md](./SETUP_GUIDE.md)** - 전체 설정 가이드
- **[MICROSOFT_AUTH_SETUP.md](./MICROSOFT_AUTH_SETUP.md)** - 기술 문서
- **[README.md](./README.md)** - 프로젝트 개요

---

## ❓ 문제 해결

### Q: `unauthorized_client` 에러
A: Azure Portal에서 계정 유형을 "개인 Microsoft 계정" 또는 "모든 계정" 으로 설정했는지 확인

### Q: Client ID를 어디서 찾나요?
A: Azure Portal → 앱 등록 → 개요 → "애플리케이션 (클라이언트) ID"

### Q: .env 파일이 없어요
A: `.env.example`을 복사해서 `.env`로 만들고 값을 입력하세요

---

**설정 완료! 이제 정품 계정으로 멀티플레이를 즐기세요!** 🎮
