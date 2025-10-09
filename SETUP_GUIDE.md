# 🚀 HyeniMC 설정 가이드

## ⚠️ Microsoft 로그인 설정 (필수)

현재 에러: `unauthorized_client: The client does not exist or is not enabled for consumers`

이 에러는 Azure AD 앱이 등록되지 않았거나 잘못 설정되었을 때 발생합니다.

---

## 📋 Azure AD 앱 등록 (5분 소요)

### 1단계: Azure Portal 접속

https://portal.azure.com 에 Microsoft 계정으로 로그인

### 2단계: Azure Active Directory로 이동

- 왼쪽 메뉴 또는 검색창에서 **"Azure Active Directory"** 검색

### 3단계: 앱 등록

1. 왼쪽 메뉴에서 **"앱 등록"** (App registrations) 클릭
2. 상단의 **"+ 새 등록"** (New registration) 클릭

### 4단계: 애플리케이션 정보 입력

#### 이름
```
HyeniMC
```

#### 지원되는 계정 유형 (중요!)
```
✅ 개인 Microsoft 계정만
   (Personal Microsoft accounts only)
```

**또는**

```
✅ 모든 조직 디렉터리의 계정 및 개인 Microsoft 계정
   (Accounts in any organizational directory and personal Microsoft accounts)
```

**주의**: "이 조직 디렉터리의 계정만" 선택 시 개인 계정 로그인 불가!

#### 리디렉션 URI
```
플랫폼: 공용 클라이언트/네이티브 (모바일 및 데스크톱)
URI: http://localhost:3000/auth/callback
```

### 5단계: 등록 완료

**"등록"** 버튼 클릭

---

## 🔑 Client ID 복사

등록 완료 후 **"개요"** 페이지에서:

```
애플리케이션 (클라이언트) ID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

이 값을 복사하세요!

---

## ⚙️ 추가 설정

### 인증 설정

1. 왼쪽 메뉴에서 **"인증"** (Authentication) 클릭
2. **고급 설정** 섹션:
   - ✅ **"공용 클라이언트 흐름 허용"** 활성화
   - ✅ **"모바일 및 데스크톱 애플리케이션"** 활성화
3. **저장** 클릭

### API 권한 (자동 추가됨)

기본적으로 다음 권한이 있어야 합니다:
- `XboxLive.signin`
- `offline_access`

추가가 필요하면:
1. 왼쪽 메뉴에서 **"API 권한"** 클릭
2. **"권한 추가"** → **"Microsoft APIs"** → **"Xbox Live"**
3. `XboxLive.signin` 선택 후 추가

---

## 💻 Client ID 설정

### ⭐ 로컬 설정 파일 사용 (권장)

**자동 설정 (macOS/Linux)**:

```bash
# 대화형 설정 스크립트 실행
./scripts/setup-auth.sh
```

스크립트가 자동으로:
1. `auth-config.ts` 파일 생성
2. Client ID 입력 받기
3. 파일에 자동으로 반영

**수동 설정 (Windows 또는 선호 시)**:

```bash
# 1. 설정 파일 복사
cd src/main/services
cp auth-config.example.ts auth-config.ts

