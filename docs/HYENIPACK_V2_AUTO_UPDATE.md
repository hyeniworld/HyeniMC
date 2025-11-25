# 혜니팩 v2: 자동 업데이트 시스템

**작성일:** 2025년 11월 24일  
**최종 수정:** 2025년 11월 24일  
**버전:** 2.0

---

## 📋 핵심 아이디어

혜니팩에 **혜니팩 ID** 추가 → hyenihelper처럼 R2에서 버전 관리 → 자동 업데이트

```
혜니팩 Export (혜니팩 ID 포함)
  → 수동으로 R2 업로드 (버전별 저장)
  → 런처가 자동 체크
  → 새 버전 감지 시 업데이트
```

---

## 🎯 가치 평가

| 장점 | 설명 |
|------|------|
| **단순함** | hyenihelper 시스템 100% 재사용 |
| **직관성** | "모드처럼 혜니팩도 업데이트" |
| **유연성** | 업데이트 or 새 프로필 선택 가능 |
| **저비용** | R2만 사용 (추가 비용 없음) |

### 기존 계획 vs 새 방식

| 항목 | 토큰 기반 서버 결정 | 혜니팩 v2 자동 업데이트 |
|------|-------------------|----------------------|
| 복잡도 | 높음 (D1, 서버 로직) | 낮음 (R2만) |
| 개발 시간 | 3-4주 | 2-3주 |
| 유지보수 | 복잡 | 단순 |

---

## ✅ 실현 가능성: 매우 높음 (90%+)

**이유:**
- WorkerModUpdater 패턴 그대로 적용
- hyenipack-importer 로직 재사용
- R2 구조 동일

---

## 📐 설계

### 1. 혜니팩 포맷 v2

```typescript
export interface HyeniPackManifestV2 {
  formatVersion: 2;
  hyenipackId: string;         // "hyenipack-hyeniworld" (신규)
  name: string;
  version: string;
  author: string;
  description?: string;
  changelog?: string;          // 신규
  minecraft: {
    version: string;
    loaderType: LoaderType;
    loaderVersion: string;
  };
  mods: HyeniPackModEntry[];
  createdAt: string;
}
```

### 2. R2 구조

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
  "version": "1.0.4",
  "minVersion": "1.0.0",
  "changelog": "- Sodium 업데이트\n- Iris 추가",
  "fileSize": 52428800,
  "sha256": "abc123..."
}
```

**changes/ 디렉토리 (변경점 추적):**
```
modpacks/hyenipack-hyeniworld/changes/
├── 1.0.0-to-1.0.1.json  # 순차 업데이트
├── 1.0.1-to-1.0.2.json
├── 1.0.2-to-1.0.3.json
├── 1.0.3-to-1.0.4.json
├── 1.0.0-to-1.0.4.json  # 직행 업데이트
├── 1.0.1-to-1.0.4.json
└── 1.0.2-to-1.0.4.json
```

**changes.json 예시:**
```json
{
  "fromVersion": "1.0.0",
  "toVersion": "1.0.4",
  "changes": [
    {
      "type": "mod",
      "action": "update",
      "path": "mods/sodium-0.6.0.jar",
      "previousPath": "mods/sodium-0.5.8.jar"
    },
    {
      "type": "config",
      "action": "replace",
      "path": "config/sodium-options.json"
    },
    {
      "type": "shaderpack",
      "action": "add",
      "path": "shaderpacks/BSL_v8.2.09.zip"
    }
  ]
}
```

**버전 정책:**
- ✅ 업데이트 가능: 같은 메이저.마이너 내 (1.0.x → 1.0.y)
- ❌ 업데이트 불가: 메이저/마이너 변경 시 (1.0.x → 1.1.x)

### 3. Export 기능 (프로필 상세보기)

**위치:** 프로필 상세보기 페이지 → "혜니팩 내보내기" 버튼

```typescript
export interface HyeniPackExportOptionsV2 {
  hyenipackId: string;         // 신규
  packName: string;
  version: string;
  author: string;
  description: string;
  changelog?: string;          // 신규
  selectedFiles: string[];
}

