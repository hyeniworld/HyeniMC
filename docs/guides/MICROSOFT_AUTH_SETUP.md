# Microsoft 계정 로그인 설정 가이드

HyeniMC에서 Microsoft 계정 로그인을 사용하려면 Azure AD 애플리케이션을 등록해야 합니다.

## 📋 사전 준비

- Microsoft 계정 (개인 계정 또는 회사 계정)
- Azure Portal 접근 권한

---

## 🔧 Azure AD 애플리케이션 등록

### 1. Azure Portal 접속

https://portal.azure.com 에 접속하여 로그인합니다.

### 2. Azure Active Directory로 이동

1. 왼쪽 메뉴에서 **"Azure Active Directory"** 클릭
2. 또는 검색창에서 "Azure Active Directory" 검색

### 3. 앱 등록 (App Registration)

1. 왼쪽 메뉴에서 **"앱 등록"** (App registrations) 클릭
2. 상단의 **"새 등록"** (New registration) 클릭

### 4. 애플리케이션 정보 입력

**이름 (Name)**:
```
HyeniMC Launcher
```

**지원되는 계정 유형 (Supported account types)**:
```
✅ 개인 Microsoft 계정만 (Personal Microsoft accounts only)
   - 또는 "모든 조직의 계정 및 개인 Microsoft 계정" 선택
```

**리디렉션 URI (Redirect URI)**:
```
플랫폼: 공용 클라이언트/네이티브 (모바일 및 데스크톱)
URI: http://localhost:3000/auth/callback
```

**"등록"** 버튼 클릭

### 5. Client ID 확인

등록 후 **"개요"** 페이지에서 다음 정보를 확인:

```
애플리케이션 (클라이언트) ID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

이 **Client ID**를 복사하여 보관합니다.

### 6. 인증 설정 (Authentication)

1. 왼쪽 메뉴에서 **"인증"** (Authentication) 클릭
2. **"고급 설정"** 섹션에서:
   - ✅ **"공용 클라이언트 흐름 허용"** 활성화
   - ✅ **"모바일 및 데스크톱 애플리케이션"** 활성화
3. 저장

### 7. API 권한 설정 (API Permissions)

1. 왼쪽 메뉴에서 **"API 권한"** (API permissions) 클릭
2. 기본적으로 다음 권한이 있어야 합니다:
   - `XboxLive.signin` (Xbox Live)
   - `offline_access`

필요시 **"권한 추가"** 클릭:
1. **"Microsoft APIs"** 선택
2. **"Xbox Live"** 검색 및 선택
3. **"XboxLive.signin"** 체크
4. **"권한 추가"** 클릭

---

## 🔑 HyeniMC 설정

### .env 파일로 설정 (권장)

프로젝트 루트에 `.env` 파일을 생성하고 편집:

```bash
# 1. 예제 파일 복사
cp .env.example .env

# 2. 텍스트 에디터로 열기
code .env
```

`.env` 파일 내용:

```env
# Cloudflare Worker 주소
HYENIMC_WORKER_URL=https://your-worker.YOUR_ACCOUNT.workers.dev

# Azure OAuth Client ID
AZURE_CLIENT_ID=a1b2c3d4-e5f6-g7h8-i9j0-k1l2m3n4o5p6

# 선택사항: CurseForge API Key (개발용)
# CURSEFORGE_API_KEY=your_api_key_here
```

### 자동 설정 파일 생성

`.env` 저장 후 `npm run dev` 또는 `npm run build` 실행 시
자동으로 TypeScript 설정 파일들이 생성됩니다:
- `src/main/services/auth-config.ts`
- `src/main/config/env-config.ts`

**장점**:
- ✅ **한 곳에서 관리**: 모든 환경변수를 .env로 통합
- ✅ **Git 안전**: .env는 .gitignore로 보호
- ✅ **표준 방식**: 다른 Node.js 프로젝트와 동일한 패턴

**⚠️ 주의**: .env 파일은 공개 저장소에 올리지 마세요!

---

## 🧪 테스트

1. HyeniMC 실행
2. 프로필 생성 시 **"Microsoft 로그인"** 버튼 클릭
3. 브라우저 창이 열리면 Microsoft 계정으로 로그인
4. 권한 승인
5. 로그인 성공!

---

## 🔍 문제 해결

### "AADSTS7000218: Invalid client secret" 오류

→ Client ID가 잘못 입력되었습니다. 다시 확인하세요.

### "AADSTS50011: Redirect URI mismatch" 오류

→ Azure Portal에서 리디렉션 URI를 `http://localhost:3000/auth/callback`로 정확히 설정했는지 확인하세요.

### "User does not own Minecraft" 오류

→ 해당 Microsoft 계정으로 마인크래프트를 구매하지 않았습니다. Java Edition 정품을 구매해야 합니다.

### 토큰 만료 문제

→ HyeniMC는 자동으로 토큰을 갱신합니다. 문제가 지속되면 계정을 삭제하고 다시 로그인하세요.

---

## 📚 참고 자료

- [Azure AD 앱 등록 문서](https://learn.microsoft.com/azure/active-directory/develop/quickstart-register-app)
- [Microsoft Identity Platform](https://learn.microsoft.com/azure/active-directory/develop/)
- [Minecraft Authentication](https://wiki.vg/Microsoft_Authentication_Scheme)

---

## 🔐 보안 주의사항

1. **Client ID는 공개해도 안전**합니다 (공개 클라이언트)
2. **Client Secret은 사용하지 않습니다** (네이티브 앱)
3. **Access Token과 Refresh Token**은 암호화되어 저장됩니다
4. 토큰은 로컬에만 저장되며 외부로 전송되지 않습니다

---

완료되었습니다! 이제 Microsoft 계정으로 멀티플레이를 즐기세요! 🎮
