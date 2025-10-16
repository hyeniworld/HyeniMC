# 필수 모드 자동 업데이트 시스템 - 전체 계획

## 🎯 목표

**devbug 서버 전용 모드 자동 관리 시스템**

- ✅ `*.devbug.ing`, `*.devbug.me` 서버 접속 시 모드 자동 체크 & 업데이트
- ✅ 일반 서버(`hypixel.net`, `localhost` 등)는 모드 체크 스킵
- ✅ Worker 레지스트리 기반 모드 관리
- ✅ 토큰 기반 인증

---

## 🏗️ 핵심 아키텍처

### 게임 실행 플로우

```
사용자: "플레이" 버튼 클릭

1. Minecraft 다운로드
2. 로더(Fabric/NeoForge) 설치
3. 서버 주소 확인 ← NEW!
   ├─ *.devbug.ing or *.devbug.me?
   │  ├─ YES: Worker API 호출
   │  │  ├─ 레지스트리에서 모드 목록 가져오기
   │  │  ├─ 로컬 모드 버전 체크
   │  │  ├─ 업데이트 필요한 모드 설치
   │  │  └─ 토큰 검증 (없으면 실행 차단)
   │  └─ NO: 스킵
4. 게임 실행
```

### 서버 필터링 로직

> ⚠️ **검토 필요**: 서버 감지 방법 3가지 옵션 중 선택 필요  
> 📄 상세 분석: `SERVER_DETECTION_OPTIONS.md`
> 
> - **Option A (권장)**: Profile 설정 + servers.dat 자동 감지
> - **Option B**: Profile 설정만
> - **Option C**: servers.dat만

**간단 예시 (Option B - Profile Only):**
```typescript
static isRequiredModServer(serverAddress: string): boolean {
  if (!serverAddress) return false;
  
  const normalized = serverAddress.toLowerCase().trim();
  return normalized.endsWith('.devbug.ing') || 
         normalized.endsWith('.devbug.me');
}
```

**동작 예시:**
```
play.devbug.ing      → ✅ 모드 체크
test.devbug.me       → ✅ 모드 체크
mc.hypixel.net       → ❌ 스킵
localhost:25565      → ❌ 스킵
(빈 문자열/싱글)     → ❌ 스킵
```

