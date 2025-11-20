# 토큰 기반 동적 모드팩 시스템

**작성일:** 2025년 11월 20일  
**버전:** 1.0  
**상태:** 설계 중

---

## 📋 개요

사용자의 Discord 토큰, 서버 주소, 마인크래프트 환경 정보를 기반으로 서버가 동적으로 적절한 모드팩을 결정하고 제공하는 시스템.

### 핵심 아이디어
- 런처에서 토큰 + 서버 주소 + 환경 정보를 전송
- 서버가 사용자/서버/역할에 따라 적절한 모드팩 결정
- 런처가 Manifest를 다운로드하여 자동 동기화
- 서버 측에서 중앙 관리 (런처 재배포 불필요)

---

## 🏗️ 시스템 아키텍처

```
┌─────────────┐
│   런처      │
│             │
│ • Token     │
│ • Server    │
│ • MC Ver    │
│ • Loader    │
└──────┬──────┘
       │ POST /api/v2/modpacks/resolve
       ↓
┌─────────────────────────┐
│  Cloudflare Worker      │
│                         │
│  1. 토큰 검증           │
│  2. 사용자 모드팩 조회   │
│  3. 서버별 모드팩 조회   │
│  4. 기본 모드팩 폴백     │
└──────┬──────────────────┘
       │ 응답: { modpackId, manifestUrl }
       ↓
┌─────────────┐
│   런처      │
│             │
│ 1. Manifest │
│    다운로드 │
│ 2. Diff     │
│ 3. 동기화   │
└─────────────┘
```

---

## 🔄 요청/응답 상세

### A. 런처 → 서버 요청

**Endpoint:** `POST /api/v2/modpacks/resolve`

```json
{
  "token": "discord_token_abc123...",
  "serverAddress": "hyeni.world",
  "minecraft": {
    "version": "1.21.1",
    "loaderType": "neoforge",
    "loaderVersion": "21.1.77"
  },
  "timestamp": "2025-11-20T15:00:00Z",
  "launcherVersion": "0.3.0"
}
```

### B. 서버 → 런처 응답

**성공 (200):**
```json
{
  "modpackId": "hyenipack-hyeniworld",
  "modpackName": "혜니팩 (혜니월드)",
  "modpackVersion": "1.1.0",
  "manifestUrl": "/api/v2/modpacks/hyenipack-hyeniworld/manifests/1.1.0.json",
  "updateRequired": true,
  "message": "새로운 모드 업데이트가 있습니다."
}
```

**모드팩 없음 (200):**
```json
{
  "modpackId": null,
  "message": "No modpack assigned"
}
```

**호환성 오류 (400):**
```json
{
  "error": "Incompatible",
  "message": "This modpack requires Minecraft 1.21.1 with neoforge",
  "required": {
    "minecraftVersion": "1.21.1",
    "loaderType": "neoforge"
  }
}
```

**인증 오류 (401):**
```json
{
  "error": "Invalid token"
}
```

---

## 🗄️ 데이터베이스 설계

### Cloudflare D1 스키마

```sql
-- 모드팩 정의
CREATE TABLE modpacks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  current_version TEXT NOT NULL,
  minecraft_version TEXT NOT NULL,
  loader_type TEXT NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 서버별 기본 모드팩
CREATE TABLE server_modpacks (
  server_address TEXT NOT NULL,
  modpack_id TEXT NOT NULL,
  priority INTEGER DEFAULT 1,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (server_address, modpack_id),
  FOREIGN KEY (modpack_id) REFERENCES modpacks(id)
);

-- 사용자별 모드팩 오버라이드
CREATE TABLE user_modpacks (
  discord_user_id TEXT PRIMARY KEY,
  modpack_id TEXT NOT NULL,
  assigned_by TEXT,
  reason TEXT,
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (modpack_id) REFERENCES modpacks(id)
);

-- 전역 설정
CREATE TABLE global_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 로그 (분석용)
CREATE TABLE modpack_resolutions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_user_id TEXT,
  server_address TEXT,
  modpack_id TEXT,
  minecraft_version TEXT,
  launcher_version TEXT,
  resolved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 인덱스
CREATE INDEX idx_server_modpacks_active ON server_modpacks(active, priority);
CREATE INDEX idx_user_modpacks_expires ON user_modpacks(expires_at);
CREATE INDEX idx_resolutions_user ON modpack_resolutions(discord_user_id, resolved_at);
```

