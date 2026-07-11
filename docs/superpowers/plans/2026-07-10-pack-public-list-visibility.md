# Plan C-1: 혜니팩 공개 목록 + 공개/비공개 (워커+관리) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 혜니팩 공개 목록 API(`GET /api/v2/modpacks`, unzip 없이 meta 기반)와 팩별 공개/비공개(id 전체 404)를 워커+관리 패널에 구현한다. 스펙: [2026-07-10-hyenipack-install-from-worker-design.md](../specs/2026-07-10-hyenipack-install-from-worker-design.md) §2-2.

**Architecture:** `modpacks/{id}/meta.json` `{name, minecraft, hidden, updatedAt}` 를 게시/롤백이 유지(hidden 보존)하고, 공개 API가 목록·404 게이트에 사용. latest.json과 분리된 별도 객체라 게시가 비공개를 풀 수 없음.

**Tech Stack:** Cloudflare Worker(JS, module), vitest + `@cloudflare/vitest-pool-workers`(admin은 `handlePacks` 직접 호출, 공개 라우트는 `SELF.fetch`), 관리 SPA(Vite+Preact, `class` 속성).

## Global Constraints

- meta.json의 `hidden`은 게시/롤백/편집/버전삭제로 **절대 변하지 않는다**(visibility API만 변경). `name`/`minecraft`는 공개 latest가 바뀔 때 그 버전 manifest 기준으로 갱신.
- **비공개 = id 전체 404**: 목록 미등장 + `/{id}/latest`·`/{id}/versions`·`/download/...` 404. **다운로드의 hidden 체크는 토큰 검증보다 먼저**(존재 누설·토큰체크 API 호출 방지).
- 기존 팩(meta 없음) = `hidden=false`, `name=id`, `minecraft=null` 폴백. 마이그레이션 불필요.
- admin 응답 헬퍼 `adminJson(obj, status)`, 공개 응답 `jsonResponse(obj, status, corsHeaders, cacheControl?)`. id 디코드는 packs.js의 `safeDecode` 관례(실패 시 400).
- 커밋 메시지 attribution 금지, `<type>: <설명>`.
- 검증: `cd cloudflare-worker && npm test`(전체 green), UI 태스크는 `cd cloudflare-worker/admin && npm run build`.

---

## 파일 구조

| 파일 | 변경 |
|---|---|
| `cloudflare-worker/src/admin/packs.js` | `parsePackManifest`/`upsertPackMeta` 헬퍼, 게시·롤백 meta 연동, `PATCH /visibility`, listPacks에 name/hidden |
| `cloudflare-worker/src/index.js` | `GET /api/v2/modpacks` 공개 목록, `isPackHidden` + 3개 라우트 404 게이트 |
| `cloudflare-worker/test/packs.test.js` | meta/visibility 테스트 추가 |
| `cloudflare-worker/test/modpacks-public.test.js` | 신규 — 공개 목록·hidden 게이트(SELF.fetch) |
| `cloudflare-worker/admin/src/api.ts` | `setPackVisibility` |
| `cloudflare-worker/admin/src/packs/PacksView.tsx` | rail에 name 표시+비공개 배지, name/hidden 전달 |
| `cloudflare-worker/admin/src/packs/PackVersions.tsx` | 헤더 name+packId, 공개/비공개 토글(+비공개 확인) |
| `cloudflare-worker/admin/src/styles.css` | `.badge-hidden` |

---

### Task 1: meta.json 헬퍼 + 게시/롤백 연동 (packs.js)

**Files:**
- Modify: `cloudflare-worker/src/admin/packs.js`
- Test: `cloudflare-worker/test/packs.test.js`

**Interfaces:**
- Produces: `parsePackManifest(buffer) -> object|null`, `upsertPackMeta(env, id, manifest) -> meta` (둘 다 module-private). meta 형식 `{name, minecraft, hidden, updatedAt}`. Task 2·3·4가 `modpacks/{id}/meta.json`을 읽는다.
- Consumes: 기존 `unzipSync`(이미 import), `getJson/putJson`, `compareVersions`, `isoNow`(`./mods-format.js`에서 import 추가).

