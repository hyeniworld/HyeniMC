# 환경별 최신 버전 해석(Per-Environment Latest) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 모드의 "최신 버전"을 프로필 환경 (마인크래프트 버전 × 모드 로더)별로 해석해, 런처가 그 환경에 맞는 최신 버전을 받도록 한다.

**Architecture:** 관리 패널이 각 모드의 모든 버전 manifest를 스캔해 `mods/{id}/index.json`(= (loader,gv)별 `{auto, pinned}`)을 유지한다. 워커의 `/api/v2/mods/{id}/latest`가 `?gameVersion=&loader=`를 받아 인덱스로 해석(`pinned ?? auto`)한 버전의 manifest를 반환하고, 쿼리·인덱스가 없으면 기존 전역 `latest.json`으로 폴백한다(하위호환). 런처는 요청에 쿼리를 붙이고, 관리 UI는 (loader,gv) 매트릭스 + 핀 드롭다운을 제공한다.

**Tech Stack:** Cloudflare Workers(JS) · R2 `env.RELEASES` · vitest + `@cloudflare/vitest-pool-workers` · Preact(admin) · Rust(`crates/hyenimc-launcher`, reqwest).

**설계 문서:** [docs/superpowers/specs/2026-07-09-per-environment-latest-design.md](../specs/2026-07-09-per-environment-latest-design.md)

## Global Constraints

- R2 키에 버킷 prefix를 붙이지 않는다(`mods/{id}/index.json` 등).
- **인덱스 shape**: `{ version: "1", updatedAt: <iso>, targets: { [loader]: { [gameVersion]: { auto: <version>, pinned: <version|null> } } } }`.
- **해석(resolved) = `pinned ?? auto`**. `auto` = 그 (loader,gameVersion) 타깃을 가진 버전 중 **숫자 세그먼트 기준 최고 버전**(사전식 아님: 1.21.2 < 1.21.11).
- **하위호환(절대 깨지 않음)**: 워커 latest에 `gameVersion`+`loader` 쿼리가 없으면 기존 `mods/{id}/latest.json` 반환. 쿼리가 있어도 인덱스가 없으면 `latest.json`으로 폴백. 응답 형식(manifest + downloadUrl 주입)은 불변.
- 공개 API(`/api/v2/*`, `/download/*`)의 기존 경로/응답 형식은 위 latest 확장 외에는 변경하지 않는다.
- 관리 API 응답은 항상 JSON. 커밋 `<type>: <description>`, Co-Authored-By 없음. 브랜치 `feat/tauri-m0` — 전환 금지.
- 혜니팩은 이 작업 범위 밖(무변경).

---

## 파일 구조

| 파일 | 책임 | 신규/수정 |
|------|------|-----------|
| `cloudflare-worker/src/admin/mod-index.js` | 인덱스 재계산(auto) + 핀 설정 + 해석 헬퍼 | 신규 |
| `cloudflare-worker/src/admin/mods.js` | 뮤테이션 시 인덱스 재계산 호출 + 핀/인덱스 라우트 | 수정 |
| `cloudflare-worker/src/admin/r2.js` | `compareVersions` export(재사용) | 수정 |
| `cloudflare-worker/src/index.js` | `getLatestRelease` 쿼리 해석 + 폴백 | 수정 |
| `cloudflare-worker/admin/src/api.ts` | `getModIndex`/`setModPin` | 수정 |
| `cloudflare-worker/admin/src/mods/ModResolution.tsx` | 환경별 최신 매트릭스 + 핀 | 신규 |
| `cloudflare-worker/admin/src/mods/ModVersions.tsx` | 매트릭스 마운트 | 수정 |
| `cloudflare-worker/admin/src/styles.css` | 매트릭스 스타일(기존 `.subtable` 재사용) | (필요 시) |
| `crates/hyenimc-launcher/src/workermods.rs` | latest 요청에 쿼리 추가 | 수정 |
| `cloudflare-worker/test/mod-index.test.js`, `test/mods-index-routes.test.js`, `test/worker-latest-resolve.test.js` | 백엔드/워커 테스트 | 신규 |

---

## Task 1: mod-index.js — 인덱스 재계산 + 핀 + 해석 (순수/R2)

**Files:**
- Modify: `cloudflare-worker/src/admin/r2.js` (compareVersions export)
- Create: `cloudflare-worker/src/admin/mod-index.js`
- Create: `cloudflare-worker/test/mod-index.test.js`

