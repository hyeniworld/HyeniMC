# 관리 패널 프론트엔드(Admin SPA) 구현 계획 — Plan 2/2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 `hyenimc-worker`가 `/admin` 경로로 Vite+Preact SPA를 서빙하게 하여, Plan 1의 `/admin/api/*` 관리 API를 실제 UI(모드·혜니팩 게시/목록/롤백/삭제/편집 + 레지스트리 재생성)로 조작할 수 있게 한다.

**Architecture:** SPA를 `cloudflare-worker/admin/`(자체 Vite+Preact 프로젝트)에서 `cloudflare-worker/public/admin/`으로 빌드하고, Worker의 Static Assets 바인딩(`[assets] directory="./public"`)이 이를 정적 서빙한다. Cloudflare 기본 라우팅상 실제 에셋은 Worker 없이 서빙되고, 매칭 안 되는 요청만 Worker로 떨어진다 — `/admin/api/*`는 관리 API로, 나머지 `/admin/*`(딥 클라이언트 경로)은 Worker가 `env.ASSETS`로 `index.html`을 돌려주는 1줄 폴백으로 처리한다. 라우팅은 탭 상태(모드/혜니팩)로만 하고 URL 라우터는 쓰지 않는다(개인 도구, KISS).

**Tech Stack:** Vite + Preact + TypeScript(tsx) · `@preact/preset-vite` · vitest(순수 로직 단위 테스트) · Cloudflare Workers Static Assets(wrangler 3.114.17, 업그레이드 불필요) · 브라우저 `crypto.subtle`(sha256) · `FormData`(멀티파트 업로드).

**설계 문서:** [docs/superpowers/specs/2026-07-08-management-panel-design.md](../specs/2026-07-08-management-panel-design.md)
**백엔드 계획(완료):** [docs/superpowers/plans/2026-07-08-management-panel-backend.md](2026-07-08-management-panel-backend.md)

## Global Constraints

- 작업 디렉터리 루트: `cloudflare-worker/`. 브랜치 `feat/tauri-m0` — 브랜치 전환 금지. 커밋 `<type>: <description>`, Co-Authored-By 금지.
- `wrangler.toml`은 저장소 관례상 **gitignore됨**(로컬 전용). 배포/테스트 설정 변경은 로컬 `wrangler.toml`에 반영하되 **커밋하지 않고**, 추적되는 `wrangler.toml.example`에 문서화한다.
- 빌드 산출물 `public/`는 gitignore한다(단 `public/.gitkeep`은 추적 — 에셋 디렉터리가 존재해야 테스트 하니스가 부팅됨).
- **Plan 1의 공개 API/관리 API/기존 라우팅을 변경하지 않는다.** index.js에는 SPA 폴백 분기 1개만 추가한다.
- **Static Assets 라우팅 규칙(검증됨)**: 실제 에셋 매칭 시 Worker 미호출; 매칭 실패 시 Worker의 `fetch`가 호출됨. `not_found_handling`은 **설정하지 않는다**(기본 `"none"` — 미매칭이 SPA로 가로채이지 않고 Worker로 떨어져 공개 라우트가 깨지지 않음). `run_worker_first`도 쓰지 않는다.
- 관리 API 계약(Plan 1, 프론트가 소비 — 변경 불가):
  - `GET /admin/api/mods` → `{mods:[{id,name,description,latestVersion,category,gameVersions,loaders:[{type,minVersion,maxVersion,supportedGameVersions}],dependencies}]}`
  - `GET /admin/api/mods/{id}/versions` → `{id,latestVersion,versions:[{version,releaseDate,gameVersions,changelog,category}]}`
  - `POST /admin/api/mods/{id}/versions` (multipart: `meta` JSON 필드 + 파일 파트들; `?overwrite=true` 옵션) → 201 `{version,files:[{file,sha256,size}]}` | 400/409/500 `{error,...}`
    - `meta` = `{modId,name,version,category,changelog,releaseDate?,files:[{loader,gameVersion,fileField,fileName,minLoaderVersion,maxLoaderVersion,dependencies}]}`; 각 `fileField`는 같은 폼의 파일 파트 이름.
  - `PATCH /admin/api/mods/{id}/latest` (JSON `{version}`) → 200 | 404 (롤백)
  - `PATCH /admin/api/mods/{id}/versions/{ver}` (JSON `{changelog?,category?,minLoaderVersion?,maxLoaderVersion?,dependencies?}`) → 200 | 404
  - `DELETE /admin/api/mods/{id}/versions/{ver}` → 200 | 404 | 409(현재 latest 차단)
  - `GET /admin/api/modpacks` → `{packs:[{id,latestVersion,breaking}]}`
  - `GET /admin/api/modpacks/{id}/versions` → `{id,latestVersion,versions:[{version,changelog,breaking}]}`
  - `POST /admin/api/modpacks/{id}/versions` (multipart: `pack` 파일 + `latest` JSON 필드 = 사이드카 `{hyenipackId,version,sha256,changelog?,breaking?}`; `?overwrite=true`) → 201 | 400(sha256 불일치 포함)/409
  - `PATCH /admin/api/modpacks/{id}/latest` (JSON `{version}`) → 200 | 404
  - `PATCH /admin/api/modpacks/{id}/versions/{ver}` (JSON `{changelog?,breaking?}`) → 200 | 404
  - `DELETE /admin/api/modpacks/{id}/versions/{ver}` → 200 | 404 | 409
  - `POST /admin/api/registry/rebuild` → 200 `{ok,count}`
- 인증: 프론트는 별도 인증 코드 없음. Access가 엣지에서 세션 쿠키를 붙이고 same-origin fetch에 자동 포함된다. 401 응답은 "Access 세션 만료 → 새로고침" 안내로 처리.

---

## 파일 구조

