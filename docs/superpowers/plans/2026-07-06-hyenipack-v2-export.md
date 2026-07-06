# HyeniPack V2 Export + 배포 채널 Implementation Plan

> **실행 결과 (2026-07-06, 인라인 실행 완료)**: Task 1~6 전부 구현·커밋 — `588e5a0`(타입+빌더, vitest 11) / `15d8d6a`(exporter — **보너스: HyeniPackExportOptions 중복 선언 잠재 버그 발견·제거**) / `9137f10`(모달) / `c064b85`(Worker — wrangler dev에서 400/404/401/health 검증) / `e31ede0`(스크립트 — 가짜 wrangler 드라이런 + sha 불일치 거부 검증) / `d3561ba`(문서). 최종 vite+tsc 클린, vitest 19/19.
> **잔여 수동 e2e (사용자)**: ① 앱에서 실제 export → `unzip -p <팩>.hyenipack hyenipack.json`에서 formatVersion 2 확인 + latest.json sha256 대조 ② 실 R2에 테스트 배포(`deploy-hyenipack.sh`) 후 실 Worker에서 latest 조회·토큰 다운로드 확인 (Task 5 Step 3의 절차 그대로).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 제작자 도구(기존 Electron HyeniMC)에서 V2 혜니팩(.hyenipack, formatVersion 2)을 export하고, Cloudflare Worker + R2로 배포·조회·다운로드할 수 있게 한다 — Tauri 런처 M4(팩 자동 업데이트)의 배포 측 전제 조건.

**Architecture:** ① 순수 함수 매니페스트 빌더(`hyenipack-manifest.ts`, 테스트 가능) → ② 기존 `HyeniPackExporter`가 V2 옵션 수신 시 v2 매니페스트 + `latest.json` 사이드카 생성 → ③ Worker에 `/api/v2/modpacks` 라우트 신설(기존 mods v2 패턴 미러, 토큰 검증 재사용) → ④ wrangler 업로드 스크립트(기존 deploy-mod-v2 패턴).

**Tech Stack:** TypeScript(Electron main + React), vitest, Cloudflare Worker(JS) + R2(wrangler CLI), bash/PowerShell.

## Global Constraints

- 신규 npm 의존성 추가 금지 (기존: adm-zip, crypto 내장, vitest)
- Export는 **항상 formatVersion 2**로 생성 (v1 export 경로 제거). Import(v1 읽기)는 이 플랜 범위 밖 — 기존 코드 유지
- `hyenipackId` 규칙: `/^[a-z0-9][a-z0-9-]{0,63}$/` (소문자·숫자·하이픈, 최대 64자) — Worker·exporter 양쪽 동일 검증
- R2 키 레이아웃: `modpacks/<hyenipackId>/latest.json` + `modpacks/<hyenipackId>/versions/<version>/pack.hyenipack` (버킷 `hyenimc-releases`, 바인딩 `env.RELEASES`)
- `breaking` 필드가 V2 문서의 "메이저/마이너 변경 시 업데이트 불가" 규칙을 **대체**한다 (2026-07-06 결정: breaking=true → 적용 전 실행 차단)
- 다운로드 엔드포인트는 기존 `isValidToken`(TOKEN_CHECK_API_URL) 토큰 검증 필수, latest 조회는 공개(5분 캐시)
- 커밋은 HyeniMC 리포 `chore/pre-tauri-cleanup` 브랜치 위에 이어서 (또는 사용자 지시 시 별도 브랜치)
- 테스트: `npx vitest run` (watch 금지), AAA 패턴, 파일 위치 `src/main/services/__tests__/`

---

### Task 1: V2 타입 + 순수 매니페스트 빌더

**Files:**
- Modify: `src/shared/types/hyenipack.ts` (HyeniPackManifest 정의 아래에 추가)
- Create: `src/main/services/hyenipack-manifest.ts`
- Test: `src/main/services/__tests__/hyenipack-manifest.test.ts`

**Interfaces:**
- Consumes: 기존 `HyeniPackModEntry`, `HyeniPackExportOptions`, `LoaderType`
- Produces: `HyeniPackManifestV2`, `OverridePolicy`, `HyeniPackExportOptionsV2`, `HyeniPackLatestInfo` 타입; `isValidHyenipackId(id: string): boolean`, `buildManifestV2(input: ManifestV2Input): HyeniPackManifestV2`, `buildLatestInfo(manifest: HyeniPackManifestV2, packSha256: string, packSize: number, releaseDate: string): HyeniPackLatestInfo` — Task 2·4·5가 이 이름/시그니처에 의존

- [ ] **Step 1: 타입 추가** — `src/shared/types/hyenipack.ts`의 `HyeniPackExportOptions` 정의 뒤에 추가:

```typescript
/**
 * V2 override 정책 (파일/폴더 단위, Longest-Prefix-Match 우선)
 */
export interface OverridePolicy {
  path: string;                          // "config" 또는 "config/sodium-options.json"
  policy: 'keep' | 'replace' | 'merge';  // UI는 keep/replace만 노출, merge는 예약
}

/**
 * HyeniPack V2 매니페스트 (자동 업데이트 지원)
 */
export interface HyeniPackManifestV2 {
  formatVersion: 2;
  hyenipackId: string;      // /^[a-z0-9][a-z0-9-]{0,63}$/
  name: string;
  version: string;          // SemVer
  author: string;
  description?: string;
  changelog?: string;
  breaking?: boolean;       // true: 적용 전 게임 실행 차단 (기본 false)
  minecraft: {
    version: string;
    loaderType: LoaderType;
    loaderVersion: string;
  };
  mods: HyeniPackModEntry[];
  overrides: OverridePolicy[];
  createdAt: string;
  exportedFrom?: {
    launcher: 'HyeniMC';
    version: string;
    profileName: string;
  };
}

export type AnyHyeniPackManifest = HyeniPackManifest | HyeniPackManifestV2;

/**
 * V2 Export 옵션
 */
export interface HyeniPackExportOptionsV2 extends HyeniPackExportOptions {
  hyenipackId: string;
  changelog?: string;
  breaking?: boolean;
  overridePolicies: OverridePolicy[];
}

/**
 * R2 latest.json 스키마 (Worker /api/v2/modpacks/{id}/latest 응답)
 */
export interface HyeniPackLatestInfo {
  hyenipackId: string;
  name: string;
  version: string;
  changelog?: string;
  breaking: boolean;
  minLauncherVersion?: string;
  fileSize: number;
  sha256: string;
  releaseDate: string;
}
```

- [ ] **Step 2: 실패하는 테스트 작성** — `src/main/services/__tests__/hyenipack-manifest.test.ts`:

```typescript
import { describe, test, expect } from 'vitest';
import {
  isValidHyenipackId,
  buildManifestV2,
  buildLatestInfo,
  ManifestV2Input,
} from '../hyenipack-manifest';

function baseInput(): ManifestV2Input {
  return {
    profile: {
      name: '혜니월드 생존',
      gameVersion: '1.21.1',
      loaderType: 'fabric',
      loaderVersion: '0.16.7',
    },
    options: {
      hyenipackId: 'hyenipack-hyeniworld',
      packName: '혜니월드 생존 팩',
      version: '1.2.0',
      author: 'deVbug',
      description: '공식 팩',
      changelog: '- Sodium 업데이트',
      breaking: false,
      selectedFiles: ['mods/sodium.jar', 'config/options.json'],
      overridePolicies: [{ path: 'config', policy: 'keep' }],
    },
    mods: [
      {
        fileName: 'sodium.jar',
        metadata: { source: 'modrinth', projectId: 'AANobbMI', version: 'abc' },
        sha256: 'deadbeef',
        size: 1024,
      },
    ],
    launcherVersion: '0.3.4',
    createdAt: '2026-07-06T04:00:00.000Z',
  };
}

describe('isValidHyenipackId', () => {
  test('accepts lowercase alphanumeric with hyphens', () => {
    expect(isValidHyenipackId('hyenipack-hyeniworld')).toBe(true);
  });

  test.each(['', 'UPPER', 'has space', 'dot.dot', '-leading', 'a'.repeat(65)])(
    'rejects invalid id: %s',
    (id) => {
      expect(isValidHyenipackId(id)).toBe(false);
    }
  );
});

describe('buildManifestV2', () => {
  test('produces formatVersion 2 manifest with v2 fields', () => {
    // Arrange
    const input = baseInput();

    // Act
    const manifest = buildManifestV2(input);

    // Assert
    expect(manifest.formatVersion).toBe(2);
    expect(manifest.hyenipackId).toBe('hyenipack-hyeniworld');
    expect(manifest.changelog).toBe('- Sodium 업데이트');
    expect(manifest.breaking).toBe(false);
    expect(manifest.overrides).toEqual([{ path: 'config', policy: 'keep' }]);
    expect(manifest.minecraft).toEqual({
      version: '1.21.1',
      loaderType: 'fabric',
      loaderVersion: '0.16.7',
    });
    expect(manifest.mods).toHaveLength(1);
    expect(manifest.createdAt).toBe('2026-07-06T04:00:00.000Z');
    expect(manifest.exportedFrom?.version).toBe('0.3.4');
  });

  test('throws on invalid hyenipackId', () => {
    const input = baseInput();
    input.options.hyenipackId = 'Bad ID!';
    expect(() => buildManifestV2(input)).toThrow(/hyenipackId/);
  });

  test('throws on non-semver version', () => {
    const input = baseInput();
    input.options.version = 'v1';
    expect(() => buildManifestV2(input)).toThrow(/version/);
  });
});

describe('buildLatestInfo', () => {
  test('derives latest.json fields from manifest + pack file facts', () => {
    // Arrange
    const manifest = buildManifestV2(baseInput());

    // Act
    const latest = buildLatestInfo(manifest, 'cafebabe', 52428800, '2026-07-06T05:00:00.000Z');

    // Assert
    expect(latest).toEqual({
      hyenipackId: 'hyenipack-hyeniworld',
      name: '혜니월드 생존 팩',
      version: '1.2.0',
      changelog: '- Sodium 업데이트',
      breaking: false,
      fileSize: 52428800,
      sha256: 'cafebabe',
      releaseDate: '2026-07-06T05:00:00.000Z',
    });
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run src/main/services/__tests__/hyenipack-manifest.test.ts`
Expected: FAIL — `Cannot find module '../hyenipack-manifest'`

