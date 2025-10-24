# HyeniPack 구현 로드맵

## 📋 개발 전략

메타 파일 시스템을 먼저 통합하고 안정화한 후, HyeniPack 기능을 단계적으로 구현합니다.

---

## Phase 1: 메타 파일 시스템 통합 (우선순위: 최상)

### 🎯 목표
- 기존 개별 `.meta.json` 방식을 유지하면서 통합 메타 파일 시스템 추가
- 두 방식의 공존 및 호환성 보장
- 기존 코드에 대한 영향 최소화

### 📝 작업 항목

#### 1.1 통합 메타 파일 유틸리티 작성
**파일**: `src/main/services/metadata-manager.ts` (신규)

```typescript
/**
 * 메타데이터 관리 통합 클래스
 * - 개별 .meta.json 읽기/쓰기
 * - 통합 .hyenimc-metadata.json 읽기/쓰기
 * - 자동 변환 및 마이그레이션
 */
export class MetadataManager {
  // 개별 메타 파일 읽기 (기존 호환)
  async readLegacyMetadata(modFilePath: string): Promise<InstalledModMeta | null>
  
  // 통합 메타 파일 읽기
  async readUnifiedMetadata(modsDir: string): Promise<UnifiedMetadata | null>
  
  // 통합 메타 파일 쓰기
  async writeUnifiedMetadata(modsDir: string, metadata: UnifiedMetadata): Promise<void>
  
  // 개별 → 통합 변환
  async migrateToUnified(modsDir: string): Promise<void>
  
  // 특정 모드의 메타 정보 가져오기 (자동 fallback)
  async getModMetadata(modsDir: string, fileName: string): Promise<InstalledModMeta | null>
  
  // 모든 모드 메타 정보 가져오기
  async getAllModsMetadata(modsDir: string): Promise<Record<string, InstalledModMeta>>
}
```

**작업 시간**: 2-3시간

---

#### 1.2 ModManager 통합 메타 파일 지원 추가
**파일**: `src/main/services/mod-manager.ts` (수정)

**변경 사항**:
```typescript
// 기존: 개별 .meta.json만 읽음
async parseMod(filePath: string) {
  const metaPath = `${filePath}.meta.json`;
  // ...
}

// 개선: 통합 메타 우선, 없으면 개별 메타로 fallback
async parseMod(filePath: string, modsDir: string) {
  // 1. 통합 메타에서 찾기
  const unifiedMeta = await this.metadataManager.readUnifiedMetadata(modsDir);
  const fileName = path.basename(filePath);
  
  if (unifiedMeta?.mods[fileName]) {
    return { /* 통합 메타 사용 */ };
  }
  
  // 2. 개별 메타로 fallback (기존 호환)
  const legacyMeta = await this.metadataManager.readLegacyMetadata(filePath);
  if (legacyMeta) {
    return { /* 개별 메타 사용 */ };
  }
  
  // 3. JAR 파싱
  return await this.parseModJar(filePath);
}
```

**작업 시간**: 1-2시간

---

#### 1.3 ModUpdater 통합 메타 파일 지원
**파일**: `src/main/services/mod-updater.ts` (수정)

**변경 사항**:
```typescript
// 기존: 개별 .meta.json 저장
const metaPath = `${modsDir}/${version.fileName}.meta.json`;
await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2));

// 개선: 통합 메타 업데이트
const unifiedMeta = await this.metadataManager.readUnifiedMetadata(modsDir) || {
  source: 'manual',
  installedAt: new Date().toISOString(),
  mods: {}
};

unifiedMeta.mods[version.fileName] = {
  source: update.source,
  sourceModId: update.modId,
  // ...
};

await this.metadataManager.writeUnifiedMetadata(modsDir, unifiedMeta);
```

**작업 시간**: 1시간

---

#### 1.4 마이그레이션 도구 작성
**파일**: `src/main/services/metadata-migrator.ts` (신규)

```typescript
/**
 * 기존 개별 메타 파일을 통합 메타로 변환
 */
export class MetadataMigrator {
  async migrateProfile(profileId: string): Promise<MigrationResult> {
    // 1. 프로필의 mods 디렉토리 찾기
    // 2. 모든 .meta.json 파일 수집
    // 3. 통합 메타로 변환
    // 4. 백업 생성
    // 5. 개별 메타 파일 삭제 (선택사항)
  }
  
  async migrateAllProfiles(): Promise<MigrationResult[]> {
    // 모든 프로필 순회하며 마이그레이션
  }
}
```

**작업 시간**: 1-2시간

---

#### 1.5 테스트 작성
**파일**: `src/main/services/__tests__/metadata-manager.test.ts` (신규)

**테스트 케이스**:
- ✅ 통합 메타 읽기/쓰기
- ✅ 개별 메타 fallback
- ✅ 마이그레이션 정확성
- ✅ 동시성 처리 (race condition)

**작업 시간**: 2시간

---

### ✅ Phase 1 완료 조건
- [x] MetadataManager 클래스 구현
- [x] ModManager 통합 메타 지원
- [x] ModUpdater 통합 메타 지원
- [x] 마이그레이션 도구 작성
- [x] 테스트 통과
- [x] 기존 기능 정상 동작 확인