| 파일 | 책임 | 신규/수정 |
|------|------|-----------|
| `wrangler.toml` (로컬) / `wrangler.toml.example` (추적) | `[assets]` 블록 추가 | 수정 |
| `.gitignore` | `public/*` 무시(+`.gitkeep` 예외) | 수정 |
| `public/.gitkeep` | 에셋 디렉터리 존재 보장 | 신규(추적) |
| `src/index.js` | `/admin` SPA 폴백 분기 1개 추가 | 수정 |
| `package.json` (worker) | `build:admin`, `deploy` 스크립트 | 수정 |
| `admin/package.json` | 프론트 툴체인 + 스크립트 | 신규 |
| `admin/vite.config.ts` | base `/admin/`, outDir `../public/admin` | 신규 |
| `admin/tsconfig.json` | TS/JSX 설정 | 신규 |
| `admin/index.html` | SPA 진입 HTML | 신규 |
| `admin/src/main.tsx` | 부트스트랩 | 신규 |
| `admin/src/App.tsx` | 탭(모드/혜니팩) + 전역 토스트 + 재생성 | 신규 |
| `admin/src/api.ts` | 관리 API fetch 래퍼 | 신규 |
| `admin/src/lib/validate.ts` | 폼 검증(순수) | 신규 |
| `admin/src/lib/formdata.ts` | 멀티파트 FormData 빌더(순수) | 신규 |
| `admin/src/lib/sha256.ts` | 브라우저 sha256 | 신규 |
| `admin/src/lib/*.test.ts` | 순수 로직 단위 테스트 | 신규 |
| `admin/src/components/Toast.tsx`, `ConfirmDialog.tsx`, `Field.tsx` | 공용 UI | 신규 |
| `admin/src/mods/ModsView.tsx`, `ModVersions.tsx`, `ModPublishForm.tsx` | 모드 UI | 신규 |
| `admin/src/packs/PacksView.tsx`, `PackVersions.tsx`, `PackPublishForm.tsx` | 혜니팩 UI | 신규 |

빌드 흐름: `admin/`(Vite root, index.html+src) → `vite build` → `cloudflare-worker/public/admin/`(index.html+assets) → `[assets] directory="./public"`가 `/admin/*`로 서빙.

---

## Task 1: 에셋 설정 + Worker SPA 폴백 + Vite/Preact 스캐폴드 + 빌드/배포 배선

**Files:**
- Modify: `cloudflare-worker/wrangler.toml.example` (그리고 로컬 `wrangler.toml` — 커밋 안 함)
- Modify: `cloudflare-worker/.gitignore`
- Create: `cloudflare-worker/public/.gitkeep`
- Modify: `cloudflare-worker/src/index.js` (SPA 폴백 분기)
- Modify: `cloudflare-worker/package.json` (build:admin, deploy)
- Create: `cloudflare-worker/admin/package.json`, `admin/vite.config.ts`, `admin/tsconfig.json`, `admin/index.html`, `admin/src/main.tsx`, `admin/src/App.tsx`
- Test: 기존 백엔드 스위트(58) 회귀 확인 + SPA 빌드/서빙 수동 확인

**Interfaces:**
- Produces: `env.ASSETS` 바인딩 사용 가능; `/admin`·`/admin/*`(비-API) 요청 시 Worker가 `public/admin/index.html`을 반환; `npm run build:admin`이 `public/admin/`을 생성.

- [ ] **Step 1: wrangler.toml.example + 로컬 wrangler.toml에 [assets] 추가**

`wrangler.toml.example`의 `[env.production]` 블록 **위**에 삽입(그리고 동일 내용을 로컬 `wrangler.toml`에도 추가 — 로컬은 커밋하지 않음):

```toml
# 관리 패널 SPA(Vite+Preact) 정적 서빙. admin/ 빌드 산출물이 public/admin/로 나온다.
# 실제 에셋은 Worker 없이 서빙되고, 미매칭 요청만 src/index.js로 떨어진다.
[assets]
directory = "./public"
binding = "ASSETS"
```

- [ ] **Step 2: .gitignore + public/.gitkeep**

`cloudflare-worker/.gitignore`에 추가:

```
# 관리 SPA 빌드 산출물(디렉터리는 유지 — 테스트 하니스 부팅에 필요)
/public/*
!/public/.gitkeep
```

`public/.gitkeep` 생성(빈 파일):

```
```

- [ ] **Step 3: 실패하는 회귀 확인 준비 — 기존 스위트가 [assets]와 함께 통과하는지 먼저 확인**

Run: `cd cloudflare-worker && npx vitest run`
Expected: 58/58 PASS. `[assets]`가 `./public`(현재 `.gitkeep`만 있음)를 가리켜도 기존 테스트는 `/admin/api/*`·공개 라우트만 검증하므로 통과해야 한다. 만약 miniflare가 에셋 디렉터리 부재로 실패하면 `public/` 디렉터리 존재를 확인(Step 2의 `.gitkeep`).

- [ ] **Step 4: index.js에 SPA 폴백 분기 추가**

`src/index.js`에서 기존 admin API 분기 바로 **다음**에 삽입(현재):

```js
      // Route: Admin API (Cloudflare Access 보호)
      if (path.startsWith('/admin/api/')) {
        const { handleAdminApi } = await import('./admin/router.js');
        return await handleAdminApi(request, env, ctx);
      }
```

바로 아래에 추가:

```js
      // Route: Admin SPA 셸 폴백.
      // 여기 도달 = Cloudflare 에셋 레이어가 /admin/* 아래 실제 파일 매칭에 실패한 경우.
      // (실제 index.html/JS/CSS는 이미 Worker 없이 직접 서빙됨.) 딥 클라이언트 경로만 여기로 온다.
      if (path === '/admin' || path.startsWith('/admin/')) {
        return env.ASSETS.fetch(new URL('/admin/index.html', request.url));
      }
```

> 주의: 이 분기는 `/admin/api/` 검사 **뒤**에 와야 한다(`/admin/api/`도 `/admin/`으로 시작하므로 순서 중요). 이후 공개 라우트들은 그대로 둔다.

- [ ] **Step 5: worker package.json 스크립트 추가**

`cloudflare-worker/package.json`의 `scripts`에 추가(기존 스크립트 유지):

```json
    "build:admin": "npm --prefix admin run build",
    "deploy": "npm run build:admin && wrangler deploy",
```

(기존 `"deploy": "wrangler publish"`를 위 값으로 교체.)

- [ ] **Step 6: admin/ Vite+Preact 프로젝트 생성**

`admin/package.json`:

```json
{
  "name": "hyenimc-admin",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "preact": "^10.24.0"
  },
  "devDependencies": {
    "@preact/preset-vite": "^2.9.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  }
}
```

`admin/vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  base: '/admin/',
  build: {
    outDir: '../public/admin',
    emptyOutDir: true,
  },
});
```

`admin/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "jsxImportSource": "preact",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "strict": true,
    "skipLibCheck": true,
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

`admin/index.html`:

```html
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>HyeniMC 관리</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/admin/src/main.tsx"></script>
  </body>
</html>
```

`admin/src/main.tsx`:

```tsx
import { render } from 'preact';
import { App } from './App';

