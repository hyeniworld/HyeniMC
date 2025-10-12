# CurseForge 프록시 배포 가이드

> **작성일**: 2025-10-12  
> **작성자**: HyeniMC Development Team  
> **목적**: CurseForge API 키를 안전하게 보호하기 위한 Cloudflare Workers 프록시 배포

---

## 📋 개요

HyeniMC 런처는 CurseForge API를 사용하여 모드를 검색/다운로드합니다. API 키를 클라이언트에 포함하면 탈취 위험이 있으므로, Cloudflare Workers를 이용한 프록시 서버를 구축하여 API 키를 서버에서만 관리합니다.

### 아키텍처
```
런처 클라이언트
    ↓
Cloudflare Workers (프록시)
    ↓ (API 키 추가)
CurseForge API
```

---

## ⚠️ 사전 준비

### 필요한 것들
- [ ] CurseForge 계정 (API 키 발급용)
- [ ] Cloudflare 계정 (Workers 배포용)
- [ ] Node.js 설치 (Wrangler CLI용)

### 예상 소요 시간
- **첫 배포**: 약 30분
- **업데이트**: 약 5분

### 비용
- **무료** (Cloudflare Workers Free Tier - 월 10만 요청)

---

## 🚀 배포 단계

### Step 1: CurseForge API 키 발급

#### 1.1 CurseForge Console 접속
1. 브라우저에서 https://console.curseforge.com/ 접속
2. CurseForge 계정으로 로그인
3. 계정이 없다면 "Sign Up" 클릭하여 회원가입

#### 1.2 API 키 생성
1. 좌측 메뉴에서 **"API Keys"** 클릭
2. **"Create API Key"** 버튼 클릭
3. Key Name 입력: `HyeniMC Launcher`
4. **Accept Terms** 체크박스 선택
5. **"Create"** 버튼 클릭

#### 1.3 API 키 복사
⚠️ **중요**: 생성된 API 키는 다시 볼 수 없으므로 반드시 안전한 곳에 복사하세요!

**API 키 형식 예시:**
```
$2a$10$abcdef1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ
```

---

### Step 2: Cloudflare 계정 생성

#### 2.1 회원가입
1. https://cloudflare.com 접속
2. **"Sign Up"** 클릭
3. 이메일 주소와 비밀번호 입력
4. 이메일 인증 완료

#### 2.2 Dashboard 확인
1. 로그인 후 Dashboard 접속
2. 좌측 메뉴에서 **"Workers & Pages"** 확인

---

### Step 3: Wrangler CLI 설치

터미널을 열고 다음 명령어를 실행하세요:

```bash
cd d:\git\HyeniMC\cloudflare-worker
npm install
```

**예상 출력:**
```
added 50 packages in 3s
```

---

### Step 4: Cloudflare 로그인

```bash
npx wrangler login
```

**동작:**
1. 브라우저가 자동으로 열림
2. Cloudflare 로그인 페이지 표시
3. **"Authorize Wrangler"** 버튼 클릭
4. "Success" 메시지 확인

**터미널 출력:**
```
Opening a link in your default browser...
✨ Successfully logged in!
```

---

### Step 5: KV Namespace 생성

KV Namespace는 Rate Limiting 데이터를 저장하는 키-값 저장소입니다.

```bash
npx wrangler kv:namespace create "RATE_LIMIT"
```

**예상 출력:**
```
✨ Success! Add the following to your configuration file:
kv_namespaces = [
  { binding = "RATE_LIMIT", id = "49ce1206ab5641d69ca96345b1650207" }
]
```

#### 5.1 ID 복사 및 설정

출력된 `id` 값을 복사하세요 (예: `49ce1206ab5641d69ca96345b1650207`)

**파일 수정**: `cloudflare-worker/wrangler.toml`

```toml
# Before
kv_namespaces = [
  { binding = "RATE_LIMIT", id = "rate_limit_namespace" }
]

# After (실제 ID로 교체)
kv_namespaces = [
  { binding = "RATE_LIMIT", id = "49ce1206ab5641d69ca96345b1650207" }
]
```