- [ ] **Step 4: 구현** — `src/main/services/hyenipack-manifest.ts` 신규:

```typescript
/**
 * HyeniPack V2 매니페스트/latest.json 빌더 (순수 함수 — Electron 비의존, 테스트 대상)
 */

import {
  HyeniPackManifestV2,
  HyeniPackModEntry,
  HyeniPackExportOptionsV2,
  HyeniPackLatestInfo,
} from '../../shared/types/hyenipack';

export const HYENIPACK_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

export function isValidHyenipackId(id: string): boolean {
  return HYENIPACK_ID_PATTERN.test(id);
}

export interface ManifestV2Input {
  profile: {
    name: string;
    gameVersion: string;
    loaderType: HyeniPackManifestV2['minecraft']['loaderType'];
    loaderVersion: string;
  };
  options: HyeniPackExportOptionsV2;
  mods: HyeniPackModEntry[];
  launcherVersion: string;
  createdAt: string; // ISO 8601 — 호출부 주입 (순수성 유지)
}

export function buildManifestV2(input: ManifestV2Input): HyeniPackManifestV2 {
  const { profile, options, mods, launcherVersion, createdAt } = input;

  if (!isValidHyenipackId(options.hyenipackId)) {
    throw new Error(
      `Invalid hyenipackId: "${options.hyenipackId}" (소문자/숫자/하이픈, 최대 64자)`
    );
  }
  if (!SEMVER_PATTERN.test(options.version)) {
    throw new Error(`Invalid version: "${options.version}" (SemVer x.y.z 형식 필요)`);
  }

  return {
    formatVersion: 2,
    hyenipackId: options.hyenipackId,
    name: options.packName,
    version: options.version,
    author: options.author,
    description: options.description,
    changelog: options.changelog,
    breaking: options.breaking ?? false,
    minecraft: {
      version: profile.gameVersion,
      loaderType: profile.loaderType,
      loaderVersion: profile.loaderVersion,
    },
    mods,
    overrides: options.overridePolicies,
    createdAt,
    exportedFrom: {
      launcher: 'HyeniMC',
      version: launcherVersion,
      profileName: profile.name,
    },
  };
}

export function buildLatestInfo(
  manifest: HyeniPackManifestV2,
  packSha256: string,
  packSize: number,
  releaseDate: string
): HyeniPackLatestInfo {
  return {
    hyenipackId: manifest.hyenipackId,
    name: manifest.name,
    version: manifest.version,
    changelog: manifest.changelog,
    breaking: manifest.breaking ?? false,
    fileSize: packSize,
    sha256: packSha256,
    releaseDate,
  };
}
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run src/main/services/__tests__/hyenipack-manifest.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 6: 커밋**

```bash
git add src/shared/types/hyenipack.ts src/main/services/hyenipack-manifest.ts src/main/services/__tests__/hyenipack-manifest.test.ts
git commit -m "feat(hyenipack): V2 매니페스트 타입 + 순수 빌더 (hyenipackId/changelog/breaking/overrides)"
```

---

### Task 2: Exporter V2 전환 + latest.json 사이드카

**Files:**
- Modify: `src/main/services/hyenipack-exporter.ts`
- Modify: `src/main/ipc/hyenipack-handlers.ts` (옵션 타입만 — `hyenipack:export` 핸들러의 options 파라미터)

**Interfaces:**
- Consumes: Task 1의 `buildManifestV2` / `buildLatestInfo` / `ManifestV2Input`, `HyeniPackExportOptionsV2`
- Produces: `HyeniPackExporter.exportProfile(profile, options: HyeniPackExportOptionsV2, outputPath?): Promise<string>` — 반환값(팩 파일 경로)은 기존과 동일. 부수 산출물로 `<팩파일명에서 .hyenipack 제거>.latest.json`이 같은 디렉터리에 생성됨 (Task 3 UI 안내문·Task 5 스크립트가 의존)

- [ ] **Step 1: exporter 수정** — `hyenipack-exporter.ts`:

import 교체 (기존 12행):

```typescript
import { HyeniPackManifestV2, HyeniPackModEntry, HyeniPackExportOptionsV2 } from '../../shared/types/hyenipack';
import { buildManifestV2, buildLatestInfo } from './hyenipack-manifest';
```

`exportProfile` 시그니처의 `options: HyeniPackExportOptions` → `options: HyeniPackExportOptionsV2`.

`createManifest` 메서드를 다음으로 교체 (mods 수집 로직은 그대로 두고 반환부만 빌더 위임):

```typescript
  private async createManifest(
    profile: Profile,
    options: HyeniPackExportOptionsV2,
    instanceDir: string
  ): Promise<HyeniPackManifestV2> {
    const modsDir = path.join(instanceDir, 'mods');
    const metadata = await metadataManager.readUnifiedMetadata(modsDir);

    const mods: HyeniPackModEntry[] = [];

    for (const relativePath of options.selectedFiles) {
      if (!relativePath.startsWith('mods/') && !relativePath.startsWith('mods\\')) {
        continue;
      }

      const fileName = path.basename(relativePath);
      const filePath = path.join(instanceDir, relativePath);

      try {
        const stat = await fs.stat(filePath);
        if (stat.isDirectory()) continue;

        const sha256 = await this.calculateSHA256(filePath);
        const modMeta = metadata?.mods[fileName];

        mods.push({
          fileName,
          metadata: modMeta ? {
            version: modMeta.sourceFileId || modMeta.versionNumber,
            source: modMeta.source,
            projectId: modMeta.sourceModId
          } : undefined,
          sha256,
          size: stat.size
        });
      } catch (error) {
        console.error(`[HyeniPackExporter] Failed to process mod: ${fileName}`, error);
      }
    }

    return buildManifestV2({
      profile: {
        name: profile.name,
        gameVersion: profile.gameVersion,
        loaderType: profile.loaderType,
        loaderVersion: profile.loaderVersion,
      },
      options,
      mods,
      launcherVersion: app.getVersion(),
      createdAt: new Date().toISOString(),
    });
  }