**예상 소요 시간**: 7-10시간

---

## Phase 2: HyeniPack 코어 기능 완성 (우선순위: 높음)

### 🎯 목표
- HyeniPackManager 안정화
- 설치/검증 기능 완성
- IPC 핸들러 연결

### 📝 작업 항목

#### 2.1 HyeniPackManager 개선
**파일**: `src/main/services/hyenipack-manager.ts` (수정)

**개선 사항**:
```typescript
// 1. 에러 핸들링 강화
try {
  await this.downloadMod(mod, modsDir, profileId);
} catch (error) {
  if (mod.required) {
    throw new Error(`필수 모드 다운로드 실패: ${mod.name}`);
  }
  // 선택적 모드는 로깅만
  console.warn(`선택적 모드 다운로드 실패: ${mod.name}`, error);
}

// 2. 체크섬 검증 강화
if (mod.sha256) {
  const actualHash = await calculateSHA256(destPath);
  if (actualHash !== mod.sha256) {
    throw new Error('체크섬 불일치');
  }
}

// 3. 롤백 메커니즘
private async rollbackInstallation(instanceDir: string, backup: string) {
  // 설치 실패 시 롤백
}
```

**작업 시간**: 2-3시간

---

#### 2.2 체크섬 유틸리티 작성
**파일**: `src/main/utils/checksum.ts` (신규)

```typescript
export async function calculateSHA256(filePath: string): Promise<string>
export async function calculateSHA1(filePath: string): Promise<string>
export async function verifyChecksum(
  filePath: string, 
  expected: { algo: 'sha256' | 'sha1', value: string }
): Promise<boolean>
```

**작업 시간**: 1시간

---

#### 2.3 IPC 핸들러 작성
**파일**: `src/main/ipc/modpack-handlers.ts` (신규)

```typescript
// HyeniPack 관련 IPC 핸들러
ipcMain.handle('hyenipack:detect', async (event, filePath: string) => {
  return await hyeniPackManager.detectHyeniPack(filePath);
});

ipcMain.handle('hyenipack:validate', async (event, filePath: string) => {
  return await hyeniPackManager.validateHyeniPack(filePath);
});

ipcMain.handle('hyenipack:install', async (event, options: InstallOptions) => {
  // 진행률은 별도 이벤트로 전송
  event.sender.send('hyenipack:install-progress', progress);
  return await hyeniPackManager.installHyeniPack(...);
});

ipcMain.handle('hyenipack:export', async (event, options: ExportOptions) => {
  return await hyeniPackManager.exportToHyeniPack(...);
});
```

**작업 시간**: 1-2시간

---

#### 2.4 기존 ModpackManager 통합
**파일**: `src/main/services/modpack-manager.ts` (수정)

**이미 완료됨** ✅
- `detectModpackFormat()`에 hyenipack 추가
- `extractHyeniPackMetadata()` 구현
- `importModpackFromFile()`에서 HyeniPack 처리

**추가 작업**:
- 에러 처리 개선
- 로깅 강화

**작업 시간**: 1시간

---

#### 2.5 테스트 작성
**파일**: `src/main/services/__tests__/hyenipack-manager.test.ts` (신규)

**테스트 케이스**:
- ✅ 파일 감지
- ✅ 검증 (정상/비정상)
- ✅ 설치 프로세스
- ✅ Export 기능
- ✅ 체크섬 검증

**작업 시간**: 2-3시간

---

### ✅ Phase 2 완료 조건
- [x] HyeniPackManager 안정화
- [x] 체크섬 유틸리티 구현
- [x] IPC 핸들러 연결
- [x] ModpackManager 통합
- [x] 테스트 통과

**예상 소요 시간**: 7-10시간

---

## Phase 3: UI 구현 (우선순위: 중간)

### 🎯 목표
- HyeniPack 생성/가져오기 UI
- 진행률 표시
- 드래그 & 드롭 지원

### 📝 작업 항목

#### 3.1 모드팩 가져오기 UI
**파일**: `src/renderer/components/modpack/ModpackImportDialog.tsx` (신규)

**기능**:
- 파일 선택 (파일 탐색기)
- 드래그 & 드롭 지원
- 형식 자동 감지 표시
- 메타데이터 미리보기
- 프로필 이름 입력
- 설치 진행률 표시

**작업 시간**: 3-4시간

---

#### 3.2 모드팩 생성 UI
**파일**: `src/renderer/components/modpack/ModpackExportDialog.tsx` (신규)

**기능**:
- 프로필 선택
- Export 옵션 설정
  - Include overrides
  - Include server files
  - Include resource packs
  - Minify JSON
- 저장 위치 선택
- 생성 진행률 표시

**작업 시간**: 2-3시간

---

#### 3.3 진행률 컴포넌트
**파일**: `src/renderer/components/modpack/ModpackProgressBar.tsx` (신규)

**기능**:
- 단계별 진행률 (Validating → Downloading → Installing → Complete)
- 현재 작업 표시 (예: "모드 다운로드 중... 45/100")
- 취소 버튼
- 에러 메시지 표시