---

## 🔍 모드팩 결정 로직

### 우선순위 체계

```
1. 사용자 전용 모드팩 (user_modpacks)
   └─ 만료되지 않은 할당만

2. 서버별 기본 모드팩 (server_modpacks)
   └─ priority 낮을수록 우선

3. 전역 기본 모드팩 (global_settings)
   └─ key='default_modpack_id'

4. 없음 (모드팩 없이 실행)
```

### Cloudflare Worker 구현

```javascript
async function resolveModpack(request, env) {
  const body = await request.json();
  const { token, serverAddress, minecraft } = body;
  
  // 1. 토큰 검증 (기존 API 활용)
  const user = await validateToken(token, env.TOKEN_CHECK_API);
  if (!user) {
    return errorResponse(401, 'Invalid token');
  }
  
  // 2. 사용자 전용 모드팩
  const userModpack = await env.DB.prepare(`
    SELECT modpack_id FROM user_modpacks 
    WHERE discord_user_id = ? 
    AND (expires_at IS NULL OR expires_at > datetime("now"))
  `).bind(user.discordId).first();
  
  if (userModpack) {
    return buildResponse(userModpack.modpack_id, minecraft, env);
  }
  
  // 3. 서버별 모드팩
  const normalized = serverAddress.toLowerCase().split(':')[0];
  const serverModpack = await env.DB.prepare(`
    SELECT modpack_id FROM server_modpacks 
    WHERE LOWER(server_address) = ? AND active = 1 
    ORDER BY priority LIMIT 1
  `).bind(normalized).first();
  
  if (serverModpack) {
    return buildResponse(serverModpack.modpack_id, minecraft, env);
  }
  
  // 4. 전역 기본
  const defaultId = await env.KV.get('default_modpack_id');
  if (defaultId) {
    return buildResponse(defaultId, minecraft, env);
  }
  
  // 5. 없음
  return new Response(JSON.stringify({ modpackId: null }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
```

---

## 🎛️ 관리 방안

### 옵션 1: Discord Bot (추천)

**장점:**
- 사용자 친화적
- 즉각적인 피드백
- 권한 관리 용이

**주요 명령어:**
```
/modpack assign @사용자 [모드팩ID] [기간] [사유]
/modpack remove @사용자
/modpack info [@사용자]
/modpack list
/modpack server [서버주소] [모드팩ID]
```

**예시:**
```
관리자: /modpack assign @Yuri hyenipack-test 7d "베타 테스터"
봇: ✅ Yuri에게 hyenipack-test 모드팩을 7일간 할당했습니다.

사용자: /modpack info
봇: 📦 현재 모드팩: hyenipack-test (v1.2.0-beta)
    만료: 2025-11-27
    사유: 베타 테스터
```

### 옵션 2: 웹 대시보드

**장점:**
- 시각적 관리
- 통계 및 분석
- 벌크 작업 용이

**기능:**
- 모드팩 목록 관리
- 사용자별 할당 현황
- 서버별 설정
- 사용 통계 (접속자 수, 버전 분포)

### 옵션 3: CLI 도구

**장점:**
- 자동화 스크립트 작성 가능
- 배치 작업

**예시:**
```bash
hyenimc-modpack assign Yuri hyenipack-test --duration 7d
hyenimc-modpack server add test.hyeni.world hyenipack-test
hyenimc-modpack stats
```

---

## 🔗 기존 시스템 통합

### 토큰 검증 API 활용

```javascript
async function validateToken(token, apiUrl) {
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token })
  });
  
  if (!response.ok) return null;
  
  const data = await response.json();
  return {
    discordId: data.discord_user_id,
    username: data.username,
    roles: data.roles || []
  };
}
```

### 런처 구현

