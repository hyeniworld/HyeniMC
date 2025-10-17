# Worker 마이그레이션 가이드

## 개요

`hyenimc-curseforge-proxy` → `hyenimc-worker`로 통합되었습니다.

### 변경 사항
- **이전**: CurseForge API 프록시만 제공
- **현재**: CurseForge API 프록시 + R2 모드 배포 통합

## 마이그레이션 단계

### 1. 새 Worker 확인

현재 `hyenimc-worker`가 정상 작동 중인지 확인:

```bash
# Cloudflare Dashboard에서 확인
# https://dash.cloudflare.com/ > Workers & Pages > hyenimc-worker

# 또는 브라우저에서 테스트
https://hyenimc-worker.YOUR_ACCOUNT.workers.dev/health
```

**예상 응답:**
```json
{
  "status": "ok",
  "timestamp": 1697356800000,
  "services": {
    "curseforge": "proxy",
    "releases": "enabled"
  }
}
```

### 2. 런처 설정 업데이트

`.env` 파일에서 Worker URL 변경:

```bash
# Before
CURSEFORGE_PROXY_URL=HYENIMC_CURSEFORGE_WORKER_URL

# After
CURSEFORGE_PROXY_URL=HYENIMC_WORKER_URL
```

### 3. 런처 테스트

```bash
npm run dev
```

런처에서 다음 기능 테스트:
- ✅ CurseForge 모드 검색
- ✅ 모드 다운로드
- ✅ (있다면) 커스텀 모드 다운로드

### 4. 구 Worker 삭제

새 Worker가 정상 작동하면 구 Worker 삭제:

```bash
# Cloudflare Dashboard에서 삭제
# https://dash.cloudflare.com/ > Workers & Pages > hyenimc-curseforge-proxy
# Settings > Delete Worker
```

또는 CLI로 삭제:

```bash
wrangler delete hyenimc-curseforge-proxy
```

## 비용 절감 효과

### Before (2개 Worker)
- `hyenimc-curseforge-proxy`: ~50,000 요청/월
- `hyenimc-worker`: ~10,000 요청/월 (R2만)
- **합계**: 60,000 요청/월

### After (1개 Worker)
- `hyenimc-worker`: ~60,000 요청/월
- **절감**: Worker 1개 관리 부담 감소

## 주의사항

⚠️ **구 Worker 삭제 전 확인사항:**

1. 모든 사용자가 새 런처 버전으로 업데이트했는지 확인
2. 새 Worker가 최소 1주일 이상 안정적으로 작동했는지 확인
3. 모니터링 대시보드에서 에러율 확인

## 롤백 방법

문제 발생 시 구 Worker로 롤백:

```bash
# .env 파일 수정
CURSEFORGE_PROXY_URL=HYENIMC_CURSEFORGE_WORKER_URL

# 런처 재시작
```

## FAQ

### Q: 두 Worker를 동시에 운영해도 되나요?
A: 가능하지만 권장하지 않습니다. 관리 부담이 증가하고 혼란을 야기할 수 있습니다.

### Q: 구 Worker를 언제 삭제해야 하나요?
A: 모든 사용자가 새 버전으로 업데이트한 후 최소 1주일 후 삭제하세요.

### Q: Worker URL이 GitHub에 공개되어도 괜찮나요?
A: 아니요. 환경 변수(`.env`)를 사용하여 URL을 관리하세요. `.env` 파일은 `.gitignore`에 포함되어 있습니다.

### Q: 비용이 증가하나요?
A: 아니요. 오히려 Worker 관리 부담이 줄어듭니다. Cloudflare Workers 무료 플랜(월 10만 요청)으로 충분합니다.
