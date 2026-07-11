# 혜니팩 v2: 자동 업데이트 시스템 (하이브리드 아키텍처)

**작성일:** 2025년 11월 24일  
**최종 수정:** 2025년 12월 2일 (Phase 3 - Hybrid Design)  
**버전:** 2.0

---

## 📋 핵심 아이디어

혜니팩에 **혜니팩 ID** 추가 → R2에서 버전 관리 → 하이브리드 방식으로 자동 업데이트

```
혜니팩 Export (혜니팩 ID + 내장 정책 포함)
  → 수동으로 R2 업로드 (버전별 저장)
  → 런처가 자동 체크
  → 새 버전 감지 시 하이브리드 업데이트
    - Mods: 선언형 동기화 (자가 치유)
    - Configs: 내장 정책 기반 처리
```

> **구현 확정 사항 (2026-07-06):**
> - 매니페스트/latest.json에 `breaking: boolean` 필드 추가. **"메이저/마이너 변경 시 업데이트 불가" 규칙은 폐기**하고 breaking 플래그로 대체 — breaking=true면 런처가 적용 전까지 게임 실행 차단(우회 불가), false면 "나중에" 허용.
> - 업데이트 서버 접근 불가 시: 기본 실행 차단 + 런처 설정(고급)의 강제 실행 옵션으로 우회 가능.
> - 팩 배포는 Worker 경유(`/api/v2/modpacks/{id}/latest|versions`, `/download/v2/modpacks/{id}/{version}`), R2 직접 접근 없음. 다운로드는 토큰 검증 필수.
> - R2 키: `modpacks/<id>/latest.json` + `modpacks/<id>/versions/<version>/pack.hyenipack` (registry.json은 단일 팩 운영이라 보류).
> - **Export/배포 측(본 문서 Phase 1·3)은 구현 완료 (2026-07-06)** — exporter가 latest.json 사이드카까지 생성, `cloudflare-worker/deploy-hyenipack.sh(.ps1)`로 업로드.
> - 런처 측(자동 업데이트 체크·하이브리드 동기화·Import UI — 본 문서 Phase 1.5/2/4)은 **Electron이 아닌 Tauri 재작성 M4에서 구현** ([architecture/TAURI_MIGRATION_PHASE1.md](architecture/TAURI_MIGRATION_PHASE1.md) 참조).

---

## 🎯 설계 철학 (Phase 3 개선)

### 하이브리드 아키텍처

| 대상 | 방식 | 특징 |
|------|------|------|
| **Mods** | 선언형 (Declarative) | Manifest 비교 → 자동 동기화/자가 치유 |
| **Configs/기타** | 명령형 (Imperative) | 내장 정책(Embedded Policy) 기반 처리<br/>keep/replace/merge 선택 가능 |

### 핵심 철학
1. **로컬 중심 (Local-First)**: 중앙 서버(DB) 없이 R2 정적 호스팅만으로 작동
2. **단일 진실 공급원 (SSOT)**: 모든 정책은 `.hyenipack` 파일(Manifest) 안에 내장
3. **로직 통합**: Import와 Auto-Update가 동일한 정책 엔진 사용
4. **사용자 보호**: 사용자가 추가한 파일은 메타데이터로 구분하여 보호

---

## ✅ 가치 평가

| 장점 | 설명 |
|------|------|
| **단순함** | changes/ 디렉토리 불필요, R2 구조 단순화 |
| **안정성** | 선언형 동기화로 자가 치유 가능 |
| **정밀함** | 내장 정책으로 Config 파일 정교한 제어 |
| **일관성** | Import = Update (동일한 결과 보장) |

---

## 📐 설계

### 1. 혜니팩 포맷 v2 (Embedded Policy)

```typescript
export interface HyeniPackManifestV2 {
  formatVersion: 2;
  hyenipackId: string;         // "hyenipack-hyeniworld" (신규)
  name: string;
  version: string;             // SemVer (예: "1.2.0")
  author: string;
  description?: string;
  changelog?: string;          // 신규
  minecraft: {
    version: string;
    loaderType: LoaderType;
    loaderVersion: string;
  };
  
  // 모드 목록 (선언형 관리)
  mods: HyeniPackModEntry[];
  
  // 파일 업데이트 정책 (명령형 관리) - 신규
  // mods, shaderpacks, resourcepacks를 제외한 파일들에 적용
  overrides: OverridePolicy[];
  
  createdAt: string;
}

export interface OverridePolicy {
  path: string;                // 파일 또는 폴더 경로 (예: "config", "config/sodium-options.json")
  policy: 'keep' | 'replace' | 'merge';
}
```