**작업 시간**: 1-2시간

---

#### 3.4 프로필 페이지에 통합
**파일**: `src/renderer/pages/ProfilesPage.tsx` (수정)

**추가 기능**:
- "모드팩 가져오기" 버튼
- "모드팩으로 내보내기" 버튼 (프로필 컨텍스트 메뉴)

**작업 시간**: 1시간

---

### ✅ Phase 3 완료 조건
- [x] 가져오기 UI 구현
- [x] 생성 UI 구현
- [x] 진행률 표시 구현
- [x] 프로필 페이지 통합
- [x] UI/UX 테스트

**예상 소요 시간**: 7-10시간

---

## Phase 4: HyeniWorld 통합 (우선순위: 낮음)

### 🎯 목표
- Worker API 연동
- 자동 업데이트 시스템
- 서버 연동 기능

### 📝 작업 항목

#### 4.1 Worker API 클라이언트 완성
**파일**: `src/main/services/worker-mod-updater.ts` (수정)

**기능**:
- HyeniWorld 모드 레지스트리 조회
- 버전 비교 및 업데이트 확인
- 자동 다운로드

**작업 시간**: 3-4시간

---

#### 4.2 HyeniWorld 인증 연동
**파일**: `src/main/services/hyeniworld-auth.ts` (신규)

**기능**:
- HyeniWorld 계정 인증
- SPA 토큰 발급
- 프로필 연동

**작업 시간**: 4-5시간

---

#### 4.3 서버 리소스 동기화
**파일**: `src/main/services/server-resource-sync.ts` (신규)

**기능**:
- 서버 권장 모드 확인
- 자동 동기화
- 버전 충돌 처리

**작업 시간**: 3-4시간

---

### ✅ Phase 4 완료 조건
- [x] Worker API 연동
- [x] 인증 시스템 구현
- [x] 리소스 동기화 구현
- [x] E2E 테스트

**예상 소요 시간**: 10-13시간

---

## 📊 전체 타임라인

| Phase | 작업 내용 | 예상 시간 | 우선순위 |
|-------|-----------|-----------|----------|
| **Phase 1** | 메타 파일 시스템 통합 | 7-10시간 | ⭐⭐⭐ 최상 |
| **Phase 2** | HyeniPack 코어 완성 | 7-10시간 | ⭐⭐ 높음 |
| **Phase 3** | UI 구현 | 7-10시간 | ⭐ 중간 |
| **Phase 4** | HyeniWorld 통합 | 10-13시간 | 낮음 |
| **총계** | | **31-43시간** | |

---

## 🚀 권장 개발 순서

### Week 1: 기반 구축
```
Day 1-2: Phase 1 (메타 파일 시스템)
  ├─ MetadataManager 구현
  ├─ ModManager 통합
  └─ 테스트 작성

Day 3: Phase 1 완료
  ├─ 마이그레이션 도구
  └─ 기존 기능 확인
```

### Week 2: 코어 기능
```
Day 4-5: Phase 2 (HyeniPack 코어)
  ├─ HyeniPackManager 개선
  ├─ IPC 핸들러
  └─ 테스트 작성

Day 6: Phase 2 완료
  └─ 통합 테스트
```

### Week 3: UI 구현
```
Day 7-9: Phase 3 (UI)
  ├─ 가져오기 UI
  ├─ 생성 UI
  └─ 프로필 페이지 통합
```

### 추후: HyeniWorld 연동
```
Phase 4는 서버 인프라 준비 후 진행
```

---

## ⚠️ 주의사항

### 1. 하위 호환성 유지
```typescript
// ✅ 좋은 예: 기존 코드도 동작
async getModMetadata(filePath: string) {
  // 1. 통합 메타 시도
  // 2. 개별 메타 fallback
  // 3. JAR 파싱
}

// ❌ 나쁜 예: 기존 코드 깨짐
async getModMetadata(filePath: string) {
  // 통합 메타만 읽고 실패
}
```

### 2. 마이그레이션은 선택사항
```typescript
// 사용자가 선택할 수 있도록
// - 자동 마이그레이션
// - 수동 마이그레이션
// - 기존 방식 유지
```

### 3. 에러 처리 철저히
```typescript
// 모드팩 설치는 여러 단계로 구성
// 각 단계마다 에러 처리 및 롤백 필요
try {
  await downloadMods();
  await applyOverrides();
  await generateMetadata();
} catch (error) {
  await rollback();
  throw error;
}
```

---

## 🎯 다음 단계

### 지금 바로 시작할 것
1. **Phase 1.1**: MetadataManager 클래스 작성
2. **Phase 1.2**: ModManager에 통합 메타 지원 추가
3. **Phase 1.3**: 간단한 테스트 작성

### 코드 작성 시작?
다음 중 선택하세요:
- A) Phase 1.1 MetadataManager부터 구현
- B) Phase 1.4 마이그레이션 도구부터 구현
- C) Phase 2.1 HyeniPackManager 개선부터 시작
- D) 전체 구조 검토 먼저

어떤 순서로 진행할까요?