**Interfaces:**
- Consumes: r2.js(`getJson`, `putJson`, `listVersions`, `compareVersions`), mods-format.js(`isoNow`).
- Produces:
  - `rebuildModIndex(env, id) -> Promise<index>` — 모든 버전 manifest 스캔 → (loader,gv)별 `auto` 계산 + 기존 `pinned` 보존(그 버전이 여전히 타깃 제공 시만) → `mods/{id}/index.json` 기록.
  - `resolveFromIndex(index, loader, gameVersion) -> string|null` — `pinned ?? auto` (없으면 null).
  - `setModPin(env, id, loader, gameVersion, version) -> Promise<{ok, error?, index?}>` — 핀 설정/해제(version=null). version이 그 타깃을 실제 제공하는지 검증.

- [ ] **Step 1: r2.js의 compareVersions를 export**

`src/admin/r2.js`에서 기존 `function compareVersions(a, b) {` 선언을 `export function compareVersions(a, b) {`로 변경(그 함수 본문·다른 사용처는 그대로).

- [ ] **Step 2: 실패하는 테스트 작성**

`test/mod-index.test.js`:

```js
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { putJson, getJson } from '../src/admin/r2.js';
import { rebuildModIndex, resolveFromIndex, setModPin } from '../src/admin/mod-index.js';

async function clearBucket() {
  const list = await env.RELEASES.list();
  for (const o of list.objects) await env.RELEASES.delete(o.key);
}
beforeEach(clearBucket);

function manifest(version, loaders) {
  return { modId: 'hh', name: 'HH', version, releaseDate: '2025-01-01T00:00:00Z',
    changelog: '', gameVersions: [], loaders, category: 'required' };
}
const cell = (gv) => ({ [gv]: { file: 'a.jar', sha256: 'x', size: 1, minLoaderVersion: '1', maxLoaderVersion: null, downloadPath: 'p', dependencies: {} } });

async function seed() {
  // 1.0.4: neoforge/1.21.1 + fabric/1.21.1
  await putJson(env, 'mods/hh/versions/1.0.4/manifest.json',
    manifest('1.0.4', { neoforge: { gameVersions: cell('1.21.1') }, fabric: { gameVersions: cell('1.21.1') } }));
  // 1.0.5: fabric/1.21.1 만
  await putJson(env, 'mods/hh/versions/1.0.5/manifest.json',
    manifest('1.0.5', { fabric: { gameVersions: cell('1.21.1') } }));
  // 1.0.11: neoforge/1.21.1 (숫자정렬 확인용: 1.0.11 > 1.0.5)
  await putJson(env, 'mods/hh/versions/1.0.11/manifest.json',
    manifest('1.0.11', { neoforge: { gameVersions: cell('1.21.1') } }));
}

describe('rebuildModIndex', () => {
  it('computes auto per (loader,gv) as the numerically-highest offering version', async () => {
    await seed();
    const idx = await rebuildModIndex(env, 'hh');
    expect(idx.targets.neoforge['1.21.1'].auto).toBe('1.0.11'); // 1.0.4, 1.0.11 중 최고(숫자)
    expect(idx.targets.fabric['1.21.1'].auto).toBe('1.0.5');    // 1.0.4, 1.0.5 중 최고
    expect(idx.targets.neoforge['1.21.1'].pinned).toBeNull();
    const stored = await getJson(env, 'mods/hh/index.json');
    expect(stored.targets.fabric['1.21.1'].auto).toBe('1.0.5');
  });

  it('preserves a pin only if that version still offers the target', async () => {
    await seed();
    await rebuildModIndex(env, 'hh');
    await setModPin(env, 'hh', 'neoforge', '1.21.1', '1.0.4');
    const idx = await rebuildModIndex(env, 'hh'); // 재계산 후에도 핀 보존(1.0.4가 neoforge/1.21.1 제공)
    expect(idx.targets.neoforge['1.21.1'].pinned).toBe('1.0.4');
  });
});

describe('resolveFromIndex', () => {
  it('returns pinned ?? auto, null when absent', async () => {
    await seed();
    let idx = await rebuildModIndex(env, 'hh');
    expect(resolveFromIndex(idx, 'neoforge', '1.21.1')).toBe('1.0.11');
    await setModPin(env, 'hh', 'neoforge', '1.21.1', '1.0.4');
    idx = await getJson(env, 'mods/hh/index.json');
    expect(resolveFromIndex(idx, 'neoforge', '1.21.1')).toBe('1.0.4');
    expect(resolveFromIndex(idx, 'quilt', '1.21.1')).toBeNull();
  });
});

describe('setModPin', () => {
  it('rejects pinning a version that does not offer the target', async () => {
    await seed();
    await rebuildModIndex(env, 'hh');
    const r = await setModPin(env, 'hh', 'neoforge', '1.21.1', '1.0.5'); // 1.0.5는 neoforge 없음
    expect(r.ok).toBe(false);
  });
  it('clears the pin with version=null', async () => {
    await seed();
    await rebuildModIndex(env, 'hh');
    await setModPin(env, 'hh', 'fabric', '1.21.1', '1.0.4');
    const r = await setModPin(env, 'hh', 'fabric', '1.21.1', null);
    expect(r.ok).toBe(true);
    expect(r.index.targets.fabric['1.21.1'].pinned).toBeNull();
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `cd cloudflare-worker && npx vitest run test/mod-index.test.js`
Expected: FAIL — mod-index.js 없음.

- [ ] **Step 4: mod-index.js 구현**

`src/admin/mod-index.js`:

```js
/** 모드 인덱스: (loader,gameVersion)별 해석 latest(auto/pinned)를 계산·저장한다. */
import { getJson, putJson, listVersions, compareVersions } from './r2.js';
import { isoNow } from './mods-format.js';

