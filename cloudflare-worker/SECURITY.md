# 보안 가이드

## GitHub 공개 시 주의사항

### ✅ 안전하게 공개 가능한 항목

- **Worker 코드** (`src/index.js`)
- **설정 파일** (`wrangler.toml`)
- **문서** (README, 가이드 등)
- **패키지 정보** (`package.json`)

### ❌ 절대 공개하면 안 되는 항목

1. **실제 Worker URL**
   - `https://hyenimc-worker.YOUR_ACCOUNT.workers.dev`
   - 런처 코드에 하드코딩 금지
   - 환경 변수(`.env`)로 관리

2. **API 키 및 시크릿**
   - `CURSEFORGE_API_KEY`
   - `TOKEN_CHECK_API_URL`
   - Cloudflare Secret으로 관리

3. **환경 변수 파일**
   - `.env` (로컬 개발용)
   - `.dev.vars` (Worker 로컬 테스트용)

## 보안 체크리스트

### Worker 배포 전

- [ ] `wrangler.toml`에 실제 API 키가 없는지 확인
- [ ] 모든 시크릿이 `wrangler secret` 명령어로 등록되었는지 확인
- [ ] `.gitignore`에 `.env`, `.dev.vars` 포함 확인

### 런처 코드

- [ ] `curseforge-api.ts`에 실제 Worker URL이 하드코딩되지 않았는지 확인
- [ ] `.env.example` 파일에 플레이스홀더만 있는지 확인
- [ ] `.env` 파일이 `.gitignore`에 포함되었는지 확인

### GitHub 커밋 전

```bash
# 민감한 정보가 포함되지 않았는지 확인
git diff

# .env 파일이 추적되지 않는지 확인
git status

# .gitignore가 제대로 작동하는지 확인
git check-ignore .env .dev.vars
```

## 환경 변수 관리

### 로컬 개발 (런처)

```bash
# .env 파일 생성
cp .env.example .env

# 실제 값 입력
CURSEFORGE_PROXY_URL=https://hyenimc-worker.YOUR_ACCOUNT.workers.dev
```

### Worker 배포

```bash
# Cloudflare Secret 등록
wrangler secret put CURSEFORGE_API_KEY
wrangler secret put TOKEN_CHECK_API_URL
```

### 로컬 Worker 테스트

```bash
# .dev.vars 파일 생성 (cloudflare-worker 디렉토리)
cat > .dev.vars << EOF
CURSEFORGE_API_KEY=your_key_here
TOKEN_CHECK_API_URL=https://your-api.example.com/check
EOF

# 로컬 실행
wrangler dev
```

## 보안 모범 사례

### 1. Worker URL 보호

**나쁜 예:**
```typescript
// ❌ 하드코딩 (GitHub에 노출됨)
const PROXY_URL = 'HYENIMC_WORKER_URL';
```

**좋은 예:**
```typescript
// ✅ 환경 변수 사용
const PROXY_URL = process.env.CURSEFORGE_PROXY_URL || 'https://YOUR_WORKER_URL.workers.dev';
```

### 2. API 키 관리

**나쁜 예:**
```toml
# ❌ wrangler.toml에 직접 입력
[vars]
CURSEFORGE_API_KEY = "$2a$10$abc123..."
```

**좋은 예:**
```bash
# ✅ Wrangler Secret 사용
wrangler secret put CURSEFORGE_API_KEY
```

### 3. 토큰 검증 API

**나쁜 예:**
```javascript
// ❌ 코드에 하드코딩
const TOKEN_API = 'https://api.example.com/check';
```

**좋은 예:**
```javascript
// ✅ 환경 변수 사용
const TOKEN_API = env.TOKEN_CHECK_API_URL;
```

## 침해 사고 대응

### Worker URL이 노출된 경우

1. **즉시 조치**
   ```bash
   # 새 Worker 배포 (다른 이름으로)
   # wrangler.toml 수정
   name = "hyenimc-worker-v2"
   
   wrangler deploy
   ```

2. **런처 업데이트**
   - `.env` 파일에 새 URL 입력
   - 사용자에게 업데이트 배포

3. **구 Worker 삭제**
   ```bash
   wrangler delete hyenimc-worker
   ```

### API 키가 노출된 경우

1. **CurseForge Console에서 즉시 키 삭제**
2. **새 API 키 발급**
3. **Worker에 새 키 등록**
   ```bash
   wrangler secret put CURSEFORGE_API_KEY
   ```
4. **Worker 재배포**
   ```bash
   wrangler deploy
   ```

## 모니터링

### 비정상 트래픽 감지

Cloudflare Dashboard에서 확인:
- 급격한 요청 증가
- 비정상적인 에러율
- 알 수 없는 클라이언트 ID

### Rate Limiting 로그

```bash
# 실시간 로그 확인
wrangler tail

# Rate limit 초과 패턴 확인
# [Proxy] Rate limit: 100/100 (client: xxx)
```

## 참고 자료

- [Cloudflare Workers Security](https://developers.cloudflare.com/workers/platform/security/)
- [Wrangler Secrets](https://developers.cloudflare.com/workers/wrangler/commands/#secret)
- [Environment Variables Best Practices](https://12factor.net/config)