render(<App />, document.getElementById('app')!);
```

`admin/src/App.tsx` (Task 1에서는 최소 셸 — Task 6에서 탭/기능 완성):

```tsx
export function App() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24 }}>
      <h1>HyeniMC 관리 패널</h1>
      <p>준비 중…</p>
    </main>
  );
}
```

- [ ] **Step 7: admin 의존성 설치 + 빌드 확인**

Run:
```
cd cloudflare-worker/admin && npm install && npm run build
```
Expected: `cloudflare-worker/public/admin/index.html` + `public/admin/assets/*` 생성. 오류 없음.

- [ ] **Step 8: 회귀 스위트 재확인**

Run: `cd cloudflare-worker && npx vitest run`
Expected: 58/58 PASS (여전히). 빌드된 `public/admin/`이 있어도 백엔드 테스트에 영향 없음.

- [ ] **Step 9: 로컬 서빙 수동 확인(선택, 기록만)**

`cd cloudflare-worker && npx wrangler dev` 후 다른 터미널에서:
- `curl -s -o /dev/null -w "%{http_code}\n" localhost:8787/admin/` → 200 (index.html)
- `curl -s -o /dev/null -w "%{http_code}\n" localhost:8787/admin/api/ping` → 401 (Access 게이트, 로컬은 JWT 없음)
- `curl -s -o /dev/null -w "%{http_code}\n" localhost:8787/health` → 200

리포트에 결과를 기록(자동 테스트 아님).

- [ ] **Step 10: 커밋**

```bash
cd cloudflare-worker
git add .gitignore public/.gitkeep src/index.js package.json wrangler.toml.example \
  admin/package.json admin/vite.config.ts admin/tsconfig.json admin/index.html \
  admin/src/main.tsx admin/src/App.tsx
git commit -m "feat: 관리 SPA 스캐폴드 + Static Assets 서빙 + /admin 폴백"
```

---

## Task 2: API 클라이언트 + 순수 검증/FormData/sha256 로직 (단위 테스트)

**Files:**
- Create: `admin/src/api.ts`
- Create: `admin/src/lib/validate.ts`, `admin/src/lib/formdata.ts`, `admin/src/lib/sha256.ts`
- Create: `admin/src/lib/validate.test.ts`, `admin/src/lib/formdata.test.ts`, `admin/src/lib/sha256.test.ts`

**Interfaces:**
- Produces:
  - `api.ts`: `listMods()`, `listModVersions(id)`, `publishMod(id, formData, overwrite)`, `rollbackMod(id, version)`, `editModVersion(id, ver, patch)`, `deleteModVersion(id, ver)`, `listPacks()`, `listPackVersions(id)`, `publishPack(id, formData, overwrite)`, `rollbackPack(id, version)`, `editPackVersion(id, ver, patch)`, `deletePackVersion(id, ver)`, `rebuildRegistry()`. 모두 `Promise`; 비-2xx는 `ApiError{status, message}`로 throw.
  - `validate.ts`: `validateModPublish(input) -> string[]`, `validatePackPublish(input) -> string[]` (빈 배열 = 통과).
  - `formdata.ts`: `buildModPublishForm(meta, files: Map<string, File>) -> FormData`, `buildPackPublishForm(pack: File, sidecar: object) -> FormData`.
  - `sha256.ts`: `sha256Hex(buffer: ArrayBuffer) -> Promise<string>`.

- [ ] **Step 1: sha256 실패 테스트**

`admin/src/lib/sha256.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { sha256Hex } from './sha256';

describe('sha256Hex', () => {
  it('matches known vector for "abc"', async () => {
    const hex = await sha256Hex(new TextEncoder().encode('abc').buffer);
    expect(hex).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd cloudflare-worker/admin && npx vitest run src/lib/sha256.test.ts`
Expected: FAIL — sha256.ts 없음.

- [ ] **Step 3: sha256.ts 구현**

`admin/src/lib/sha256.ts`:

```ts
export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
```

- [ ] **Step 4: 검증 로직 실패 테스트**

`admin/src/lib/validate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validateModPublish, validatePackPublish } from './validate';

describe('validateModPublish', () => {
  const base = {
    modId: 'hyenihelper', name: 'HyeniHelper', version: '1.0.5',
    category: 'required', changelog: 'x',
    files: [{ loader: 'neoforge', gameVersion: '1.21.1', file: {} as File,
      fileName: 'a.jar', minLoaderVersion: '21.1.200', maxLoaderVersion: '', dependencies: '{}' }],
  };
  it('passes a valid input', () => {
    expect(validateModPublish(base)).toEqual([]);
  });
  it('rejects bad version', () => {
    expect(validateModPublish({ ...base, version: '1.0' }).length).toBeGreaterThan(0);
  });
  it('rejects empty files', () => {
    expect(validateModPublish({ ...base, files: [] }).length).toBeGreaterThan(0);
  });
  it('rejects a file missing loader', () => {
    const bad = { ...base, files: [{ ...base.files[0], loader: '' }] };
    expect(validateModPublish(bad).length).toBeGreaterThan(0);
  });
  it('rejects invalid dependencies JSON', () => {
    const bad = { ...base, files: [{ ...base.files[0], dependencies: '{bad' }] };
    expect(validateModPublish(bad).length).toBeGreaterThan(0);
  });
});

describe('validatePackPublish', () => {
  it('rejects missing pack file or bad version', () => {
    expect(validatePackPublish({ pack: null, version: '1.0.0' }).length).toBeGreaterThan(0);
    expect(validatePackPublish({ pack: {} as File, version: 'x' }).length).toBeGreaterThan(0);
  });
  it('passes valid', () => {
    expect(validatePackPublish({ pack: {} as File, version: '1.0.0' })).toEqual([]);
  });
});
```

- [ ] **Step 5: 검증 실패 확인 → validate.ts 구현**

Run: `cd cloudflare-worker/admin && npx vitest run src/lib/validate.test.ts` → FAIL. 그다음 구현:

`admin/src/lib/validate.ts`:

```ts
const VERSION = /^\d+\.\d+\.\d+$/;
const LOADER = /^[a-z0-9]+$/;
const GAME_VERSION = /^\d+\.\d+(\.\d+)?$/;
const FILE_NAME = /^[A-Za-z0-9._+-]+\.jar$/;

export interface ModFileInput {
  loader: string; gameVersion: string; file: File | null; fileName: string;
  minLoaderVersion: string; maxLoaderVersion: string; dependencies: string;
}
export interface ModPublishInput {
  modId: string; name: string; version: string; category: string;
  changelog: string; files: ModFileInput[];
}

export function validateModPublish(input: ModPublishInput): string[] {
  const errors: string[] = [];
  if (!input.modId) errors.push('modId를 입력하세요.');
  if (!input.name) errors.push('name을 입력하세요.');
  if (!VERSION.test(input.version)) errors.push('version은 x.y.z 형식이어야 합니다.');
  if (!input.category) errors.push('category를 입력하세요.');
  if (!input.files || input.files.length === 0) errors.push('파일을 1개 이상 추가하세요.');
  input.files?.forEach((f, i) => {
    const n = i + 1;
    if (!LOADER.test(f.loader)) errors.push(`파일 ${n}: loader 형식이 올바르지 않습니다.`);
    if (!GAME_VERSION.test(f.gameVersion)) errors.push(`파일 ${n}: gameVersion 형식이 올바르지 않습니다.`);
    if (!f.file) errors.push(`파일 ${n}: jar 파일을 선택하세요.`);
    if (!FILE_NAME.test(f.fileName)) errors.push(`파일 ${n}: 파일명은 .jar이어야 하고 경로문자를 포함할 수 없습니다.`);
    if (!f.minLoaderVersion) errors.push(`파일 ${n}: minLoaderVersion을 입력하세요.`);
    try { JSON.parse(f.dependencies || '{}'); } catch { errors.push(`파일 ${n}: dependencies가 유효한 JSON이 아닙니다.`); }
  });
  return errors;
}

export function validatePackPublish(input: { pack: File | null; version: string }): string[] {
  const errors: string[] = [];
  if (!input.pack) errors.push('.hyenipack 파일을 선택하세요.');
  if (!VERSION.test(input.version)) errors.push('version은 x.y.z 형식이어야 합니다.');
  return errors;
}
```

Run: `npx vitest run src/lib/validate.test.ts` → PASS.

- [ ] **Step 6: FormData 빌더 실패 테스트**

`admin/src/lib/formdata.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildModPublishForm, buildPackPublishForm } from './formdata';

describe('buildModPublishForm', () => {
  it('produces meta JSON + file parts named by fileField', () => {
    const files = new Map<string, File>([['jar0', new File(['x'], 'a.jar')]]);
    const meta = { modId: 'm', name: 'M', version: '1.0.0', category: 'required',
      changelog: 'c', files: [{ loader: 'neoforge', gameVersion: '1.21.1',
        fileField: 'jar0', fileName: 'a.jar', minLoaderVersion: '1', maxLoaderVersion: null, dependencies: {} }] };
    const fd = buildModPublishForm(meta, files);
    expect(JSON.parse(fd.get('meta') as string).modId).toBe('m');
    expect(fd.get('jar0')).toBeInstanceOf(File);
  });
});

describe('buildPackPublishForm', () => {
  it('produces pack + latest fields', () => {
    const fd = buildPackPublishForm(new File(['x'], 'p.hyenipack'), { hyenipackId: 'p', version: '1.0.0', sha256: 'abc' });
    expect(fd.get('pack')).toBeInstanceOf(File);
    expect(JSON.parse(fd.get('latest') as string).hyenipackId).toBe('p');
  });
});
```

- [ ] **Step 7: 실패 확인 → formdata.ts 구현**

Run: `npx vitest run src/lib/formdata.test.ts` → FAIL. 구현:

`admin/src/lib/formdata.ts`:

```ts
export function buildModPublishForm(meta: unknown, files: Map<string, File>): FormData {
  const fd = new FormData();
  fd.set('meta', JSON.stringify(meta));
  for (const [field, file] of files) fd.set(field, file);
  return fd;
}

export function buildPackPublishForm(pack: File, sidecar: unknown): FormData {
  const fd = new FormData();
  fd.set('pack', pack);
  fd.set('latest', JSON.stringify(sidecar));
  return fd;
}
```

Run: `npx vitest run src/lib/formdata.test.ts` → PASS.

- [ ] **Step 8: api.ts 구현(테스트는 순수 로직에 집중 — api는 수동/통합 확인)**

`admin/src/api.ts`:

```ts
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

const BASE = '/admin/api';

async function req(path: string, opts: RequestInit = {}): Promise<any> {
  const res = await fetch(`${BASE}${path}`, opts);
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new ApiError(res.status, body.error || `요청 실패 (${res.status})`);
  }
  return body;
}

const json = (method: string, obj: unknown): RequestInit => ({
  method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj),
});

// mods
export const listMods = () => req('/mods');
export const listModVersions = (id: string) => req(`/mods/${id}/versions`);
export const publishMod = (id: string, fd: FormData, overwrite = false) =>
  req(`/mods/${id}/versions${overwrite ? '?overwrite=true' : ''}`, { method: 'POST', body: fd });
export const rollbackMod = (id: string, version: string) =>
  req(`/mods/${id}/latest`, json('PATCH', { version }));
export const editModVersion = (id: string, ver: string, patch: object) =>
  req(`/mods/${id}/versions/${ver}`, json('PATCH', patch));
export const deleteModVersion = (id: string, ver: string) =>
  req(`/mods/${id}/versions/${ver}`, { method: 'DELETE' });

// modpacks
export const listPacks = () => req('/modpacks');
export const listPackVersions = (id: string) => req(`/modpacks/${id}/versions`);
export const publishPack = (id: string, fd: FormData, overwrite = false) =>
  req(`/modpacks/${id}/versions${overwrite ? '?overwrite=true' : ''}`, { method: 'POST', body: fd });
export const rollbackPack = (id: string, version: string) =>
  req(`/modpacks/${id}/latest`, json('PATCH', { version }));
export const editPackVersion = (id: string, ver: string, patch: object) =>
  req(`/modpacks/${id}/versions/${ver}`, json('PATCH', patch));
export const deletePackVersion = (id: string, ver: string) =>
  req(`/modpacks/${id}/versions/${ver}`, { method: 'DELETE' });

// registry
export const rebuildRegistry = () => req('/registry/rebuild', { method: 'POST' });
```

- [ ] **Step 9: 전체 admin 테스트 통과 확인**

Run: `cd cloudflare-worker/admin && npx vitest run`
Expected: PASS (sha256 1 + validate 7 + formdata 2 = 10).

- [ ] **Step 10: 커밋**

```bash
cd cloudflare-worker
git add admin/src/api.ts admin/src/lib/
git commit -m "feat: 관리 SPA API 클라이언트 + 검증/FormData/sha256 로직"
```

---

## Task 3: 공용 컴포넌트 + 모드 목록·버전 관리 UI

**Files:**
- Create: `admin/src/components/Toast.tsx`, `admin/src/components/ConfirmDialog.tsx`, `admin/src/components/Field.tsx`
- Create: `admin/src/mods/ModsView.tsx`, `admin/src/mods/ModVersions.tsx`

**Interfaces:**
- Consumes: `api.ts` (listMods/listModVersions/rollbackMod/editModVersion/deleteModVersion).
- Produces:
  - `Toast` + `useToast()` 훅(간단 전역 메시지). 시그니처: `const { toasts, push } = useToast()`; `push(message: string, kind?: 'ok'|'err')`.
  - `ConfirmDialog({ open, message, onConfirm, onCancel })`.
  - `Field({ label, children })` 라벨 래퍼.
  - `ModsView({ onToast })` — 모드 목록 + 선택 시 `ModVersions` 렌더 + 게시 폼(Task 4에서 연결).
  - `ModVersions({ modId, onToast, onChanged })` — 버전 테이블 + 롤백/편집/삭제 액션.

- [ ] **Step 1: 공용 컴포넌트 구현**

`admin/src/components/Toast.tsx`:

```tsx
import { useState, useCallback } from 'preact/hooks';

export interface ToastItem { id: number; message: string; kind: 'ok' | 'err'; }

export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const push = useCallback((message: string, kind: 'ok' | 'err' = 'ok') => {
    const id = Date.now() + Math.floor(performance.now());
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);
  return { toasts, push };
}

export function Toasts({ items }: { items: ToastItem[] }) {
  return (
    <div style={{ position: 'fixed', top: 12, right: 12, display: 'grid', gap: 8, zIndex: 50 }}>
      {items.map((t) => (
        <div key={t.id} style={{
          padding: '8px 14px', borderRadius: 6, color: '#fff',
          background: t.kind === 'ok' ? '#2e7d32' : '#c62828', maxWidth: 360,
        }}>{t.message}</div>
      ))}
    </div>
  );
}
```

`admin/src/components/ConfirmDialog.tsx`:

```tsx
export function ConfirmDialog({ open, message, onConfirm, onCancel }: {
  open: boolean; message: string; onConfirm: () => void; onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div onClick={onCancel} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)',
      display: 'grid', placeItems: 'center', zIndex: 60,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: '#fff', color: '#111', padding: 20, borderRadius: 8, maxWidth: 420,
      }}>
        <p style={{ whiteSpace: 'pre-line', marginTop: 0 }}>{message}</p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel}>취소</button>
          <button onClick={onConfirm} style={{ background: '#c62828', color: '#fff' }}>확인</button>
        </div>
      </div>
    </div>
  );
}
```

`admin/src/components/Field.tsx`:

```tsx
import type { ComponentChildren } from 'preact';

export function Field({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <label style={{ display: 'grid', gap: 4, fontSize: 14 }}>
      <span style={{ color: '#555' }}>{label}</span>
      {children}
    </label>
  );
}
```

- [ ] **Step 2: ModVersions 구현(버전 테이블 + 롤백/편집/삭제)**

`admin/src/mods/ModVersions.tsx`:

```tsx
import { useEffect, useState } from 'preact/hooks';
import * as api from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';

interface Version { version: string; releaseDate: string | null; changelog: string; category: string; }

export function ModVersions({ modId, onToast, onChanged }: {
  modId: string; onToast: (m: string, k?: 'ok' | 'err') => void; onChanged: () => void;
}) {
  const [latest, setLatest] = useState<string | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [confirm, setConfirm] = useState<{ msg: string; act: () => void } | null>(null);

  async function load() {
    try {
      const data = await api.listModVersions(modId);
      setLatest(data.latestVersion);
      setVersions(data.versions);
    } catch (e: any) { onToast(e.message, 'err'); }
  }
  useEffect(() => { load(); }, [modId]);

  async function run(action: () => Promise<any>, ok: string) {
    try { await action(); onToast(ok); await load(); onChanged(); }
    catch (e: any) { onToast(e.message, 'err'); }
  }

  async function editChangelog(v: Version) {
    const next = prompt('changelog', v.changelog);
    if (next === null) return;
    run(() => api.editModVersion(modId, v.version, { changelog: next }), `${v.version} 편집됨`);
  }

  return (
    <div>
      <h3>버전 (현재 latest: {latest ?? '없음'})</h3>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead><tr>{['버전', '카테고리', 'changelog', '액션'].map((h) => (
          <th key={h} style={{ textAlign: 'left', borderBottom: '1px solid #ccc', padding: 6 }}>{h}</th>
        ))}</tr></thead>
        <tbody>
          {versions.map((v) => (
            <tr key={v.version}>
              <td style={{ padding: 6 }}>{v.version}{v.version === latest ? ' ★' : ''}</td>
              <td style={{ padding: 6 }}>{v.category}</td>
              <td style={{ padding: 6, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.changelog}</td>
              <td style={{ padding: 6, display: 'flex', gap: 6 }}>
                <button disabled={v.version === latest}
                  onClick={() => run(() => api.rollbackMod(modId, v.version), `latest→${v.version}`)}>롤백</button>
                <button onClick={() => editChangelog(v)}>편집</button>
                <button disabled={v.version === latest}
                  onClick={() => setConfirm({
                    msg: `${modId} ${v.version} 버전을 삭제할까요?`,
                    act: () => run(() => api.deleteModVersion(modId, v.version), `${v.version} 삭제됨`),
                  })}>삭제</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ConfirmDialog open={!!confirm} message={confirm?.msg ?? ''}
        onCancel={() => setConfirm(null)}
        onConfirm={() => { confirm?.act(); setConfirm(null); }} />
    </div>
  );
}
```

- [ ] **Step 3: ModsView 구현(목록 + 선택 + ModVersions)**

`admin/src/mods/ModsView.tsx`:

```tsx
import { useEffect, useState } from 'preact/hooks';
import * as api from '../api';
import { ModVersions } from './ModVersions';
import { ModPublishForm } from './ModPublishForm';

interface Mod { id: string; name: string; latestVersion: string; category: string; }

export function ModsView({ onToast }: { onToast: (m: string, k?: 'ok' | 'err') => void }) {
  const [mods, setMods] = useState<Mod[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  async function load() {
    try { setMods((await api.listMods()).mods); }
    catch (e: any) { onToast(e.message, 'err'); }
  }
  useEffect(() => { load(); }, [refreshKey]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 24 }}>
      <aside>
        <h3>모드</h3>
        <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 4 }}>
          {mods.map((m) => (
            <li key={m.id}>
              <button style={{ width: '100%', textAlign: 'left', fontWeight: m.id === selected ? 700 : 400 }}
                onClick={() => setSelected(m.id)}>{m.name} <small>({m.latestVersion})</small></button>
            </li>
          ))}
        </ul>
      </aside>
      <section>
        {selected
          ? <ModVersions modId={selected} onToast={onToast} onChanged={() => setRefreshKey((k) => k + 1)} />
          : <p>왼쪽에서 모드를 선택하세요.</p>}
        <hr style={{ margin: '24px 0' }} />
        <ModPublishForm onToast={onToast} onPublished={() => setRefreshKey((k) => k + 1)} />
      </section>
    </div>
  );
}
```

> 참고: `ModPublishForm`은 Task 4에서 생성한다. Task 3 커밋 시점에는 import가 미해결이므로, **Task 3와 Task 4는 순서대로 진행**하고 Task 3 단독 빌드 확인은 생략한다(Task 4 완료 후 Task 4 Step에서 함께 빌드 검증). 리뷰어에게 이 의존을 명시할 것.

- [ ] **Step 4: 커밋**

```bash
cd cloudflare-worker
git add admin/src/components/ admin/src/mods/ModVersions.tsx admin/src/mods/ModsView.tsx
git commit -m "feat: 관리 SPA 공용 컴포넌트 + 모드 목록/버전 관리 UI"
```

---

## Task 4: 모드 게시 폼 (멀티파일)

**Files:**
- Create: `admin/src/mods/ModPublishForm.tsx`

**Interfaces:**
- Consumes: `api.publishMod`, `lib/validate.validateModPublish`, `lib/formdata.buildModPublishForm`.
- Produces: `ModPublishForm({ onToast, onPublished })` — 멀티파일 행 폼 → 검증 → FormData → POST.

- [ ] **Step 1: ModPublishForm 구현**

`admin/src/mods/ModPublishForm.tsx`:

```tsx
import { useState } from 'preact/hooks';
import * as api from '../api';
import { validateModPublish, type ModFileInput } from '../lib/validate';
import { buildModPublishForm } from '../lib/formdata';
import { Field } from '../components/Field';

const emptyFile = (): ModFileInput => ({
  loader: 'neoforge', gameVersion: '1.21.1', file: null, fileName: '',
  minLoaderVersion: '', maxLoaderVersion: '', dependencies: '{}',
});

export function ModPublishForm({ onToast, onPublished }: {
  onToast: (m: string, k?: 'ok' | 'err') => void; onPublished: () => void;
}) {
  const [modId, setModId] = useState('');
  const [name, setName] = useState('');
  const [version, setVersion] = useState('');
  const [category, setCategory] = useState('required');
  const [changelog, setChangelog] = useState('');
  const [files, setFiles] = useState<ModFileInput[]>([emptyFile()]);
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);

  function setFile(i: number, patch: Partial<ModFileInput>) {
    setFiles((fs) => fs.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  }

  async function submit(e: Event) {
    e.preventDefault();
    const input = { modId, name, version, category, changelog, files };
    const errors = validateModPublish(input);
    if (errors.length) { onToast(errors[0], 'err'); return; }

    const fileMap = new Map<string, File>();
    const metaFiles = files.map((f, i) => {
      const field = `jar${i}`;
      fileMap.set(field, f.file!);
      return {
        loader: f.loader, gameVersion: f.gameVersion, fileField: field, fileName: f.fileName,
        minLoaderVersion: f.minLoaderVersion,
        maxLoaderVersion: f.maxLoaderVersion || null,
        dependencies: JSON.parse(f.dependencies || '{}'),
      };
    });
    const meta = { modId, name, version, category, changelog, files: metaFiles };

    setBusy(true);
    try {
      const res = await api.publishMod(modId, buildModPublishForm(meta, fileMap), overwrite);
      onToast(`게시됨: ${modId}@${res.version} (${res.files.length}개 파일)`);
      onPublished();
    } catch (e: any) { onToast(e.message, 'err'); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit}>
      <h3>새 모드 버전 게시</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
        <Field label="modId"><input value={modId} onInput={(e) => setModId((e.target as HTMLInputElement).value)} /></Field>
        <Field label="name"><input value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} /></Field>
        <Field label="version (x.y.z)"><input value={version} onInput={(e) => setVersion((e.target as HTMLInputElement).value)} /></Field>
        <Field label="category">
          <select value={category} onChange={(e) => setCategory((e.target as HTMLSelectElement).value)}>
            <option value="required">required</option>
            <option value="optional">optional</option>
          </select>
        </Field>
      </div>
      <Field label="changelog"><textarea value={changelog} onInput={(e) => setChangelog((e.target as HTMLTextAreaElement).value)} /></Field>

      <h4>파일</h4>
      {files.map((f, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr) auto', gap: 8, marginBottom: 8, alignItems: 'end' }}>
          <Field label="loader"><input value={f.loader} onInput={(e) => setFile(i, { loader: (e.target as HTMLInputElement).value })} /></Field>
          <Field label="gameVersion"><input value={f.gameVersion} onInput={(e) => setFile(i, { gameVersion: (e.target as HTMLInputElement).value })} /></Field>
          <Field label="jar">
            <input type="file" accept=".jar" onChange={(e) => {
              const file = (e.target as HTMLInputElement).files?.[0] ?? null;
              setFile(i, { file, fileName: file?.name ?? '' });
            }} />
          </Field>
          <Field label="minLoaderVersion"><input value={f.minLoaderVersion} onInput={(e) => setFile(i, { minLoaderVersion: (e.target as HTMLInputElement).value })} /></Field>
          <Field label="maxLoaderVersion"><input value={f.maxLoaderVersion} onInput={(e) => setFile(i, { maxLoaderVersion: (e.target as HTMLInputElement).value })} /></Field>
          <Field label="dependencies(JSON)"><input value={f.dependencies} onInput={(e) => setFile(i, { dependencies: (e.target as HTMLInputElement).value })} /></Field>
          <button type="button" disabled={files.length === 1} onClick={() => setFiles((fs) => fs.filter((_, idx) => idx !== i))}>삭제</button>
        </div>
      ))}
      <button type="button" onClick={() => setFiles((fs) => [...fs, emptyFile()])}>+ 파일 추가</button>

      <div style={{ marginTop: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
        <label><input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite((e.target as HTMLInputElement).checked)} /> 덮어쓰기</label>
        <button type="submit" disabled={busy}>{busy ? '게시 중…' : '게시'}</button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: 빌드 확인 (Task 3+4 통합)**

Run: `cd cloudflare-worker/admin && npx tsc --noEmit && npm run build`
Expected: 타입 오류 0, 빌드 성공(`public/admin/` 생성). Task 3의 `ModsView`가 `ModPublishForm`을 import하므로 이 시점에 해결됨.

- [ ] **Step 3: 커밋**

```bash
cd cloudflare-worker
git add admin/src/mods/ModPublishForm.tsx
git commit -m "feat: 모드 게시 폼(멀티파일 업로드)"
```

---

## Task 5: 혜니팩 UI (목록·버전 관리 + 게시)

**Files:**
- Create: `admin/src/packs/PacksView.tsx`, `admin/src/packs/PackVersions.tsx`, `admin/src/packs/PackPublishForm.tsx`

**Interfaces:**
- Consumes: `api.*Pack*`, `lib/validate.validatePackPublish`, `lib/formdata.buildPackPublishForm`, `lib/sha256.sha256Hex`.
- Produces: `PacksView({ onToast })`, `PackVersions({ packId, onToast, onChanged })`, `PackPublishForm({ onToast, onPublished })`.

- [ ] **Step 1: PackVersions 구현**

`admin/src/packs/PackVersions.tsx`:

```tsx
import { useEffect, useState } from 'preact/hooks';
import * as api from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';

interface Version { version: string; changelog: string; breaking: boolean; }

export function PackVersions({ packId, onToast, onChanged }: {
  packId: string; onToast: (m: string, k?: 'ok' | 'err') => void; onChanged: () => void;
}) {
  const [latest, setLatest] = useState<string | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [confirm, setConfirm] = useState<{ msg: string; act: () => void } | null>(null);

  async function load() {
    try {
      const data = await api.listPackVersions(packId);
      setLatest(data.latestVersion); setVersions(data.versions);
    } catch (e: any) { onToast(e.message, 'err'); }
  }
  useEffect(() => { load(); }, [packId]);

  async function run(action: () => Promise<any>, ok: string) {
    try { await action(); onToast(ok); await load(); onChanged(); }
    catch (e: any) { onToast(e.message, 'err'); }
  }

  return (
    <div>
      <h3>버전 (현재 latest: {latest ?? '없음'})</h3>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead><tr>{['버전', 'breaking', 'changelog', '액션'].map((h) => (
          <th key={h} style={{ textAlign: 'left', borderBottom: '1px solid #ccc', padding: 6 }}>{h}</th>
        ))}</tr></thead>
        <tbody>
          {versions.map((v) => (
            <tr key={v.version}>
              <td style={{ padding: 6 }}>{v.version}{v.version === latest ? ' ★' : ''}</td>
              <td style={{ padding: 6 }}>
                <button onClick={() => run(() => api.editPackVersion(packId, v.version, { breaking: !v.breaking }), `${v.version} breaking=${!v.breaking}`)}>
                  {v.breaking ? '⚠️ true' : 'false'}</button>
              </td>
              <td style={{ padding: 6, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.changelog}</td>
              <td style={{ padding: 6, display: 'flex', gap: 6 }}>
                <button disabled={v.version === latest}
                  onClick={() => run(() => api.rollbackPack(packId, v.version), `latest→${v.version}`)}>롤백</button>
                <button disabled={v.version === latest}
                  onClick={() => setConfirm({
                    msg: `${packId} ${v.version} 삭제할까요?`,
                    act: () => run(() => api.deletePackVersion(packId, v.version), `${v.version} 삭제됨`),
                  })}>삭제</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ConfirmDialog open={!!confirm} message={confirm?.msg ?? ''}
        onCancel={() => setConfirm(null)}
        onConfirm={() => { confirm?.act(); setConfirm(null); }} />
    </div>
  );
}
```

- [ ] **Step 2: PackPublishForm 구현(사이드카 + sha256 사전검증)**

`admin/src/packs/PackPublishForm.tsx`:

```tsx
import { useState } from 'preact/hooks';
import * as api from '../api';
import { validatePackPublish } from '../lib/validate';
import { buildPackPublishForm } from '../lib/formdata';
import { sha256Hex } from '../lib/sha256';
import { Field } from '../components/Field';

export function PackPublishForm({ onToast, onPublished }: {
  onToast: (m: string, k?: 'ok' | 'err') => void; onPublished: () => void;
}) {
  const [pack, setPack] = useState<File | null>(null);
  const [sidecar, setSidecar] = useState<File | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: Event) {
    e.preventDefault();
    if (!sidecar) { onToast('.latest.json 사이드카를 선택하세요.', 'err'); return; }
    let sc: any;
    try { sc = JSON.parse(await sidecar.text()); }
    catch { onToast('사이드카 JSON 파싱 실패', 'err'); return; }

    const errors = validatePackPublish({ pack, version: sc.version || '' });
    if (errors.length) { onToast(errors[0], 'err'); return; }

    // sha256 사전 검증(서버도 재검증하지만 조기 피드백)
    const actual = await sha256Hex(await pack!.arrayBuffer());
    if (actual !== sc.sha256) {
      onToast(`sha256 불일치: 사이드카=${sc.sha256?.slice(0, 12)}… 실제=${actual.slice(0, 12)}…`, 'err');
      return;
    }

    setBusy(true);
    try {
      const res = await api.publishPack(sc.hyenipackId, buildPackPublishForm(pack!, sc), overwrite);
      onToast(`게시됨: ${res.id}@${res.version}`);
      onPublished();
    } catch (e: any) { onToast(e.message, 'err'); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit}>
      <h3>새 혜니팩 버전 게시</h3>
      <p style={{ color: '#777', fontSize: 13 }}>런처 export 산출물(.hyenipack + 같은 이름의 .latest.json)을 선택하세요.</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label=".hyenipack">
          <input type="file" accept=".hyenipack" onChange={(e) => setPack((e.target as HTMLInputElement).files?.[0] ?? null)} />
        </Field>
        <Field label=".latest.json">
          <input type="file" accept=".json" onChange={(e) => setSidecar((e.target as HTMLInputElement).files?.[0] ?? null)} />
        </Field>
      </div>
      <div style={{ marginTop: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
        <label><input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite((e.target as HTMLInputElement).checked)} /> 덮어쓰기</label>
        <button type="submit" disabled={busy}>{busy ? '게시 중…' : '게시'}</button>
      </div>
    </form>
  );
}
```

- [ ] **Step 3: PacksView 구현**

`admin/src/packs/PacksView.tsx`:

```tsx
import { useEffect, useState } from 'preact/hooks';
import * as api from '../api';
import { PackVersions } from './PackVersions';
import { PackPublishForm } from './PackPublishForm';

interface Pack { id: string; latestVersion: string; breaking: boolean; }

export function PacksView({ onToast }: { onToast: (m: string, k?: 'ok' | 'err') => void }) {
  const [packs, setPacks] = useState<Pack[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  async function load() {
    try { setPacks((await api.listPacks()).packs); }
    catch (e: any) { onToast(e.message, 'err'); }
  }
  useEffect(() => { load(); }, [refreshKey]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 24 }}>
      <aside>
        <h3>혜니팩</h3>
        <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 4 }}>
          {packs.map((p) => (
            <li key={p.id}>
              <button style={{ width: '100%', textAlign: 'left', fontWeight: p.id === selected ? 700 : 400 }}
                onClick={() => setSelected(p.id)}>{p.id} <small>({p.latestVersion})</small></button>
            </li>
          ))}
        </ul>
      </aside>
      <section>
        {selected
          ? <PackVersions packId={selected} onToast={onToast} onChanged={() => setRefreshKey((k) => k + 1)} />
          : <p>왼쪽에서 혜니팩을 선택하세요.</p>}
        <hr style={{ margin: '24px 0' }} />
        <PackPublishForm onToast={onToast} onPublished={() => setRefreshKey((k) => k + 1)} />
      </section>
    </div>
  );
}
```

- [ ] **Step 4: 타입/빌드 확인**

Run: `cd cloudflare-worker/admin && npx tsc --noEmit && npm run build`
Expected: 타입 오류 0, 빌드 성공.

- [ ] **Step 5: 커밋**

```bash
cd cloudflare-worker
git add admin/src/packs/
git commit -m "feat: 혜니팩 관리 UI(목록/버전/게시+sha256 사전검증)"
```

---

## Task 6: App 탭 연결 + 레지스트리 재생성 + 최종 빌드/배포 검증 + 문서

**Files:**
- Modify: `admin/src/App.tsx`
- Modify: `cloudflare-worker/ENV_SETUP.md` (또는 신규 배포 체크리스트 섹션)

**Interfaces:**
- Produces: 완성된 `App` — 탭(모드/혜니팩) + 레지스트리 재생성 버튼 + 전역 토스트.

- [ ] **Step 1: App.tsx 완성**

`admin/src/App.tsx`를 다음으로 교체:

```tsx
import { useState } from 'preact/hooks';
import { useToast, Toasts } from './components/Toast';
import { ModsView } from './mods/ModsView';
import { PacksView } from './packs/PacksView';
import * as api from './api';

type Tab = 'mods' | 'packs';

export function App() {
  const [tab, setTab] = useState<Tab>('mods');
  const { toasts, push } = useToast();

  async function rebuild() {
    try { const r = await api.rebuildRegistry(); push(`레지스트리 재생성됨 (${r.count}개 모드)`); }
    catch (e: any) { push(e.message, 'err'); }
  }

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>HyeniMC 관리</h1>
        <nav style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setTab('mods')} style={{ fontWeight: tab === 'mods' ? 700 : 400 }}>모드</button>
          <button onClick={() => setTab('packs')} style={{ fontWeight: tab === 'packs' ? 700 : 400 }}>혜니팩</button>
        </nav>
        <button style={{ marginLeft: 'auto' }} onClick={rebuild}>레지스트리 재생성</button>
      </header>
      {tab === 'mods' ? <ModsView onToast={push} /> : <PacksView onToast={push} />}
      <Toasts items={toasts} />
    </main>
  );
}
```

- [ ] **Step 2: 타입/빌드 확인**

Run: `cd cloudflare-worker/admin && npx tsc --noEmit && npm run build`
Expected: 타입 오류 0, 빌드 성공.

- [ ] **Step 3: 백엔드 회귀 확인**

Run: `cd cloudflare-worker && npx vitest run`
Expected: 58/58 PASS (프론트 변경이 백엔드에 영향 없음).

- [ ] **Step 4: 로컬 end-to-end 수동 검증**

`cd cloudflare-worker && npx wrangler dev` 후:
- 브라우저로 `http://localhost:8787/admin/` 접속 → 패널 로드 확인.
- 참고: 로컬은 Access JWT가 없어 `/admin/api/*`가 401이므로 목록/게시가 실패한다(정상). **실기능 검증은 배포 후 실제 Access 세션에서** 수행한다. 로컬에서는 (a) SPA 로드, (b) 탭 전환, (c) 401 에러 토스트 표시(에러 처리 경로)까지 확인한다.
- 결과를 리포트에 기록.

- [ ] **Step 5: 배포 체크리스트 문서화**

`cloudflare-worker/ENV_SETUP.md` 끝에 섹션 추가(추적 파일):

```markdown
## 관리 패널(/admin) 배포 체크리스트

1. 로컬 `wrangler.toml`에 실제 Cloudflare Access 값 설정(placeholder 아님):
   - `[vars] ACCESS_TEAM_DOMAIN = "https://<team>.cloudflareaccess.com"`
   - `[vars] ACCESS_AUD = "<Access 애플리케이션 Audience 태그>"`
   미설정 시 `/admin/api/*`는 전부 401(fail-closed)로 동작한다.
2. Cloudflare Zero Trust에서 `/admin*`를 커버하는 self-hosted Access 애플리케이션 생성(본인 이메일 정책). Worker가 커스텀 도메인/라우트에 있어야 Access 적용 가능(`*.workers.dev`는 불가).
3. 배포: `npm run deploy` (build:admin → wrangler deploy). `public/admin/`이 함께 업로드된다.
4. `[assets]`가 `wrangler.toml`에 있어야 SPA가 서빙됨(gitignore되므로 새 환경에선 `wrangler.toml.example` 참고해 재작성).
```

- [ ] **Step 6: 커밋**

```bash
cd cloudflare-worker
git add admin/src/App.tsx ENV_SETUP.md
git commit -m "feat: 관리 패널 App 탭/레지스트리 재생성 + 배포 체크리스트"
```

---

## Self-Review 결과(작성자 점검)

- **Spec 커버리지**: 설계 §2(아키텍처: Worker 패널 + Static Assets)=T1. §3 프론트 컴포넌트(api/pages/components)=T2~T6. §4 데이터흐름(모드 게시 멀티파트, 팩 sha256 사전검증)=T4/T5. §5 에러처리(비-2xx→토스트, 401 안내)=T2 api + 각 뷰. §6 테스트(순수 로직 단위 + 수동 e2e)=T2 + T6. §7 배포/설정(assets/build:admin/deploy/Access)=T1/T6.
  - **의도된 단순화(YAGNI)**: URL 라우터 없음(탭 상태), 컴포넌트 렌더 테스트 없음(순수 로직만 단위 테스트 + 수동 e2e) — 개인 도구 + 설계의 "컴포넌트는 최소" 방침에 부합. 인라인 스타일 사용(별도 CSS 빌드 회피).
- **Placeholder 스캔**: `wrangler.toml.example`/`ENV_SETUP.md`의 Access 값은 실제 배포 시 채우는 설정(플레이스홀더 아님). Task 3의 `ModsView`가 Task 4의 `ModPublishForm`에 의존하는 순서 의존성은 Task 3 Step 3/Task 4 Step 2에 명시(단독 빌드 검증을 Task 4로 미룸). 그 외 TODO/미완 없음.
- **타입/시그니처 일관성**: `onToast(m, k?)` 시그니처가 App→Views→Versions/Forms 전 계층 동일. `api.ts` 함수명이 각 뷰의 호출과 일치. `ModFileInput`(validate.ts)가 폼 상태와 FormData 빌더 입력에 일관 사용. `buildModPublishForm(meta, Map)` / `buildPackPublishForm(pack, sidecar)` 시그니처가 폼과 테스트에서 일치.

## 실행 핸드오프

Plan 2/2(프론트)입니다. 완료 시 관리 패널이 UI로 완성됩니다. 백엔드(Plan 1)는 이미 병합 준비 완료 상태이며, 프론트까지 끝나면 전체를 함께 `wrangler deploy`(+Access 설정)로 배포하거나 finishing-a-development-branch로 정리하면 됩니다.