```

`exportProfile`의 6단계(ZIP 생성) 직후, `return finalPath;` 앞에 latest.json 생성 추가:

```typescript
      // 6.5 latest.json 사이드카 생성 (R2 배포용)
      const packSha256 = await this.calculateSHA256(finalPath);
      const packStat = await fs.stat(finalPath);
      const latestInfo = buildLatestInfo(
        manifest,
        packSha256,
        packStat.size,
        new Date().toISOString()
      );
      const latestPath = finalPath.replace(/\.hyenipack$/, '.latest.json');
      await fs.writeFile(latestPath, JSON.stringify(latestInfo, null, 2), 'utf8');
      console.log(`[HyeniPackExporter] latest.json created: ${latestPath}`);
```

주의: `createManifest`가 `manifest` 변수로 이미 `exportProfile` 2단계에서 호출되어 있음 — 해당 변수를 그대로 사용 (타입이 `HyeniPackManifestV2`로 좁혀짐).

- [ ] **Step 2: IPC 핸들러 타입 정합** — `hyenipack-handlers.ts`의 `hyenipack:export` 핸들러에서 options 타입 주석이 있으면 `HyeniPackExportOptionsV2`로 갱신 (런타임 로직 변경 없음 — 객체 패스스루).

- [ ] **Step 3: 컴파일 + 전체 테스트**

Run: `npm run build:main && npx vitest run`
Expected: tsc 에러 0, 기존 metadata-manager 8 + Task 1의 7 테스트 PASS

- [ ] **Step 4: 수동 검증** — `npm run dev` → 아무 프로필 → "혜니팩 내보내기" (UI는 아직 V2 필드 없음 → **이 시점에는 hyenipackId 미전달로 export가 검증 에러를 내는 것이 정상**. Task 3에서 UI가 채워지면 재검증). 에러 메시지가 "Invalid hyenipackId"인지만 확인.

- [ ] **Step 5: 커밋**

```bash
git add src/main/services/hyenipack-exporter.ts src/main/ipc/hyenipack-handlers.ts
git commit -m "feat(hyenipack): exporter V2 전환 — v2 매니페스트 생성 + latest.json 사이드카"
```

---

### Task 3: Export 모달 V2 입력 필드

**Files:**
- Modify: `src/renderer/components/profiles/ExportHyeniPackModal.tsx`

**Interfaces:**
- Consumes: Task 2의 export IPC (options에 `hyenipackId`/`changelog`/`breaking`/`overridePolicies` 추가 전달)
- Produces: 사용자 입력 UI. 완료 알림에 latest.json 경로 안내 포함

- [ ] **Step 1: 상태 추가** — 기존 `useState` 블록(115~118행 부근)에 추가:

```typescript
  const [hyenipackId, setHyenipackId] = useState(
    profileName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  );
  const [changelog, setChangelog] = useState('');
  const [breaking, setBreaking] = useState(false);
  // 정책: 자동 관리 폴더(mods/resourcepacks/shaderpacks) 외 최상위 경로별 keep/replace
  const [policies, setPolicies] = useState<Record<string, 'keep' | 'replace'>>({});
```

- [ ] **Step 2: 폼 UI 추가** — packName 입력 필드 아래에 (기존 입력 필드들과 동일한 클래스 스타일 재사용):

```tsx
  {/* V2: 혜니팩 ID */}
  <div>
    <label className="block text-sm font-medium mb-1">혜니팩 ID *</label>
    <input
      type="text"
      value={hyenipackId}
      onChange={(e) => setHyenipackId(e.target.value)}
      placeholder="hyenipack-hyeniworld"
      className={/* packName 입력과 동일 클래스 복사 */}
    />
    <p className="text-xs text-gray-400 mt-1">
      소문자/숫자/하이픈만, 최대 64자. 자동 업데이트 채널의 고유 식별자 — 배포 후 변경 금지
    </p>
  </div>

  {/* V2: 변경 사항 */}
  <div>
    <label className="block text-sm font-medium mb-1">변경 사항 (changelog)</label>
    <textarea
      value={changelog}
      onChange={(e) => setChangelog(e.target.value)}
      rows={3}
      placeholder="- Sodium 업데이트&#10;- Config 최적화"
      className={/* description textarea와 동일 클래스 복사 */}
    />
  </div>

  {/* V2: breaking */}
  <label className="flex items-center gap-2 text-sm">
    <input type="checkbox" checked={breaking} onChange={(e) => setBreaking(e.target.checked)} />
    <span>호환성 파괴 업데이트 (사용자는 적용 전까지 게임 실행 불가)</span>
  </label>
