# 관리 패널 백엔드(Admin API) 구현 계획 — Plan 1/2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 `hyenimc-worker`에 `/admin/api/*` 관리 엔드포인트를 추가해 모드·혜니팩의 게시/목록/롤백/삭제/메타편집을 R2에 직접 수행하고, Cloudflare Access JWT로 보호한다.

**Architecture:** 단일 Worker(`cloudflare-worker/src/index.js`)가 요청을 먼저 받아 `/admin/api/*`는 신규 관리 라우터로, 그 외는 기존 공개 API로 디스패치한다. 관리 로직은 `src/admin/`의 작은 모듈들(라우터·인증·R2헬퍼·포맷·레지스트리·mods·packs)로 분리한다. 기존 공개 API/다운로드 경로·포맷은 변경하지 않는다.

**Tech Stack:** Cloudflare Workers(모듈 워커, JS) · R2 바인딩 `RELEASES` · WebCrypto(sha256·RS256 검증) · vitest + `@cloudflare/vitest-pool-workers`(miniflare) · wrangler ^3.

**설계 문서:** [docs/superpowers/specs/2026-07-08-management-panel-design.md](../specs/2026-07-08-management-panel-design.md)

## Global Constraints

- R2 바인딩은 `env.RELEASES`. **R2 키에는 버킷 이름 prefix를 붙이지 않는다** (예: `mods/hyenihelper/latest.json`). 배포 스크립트의 `hyenimc-releases/` prefix는 wrangler CLI 전용이며 바인딩 API에는 쓰지 않는다.
- KV 바인딩은 `env.RATE_LIMIT` (기존, 관리 API에서는 사용 안 함).
- 버전 형식은 정확히 `^\d+\.\d+\.\d+$`. 위반 시 400.
- 모드 id 형식 `^[a-z0-9][a-z0-9-]{0,63}$`, 모드팩 id 동일(`MODPACK_ID_PATTERN`).
- ISO 날짜 형식은 `YYYY-MM-DDTHH:MM:SSZ`(UTC, 밀리초 없음).
- `manifest.json`과 `mods/{id}/latest.json`은 **바이트 동일**해야 한다(기존 스크립트 규약).
- 기존 공개 라우트(`/api/v2/*`, `/api/mods*`, `/download/*`, `/health`, CurseForge proxy)와 응답 포맷은 **변경 금지**.
- 관리 엔드포인트 응답은 항상 JSON(`Content-Type: application/json`), 에러는 `{error, message}` 형태.
- 인증: 모든 `/admin/api/*`는 Cloudflare Access JWT(`Cf-Access-Jwt-Assertion` 헤더) 검증 통과 필수. 실패 시 401.
- 커밋 메시지 형식 `<type>: <description>`, 첨부(Co-Authored-By) 없음.
- 작업 디렉터리: `cloudflare-worker/`. 브랜치: `feat/tauri-m0`.

---

## 파일 구조

| 파일 | 책임 | 신규/수정 |
|------|------|-----------|
| `vitest.config.js` | vitest-pool-workers 설정 | 신규 |
| `package.json` | devDeps(vitest, pool-workers) + `test` 스크립트 | 수정 |
| `wrangler.toml` | Access 관련 `[vars]` 추가 | 수정 |
| `src/index.js` | `/admin/api/*` 디스패치 추가 | 수정 |
| `src/admin/router.js` | 관리 라우터 + Access 미들웨어 + 응답 헬퍼 | 신규 |
| `src/admin/access.js` | Cloudflare Access JWT(RS256) 검증 | 신규 |
| `src/admin/r2.js` | R2 헬퍼(getJson/putJson/putObject/list/del/exists) | 신규 |
| `src/admin/mods-format.js` | sha256 + manifest/latest 빌더(순수함수) | 신규 |
| `src/admin/registry.js` | `mods/registry.json` 재생성(멱등) | 신규 |
| `src/admin/mods.js` | 모드 목록/버전/게시/롤백/편집/삭제 핸들러 | 신규 |
| `src/admin/packs.js` | 혜니팩 목록/버전/게시/롤백/편집/삭제 핸들러 | 신규 |
| `test/*.test.js` | 각 모듈/엔드포인트 테스트 | 신규 |

라우팅 흐름: `index.js` → `/admin/api/*`면 `handleAdminApi()`(router.js) → Access 검증 → 메서드/경로 매칭 → `mods.js`/`packs.js`/`registry.js` 핸들러.

---

## Task 1: 테스트 인프라 + 관리 디스패치 스켈레톤

**Files:**
- Create: `cloudflare-worker/vitest.config.js`
- Create: `cloudflare-worker/src/admin/router.js`
- Create: `cloudflare-worker/test/routing.test.js`
- Modify: `cloudflare-worker/package.json`
- Modify: `cloudflare-worker/src/index.js:29-73` (라우팅 블록 상단에 admin 분기 추가)

**Interfaces:**
- Produces: `handleAdminApi(request, env, ctx)` → `Promise<Response>` (router.js). 현재는 `GET /admin/api/ping` → 200 `{ok:true}`, 그 외 `/admin/api/*` → 404 `{error:'Not Found'}`.

- [ ] **Step 1: devDependencies 및 test 스크립트 추가**

`package.json`을 다음으로 교체:

```json
{
  "name": "hyenimc-worker",
  "version": "2.0.0",
  "description": "HyeniMC Worker - CurseForge API proxy & Mod distribution (R2)",
  "scripts": {
    "deploy": "wrangler publish",
    "dev": "wrangler dev",
    "tail": "wrangler tail",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "wrangler": "^3.0.0",
    "vitest": "^2.1.0",
    "@cloudflare/vitest-pool-workers": "^0.5.0"
  }
}
```

- [ ] **Step 2: 의존성 설치**

Run: `cd cloudflare-worker && npm install`
Expected: `node_modules/`에 vitest, @cloudflare/vitest-pool-workers 설치. 오류 없음.

- [ ] **Step 3: vitest 설정 생성**

`vitest.config.js`:

```js
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
      },
    },
  },
});
```

- [ ] **Step 4: 실패하는 테스트 작성**

`test/routing.test.js`:

```js
import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

describe('admin routing', () => {
  it('GET /admin/api/ping returns 200', async () => {
    const res = await SELF.fetch('https://example.com/admin/api/ping');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('unknown /admin/api route returns 404', async () => {
    const res = await SELF.fetch('https://example.com/admin/api/nope');
    expect(res.status).toBe(404);
  });

  it('does not intercept public /health route', async () => {
    const res = await SELF.fetch('https://example.com/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });
});
```

- [ ] **Step 5: 테스트 실패 확인**

Run: `cd cloudflare-worker && npx vitest run test/routing.test.js`
Expected: FAIL — `/admin/api/ping`가 CurseForge proxy로 빠져 200/`{ok:true}`가 아님(또는 500).

- [ ] **Step 6: router.js 생성**

`src/admin/router.js`:

```js
/**
 * 관리 API 라우터. /admin/api/* 요청을 받아 처리한다.
 * 인증(Access) 미들웨어는 Task 2에서 추가한다.
 */

export function adminJson(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleAdminApi(request, env, ctx) {
  const path = new URL(request.url).pathname;

  if (request.method === 'GET' && path === '/admin/api/ping') {
    return adminJson({ ok: true });
  }

  return adminJson({ error: 'Not Found' }, 404);
}
```

- [ ] **Step 7: index.js에 디스패치 추가**

`src/index.js`의 `try {` 블록 안, `const path = url.pathname;` 다음 줄(현재 32번째 줄 부근, 첫 라우트 분기 `if (path.startsWith('/api/v2/modpacks')...` 바로 위)에 삽입:

```js
      // Route: Admin API (Cloudflare Access 보호)
      if (path.startsWith('/admin/api/')) {
        const { handleAdminApi } = await import('./admin/router.js');
        return await handleAdminApi(request, env, ctx);
      }
```

- [ ] **Step 8: 테스트 통과 확인**

Run: `cd cloudflare-worker && npx vitest run test/routing.test.js`
Expected: PASS (3 tests).

- [ ] **Step 9: 커밋**

```bash
cd cloudflare-worker
git add package.json package-lock.json vitest.config.js src/admin/router.js src/index.js test/routing.test.js
git commit -m "feat: admin API 디스패치 스켈레톤 + vitest 인프라"
```

---

## Task 2: Cloudflare Access JWT 검증

**Files:**
- Create: `cloudflare-worker/src/admin/access.js`
- Create: `cloudflare-worker/test/access.test.js`
- Modify: `cloudflare-worker/src/admin/router.js` (미들웨어 적용)
- Modify: `cloudflare-worker/test/routing.test.js` (ping에 유효 JWT 요구로 갱신)
- Modify: `cloudflare-worker/wrangler.toml` (`[vars]` 추가)

**Interfaces:**
- Consumes: 없음.
- Produces:
  - `verifyAccessJwt(request, env, { fetchImpl }) -> Promise<{ email: string } | null>` (access.js). 유효하면 `{email}`, 아니면 `null`. `fetchImpl` 기본값은 전역 `fetch`(테스트에서 주입).
  - router.js가 이를 미들웨어로 사용: 실패 시 401 `{error:'Unauthorized'}`.
- 환경변수: `env.ACCESS_TEAM_DOMAIN`(예 `https://devbug.cloudflareaccess.com`), `env.ACCESS_AUD`(Access 애플리케이션 Audience 태그).

- [ ] **Step 1: wrangler.toml에 vars 추가**

`wrangler.toml`의 `[env.production]` 위(현재 26번째 줄 부근)에 삽입. **값은 실제 Access 앱 생성 후 채운다** — 테스트는 아래 주입 방식이라 실값 불필요:

```toml
# Cloudflare Access (관리 패널 /admin 보호)
# ACCESS_TEAM_DOMAIN: https://<team>.cloudflareaccess.com
# ACCESS_AUD: Access 애플리케이션의 Audience(AUD) 태그
[vars]
ACCESS_TEAM_DOMAIN = "https://example.cloudflareaccess.com"
ACCESS_AUD = "test-aud"
```

- [ ] **Step 2: 실패하는 테스트 작성**

`test/access.test.js`:

```js
import { describe, it, expect, beforeAll } from 'vitest';
import { verifyAccessJwt } from '../src/admin/access.js';

// base64url 인코딩 헬퍼
function b64url(bytes) {
  let bin = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlStr(str) {
  return b64url(new TextEncoder().encode(str));
}

const TEAM = 'https://example.cloudflareaccess.com';
const AUD = 'test-aud';
let keyPair, jwk;

async function makeJwt(claims, signKey = keyPair.privateKey, kid = 'kid1') {
  const header = { alg: 'RS256', kid, typ: 'JWT' };
  const payload = {
    iss: TEAM, aud: [AUD], email: 'me@example.com',
    exp: Math.floor(Date.now() / 1000) + 600,
    ...claims,
  };
  const signingInput = `${b64urlStr(JSON.stringify(header))}.${b64urlStr(JSON.stringify(payload))}`;
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', signKey, new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${b64url(sig)}`;
}