/** 모든 버전 manifest를 스캔해 (loader,gv)별 auto(최고버전) 계산 + 기존 pinned 보존. */
export async function rebuildModIndex(env, id) {
  const versionIds = await listVersions(env, `mods/${id}/versions/`);
  const offers = {}; // loader -> gv -> [versions]
  for (const v of versionIds) {
    const manifest = await getJson(env, `mods/${id}/versions/${v}/manifest.json`);
    if (!manifest || !manifest.loaders) continue;
    for (const [loader, ldata] of Object.entries(manifest.loaders)) {
      for (const gv of Object.keys(ldata.gameVersions || {})) {
        offers[loader] ??= {};
        offers[loader][gv] ??= [];
        offers[loader][gv].push(v);
      }
    }
  }

  const existing = await getJson(env, `mods/${id}/index.json`);
  const existingTargets = existing?.targets || {};

  const targets = {};
  for (const [loader, gvs] of Object.entries(offers)) {
    targets[loader] = {};
    for (const [gv, versions] of Object.entries(gvs)) {
      const auto = [...versions].sort(compareVersions).at(-1);
      const prevPinned = existingTargets[loader]?.[gv]?.pinned ?? null;
      const pinned = prevPinned && versions.includes(prevPinned) ? prevPinned : null;
      targets[loader][gv] = { auto, pinned };
    }
  }

  const index = { version: '1', updatedAt: isoNow(), targets };
  await putJson(env, `mods/${id}/index.json`, index);
  return index;
}

/** (loader,gameVersion) 해석 버전. pinned ?? auto, 없으면 null. */
export function resolveFromIndex(index, loader, gameVersion) {
  const c = index?.targets?.[loader]?.[gameVersion];
  if (!c) return null;
  return c.pinned ?? c.auto ?? null;
}

/** 핀 설정/해제. version=null이면 해제. version이 그 타깃을 제공하는지 검증. */
export async function setModPin(env, id, loader, gameVersion, version) {
  const index = await getJson(env, `mods/${id}/index.json`);
  if (!index?.targets?.[loader]?.[gameVersion]) {
    return { ok: false, error: '존재하지 않는 (로더,게임버전) 타깃입니다.' };
  }
  if (version !== null) {
    const manifest = await getJson(env, `mods/${id}/versions/${version}/manifest.json`);
    if (!manifest?.loaders?.[loader]?.gameVersions?.[gameVersion]) {
      return { ok: false, error: '그 버전은 해당 로더/게임버전 타깃이 없습니다.' };
    }
  }
  index.targets[loader][gameVersion].pinned = version;
  index.updatedAt = isoNow();
  await putJson(env, `mods/${id}/index.json`, index);
  return { ok: true, index };
}
```

- [ ] **Step 5: 통과 확인**

Run: `cd cloudflare-worker && npx vitest run test/mod-index.test.js`
Expected: PASS (6 tests).

- [ ] **Step 6: 커밋**

```bash
cd cloudflare-worker
git add src/admin/r2.js src/admin/mod-index.js test/mod-index.test.js
git commit -m "feat: 모드 인덱스(환경별 auto/pinned 해석) 코어"
```

---

## Task 2: 뮤테이션에 인덱스 재계산 연결 + 핀/인덱스 엔드포인트

**Files:**
- Modify: `cloudflare-worker/src/admin/mods.js`
- Create: `cloudflare-worker/test/mods-index-routes.test.js`

**Interfaces:**
- Consumes: mod-index.js(`rebuildModIndex`, `setModPin`), r2.js(`getJson`).
- Produces:
  - 각 뮤테이션(publishModVersion/rollbackMod/editModVersion/deleteModVersion) 성공 경로에서 `rebuildRegistry(env)` 직후 `await rebuildModIndex(env, id)` 호출.
  - `GET /admin/api/mods/{id}/index` → 인덱스 JSON(`{ targets: {} }` if none).
  - `PATCH /admin/api/mods/{id}/pins` body `{loader, gameVersion, version|null}` → setModPin → 200 `{ok:true}` | 400 `{error}`.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/mods-index-routes.test.js`:

```js
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { getJson } from '../src/admin/r2.js';
import { handleMods } from '../src/admin/mods.js';

async function clearBucket() {
  const list = await env.RELEASES.list();
  for (const o of list.objects) await env.RELEASES.delete(o.key);
}
beforeEach(clearBucket);

function req(method, path, body) {
  return new Request(`https://e.com${path}`, {
    method, headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}
function publishReq(id, version, loader, gv) {
  const fd = new FormData();
  fd.set('meta', JSON.stringify({ modId: id, name: 'HH', version, category: 'required', changelog: '',
    files: [{ loader, gameVersion: gv, fileField: 'jar0', fileName: 'a.jar', minLoaderVersion: '1', maxLoaderVersion: null, dependencies: {} }] }));
  fd.set('jar0', new File(['x'], 'a.jar', { type: 'application/java-archive' }));
  return new Request(`https://e.com/admin/api/mods/${id}/versions`, { method: 'POST', body: fd });
}

describe('index maintained on publish + GET index', () => {
  it('publish builds index; GET returns it', async () => {
    await handleMods(publishReq('hh', '1.0.4', 'neoforge', '1.21.1'), env);
    const res = await handleMods(req('GET', '/admin/api/mods/hh/index'), env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.targets.neoforge['1.21.1'].auto).toBe('1.0.4');
  });
  it('GET index for unknown mod returns empty targets', async () => {
    const res = await handleMods(req('GET', '/admin/api/mods/none/index'), env);
    expect(res.status).toBe(200);
    expect((await res.json()).targets).toEqual({});
  });
});

