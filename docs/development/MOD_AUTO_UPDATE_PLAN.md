# 필수 모드 자동 업데이트 시스템 구현 계획

## 📋 목표

**특정 서버 프로필**의 게임 실행 전, Cloudflare Worker에서 배포하는 **모든 모드**를 자동으로 체크하고 업데이트하는 시스템 구축

> ⚠️ **핵심 컨셉**: Worker에서 배포하는 모드 = 필수 모드 (별도 플래그 불필요)
> 
> ⚠️ **중요**: 일반 프로필은 모드 체크 없이 바로 실행

> 📄 **서버 감지 방법**: `SERVER_DETECTION_OPTIONS.md` 참고 (검토 대기)
>    - Option A: Hybrid (Profile + servers.dat) - **권장**
>    - Option B: Profile Only
>    - Option C: servers.dat Only

---

## 🏗️ 아키텍처 설계

### 현재 구조
```
게임 실행 플로우:
1. Minecraft 다운로드
2. 로더 설치
3. 게임 실행 ❌ (필수 모드 체크 없음)
```

### 수정 후 구조
```
게임 실행 플로우:
1. Minecraft 다운로드
2. 로더 설치
3. 서버 주소 확인 ✅ (NEW!)
   ├─ *.hyeniworld.com → 필수 모드 체크 & 업데이트
   └─ 기타 서버 → 스킵
4. 게임 실행
```

---

## 📦 Phase 1: 범용 Mod Updater 서비스

### 1-1. 새 파일 생성: `mod-updater.ts`

**위치:** `/src/main/services/mod-updater.ts`

**기능:**
- Worker API에서 모드 레지스트리 가져오기
- **레지스트리에 등록된 모든 모드 = 필수 모드** (별도 필터링 불필요)
- 로컬 버전 vs 최신 버전 비교
- 다운로드 & 설치

**주요 메서드:**
```typescript
class ModUpdater {
  // 서버 주소가 필수 모드 대상인지 확인
  // ⚠️ 구현 방법은 SERVER_DETECTION_OPTIONS.md 참고
  static isRequiredModServer(serverAddress: string): boolean
  // 또는 (Option A 선택 시)
  static async isRequiredModServer(profileServerAddress: string | undefined, gameDirectory: string): Promise<boolean>
  
  // 모드 레지스트리 가져오기 (등록된 모든 모드 = 필수)
  async fetchModRegistry(): Promise<ModRegistry>
  
  // 레지스트리에서 현재 환경에 맞는 모드 필터링
  async getApplicableMods(gameVersion: string, loaderType: string): Promise<ModInfo[]>
  
  // 특정 모드 업데이트 체크
  async checkModUpdate(modId: string, profilePath: string, gameVersion: string, loaderType: string): Promise<ModUpdateInfo | null>
  
  // 모든 모드 체크 (레지스트리의 모든 모드)
  async checkAllMods(profilePath: string, gameVersion: string, loaderType: string): Promise<ModUpdateInfo[]>
  
  // 모드 다운로드 & 설치
  async installMod(profilePath: string, updateInfo: ModUpdateInfo, token: string, onProgress?: (progress: number) => void): Promise<void>
  
  // 로컬 모드 버전 감지 (유연한 패턴: modId-*.jar)
  private async getLocalModVersion(profilePath: string, modId: string): Promise<string | null>
  
  // 토큰 가져오기 (hyenihelper-config.json 공유)
  private async getUserToken(profilePath: string): Promise<string | null>
}
```

**타입 정의:**
```typescript
interface ModRegistry {
  version: string;
  lastUpdated: string;
  mods: ModInfo[];
}

interface ModInfo {
  id: string;
  name: string;
  description: string;
  latestVersion: string;
  gameVersions: string[];
  loaders: string[];
  category: string;
  // required 필드 제거 - 레지스트리에 있으면 필수
}

interface ModUpdateInfo {
  modId: string;
  modName: string;
  available: boolean;
  currentVersion: string | null;
  latestVersion: string;
  downloadUrl: string;
  sha256: string;
  size: number;
  changelog: string;
  gameVersion: string;
  loader: string;
  // required 필드 제거 - 모두 필수
}
```

### 1-2. 기존 `hyeni-updater.ts` 리팩토링

**선택지:**
- **옵션 A**: `hyeni-updater.ts` 삭제하고 `mod-updater.ts`로 통합 (권장)
- **옵션 B**: `hyeni-updater.ts` 유지하되 내부적으로 `mod-updater.ts` 사용