**정책 우선순위 (Cascading Rule):**
- "가장 구체적인 규칙(Most Specific Match = Longest Prefix Match)" 우선 적용

**예시:**
```json
{
  "overrides": [
    { "path": "config", "policy": "keep" },                        // 기본: config 폴더 전체 유지
    { "path": "config/sodium-options.json", "policy": "replace" }  // 예외: 소듐 설정은 강제 교체
  ]
}
```
- `config/options.txt` → **Keep** (폴더 규칙)
- `config/sodium-options.json` → **Replace** (파일 규칙, 더 구체적이므로 우선)

---

### 정책별 동작 상세

#### 파일 단위 정책

| 정책 | 로컬에 파일 있음 | 로컬에 파일 없음 |
|------|----------------|----------------|
| **keep** | 건드리지 않음 (기존 유지) | 새 파일 설치 |
| **replace** | 덮어쓰기 | 새 파일 설치 |
| **merge** | 병합 시도* → 실패 시 덮어쓰기 | 새 파일 설치 |

*병합 가능 조건: JSON, Properties 등 구조화된 파일

#### 폴더 단위 정책

| 정책 | 동작 | 예시 |
|------|------|------|
| **keep** | 기존 파일 유지 + 새 파일만 추가 | `config/` 폴더에 keep 적용 시:<br/>- 기존: `a.json`, `b.json`<br/>- 신규: `b.json`, `c.json`<br/>→ 결과: `a.json`(유지), `b.json`(유지), `c.json`(추가) |
| **replace** | 폴더 통째로 교체<br/>(기존 파일 전체 삭제 후 재설치) | `config/` 폴더에 replace 적용 시:<br/>- 기존: `a.json`, `b.json`<br/>- 신규: `b.json`, `c.json`<br/>→ 결과: `a.json`(삭제), `b.json`(새로 설치), `c.json`(새로 설치) |
| **merge** | keep과 동일<br/>(기존 유지 + 신규 추가) | 폴더 병합 = 파일 additive 방식 |

#### 실전 예시

```json
{
  "overrides": [
    { "path": "config", "policy": "keep" },
    { "path": "config/sodium-options.json", "policy": "replace" },
    { "path": "scripts", "policy": "replace" }
  ]
}
```

**시나리오:**
- 로컬에 `config/options.txt`, `config/sodium-options.json`, `config/old-mod.json` 존재
- 혜니팩에 `config/sodium-options.json`, `config/new-mod.json` 포함
- 로컬에 `scripts/old-script.zs` 존재
- 혜니팩에 `scripts/new-script.zs` 포함

**결과:**
1. `config/`:
   - `options.txt` → 유지 (keep 정책)
   - `old-mod.json` → 유지 (keep 정책)
   - `sodium-options.json` → **덮어쓰기** (파일별 replace 정책이 더 구체적)
   - `new-mod.json` → 추가 (keep 정책)
2. `scripts/`:
   - `old-script.zs` → **삭제** (replace 정책)
   - `new-script.zs` → 설치 (replace 정책)

---

### 2. R2 구조 (단순화)

복잡한 `changes/` 디렉토리 없이, **버전별 파일**과 **최신 정보**만 유지합니다.

```
hyenimc-releases/modpacks/
├── hyenipack-hyeniworld/
│   ├── latest.json                    # 최신 버전 정보
│   └── versions/
│       ├── 1.0.0/hyenipack.hyenipack
│       ├── 1.1.0/hyenipack.hyenipack
│       └── 1.2.0/hyenipack.hyenipack
└── registry.json                      # 모든 모드팩 목록
```

**latest.json:**
```json
{
  "hyenipackId": "hyenipack-hyeniworld",
  "version": "1.2.0",
  "minLauncherVersion": "2.1.0",
  "changelog": "- Sodium 업데이트\n- Iris 추가\n- Config 최적화",
  "fileSize": 52428800,
  "sha256": "abc123..."
}
```

**변경점:**
- ❌ **삭제됨**: `changes/` 디렉토리 (더 이상 불필요)
- ✅ **추가됨**: Manifest에 `overrides` 필드 (내장 정책)