---

### Step 6: CurseForge API 키 등록

```bash
npx wrangler secret put CURSEFORGE_API_KEY
```

**프롬프트:**
```
Enter a secret value: █
```

**Step 1에서 복사한 CurseForge API 키를 붙여넣고 Enter**

⚠️ **주의**: 입력한 키는 화면에 표시되지 않습니다 (보안)

**예상 출력:**
```
✨ Success! Uploaded secret CURSEFORGE_API_KEY
```

---

### Step 7: 프록시 배포

```bash
npx wrangler deploy
```

또는 (구버전):
```bash
npx wrangler publish
```

**예상 출력:**
```
Total Upload: 2.59 KiB / gzip: 0.96 KiB
Your worker has access to the following bindings:
- KV Namespaces:
  - RATE_LIMIT: 49ce1206ab5641d69ca96345b1650207
Uploaded hyenimc-curseforge-proxy (3.39 sec)
Deployed hyenimc-curseforge-proxy triggers (1.19 sec)
  https://hyenimc-curseforge-proxy.YOUR_USERNAME.workers.dev
Current Version ID: ff0ed90d-4b65-4c0b-bb6b-951fdc90c0d7
```

#### ⭐ Workers URL 복사

출력된 URL을 복사하세요:
```
https://hyenimc-curseforge-proxy.YOUR_USERNAME.workers.dev
```

**예시 (실제 배포):**
```
https://hyenimc-curseforge-proxy.devbug.workers.dev
```

---

### Step 8: 런처에 프록시 URL 설정

#### 8.1 파일 수정

**파일**: `d:\git\HyeniMC\src\main\services\curseforge-api.ts`

**13번째 줄 수정:**

```typescript
// Before
const PROXY_URL = process.env.CURSEFORGE_PROXY_URL || 'https://hyenimc-curseforge-proxy.YOUR_USERNAME.workers.dev';

// After (Step 7에서 복사한 실제 URL로 교체)
const PROXY_URL = process.env.CURSEFORGE_PROXY_URL || 'https://hyenimc-curseforge-proxy.devbug.workers.dev';
```

---

### Step 9: 런처 빌드

```bash
cd d:\git\HyeniMC
npm run build
```

**예상 출력:**
```
✓ 1400 modules transformed.
dist/renderer/index.html                   0.41 kB
dist/renderer/assets/index-DqWjiKtJ.css   39.59 kB
dist/renderer/assets/index-BzXvmyOl.js   304.98 kB
✓ built in 2s
```

---

### Step 10: 프록시 테스트

#### 10.1 브라우저 테스트

배포된 Workers URL을 브라우저에서 열어보세요:

```
https://hyenimc-curseforge-proxy.YOUR_USERNAME.workers.dev/mods/search?gameId=432&searchFilter=sodium
```

**성공 시:**
```json
{
  "data": [
    {
      "id": 394468,
      "name": "Sodium",
      "slug": "sodium",
      "summary": "Modern rendering engine...",
      ...
    }
  ],
  "pagination": {
    "totalCount": 150
  }
}
```

**실패 시:**
```json
{
  "error": "Proxy error",
  "message": "..."
}
```

#### 10.2 Rate Limit 테스트

같은 URL을 100번 이상 연속 호출하면:

```json
{
  "error": "Rate limit exceeded",
  "message": "Too many requests. Please try again later.",
  "retryAfter": 3600
}
```

---

### Step 11: 런처에서 테스트

```bash
npm run dev
```

**런처에서:**
1. 프로필 상세 페이지 열기
2. "모드 추가" 버튼 클릭
3. 소스 선택: **"CurseForge"**
4. 검색: "Sodium"
5. 결과 확인

**예상 콘솔 출력:**
```
[CurseForge] Using proxy server: https://hyenimc-curseforge-proxy.devbug.workers.dev
[CurseForge] Searching mods: "sodium"
[CurseForge] Found 15 mods
```