// Export 시:
// 1. Manifest v2 생성 (hyenipackId 포함)
// 2. .hyenipack 파일 생성
// 3. 사용자가 수동으로 R2 업로드
// (latest.json, changes/*.json은 R2 관리 도구로 별도 생성)
```

### 4. Import 기능 (핵심)

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

**케이스 2: hyenipackId 없거나 불일치 + 강제 업데이트**
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

#### 로직

```typescript
async importV2(packFilePath: string, selectedTarget: ImportTarget): Promise<ImportResult> {
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

async updateExistingProfile(profile, manifest): Promise {
  // 0. loaderType 변경 확인
  if (profile.loaderType !== manifest.minecraft.loaderType) {
    // 경고: "로더가 Fabric → Forge로 변경됩니다. 기존 모드가 모두 제거됩니다."
    const confirmed = await showLoaderChangeWarning(profile, manifest);
    if (!confirmed) return { success: false, cancelled: true };
  }
  
  // 1. 변경사항 계산
  const changes = await calculateChanges(profile, manifest);
  
  // 2. 프로필 버전 정보 업데이트
  // ✅ 검증 완료: 게임 시작 시 자동으로 로더 재설치됨
  await updateProfile({ 
    gameVersion: manifest.minecraft.version,
    loaderType: manifest.minecraft.loaderType,
    loaderVersion: manifest.minecraft.loaderVersion 
  });
  
  // 3. 모드/파일 업데이트
  await applyChanges(changes);
  await updateMetadata(manifest);
  
  return { success: true, updated: true, changes };
}

/**
 * 변경사항 계산 (Import 시 - 파일 기반)
 */
function calculateChanges(profile, manifest): Changes {
  return {
    // config: 보존 (기존 유지, 새 파일만 추가)
    configs: diffFiles(profile.configs, manifest.configs, 'preserve'),
    
    // mods: 교체 (출처+버전 비교)
    mods: diffMods(profile.mods, manifest.mods),
    
    // shaderpacks: 병합 (기존 유지 + 새 파일 추가)
    shaderpacks: diffFiles(profile.shaderpacks, manifest.shaderpacks, 'merge'),
    
    // resourcepacks: 병합
    resourcepacks: diffFiles(profile.resourcepacks, manifest.resourcepacks, 'merge'),
    
    // 기타: 추가만 (기존 유지, 새 파일만 추가)
    others: diffFiles(profile.others, manifest.others, 'addOnly')
  };
}

/**
 * 모드 비교 알고리즘
 */
function diffMods(existing, incoming): ModChanges {
  const changes = { add: [], remove: [], update: [] };
  
  for (const newMod of incoming) {
    const match = existing.find(m => 
      m.source === newMod.source && m.sourceModId === newMod.sourceModId
    );
    
    if (!match) {
      changes.add.push(newMod);
    } else if (match.version !== newMod.version) {
      changes.update.push({ old: match, new: newMod });
    }
    // 동일 버전 → 스킵
  }
  
  // 새 manifest에 없는 기존 모드는 유지 (Import 시)
  return changes;
}
```

### 5. 자동 업데이트 체크

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
      return null;  // 또는 "새 버전 설치 필요" 안내
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
  
  async downloadAndUpdate(profileId, updateInfo, token): Promise {
    // 1. changes.json 가져오기
    const changesUrl = `changes/${updateInfo.currentVersion}-to-${updateInfo.latestVersion}.json`;
    const changes = await fetchChanges(updateInfo.hyenipackId, changesUrl);
    
    // 2. 변경사항 적용 (R2 업데이트 정책)
    await applyR2Changes(profileId, changes, token);
    
    // 3. 메타데이터 업데이트
    await updateMetadata(profileId, updateInfo.latestVersion);
  }
}

/**
 * R2 업데이트 시 변경 적용 (메타데이터 기반)
 * Import와 다르게 config 등도 메타데이터에 따라 덮어쓰기 가능
 */
async function applyR2Changes(profileId, changes, token) {
  for (const change of changes.changes) {
    switch (change.action) {
      case 'add':
        await downloadAndAdd(change.path, token);
        break;
      case 'remove':
        await removeFile(change.path);
        break;
      case 'replace':
        await downloadAndReplace(change.path, token);
        break;
      case 'update':  // 모드 버전 업데이트
        await removeFile(change.previousPath);
        await downloadAndAdd(change.path, token);
        break;
      case 'skip':
        // 건드리지 않음
        break;
    }
  }
}
```

### 5.1 에러 복구

```typescript
async downloadAndUpdate(profileId, updateInfo, token): Promise {
  try {
    // ... 업데이트 로직
  } catch (error) {
    if (error instanceof NetworkError) {
      // 네트워크 오류: 재시도 안내
      return { success: false, retryable: true, error };
    }
    if (error instanceof ChecksumError) {
      // 체크섬 불일치: 재다운로드
      await cleanupPartialDownload();
      return { success: false, retryable: true, error };
    }
    // 기타 오류: 수동 복구 안내
    return { success: false, retryable: false, error };
  }
}
```

### 5.2 다운그레이드 (제한적 지원)

```typescript
// 버전 목록 조회
async listVersions(hyenipackId): Promise<VersionInfo[]> {
  const registry = await fetchRegistry(hyenipackId);
  return registry.versions;  // ["1.0.0", "1.0.1", "1.0.2", ...]
}

// UI에서 버전 선택 후 수동 다운로드 가능
// 자동 다운그레이드는 지원하지 않음
```

### 6. Worker API

> ⚠️ **보안 개선 필요**: 현재 URL 파라미터로 토큰 전달 → Authorization 헤더로 변경 필요
> 이 개선은 혜니팩 v2와 무관하게 HyeniMC 버전 업그레이드 시 별도 진행

```javascript
// GET /api/v2/modpacks/{hyenipackId}/latest.json
async function getLatestInfo(hyenipackId, env) {
  // 입력 검증
  if (!isValidHyenipackId(hyenipackId)) {
    return new Response('Invalid ID', { status: 400 });
  }
  
  const latest = await env.RELEASES.get(
    `modpacks/${hyenipackId}/latest.json`
  );
  return new Response(latest, { 
    headers: { 'Cache-Control': 'public, max-age=300' }
  });
}

// GET /api/v2/modpacks/{hyenipackId}/changes/{from}-to-{to}.json
async function getChanges(hyenipackId, from, to, env) {
  if (!isValidHyenipackId(hyenipackId)) {
    return new Response('Invalid ID', { status: 400 });
  }
  
  const changes = await env.RELEASES.get(
    `modpacks/${hyenipackId}/changes/${from}-to-${to}.json`
  );
  return new Response(changes);
}

// GET /api/v2/modpacks/{hyenipackId}/download/{version}
// Authorization: Bearer {token}
async function download(hyenipackId, version, request, env) {
  // 입력 검증
  if (!isValidHyenipackId(hyenipackId)) {
    return new Response('Invalid ID', { status: 400 });
  }
  
  // 토큰 검증 (헤더에서)
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!await validateToken(token, env)) {
    return new Response('Unauthorized', { status: 401 });
  }
  
  const file = await env.RELEASES.get(
    `modpacks/${hyenipackId}/versions/${version}/hyenipack.hyenipack`
  );
  return new Response(file.body);
}

// 입력 검증 함수
function isValidHyenipackId(id) {
  const pattern = /^[a-z0-9\-]+$/;
  return pattern.test(id) && id.length <= 64 && !id.includes('..');
}
```

---

## 🚀 개발 계획 (2-3주)

### Phase 1: 포맷 업그레이드 (3일)
- `HyeniPackManifestV2` 타입 정의
- Export UI에 hyenipackId/changelog 입력 추가
- latest.json 로컬 생성 (사용자가 R2에 수동 업로드)

### Phase 1.5: Import UI 리팩토링 (3일)
- 2-Column Selection Layout 구현
  - 왼쪽: 모드팩 카드 (선택 가능)
  - 오른쪽: 프로필 목록 (조건부 표시)
- 프로필 카드 디자인
  - **기본 정보 항상 표시**: MC 버전, 로더 타입, 로더 버전
  - **호버 시 툴팁**: 모드 개수, 마지막 플레이 시간, 총 플레이 시간
  - 2줄 레이아웃: 프로필명 + 버전 정보
- 프로필 매칭 로직
  - hyenipackId 기반 자동 매칭
  - 강제 업데이트 체크박스
- 선택 상태 관리
  - 라디오 버튼 스타일 선택
  - 버튼 텍스트 동적 변경
- 반응형 디자인
  - 스크롤 가능한 프로필 목록
  - 좁은 화면 대응

### Phase 2: 업데이트 로직 (5일)
- `calculateChanges()` 구현 (MC 버전, 로더 버전, 모드, 파일 diff)
- `updateExistingProfile()` 구현 (프로필 업데이트 포함)
- 업데이트 감지 UI

### Phase 3: 자동 업데이트 (4일)
- `HyeniPackUpdater` 서비스
- 게임 시작 전 체크
- 원클릭 업데이트

### Phase 4: R2 및 Worker (2일)
- Worker API 추가
- 수동 배포 가이드 문서

### Phase 5: 테스트 (3일)
- 기능 테스트
- 통합 테스트
- 문서 작성

---

## 📊 사용 시나리오

### 시나리오 1: 최초 배포
```
관리자: Export (hyenipackId: "hyenipack-hyeniworld", v1.0.0)
  → 수동으로 R2 업로드
사용자: Import → 새 프로필 생성
```

### 시나리오 2: 자동 업데이트
```
관리자: 새 버전 Export (v1.1.0) → 수동으로 R2 업로드
사용자: 게임 실행
  → 런처: 업데이트 감지!
  → 알림: "v1.0.0 → v1.1.0 업데이트"
  → [업데이트] 클릭 → 자동 적용
```

### 시나리오 3: 수동 Import 업데이트
```
사용자: 새 .hyenipack 다운로드 → Import
런처: "기존 프로필 발견. 업데이트하시겠습니까?"
  → [업데이트] 선택 → MC 버전, 로더 버전, 모드, 파일 모두 업데이트
```

### 시나리오 4: hyenipackId 없는 프로필 강제 업데이트
```
사용자: 새 .hyenipack Import
런처: Import 화면에서 2-column 레이아웃 표시

┌───────────────────────────────────────────────────────────────────────────┐
│ [✓] 프로필 강제 업데이트                                                  │
│                                                                            │
│  ┌──────────────────────┐         ┌────────────────────────────────────┐ │
│  │ 📦 설치할 모드팩       │   ==>   │ 📁 모든 프로필                      │ │
│  │                      │         │                                    │ │
│  │ 혜니월드 생존 팩      │         │ ○ 혜니월드 생존                     │ │
│  │ v1.2.0              │         │   1.21.1 • Fabric 0.16.7          │ │
│  │ MC 1.21.1           │         │                                    │ │
│  │ Fabric 0.16.7       │         │ ○ 크리에이티브                      │ │
│  │ 모드 52개            │         │   1.21.1 • Forge 52.0.23          │ │
│  │                      │         │                                    │ │
│  │ [선택됨: 새로 생성]   │         │ ○ 테스트                           │ │
│  │                      │         │   1.20.1 • Vanilla                │ │
│  └──────────────────────┘         │                                    │ │
│                                   │ (스크롤 가능)                      │ │
│                                   └────────────────────────────────────┘ │
│                                                                            │
│  [프로필 이름: 혜니월드 생존]                                              │
│             [새 프로필로 설치]                                             │
└───────────────────────────────────────────────────────────────────────────┘

→ 왼쪽 선택: 새 프로필 생성 (기본)
→ 오른쪽 선택: 선택한 프로필 업데이트 (예: 혜니월드 생존)
```

---

## ⚠️ 고려사항

### 기존 프로필 마이그레이션
- v1 혜니팩으로 만든 기존 프로필은 hyenipackId 없음
- 자동 업데이트 불가 (수동 Import만 가능)
- 문제없음: 새 버전부터 자동 업데이트 지원

### MC/로더 버전 자동 업데이트 검증 ✅

**검증 결과:**
```typescript
// src/main/ipc/profile.ts - PROFILE_PLAY_GAME 핸들러

// 1. 프로필 정보 가져오기
const profile = await profileRpc.getProfile({ id: profileId });

// 2. 로더 설치 필요 여부 확인
if (profile.loaderType !== 'vanilla') {
  const isInstalled = await loaderManager.isLoaderInstalled(
    profile.loaderType,
    profile.gameVersion,  // ← 프로필 정보 사용
    profile.loaderVersion // ← 프로필 정보 사용
  );
  
  if (!isInstalled) {
    // 3. 자동으로 로더 설치
    await loaderManager.installLoader(
      profile.loaderType,
      profile.gameVersion,
      profile.loaderVersion
    );
  }
}
```

**결론:**
- ✅ 프로필의 `gameVersion`, `loaderVersion`만 업데이트하면 됨
- ✅ 다음 게임 시작 시 자동으로 새 버전 로더 설치
- ✅ 추가 구현 불필요 (기존 로직 재사용)

### Export 접근 제한 불필요
- 일반 사용자도 Export 사용 가능 (예: 친구와 공유)
- 제한 없이 모든 사용자에게 개방

### 공개/제한 혜니팩 구분 불필요
- **R2 업데이트**: 토큰 필요 (자동)
- **파일 Import**: 토큰 불필요 (수동)
- 자연스럽게 구분됨 → 별도 플래그 불필요

### 버전 정책
- **업데이트 가능**: 같은 메이저.마이너 내 (1.0.x → 1.0.y)
- **업데이트 불가**: 메이저/마이너 변경 시 (1.0.x → 1.1.x)
- **다운그레이드**: 제한적 지원 (버전 목록 표시, 수동 다운로드)

### loaderType 변경 처리
- Fabric → Forge 등 로더 변경 시 경고 표시
- "기존 모드가 모두 제거됩니다" 안내 후 사용자 확인

### 업데이트 정책 차이 (Import vs R2)

| 타입 | Import (파일) | R2 업데이트 |
|------|------------|-------------|
| config | 보존 (새 파일만 추가) | 메타데이터 기반 |
| mods | 교체 (출처+버전 비교) | 메타데이터 기반 |
| shaderpacks | 병합 | 메타데이터 기반 |
| resourcepacks | 병합 | 메타데이터 기반 |
| 기타 | 추가만 | 메타데이터 기반 |

**R2 매타데이터 action:**
- `skip`: 건드리지 않음
- `add`: 새로 추가
- `replace`: 덮어쓰기
- `remove`: 삭제
- `update`: 모드 버전 업데이트 (기존 삭제 + 새 파일)

### 보안
- 토큰 검증 (기존 시스템 활용)
- SHA256 체크섬
- HTTPS 전송
- hyenipackId 입력 검증 (path traversal 방지)

> ⚠️ **별도 개선 필요** (HyeniMC 버전 업 시):
> - URL 파라미터 토큰 → Authorization 헤더로 변경
> - latest.json에서 downloadUrl 제거 (직접 경로 노출 방지)

### 성능
- latest.json: 5분 캐시
- 버전 체크: < 1초
- 다운로드: 네트워크 속도 의존

### 진행률 UI
- 기존 모드팩 설치 UI 재사용
- 별도 구현 불필요

### 동시성
- 게임 실행 중 업데이트 시도 차단
- 런처 다중 인스턴스 실행은 의도하지 않음 (고려 대상 외)

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