> 💡 **참고**: 기존 시스템에 servers.dat 파싱 기능이 이미 구현되어 있음  
> (hyenimc://auth 프로토콜에서 사용 중)

---

## 🚀 구현 계획 (5단계)

### Step 1: 핵심 서비스 구현 (1-2일) 🔥

**파일:** `/src/main/services/mod-updater.ts`

**주요 메서드:**
```typescript
class ModUpdater {
  // 서버 필터링
  static isRequiredModServer(serverAddress: string): boolean
  
  // API 통신
  async fetchModRegistry(): Promise<ModRegistry>
  async fetchModInfo(modId, gameVersion, loaderType): Promise<ModDetailInfo>
  
  // 모드 체크
  async getApplicableMods(gameVersion, loaderType): Promise<ModInfo[]>
  async checkAllMods(profilePath, gameVersion, loaderType): Promise<ModUpdateInfo[]>
  
  // 설치
  async installMod(profilePath, updateInfo, token, onProgress?): Promise<void>
  
  // 유틸리티
  private async getLocalModVersion(profilePath, modId): Promise<string | null>
  private async getUserToken(profilePath): Promise<string | null>
}
```

**로컬 버전 감지 (유연한 패턴):**
```
hyenihelper-fabric-1.21.1-1.0.0.jar  ✅
hyenihelper-1.0.0.jar                ✅
hyenicore-neoforge-2.0.1.jar         ✅

패턴: {modId}-*.jar
```

---

### Step 2: IPC 핸들러 추가 (반나절)

**파일:** `/src/main/ipc/mod.ts` (신규)

**IPC 채널:**
- `mod:check-updates` - 업데이트 체크
- `mod:get-registry` - 레지스트리 조회
- `mod:install` - 모드 설치
- `mod:update-progress` - 진행률 (이벤트)
- `mod:update-complete` - 완료 (이벤트)

---

### Step 3: 게임 실행 플로우 통합 (반나절) 🔥

**파일:** `/src/main/ipc/profile.ts`

**위치:** `PROFILE_LAUNCH` 핸들러 (라인 305 근처)

```typescript
// 다운로드 검증 후
const { ModUpdater } = await import('../services/mod-updater');

if (ModUpdater.isRequiredModServer(profile.serverAddress || '')) {
  const modUpdater = new ModUpdater();
  const updates = await modUpdater.checkAllMods(
    instanceDir,
    profile.gameVersion,
    profile.loaderType
  );

  if (updates.length > 0) {
    const token = await modUpdater['getUserToken'](instanceDir);
    if (!token) {
      throw new Error('인증 필요');
    }
    
    for (const update of updates) {
      await modUpdater.installMod(instanceDir, update, token, (progress) => {
        window?.webContents.send('mod:update-progress', { ...progress });
      });
    }
  }
} else {
  console.log('[IPC Profile] General server - skipping mod check');
}
```

---

### Step 4: UI 구현 (1일)

**파일:** `/src/renderer/hooks/useModUpdates.ts` (신규)

- 모드 업데이트 체크
- 진행률 표시
- 프로필 상세 페이지에 모드 상태 섹션 추가

---

### Step 5: 테스트 (1일)

**테스트 시나리오:**

1. **devbug 서버 프로필**
   - 서버: `play.devbug.ing`
   - 토큰 없음 → 에러
   - 토큰 있음 → 모드 자동 설치

2. **일반 서버 프로필**
   - 서버: `mc.hypixel.net`
   - 모드 체크 스킵 확인

3. **싱글플레이**
   - 서버 주소 없음
   - 모드 체크 스킵

4. **파일명 패턴**
   - 다양한 파일명 버전 감지 테스트

---

## 📊 타입 정의

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
  required?: boolean;  // 추후 정책 결정
  category: string;
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
}
```

---

## 🎯 성공 기준

- [ ] devbug 서버 프로필만 모드 체크
- [ ] Worker 레지스트리의 모든 모드 자동 감지
- [ ] 게임 실행 전 자동 업데이트
- [ ] 토큰 없으면 devbug 서버 실행 차단
- [ ] 일반 서버는 모드 체크 스킵
- [ ] UI에서 업데이트 진행률 표시
- [ ] 프로필 상세 페이지에서 모드 상태 확인 가능

---

## 📅 예상 일정

| 단계 | 소요 시간 | 난이도 | 우선순위 |
|------|----------|--------|----------|
| **Step 1** | 1-2일 | 중상 | 🔥 최우선 |
| **Step 2** | 반나절 | 중하 | 높음 |
| **Step 3** | 반나절 | 중하 | 🔥 최우선 |
| **Step 4** | 1일 | 중간 | 중간 |
| **Step 5** | 1일 | 중간 | 높음 |
| **합계** | **3-4일** | **중상** | - |

**핵심:** Step 1 + Step 3 = 게임 실행 시 자동 업데이트 완료

---

## 🔧 현재 상태

### ✅ 완료
- [x] Worker API 구조 파악
- [x] `update-registry.sh` 수정 (loaders, required, category 추가)
- [x] `update-registry.ps1` 수정 (loaders, required, category 추가)
- [x] 구현 계획 수립
- [x] 아키텍처 설계

### ⏳ 대기 중
- [ ] 서버 감지 방법 결정 (`SERVER_DETECTION_OPTIONS.md` 검토)
- [ ] `registry.json` 재생성 (선택, 5분)
- [ ] Step 1-5 구현

---

## 🚀 시작하기

### 1. Step 1 시작
```bash
touch src/main/services/mod-updater.ts
```

**참고:** `IMPLEMENTATION_PLAN.md` 에 상세한 구현 가이드 있음

---

## 💡 핵심 포인트

1. **서버 필터링이 핵심**: `*.devbug.ing`, `*.devbug.me` 만 체크
2. **유연한 파일명**: `{modId}-*.jar` 패턴으로 모든 파일명 지원
3. **토큰 공유**: `hyenihelper-config.json` 모든 모드 공유
4. **단계적 구현**: Step 1 + Step 3만 완료해도 핵심 기능 동작

---

**준비 완료! 바로 구현 시작할 수 있습니다.** 🚀