---

## 📦 Phase 2: 게임 실행 플로우 수정

### 2-1. `profile.ts` - PROFILE_LAUNCH 핸들러 수정

**위치:** `/src/main/ipc/profile.ts` 라인 215-364

**수정 내용:**

```typescript
// 기존 코드 (라인 305 이후에 추가)
console.log('[IPC Profile] Download verification completed');

// 🆕 NEW: 서버 주소 확인 후 모드 체크
const { ModUpdater } = await import('../services/mod-updater');

// 서버 주소가 *.hyeniworld.com인 경우만 모드 체크
if (ModUpdater.isRequiredModServer(profile.serverAddress || '')) {
  console.log(`[IPC Profile] Server ${profile.serverAddress} requires mod validation`);
  console.log('[IPC Profile] Checking worker-deployed mods...');
  
  const modUpdater = new ModUpdater();
  const modUpdates = await modUpdater.checkAllMods(
    instanceDir,
    profile.gameVersion,
    profile.loaderType
  );

  if (modUpdates.length > 0) {
    console.log(`[IPC Profile] Found ${modUpdates.length} mod updates`);
    
    // 토큰 가져오기
    const token = await modUpdater['getUserToken'](instanceDir);
    if (!token) {
      throw new Error('모드 업데이트를 위한 인증이 필요합니다.\nDiscord에서 /인증 명령어로 인증하세요.');
    }
    
    // 각 모드 업데이트
    for (const update of modUpdates) {
      console.log(`[IPC Profile] Updating ${update.modName}: ${update.currentVersion || 'none'} -> ${update.latestVersion}`);
      
      await modUpdater.installMod(instanceDir, update, token, (progress) => {
        if (window) {
          window.webContents.send('mod:update-progress', {
            modId: update.modId,
            modName: update.modName,
            progress,
          });
        }
      });
      
      console.log(`[IPC Profile] ✅ ${update.modName} updated successfully`);
    }
    
    console.log('[IPC Profile] All mods updated');
  } else {
    console.log('[IPC Profile] All mods are up to date');
  }
} else {
  console.log(`[IPC Profile] Server ${profile.serverAddress || 'none'} does not require mod validation - skipping`);
}

// Install loader if needed (기존 코드 계속)
let actualVersionId = profile.gameVersion;
```

### 2-2. 진행 상황 UI 이벤트

**새 이벤트:**
```typescript
window.webContents.send('mod:update-progress', {
  modId: string,
  modName: string,
  progress: number,  // 0-100
})
```

---

## 📦 Phase 3: UI 업데이트

### 3-1. 프로필 상세 페이지 - 모든 필수 모드 표시

**위치:** `/src/renderer/pages/ProfileDetailPage.tsx`

**변경:**
- `useHyeniUpdate` 훅을 `useRequiredMods` 훅으로 대체
- 여러 모드 업데이트 알림 표시

**새 훅: `/src/renderer/hooks/useRequiredMods.ts`**

```typescript
export function useRequiredMods({
  profilePath,
  gameVersion,
  loaderType,
  enabled = true
}: UseRequiredModsOptions) {
  const [updates, setUpdates] = useState<ModUpdateInfo[]>([]);
  const [isChecking, setIsChecking] = useState(false);
  
  const checkForUpdates = async () => {
    if (!profilePath || !enabled) return;
    
    setIsChecking(true);
    try {
      const result = await window.electronAPI.mods.checkAll(
        profilePath,
        gameVersion,
        loaderType
      );
      setUpdates(result);
    } catch (error) {
      console.error('Failed to check mods:', error);
    } finally {
      setIsChecking(false);
    }
  };
  
  return {
    updates,
    isChecking,
    checkForUpdates,
    hasUpdates: updates.length > 0,
  };
}
```

### 3-2. 게임 실행 중 모드 업데이트 프로그레스 표시

**위치:** `/src/renderer/pages/ProfileDetailPage.tsx`

```typescript
useEffect(() => {
  const handleModProgress = (event: any, data: { modId: string; modName: string; progress: number }) => {
    // 모드 업데이트 진행률 표시
    console.log(`Updating ${data.modName}: ${data.progress}%`);
  };
  
  window.electronAPI.on('mod:update-progress', handleModProgress);
  
  return () => {
    window.electronAPI.off('mod:update-progress', handleModProgress);
  };
}, []);
```

---

## 📦 Phase 4: IPC 핸들러 추가