---

## 📊 모니터링

### Cloudflare Dashboard

1. https://dash.cloudflare.com/ 접속
2. "Workers & Pages" 메뉴 클릭
3. `hyenimc-curseforge-proxy` 클릭

**확인 가능한 정보:**
- ✅ 요청 수 (시간당/일일)
- ✅ 성공/실패율
- ✅ CPU 시간
- ✅ 에러 로그

### 실시간 로그 보기

```bash
cd d:\git\HyeniMC\cloudflare-worker
npx wrangler tail
```

**출력 예시:**
```
[Proxy] GET /mods/search?gameId=432&searchFilter=sodium (client: abc-123-def)
[Proxy] Rate limit: 15/100
```

---

## 🔧 업데이트

### 프록시 코드 수정 후

```bash
cd d:\git\HyeniMC\cloudflare-worker
npx wrangler deploy
```

### API 키 재설정

```bash
npx wrangler secret put CURSEFORGE_API_KEY
```

---

## 🐛 트러블슈팅

### 문제 1: "KV Namespace not found"

**원인**: `wrangler.toml`의 KV ID가 잘못됨

**해결:**
```bash
# KV ID 확인
npx wrangler kv:namespace list

# wrangler.toml에 올바른 ID 입력
```

---

### 문제 2: "Secret not found"

**원인**: API 키가 등록되지 않음

**해결:**
```bash
npx wrangler secret put CURSEFORGE_API_KEY
# API 키 다시 입력
```

---

### 문제 3: "401 Unauthorized"

**원인**: CurseForge API 키가 잘못되었거나 만료됨

**해결:**
1. CurseForge Console에서 API 키 확인
2. 새 API 키 생성
3. `wrangler secret put` 재실행

---

### 문제 4: "CORS error"

**원인**: CORS 헤더 설정 누락

**해결:**
- `src/index.js`의 CORS 헤더 확인
- 브라우저 개발자 도구에서 에러 확인

---

### 문제 5: "Rate limit exceeded" (즉시 발생)

**원인**: Rate Limit 설정이 너무 낮음

**해결:**
- `src/index.js`에서 `RATE_LIMIT_PER_HOUR` 값 조정 (기본: 100)

---

## 💰 비용 예측

### Cloudflare Workers 무료 플랜
- **100,000 요청/일** (무료)
- **10ms CPU/요청**
- **KV 읽기**: 100,000/일 (무료)
- **KV 쓰기**: 1,000/일 (무료)

### 예상 사용량
- 사용자: 1,000명
- 평균 검색: 50회/사용자/월
- **= 50,000 요청/월**
- **= 약 1,667 요청/일**

**결론**: 완전 무료! 🎉

---

## 📝 체크리스트

### 배포 완료 확인
- [ ] CurseForge API 키 발급 완료
- [ ] Cloudflare 계정 생성 완료
- [ ] Wrangler 로그인 완료
- [ ] KV Namespace 생성 및 ID 반영
- [ ] API 키 시크릿 등록 완료
- [ ] Workers 배포 완료
- [ ] Workers URL 확인
- [ ] `curseforge-api.ts`에 URL 설정
- [ ] 런처 빌드 완료
- [ ] 브라우저 테스트 성공
- [ ] 런처 테스트 성공

### 보안 확인
- [ ] API 키가 코드에 하드코딩되지 않음
- [ ] API 키가 Git에 커밋되지 않음
- [ ] Rate Limiting 작동 확인
- [ ] CORS 헤더 설정 확인

---

## 📞 문의

문제가 계속되면:
- [Cloudflare Workers 문서](https://developers.cloudflare.com/workers/)
- [CurseForge API 문서](https://docs.curseforge.com/)
- [Wrangler CLI 문서](https://developers.cloudflare.com/workers/wrangler/)

---

## 🎉 완료!

프록시 배포가 완료되었습니다! 이제 런처에서 CurseForge 모드를 안전하게 검색할 수 있습니다.