function fakeFetch() {
  return async () => new Response(JSON.stringify({ keys: [jwk] }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

function reqWithJwt(token) {
  return new Request('https://example.com/admin/api/ping', {
    headers: token ? { 'Cf-Access-Jwt-Assertion': token } : {},
  });
}

const env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };

beforeAll(async () => {
  keyPair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['sign', 'verify'],
  );
  jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  jwk.kid = 'kid1';
  jwk.alg = 'RS256';
});

describe('verifyAccessJwt', () => {
  it('accepts a valid token', async () => {
    const token = await makeJwt({});
    const result = await verifyAccessJwt(reqWithJwt(token), env, { fetchImpl: fakeFetch() });
    expect(result).toEqual({ email: 'me@example.com' });
  });

  it('rejects missing header', async () => {
    const result = await verifyAccessJwt(reqWithJwt(null), env, { fetchImpl: fakeFetch() });
    expect(result).toBeNull();
  });

  it('rejects wrong audience', async () => {
    const token = await makeJwt({ aud: ['other-aud'] });
    const result = await verifyAccessJwt(reqWithJwt(token), env, { fetchImpl: fakeFetch() });
    expect(result).toBeNull();
  });

  it('rejects expired token', async () => {
    const token = await makeJwt({ exp: Math.floor(Date.now() / 1000) - 10 });
    const result = await verifyAccessJwt(reqWithJwt(token), env, { fetchImpl: fakeFetch() });
    expect(result).toBeNull();
  });

  it('rejects tampered signature', async () => {
    const token = (await makeJwt({})).slice(0, -3) + 'AAA';
    const result = await verifyAccessJwt(reqWithJwt(token), env, { fetchImpl: fakeFetch() });
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `cd cloudflare-worker && npx vitest run test/access.test.js`
Expected: FAIL — `verifyAccessJwt`가 없어 import 오류.

- [ ] **Step 4: access.js 구현**

`src/admin/access.js`:

```js
/**
 * Cloudflare Access JWT(RS256) 검증.
 * Access가 엣지에서 /admin*를 이미 게이트하지만, Worker에서 2차 검증한다.
 */

const jwksCache = new Map(); // teamDomain -> { keys, expiresAt }
const JWKS_TTL_MS = 60 * 60 * 1000; // 1시간

function decodeB64url(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function jsonFromB64url(str) {
  return JSON.parse(new TextDecoder().decode(decodeB64url(str)));
}

async function getJwks(teamDomain, fetchImpl) {
  const cached = jwksCache.get(teamDomain);
  if (cached && cached.expiresAt > Date.now()) return cached.keys;

  const res = await fetchImpl(`${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const { keys } = await res.json();
  jwksCache.set(teamDomain, { keys, expiresAt: Date.now() + JWKS_TTL_MS });
  return keys;
}

export async function verifyAccessJwt(request, env, { fetchImpl = fetch } = {}) {
  try {
    const token = request.headers.get('Cf-Access-Jwt-Assertion');
    if (!token) return null;

    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, sigB64] = parts;

    const header = jsonFromB64url(headerB64);
    const payload = jsonFromB64url(payloadB64);
    if (header.alg !== 'RS256') return null;

    // 클레임 검증
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) return null;
    if (payload.iss !== env.ACCESS_TEAM_DOMAIN) return null;
    const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!auds.includes(env.ACCESS_AUD)) return null;

    // 서명 검증
    const keys = await getJwks(env.ACCESS_TEAM_DOMAIN, fetchImpl);
    const jwk = keys.find((k) => k.kid === header.kid);
    if (!jwk) return null;

    const key = await crypto.subtle.importKey(
      'jwk', jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false, ['verify'],
    );
    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5', key,
      decodeB64url(sigB64),
      new TextEncoder().encode(`${headerB64}.${payloadB64}`),
    );
    if (!valid) return null;

    return { email: payload.email || '' };
  } catch (e) {
    console.error('[access] verify error:', e.message);
    return null;
  }
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd cloudflare-worker && npx vitest run test/access.test.js`
Expected: PASS (5 tests).

- [ ] **Step 6: router.js에 미들웨어 적용**

`src/admin/router.js`의 `handleAdminApi`를 다음으로 교체:

```js
import { verifyAccessJwt } from './access.js';

export function adminJson(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleAdminApi(request, env, ctx) {
  const identity = await verifyAccessJwt(request, env);
  if (!identity) {
    return adminJson({ error: 'Unauthorized', message: 'Access 인증이 필요합니다.' }, 401);
  }

  const path = new URL(request.url).pathname;

  if (request.method === 'GET' && path === '/admin/api/ping') {
    return adminJson({ ok: true });
  }

  return adminJson({ error: 'Not Found' }, 404);
}
```

- [ ] **Step 7: routing.test.js를 인증 요구로 갱신**

`test/routing.test.js`를 다음으로 교체(테스트 헬퍼로 유효 JWT 주입은 통합 경로에선 어려우므로, `/admin/api/ping`은 인증 실패=401을 검증하고, 공개 라우트 비간섭만 통합 검증):

```js
import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

describe('admin routing', () => {
  it('GET /admin/api/ping without Access JWT returns 401', async () => {
    const res = await SELF.fetch('https://example.com/admin/api/ping');
    expect(res.status).toBe(401);
  });

  it('unknown /admin/api route without JWT returns 401 (auth first)', async () => {
    const res = await SELF.fetch('https://example.com/admin/api/nope');
    expect(res.status).toBe(401);
  });

  it('does not intercept public /health route', async () => {
    const res = await SELF.fetch('https://example.com/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });
});
```

> 참고: 엔드포인트 통합 테스트(Task 6+)는 `handleAdminApi`를 직접 호출하는 대신, 각 핸들러(mods.js/packs.js)를 **직접 import**해 `env`(cloudflare:test)와 함께 단위 테스트한다. Access 미들웨어는 access.test.js에서 이미 커버되므로 핸들러 테스트에서 JWT를 우회한다.

- [ ] **Step 8: 전체 테스트 통과 확인**

Run: `cd cloudflare-worker && npx vitest run`
Expected: PASS (access 5 + routing 3 = 8).

- [ ] **Step 9: 커밋**

```bash
cd cloudflare-worker
git add src/admin/access.js src/admin/router.js test/access.test.js test/routing.test.js wrangler.toml
git commit -m "feat: Cloudflare Access JWT 검증 + 관리 API 인증 미들웨어"
```

---

## Task 3: R2 헬퍼

**Files:**
- Create: `cloudflare-worker/src/admin/r2.js`
- Create: `cloudflare-worker/test/r2.test.js`

**Interfaces:**
- Produces (r2.js):
  - `getJson(env, key) -> Promise<object|null>`
  - `putJson(env, key, obj) -> Promise<void>` (Content-Type application/json)
  - `putObject(env, key, body, contentType) -> Promise<void>` (body: ArrayBuffer/Uint8Array/string)
  - `listVersions(env, prefix) -> Promise<string[]>` (prefix 아래 `versions/{x.y.z}/` 세그먼트에서 유니크 버전, 내림차순)
  - `listPrefixes(env, prefix) -> Promise<string[]>` (delimiter '/' 기준 하위 세그먼트명)
  - `deletePrefix(env, prefix) -> Promise<number>` (prefix로 시작하는 모든 오브젝트 삭제, 삭제 수 반환)
  - `objectExists(env, key) -> Promise<boolean>`

- [ ] **Step 1: 실패하는 테스트 작성**

`test/r2.test.js`:

```js
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getJson, putJson, putObject, listVersions, listPrefixes, deletePrefix, objectExists,
} from '../src/admin/r2.js';

async function clearBucket() {
  const list = await env.RELEASES.list();
  for (const o of list.objects) await env.RELEASES.delete(o.key);
}

beforeEach(clearBucket);

describe('r2 helpers', () => {
  it('putJson/getJson round-trips', async () => {
    await putJson(env, 'mods/x/latest.json', { version: '1.0.0' });
    expect(await getJson(env, 'mods/x/latest.json')).toEqual({ version: '1.0.0' });
  });

  it('getJson returns null when missing', async () => {
    expect(await getJson(env, 'nope.json')).toBeNull();
  });

  it('objectExists reflects presence', async () => {
    expect(await objectExists(env, 'a.bin')).toBe(false);
    await putObject(env, 'a.bin', new Uint8Array([1, 2, 3]), 'application/octet-stream');
    expect(await objectExists(env, 'a.bin')).toBe(true);
  });

  it('listVersions extracts sorted unique versions', async () => {
    await putObject(env, 'mods/x/versions/1.0.0/manifest.json', '{}', 'application/json');
    await putObject(env, 'mods/x/versions/1.2.0/manifest.json', '{}', 'application/json');
    await putObject(env, 'mods/x/versions/1.0.0/neoforge/1.21.1/a.jar', 'x', 'application/java-archive');
    expect(await listVersions(env, 'mods/x/versions/')).toEqual(['1.2.0', '1.0.0']);
  });

  it('listPrefixes returns child segment names', async () => {
    await putObject(env, 'mods/alpha/latest.json', '{}', 'application/json');
    await putObject(env, 'mods/beta/latest.json', '{}', 'application/json');
    const names = (await listPrefixes(env, 'mods/')).sort();
    expect(names).toEqual(['alpha', 'beta']);
  });

  it('deletePrefix removes all matching objects', async () => {
    await putObject(env, 'mods/x/versions/1.0.0/a.jar', 'x', 'application/java-archive');
    await putObject(env, 'mods/x/versions/1.0.0/manifest.json', '{}', 'application/json');
    const n = await deletePrefix(env, 'mods/x/versions/1.0.0/');
    expect(n).toBe(2);
    expect(await objectExists(env, 'mods/x/versions/1.0.0/a.jar')).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd cloudflare-worker && npx vitest run test/r2.test.js`
Expected: FAIL — r2.js 없음.

- [ ] **Step 3: r2.js 구현**

`src/admin/r2.js`:

```js
/** R2 바인딩(env.RELEASES) 헬퍼. 키에 버킷 prefix를 붙이지 않는다. */

export async function getJson(env, key) {
  const obj = await env.RELEASES.get(key);
  if (!obj) return null;
  return JSON.parse(await obj.text());
}

export async function putJson(env, key, obj) {
  await env.RELEASES.put(key, JSON.stringify(obj, null, 2), {
    httpMetadata: { contentType: 'application/json' },
  });
}

export async function putObject(env, key, body, contentType) {
  await env.RELEASES.put(key, body, {
    httpMetadata: { contentType: contentType || 'application/octet-stream' },
  });
}

export async function objectExists(env, key) {
  const head = await env.RELEASES.head(key);
  return head !== null;
}

const VERSION_SEG = /\/versions\/(\d+\.\d+\.\d+)\//;

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

export async function listVersions(env, prefix) {
  const versions = new Set();
  let cursor;
  do {
    const list = await env.RELEASES.list({ prefix, cursor });
    for (const o of list.objects) {
      const m = o.key.match(VERSION_SEG);
      if (m) versions.add(m[1]);
    }
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
  return [...versions].sort((a, b) => compareVersions(b, a));
}

export async function listPrefixes(env, prefix) {
  const names = new Set();
  let cursor;
  do {
    const list = await env.RELEASES.list({ prefix, delimiter: '/', cursor });
    for (const p of list.delimitedPrefixes) {
      const name = p.slice(prefix.length).replace(/\/$/, '');
      if (name) names.add(name);
    }
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
  return [...names];
}

export async function deletePrefix(env, prefix) {
  let count = 0;
  let cursor;
  do {
    const list = await env.RELEASES.list({ prefix, cursor });
    const keys = list.objects.map((o) => o.key);
    for (const key of keys) {
      await env.RELEASES.delete(key);
      count++;
    }
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
  return count;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd cloudflare-worker && npx vitest run test/r2.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: 커밋**

```bash
cd cloudflare-worker
git add src/admin/r2.js test/r2.test.js
git commit -m "feat: R2 헬퍼(getJson/putJson/putObject/list/delete)"
```

---

## Task 4: sha256 + manifest/latest 빌더(순수함수)

**Files:**
- Create: `cloudflare-worker/src/admin/mods-format.js`
- Create: `cloudflare-worker/test/mods-format.test.js`

**Interfaces:**
- Produces (mods-format.js):
  - `sha256Hex(buffer) -> Promise<string>` (ArrayBuffer/Uint8Array → 소문자 hex)
  - `isoNow() -> string` (`YYYY-MM-DDTHH:MM:SSZ`)
  - `buildManifest(meta) -> object` — meta: `{modId, name, version, category, changelog, releaseDate, files:[{loader, gameVersion, fileName, sha256, size, minLoaderVersion, maxLoaderVersion, dependencies}]}`. 반환 형식은 배포 스크립트의 manifest.json과 동일.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/mods-format.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { sha256Hex, isoNow, buildManifest } from '../src/admin/mods-format.js';

describe('sha256Hex', () => {
  it('computes hex digest', async () => {
    const hex = await sha256Hex(new TextEncoder().encode('abc'));
    expect(hex).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('isoNow', () => {
  it('has no milliseconds and ends with Z', () => {
    expect(isoNow()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });
});

describe('buildManifest', () => {
  const meta = {
    modId: 'hyenihelper',
    name: 'HyeniHelper',
    version: '1.0.5',
    category: 'required',
    changelog: 'fix bug',
    releaseDate: '2025-11-14T10:40:00Z',
    files: [
      {
        loader: 'neoforge', gameVersion: '1.21.1',
        fileName: 'hyenihelper-neoforge-1.21.1-1.0.5.jar',
        sha256: 'deadbeef', size: 2048,
        minLoaderVersion: '21.1.200', maxLoaderVersion: null,
        dependencies: {},
      },
    ],
  };

  it('produces the expected manifest shape', () => {
    const m = buildManifest(meta);
    expect(m).toEqual({
      modId: 'hyenihelper',
      name: 'HyeniHelper',
      version: '1.0.5',
      releaseDate: '2025-11-14T10:40:00Z',
      changelog: 'fix bug',
      gameVersions: ['1.21.1'],
      loaders: {
        neoforge: {
          gameVersions: {
            '1.21.1': {
              file: 'hyenihelper-neoforge-1.21.1-1.0.5.jar',
              sha256: 'deadbeef',
              size: 2048,
              minLoaderVersion: '21.1.200',
              maxLoaderVersion: null,
              downloadPath: 'mods/hyenihelper/versions/1.0.5/neoforge/1.21.1/hyenihelper-neoforge-1.21.1-1.0.5.jar',
              dependencies: {},
            },
          },
        },
      },
      category: 'required',
    });
  });

  it('groups multiple loaders and dedups gameVersions', () => {
    const m = buildManifest({
      ...meta,
      files: [
        { loader: 'neoforge', gameVersion: '1.21.1', fileName: 'a.jar', sha256: 'x', size: 1, minLoaderVersion: '1', maxLoaderVersion: null, dependencies: {} },
        { loader: 'fabric', gameVersion: '1.21.1', fileName: 'b.jar', sha256: 'y', size: 2, minLoaderVersion: '2', maxLoaderVersion: null, dependencies: {} },
      ],
    });
    expect(Object.keys(m.loaders).sort()).toEqual(['fabric', 'neoforge']);
    expect(m.gameVersions).toEqual(['1.21.1']);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd cloudflare-worker && npx vitest run test/mods-format.test.js`
Expected: FAIL — mods-format.js 없음.

- [ ] **Step 3: mods-format.js 구현**

`src/admin/mods-format.js`:

```js
/** 순수 포맷 함수: sha256, ISO 시각, manifest 빌더. */

export async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function isoNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * 배포 스크립트(deploy-mod-v2.sh)의 manifest.json과 동일한 구조를 만든다.
 * latest.json은 이 결과의 바이트 동일 사본이다.
 */
export function buildManifest(meta) {
  const { modId, name, version, category, changelog, releaseDate, files } = meta;

  const loaders = {};
  for (const f of files) {
    if (!loaders[f.loader]) loaders[f.loader] = { gameVersions: {} };
    loaders[f.loader].gameVersions[f.gameVersion] = {
      file: f.fileName,
      sha256: f.sha256,
      size: f.size,
      minLoaderVersion: f.minLoaderVersion,
      maxLoaderVersion: f.maxLoaderVersion ?? null,
      downloadPath: `mods/${modId}/versions/${version}/${f.loader}/${f.gameVersion}/${f.fileName}`,
      dependencies: f.dependencies ?? {},
    };
  }

  const gameVersions = [...new Set(files.map((f) => f.gameVersion))];

  return {
    modId,
    name,
    version,
    releaseDate,
    changelog,
    gameVersions,
    loaders,
    category,
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd cloudflare-worker && npx vitest run test/mods-format.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: 커밋**

```bash
cd cloudflare-worker
git add src/admin/mods-format.js test/mods-format.test.js
git commit -m "feat: sha256 + manifest/latest 빌더"
```

---

## Task 5: 레지스트리 재생성(멱등)

**Files:**
- Create: `cloudflare-worker/src/admin/registry.js`
- Create: `cloudflare-worker/test/registry.test.js`

**Interfaces:**
- Consumes: r2.js(`getJson`, `putJson`, `listPrefixes`), mods-format.js(`isoNow`).
- Produces (registry.js):
  - `buildRegistryEntry(latest, existingEntry) -> object` — 한 모드의 latest.json + 기존 registry 엔트리(있으면 description/dependencies 보존)로 엔트리 생성.
  - `rebuildRegistry(env) -> Promise<object>` — 모든 `mods/{id}/latest.json`을 취합해 `mods/registry.json`을 재작성하고 그 객체를 반환.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/registry.test.js`:

```js
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { putJson, getJson } from '../src/admin/r2.js';
import { buildRegistryEntry, rebuildRegistry } from '../src/admin/registry.js';

async function clearBucket() {
  const list = await env.RELEASES.list();
  for (const o of list.objects) await env.RELEASES.delete(o.key);
}
beforeEach(clearBucket);

const latestHH = {
  modId: 'hyenihelper', name: 'HyeniHelper', version: '1.0.5',
  releaseDate: '2025-11-14T10:40:00Z', changelog: 'x',
  gameVersions: ['1.21.1'],
  loaders: {
    neoforge: { gameVersions: { '1.21.1': {
      file: 'a.jar', sha256: 'x', size: 1,
      minLoaderVersion: '21.1.200', maxLoaderVersion: null,
      downloadPath: 'mods/hyenihelper/versions/1.0.5/neoforge/1.21.1/a.jar',
      dependencies: {},
    } } },
  },
  category: 'required',
};

describe('buildRegistryEntry', () => {
  it('maps latest.json to registry entry with default description', () => {
    const entry = buildRegistryEntry(latestHH, null);
    expect(entry).toEqual({
      id: 'hyenihelper',
      name: 'HyeniHelper',
      description: 'HyeniMC hyenihelper mod',
      latestVersion: '1.0.5',
      category: 'required',
      gameVersions: ['1.21.1'],
      loaders: [{
        type: 'neoforge',
        minVersion: '21.1.200',
        maxVersion: null,
        supportedGameVersions: ['1.21.1'],
      }],
      dependencies: { required: [], optional: [] },
    });
  });

  it('preserves existing description and dependencies', () => {
    const entry = buildRegistryEntry(latestHH, {
      id: 'hyenihelper', description: '커스텀 설명',
      dependencies: { required: ['hyenicore'], optional: [] },
    });
    expect(entry.description).toBe('커스텀 설명');
    expect(entry.dependencies).toEqual({ required: ['hyenicore'], optional: [] });
  });
});

describe('rebuildRegistry', () => {
  it('collects all mods and writes registry.json', async () => {
    await putJson(env, 'mods/hyenihelper/latest.json', latestHH);
    await putJson(env, 'mods/other/latest.json', { ...latestHH, modId: 'other', name: 'Other' });

    const reg = await rebuildRegistry(env);
    expect(reg.version).toBe('2.0');
    expect(reg.mods.map((m) => m.id).sort()).toEqual(['hyenihelper', 'other']);

    const stored = await getJson(env, 'mods/registry.json');
    expect(stored.mods.length).toBe(2);
  });

  it('preserves description across rebuilds', async () => {
    await putJson(env, 'mods/hyenihelper/latest.json', latestHH);
    await putJson(env, 'mods/registry.json', {
      version: '2.0', lastUpdated: 'x',
      mods: [{ id: 'hyenihelper', description: '보존됨', dependencies: { required: [], optional: [] } }],
    });
    const reg = await rebuildRegistry(env);
    expect(reg.mods.find((m) => m.id === 'hyenihelper').description).toBe('보존됨');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd cloudflare-worker && npx vitest run test/registry.test.js`
Expected: FAIL — registry.js 없음.

- [ ] **Step 3: registry.js 구현**

`src/admin/registry.js`:

```js
/** mods/registry.json 재생성. 모든 mods/{id}/latest.json을 취합한다. 멱등. */
import { getJson, putJson, listPrefixes } from './r2.js';
import { isoNow } from './mods-format.js';

export function buildRegistryEntry(latest, existingEntry) {
  const loaders = Object.entries(latest.loaders || {}).map(([type, data]) => {
    const gvKeys = Object.keys(data.gameVersions || {});
    const first = data.gameVersions[gvKeys[0]] || {};
    return {
      type,
      minVersion: first.minLoaderVersion || '0.0.0',
      maxVersion: first.maxLoaderVersion ?? null,
      supportedGameVersions: gvKeys,
    };
  });

  return {
    id: latest.modId,
    name: latest.name,
    description: existingEntry?.description || `HyeniMC ${latest.modId} mod`,
    latestVersion: latest.version,
    category: latest.category || 'optional',
    gameVersions: latest.gameVersions || [],
    loaders,
    dependencies: existingEntry?.dependencies || { required: [], optional: [] },
  };
}

export async function rebuildRegistry(env) {
  const existing = await getJson(env, 'mods/registry.json');
  const existingById = new Map((existing?.mods || []).map((m) => [m.id, m]));

  const modIds = await listPrefixes(env, 'mods/');
  const mods = [];
  for (const id of modIds) {
    const latest = await getJson(env, `mods/${id}/latest.json`);
    if (!latest || !latest.modId) continue; // latest.json 없는 디렉터리 스킵
    mods.push(buildRegistryEntry(latest, existingById.get(id)));
  }
  mods.sort((a, b) => a.id.localeCompare(b.id));

  const registry = { version: '2.0', lastUpdated: isoNow(), mods };
  await putJson(env, 'mods/registry.json', registry);
  return registry;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd cloudflare-worker && npx vitest run test/registry.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: 커밋**

```bash
cd cloudflare-worker
git add src/admin/registry.js test/registry.test.js
git commit -m "feat: registry.json 재생성(멱등, 설명 보존)"
```

---

## Task 6: 모드 목록/버전 조회 핸들러

**Files:**
- Create: `cloudflare-worker/src/admin/mods.js`
- Create: `cloudflare-worker/test/mods-read.test.js`

**Interfaces:**
- Consumes: r2.js(`getJson`, `listPrefixes`, `listVersions`).
- Produces (mods.js):
  - `handleMods(request, env) -> Promise<Response>` — `/admin/api/mods*` 서브라우트 디스패치.
  - 이 태스크에서 구현: `GET /admin/api/mods`, `GET /admin/api/mods/{id}/versions`.
  - 상수 `MOD_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/`, `VERSION_PATTERN = /^\d+\.\d+\.\d+$/` (mods.js에서 export — 이후 태스크가 사용).

- [ ] **Step 1: 실패하는 테스트 작성**

`test/mods-read.test.js`:

```js
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { putJson } from '../src/admin/r2.js';
import { handleMods } from '../src/admin/mods.js';

async function clearBucket() {
  const list = await env.RELEASES.list();
  for (const o of list.objects) await env.RELEASES.delete(o.key);
}
beforeEach(clearBucket);

function req(method, path) {
  return new Request(`https://example.com${path}`, { method });
}

const latest = {
  modId: 'hyenihelper', name: 'HyeniHelper', version: '1.0.5',
  releaseDate: '2025-11-14T10:40:00Z', changelog: 'x',
  gameVersions: ['1.21.1'], loaders: {}, category: 'required',
};

describe('GET /admin/api/mods', () => {
  it('returns registry when present', async () => {
    await putJson(env, 'mods/registry.json', {
      version: '2.0', lastUpdated: 'x',
      mods: [{ id: 'hyenihelper', latestVersion: '1.0.5' }],
    });
    const res = await handleMods(req('GET', '/admin/api/mods'), env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mods[0].id).toBe('hyenihelper');
  });

  it('returns empty mods when registry absent', async () => {
    const res = await handleMods(req('GET', '/admin/api/mods'), env);
    expect(res.status).toBe(200);
    expect((await res.json()).mods).toEqual([]);
  });
});

describe('GET /admin/api/mods/{id}/versions', () => {
  it('lists versions with manifest summaries', async () => {
    await putJson(env, 'mods/hyenihelper/versions/1.0.5/manifest.json', latest);
    await putJson(env, 'mods/hyenihelper/versions/1.0.4/manifest.json', { ...latest, version: '1.0.4' });
    const res = await handleMods(req('GET', '/admin/api/mods/hyenihelper/versions'), env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.versions.map((v) => v.version)).toEqual(['1.0.5', '1.0.4']);
  });

  it('rejects invalid mod id', async () => {
    const res = await handleMods(req('GET', '/admin/api/mods/Bad_ID/versions'), env);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd cloudflare-worker && npx vitest run test/mods-read.test.js`
Expected: FAIL — mods.js 없음.

- [ ] **Step 3: mods.js 구현(조회 부분)**

`src/admin/mods.js`:

```js
/** 모드 관리 핸들러: 목록/버전/게시/롤백/편집/삭제. */
import { adminJson } from './router.js';
import { getJson, listVersions } from './r2.js';

export const MOD_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

export async function handleMods(request, env) {
  const path = new URL(request.url).pathname;
  const method = request.method;

  if (method === 'GET' && path === '/admin/api/mods') {
    return await listMods(env);
  }

  const versions = path.match(/^\/admin\/api\/mods\/([^/]+)\/versions$/);
  if (versions) {
    const id = decodeURIComponent(versions[1]);
    if (!MOD_ID_PATTERN.test(id)) return adminJson({ error: 'Invalid mod id' }, 400);
    if (method === 'GET') return await listModVersions(env, id);
  }

  return adminJson({ error: 'Not Found' }, 404);
}

async function listMods(env) {
  const registry = await getJson(env, 'mods/registry.json');
  return adminJson({ mods: registry?.mods || [] });
}

async function listModVersions(env, id) {
  const versionIds = await listVersions(env, `mods/${id}/versions/`);
  const versions = [];
  for (const v of versionIds) {
    const manifest = await getJson(env, `mods/${id}/versions/${v}/manifest.json`);
    versions.push({
      version: v,
      releaseDate: manifest?.releaseDate || null,
      gameVersions: manifest?.gameVersions || [],
      changelog: manifest?.changelog || '',
      category: manifest?.category || 'optional',
    });
  }
  const latest = await getJson(env, `mods/${id}/latest.json`);
  return adminJson({ id, latestVersion: latest?.version || null, versions });
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd cloudflare-worker && npx vitest run test/mods-read.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: 커밋**

```bash
cd cloudflare-worker
git add src/admin/mods.js test/mods-read.test.js
git commit -m "feat: 모드 목록/버전 조회 관리 핸들러"
```

---

## Task 7: 모드 게시(멀티파일 업로드)

**Files:**
- Modify: `cloudflare-worker/src/admin/mods.js` (POST 핸들러 + 라우팅 추가)
- Create: `cloudflare-worker/test/mods-publish.test.js`

**Interfaces:**
- Consumes: r2.js(`putObject`, `putJson`, `objectExists`), mods-format.js(`sha256Hex`, `buildManifest`, `isoNow`), registry.js(`rebuildRegistry`).
- Produces: `POST /admin/api/mods/{id}/versions` — multipart/form-data 처리.
  - 폼 필드 `meta`(JSON 문자열): `{modId, name, version, category, changelog, releaseDate?, files:[{loader, gameVersion, fileField, minLoaderVersion, maxLoaderVersion, dependencies}]}`. 각 `files[i].fileField`는 동일 폼의 파일 파트 이름.
  - 각 파일 파트: `File`(jar 바이너리).
  - 성공 201 `{version, files:[...]}`; 버전 중복 409(단 `?overwrite=true`면 허용); 검증 실패 400; 업로드 실패 500 `{error, failed:[...]}`.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/mods-publish.test.js`:

```js
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { getJson, objectExists } from '../src/admin/r2.js';
import { handleMods } from '../src/admin/mods.js';

async function clearBucket() {
  const list = await env.RELEASES.list();
  for (const o of list.objects) await env.RELEASES.delete(o.key);
}
beforeEach(clearBucket);

function publishReq(id, meta, fileParts, query = '') {
  const fd = new FormData();
  fd.set('meta', JSON.stringify(meta));
  for (const [name, bytes] of Object.entries(fileParts)) {
    fd.set(name, new File([bytes], name, { type: 'application/java-archive' }));
  }
  return new Request(`https://example.com/admin/api/mods/${id}/versions${query}`, {
    method: 'POST', body: fd,
  });
}

const meta = {
  modId: 'hyenihelper', name: 'HyeniHelper', version: '1.0.5',
  category: 'required', changelog: 'fix',
  files: [{
    loader: 'neoforge', gameVersion: '1.21.1', fileField: 'jar0',
    fileName: 'hyenihelper-neoforge-1.21.1-1.0.5.jar',
    minLoaderVersion: '21.1.200', maxLoaderVersion: null, dependencies: {},
  }],
};

describe('POST /admin/api/mods/{id}/versions', () => {
  it('uploads jar, writes manifest/latest/registry', async () => {
    const res = await handleMods(publishReq('hyenihelper', meta, { jar0: 'JARBYTES' }), env);
    expect(res.status).toBe(201);

    expect(await objectExists(env,
      'mods/hyenihelper/versions/1.0.5/neoforge/1.21.1/hyenihelper-neoforge-1.21.1-1.0.5.jar')).toBe(true);

    const manifest = await getJson(env, 'mods/hyenihelper/versions/1.0.5/manifest.json');
    expect(manifest.version).toBe('1.0.5');
    expect(manifest.loaders.neoforge.gameVersions['1.21.1'].size).toBe(8);

    const latest = await getJson(env, 'mods/hyenihelper/latest.json');
    expect(latest).toEqual(manifest);

    const registry = await getJson(env, 'mods/registry.json');
    expect(registry.mods.find((m) => m.id === 'hyenihelper').latestVersion).toBe('1.0.5');
  });

  it('blocks duplicate version without overwrite', async () => {
    await handleMods(publishReq('hyenihelper', meta, { jar0: 'JARBYTES' }), env);
    const res = await handleMods(publishReq('hyenihelper', meta, { jar0: 'JARBYTES' }), env);
    expect(res.status).toBe(409);
  });

  it('allows overwrite with ?overwrite=true', async () => {
    await handleMods(publishReq('hyenihelper', meta, { jar0: 'JARBYTES' }), env);
    const res = await handleMods(publishReq('hyenihelper', meta, { jar0: 'NEWBYTES' }, '?overwrite=true'), env);
    expect(res.status).toBe(201);
  });

  it('rejects invalid version', async () => {
    const bad = { ...meta, version: '1.0' };
    const res = await handleMods(publishReq('hyenihelper', bad, { jar0: 'X' }), env);
    expect(res.status).toBe(400);
  });

  it('rejects when a declared file part is missing', async () => {
    const res = await handleMods(publishReq('hyenihelper', meta, {}), env);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd cloudflare-worker && npx vitest run test/mods-publish.test.js`
Expected: FAIL — POST 라우트가 404.

- [ ] **Step 3: mods.js에 라우팅 추가**

`src/admin/mods.js`의 상단 import에 추가:

```js
import { getJson, listVersions, putObject, putJson, objectExists } from './r2.js';
import { sha256Hex, buildManifest, isoNow } from './mods-format.js';
import { rebuildRegistry } from './registry.js';
```

(기존 `import { getJson, listVersions } from './r2.js';` 줄은 위 확장 import로 교체.)

`handleMods`의 `versions` 매치 블록에 POST 분기 추가 — 기존:

```js
  const versions = path.match(/^\/admin\/api\/mods\/([^/]+)\/versions$/);
  if (versions) {
    const id = decodeURIComponent(versions[1]);
    if (!MOD_ID_PATTERN.test(id)) return adminJson({ error: 'Invalid mod id' }, 400);
    if (method === 'GET') return await listModVersions(env, id);
  }
```

를 다음으로 교체:

```js
  const versions = path.match(/^\/admin\/api\/mods\/([^/]+)\/versions$/);
  if (versions) {
    const id = decodeURIComponent(versions[1]);
    if (!MOD_ID_PATTERN.test(id)) return adminJson({ error: 'Invalid mod id' }, 400);
    if (method === 'GET') return await listModVersions(env, id);
    if (method === 'POST') return await publishModVersion(request, env, id);
  }
```

- [ ] **Step 4: publishModVersion 구현**

`src/admin/mods.js` 끝에 추가:

```js
async function publishModVersion(request, env, id) {
  let form;
  try {
    form = await request.formData();
  } catch {
    return adminJson({ error: 'multipart/form-data 본문이 필요합니다.' }, 400);
  }

  let meta;
  try {
    meta = JSON.parse(form.get('meta'));
  } catch {
    return adminJson({ error: 'meta 필드(JSON)가 필요합니다.' }, 400);
  }

  // 검증
  if (meta.modId !== id) return adminJson({ error: 'modId가 경로와 불일치합니다.' }, 400);
  if (!VERSION_PATTERN.test(meta.version || '')) {
    return adminJson({ error: '버전 형식은 x.y.z 여야 합니다.' }, 400);
  }
  if (!Array.isArray(meta.files) || meta.files.length === 0) {
    return adminJson({ error: 'files가 비어 있습니다.' }, 400);
  }

  const overwrite = new URL(request.url).searchParams.get('overwrite') === 'true';
  const manifestKey = `mods/${id}/versions/${meta.version}/manifest.json`;
  if (!overwrite && await objectExists(env, manifestKey)) {
    return adminJson({ error: '이미 존재하는 버전입니다.', message: `${id}@${meta.version}` }, 409);
  }

  // 파일 파트 수집 + 검증(업로드 전에 모두 존재 확인)
  const prepared = [];
  for (const f of meta.files) {
    const part = form.get(f.fileField);
    if (!part || typeof part.arrayBuffer !== 'function') {
      return adminJson({ error: `파일 파트 누락: ${f.fileField}` }, 400);
    }
    const buffer = await part.arrayBuffer();
    prepared.push({
      ...f,
      buffer,
      size: buffer.byteLength,
      sha256: await sha256Hex(buffer),
    });
  }

  // 업로드(부분 실패 시 latest/registry는 갱신하지 않음)
  const failed = [];
  for (const f of prepared) {
    const key = `mods/${id}/versions/${meta.version}/${f.loader}/${f.gameVersion}/${f.fileName}`;
    try {
      await putObject(env, key, f.buffer, 'application/java-archive');
    } catch (e) {
      failed.push({ file: f.fileName, error: e.message });
    }
  }
  if (failed.length > 0) {
    return adminJson({ error: '일부 파일 업로드 실패', failed }, 500);
  }

  // manifest / latest / registry
  const manifest = buildManifest({
    modId: id,
    name: meta.name,
    version: meta.version,
    category: meta.category,
    changelog: meta.changelog || '',
    releaseDate: meta.releaseDate || isoNow(),
    files: prepared,
  });
  await putJson(env, manifestKey, manifest);
  await putJson(env, `mods/${id}/latest.json`, manifest);
  await rebuildRegistry(env);

  return adminJson({
    version: meta.version,
    files: prepared.map((f) => ({ file: f.fileName, sha256: f.sha256, size: f.size })),
  }, 201);
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd cloudflare-worker && npx vitest run test/mods-publish.test.js`
Expected: PASS (5 tests).

- [ ] **Step 6: 커밋**

```bash
cd cloudflare-worker
git add src/admin/mods.js test/mods-publish.test.js
git commit -m "feat: 모드 게시(멀티파일 업로드 + manifest/latest/registry)"
```

---

## Task 8: 모드 롤백 / 메타 편집 / 삭제

**Files:**
- Modify: `cloudflare-worker/src/admin/mods.js` (PATCH latest, PATCH version, DELETE version 라우팅 + 핸들러)
- Create: `cloudflare-worker/test/mods-manage.test.js`

**Interfaces:**
- Consumes: r2.js(`getJson`, `putJson`, `objectExists`, `deletePrefix`), registry.js(`rebuildRegistry`).
- Produces:
  - `PATCH /admin/api/mods/{id}/latest` body `{version}` → latest.json을 해당 버전 manifest로 교체 + registry 재생성. 200 / 404(버전 없음).
  - `PATCH /admin/api/mods/{id}/versions/{ver}` body `{changelog?, category?, minLoaderVersion?, maxLoaderVersion?, dependencies?}` → 해당 버전 manifest 편집; 현재 latest면 latest.json도 갱신; registry 재생성. 200 / 404.
  - `DELETE /admin/api/mods/{id}/versions/{ver}` → 현재 latest면 409(차단); 아니면 버전 오브젝트 삭제 + registry 재생성. 200 / 404 / 409.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/mods-manage.test.js`:

```js
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { putJson, getJson, putObject, objectExists } from '../src/admin/r2.js';
import { handleMods } from '../src/admin/mods.js';

async function clearBucket() {
  const list = await env.RELEASES.list();
  for (const o of list.objects) await env.RELEASES.delete(o.key);
}
beforeEach(clearBucket);

function req(method, path, body) {
  return new Request(`https://example.com${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}

function manifest(version, extra = {}) {
  return {
    modId: 'hh', name: 'HH', version, releaseDate: '2025-01-01T00:00:00Z',
    changelog: 'c' + version, gameVersions: ['1.21.1'],
    loaders: { neoforge: { gameVersions: { '1.21.1': {
      file: 'a.jar', sha256: 'x', size: 1,
      minLoaderVersion: '21.1.200', maxLoaderVersion: null,
      downloadPath: `mods/hh/versions/${version}/neoforge/1.21.1/a.jar`, dependencies: {},
    } } } },
    category: 'required', ...extra,
  };
}

async function seedTwoVersions() {
  await putObject(env, 'mods/hh/versions/1.0.0/neoforge/1.21.1/a.jar', 'x', 'application/java-archive');
  await putJson(env, 'mods/hh/versions/1.0.0/manifest.json', manifest('1.0.0'));
  await putObject(env, 'mods/hh/versions/1.1.0/neoforge/1.21.1/a.jar', 'x', 'application/java-archive');
  await putJson(env, 'mods/hh/versions/1.1.0/manifest.json', manifest('1.1.0'));
  await putJson(env, 'mods/hh/latest.json', manifest('1.1.0'));
}

describe('PATCH latest (rollback)', () => {
  it('points latest to an older version', async () => {
    await seedTwoVersions();
    const res = await handleMods(req('PATCH', '/admin/api/mods/hh/latest', { version: '1.0.0' }), env);
    expect(res.status).toBe(200);
    expect((await getJson(env, 'mods/hh/latest.json')).version).toBe('1.0.0');
    expect((await getJson(env, 'mods/registry.json')).mods[0].latestVersion).toBe('1.0.0');
  });

  it('404 for unknown version', async () => {
    await seedTwoVersions();
    const res = await handleMods(req('PATCH', '/admin/api/mods/hh/latest', { version: '9.9.9' }), env);
    expect(res.status).toBe(404);
  });
});

describe('PATCH version (meta edit)', () => {
  it('edits changelog and mirrors to latest when current', async () => {
    await seedTwoVersions();
    const res = await handleMods(req('PATCH', '/admin/api/mods/hh/versions/1.1.0', { changelog: '수정됨' }), env);
    expect(res.status).toBe(200);
    expect((await getJson(env, 'mods/hh/versions/1.1.0/manifest.json')).changelog).toBe('수정됨');
    expect((await getJson(env, 'mods/hh/latest.json')).changelog).toBe('수정됨');
  });
});

describe('DELETE version', () => {
  it('blocks deleting current latest', async () => {
    await seedTwoVersions();
    const res = await handleMods(req('DELETE', '/admin/api/mods/hh/versions/1.1.0'), env);
    expect(res.status).toBe(409);
  });

  it('deletes a non-latest version', async () => {
    await seedTwoVersions();
    const res = await handleMods(req('DELETE', '/admin/api/mods/hh/versions/1.0.0'), env);
    expect(res.status).toBe(200);
    expect(await objectExists(env, 'mods/hh/versions/1.0.0/manifest.json')).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd cloudflare-worker && npx vitest run test/mods-manage.test.js`
Expected: FAIL — PATCH/DELETE 라우트가 404.

- [ ] **Step 3: mods.js에 라우팅 추가**

`handleMods`의 `return adminJson({ error: 'Not Found' }, 404);` 바로 위에 삽입:

```js
  // PATCH /admin/api/mods/{id}/latest  (롤백)
  const latestM = path.match(/^\/admin\/api\/mods\/([^/]+)\/latest$/);
  if (latestM && method === 'PATCH') {
    const id = decodeURIComponent(latestM[1]);
    if (!MOD_ID_PATTERN.test(id)) return adminJson({ error: 'Invalid mod id' }, 400);
    return await rollbackMod(request, env, id);
  }

  // PATCH/DELETE /admin/api/mods/{id}/versions/{ver}
  const verM = path.match(/^\/admin\/api\/mods\/([^/]+)\/versions\/([^/]+)$/);
  if (verM) {
    const id = decodeURIComponent(verM[1]);
    const ver = decodeURIComponent(verM[2]);
    if (!MOD_ID_PATTERN.test(id)) return adminJson({ error: 'Invalid mod id' }, 400);
    if (!VERSION_PATTERN.test(ver)) return adminJson({ error: 'Invalid version' }, 400);
    if (method === 'PATCH') return await editModVersion(request, env, id, ver);
    if (method === 'DELETE') return await deleteModVersion(env, id, ver);
  }
```

상단 import에 `deletePrefix` 추가 — `import { getJson, listVersions, putObject, putJson, objectExists } from './r2.js';`를 다음으로 교체:

```js
import { getJson, listVersions, putObject, putJson, objectExists, deletePrefix } from './r2.js';
```

- [ ] **Step 4: 핸들러 3종 구현**

`src/admin/mods.js` 끝에 추가:

```js
async function rollbackMod(request, env, id) {
  let body;
  try { body = await request.json(); } catch { return adminJson({ error: 'JSON 본문 필요' }, 400); }
  const version = body.version;
  if (!VERSION_PATTERN.test(version || '')) return adminJson({ error: 'Invalid version' }, 400);

  const manifest = await getJson(env, `mods/${id}/versions/${version}/manifest.json`);
  if (!manifest) return adminJson({ error: 'Not Found', message: `${id}@${version}` }, 404);

  await putJson(env, `mods/${id}/latest.json`, manifest);
  await rebuildRegistry(env);
  return adminJson({ id, latestVersion: version });
}

async function editModVersion(request, env, id, ver) {
  let body;
  try { body = await request.json(); } catch { return adminJson({ error: 'JSON 본문 필요' }, 400); }

  const manifest = await getJson(env, `mods/${id}/versions/${ver}/manifest.json`);
  if (!manifest) return adminJson({ error: 'Not Found' }, 404);

  // 불변 갱신
  const updated = { ...manifest };
  if (body.changelog !== undefined) updated.changelog = body.changelog;
  if (body.category !== undefined) updated.category = body.category;

  // loader별 min/maxLoaderVersion, dependencies 편집(모든 gameVersion에 적용)
  if (body.minLoaderVersion !== undefined || body.maxLoaderVersion !== undefined || body.dependencies !== undefined) {
    updated.loaders = JSON.parse(JSON.stringify(manifest.loaders));
    for (const loader of Object.values(updated.loaders)) {
      for (const gv of Object.values(loader.gameVersions)) {
        if (body.minLoaderVersion !== undefined) gv.minLoaderVersion = body.minLoaderVersion;
        if (body.maxLoaderVersion !== undefined) gv.maxLoaderVersion = body.maxLoaderVersion;
        if (body.dependencies !== undefined) gv.dependencies = body.dependencies;
      }
    }
  }

  await putJson(env, `mods/${id}/versions/${ver}/manifest.json`, updated);

  const latest = await getJson(env, `mods/${id}/latest.json`);
  if (latest && latest.version === ver) {
    await putJson(env, `mods/${id}/latest.json`, updated);
  }
  await rebuildRegistry(env);
  return adminJson({ id, version: ver });
}

async function deleteModVersion(env, id, ver) {
  const latest = await getJson(env, `mods/${id}/latest.json`);
  if (latest && latest.version === ver) {
    return adminJson({
      error: '현재 latest 버전은 삭제할 수 없습니다. 먼저 다른 버전으로 롤백하세요.',
    }, 409);
  }
  const removed = await deletePrefix(env, `mods/${id}/versions/${ver}/`);
  if (removed === 0) return adminJson({ error: 'Not Found' }, 404);
  await rebuildRegistry(env);
  return adminJson({ id, deleted: ver, objects: removed });
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd cloudflare-worker && npx vitest run test/mods-manage.test.js`
Expected: PASS (6 tests).

- [ ] **Step 6: 전체 회귀 확인**

Run: `cd cloudflare-worker && npx vitest run`
Expected: PASS (전체). 실패 시 해당 테스트 수정 후 재실행.

- [ ] **Step 7: 커밋**

```bash
cd cloudflare-worker
git add src/admin/mods.js test/mods-manage.test.js
git commit -m "feat: 모드 롤백/메타편집/삭제 관리 핸들러"
```

---

## Task 9: 혜니팩 관리(목록/버전/게시/롤백/편집/삭제)

**Files:**
- Create: `cloudflare-worker/src/admin/packs.js`
- Create: `cloudflare-worker/test/packs.test.js`
- Modify: `cloudflare-worker/src/admin/router.js` (mods/packs 디스패치 연결)

**Interfaces:**
- Consumes: r2.js(전체), mods-format.js(`sha256Hex`).
- Produces (packs.js):
  - `handlePacks(request, env) -> Promise<Response>` — `/admin/api/modpacks*` 디스패치.
  - `GET /admin/api/modpacks` — 목록(각 id + latest 요약).
  - `GET /admin/api/modpacks/{id}/versions` — 버전 목록.
  - `POST /admin/api/modpacks/{id}/versions` — multipart(`pack` 파일 + `latest` JSON 필드). sha256 검증 후 `modpacks/{id}/versions/{ver}/pack.hyenipack` + `modpacks/{id}/versions/{ver}/latest.json`(스냅샷) + `modpacks/{id}/latest.json` 기록. 201/400/409.
  - `PATCH /admin/api/modpacks/{id}/latest` `{version}` — 스냅샷을 top latest로 승격(롤백). 200/404.
  - `PATCH /admin/api/modpacks/{id}/versions/{ver}` `{changelog?, breaking?}` — 스냅샷 편집(+현재 latest면 top도 갱신). 200/404.
  - `DELETE /admin/api/modpacks/{id}/versions/{ver}` — 현재 latest면 409, 아니면 삭제. 200/404/409.

> **설계상 개선점(스크립트 대비):** 게시 시 사이드카 latest.json을 버전 폴더에도 스냅샷으로 저장한다. 공개 API가 읽는 `modpacks/{id}/latest.json`은 그대로 유지되며, 스냅샷은 롤백/편집을 가능하게 한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/packs.test.js`:

```js
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { putJson, putObject, getJson, objectExists } from '../src/admin/r2.js';
import { sha256Hex } from '../src/admin/mods-format.js';
import { handlePacks } from '../src/admin/packs.js';

async function clearBucket() {
  const list = await env.RELEASES.list();
  for (const o of list.objects) await env.RELEASES.delete(o.key);
}
beforeEach(clearBucket);

async function publishReq(id, version, packBytes, extra = {}, query = '') {
  const sha256 = await sha256Hex(new TextEncoder().encode(packBytes));
  const sidecar = { hyenipackId: id, version, sha256, changelog: 'c', breaking: false, ...extra };
  const fd = new FormData();
  fd.set('pack', new File([packBytes], 'pack.hyenipack', { type: 'application/zip' }));
  fd.set('latest', JSON.stringify(sidecar));
  return new Request(`https://example.com/admin/api/modpacks/${id}/versions${query}`, {
    method: 'POST', body: fd,
  });
}
function req(method, path, body) {
  return new Request(`https://example.com${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('POST modpacks publish', () => {
  it('verifies sha256 and writes pack + snapshot + latest', async () => {
    const res = await handlePacks(await publishReq('hyenipack', '1.0.0', 'PACKDATA'), env);
    expect(res.status).toBe(201);
    expect(await objectExists(env, 'modpacks/hyenipack/versions/1.0.0/pack.hyenipack')).toBe(true);
    expect(await getJson(env, 'modpacks/hyenipack/versions/1.0.0/latest.json')).toBeTruthy();
    expect((await getJson(env, 'modpacks/hyenipack/latest.json')).version).toBe('1.0.0');
  });

  it('rejects sha256 mismatch', async () => {
    const fd = new FormData();
    fd.set('pack', new File(['REALDATA'], 'pack.hyenipack'));
    fd.set('latest', JSON.stringify({ hyenipackId: 'hyenipack', version: '1.0.0', sha256: 'wrong' }));
    const res = await handlePacks(new Request('https://example.com/admin/api/modpacks/hyenipack/versions', {
      method: 'POST', body: fd,
    }), env);
    expect(res.status).toBe(400);
  });

  it('blocks duplicate version', async () => {
    await handlePacks(await publishReq('hyenipack', '1.0.0', 'PACKDATA'), env);
    const res = await handlePacks(await publishReq('hyenipack', '1.0.0', 'PACKDATA'), env);
    expect(res.status).toBe(409);
  });
});

describe('modpacks rollback / edit / delete', () => {
  async function seedTwo() {
    await handlePacks(await publishReq('hyenipack', '1.0.0', 'V1'), env);
    await handlePacks(await publishReq('hyenipack', '1.1.0', 'V2'), env);
  }

  it('rolls back latest to older snapshot', async () => {
    await seedTwo();
    const res = await handlePacks(req('PATCH', '/admin/api/modpacks/hyenipack/latest', { version: '1.0.0' }), env);
    expect(res.status).toBe(200);
    expect((await getJson(env, 'modpacks/hyenipack/latest.json')).version).toBe('1.0.0');
  });

  it('edits breaking flag and mirrors to latest', async () => {
    await seedTwo();
    const res = await handlePacks(req('PATCH', '/admin/api/modpacks/hyenipack/versions/1.1.0', { breaking: true }), env);
    expect(res.status).toBe(200);
    expect((await getJson(env, 'modpacks/hyenipack/latest.json')).breaking).toBe(true);
  });

  it('blocks deleting current latest', async () => {
    await seedTwo();
    const res = await handlePacks(req('DELETE', '/admin/api/modpacks/hyenipack/versions/1.1.0'), env);
    expect(res.status).toBe(409);
  });

  it('deletes a non-latest version', async () => {
    await seedTwo();
    const res = await handlePacks(req('DELETE', '/admin/api/modpacks/hyenipack/versions/1.0.0'), env);
    expect(res.status).toBe(200);
    expect(await objectExists(env, 'modpacks/hyenipack/versions/1.0.0/pack.hyenipack')).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd cloudflare-worker && npx vitest run test/packs.test.js`
Expected: FAIL — packs.js 없음.

- [ ] **Step 3: packs.js 구현**

`src/admin/packs.js`:

```js
/** 혜니팩 관리 핸들러. 공개 API가 읽는 modpacks/{id}/latest.json은 유지하고,
 * 버전 폴더에 스냅샷 latest.json을 추가로 저장해 롤백/편집을 지원한다. */
import { adminJson } from './router.js';
import { getJson, putJson, putObject, objectExists, listVersions, listPrefixes, deletePrefix } from './r2.js';
import { sha256Hex } from './mods-format.js';

const PACK_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

export async function handlePacks(request, env) {
  const path = new URL(request.url).pathname;
  const method = request.method;

  if (method === 'GET' && path === '/admin/api/modpacks') {
    return await listPacks(env);
  }

  const versM = path.match(/^\/admin\/api\/modpacks\/([^/]+)\/versions$/);
  if (versM) {
    const id = decodeURIComponent(versM[1]);
    if (!PACK_ID_PATTERN.test(id)) return adminJson({ error: 'Invalid modpack id' }, 400);
    if (method === 'GET') return await listPackVersions(env, id);
    if (method === 'POST') return await publishPackVersion(request, env, id);
  }

  const latestM = path.match(/^\/admin\/api\/modpacks\/([^/]+)\/latest$/);
  if (latestM && method === 'PATCH') {
    const id = decodeURIComponent(latestM[1]);
    if (!PACK_ID_PATTERN.test(id)) return adminJson({ error: 'Invalid modpack id' }, 400);
    return await rollbackPack(request, env, id);
  }

  const verM = path.match(/^\/admin\/api\/modpacks\/([^/]+)\/versions\/([^/]+)$/);
  if (verM) {
    const id = decodeURIComponent(verM[1]);
    const ver = decodeURIComponent(verM[2]);
    if (!PACK_ID_PATTERN.test(id)) return adminJson({ error: 'Invalid modpack id' }, 400);
    if (!VERSION_PATTERN.test(ver)) return adminJson({ error: 'Invalid version' }, 400);
    if (method === 'PATCH') return await editPackVersion(request, env, id, ver);
    if (method === 'DELETE') return await deletePackVersion(env, id, ver);
  }

  return adminJson({ error: 'Not Found' }, 404);
}

async function listPacks(env) {
  const ids = await listPrefixes(env, 'modpacks/');
  const packs = [];
  for (const id of ids) {
    const latest = await getJson(env, `modpacks/${id}/latest.json`);
    if (latest) packs.push({ id, latestVersion: latest.version, breaking: !!latest.breaking });
  }
  return adminJson({ packs });
}

async function listPackVersions(env, id) {
  const versions = await listVersions(env, `modpacks/${id}/versions/`);
  const latest = await getJson(env, `modpacks/${id}/latest.json`);
  const detailed = [];
  for (const v of versions) {
    const snap = await getJson(env, `modpacks/${id}/versions/${v}/latest.json`);
    detailed.push({ version: v, changelog: snap?.changelog || '', breaking: !!snap?.breaking });
  }
  return adminJson({ id, latestVersion: latest?.version || null, versions: detailed });
}

async function publishPackVersion(request, env, id) {
  let form;
  try { form = await request.formData(); } catch { return adminJson({ error: 'multipart 본문 필요' }, 400); }

  const packPart = form.get('pack');
  if (!packPart || typeof packPart.arrayBuffer !== 'function') {
    return adminJson({ error: 'pack 파일 파트가 필요합니다.' }, 400);
  }
  let sidecar;
  try { sidecar = JSON.parse(form.get('latest')); } catch {
    return adminJson({ error: 'latest 필드(JSON)가 필요합니다.' }, 400);
  }

  if (sidecar.hyenipackId !== id) return adminJson({ error: 'hyenipackId가 경로와 불일치합니다.' }, 400);
  if (!VERSION_PATTERN.test(sidecar.version || '')) return adminJson({ error: '버전 형식은 x.y.z' }, 400);

  const buffer = await packPart.arrayBuffer();
  const actual = await sha256Hex(buffer);
  if (actual !== sidecar.sha256) {
    return adminJson({ error: 'sha256 불일치', message: `expected ${sidecar.sha256}, got ${actual}` }, 400);
  }

  const overwrite = new URL(request.url).searchParams.get('overwrite') === 'true';
  const packKey = `modpacks/${id}/versions/${sidecar.version}/pack.hyenipack`;
  if (!overwrite && await objectExists(env, packKey)) {
    return adminJson({ error: '이미 존재하는 버전입니다.' }, 409);
  }

  await putObject(env, packKey, buffer, 'application/zip');
  await putJson(env, `modpacks/${id}/versions/${sidecar.version}/latest.json`, sidecar);
  await putJson(env, `modpacks/${id}/latest.json`, sidecar);
  return adminJson({ id, version: sidecar.version, sha256: actual }, 201);
}

async function rollbackPack(request, env, id) {
  let body;
  try { body = await request.json(); } catch { return adminJson({ error: 'JSON 본문 필요' }, 400); }
  if (!VERSION_PATTERN.test(body.version || '')) return adminJson({ error: 'Invalid version' }, 400);

  const snap = await getJson(env, `modpacks/${id}/versions/${body.version}/latest.json`);
  if (!snap) return adminJson({ error: 'Not Found' }, 404);
  await putJson(env, `modpacks/${id}/latest.json`, snap);
  return adminJson({ id, latestVersion: body.version });
}

async function editPackVersion(request, env, id, ver) {
  let body;
  try { body = await request.json(); } catch { return adminJson({ error: 'JSON 본문 필요' }, 400); }

  const snap = await getJson(env, `modpacks/${id}/versions/${ver}/latest.json`);
  if (!snap) return adminJson({ error: 'Not Found' }, 404);

  const updated = { ...snap };
  if (body.changelog !== undefined) updated.changelog = body.changelog;
  if (body.breaking !== undefined) updated.breaking = body.breaking;

  await putJson(env, `modpacks/${id}/versions/${ver}/latest.json`, updated);
  const latest = await getJson(env, `modpacks/${id}/latest.json`);
  if (latest && latest.version === ver) {
    await putJson(env, `modpacks/${id}/latest.json`, updated);
  }
  return adminJson({ id, version: ver });
}

async function deletePackVersion(env, id, ver) {
  const latest = await getJson(env, `modpacks/${id}/latest.json`);
  if (latest && latest.version === ver) {
    return adminJson({ error: '현재 latest 버전은 삭제할 수 없습니다. 먼저 롤백하세요.' }, 409);
  }
  const removed = await deletePrefix(env, `modpacks/${id}/versions/${ver}/`);
  if (removed === 0) return adminJson({ error: 'Not Found' }, 404);
  return adminJson({ id, deleted: ver, objects: removed });
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd cloudflare-worker && npx vitest run test/packs.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: 커밋**

```bash
cd cloudflare-worker
git add src/admin/packs.js test/packs.test.js
git commit -m "feat: 혜니팩 게시/롤백/편집/삭제 관리 핸들러"
```

---

## Task 10: 라우터 연결 + 레지스트리 재생성 엔드포인트 + 통합 확인

**Files:**
- Modify: `cloudflare-worker/src/admin/router.js` (mods/packs/registry 디스패치 연결)
- Create: `cloudflare-worker/test/router-integration.test.js`

**Interfaces:**
- Consumes: mods.js(`handleMods`), packs.js(`handlePacks`), registry.js(`rebuildRegistry`).
- Produces: `POST /admin/api/registry/rebuild` → 200 `{ok, count}`. `/admin/api/mods*`·`/admin/api/modpacks*`를 각 핸들러로 위임.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/router-integration.test.js` (Access를 우회하기 위해 라우팅 함수만 검증하는 내부 디스패처를 테스트한다):

```js
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { putJson } from '../src/admin/r2.js';
import { dispatchAdmin } from '../src/admin/router.js';

async function clearBucket() {
  const list = await env.RELEASES.list();
  for (const o of list.objects) await env.RELEASES.delete(o.key);
}
beforeEach(clearBucket);

describe('dispatchAdmin', () => {
  it('routes mods list', async () => {
    await putJson(env, 'mods/registry.json', { version: '2.0', lastUpdated: 'x', mods: [{ id: 'a' }] });
    const res = await dispatchAdmin(new Request('https://e.com/admin/api/mods'), env);
    expect(res.status).toBe(200);
  });

  it('routes modpacks list', async () => {
    const res = await dispatchAdmin(new Request('https://e.com/admin/api/modpacks'), env);
    expect(res.status).toBe(200);
  });

  it('registry rebuild endpoint', async () => {
    await putJson(env, 'mods/hh/latest.json', {
      modId: 'hh', name: 'HH', version: '1.0.0', gameVersions: ['1.21.1'],
      loaders: {}, category: 'required',
    });
    const res = await dispatchAdmin(new Request('https://e.com/admin/api/registry/rebuild', { method: 'POST' }), env);
    expect(res.status).toBe(200);
    expect((await res.json()).count).toBe(1);
  });

  it('unknown route 404', async () => {
    const res = await dispatchAdmin(new Request('https://e.com/admin/api/zzz'), env);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd cloudflare-worker && npx vitest run test/router-integration.test.js`
Expected: FAIL — `dispatchAdmin` export 없음.

- [ ] **Step 3: router.js에 dispatchAdmin 분리 + 연결**

`src/admin/router.js`를 다음으로 교체:

```js
import { verifyAccessJwt } from './access.js';
import { handleMods } from './mods.js';
import { handlePacks } from './packs.js';
import { rebuildRegistry } from './registry.js';

export function adminJson(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** 인증 이후의 순수 라우팅(테스트에서 직접 호출). */
export async function dispatchAdmin(request, env) {
  const path = new URL(request.url).pathname;
  const method = request.method;

  if (method === 'GET' && path === '/admin/api/ping') {
    return adminJson({ ok: true });
  }
  if (method === 'POST' && path === '/admin/api/registry/rebuild') {
    const reg = await rebuildRegistry(env);
    return adminJson({ ok: true, count: reg.mods.length });
  }
  if (path.startsWith('/admin/api/modpacks')) {
    return await handlePacks(request, env);
  }
  if (path.startsWith('/admin/api/mods')) {
    return await handleMods(request, env);
  }
  return adminJson({ error: 'Not Found' }, 404);
}

export async function handleAdminApi(request, env, ctx) {
  const identity = await verifyAccessJwt(request, env);
  if (!identity) {
    return adminJson({ error: 'Unauthorized', message: 'Access 인증이 필요합니다.' }, 401);
  }
  return await dispatchAdmin(request, env);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd cloudflare-worker && npx vitest run test/router-integration.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: 전체 스위트 확인**

Run: `cd cloudflare-worker && npx vitest run`
Expected: PASS (전체: routing 3 + access 5 + r2 6 + mods-format 4 + registry 4 + mods-read 4 + mods-publish 5 + mods-manage 6 + packs 7 + router-integration 4 = 48). 개수는 근사; 모두 PASS면 통과.

- [ ] **Step 6: 커밋**

```bash
cd cloudflare-worker
git add src/admin/router.js test/router-integration.test.js
git commit -m "feat: 관리 라우터 연결 + registry rebuild 엔드포인트"
```

---

## Self-Review 결과(작성자 점검)

- **Spec 커버리지**: 설계 §3(컴포넌트: router/mods/packs/r2/registry/access) 전부 태스크로 존재. §2 아키텍처 라우팅(admin dispatch)=T1. 인증=T2. §4 데이터흐름(모드 게시 manifest/latest/registry)=T7, (팩 sha256)=T9, (롤백)=T8/T9. §5 에러처리(부분실패 원자성=T7, sha256=T9, 버전중복=T7/T9, latest삭제차단=T8/T9, registry 멱등=T5/T10). §6 테스트(vitest-pool-workers)=T1+. 
  - **범위 밖(Plan 2)**: SPA 서빙(Workers Static Assets, `run_worker_first`, `[assets]`), 프론트 컴포넌트, `build:admin`/`deploy` 스크립트, Cloudflare Access 앱 대시보드 설정 절차. Plan 2에서 다룸.
- **Placeholder 스캔**: `wrangler.toml`의 `ACCESS_TEAM_DOMAIN`/`ACCESS_AUD`는 실제 Access 앱 생성 후 채우는 설정값(플레이스홀더 아님, 테스트는 주입 방식). 그 외 TODO/미완 없음.
- **타입/시그니처 일관성**: `adminJson`(router.js) 전 모듈 공유. `handleMods`/`handlePacks`/`dispatchAdmin` 시그니처 `(request, env)` 일관. `buildManifest` 입력의 `files[].fileName`/`sha256`/`size`는 T7 `prepared` 객체가 채워 T4 빌더로 전달 — 일치. `MOD_ID_PATTERN`/`VERSION_PATTERN`은 mods.js에서 정의·사용, packs.js는 자체 상수 보유(중복이나 독립 모듈 경계상 허용).

## 실행 핸드오프

이 계획은 Plan 1/2(백엔드)입니다. 실행 완료·검증 후 Plan 2(프론트 SPA + Static Assets + 배포 배선 + Access 설정 가이드)를 별도로 작성합니다.