### 4-1. 새 파일: `/src/main/ipc/mod.ts`

```typescript
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants/ipc';
import { ModUpdater } from '../services/mod-updater';

export function registerModHandlers() {
  const modUpdater = new ModUpdater();
  
  // 모드 레지스트리 가져오기
  ipcMain.handle(IPC_CHANNELS.MOD_GET_REGISTRY, async () => {
    return await modUpdater.fetchModRegistry();
  });
  
  // 모든 필수 모드 체크
  ipcMain.handle(
    IPC_CHANNELS.MOD_CHECK_ALL,
    async (event, profilePath: string, gameVersion: string, loaderType: string) => {
      return await modUpdater.checkAllRequiredMods(profilePath, gameVersion, loaderType);
    }
  );
  
  // 특정 모드 업데이트
  ipcMain.handle(
    IPC_CHANNELS.MOD_INSTALL,
    async (event, profilePath: string, updateInfo: any) => {
      const token = await modUpdater['getUserToken'](profilePath);
      if (!token) {
        throw new Error('인증 토큰이 없습니다.');
      }
      
      await modUpdater.installMod(profilePath, updateInfo, token);
    }
  );
}
```

### 4-2. IPC 채널 상수 추가

**위치:** `/src/shared/constants/ipc.ts`

```typescript
export const IPC_CHANNELS = {
  // ... 기존 채널들
  
  // Mod management
  MOD_GET_REGISTRY: 'mod:getRegistry',
  MOD_CHECK_ALL: 'mod:checkAll',
  MOD_INSTALL: 'mod:install',
};
```

### 4-3. Preload API 추가

**위치:** `/src/preload/preload.ts`

```typescript
mods: {
  getRegistry: (): Promise<ModRegistry> =>
    ipcRenderer.invoke(IPC_CHANNELS.MOD_GET_REGISTRY),
  checkAll: (profilePath: string, gameVersion: string, loaderType: string): Promise<ModUpdateInfo[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.MOD_CHECK_ALL, profilePath, gameVersion, loaderType),
  install: (profilePath: string, updateInfo: ModUpdateInfo): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.MOD_INSTALL, profilePath, updateInfo),
},
```

---

## 📦 Phase 5: 에러 처리 & UX 개선

### 5-1. 토큰 없을 때 처리

**시나리오:**
- 필수 모드 업데이트 필요
- 토큰 없음
- **차단**: 게임 실행 불가

**에러 메시지:**
```
필수 모드 업데이트를 위해 인증이 필요합니다.

Discord에서 /인증 명령어를 사용하여 인증하세요.
```

### 5-2. 모드 다운로드 실패 시

**옵션 A (권장)**: 게임 실행 차단
```
필수 모드 다운로드에 실패했습니다.
인터넷 연결을 확인하고 다시 시도하세요.
```

**옵션 B**: 경고 후 실행 허용 (비권장)

### 5-3. 프로그레스 UI

**게임 실행 중:**
```
[==========] Minecraft 다운로드 완료
[==========] Fabric 설치 완료
[=====>    ] HyeniHelper 업데이트 중... (50%)
[          ] 게임 시작 대기 중
```

---

## 📦 Phase 6: 테스트 시나리오

### 6-1. 단위 테스트

- [ ] ModUpdater.fetchModRegistry()
- [ ] ModUpdater.getRequiredMods()
- [ ] ModUpdater.checkModUpdate()
- [ ] ModUpdater.installMod()

### 6-2. 통합 테스트

**시나리오 1: 새 프로필 (모드 없음)**
```
1. 프로필 생성
2. 게임 실행
3. 필수 모드 자동 다운로드 확인
4. 게임 실행 성공
```

**시나리오 2: 기존 프로필 (모드 구버전)**
```
1. HyeniHelper 1.0.0 설치
2. Worker에 1.0.1 배포
3. 게임 실행
4. 자동 업데이트 확인
5. 게임 실행 성공
```

**시나리오 3: 토큰 없음 (혜니월드 서버)**
```
1. 프로필 생성 (serverAddress: play.example.com, 토큰 없음)
2. 게임 실행
3. 인증 요구 메시지 확인
4. 실행 차단 확인
```

**시나리오 3-1: 일반 서버 (토큰 없어도 OK)**
```
1. 프로필 생성 (serverAddress: mc.hypixel.net, 토큰 없음)
2. 게임 실행
3. 필수 모드 체크 스킵 확인
4. 게임 실행 성공
```