**버전 정책:** *(폐기 — 2026-07-06, breaking 플래그로 대체)*
- ~~✅ 업데이트 가능: 같은 메이저.마이너 내 (1.0.x → 1.0.y)~~
- ~~❌ 업데이트 불가: 메이저/마이너 변경 시 (1.0.x → 1.1.x)~~

---

### 3. Export 기능 (정책 내장)

**위치:** 프로필 상세보기 페이지 → "혜니팩 내보내기" 버튼

#### Export UI 플로우

1. **파일 선택**: 포함할 파일들을 체크
2. **정책 설정 (신규)**:
   - `mods`, `resourcepacks`, `shaderpacks`: 자동 관리 (정책 설정 불필요)
   - `config/`, `scripts/` 등 기타 파일: 정책 선택 가능
     - 기본값: **Keep** (사용자 설정 보존)
     - 우클릭 메뉴: "Change Policy to Replace"
     - 폴더 단위 설정 + 개별 파일 예외 처리
3. **생성**: 정책 정보가 포함된 `.hyenipack` 파일 생성

```typescript
export interface HyeniPackExportOptionsV2 {
  hyenipackId: string;         // 신규
  packName: string;
  version: string;
  author: string;
  description: string;
  changelog?: string;          // 신규
  selectedFiles: string[];
  overridePolicies: OverridePolicy[];  // 신규
}

// Export 시:
// 1. Manifest v2 생성 (hyenipackId + overrides 포함)
// 2. .hyenipack 파일 생성
// 3. 사용자가 수동으로 R2 업로드
```

#### R2 업로드 플로우

1. `.hyenipack` 파일을 그대로 업로드 (`versions/1.2.0/hyenipack.hyenipack`)
2. `.hyenipack` 내부의 `hyenipack.json`만 추출하여 `latest.json`으로 업로드
3. **끝!** (changes.json 생성 불필요)

---

### 4. Import 기능 (핵심)

Import와 Update는 **완전히 동일한 로직**을 사용합니다.

#### UI 설계: 2-Column Selection Layout

**케이스 1: 동일한 hyenipackId 프로필 존재**
```
┌───────────────────────────────────────────────────────────────────────────┐
│  ┌──────────────────────┐         ┌────────────────────────────────────┐ │
│  │ 📦 설치할 모드팩       │   ==>   │ 📁 일치하는 프로필                  │ │
│  │                      │         │                                    │ │
│  │ 혜니월드 생존 팩      │         │ ● 혜니월드 생존 (매칭)              │ │
│  │ v1.2.0              │         │   1.21.1 • Fabric 0.16.7          │ │
│  │ MC 1.21.1           │         │                                    │ │
│  │ Fabric 0.16.7       │         │ ○ 혜니월드 생존 백업 (매칭)         │ │
│  │ 모드 52개            │         │   1.21.0 • Fabric 0.16.5          │ │
│  │                      │         │                                    │ │
│  │ [선택됨: 새로 생성]   │         │ (스크롤 가능)                      │ │
│  └──────────────────────┘         └────────────────────────────────────┘ │
│                                                                            │
│  왼쪽 선택 → [새 프로필로 설치] (프로필 이름 입력 필요)                    │
│  오른쪽 선택 → [혜니월드 생존 업데이트]                                   │
└───────────────────────────────────────────────────────────────────────────┘
```

**케이스 2: 강제 업데이트 (hyenipackId 불일치)**
```
┌───────────────────────────────────────────────────────────────────────────┐
│  [✓] 프로필 강제 업데이트 (체크박스)                                       │
│                                                                            │
│  ┌──────────────────────┐         ┌────────────────────────────────────┐ │
│  │ 📦 설치할 모드팩       │   ==>   │ 📁 모든 프로필                      │ │
│  │                      │         │                                    │ │
│  │ 혜니월드 생존 팩      │         │ ○ 혜니월드 생존                     │ │
│  │ v1.2.0              │         │   1.21.1 • Fabric 0.16.7          │ │
│  │ MC 1.21.1           │         │                                    │ │
│  │ Fabric 0.16.7       │         │ ○ 크리에이티브                      │ │
│  │                      │         │   1.21.1 • Forge 52.0.23          │ │
│  │ [선택됨: 새로 생성]   │         │                                    │ │
│  │                      │         │ ○ 테스트                           │ │
│  └──────────────────────┘         │   1.20.1 • Vanilla                │ │
│                                   │                                    │ │
│                                   │ (스크롤 가능)                      │ │
│                                   └────────────────────────────────────┘ │
│                                                                            │
│  [프로필 이름: ___________]                                               │
│             [새 프로필로 설치]                                             │
└───────────────────────────────────────────────────────────────────────────┘
```