```

- [ ] **Step 3: 정책 선택 UI** — 파일 트리 하단에, 선택된 파일 중 자동 관리 폴더 외 최상위 디렉터리 목록을 도출해 keep/replace 드롭다운 렌더:

```tsx
  {/* V2: override 정책 (자동 관리 폴더 제외 최상위 경로) */}
  {(() => {
    const AUTO_MANAGED = new Set(['mods', 'resourcepacks', 'shaderpacks']);
    const topDirs = Array.from(
      new Set(
        getSelectedFiles(fileTree)
          .map((p) => p.split(/[/\\]/)[0])
          .filter((d) => d && !AUTO_MANAGED.has(d))
      )
    ).sort();
    if (topDirs.length === 0) return null;
    return (
      <div className="mt-3">
        <label className="block text-sm font-medium mb-1">업데이트 정책 (폴더별)</label>
        <p className="text-xs text-gray-400 mb-2">
          keep: 사용자 변경 보존(새 파일만 추가) / replace: 팩 내용으로 강제 교체
        </p>
        {topDirs.map((dir) => (
          <div key={dir} className="flex items-center justify-between py-1 text-sm">
            <span className="font-mono">{dir}/</span>
            <select
              value={policies[dir] ?? 'keep'}
              onChange={(e) =>
                setPolicies((prev) => ({ ...prev, [dir]: e.target.value as 'keep' | 'replace' }))
              }
              className={/* 기존 select 스타일 재사용, 없으면 input 클래스 */}
            >
              <option value="keep">keep (기본)</option>
              <option value="replace">replace</option>
            </select>
          </div>
        ))}
      </div>
    );
  })()}
```

- [ ] **Step 4: handleExport 확장** — 검증 + options 전달(261~265행 부근):

```typescript
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(hyenipackId)) {
      // 기존 에러 표출 방식(packName 검증과 동일 패턴) 재사용
      showError('혜니팩 ID는 소문자/숫자/하이픈만, 최대 64자입니다.');
      return;
    }
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
      showError('버전은 x.y.z SemVer 형식이어야 합니다.');
      return;
    }

    const overridePolicies = Object.entries(policies).map(([p, policy]) => ({ path: p, policy }));

    // 기존 export 호출의 options 객체에 필드 추가:
    {
      packName,
      version,
      author,
      description,
      selectedFiles,
      hyenipackId,
      changelog: changelog || undefined,
      breaking,
      overridePolicies,
    }
```

(`showError`는 이 파일의 기존 에러 처리 방식 — packName 빈값 검증(232행)이 쓰는 것과 동일한 메커니즘을 그대로 사용한다. 완료 토스트/알림 문구에 "같은 폴더에 latest.json이 함께 생성되었습니다 — 배포 시 둘 다 업로드" 추가.)

- [ ] **Step 5: 검증**

Run: `npm run build && npx vitest run`
Expected: 빌드 클린 + 테스트 PASS
Run: `npm run dev` → 프로필 → 혜니팩 내보내기 → V2 필드 입력 → export → 산출물 확인:
`unzip -p ~/Downloads/<팩>.hyenipack hyenipack.json | head -20` → `"formatVersion": 2`, `"hyenipackId"` 확인. 같은 폴더에 `<팩>.latest.json` 존재 + sha256이 `shasum -a 256 <팩파일>`과 일치.

- [ ] **Step 6: 커밋**

```bash
git add src/renderer/components/profiles/ExportHyeniPackModal.tsx
git commit -m "feat(hyenipack): export 모달 V2 필드 (hyenipackId/changelog/breaking/정책)"
```

---

### Task 4: Worker `/api/v2/modpacks` 라우트

**Files:**
- Modify: `cloudflare-worker/src/index.js`

**Interfaces:**
- Consumes: R2 키 레이아웃(Global Constraints), 기존 `isValidToken(token, env)`
- Produces: `GET /api/v2/modpacks/{id}/latest` (공개, 5분 캐시) / `GET /api/v2/modpacks/{id}/versions` (공개, 10분 캐시) / `GET /download/v2/modpacks/{id}/{version}` (토큰 필수) — Tauri M4와 Task 5 스크립트가 의존

- [ ] **Step 1: 라우팅 추가** — `fetch()`의 기존 v2 mods 라우팅(34행) 위에:

```javascript
      // Route: Modpacks API v2 (HyeniPack)
      if (path.startsWith('/api/v2/modpacks') || path.startsWith('/download/v2/modpacks')) {
        return await handleModpacksAPI(request, env, corsHeaders);
      }
```

- [ ] **Step 2: 핸들러 구현** — `handleReleasesAPI` 함수 위에 추가:

```javascript
/**
 * Handle HyeniPack Modpacks API (v2)
 * R2 layout: modpacks/{id}/latest.json, modpacks/{id}/versions/{version}/pack.hyenipack
 */
