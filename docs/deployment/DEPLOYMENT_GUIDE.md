# HyeniMC Worker 배포 가이드

HyeniMC Worker는 CurseForge API 프록시와 모드 배포 (R2) 기능을 제공하는 통합 Worker입니다.

## 📋 사전 준비

### 1. CurseForge API 키 발급

1. [CurseForge Console](https://console.curseforge.com/)에 접속
2. "API Keys" 메뉴로 이동
3. "Create API Key" 클릭
4. 키 이름 입력 (예: HyeniMC Launcher)
5. 발급된 API 키 복사 (다시 볼 수 없으니 안전하게 보관!)

### 2. Cloudflare 계정 생성

1. [Cloudflare](https://cloudflare.com) 가입
2. Workers & Pages 메뉴로 이동
3. 무료 플랜 확인 (월 10만 요청 무료)

## 🚀 배포 단계

### Step 1: Wrangler CLI 설치

```bash
cd d:\git\HyeniMC\cloudflare-worker
npm install
```

전역 설치 (선택):
```bash
npm install -g wrangler
```

### Step 2: Cloudflare 로그인

```bash
npx wrangler login
```

브라우저가 열리면 Cloudflare 계정으로 로그인 승인

### Step 3: KV Namespace 생성

```bash
npx wrangler kv:namespace create "RATE_LIMIT"
```

출력 예시:
```
✨ Success! Add the following to your configuration file:
kv_namespaces = [
  { binding = "RATE_LIMIT", id = "abc123...xyz789" }
]
```

**중요**: 출력된 ID를 `wrangler.toml` 파일의 `kv_namespaces`에 업데이트하세요!

```toml
# wrangler.toml
kv_namespaces = [
  { binding = "RATE_LIMIT", id = "여기에_실제_ID_입력" }
]
```

### Step 4: API 키 등록

```bash
npx wrangler secret put CURSEFORGE_API_KEY
```

프롬프트가 나타나면 Step 1에서 복사한 CurseForge API 키 입력 후 Enter

### Step 5: 배포

```bash
npx wrangler publish
```

배포 완료! 출력에서 Workers URL 확인:
```
✨  Success! Uploaded 1 module.
✨ Deployment complete! Your worker is available at:
   https://hyenimc-worker.your-account.workers.dev
```

## 🔧 런처 설정

### Step 6: 프록시 URL 설정

배포된 Workers URL을 런처에 설정합니다:

**환경 변수 사용 (권장)**

1. `.env.example`을 `.env`로 복사:
```bash
cp .env.example .env
```

2. `.env` 파일에 실제 설정값 입력:
```bash
# .env
HYENIMC_WORKER_URL=https://hyenimc-worker.your-account.workers.dev
AZURE_CLIENT_ID=your-azure-client-id
AUTHORIZED_SERVER_DOMAINS=*.hyeniworld.com,*.example.net
```

⚠️ **보안**: `.env` 파일은 `.gitignore`에 포함되어 GitHub에 커밋되지 않습니다.

### Step 7: 빌드 및 테스트

```bash
npm run build
npm run dev
```

런처에서 CurseForge 모드 검색 테스트!

## 📊 모니터링

### Workers 대시보드

1. [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Workers & Pages 메뉴
3. `hyenimc-worker` 클릭

확인 가능한 정보:
- ✅ 요청 수 (시간당/일일)
- ✅ CPU 시간
- ✅ 에러 발생률
- ✅ 로그

### 로그 실시간 확인

```bash
npx wrangler tail
```

## 🔐 보안 체크리스트

- [x] API 키를 환경변수로 관리
- [x] Rate Limiting 설정 (시간당 100요청/클라이언트)
- [x] CORS 헤더 설정
- [x] 런처 ID 기반 추적
- [ ] (선택) Custom 도메인 설정
- [ ] (선택) IP 기반 추가 제한

## 💰 비용 예측

### Cloudflare Workers 무료 플랜
- **100,000 요청/일** (무료)
- **10ms CPU/요청**

### 예상 사용량
- 사용자 1,000명
- 평균 50요청/사용자/월
- **= 50,000 요청/월**

**결론: 무료! 🎉**

## 🐛 트러블슈팅

### 문제: KV Namespace 오류

```
Error: KV Namespace not found
```

**해결**: `wrangler.toml`의 KV namespace ID 확인

### 문제: API 키 오류

```
Error: x-api-key header is required
```

**해결**:
```bash
# 시크릿 재설정
npx wrangler secret put CURSEFORGE_API_KEY
```

### 문제: Rate Limit 즉시 발생

```
429 Rate limit exceeded
```

**해결**: `src/index.js`에서 `RATE_LIMIT_PER_HOUR` 값 조정

### 문제: 프록시 연결 실패

**확인사항**:
1. Workers URL이 올바른지 확인
2. CORS 헤더가 설정되어 있는지 확인
3. 브라우저 개발자 도구 네트워크 탭에서 에러 확인

## 🔄 업데이트

프록시 서버 코드 수정 후:

```bash
npx wrangler publish
```

## 📞 문의

문제가 계속되면:
1. [Cloudflare Workers 문서](https://developers.cloudflare.com/workers/)
2. [CurseForge API 문서](https://docs.curseforge.com/)