describe('PATCH pins', () => {
  it('pins a valid version and rejects an invalid one', async () => {
    await handleMods(publishReq('hh', '1.0.4', 'neoforge', '1.21.1'), env);
    const ok = await handleMods(req('PATCH', '/admin/api/mods/hh/pins',
      { loader: 'neoforge', gameVersion: '1.21.1', version: '1.0.4' }), env);
    expect(ok.status).toBe(200);
    expect((await getJson(env, 'mods/hh/index.json')).targets.neoforge['1.21.1'].pinned).toBe('1.0.4');

    const bad = await handleMods(req('PATCH', '/admin/api/mods/hh/pins',
      { loader: 'neoforge', gameVersion: '1.21.1', version: '9.9.9' }), env);
    expect(bad.status).toBe(400);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd cloudflare-worker && npx vitest run test/mods-index-routes.test.js`
Expected: FAIL — index/pins 라우트 404, publish가 인덱스를 안 만듦.

- [ ] **Step 3: mods.js에 import + 뮤테이션 연결**

`src/admin/mods.js` 상단 import에 추가:

```js
import { rebuildModIndex, setModPin } from './mod-index.js';
```

`publishModVersion`·`rollbackMod`·`editModVersion`·`deleteModVersion` 각각의 `await rebuildRegistry(env);` **바로 다음 줄**에 `await rebuildModIndex(env, id);`를 추가한다(네 곳 모두).

- [ ] **Step 4: mods.js에 index/pins 라우트 추가**

`handleMods`의 `return adminJson({ error: 'Not Found' }, 404);` **바로 위**에 삽입:

```js
  // GET /admin/api/mods/{id}/index
  const indexM = path.match(/^\/admin\/api\/mods\/([^/]+)\/index$/);
  if (indexM && method === 'GET') {
    const id = decodeURIComponent(indexM[1]);
    if (!MOD_ID_PATTERN.test(id)) return adminJson({ error: 'Invalid mod id' }, 400);
    const idx = await getJson(env, `mods/${id}/index.json`);
    return adminJson(idx || { version: '1', targets: {} });
  }

  // PATCH /admin/api/mods/{id}/pins  {loader, gameVersion, version|null}
  const pinsM = path.match(/^\/admin\/api\/mods\/([^/]+)\/pins$/);
  if (pinsM && method === 'PATCH') {
    const id = decodeURIComponent(pinsM[1]);
    if (!MOD_ID_PATTERN.test(id)) return adminJson({ error: 'Invalid mod id' }, 400);
    let body;
    try { body = await request.json(); } catch { return adminJson({ error: 'JSON 본문 필요' }, 400); }
    if (!body.loader || !body.gameVersion) return adminJson({ error: 'loader, gameVersion 필요' }, 400);
    const version = body.version === undefined ? null : body.version;
    const r = await setModPin(env, id, body.loader, body.gameVersion, version);
    if (!r.ok) return adminJson({ error: r.error }, 400);
    return adminJson({ ok: true, index: r.index });
  }
```

- [ ] **Step 5: 통과 확인 + 회귀**

Run: `cd cloudflare-worker && npx vitest run test/mods-index-routes.test.js`
Expected: PASS (4 tests).
Run: `cd cloudflare-worker && npx vitest run`
Expected: 전체 PASS(기존 + 신규). 실패 시 해당 테스트 수정.

- [ ] **Step 6: 커밋**

```bash
cd cloudflare-worker
git add src/admin/mods.js test/mods-index-routes.test.js
git commit -m "feat: 뮤테이션 시 모드 인덱스 재계산 + 핀/인덱스 엔드포인트"
```

---

## Task 3: 워커 latest 쿼리 해석 + 하위호환 폴백

**Files:**
- Modify: `cloudflare-worker/src/index.js` (`handleReleasesAPI` 라우트 + `getLatestRelease`)
- Create: `cloudflare-worker/test/worker-latest-resolve.test.js`

**Interfaces:**
- Consumes: R2 `env.RELEASES`.
- Produces: `GET /api/v2/mods/{id}/latest?gameVersion=X&loader=Y` → 인덱스로 해석된 버전의 manifest(downloadUrl 주입). 쿼리 없음/인덱스 없음 → 기존 `latest.json`. 해석 불가(그 환경 타깃 없음) → 404.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/worker-latest-resolve.test.js`:

```js
import { env, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';

async function clearBucket() {
  const list = await env.RELEASES.list();
  for (const o of list.objects) await env.RELEASES.delete(o.key);
}
beforeEach(clearBucket);

async function put(key, obj) {
  await env.RELEASES.put(key, JSON.stringify(obj), { httpMetadata: { contentType: 'application/json' } });
}
function manifest(version, loaders) {
  return { modId: 'hh', name: 'HH', version, releaseDate: '2025-01-01T00:00:00Z', changelog: '', gameVersions: [], loaders, category: 'required' };
}
const cell = (gv) => ({ [gv]: { file: 'a.jar', sha256: 'x', size: 1, minLoaderVersion: '1', maxLoaderVersion: null, downloadPath: `mods/hh/versions/x/${gv}/a.jar`, dependencies: {} } });

describe('GET /api/v2/mods/{id}/latest with env query', () => {
  beforeEach(async () => {
    await put('mods/hh/versions/1.0.4/manifest.json', manifest('1.0.4', { neoforge: { gameVersions: cell('1.21.1') } }));
    await put('mods/hh/versions/1.0.11/manifest.json', manifest('1.0.11', { fabric: { gameVersions: cell('1.21.1') } }));
    await put('mods/hh/latest.json', manifest('1.0.11', { fabric: { gameVersions: cell('1.21.1') } }));
    await put('mods/hh/index.json', { version: '1', updatedAt: 'x', targets: {
      neoforge: { '1.21.1': { auto: '1.0.4', pinned: null } },
      fabric: { '1.21.1': { auto: '1.0.11', pinned: null } },
    } });
  });

  it('resolves neoforge/1.21.1 to 1.0.4 (not the global latest 1.0.11)', async () => {
    const res = await SELF.fetch('https://e.com/api/v2/mods/hh/latest?gameVersion=1.21.1&loader=neoforge');
    expect(res.status).toBe(200);
    expect((await res.json()).version).toBe('1.0.4');
  });

  it('resolves fabric/1.21.1 to 1.0.11', async () => {
    const res = await SELF.fetch('https://e.com/api/v2/mods/hh/latest?gameVersion=1.21.1&loader=fabric');
    expect((await res.json()).version).toBe('1.0.11');
  });

  it('404 when the env has no target', async () => {
    const res = await SELF.fetch('https://e.com/api/v2/mods/hh/latest?gameVersion=9.9.9&loader=neoforge');
    expect(res.status).toBe(404);
  });

  it('no query → returns the global latest.json (backward compat)', async () => {
    const res = await SELF.fetch('https://e.com/api/v2/mods/hh/latest');
    expect(res.status).toBe(200);
    expect((await res.json()).version).toBe('1.0.11');
  });

  it('query present but no index → falls back to global latest', async () => {
    await env.RELEASES.delete('mods/hh/index.json');
    const res = await SELF.fetch('https://e.com/api/v2/mods/hh/latest?gameVersion=1.21.1&loader=neoforge');
    expect(res.status).toBe(200);
    expect((await res.json()).version).toBe('1.0.11');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd cloudflare-worker && npx vitest run test/worker-latest-resolve.test.js`
Expected: FAIL — 쿼리 해석 미구현(모두 latest.json 1.0.11 반환).

- [ ] **Step 3: 라우트에서 searchParams 전달**

`src/index.js`의 `handleReleasesAPI` 안, `getLatestRelease(env, corsHeaders, latestMatch[1], version);` 호출을 다음으로 교체:

```js
    return await getLatestRelease(env, corsHeaders, latestMatch[1], version, url.searchParams);
```

- [ ] **Step 4: getLatestRelease 해석 로직**

`src/index.js`의 `getLatestRelease` 시그니처와 앞부분을 다음으로 교체(`if (!env.RELEASES)` 블록 다음, `const latest = await env.RELEASES.get(...)` 부분):

```js
async function getLatestRelease(env, corsHeaders, modId, version = 'v1', searchParams = null) {
  if (!env.RELEASES) {
    return new Response(JSON.stringify({ error: 'R2 bucket not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const gameVersion = searchParams?.get('gameVersion');
  const loader = searchParams?.get('loader');

  let obj = null;
  if (gameVersion && loader) {
    const indexObj = await env.RELEASES.get(`mods/${modId}/index.json`);
    if (indexObj) {
      const idx = JSON.parse(await indexObj.text());
      const c = idx?.targets?.[loader]?.[gameVersion];
      const resolved = c ? (c.pinned ?? c.auto) : null;
      if (!resolved) {
        return new Response(JSON.stringify({
          error: 'No release for this environment',
          message: `${modId}: no version for ${loader}/${gameVersion}.`,
        }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      obj = await env.RELEASES.get(`mods/${modId}/versions/${resolved}/manifest.json`);
    }
    // 인덱스 없으면 아래 latest.json 폴백
  }

  if (!obj) {
    obj = await env.RELEASES.get(`mods/${modId}/latest.json`);
  }

  if (!obj) {
    return new Response(JSON.stringify({
      error: 'Latest version not found',
      message: `Release information not available for ${modId}.`,
    }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const data = JSON.parse(await obj.text());
```

(그 아래 `// Add download URLs based on API version` 블록부터 끝까지는 **변경 없이 그대로 유지**. 기존 코드에서 `const latest = ...`/`if (!latest)` 두 블록은 위 교체로 대체되므로 제거되어야 한다 — 위 스니펫이 그 자리를 대신한다.)

- [ ] **Step 5: 통과 확인 + 회귀**

Run: `cd cloudflare-worker && npx vitest run test/worker-latest-resolve.test.js`
Expected: PASS (5 tests).
Run: `cd cloudflare-worker && npx vitest run`
Expected: 전체 PASS(기존 공개 API 테스트 포함 — 폴백이 기존 동작 유지).

- [ ] **Step 6: 커밋**

```bash
cd cloudflare-worker
git add src/index.js test/worker-latest-resolve.test.js
git commit -m "feat: 워커 latest에 환경(gameVersion·loader) 해석 + 하위호환 폴백"
```

---

## Task 4: 관리 UI — 환경별 최신 매트릭스 + 핀

**Files:**
- Modify: `cloudflare-worker/admin/src/api.ts`
- Create: `cloudflare-worker/admin/src/mods/ModResolution.tsx`
- Modify: `cloudflare-worker/admin/src/mods/ModVersions.tsx` (매트릭스 마운트 + 인덱스 리로드 연동)

**Interfaces:**
- Consumes: `api.getModIndex(id)`, `api.setModPin(id, patch)`, 그리고 ModVersions가 이미 가진 `versions[].targets`.
- Produces: `ModResolution({ modId, versions, onToast })` — (loader,gv) 매트릭스 렌더 + 핀 드롭다운.

- [ ] **Step 1: api.ts에 함수 추가**

`admin/src/api.ts`의 mods 섹션에 추가:

```ts
export const getModIndex = (id: string) => req(`/mods/${id}/index`);
export const setModPin = (id: string, patch: { loader: string; gameVersion: string; version: string | null }) =>
  req(`/mods/${id}/pins`, json('PATCH', patch));
```

- [ ] **Step 2: ModResolution.tsx 구현**

`admin/src/mods/ModResolution.tsx`:

```tsx
import { useEffect, useState } from 'preact/hooks';
import * as api from '../api';

interface Target { loader: string; gameVersion: string; }
interface Version { version: string; targets: { loader: string; gameVersion: string }[]; }
type Cell = { auto: string; pinned: string | null };
type Index = { targets: Record<string, Record<string, Cell>> };

export function ModResolution({ modId, versions, onToast }: {
  modId: string;
  versions: Version[];
  onToast: (m: string, k?: 'ok' | 'err') => void;
}) {
  const [index, setIndex] = useState<Index>({ targets: {} });

  async function load() {
    try { setIndex(await api.getModIndex(modId)); }
    catch (e: any) { onToast(e.message, 'err'); }
  }
  useEffect(() => { load(); }, [modId, versions]);

  // (loader,gv) → 그 타깃을 제공하는 버전 목록
  const offered: Record<string, string[]> = {};
  for (const v of versions) {
    for (const t of v.targets || []) {
      const key = `${t.loader}|${t.gameVersion}`;
      (offered[key] ??= []).push(v.version);
    }
  }
  const rows = Object.entries(offered)
    .map(([key, vers]) => {
      const [loader, gameVersion] = key.split('|');
      const cell = index.targets?.[loader]?.[gameVersion];
      return { loader, gameVersion, offered: vers, auto: cell?.auto ?? null, pinned: cell?.pinned ?? null };
    })
    .sort((a, b) => a.loader.localeCompare(b.loader) || a.gameVersion.localeCompare(b.gameVersion));

  async function pin(loader: string, gameVersion: string, version: string | null) {
    try {
      await api.setModPin(modId, { loader, gameVersion, version });
      onToast(version ? `${loader}·${gameVersion} → ${version} 고정` : `${loader}·${gameVersion} 자동`);
      await load();
    } catch (e: any) { onToast(e.message, 'err'); }
  }

  if (rows.length === 0) return null;

  return (
    <div class="panel">
      <div class="panel-head"><h3 class="panel-title">환경별 최신</h3>
        <span class="panel-sub">프로필 (로더·MC버전)별로 런처가 받을 버전</span></div>
      <table class="vtable">
        <thead><tr>{['로더', 'MC 버전', '해석된 latest', '지정'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => {
            const resolved = r.pinned ?? r.auto;
            return (
              <tr key={`${r.loader}|${r.gameVersion}`}>
                <td class="mono">{r.loader}</td>
                <td class="mono">{r.gameVersion}</td>
                <td class="mono">{resolved ?? '—'} <span class="faint">{r.pinned ? '(고정)' : '(자동)'}</span></td>
                <td>
                  <select value={r.pinned ?? ''}
                    onChange={(e) => {
                      const val = (e.target as HTMLSelectElement).value;
                      pin(r.loader, r.gameVersion, val === '' ? null : val);
                    }}>
                    <option value="">자동 ({r.auto ?? '—'})</option>
                    {[...r.offered].sort().reverse().map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: ModVersions.tsx에 매트릭스 마운트**

`admin/src/mods/ModVersions.tsx` 상단 import에 추가:

```tsx
import { ModResolution } from './ModResolution';
```

`ModVersions`의 반환 JSX에서 최상위 `<div class="panel">`(버전 테이블 패널)의 **닫는 `</div>` 바로 다음**(즉 버전 패널 아래)에 삽입:

```tsx
      <ModResolution modId={modId} versions={versions} onToast={onToast} />
```

(주의: `versions` state는 이미 `ModVersions`에 있고 `targets`를 포함한다 — Task 이전 작업으로 `Version` 인터페이스에 `targets`가 있음. 없다면 `versions` 배열 요소가 `targets`를 갖는지 확인.)

- [ ] **Step 4: 타입/빌드 확인**

Run: `cd cloudflare-worker/admin && npx tsc --noEmit && npm run build`
Expected: 타입 오류 0, 빌드 성공.

- [ ] **Step 5: 커밋**

```bash
cd cloudflare-worker
git add admin/src/api.ts admin/src/mods/ModResolution.tsx admin/src/mods/ModVersions.tsx
git commit -m "feat: 관리 UI 환경별 최신 매트릭스 + 핀 지정"
```

---

## Task 5: 런처 — latest 요청에 환경 쿼리 추가

**Files:**
- Modify: `crates/hyenimc-launcher/src/workermods.rs` (check_all_updates의 latest 요청)

**Interfaces:**
- Consumes: 워커의 `?gameVersion=&loader=` 해석(Task 3).
- Produces: 각 모드 latest 요청에 프로필의 `game_version`·`loader_type`을 쿼리로 전송. 응답 처리·로컬 매칭은 기존과 동일.

- [ ] **Step 1: 요청에 query 추가**

`crates/hyenimc-launcher/src/workermods.rs`의 latest 요청부(현재):

```rust
        let latest: LatestResponse = match http
            .get(format!("{worker_base}/api/v2/mods/{}/latest", item.id))
            .send()
```

를 다음으로 교체:

```rust
        let latest: LatestResponse = match http
            .get(format!("{worker_base}/api/v2/mods/{}/latest", item.id))
            .query(&[("gameVersion", game_version), ("loader", loader_type)])
            .send()
```

(다른 줄은 그대로. `game_version`·`loader_type`은 `check_all_updates` 파라미터로 이미 스코프에 있다.)

- [ ] **Step 2: 컴파일 + 기존 테스트**

Run: `cd /Users/deVbug/Documents/projects/devbug/HyeniWorld/HyeniMC && cargo build -p hyenimc-launcher`
Expected: 컴파일 성공.
Run: `cargo test -p hyenimc-launcher workermods`
Expected: 기존 workermods 테스트 PASS(요청 URL만 확장, 응답 처리 로직 불변).

- [ ] **Step 3: (있으면) mock 서버 테스트에서 쿼리 확인**

`workermods.rs`의 테스트 모듈에 mock HTTP 서버 기반 테스트가 있으면, latest 요청에 `?gameVersion=...&loader=...`가 포함되는지(또는 서버가 그 쿼리로 분기해 올바른 버전을 돌려주는지) 확인하는 케이스를 1개 추가한다. mock 인프라가 없으면 Step 2의 컴파일+기존 테스트로 갈음하고, 실제 검증은 워커 배포 후 런처 수동 실행에서 수행(리포트에 명시).

- [ ] **Step 4: 커밋**

```bash
cd /Users/deVbug/Documents/projects/devbug/HyeniWorld/HyeniMC
git add crates/hyenimc-launcher/src/workermods.rs
git commit -m "feat: 런처 모드 업데이트 체크에 환경(gameVersion·loader) 쿼리 전송"
```

---

## Self-Review 결과(작성자 점검)

- **Spec 커버리지**: §3 인덱스 shape=Task 1. §4-1 인덱스 재계산+핀+조회=Task 1·2. §4-2 워커 해석+폴백=Task 3. §4-3 런처 쿼리=Task 5. §4-4 매트릭스+핀 UI=Task 4. §5 하위호환/폴백=Task 3(테스트로 고정). §6 결정(auto 정의·전역 latest 유지·삭제 시 재계산=Task 2가 deleteModVersion에도 rebuildModIndex 호출)=반영.
  - **일회성 백필(§5)**: 배포 후 기존 모드는 다음 뮤테이션 때 인덱스 생성. 즉시 전량 생성이 필요하면 별도 "인덱스 재생성" 관리 버튼을 추후 추가(비목표, 폴백이 그때까지 커버).
- **Placeholder 스캔**: TODO/미완 없음. Task 5 Step 3은 mock 인프라 유무에 따른 조건 분기(플레이스홀더 아님, 명시적 대안 제시).
- **타입/시그니처 일관성**: `rebuildModIndex(env,id)`/`resolveFromIndex(index,loader,gv)`/`setModPin(env,id,loader,gv,version)` — Task 1 정의, Task 2·3에서 동일 사용. 인덱스 shape `{targets:{[loader]:{[gv]:{auto,pinned}}}}` — Task 1·2·3·4 전부 일치. 워커 해석은 인덱스를 직접 읽어 `pinned ?? auto`(resolveFromIndex와 동일 규칙) 적용 — 규칙 일치.

## 실행 핸드오프

Plan 완료. 4계층(백엔드 인덱스 → 뮤테이션/엔드포인트 → 워커 해석 → 관리 UI → 런처)을 Task 1~5로 순차 실행. 배포 시 워커/관리 패널은 `npm run deploy`, 런처는 별도 빌드/배포(미출시라 호환 이슈 없음).