const MODPACK_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MODPACK_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

async function handleModpacksAPI(request, env, corsHeaders) {
  if (!env.RELEASES) {
    return jsonResponse({ error: 'R2 bucket not configured' }, 500, corsHeaders);
  }

  const path = new URL(request.url).pathname;

  const latestMatch = path.match(/^\/api\/v2\/modpacks\/([^\/]+)\/latest$/);
  if (latestMatch) {
    const id = latestMatch[1];
    if (!MODPACK_ID_PATTERN.test(id)) {
      return jsonResponse({ error: 'Invalid modpack id' }, 400, corsHeaders);
    }
    const latest = await env.RELEASES.get(`modpacks/${id}/latest.json`);
    if (!latest) {
      return jsonResponse({ error: 'Not Found', message: `No release for ${id}` }, 404, corsHeaders);
    }
    return new Response(latest.body, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300',
      },
    });
  }

  const versionsMatch = path.match(/^\/api\/v2\/modpacks\/([^\/]+)\/versions$/);
  if (versionsMatch) {
    const id = versionsMatch[1];
    if (!MODPACK_ID_PATTERN.test(id)) {
      return jsonResponse({ error: 'Invalid modpack id' }, 400, corsHeaders);
    }
    const list = await env.RELEASES.list({ prefix: `modpacks/${id}/versions/` });
    const versions = new Set();
    for (const obj of list.objects) {
      const m = obj.key.match(/versions\/(\d+\.\d+\.\d+)\//);
      if (m) versions.add(m[1]);
    }
    const sorted = [...versions].sort((a, b) => compareVersions(b, a));
    return jsonResponse({ versions: sorted }, 200, corsHeaders, 'public, max-age=600');
  }

  const dlMatch = path.match(/^\/download\/v2\/modpacks\/([^\/]+)\/([^\/]+)$/);
  if (dlMatch) {
    const [, id, version] = dlMatch;
    if (!MODPACK_ID_PATTERN.test(id) || !MODPACK_VERSION_PATTERN.test(version)) {
      return jsonResponse({ error: 'Invalid modpack id or version' }, 400, corsHeaders);
    }

    const url = new URL(request.url);
    const token = url.searchParams.get('token') ||
                  request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token || !(await isValidToken(token, env))) {
      return jsonResponse({
        error: 'Unauthorized',
        message: '유효한 토큰이 필요합니다. Discord에서 /인증 명령어로 인증하세요.',
      }, 401, corsHeaders);
    }

    const file = await env.RELEASES.get(`modpacks/${id}/versions/${version}/pack.hyenipack`);
    if (!file) {
      return jsonResponse({ error: 'Not Found', message: '파일을 찾을 수 없습니다.' }, 404, corsHeaders);
    }

    console.log(`[Modpacks API] Download: ${id}@${version} (token: ${token.substring(0, 8)}...)`);
    return new Response(file.body, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${id}-${version}.hyenipack"`,
        'Content-Length': file.size,
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  return jsonResponse({ error: 'Not Found' }, 404, corsHeaders);
}

function jsonResponse(obj, status, corsHeaders, cacheControl) {
  const headers = { ...corsHeaders, 'Content-Type': 'application/json' };
  if (cacheControl) headers['Cache-Control'] = cacheControl;
  return new Response(JSON.stringify(obj), { status, headers });
}
```

- [ ] **Step 3: 로컬 검증** (wrangler dev + curl)

```bash
cd cloudflare-worker && npx wrangler dev
# 별도 터미널:
curl -s http://localhost:8787/api/v2/modpacks/BAD..ID/latest       # → 400 Invalid modpack id
curl -s http://localhost:8787/api/v2/modpacks/hyenipack-test/latest # → 404 (미업로드 상태 정상)
curl -s http://localhost:8787/download/v2/modpacks/hyenipack-test/1.0.0 # → 401 Unauthorized
curl -s http://localhost:8787/health                                # → 기존 라우트 회귀 확인
```

Expected: 위 상태 코드 그대로. (latest 200 응답은 Task 5에서 실제 업로드 후 재검증)

- [ ] **Step 4: 커밋**

```bash
git add cloudflare-worker/src/index.js
git commit -m "feat(worker): /api/v2/modpacks 라우트 — latest/versions 조회 + 토큰 검증 다운로드"
```

---

### Task 5: 배포 스크립트 (deploy-hyenipack)

**Files:**
- Create: `cloudflare-worker/deploy-hyenipack.sh`
- Create: `cloudflare-worker/deploy-hyenipack.ps1`

**Interfaces:**
- Consumes: Task 2 산출물 쌍(`<pack>.hyenipack` + `<pack>.latest.json`), 버킷 `hyenimc-releases`, wrangler CLI
- Produces: R2에 `modpacks/<id>/versions/<version>/pack.hyenipack` + `modpacks/<id>/latest.json` 업로드. 롤백 = 이전 버전 산출물 쌍으로 재실행(도움말에 명시)

- [ ] **Step 1: bash 스크립트** — `cloudflare-worker/deploy-hyenipack.sh`:

```bash
#!/usr/bin/env bash
#
# HyeniPack V2 Deployment Script
#
# Usage:
#   ./deploy-hyenipack.sh --pack path/to/MyPack-1.2.0.hyenipack
#
# latest.json은 팩 파일과 같은 폴더의 <이름>.latest.json을 자동 탐색한다
# (HyeniMC export가 함께 생성). 롤백: 이전 버전 파일 쌍으로 다시 실행하면 됨.

set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'
BUCKET="hyenimc-releases"

PACK_FILE=""
while [[ $# -gt 0 ]]; do
    case $1 in
        --pack) PACK_FILE="$2"; shift 2 ;;
        -h|--help)
            grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo -e "${RED}Unknown argument: $1${NC}" >&2; exit 1 ;;
    esac
done

[ -z "$PACK_FILE" ] && { echo -e "${RED}Error: --pack is required${NC}" >&2; exit 1; }
[ -f "$PACK_FILE" ] || { echo -e "${RED}Error: pack file not found: $PACK_FILE${NC}" >&2; exit 1; }

LATEST_FILE="${PACK_FILE%.hyenipack}.latest.json"
[ -f "$LATEST_FILE" ] || { echo -e "${RED}Error: latest.json not found: $LATEST_FILE${NC}" >&2; exit 1; }

# latest.json에서 id/version/sha256 추출 (node 사용 — repo에 이미 필수)
read -r PACK_ID VERSION SHA256 <<< "$(node -e "
const j = require(process.argv[1]);
console.log(j.hyenipackId, j.version, j.sha256);
" "$LATEST_FILE")"

[[ "$PACK_ID" =~ ^[a-z0-9][a-z0-9-]{0,63}$ ]] || { echo -e "${RED}Invalid hyenipackId: $PACK_ID${NC}" >&2; exit 1; }
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo -e "${RED}Invalid version: $VERSION${NC}" >&2; exit 1; }