- [ ] **Step 1: 실패하는 테스트 작성** — `test/packs.test.js`에 추가. 기존 `publishReq` 헬퍼는 평문 바이트를 쓰므로, manifest가 든 진짜 zip을 만드는 헬퍼를 함께 추가한다(파일 상단 import에 `strToU8` 추가: `import { zipSync, strToU8 } from 'fflate';`):

```js
function packZip(manifest) {
  return zipSync({ 'hyenipack.json': strToU8(JSON.stringify(manifest)) });
}
async function publishZipReq(id, version, manifest, query = '') {
  const bytes = packZip(manifest);
  const sha256 = await sha256Hex(bytes);
  const sidecar = { hyenipackId: id, version, sha256, changelog: 'c', breaking: false };
  const fd = new FormData();
  fd.set('pack', new File([bytes], 'pack.hyenipack', { type: 'application/zip' }));
  fd.set('latest', JSON.stringify(sidecar));
  return new Request(`https://example.com/admin/api/modpacks/${id}/versions${query}`, {
    method: 'POST', body: fd,
  });
}

describe('pack meta.json', () => {
  const mani = (v) => ({
    formatVersion: 1, hyenipackId: 'metapack', name: '메타팩', version: v,
    minecraft: { version: '1.21.1', loaderType: 'neoforge', loaderVersion: '21.1.186' },
    mods: [], breaking: false,
  });

  it('publish writes meta (name/minecraft from zip, hidden=false)', async () => {
    const res = await handlePacks(await publishZipReq('metapack', '1.0.0', mani('1.0.0')), env);
    expect(res.status).toBe(201);
    const meta = await getJson(env, 'modpacks/metapack/meta.json');
    expect(meta.name).toBe('메타팩');
    expect(meta.minecraft.loaderType).toBe('neoforge');
    expect(meta.hidden).toBe(false);
  });

  it('publish preserves hidden=true', async () => {
    await putJson(env, 'modpacks/metapack/meta.json',
      { name: 'x', minecraft: null, hidden: true, updatedAt: 'z' });
    await handlePacks(await publishZipReq('metapack', '1.0.0', mani('1.0.0')), env);
    const meta = await getJson(env, 'modpacks/metapack/meta.json');
    expect(meta.hidden).toBe(true);        // 게시가 비공개를 풀지 않음
    expect(meta.name).toBe('메타팩');       // name은 갱신
  });

  it('backfill(lower version) does not change meta name from newer latest', async () => {
    await handlePacks(await publishZipReq('metapack', '1.2.0',
      { ...mani('1.2.0'), name: '신버전팩' }), env);
    await handlePacks(await publishZipReq('metapack', '1.0.0',
      { ...mani('1.0.0'), name: '구버전팩' }), env);
    const meta = await getJson(env, 'modpacks/metapack/meta.json');
    expect(meta.name).toBe('신버전팩');     // 공개 latest 기준 유지
  });

  it('rollback updates meta from target version manifest', async () => {
    await handlePacks(await publishZipReq('metapack', '1.0.0',
      { ...mani('1.0.0'), name: '팩v1' }), env);
    await handlePacks(await publishZipReq('metapack', '1.1.0',
      { ...mani('1.1.0'), name: '팩v2' }), env);
    const res = await handlePacks(req('PATCH', '/admin/api/modpacks/metapack/latest',
      { version: '1.0.0' }), env);
    expect(res.status).toBe(200);
    const meta = await getJson(env, 'modpacks/metapack/meta.json');
    expect(meta.name).toBe('팩v1');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd cloudflare-worker && npx vitest run test/packs.test.js -t "pack meta"`
Expected: FAIL — meta.json이 없어서 `meta.name` TypeError 또는 null.

- [ ] **Step 3: 구현**

`packs.js`에 import 추가(`isoNow`):

```js
import { sha256Hex, isoNow } from './mods-format.js';
```

헬퍼 2개 추가(`readPackManifest` 근처). 기존 `readPackManifest`는 unzip 부분을 `parsePackManifest`로 위임하도록 리팩터:

```js
/** pack 바이너리(zip)에서 hyenipack.json 파싱. 실패/부재 시 null. */
function parsePackManifest(buffer) {
  try {
    const files = unzipSync(new Uint8Array(buffer), { filter: (f) => f.name === 'hyenipack.json' });
    const entry = files['hyenipack.json'];
    if (!entry) return null;
    return JSON.parse(new TextDecoder().decode(entry));
  } catch { return null; }
}

async function readPackManifest(env, id, ver) {
  const obj = await env.RELEASES.get(`modpacks/${id}/versions/${ver}/pack.hyenipack`);
  if (!obj) return null;
  return parsePackManifest(await obj.arrayBuffer());
}

/** meta.json 갱신 — name/minecraft는 대상 manifest 기준(없으면 기존/폴백), hidden은 항상 보존. */
async function upsertPackMeta(env, id, manifest) {
  const existing = await getJson(env, `modpacks/${id}/meta.json`);
  const meta = {
    name: manifest?.name ?? existing?.name ?? id,
    minecraft: manifest?.minecraft ?? existing?.minecraft ?? null,
    hidden: existing?.hidden ?? false,
    updatedAt: isoNow(),
  };
  await putJson(env, `modpacks/${id}/meta.json`, meta);
  return meta;
}
```

`publishPackVersion`의 latest 조건부 갱신 블록을 다음으로 교체(공개 latest가 바뀔 때만 meta 갱신 = 목록은 latest 기준; meta가 아예 없으면 백필 게시에서도 생성):

```js
  const curLatest = await getJson(env, `modpacks/${id}/latest.json`);
  const isNewLatest = !curLatest?.version || compareVersions(sidecar.version, curLatest.version) >= 0;
  if (isNewLatest) {
    await putJson(env, `modpacks/${id}/latest.json`, sidecar);
  }
  if (isNewLatest || !(await getJson(env, `modpacks/${id}/meta.json`))) {
    await upsertPackMeta(env, id, parsePackManifest(buffer));
  }
```

`rollbackPack`의 `putJson(... latest.json, snap)` 뒤에 추가:

```js
  await upsertPackMeta(env, id, await readPackManifest(env, id, body.version));
```

- [ ] **Step 4: 통과 확인**

Run: `cd cloudflare-worker && npm test`
Expected: 전체 PASS (기존 + 신규 4).

- [ ] **Step 5: 커밋**

```bash
git add cloudflare-worker/src/admin/packs.js cloudflare-worker/test/packs.test.js
git commit -m "feat: 혜니팩 meta.json(name/minecraft/hidden) — 게시·롤백 연동, hidden 보존"
```

---

### Task 2: 공개 팩 목록 API (index.js)

**Files:**
- Modify: `cloudflare-worker/src/index.js` (`handleModpacksAPI` 안, latest 라우트 앞)
- Test: Create `cloudflare-worker/test/modpacks-public.test.js`

**Interfaces:**
- Produces: `GET /api/v2/modpacks` → `{ packs: [{id, name, latestVersion, breaking, minecraft}] }` (hidden 제외, 완전 공개).
- Consumes: Task 1의 meta.json (없으면 폴백).

- [ ] **Step 1: 실패하는 테스트 작성** — `test/modpacks-public.test.js` 신규:

```js
import { env, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { putJson } from '../src/admin/r2.js';

async function clearBucket() {
  const list = await env.RELEASES.list();
  for (const o of list.objects) await env.RELEASES.delete(o.key);
}
beforeEach(clearBucket);

async function seedPack(id, { version = '1.0.0', name = id, hidden = false, minecraft = null } = {}) {
  await putJson(env, `modpacks/${id}/latest.json`,
    { hyenipackId: id, version, sha256: 'x', changelog: '', breaking: false });
  await putJson(env, `modpacks/${id}/meta.json`,
    { name, minecraft, hidden, updatedAt: 'z' });
}

describe('GET /api/v2/modpacks (public list)', () => {
  it('lists visible packs with meta name/minecraft', async () => {
    await seedPack('season3', { name: '시즌3 팩', version: '1.2.0',
      minecraft: { version: '1.21.1', loaderType: 'neoforge', loaderVersion: '21.1.186' } });
    await seedPack('oldpack', { hidden: true });
    const res = await SELF.fetch('https://example.com/api/v2/modpacks');
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.packs.map((p) => p.id);
    expect(ids).toContain('season3');
    expect(ids).not.toContain('oldpack');            // hidden 제외
    const p = body.packs.find((x) => x.id === 'season3');
    expect(p.name).toBe('시즌3 팩');
    expect(p.latestVersion).toBe('1.2.0');
    expect(p.minecraft.loaderType).toBe('neoforge');
  });

  it('falls back to id/null when meta.json is absent (legacy pack)', async () => {
    await putJson(env, 'modpacks/legacy/latest.json',
      { hyenipackId: 'legacy', version: '0.9.0', breaking: false });
    const res = await SELF.fetch('https://example.com/api/v2/modpacks');
    const body = await res.json();
    const p = body.packs.find((x) => x.id === 'legacy');
    expect(p.name).toBe('legacy');
    expect(p.minecraft).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd cloudflare-worker && npx vitest run test/modpacks-public.test.js`
Expected: FAIL — 현재 `/api/v2/modpacks` 정확 경로는 매칭 라우트가 없어 404.

- [ ] **Step 3: 구현** — `handleModpacksAPI` 안, `latestMatch` 처리 **앞**에 추가:

```js
  // GET /api/v2/modpacks — 공개 팩 목록(비공개 제외). 완전 공개, 다운로드만 토큰.
  if (path === '/api/v2/modpacks' && request.method === 'GET') {
    const packs = [];
    let cursor;
    do {
      const page = await env.RELEASES.list({ prefix: 'modpacks/', delimiter: '/', cursor });
      for (const prefix of page.delimitedPrefixes || []) {
        const id = prefix.slice('modpacks/'.length).replace(/\/$/, '');
        if (!MODPACK_ID_PATTERN.test(id)) continue;
        try {
          const [metaObj, latestObj] = await Promise.all([
            env.RELEASES.get(`modpacks/${id}/meta.json`),
            env.RELEASES.get(`modpacks/${id}/latest.json`),
          ]);
          const meta = metaObj ? JSON.parse(await metaObj.text()) : null;
          if (meta?.hidden) continue;
          if (!latestObj) continue;
          const latest = JSON.parse(await latestObj.text());
          packs.push({
            id,
            name: meta?.name ?? id,
            latestVersion: latest.version ?? null,
            breaking: !!latest.breaking,
            minecraft: meta?.minecraft ?? null,
          });
        } catch (e) {
          console.error(`[Modpacks API] list: skip ${id} (${e.message})`);
        }
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    return jsonResponse({ packs }, 200, corsHeaders, 'public, max-age=60');
  }
```

- [ ] **Step 4: 통과 확인**

Run: `cd cloudflare-worker && npm test`
Expected: 전체 PASS.

- [ ] **Step 5: 커밋**

```bash
git add cloudflare-worker/src/index.js cloudflare-worker/test/modpacks-public.test.js
git commit -m "feat: 공개 혜니팩 목록 API GET /api/v2/modpacks (hidden 제외, meta 기반)"
```

---

### Task 3: hidden 404 게이트 (index.js latest/versions/download)

**Files:**
- Modify: `cloudflare-worker/src/index.js`
- Test: `cloudflare-worker/test/modpacks-public.test.js` (추가)

**Interfaces:**
- Produces: `isPackHidden(env, id) -> bool` (index.js module-private). 세 라우트에서 hidden이면 404.
- **다운로드 라우트는 토큰 검증보다 먼저** hidden 체크(존재 누설·토큰체크 API 호출 방지).

- [ ] **Step 1: 실패하는 테스트 작성** — `modpacks-public.test.js`에 추가:

```js
describe('hidden pack = 404 everywhere', () => {
  it('latest/versions/download return 404 for hidden pack', async () => {
    await seedPack('secret', { hidden: true });
    const latest = await SELF.fetch('https://example.com/api/v2/modpacks/secret/latest');
    expect(latest.status).toBe(404);
    const versions = await SELF.fetch('https://example.com/api/v2/modpacks/secret/versions');
    expect(versions.status).toBe(404);
    // download: hidden 체크가 토큰 검증보다 먼저 → 토큰 없이도 401이 아니라 404
    const dl = await SELF.fetch('https://example.com/download/v2/modpacks/secret/1.0.0');
    expect(dl.status).toBe(404);
  });

  it('visible pack still serves latest', async () => {
    await seedPack('open', { version: '1.0.0' });
    const res = await SELF.fetch('https://example.com/api/v2/modpacks/open/latest');
    expect(res.status).toBe(200);
    expect((await res.json()).version).toBe('1.0.0');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd cloudflare-worker && npx vitest run test/modpacks-public.test.js -t hidden`
Expected: FAIL — latest 200, download 401(토큰) 등.

- [ ] **Step 3: 구현** — index.js에 헬퍼 추가(`handleModpacksAPI` 위):

```js
/** 팩 비공개 여부 — modpacks/{id}/meta.json의 hidden. meta 없음/손상 = 공개. */
async function isPackHidden(env, id) {
  const obj = await env.RELEASES.get(`modpacks/${id}/meta.json`);
  if (!obj) return false;
  try { return !!JSON.parse(await obj.text())?.hidden; } catch { return false; }
}
```

세 라우트의 id 패턴 검증 **직후**(download는 토큰 검증 **앞**)에 동일 블록 삽입:

```js
    if (await isPackHidden(env, id)) {
      return jsonResponse({ error: 'Not Found', message: '팩을 찾을 수 없습니다.' }, 404, corsHeaders);
    }
```

(download 라우트는 구조분해 `const [, id, version]`이므로 그 줄과 패턴 검증 뒤, `token` 추출 앞에 넣는다.)

- [ ] **Step 4: 통과 확인**

Run: `cd cloudflare-worker && npm test`
Expected: 전체 PASS.

- [ ] **Step 5: 커밋**

```bash
git add cloudflare-worker/src/index.js cloudflare-worker/test/modpacks-public.test.js
git commit -m "feat: 비공개 혜니팩 id 전체 404(latest/versions/download, 토큰 검증보다 먼저)"
```

---

### Task 4: admin visibility API + listPacks에 name/hidden (packs.js)

**Files:**
- Modify: `cloudflare-worker/src/admin/packs.js`
- Test: `cloudflare-worker/test/packs.test.js` (추가)

**Interfaces:**
- Produces: `PATCH /admin/api/modpacks/{id}/visibility` body `{hidden: boolean}` → `{id, hidden}`. admin `listPacks` 응답 항목에 `name`(meta, 폴백 id)·`hidden`(bool) 추가.
- Consumes: Task 1의 meta 형식.

- [ ] **Step 1: 실패하는 테스트 작성** — `packs.test.js`에 추가:

```js
describe('PATCH /admin/api/modpacks/{id}/visibility', () => {
  it('sets hidden and preserves name/minecraft; list shows hidden flag', async () => {
    await handlePacks(await publishZipReq('vispack', '1.0.0', {
      formatVersion: 1, hyenipackId: 'vispack', name: '비공개될팩', version: '1.0.0',
      minecraft: { version: '1.21.1', loaderType: 'neoforge', loaderVersion: '21.1.1' },
      mods: [], breaking: false,
    }), env);
    const res = await handlePacks(
      req('PATCH', '/admin/api/modpacks/vispack/visibility', { hidden: true }), env);
    expect(res.status).toBe(200);
    expect((await res.json()).hidden).toBe(true);
    const meta = await getJson(env, 'modpacks/vispack/meta.json');
    expect(meta.hidden).toBe(true);
    expect(meta.name).toBe('비공개될팩');   // 보존
    const list = await handlePacks(req('GET', '/admin/api/modpacks'), env);
    const item = (await list.json()).packs.find((p) => p.id === 'vispack');
    expect(item.hidden).toBe(true);
    expect(item.name).toBe('비공개될팩');
  });

  it('400 on non-boolean hidden, 404 on unknown pack', async () => {
    const bad = await handlePacks(
      req('PATCH', '/admin/api/modpacks/vispack/visibility', { hidden: 'yes' }), env);
    expect(bad.status).toBe(400);
    const nf = await handlePacks(
      req('PATCH', '/admin/api/modpacks/nope/visibility', { hidden: true }), env);
    expect(nf.status).toBe(404);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd cloudflare-worker && npx vitest run test/packs.test.js -t visibility`
Expected: FAIL — 라우트 없음 404.

- [ ] **Step 3: 구현** — `handlePacks`에 라우트 추가(`latestM` 블록 근처, 기존 id 디코드/검증 관례 그대로):

```js
  const visM = path.match(/^\/admin\/api\/modpacks\/([^/]+)\/visibility$/);
  if (visM && method === 'PATCH') {
    const id = safeDecode(visM[1]);
    if (id === null || !PACK_ID_PATTERN.test(id)) return adminJson({ error: 'Invalid id' }, 400);
    return await setPackVisibility(request, env, id);
  }
```

핸들러 추가:

```js
async function setPackVisibility(request, env, id) {
  let body;
  try { body = await request.json(); } catch { return adminJson({ error: 'JSON 본문 필요' }, 400); }
  if (typeof body.hidden !== 'boolean') return adminJson({ error: 'hidden(boolean)이 필요합니다.' }, 400);
  const latest = await getJson(env, `modpacks/${id}/latest.json`);
  if (!latest) return adminJson({ error: 'Not Found' }, 404);
  const existing = await getJson(env, `modpacks/${id}/meta.json`);
  await putJson(env, `modpacks/${id}/meta.json`, {
    name: existing?.name ?? id,
    minecraft: existing?.minecraft ?? null,
    hidden: body.hidden,
    updatedAt: isoNow(),
  });
  return adminJson({ id, hidden: body.hidden });
}
```

`listPacks`의 push에 meta 기반 필드 추가(루프 안에서 `const meta = await getJson(env, \`modpacks/${id}/meta.json\`);` 후):

```js
    packs.push({
      id,
      name: meta?.name ?? id,
      hidden: !!meta?.hidden,
      // ...기존 필드(latestVersion, breaking, minecraft) 유지
```

- [ ] **Step 4: 통과 확인**

Run: `cd cloudflare-worker && npm test`
Expected: 전체 PASS.

- [ ] **Step 5: 커밋**

```bash
git add cloudflare-worker/src/admin/packs.js cloudflare-worker/test/packs.test.js
git commit -m "feat: 혜니팩 visibility API + admin 목록에 name/hidden"
```

---

### Task 5: 관리 UI — 이름 표시 + 공개/비공개 토글

**Files:**
- Modify: `cloudflare-worker/admin/src/api.ts`
- Modify: `cloudflare-worker/admin/src/packs/PacksView.tsx`
- Modify: `cloudflare-worker/admin/src/packs/PackVersions.tsx`
- Modify: `cloudflare-worker/admin/src/styles.css`

**Interfaces:**
- Consumes: Task 4의 listPacks `name`/`hidden`, `PATCH /visibility`.
- Produces: `api.setPackVisibility(id, hidden)`.

- [ ] **Step 1: api.ts에 함수 추가** (`deletePackVersion` 아래):

```ts
export const setPackVisibility = (id: string, hidden: boolean) =>
  req(`/modpacks/${id}/visibility`, json('PATCH', { hidden }));
```

- [ ] **Step 2: PacksView — Pack 타입/레일/전달**

`interface Pack`에 `name: string; hidden: boolean;` 추가. 레일 아이템을 모드와 동일 구조로(이름 크게 + id·버전 작게 + 비공개 배지):

```tsx
                <span class="rail-name">{p.name}{p.hidden && <span class="badge badge-hidden"> 비공개</span>}</span>
                <span class="rail-id">{p.id} · v{p.latestVersion}{p.breaking ? ' · breaking' : ''}</span>
```

선택 팩 전달: `const sel = packs.find((p) => p.id === selected);` 후

```tsx
          ? <PackVersions packId={selected} name={sel?.name} hidden={sel?.hidden ?? false}
              onToast={onToast} onChanged={() => setRefreshKey((k) => k + 1)} />
```

- [ ] **Step 3: PackVersions — 헤더 name+packId + 토글**

props에 `name?: string; hidden: boolean;` 추가. 헤더를 모드(ModVersions)와 동일 패턴으로 교체하고 토글 버튼 추가:

```tsx
      <div class="panel-head">
        <div>
          <h3 class="panel-title">{name || packId}{hidden && <span class="badge badge-hidden"> 비공개</span>}</h3>
          <span class="panel-id mono">packId: {packId}</span>
        </div>
        <div class="btn-row">
          <button class="btn btn-sm" onClick={() => hidden ? doSetVisibility(false) : setVisConfirm(true)}>
            {hidden ? '공개로 전환' : '비공개로 전환'}
          </button>
          <span class="panel-sub">현재 latest: {latest ? <span class="mono">{latest}</span> : '없음'}</span>
        </div>
      </div>
```

상태/핸들러(컴포넌트 내부):

```tsx
  const [visConfirm, setVisConfirm] = useState(false);

  async function doSetVisibility(next: boolean) {
    try {
      await api.setPackVisibility(packId, next);
      onToast(next ? '비공개로 전환됨 — 목록·조회·다운로드 차단' : '공개로 전환됨');
      onChanged();
    } catch (e: any) { onToast(e.message, 'err'); }
  }
```

비공개 전환 확인(기존 ConfirmDialog가 이미 이 파일에 있으면 상태 통합, 없으면 추가 렌더):

```tsx
      <ConfirmDialog open={visConfirm}
        message={`${name || packId}을(를) 비공개로 전환할까요?\n\n목록·조회·다운로드가 모두 차단됩니다. 이미 설치한 사용자는 게임 실행은 되고 업데이트만 멈춥니다.`}
        onCancel={() => setVisConfirm(false)}
        onConfirm={() => { doSetVisibility(true); setVisConfirm(false); }} />
```

(PackVersions에 ConfirmDialog가 이미 있으면 그 confirm 상태 패턴을 그대로 따라 별도 상태로 추가. import 확인.)

- [ ] **Step 4: styles.css에 배지 추가** (`.badge-latest` 근처):

```css
.badge-hidden { background: color-mix(in srgb, var(--text-faint) 18%, transparent); color: var(--text-muted); }
```

(기존 `.badge` 계열이 다른 변수 패턴을 쓰면 그 파일의 badge 관례를 따른다 — 예: `.badge-cat`과 동일 형태로.)

- [ ] **Step 5: 빌드 확인**

Run: `cd cloudflare-worker/admin && npm run build`
Expected: tsc+vite green.

- [ ] **Step 6: 커밋**

```bash
git add cloudflare-worker/admin/src/api.ts cloudflare-worker/admin/src/packs/PacksView.tsx cloudflare-worker/admin/src/packs/PackVersions.tsx cloudflare-worker/admin/src/styles.css
git commit -m "feat: 관리 UI 혜니팩 이름 표시 + 공개/비공개 토글"
```

---

## Self-Review

**스펙 커버리지(§2-2)**: meta.json 별도 객체·hidden 보존(Task 1), name/minecraft 게시·롤백 갱신(Task 1), 공개 목록 unzip 없음·hidden 제외·완전 공개(Task 2), id 전체 404·다운로드 토큰 전 체크(Task 3), admin visibility API+UI 토글+배지(Task 4·5), 기존 팩 폴백(전 태스크 폴백 로직). ✅

**타입 일관성**: meta 형식 `{name, minecraft, hidden, updatedAt}` 4곳(Task 1 생성, 2·3 소비, 4 갱신) 동일. `setPackVisibility` 이름 api.ts/packs.js 동일. ✅

**플레이스홀더**: 없음. UI 태스크의 "기존 관례를 따른다" 2곳은 구현 재량이 아니라 스타일 정합 지시. ✅

## 배포/후속
- 완료 후 `npm run deploy` 1회(이번 누적분: latest 정책 + admin UI 개선 + 이 계획 전체). 배포는 사용자.
- Plan C-2(런처: 토큰 저장소 + 설치 UI + 딥링크)는 C-1 배포 후 별도 계획으로.
