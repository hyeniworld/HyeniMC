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

### 2️⃣ 설정 파일 생성

**macOS/Linux**:
```bash
./scripts/setup-auth.sh
# Client ID 입력하면 끝!
```

**Windows**:
```bash
cd src/main/services
copy auth-config.example.ts auth-config.ts
# auth-config.ts 열어서 Client ID 입력
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

### Q: auth-config.ts 파일이 없어요
A: `./scripts/setup-auth.sh` 실행하거나 `auth-config.example.ts`를 복사

---

**설정 완료! 이제 정품 계정으로 멀티플레이를 즐기세요!** 🎮