**케이스 3: 기본 (체크박스 OFF)**
```
┌───────────────────────────────────────────────────────────────────────────┐
│  [ ] 프로필 강제 업데이트                                                  │
│                                                                            │
│  ┌──────────────────────┐                                                 │
│  │ 📦 설치할 모드팩       │                                                 │
│  │                      │                                                 │
│  │ 혜니월드 생존 팩      │                                                 │
│  │ v1.2.0              │                                                 │
│  │ MC 1.21.1           │                                                 │
│  │ Fabric 0.16.7       │                                                 │
│  │ 모드 52개            │                                                 │
│  │                      │                                                 │
│  │ [자동 선택됨]         │                                                 │
│  └──────────────────────┘                                                 │
│                                                                            │
│  [프로필 이름: 혜니월드 생존]                                              │
│             [새 프로필로 설치]                                             │
└───────────────────────────────────────────────────────────────────────────┘
```

#### 프로필 정보 표시 (Tooltip)

**Lv1 (항상 표시)**:
```
● 혜니월드 생존
  1.21.1 • Fabric 0.16.7
```

**Lv2 (호버 툴팁)**:
```
┌──────────────────────┐
│ 📦 모드: 52개          │
│ 🕐 마지막: 2시간 전     │
│ ⏱️ 총 플레이: 15시간    │
│ ──────────────────── │
│ 혜니월드 서버용       │
└──────────────────────┘
```

---

### 5. 동기화 로직 (하이브리드)

Import(수동 설치)와 Auto-Update(자동 업데이트)는 **완전히 동일한 로직**을 사용합니다.

####  5.1 Mods 동기화 (선언형)

**원칙**: "Manifest에 있는 건 설치하고, 없는 건 삭제한다. 단, 사용자가 추가한 건 건드리지 않는다."

```typescript
async function syncMods(profileDir: string, manifest: HyeniPackManifestV2) {
  const existingMods = await scanModsDirectory(profileDir);
  const targetMods = manifest.mods;
  
  // 1. 삭제 대상 결정
  for (const localMod of existingMods) {
    const metadata = await metadataManager.getModMetadata(profileDir, localMod.fileName);
    
    // Manifest에 없는 모드 발견
    if (!targetMods.find(m => matchesMod(m, localMod))) {
      // 사용자가 추가한 모드는 보존
      if (metadata.found && metadata.metadata.installedFrom === 'manual') {
        console.log(`[Keep] User-added mod: ${localMod.fileName}`);
        continue;
      }
      
      // 혜니팩이 설치한 모드는 삭제
      if (metadata.found && metadata.metadata.installedFrom === 'hyenipack') {
        console.log(`[Remove] Managed mod no longer in manifest: ${localMod.fileName}`);
        await fs.unlink(path.join(profileDir, 'mods', localMod.fileName));
        await metadataManager.removeModMetadata(profileDir, localMod.fileName);
      }
    }
  }
  
  // 2. 추가/업데이트 대상 처리
  for (const targetMod of targetMods) {
    const existing = existingMods.find(m => matchesMod(targetMod, m));
    
    if (!existing) {
      // 신규 설치
      await downloadAndInstall(targetMod, profileDir);
    } else if (needsUpdate(targetMod, existing)) {
      // 버전 업데이트
      await removeOldVersion(existing);
      await downloadAndInstall(targetMod, profileDir);
    }
  }
}

function matchesMod(targetMod, localMod) {
  return targetMod.metadata?.source === localMod.source && 
         targetMod.metadata?.projectId === localMod.sourceModId;
}
```

**핵심 메타데이터 구조 (기존 활용):**
```typescript
export interface InstalledModMeta {
  source: 'modrinth' | 'curseforge' | 'url' | 'local';
  sourceModId?: string;
  versionNumber: string;
  installedAt: string;
  
  // 설치 출처 (핵심!)
  installedFrom?: 'hyenipack' | 'manual' | 'update' | 'dependency';
  
  // 모드팩 정보
  modpackId?: string;
  modpackVersion?: string;
}
```