```typescript
// src/main/services/modpack-sync-service.ts

async syncModpack(profileId: string): Promise<SyncResult> {
  // 1. 토큰 가져오기 (기존 구현 활용)
  const instanceDir = getProfileInstanceDir(profileId);
  const token = await this.getUserToken(instanceDir);
  
  if (!token) {
    return { success: true, upToDate: true, noToken: true };
  }
  
  // 2. 서버 주소 가져오기
  const serverAddress = await this.getServerAddress(instanceDir);
  
  // 3. 모드팩 해석 요청
  const resolution = await this.resolveModpack({
    token,
    serverAddress,
    minecraft: {
      version: profile.gameVersion,
      loaderType: profile.loaderType,
      loaderVersion: profile.loaderVersion
    }
  });
  
  if (!resolution.modpackId) {
    return { success: true, upToDate: true, noModpack: true };
  }
  
  // 4. Manifest 다운로드 및 동기화
  const manifest = await this.fetchManifest(resolution.manifestUrl);
  const diff = await this.calculateDiff(instanceDir, manifest);
  
  if (this.hasChanges(diff)) {
    await this.applyChanges(profileId, instanceDir, diff);
  }
  
  return { success: true, updated: true };
}

private async getUserToken(instanceDir: string): Promise<string | null> {
  const configPath = path.join(instanceDir, 'config', 'hyenihelper-config.json');
  
  if (!await fs.pathExists(configPath)) {
    return null;
  }
  
  const config = await fs.readJSON(configPath);
  return config.token || null;
}

private async getServerAddress(instanceDir: string): Promise<string | null> {
  const serversDatPath = path.join(instanceDir, 'servers.dat');
  
  if (!await fs.pathExists(serversDatPath)) {
    return null;
  }
  
  const data = await fs.readFile(serversDatPath);
  const parsed = await nbt.parse(data);
  const servers = parsed?.parsed?.value?.servers?.value?.value || [];
  
  // 첫 번째 서버 주소 반환
  if (servers.length > 0) {
    return servers[0]?.ip?.value || null;
  }
  
  return null;
}
```

---

## 📊 사용 시나리오

### 시나리오 1: 일반 사용자

```
Yuri가 혜니월드 접속
  ↓
런처: 게임 시작 전 동기화
  - Token: (config에서 읽음)
  - Server: hyeni.world (servers.dat)
  ↓
Worker: 
  - user_modpacks 조회 → 없음
  - server_modpacks 조회 → hyenipack-hyeniworld
  ↓
응답: { modpackId: "hyenipack-hyeniworld", version: "1.0.0" }
  ↓
런처:
  - 현재 버전: 1.0.0
  - 최신 버전: 1.0.0
  - 결과: 동기화 불필요
  ↓
게임 시작
```

### 시나리오 2: 베타 테스터

```
관리자: /modpack assign @Yuri hyenipack-test 7d "베타 테스터"
  ↓
D1: user_modpacks에 저장
  ↓
Yuri가 혜니월드 접속
  ↓
Worker:
  - user_modpacks 조회 → hyenipack-test (우선순위!)
  ↓
응답: { modpackId: "hyenipack-test", version: "1.2.0-beta" }
  ↓
런처:
  - 현재: hyenipack-hyeniworld 1.0.0
  - 최신: hyenipack-test 1.2.0-beta
  - Diff: 추가 3개, 업데이트 2개
  ↓
UI: "베타 모드팩으로 전환됩니다. 5개 모드 변경..."
  ↓
동기화 완료 → 게임 시작
```

### 시나리오 3: 새 서버 추가

```
관리자: 
  1. R2에 hyenipack-creative 업로드
  2. /modpack server creative.hyeni.world hyenipack-creative
  ↓
D1: server_modpacks 저장
  ↓
모든 사용자가 creative.hyeni.world 접속 시
  → 자동으로 hyenipack-creative 적용
  → 런처 재배포 없이 즉시 반영!
```

---

## 🚀 구현 단계

### Phase 1: 서버 인프라 (1주)

1. **D1 데이터베이스 생성**
   ```bash
   wrangler d1 create hyenimc-modpacks
   wrangler d1 execute hyenimc-modpacks --file=schema.sql
   ```

2. **Cloudflare Worker API 구현**
   - `/api/v2/modpacks/resolve` 엔드포인트
   - 토큰 검증 연동
   - 모드팩 결정 로직

3. **초기 데이터 입력**
   - 기본 모드팩 등록
   - 서버별 매핑 설정

### Phase 2: 관리 도구 (1주)