# sha256 대조 (업로드 전 무결성)
ACTUAL_SHA=$(shasum -a 256 "$PACK_FILE" | cut -d' ' -f1)
[ "$ACTUAL_SHA" = "$SHA256" ] || { echo -e "${RED}sha256 mismatch! latest.json=$SHA256 actual=$ACTUAL_SHA${NC}" >&2; exit 1; }

echo -e "${CYAN}Deploying ${PACK_ID} v${VERSION} ...${NC}"

wrangler r2 object put "$BUCKET/modpacks/$PACK_ID/versions/$VERSION/pack.hyenipack" \
    --remote --file "$PACK_FILE"
wrangler r2 object put "$BUCKET/modpacks/$PACK_ID/latest.json" \
    --remote --file "$LATEST_FILE" --content-type "application/json"

echo -e "${GREEN}Done. latest → v${VERSION}${NC}"
echo -e "Verify: curl \$(scripts/get-worker-url.sh)/api/v2/modpacks/$PACK_ID/latest"
```

`chmod +x cloudflare-worker/deploy-hyenipack.sh`

- [ ] **Step 2: PowerShell 미러** — `cloudflare-worker/deploy-hyenipack.ps1`:

```powershell
<#
.SYNOPSIS
  HyeniPack V2 Deployment Script (Windows)
.EXAMPLE
  .\deploy-hyenipack.ps1 -Pack .\MyPack-1.2.0.hyenipack
#>
param(
    [Parameter(Mandatory=$true)][string]$Pack
)

$ErrorActionPreference = "Stop"
$Bucket = "hyenimc-releases"

if (-not (Test-Path $Pack)) { Write-Error "pack file not found: $Pack" }
$LatestFile = $Pack -replace '\.hyenipack$', '.latest.json'
if (-not (Test-Path $LatestFile)) { Write-Error "latest.json not found: $LatestFile" }

$json = Get-Content $LatestFile -Raw | ConvertFrom-Json
$PackId = $json.hyenipackId
$Version = $json.version
$Sha256 = $json.sha256

if ($PackId -notmatch '^[a-z0-9][a-z0-9-]{0,63}$') { Write-Error "Invalid hyenipackId: $PackId" }
if ($Version -notmatch '^\d+\.\d+\.\d+$') { Write-Error "Invalid version: $Version" }

$ActualSha = (Get-FileHash $Pack -Algorithm SHA256).Hash.ToLower()
if ($ActualSha -ne $Sha256) { Write-Error "sha256 mismatch! latest.json=$Sha256 actual=$ActualSha" }

Write-Host "Deploying $PackId v$Version ..." -ForegroundColor Cyan

wrangler r2 object put "$Bucket/modpacks/$PackId/versions/$Version/pack.hyenipack" --remote --file $Pack
if ($LASTEXITCODE -ne 0) { Write-Error "pack upload failed" }
wrangler r2 object put "$Bucket/modpacks/$PackId/latest.json" --remote --file $LatestFile --content-type "application/json"
if ($LASTEXITCODE -ne 0) { Write-Error "latest.json upload failed" }