#### 5.2 Configs/Others 동기화 (명령형)

**원칙**: "Manifest의 `overrides` 정책에 따라 처리한다."

```typescript
async function syncOverrides(profileDir: string, manifest: HyeniPackManifestV2) {
  const overrideFiles = await extractOverridesFromPack(manifest);
  
  for (const file of overrideFiles) {
    const targetPath = path.join(profileDir, file.relativePath);
    const policy = findPolicy(file.relativePath, manifest.overrides);
    
    switch (policy) {
      case 'keep':
        // 로컬 파일이 있으면 건너뜀
        if (await fs.pathExists(targetPath)) {
          console.log(`[Keep] Preserving existing: ${file.relativePath}`);
        } else {
          console.log(`[Keep/Add] Installing new file: ${file.relativePath}`);
          await fs.copy(file.sourcePath, targetPath);
        }
        break;
        
      case 'replace':
        // 무조건 덮어쓰기
        console.log(`[Replace] Overwriting: ${file.relativePath}`);
        await fs.copy(file.sourcePath, targetPath);
        break;
        
      case 'merge':
        // 가능한 경우 병합
        if (await isMergeable(targetPath, file.sourcePath)) {
          console.log(`[Merge] Merging: ${file.relativePath}`);
          await mergeFiles(targetPath, file.sourcePath);
        } else {
          console.log(`[Merge->Replace] Cannot merge, replacing: ${file.relativePath}`);
          await fs.copy(file.sourcePath, targetPath);
        }
        break;
    }
  }
}

/**
 * Cascading Rule: 가장 구체적인 정책 선택
 */
function findPolicy(filePath: string, policies: OverridePolicy[]): 'keep' | 'replace' | 'merge' {
  const matches = policies.filter(p => filePath.startsWith(p.path));
  
  if (matches.length === 0) {
    return 'keep';  // 기본값
  }
  
  // 가장 긴 경로(가장 구체적인 규칙) 선택
  matches.sort((a, b) => b.path.length - a.path.length);
  return matches[0].policy;
}
```

---

### 6. Import/Update 로직 (통합)

```typescript
async function importV2(packFilePath: string, selectedTarget: ImportTarget): Promise<ImportResult> {
  const manifest = await readManifest(packFilePath);
  
  if (selectedTarget.type === 'new') {
    // 새 프로필 생성
    return await createNewProfile(manifest, selectedTarget.profileName);
  } else if (selectedTarget.type === 'update') {
    // 기존 프로필 업데이트
    return await updateExistingProfile(selectedTarget.profile, manifest);
  }
}

interface ImportTarget {
  type: 'new' | 'update';
  profileName?: string;  // type='new'일 때 필수
  profile?: Profile;     // type='update'일 때 필수
}

async function updateExistingProfile(profile: Profile, manifest: HyeniPackManifestV2): Promise<ImportResult> {
  // 0. loaderType 변경 확인
  if (profile.loaderType !== manifest.minecraft.loaderType) {
    const confirmed = await showLoaderChangeWarning(profile, manifest);
    if (!confirmed) return { success: false, cancelled: true };
  }
  
  // 1. 프로필 버전 정보 업데이트
  // ✅ 검증 완료: 게임 시작 시 자동으로 로더 재설치됨
  await updateProfile({ 
    gameVersion: manifest.minecraft.version,
    loaderType: manifest.minecraft.loaderType,
    loaderVersion: manifest.minecraft.loaderVersion 
  });
  
  // 2. 하이브리드 동기화 (Import = Update 동일 로직)
  await syncMods(profile.path, manifest);           // 선언형
  await syncOverrides(profile.path, manifest);      // 명령형 (내장 정책)
  
  // 3. 메타데이터 업데이트
  await updateProfileMetadata(profile.id, {
    hyenipackId: manifest.hyenipackId,
    hyenipackVersion: manifest.version
  });
  
  return { success: true, updated: true };
}
```

---

### 7. 자동 업데이트 체크

**업데이트 타이밍:**
1. 게임 시작 전 혜니팩 업데이트 확인 (먼저)
2. HyeniHelper 등 필수 모드 업데이트 확인 (후)
3. 게임 실행