# 2. 에디터로 auth-config.ts 열기
code auth-config.ts  # VS Code
```

`auth-config.ts` 파일에서:

```typescript
export const AUTH_CONFIG = {
  // Azure Portal에서 복사한 Client ID를 여기에 입력
  AZURE_CLIENT_ID: 'a1b2c3d4-e5f6-g7h8-i9j0-k1l2m3n4o5p6',  // ← 여기 수정
  
  REDIRECT_URI: 'http://localhost:3000/auth/callback',
};
```

**장점**: 
- ✅ **Git 안전**: `auth-config.ts`는 `.gitignore`에 포함되어 커밋 안 됨
- ✅ **빌드 자동**: 빌드 시 자동으로 포함됨
- ✅ **팀 협업**: 각 개발자가 자신의 Client ID 사용 가능
- ✅ **환경 변수 불필요**: 터미널 설정 없이 바로 동작

---

### 대체 방법: 환경 변수 (선택사항)

설정 파일 없이 환경 변수만으로도 가능:

**macOS/Linux**:
```bash
export AZURE_CLIENT_ID="여기에_Client_ID_붙여넣기"
```

**Windows (PowerShell)**:
```powershell
$env:AZURE_CLIENT_ID="여기에_Client_ID_붙여넣기"
```

---

## 🧪 테스트

1. 터미널 재시작 (환경 변수 적용)
2. HyeniMC 실행:
   ```bash
   npm run dev
   ```
3. 헤더에서 **"Microsoft 로그인"** 클릭
4. 로그인 창이 정상적으로 열리는지 확인

---

## ✅ 확인 사항

### 성공한 경우
- 로그인 창이 정상적으로 표시됨
- Microsoft 계정 입력 화면이 보임
- 로그인 후 자동으로 창이 닫힘

### 실패한 경우

#### `unauthorized_client` 에러
→ Client ID가 잘못되었거나 계정 유형이 "개인 Microsoft 계정"을 지원하지 않음

#### `redirect_uri_mismatch` 에러
→ Azure Portal에서 리디렉션 URI를 `http://localhost:3000/auth/callback`로 정확히 설정

#### 환경 변수가 적용되지 않음
→ 터미널 재시작 또는 개발 서버 재시작

---

## 🔒 보안 참고사항

- **Client ID는 공개해도 안전**합니다 (공개 클라이언트)
- **Client Secret은 사용하지 않습니다** (네이티브 앱)
- Access Token과 Refresh Token은 **AES-256-GCM 암호화**되어 로컬에 저장
- 토큰은 **외부로 전송되지 않습니다**

---

## 📞 문제 해결

### Q: Azure Portal 접근 권한이 없어요
A: 개인 Microsoft 계정 (Outlook, Hotmail 등)으로 로그인하면 무료로 사용 가능합니다.

### Q: "개인 Microsoft 계정만" 옵션이 없어요
A: "모든 조직 디렉터리의 계정 및 개인 Microsoft 계정" 선택하면 됩니다.

### Q: Client ID를 어디에 입력하나요?
A: 환경 변수로 설정합니다. 코드에 직접 입력하지 마세요!

### Q: 여전히 안 되는데요?
A:
1. 환경 변수가 제대로 설정되었는지 확인
   ```bash
   echo $AZURE_CLIENT_ID  # macOS/Linux
   echo %AZURE_CLIENT_ID%  # Windows
   ```
2. 개발 서버 재시작
3. Azure Portal 설정 재확인

---

## 📚 관련 문서

- [Microsoft Authentication Scheme](https://wiki.vg/Microsoft_Authentication_Scheme)
- [Azure AD 앱 등록](https://learn.microsoft.com/azure/active-directory/develop/quickstart-register-app)
- [MICROSOFT_AUTH_SETUP.md](./MICROSOFT_AUTH_SETUP.md) - 상세 가이드

---

## 🚀 배포 체크리스트

런처를 다른 사용자에게 배포하기 전:

- [ ] Azure AD 앱 등록 완료
- [ ] `src/main/services/auth-config.ts` 파일 생성 및 Client ID 입력
- [ ] 로컬에서 Microsoft 로그인 테스트 성공
- [ ] 빌드: `npm run build`
- [ ] 패키징: `npm run package` (electron-builder)
- [ ] 패키징된 앱에서 Microsoft 로그인 재테스트

**중요**: `auth-config.ts` 파일은 Git에 커밋되지 않으므로 빌드 서버에서도 별도로 생성해야 합니다!

---

완료되면 **헤더 → Microsoft 로그인**으로 정품 계정 로그인이 가능합니다! 🎮