Write-Host "Done. latest -> v$Version" -ForegroundColor Green
```

- [ ] **Step 3: e2e 검증** (실 R2 — 테스트 ID 사용)

```bash
# Task 3에서 export한 산출물로, 테스트용 id(예: hyenipack-test)를 넣어 export한 파일 사용
cd cloudflare-worker
./deploy-hyenipack.sh --pack ~/Downloads/hyenipack-test-1.0.0.hyenipack
curl -s $(scripts/get-worker-url.sh)/api/v2/modpacks/hyenipack-test/latest | node -e "process.stdin.pipe(process.stdout)"
# → 업로드한 latest.json 내용. sha256/version 일치 확인
curl -s "$(scripts/get-worker-url.sh)/download/v2/modpacks/hyenipack-test/1.0.0?token=<유효토큰>" -o /tmp/dl.hyenipack
shasum -a 256 /tmp/dl.hyenipack   # → latest.json의 sha256과 일치
# 정리: wrangler r2 object delete로 테스트 오브젝트 2건 제거
```

- [ ] **Step 4: 커밋**

```bash
git add cloudflare-worker/deploy-hyenipack.sh cloudflare-worker/deploy-hyenipack.ps1
git commit -m "feat(worker): deploy-hyenipack 스크립트 (sh/ps1) — 팩+latest.json R2 업로드"
```

---

### Task 6: 문서 갱신

**Files:**
- Modify: `docs/HYENIPACK_V2_AUTO_UPDATE.md` (결정 반영)
- Modify: `cloudflare-worker/DEPLOYMENT.md` (혜니팩 배포 절차 섹션 추가)

- [ ] **Step 1: V2 설계 문서에 확정 사항 반영** — `docs/HYENIPACK_V2_AUTO_UPDATE.md` 상단 "핵심 아이디어" 아래에 결정 로그 블록 추가:

```markdown
> **구현 확정 사항 (2026-07-06):**
> - 매니페스트/latest.json에 `breaking: boolean` 필드 추가. **"메이저/마이너 변경 시 업데이트 불가" 규칙은 폐기**하고 breaking 플래그로 대체 — breaking=true면 런처가 적용 전까지 게임 실행 차단(우회 불가), false면 "나중에" 허용.
> - 업데이트 서버 접근 불가 시: 기본 실행 차단 + 런처 설정(고급)의 강제 실행 옵션으로 우회 가능.
> - 팩 배포는 Worker 경유(`/api/v2/modpacks/...`), R2 직접 접근 없음. 다운로드는 토큰 검증 필수.
> - R2 키: `modpacks/<id>/latest.json` + `modpacks/<id>/versions/<version>/pack.hyenipack` (문서 내 `hyenimc-releases/modpacks/` 구조와 동일, registry.json은 보류).
> - 런처 측(자동 업데이트 체크·하이브리드 동기화)은 Tauri 재작성 M4에서 구현 (TAURI_MIGRATION_PHASE1.md 참조). 본 문서의 개발 계획 Phase 1.5/2/4는 Electron이 아닌 Tauri 대상으로 이관.
```

기존 "버전 정책" 두 곳(§2, 고려사항)에 `(폐기 — 2026-07-06, breaking 플래그로 대체)` 표기.

- [ ] **Step 2: DEPLOYMENT.md에 배포 절차 추가**:

```markdown
## HyeniPack 배포 (V2)

1. HyeniMC(제작자 도구)에서 프로필 → "혜니팩 내보내기" — 혜니팩 ID/버전/변경사항/breaking/정책 입력
2. 산출물 확인: `<팩>.hyenipack` + `<팩>.latest.json` (같은 폴더)
3. 업로드: `./deploy-hyenipack.sh --pack <팩>.hyenipack` (Windows: `.\deploy-hyenipack.ps1 -Pack <팩>`)
4. 확인: `curl $(scripts/get-worker-url.sh)/api/v2/modpacks/<id>/latest`
5. 롤백: 이전 버전 파일 쌍으로 3번 재실행
```

- [ ] **Step 3: 커밋**

```bash
git add docs/HYENIPACK_V2_AUTO_UPDATE.md cloudflare-worker/DEPLOYMENT.md
git commit -m "docs: HyeniPack V2 확정 사항(breaking 대체 등) + 배포 절차"
```

---

## Self-Review 결과

- **스펙 커버리지**: 로드맵 3번 범위(V2 export + Worker 채널 + 업로드 스크립트) 전부 태스크에 매핑. 런처 측 자동 업데이트/동기화는 의도적으로 제외(M4). Import UI 2-column도 제외(런처 M4 영역) — V2 문서 Phase 1.5는 Task 6에서 이관 표기.
- **의도된 보류**: `minLauncherVersion`(latest.json 옵션 필드 — 타입에만 존재, export UI 미노출. M4에서 필요 시 노출), `merge` 정책(타입 예약, UI 미노출), registry.json(modpack 목록 API — 단일 팩 운영이라 YAGNI).
- **타입 일관성**: `HyeniPackExportOptionsV2`/`buildManifestV2`/`buildLatestInfo`/R2 키/`MODPACK_ID_PATTERN` — Task 1↔2↔4↔5 간 이름·시그니처 대조 완료. exporter의 `manifest` 변수가 Task 2에서 `HyeniPackManifestV2`로 좁혀져 6.5단계에서 그대로 사용 가능함 확인.