```typescript
export class HyeniPackUpdater {
  async checkUpdate(profileId: string): Promise<UpdateInfo | null> {
    // 1. 현재 hyenipackId 확인
    const metadata = await readMetadata(profileId);
    if (!metadata.hyenipackId) return null;
    
    // 2. R2에서 latest.json 조회
    const latest = await fetchLatestInfo(metadata.hyenipackId);
    
    // 3. 버전 정책 확인 (SemVer)
    const current = semver.parse(metadata.hyenipackVersion);
    const target = semver.parse(latest.version);
    
    // 메이저/마이너 다르면 업데이트 불가
    if (current.major !== target.major || current.minor !== target.minor) {
      return null;
    }
    
    // 4. 버전 비교
    if (semver.gt(latest.version, metadata.hyenipackVersion)) {
      return {
        hyenipackId: metadata.hyenipackId,
        currentVersion: metadata.hyenipackVersion,
        latestVersion: latest.version,
        changelog: latest.changelog
      };
    }
    
    return null;
  }
  
  async downloadAndUpdate(profileId, updateInfo, token): Promise<UpdateResult> {
    // 1. 새 혜니팩 파일 다운로드
    const packPath = await downloadHyeniPack(
      updateInfo.hyenipackId,
      updateInfo.latestVersion,
      token
    );
    
    // 2. Import 로직 재사용 (동일한 정책 엔진)
    const profile = await getProfile(profileId);
    return await importV2(packPath, { type: 'update', profile });
  }
}
```

### 7.1 에러 복구

```typescript
async downloadAndUpdate(profileId, updateInfo, token): Promise<UpdateResult> {
  try {
    // ... 업데이트 로직
  } catch (error) {
    if (error instanceof NetworkError) {
      return { success: false, retryable: true, error };
    }
    if (error instanceof ChecksumError) {
      await cleanupPartialDownload();
      return { success: false, retryable: true, error };
    }
    return { success: false, retryable: false, error };
  }
}
```

### 7.2 다운그레이드 (제한적 지원)

```typescript
async listVersions(hyenipackId): Promise<VersionInfo[]> {
  const registry = await fetchRegistry(hyenipackId);
  return registry.versions;  // ["1.0.0", "1.0.1", "1.0.2", ...]
}
// UI에서 버전 선택 후 수동 다운로드 가능
```

---

### 8. Worker API

> ⚠️ **보안 개선 필요**: 현재 URL 파라미터로 토큰 전달 → Authorization 헤더로 변경 필요
> 이 개선은 혜니팩 v2와 무관하게 HyeniMC 버전 업그레이드 시 별도 진행

```javascript
// GET /api/v2/modpacks/{hyenipackId}/latest.json
async function getLatestInfo(hyenipackId, env) {
  if (!isValidHyenipackId(hyenipackId)) {
    return new Response('Invalid ID', { status: 400 });
  }
  
  const latest = await env.RELEASES.get(`modpacks/${hyenipackId}/latest.json`);
  return new Response(latest, { 
    headers: { 'Cache-Control': 'public, max-age=300' }
  });
}

// GET /api/v2/modpacks/{hyenipackId}/download/{version}
// Authorization: Bearer {token}
async function download(hyenipackId, version, request, env) {
  if (!isValidHyenipackId(hyenipackId)) {
    return new Response('Invalid ID', { status: 400 });
  }
  
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!await validateToken(token, env)) {
    return new Response('Unauthorized', { status: 401 });
  }
  
  const file = await env.RELEASES.get(
    `modpacks/${hyenipackId}/versions/${version}/hyenipack.hyenipack`
  );
  return new Response(file.body);
}

function isValidHyenipackId(id) {
  const pattern = /^[a-z0-9\-]+$/;
  return pattern.test(id) && id.length <= 64 && !id.includes('..');
}
```

---

## 🚀 개발 계획 (2-3주)

### Phase 1: 포맷 업그레이드 (3일)
- `HyeniPackManifestV2` 타입 정의
- `OverridePolicy` 추가
- Export UI에 hyenipackId/changelog 입력 추가

### Phase 1.5: Import UI 리팩토링 (3일)
- 2-Column Selection Layout 구현
- 프로필 카드 디자인 (기본 정보 + 툴팁)
- 프로필 매칭 로직
- 강제 업데이트 체크박스

### Phase 2: 하이브리드 동기화 로직 (5일)
- `syncMods()` 구현 (선언형, 메타데이터 기반)
- `syncOverrides()` 구현 (명령형, 내장 정책 기반)
- `findPolicy()` Cascading Rule 구현
- 업데이트 감지 UI