**옵션 A - Discord Bot:**
- `/modpack` 명령어 구현
- 관리자 권한 확인
- D1 CRUD 작업

**옵션 B - 웹 대시보드:**
- 관리자 인증
- 모드팩 관리 UI
- 통계 대시보드

### Phase 3: 런처 통합 (1주)

1. **ModpackSyncService 구현**
   - 토큰/서버 주소 가져오기
   - `/resolve` API 호출
   - Manifest 다운로드

2. **동기화 로직**
   - Diff 계산
   - 모드 추가/제거/업데이트
   - 에러 처리 (hyenipack-importer 재사용)

3. **UI 통합**
   - 진행률 표시
   - 사용자 알림
   - 에러 안내

### Phase 4: 테스트 (3일)

1. **기능 테스트**
   - 일반 사용자 시나리오
   - 베타 테스터 시나리오
   - 서버 전환 시나리오

2. **에러 케이스**
   - 토큰 없음
   - 네트워크 오류
   - 호환성 오류

3. **성능 테스트**
   - 동시 요청 처리
   - 응답 시간

### Phase 5: 배포 (1주)

1. **소규모 베타**
   - 테스트 서버에서 시작
   - 3-5명 베타 테스터

2. **점진적 롤아웃**
   - 10% → 50% → 100%
   - 모니터링 및 피드백 수집

3. **문서화**
   - 사용자 가이드
   - 관리자 가이드
   - 트러블슈팅

---

## ⚠️ 고려사항

### 기존 토큰 API와의 통합

**현재 상황:**
- 토큰 발급 API 서버 이미 존재
- Cloudflare Worker에서 해당 API 호출 필요

**통합 방안:**
```javascript
// wrangler.toml
[vars]
TOKEN_CHECK_API = "https://your-api.com/validate"

// worker
async function validateToken(token, apiUrl) {
  const response = await fetch(apiUrl, {
    method: 'POST',
    body: JSON.stringify({ token })
  });
  return response.ok ? await response.json() : null;
}
```

### 보안

1. **토큰 전송**: HTTPS 필수
2. **관리자 API**: Bearer Token 인증
3. **Rate Limiting**: Cloudflare 기본 기능 활용
4. **민감 정보 로깅 금지**

### 성능

1. **캐싱**: 
   - Manifest: 5분 캐시
   - Server Registry: 런처 세션 동안 캐시

2. **D1 쿼리 최적화**:
   - 인덱스 활용
   - 단일 쿼리로 결과 도출

3. **응답 시간**:
   - 목표: < 500ms
   - 토큰 검증 포함

---

## 📈 확장 가능성

### 역할 기반 모드팩

```sql
CREATE TABLE role_modpacks (
  discord_role_id TEXT NOT NULL,
  modpack_id TEXT NOT NULL,
  priority INTEGER DEFAULT 10,
  PRIMARY KEY (discord_role_id, modpack_id)
);
```

```javascript
// 우선순위 확장:
// 1. 사용자 전용
// 2. 역할 기반 ← 추가
// 3. 서버별
// 4. 전역
```

### 조건부 규칙

```yaml
rules:
  - condition:
      time_range: "00:00-06:00"
    action:
      modpack_id: "hyenipack-light"
  
  - condition:
      user_count: "> 100"
    action:
      modpack_id: "hyenipack-optimized"
```

### A/B 테스팅

```javascript
// 특정 비율의 사용자에게 다른 모드팩
if (Math.random() < 0.1) {
  return "hyenipack-experimental";
}
```

---

## 💰 비용 예상 (Cloudflare)

- **D1**: 무료 티어 (5GB storage, 5M reads/day)
- **Worker**: 무료 티어 (100K requests/day)
- **R2**: $0.015/GB/month (매우 저렴)

**예상 월 비용**: $0 ~ $5 (소규모 서버)

---

## 📚 참고 문서

- [Cloudflare D1 문서](https://developers.cloudflare.com/d1/)
- [Cloudflare Workers 문서](https://developers.cloudflare.com/workers/)
- [Discord.js 문서](https://discord.js.org/)
- [혜니팩 사양](/docs/HYENIPACK.md)
- [에러 처리 전략](/docs/ERROR_RECOVERY_PLAN.md)