**시나리오 4: 여러 필수 모드**
```
1. Worker에 HyeniHelper, HyeniCore 등록 (required: true)
2. 게임 실행
3. 모든 모드 다운로드 확인
4. 게임 실행 성공
```

---

## 🚀 구현 순서

### Step 1: 핵심 서비스 (1-2일)
- [ ] `mod-updater.ts` 구현
- [ ] `hyeni-updater.ts` 제거 또는 통합

### Step 2: IPC 레이어 (반나절)
- [ ] `mod.ts` IPC 핸들러
- [ ] IPC 채널 상수 추가
- [ ] Preload API 추가

### Step 3: 게임 실행 플로우 (반나절)
- [ ] `profile.ts` PROFILE_LAUNCH 수정
- [ ] 필수 모드 체크 & 업데이트 추가

### Step 4: UI (1일)
- [ ] `useRequiredMods` 훅
- [ ] 프로필 상세 페이지 수정
- [ ] 프로그레스 UI

### Step 5: 테스트 & 버그 수정 (1일)
- [ ] 단위 테스트
- [ ] 통합 테스트
- [ ] 에러 처리 보완

---

## ⚠️ 주의사항

### 0. 서버 주소 필터링 (가장 중요!)

**조건:**
```typescript
static isRequiredModServer(serverAddress: string): boolean {
  if (!serverAddress) return false;
  
  const normalized = serverAddress.toLowerCase().trim();
  return normalized.endsWith('.hyeniworld.com');
}
```

**적용:**
- ✅ `play.example.com` → 필수 모드 체크
- ✅ `test.hyeniworld.com` → 필수 모드 체크
- ❌ `mc.hypixel.net` → 스킵
- ❌ `localhost` → 스킵
- ❌ (빈 문자열) → 스킵

### 1. 하위 호환성

**문제:** 기존 `hyeni-updater.ts` 사용 코드
- `ProfileDetailPage.tsx`
- `HyeniUpdateNotification.tsx`

**해결:**
- `mod-updater.ts`로 통합
- UI는 새 `useRequiredMods` 훅 사용 (서버 주소 필터링 포함)

### 2. 로더 타입 매칭

**문제:** Worker는 `fabric`, `neoforge` 등 소문자
**해결:** 대소문자 통일 또는 비교 시 소문자 변환

### 3. 파일명 패턴

**유연한 패턴 (와일드카드):**
```
{modId}-*.jar
```

**예시:**
```
hyenihelper-fabric-1.21.1-1.0.0.jar  ✅
hyenihelper-1.0.0.jar                ✅
hyenicore-neoforge-2.0.1.jar         ✅
```

**로컬 버전 감지:**
- `mods/` 디렉토리에서 `{modId}-*.jar` 패턴 검색
- 파일명에서 버전 추출 (정규식 사용)

### 4. 토큰 공유

**저장 위치:** `<profilePath>/config/hyenihelper-config.json`

**토큰 정책:**
- 모드별로 따로 하지 않음
- 서버별로 다를 수 있음 (대체로 공유)
- 모든 모드가 `hyenihelper-config.json`의 토큰 사용

**구조:**
```json
{
  "token": "서버별_또는_공용_토큰",
  "enabled": true,
  ...
}
```

---

## 🎯 성공 기준

- [ ] Worker 레지스트리의 모든 모드 자동 감지
- [ ] 혜니월드 서버 프로필만 게임 실행 전 자동 업데이트
- [ ] 토큰 없으면 혜니월드 서버 게임 실행 차단
- [ ] UI에서 업데이트 진행률 표시
- [ ] 프로필 상세 페이지에서 모든 모드 상태 확인 가능

---

## 💡 향후 개선 사항

### Phase 7 (선택적):
- [ ] 선택적 모드 설치 UI (`required: false` 모드)
- [ ] 모드별 다운로드 재시도
- [ ] 모드 설정 동기화 (config 파일)
- [ ] 모드 충돌 감지
- [ ] 롤백 기능

---

## 📝 결론

**수정 가능 여부:** ✅ 가능

**난이도:** 중상 (기존 구조 이해 필요, 새 서비스 작성)

**예상 소요 시간:** 3-4일

**위험도:** 낮음 (게임 실행 플로우에 체크 로직 추가만)

**권장 사항:**
1. **지금 진행**: 필수 기능이며 구조가 명확함
2. Step 1-3 먼저 구현 (백엔드/IPC)
3. Step 4 UI는 나중에 개선 가능