### Phase 3: Export UI 정책 설정 (3일)
- 파일 선택 UI
- 정책 선택 UI (트리 구조)
- 우클릭 메뉴: "Change Policy"
- Manifest 생성 시 overrides 포함

### Phase 4: 자동 업데이트 (2일)
- `HyeniPackUpdater` 서비스
- 게임 시작 전 체크
- Import 로직 재사용 (통합)

### Phase 5: 테스트 및 문서 (2일)
- 기능 테스트
- 통합 테스트
- 수동 배포 가이드 문서

---

## 📊 사용 시나리오

### 시나리오 1: 최초 배포
```
관리자: Export (hyenipackId: "hyenipack-hyeniworld", v1.0.0 + overrides)
  → 수동으로 R2 업로드
사용자: Import → 새 프로필 생성 (내장 정책 적용)
```

### 시나리오 2: 자동 업데이트
```
관리자: 새 버전 Export (v1.1.0 + 업데이트된 overrides) → R2 업로드
사용자: 게임 실행
  → 런처: 업데이트 감지!
  → [업데이트] 클릭
  → 하이브리드 동기화 (Mods 선언형 + Configs 내장 정책)
  → "업데이트 완료! (사용자 추가 모드 3개 유지됨)"
```

### 시나리오 3: 수동 Import 업데이트
```
사용자: 새 .hyenipack 다운로드 → Import
런처: "기존 프로필 발견. 업데이트하시겠습니까?"
  → [업데이트] 선택
  → 하이브리드 동기화 (Import = Update 동일 로직)
```

### 시나리오 4: 강제 업데이트
```
사용자: 새 .hyenipack Import
런처: 2-column 레이아웃 표시
  → [✓] 프로필 강제 업데이트 체크
  → 오른쪽에서 기존 프로필 선택
  → 하이브리드 동기화
```

---

## ⚠️ 고려사항

### MC/로더 버전 자동 업데이트 검증 ✅
- ✅ 프로필의 `gameVersion`, `loaderVersion`만 업데이트하면 됨
- ✅ 다음 게임 시작 시 자동으로 새 버전 로더 설치
- ✅ 추가 구현 불필요 (기존 로직 재사용)

### 로직 통합 (핵심)
- ✅ **Import = Update**: 동일한 하이브리드 동기화 엔진 사용
- ✅ **일관성 보장**: 수동 설치와 자동 업데이트가 완전히 동일한 결과

### 사용자 모드 보호
- ✅ `installedFrom: 'manual'` → 보존
- ✅ `installedFrom: 'hyenipack'` → 관리 대상
- ✅ 충돌 시나리오: 파일명/ID 동일하면 혜니팩 버전으로 덮어쓰기 (이제부터 관리 대상)

### 정책 충돌
- Config 폴더 기본 정책: `keep`
- 특정 파일 예외 정책: `replace` (Cascading Rule로 해결)

### 버전 정책 *(폐기 — 2026-07-06, breaking 플래그로 대체)*
- ~~✅ 업데이트 가능: 같은 메이저.마이너 내 (1.0.x → 1.0.y)~~
- ~~❌ 업데이트 불가: 메이저/마이너 변경 시 (1.0.x → 1.1.x)~~

### loaderType 변경 처리
- Fabric → Forge 등 로더 변경 시 경고 표시
- "기존 모드가 모두 제거됩니다" 안내 후 사용자 확인

### 보안
- 토큰 검증, SHA256 체크섬, HTTPS 전송
- hyenipackId 입력 검증 (path traversal 방지)

> ⚠️ **별도 개선 필요** (HyeniMC 버전 업 시):
> - URL 파라미터 토큰 → Authorization 헤더로 변경
> - latest.json에서 downloadUrl 제거

---

## 💰 비용

**Cloudflare R2:**
- 혜니팩 평균 크기: 50MB
- 버전 5개 보관: 250MB
- 월 비용: < $0.01 (무시 가능)

---

## 📚 참고

- 기존: `/docs/HYENIPACK.md`
- 기존 논의: `/docs/MODPACK_DYNAMIC_UPDATE_DISCUSSION.md`
- 폐기: `/docs/TOKEN_BASED_MODPACK_SYSTEM.md`
- 세션 기록: `/docs/HYENIPACK_V2_DISCUSSION_SESSION.md`
