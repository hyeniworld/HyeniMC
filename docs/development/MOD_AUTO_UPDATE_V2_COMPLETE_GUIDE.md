# 모드 자동 업데이트 시스템 v2.0 - 완전 가이드

**날짜**: 2025-10-17  
**상태**: ✅ 구현 완료

---

## 📋 목차

1. [개요](#개요)
2. [시스템 아키텍처](#시스템-아키텍처)
3. [데이터 구조](#데이터-구조)
4. [Worker API 사용](#worker-api-사용)
5. [모드 배포 방법](#모드-배포-방법)
6. [런처 동작 방식](#런처-동작-방식)
7. [테스트 가이드](#테스트-가이드)
8. [마이그레이션 가이드](#마이그레이션-가이드)

---

## 개요

### v2.0의 주요 개선 사항

1. **게임 버전별 파일 지원**
   - 하나의 모드가 여러 게임 버전 지원 (1.21.1, 1.21.4, 1.21.8 등)
   - 각 게임 버전마다 다른 파일 제공

2. **로더 버전 호환성 체크**
   - 최소/최대/권장 로더 버전 지정
   - 자동 호환성 검증
   - 명확한 에러 메시지

3. **파일별 의존성 관리**
   - 게임 버전과 로더에 따라 다른 의존성
   - 필수/선택적 의존성 구분

4. **카테고리 시스템**
   - `required`: 서버 접속 필수
   - `optional`: 선택 사항
   - `server-side`: 서버 전용 (클라 불필요)

5. **API 버전 관리**
   - `/api/v2/mods` - 새 v2 API
   - `/api/mods` - v1 API 유지 (하위 호환)

---

## 시스템 아키텍처

```
┌─────────────┐
│   런처      │
│  (Electron) │
└──────┬──────┘
       │ 1. GET /api/v2/mods (레지스트리)
       │ 2. 로더 버전 호환성 필터링
       ├──────────────────────────────────┐
       │                                  │
       v                                  v
┌──────────────────┐            ┌──────────────────┐
│ Cloudflare Worker │            │   R2 Storage    │
│                   │            │                  │
│ • API Routing     │───────────▶│ • registry.json │
│ • v1/v2 지원      │            │ • manifest.json │
│ • 인증 검증       │            │ • JAR files     │
└──────────────────┘            └──────────────────┘
       │
       │ 3. GET /api/v2/mods/{id}/latest
       │ 4. GET /download/v2/mods/.../file.jar
       │
       v
┌─────────────┐
│  Discord    │
│ Auth Server │
│ (토큰 검증)  │
└─────────────┘
```

---

## 데이터 구조

### 1. registry.json (모드 목록)

**경로**: `mods/registry.json`

```json
{
  "version": "2.0",
  "lastUpdated": "2025-10-17T08:00:00Z",
  "mods": [
    {
      "id": "hyenihelper",
      "name": "HyeniHelper",
      "description": "HyeniMC core functionality mod",
      "latestVersion": "1.0.1",
      "category": "required",
      
      "gameVersions": ["1.21.1", "1.21.4", "1.21.8", "1.21.10"],
      
      "loaders": [
        {
          "type": "neoforge",
          "minVersion": "21.1.0",
          "maxVersion": null,
          "recommended": "21.1.42",
          "supportedGameVersions": ["1.21.1", "1.21.4", "1.21.8", "1.21.10"]
        },
        {
          "type": "fabric",
          "minVersion": "0.15.0",
          "maxVersion": null,
          "recommended": "0.16.2",
          "supportedGameVersions": ["1.21.1", "1.21.4"]
        }
      ],
      
      "dependencies": {
        "required": [],
        "optional": []
      }
    }
  ]
}
```

### 2. manifest.json (모드 상세 정보)

**경로**: `mods/{modId}/versions/{version}/manifest.json`

```json
{
  "modId": "hyenihelper",
  "name": "HyeniHelper",
  "version": "1.0.1",
  "releaseDate": "2025-10-17T08:00:00Z",
  "changelog": "Bug fixes and performance improvements",
  
  "gameVersions": ["1.21.1", "1.21.4", "1.21.8", "1.21.10"],
  
  "loaders": {
    "neoforge": {
      "gameVersions": {
        "1.21.1": {
          "file": "hyenihelper-1.0.1-neoforge-1.21.1.jar",
          "sha256": "abc123...",
          "size": 524288,
          "minLoaderVersion": "21.1.0",
          "maxLoaderVersion": null,
          "downloadPath": "mods/hyenihelper/versions/1.0.1/neoforge/1.21.1/hyenihelper-1.0.1-neoforge-1.21.1.jar",
          "dependencies": {
            "required": ["geckolib"],
            "optional": ["jei"]
          }
        },
        "1.21.4": {
          "file": "hyenihelper-1.0.1-neoforge-1.21.4.jar",
          "sha256": "def456...",
          "size": 528000,
          "minLoaderVersion": "21.4.0",
          "maxLoaderVersion": null,
          "downloadPath": "mods/hyenihelper/versions/1.0.1/neoforge/1.21.4/hyenihelper-1.0.1-neoforge-1.21.4.jar",
          "dependencies": {
            "required": ["geckolib"],
            "optional": ["jei"]
          }
        }
      }
    },
    "fabric": {
      "gameVersions": {
        "1.21.1": {
          "file": "hyenihelper-1.0.1-fabric-1.21.1.jar",
          "sha256": "ghi789...",
          "size": 520000,
          "minLoaderVersion": "0.15.0",
          "maxLoaderVersion": null,
          "downloadPath": "mods/hyenihelper/versions/1.0.1/fabric/1.21.1/hyenihelper-1.0.1-fabric-1.21.1.jar",
          "dependencies": {
            "required": ["fabric-api"],
            "optional": []
          }
        }
      }
    }
  }
}
```

### 3. R2 파일 구조

```
hyenimc-releases/
  mods/
    registry.json
    
    hyenihelper/
      latest.json  ← manifest.json의 복사본
      
      versions/
        1.0.1/
          manifest.json
          
          neoforge/
            1.21.1/
              hyenihelper-1.0.1-neoforge-1.21.1.jar
            1.21.4/
              hyenihelper-1.0.1-neoforge-1.21.4.jar
            1.21.8/
              hyenihelper-1.0.1-neoforge-1.21.8.jar
            1.21.10/
              hyenihelper-1.0.1-neoforge-1.21.10.jar
          
          fabric/
            1.21.1/
              hyenihelper-1.0.1-fabric-1.21.1.jar
            1.21.4/
              hyenihelper-1.0.1-fabric-1.21.4.jar
```

---

## Worker API 사용

### 엔드포인트

#### 1. GET `/api/v2/mods` - 모드 목록
```bash
curl https://HYENIMC_WORKER_URL/api/v2/mods | jq .
```

#### 2. GET `/api/v2/mods/{modId}/latest` - 최신 버전
```bash
curl https://HYENIMC_WORKER_URL/api/v2/mods/hyenihelper/latest | jq .
```

#### 3. GET `/download/v2/mods/{modId}/versions/{version}/{loader}/{gameVersion}/{file}` - 다운로드
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://HYENIMC_WORKER_URL/download/v2/mods/hyenihelper/versions/1.0.1/neoforge/1.21.1/hyenihelper-1.0.1-neoforge-1.21.1.jar \
  -o hyenihelper.jar
```

### 하위 호환성 (v1 API)

기존 v1 API도 계속 작동합니다:
```bash
curl https://HYENIMC_WORKER_URL/api/mods
curl https://HYENIMC_WORKER_URL/api/mods/hyenihelper/latest
```

---

## 모드 배포 방법

### 1. 설정 파일 작성

`deploy-config.json`:
```json
{
  "modId": "hyenihelper",
  "name": "HyeniHelper",
  "version": "1.0.1",
  "category": "required",
  "changelog": "Bug fixes",
  
  "files": [
    {
      "loader": "neoforge",
      "gameVersion": "1.21.1",
      "file": "./build/hyenihelper-neoforge-1.21.1.jar",
      "minLoaderVersion": "21.1.0",
      "maxLoaderVersion": null,
      "dependencies": {
        "required": ["geckolib"],
        "optional": ["jei"]
      }
    },
    {
      "loader": "neoforge",
      "gameVersion": "1.21.4",
      "file": "./build/hyenihelper-neoforge-1.21.4.jar",
      "minLoaderVersion": "21.4.0",
      "maxLoaderVersion": null,
      "dependencies": {
        "required": ["geckolib"],
        "optional": ["jei"]
      }
    },
    {
      "loader": "fabric",
      "gameVersion": "1.21.1",
      "file": "./build/hyenihelper-fabric-1.21.1.jar",
      "minLoaderVersion": "0.15.0",
      "maxLoaderVersion": null,
      "dependencies": {
        "required": ["fabric-api"],
        "optional": []
      }
    }
  ]
}
```

### 2. 모드 배포

```bash
cd cloudflare-worker
./deploy-mod-v2.sh --config deploy-config.json
```

**출력 예시**:
```
🚀 HyeniMC 모드 배포 v2.0
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📦 모드: HyeniHelper (hyenihelper)
🔢 버전: 1.0.1
🏷️  카테고리: required

📁 처리할 파일: 3 개

[1/3] neoforge / MC 1.21.1
   파일: hyenihelper-neoforge-1.21.1.jar
   SHA256: abc123...
   크기: 512 KB
   📤 업로드: hyenimc-releases/mods/hyenihelper/versions/1.0.1/neoforge/1.21.1/hyenihelper-neoforge-1.21.1.jar
   ✅ 완료

...

📝 manifest.json 생성 중...
   ✅ 생성 완료
📤 manifest 업로드 중...
   ✅ 업로드 완료
🔄 latest.json 업데이트 중...
   ✅ 업데이트 완료

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎉 배포 완료!

📊 배포 정보:
   • 모드: HyeniHelper (hyenihelper)
   • 버전: 1.0.1
   • 카테고리: required
   • 파일 수: 3

🔗 API 엔드포인트 (v2):
   https://HYENIMC_WORKER_URL/api/v2/mods/hyenihelper/latest

💡 다음 단계: registry 업데이트
   ./update-registry-v2.sh hyenihelper
```

### 3. Registry 업데이트

```bash
./update-registry-v2.sh hyenihelper
```

**출력 예시**:
```
📝 모드 레지스트리 업데이트 v2.0
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ 발견된 모드: 1 개

📦 hyenihelper 정보 수집 중...
   ✅ 수집 완료: v1.0.1

📝 registry.json 생성 중...
   ✅ 생성 완료
📤 R2에 업로드 중...
   ✅ 업로드 완료

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ 레지스트리 업데이트 완료!

📊 업데이트된 모드: 1 개

🔗 확인 (v2):
   https://HYENIMC_WORKER_URL/api/v2/mods
```

---

## 런처 동작 방식

### 1. 프로필 실행 시

```typescript
// src/main/ipc/profile.ts

// 1. 로더 설치
let installedLoaderVersion: string | undefined = undefined;

if (profile.loaderType !== 'vanilla') {
  // ... 로더 설치
  installedLoaderVersion = loaderVersion;
}

// 2. 모드 체크 (로더 버전 전달)
const workerModUpdater = new WorkerModUpdater();
const updates = await workerModUpdater.checkAllMods(
  instanceDir,
  profile.gameVersion,
  profile.loaderType || 'vanilla',
  installedLoaderVersion  // ← 로더 버전 전달
);
```

### 2. 모드 필터링

```typescript
// src/main/services/worker-mod-updater.ts

async getApplicableMods(
  gameVersion: string,
  loaderType: string,
  loaderVersion?: string
): Promise<ModInfo[]> {
  // 1. 레지스트리 가져오기
  const registry = await this.fetchModRegistry();
  
  // 2. 필터링
  return registry.mods.filter(mod => {
    // 게임 버전 체크
    if (!mod.gameVersions.includes(gameVersion)) {
      return false;
    }
    
    // 로더 타입 체크
    const loaderCompat = mod.loaders.find(l => l.type === loaderType);
    if (!loaderCompat) {
      return false;
    }
    
    // 로더 버전 호환성 체크 (v2.0 NEW!)
    if (loaderVersion && !this.checkLoaderVersionCompatibility(
      loaderVersion,
      loaderCompat.minVersion,
      loaderCompat.maxVersion
    )) {
      console.warn(`Mod ${mod.id} requires loader ${loaderType} ${loaderCompat.minVersion}+`);
      return false;
    }
    
    return true;
  });
}
```

### 3. 파일 선택

```typescript
async fetchModInfo(
  modId: string,
  gameVersion: string,
  loaderType: string
): Promise<ModDetailInfo | null> {
  // API에서 전체 manifest 가져오기
  const rawData = await fetch(getModDetailUrl(modId));
  
  // 게임 버전과 로더에 맞는 파일만 선택
  const loaderData = rawData.loaders?.[loaderType];
  const gameVersionData = loaderData?.gameVersions?.[gameVersion];
  
  if (!gameVersionData) {
    console.log(`No file for ${gameVersion} + ${loaderType}`);
    return null;
  }
  
  return {
    modId: rawData.modId,
    version: rawData.version,
    loaders: {
      [loaderType]: gameVersionData  // ← 해당 파일만
    }
  };
}
```

### 4. 다운로드

```typescript
const downloadUrl = getModDownloadUrl(
  modId,
  loaderType,
  version,
  gameVersion,  // ← 추가
  fileName
);

// 결과: /download/v2/mods/hyenihelper/versions/1.0.1/neoforge/1.21.1/hyenihelper-1.0.1-neoforge-1.21.1.jar
```

---

## 테스트 가이드

### 1. Worker API 테스트

```bash
# 레지스트리
curl -s https://HYENIMC_WORKER_URL/api/v2/mods | jq '.mods[].id'

# 모드 상세 정보
curl -s https://HYENIMC_WORKER_URL/api/v2/mods/hyenihelper/latest | jq .

# 게임 버전 확인
curl -s https://HYENIMC_WORKER_URL/api/v2/mods/hyenihelper/latest | jq '.gameVersions'

# 로더별 파일 확인
curl -s https://HYENIMC_WORKER_URL/api/v2/mods/hyenihelper/latest | jq '.loaders.neoforge.gameVersions | keys'
```

### 2. 런처 테스트

```bash
# 빌드
npm run build

# 실행
npm run dev
```

**테스트 시나리오**:

1. **기본 케이스**: MC 1.21.1 + NeoForge 21.1.42
   - ✅ hyenihelper 설치 성공

2. **새 게임 버전**: MC 1.21.11 + NeoForge 21.11.0 (neoforge만 지원)
   - ✅ neoforge 파일 설치 성공
   - ⏭️  fabric 파일 스킵

3. **로더 버전 부족**: MC 1.21.1 + NeoForge 21.0.5
   - ⚠️  경고: "Mod hyenihelper requires NeoForge 21.1.0+"
   - ⏭️  설치 스킵

4. **로더 버전 초과**: MC 1.21.1 + NeoForge 22.0.0 (maxVersion: 21.9.99)
   - ⚠️  경고: "Mod hyenihelper requires NeoForge <= 21.9.99"
   - ⏭️  설치 스킵

---

## 마이그레이션 가이드

### v1 → v2 데이터 변환

#### Before (v1)
```json
{
  "loaders": {
    "neoforge": "hyenihelper-neoforge.jar"
  }
}
```

#### After (v2)
```json
{
  "loaders": {
    "neoforge": {
      "gameVersions": {
        "1.21.1": {
          "file": "hyenihelper-1.0.1-neoforge-1.21.1.jar",
          "sha256": "...",
          "size": 524288,
          "minLoaderVersion": "21.1.0",
          "maxLoaderVersion": null,
          "downloadPath": "...",
          "dependencies": {...}
        }
      }
    }
  }
}
```

### 변환 스크립트 (예시)

```bash
#!/bin/bash
# convert-v1-to-v2.sh

MOD_ID="$1"
GAME_VERSION="$2"

# v1 데이터 가져오기
V1_DATA=$(curl -s https://HYENIMC_WORKER_URL/api/mods/$MOD_ID/latest)

# v2 형식으로 변환
# (실제로는 JAR 파일을 다시 배포하는게 더 안전)

echo "v1 데이터를 v2로 직접 변환하는 것은 권장하지 않습니다."
echo "deploy-mod-v2.sh를 사용하여 다시 배포하세요."
```

**권장 방법**: v1 모드를 v2 형식으로 재배포

---

## ✅ 체크리스트

### Worker 배포
- [x] `src/index.js` - API v2 라우팅
- [x] `deploy-mod-v2.sh` - 배포 스크립트
- [x] `update-registry-v2.sh` - 레지스트리 스크립트
- [x] `deploy-config.example.json` - 설정 예시
- [ ] Worker 재배포: `wrangler deploy`

### 런처 업데이트
- [x] `worker-mod-updater.ts` - v2 API 지원
- [x] URL 함수 업데이트 (`/api/v2/mods`)
- [x] `fetchModInfo()` - 게임 버전별 파일 선택
- [x] `getApplicableMods()` - 로더 버전 체크
- [x] 빌드 성공
- [ ] 실제 환경 테스트

### 데이터 준비
- [ ] 모드 빌드 (게임 버전별)
- [ ] `deploy-config.json` 작성
- [ ] `./deploy-mod-v2.sh --config deploy-config.json`
- [ ] `./update-registry-v2.sh hyenihelper`
- [ ] API 엔드포인트 확인

---

## 🎯 다음 단계

1. **Worker 재배포** (5분)
   ```bash
   cd cloudflare-worker
   wrangler deploy
   ```

2. **모드 빌드** (개발팀)
   - MC 1.21.1, 1.21.4, 1.21.8, 1.21.10 버전
   - NeoForge, Fabric 모두

3. **첫 모드 배포** (10분)
   ```bash
   # 설정 파일 준비
   cp deploy-config.example.json deploy-config.json
   # 파일 경로 수정
   vim deploy-config.json
   
   # 배포
   ./deploy-mod-v2.sh --config deploy-config.json
   ./update-registry-v2.sh hyenihelper
   ```

4. **런처 배포** (개발팀)
   ```bash
   npm run build
   npm run dist
   ```

5. **통합 테스트** (30분)
   - 다양한 게임 버전
   - 다양한 로더 버전
   - 호환성 체크 검증

---

## 📊 예상 효과

| 항목 | Before (v1) | After (v2) |
|------|-------------|------------|
| 게임 버전별 파일 | ❌ 없음 | ✅ 지원 |
| 로더 버전 체크 | ❌ 없음 | ✅ 자동 |
| 불필요한 다운로드 | 많음 | 없음 |
| 에러 메시지 | 모호함 | 명확함 |
| 의존성 관리 | 제한적 | 유연함 |
| API 버전 관리 | ❌ 없음 | ✅ v1/v2 |

---

**구현 완료!** 🎉
