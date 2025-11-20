# 혜니팩 동적 업데이트 시스템 설계 논의

**논의 일자:** 2025년 11월 20일  
**참여자:** Yuri (사용자), Cascade (AI)

---

## 📋 논의 개요

혜니팩(HyeniPack) 배포 후, 모드팩을 재배포하지 않고 모드 추가/제거/업데이트를 동적으로 적용할 수 있는 시스템 설계

---

## 🗣️ 논의 내역

### 1차 제안 (Cascade): 모드팩 매니페스트 동기화 방식

**개념:**
- 혜니팩을 "기본팩"으로 배포
- R2에 "매니페스트"를 버전별로 관리
- 모드 구성 변경을 동적으로 적용

**R2 구조:**
```
hyenimc-releases/
├── modpacks/
│   ├── hyenipack/
│   │   ├── registry.json
│   │   └── manifests/
│   │       ├── 1.0.0.json
│   │       ├── 1.1.0.json
│   │       └── latest.json
```

**Manifest 구조:**
```json
{
  "formatVersion": 2,
  "modpackId": "hyenipack",
  "version": "1.1.0",
  "minecraft": {
    "version": "1.21.1",
    "loaderType": "neoforge",
    "loaderVersion": "21.1.77"
  },
  "mods": {
    "required": [...],
    "optional": [...]
  }
}
```

**장점:**
- ✅ 모드팩 재배포 불필요
- ✅ 차등 업데이트 (변경된 모드만)
- ✅ 버전 추적 가능
- ✅ 기존 WorkerModUpdater 시스템 재사용

---

### 사용자 피드백 1

**문제점 지적:**
1. Manifest 자동 생성 방안 필요
2. 에러 처리 통합 필요 (hyenipack-importer와 동일)
3. 서버 타입 구분 필요 (혜니월드, 혜니데이, 혜니월드1.5, 테스트 등)
4. 프로필이 어떤 manifest를 사용해야 하는지 판단 방법 필요
5. 모드 추가/제거 외에 **업데이트**도 필요

---

### 2차 제안 (Cascade): 서버 타입 기반 시스템

**개선사항:**

1. **서버 타입 정의**
```typescript
export type ServerType = 
  | 'hyeniworld'
  | 'hyeniday'
  | 'hyeniworld-1.5'
  | 'hyeniworld-test'
  | 'vanilla'
  | 'custom';
```

2. **서버 설정 매핑 (코드에 하드코딩)**
```typescript
export const SERVER_CONFIGS: ServerConfig[] = [
  {
    type: 'hyeniworld',
    addresses: ['hyeni.world', 'play.hyeni.world'],
    modpackManifestId: 'hyeniworld-main'
  }
];
```

3. **Manifest 자동 생성**
- CLI 도구
- UI Export 기능
- 현재 프로필 구성 → Manifest 변환

4. **에러 처리 통합**
- hyenipack-importer의 검증된 로직 재사용
- 재시도 + 타임아웃
- FailedMod 처리
- Partial Success 지원

---

### 사용자 피드백 2

**치명적 문제점:**
1. **서버 설정을 코드에 하드코딩하는 것은 비효율적**
   - 서버 주소 변경 시 런처 재배포 필요
   - 새 서버 추가/제거 시 코드 수정 필요

2. **Manifest 생성이 불편함**
   - CLI는 너무 복잡
   - UI 방식 필요

---

### 3차 제안 (Cascade): R2 기반 동적 서버 레지스트리

**핵심 개선:**

1. **서버 설정을 R2에서 관리**
```json
// R2: config/server-registry.json
{
  "servers": [
    {
      "serverType": "hyeniworld",
      "addresses": ["hyeni.world", "play.hyeni.world"],
      "modpackId": "hyenipack-hyeniworld"
    }
  ]
}
```

2. **혜니팩 Export 시 Manifest 자동 생성**
```
프로필 우클릭 → "혜니팩으로 내보내기"
  ↓
다이얼로그:
  - 모드팩 ID
  - 버전
  - 서버 타입 (드롭다운)
  - Changelog
  ☑ Manifest JSON 생성
  ☑ 업로드 스크립트 생성
  ↓
결과:
  - .hyenipack
  - manifest.json
  - upload-to-r2.ps1
```

3. **동기화 프로세스**
```typescript
1. Profile에서 modpackId 확인
2. 없으면 serverAddress로 R2 registry 조회
3. /api/v2/modpacks/{modpackId}/manifests/latest
4. Diff 계산 → 변경사항 적용
```

**장점:**
- ✅ 서버 주소 변경 시 R2만 수정 (런처 재배포 불필요)
- ✅ Export 시 Manifest 자동 생성
- ✅ 에러 처리 통합

---

### 사용자 피드백 3

**새로운 문제점:**
1. **기존 혜니팩으로 만든 프로필 판단 불가**
   - 이미 배포되어 사용 중인 혜니팩 프로필들
   - 런처 업데이트만으로는 기존 프로필이 어떤 모드팩인지 알 수 없음
   - 서버 주소도 유니크하지 않음

---

### 4차 제안 (Cascade): 모드 지문(Fingerprint) 자동 매칭

**해결 방안:**

1. **모드 구성으로 지문 생성**
```typescript
// 설치된 모드 ID 목록 → SHA256 해시
calculateModFingerprint(profileId) {
  const modIds = ['hyenihelper', 'sodium', 'lithium', ...].sort();
  return sha256(modIds.join(',')).substring(0, 16);
}
```

2. **R2의 모든 Manifest와 비교**
```typescript
// 유사도 계산 → 신뢰도 90% 이상이면 자동 매칭
matchModpackByFingerprint(profileId) {
  const similarity = compare(profileFingerprint, manifestFingerprint);
  if (similarity > 0.9) return modpackId;
}
```

3. **마이그레이션 UI (폴백)**
```
신뢰도 < 90% → 사용자에게 수동 선택 요청
┌─────────────────────────────────┐
│ 📁 혜니월드 생존                 │
│ 설치된 모드: 32개                │
│                                 │
│ 모드팩 선택:                     │
│ ○ 혜니월드 (추천 - 일치율 85%)   │
│ ○ 혜니데이                      │
│ ○ 자동 업데이트 사용 안 함       │
└─────────────────────────────────┘
```

---

### 사용자 피드백 4 (최종)

**더 나은 아이디어 제시:**

**핵심 통찰:**
1. **토큰 정보 활용**
   - 이미 hyenihelper 설정 파일에 토큰 저장됨
   - 런처도 config에 토큰 저장 기능 구현됨

2. **서버에 필요 정보 전송**
   - 토큰 (인증 + 사용자 식별)
   - servers.dat의 서버 주소
   - 현재 시간
   - 마인크래프트 버전
   - 로더 타입/버전 (네오포지, 패브릭 등)

3. **서버가 동적으로 응답**
   - 서버가 이 정보들로 어떤 모드팩을 사용해야 하는지 판단
   - 적절한 manifest 반환

**질문:**
- 서버에서 이걸 어떻게 관리하고 부여할지?

---

## 💡 최종 제안 (Cascade): 토큰 기반 동적 Manifest 제공

### A. 클라이언트 → 서버 요청

```typescript
// POST /api/v2/modpacks/resolve
{
  "token": "discord_token_abc123",
  "serverAddress": "hyeni.world",
  "minecraft": {
    "version": "1.21.1",
    "loaderType": "neoforge",
    "loaderVersion": "21.1.77"
  },
  "timestamp": "2025-11-20T15:00:00Z",
  "launcherVersion": "0.3.0"
}
```

### B. 서버 응답

```json
{
  "modpackId": "hyenipack-hyeniworld",
  "modpackVersion": "1.1.0",
  "manifestUrl": "/api/v2/modpacks/hyenipack-hyeniworld/manifests/1.1.0.json",
  "serverType": "hyeniworld",
  "updateRequired": true,
  "message": "새로운 모드 업데이트가 있습니다."
}
```

### C. 서버 측 관리 방안

#### 옵션 1: Discord Bot 통합 관리
```
/modpack assign @Yuri hyeniworld-test
→ Yuri의 토큰에 "hyeniworld-test" 모드팩 매핑

/modpack list
→ 현재 설정된 모드팩 목록 표시

/modpack default hyeniworld
→ 기본 모드팩 설정 (토큰 매핑 없으면 이걸 사용)
```

**데이터베이스 구조:**
```sql
CREATE TABLE user_modpacks (
  discord_user_id VARCHAR(20) PRIMARY KEY,
  modpack_id VARCHAR(50) NOT NULL,
  assigned_at TIMESTAMP DEFAULT NOW(),
  assigned_by VARCHAR(20),
  expires_at TIMESTAMP NULL
);

CREATE TABLE server_modpacks (
  server_address VARCHAR(100),
  modpack_id VARCHAR(50),
  priority INTEGER,
  minecraft_version VARCHAR(20),
  loader_type VARCHAR(20),
  active BOOLEAN DEFAULT TRUE,
  PRIMARY KEY (server_address, modpack_id)
);
```

**매칭 우선순위:**
```typescript
1. 토큰의 사용자 전용 모드팩 (user_modpacks)
2. 서버 주소별 기본 모드팩 (server_modpacks)
3. 전역 기본 모드팩 (fallback)
```

#### 옵션 2: 관리자 웹 대시보드
```
https://admin.hyeni.world/modpacks

┌─────────────────────────────────────────────┐
│ 혜니월드 모드팩 관리                          │
├─────────────────────────────────────────────┤
│                                             │
│ 📦 모드팩 목록                               │
│ ┌─────────────────────────────────────────┐ │
│ │ hyenipack-hyeniworld (v1.1.0)          │ │
│ │ ├─ 서버: hyeni.world, play.hyeni.world │ │
│ │ ├─ 모드: 32개                          │ │
│ │ ├─ 활성 사용자: 125명                   │ │
│ │ └─ [수정] [비활성화]                    │ │
│ │                                         │ │
│ │ hyenipack-test (v1.2.0-beta)           │ │
│ │ ├─ 서버: test.hyeni.world              │ │
│ │ ├─ 모드: 35개                          │ │
│ │ ├─ 활성 사용자: 3명                     │ │
│ │ └─ [수정] [활성화]                      │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ 👥 사용자별 모드팩 설정                      │
│ ┌─────────────────────────────────────────┐ │
│ │ 검색: [Yuri__________] [검색]           │ │
│ │                                         │ │
│ │ Yuri (Discord ID: 123456789)           │ │
│ │ ├─ 현재 모드팩: hyenipack-test          │ │
│ │ ├─ 마지막 접속: 2025-11-20 14:30       │ │
│ │ └─ [변경] [제거]                        │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ [새 모드팩 추가] [설정]                      │
└─────────────────────────────────────────────┘
```

#### 옵션 3: 자동 규칙 기반
```yaml
# modpack-rules.yml
rules:
  - name: "테스트 서버 사용자"
    condition:
      server_address: "test.hyeni.world"
    action:
      modpack_id: "hyenipack-test"
  
  - name: "베타 테스터"
    condition:
      discord_roles: ["베타 테스터"]
    action:
      modpack_id: "hyenipack-beta"
  
  - name: "VIP 멤버"
    condition:
      discord_roles: ["VIP"]
    action:
      modpack_id: "hyenipack-vip"
      priority: "high"
  
  - name: "기본 (혜니월드)"
    condition:
      server_address: 
        - "hyeni.world"
        - "play.hyeni.world"
    action:
      modpack_id: "hyenipack-hyeniworld"
```

### D. Cloudflare Worker 구현

```javascript
// cloudflare-worker/src/modpack-resolver.js

async function resolveModpack(request, env) {
  const body = await request.json();
  const { token, serverAddress, minecraft, timestamp } = body;
  
  // 1. 토큰 검증
  const user = await validateToken(token, env.TOKEN_CHECK_API);
  if (!user) {
    return errorResponse(401, 'Invalid token');
  }
  
  // 2. 사용자 전용 모드팩 확인
  const userModpack = await env.DB.prepare(
    'SELECT modpack_id FROM user_modpacks WHERE discord_user_id = ?'
  ).bind(user.discordId).first();
  
  if (userModpack) {
    return await getModpackInfo(userModpack.modpack_id, minecraft, env);
  }
  
  // 3. 서버 주소별 기본 모드팩
  const serverModpack = await env.DB.prepare(
    'SELECT modpack_id FROM server_modpacks WHERE server_address = ? AND active = 1 ORDER BY priority'
  ).bind(serverAddress).first();
  
  if (serverModpack) {
    return await getModpackInfo(serverModpack.modpack_id, minecraft, env);
  }
  
  // 4. 전역 기본 모드팩
  const defaultModpack = await env.KV.get('default_modpack_id');
  if (defaultModpack) {
    return await getModpackInfo(defaultModpack, minecraft, env);
  }
  
  // 5. 모드팩 없음
  return new Response(JSON.stringify({ 
    modpackId: null,
    message: 'No modpack assigned'
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

async function getModpackInfo(modpackId, minecraft, env) {
  // Manifest 가져오기
  const manifest = await env.RELEASES.get(
    `modpacks/${modpackId}/manifests/latest.json`
  );
  
  if (!manifest) {
    return errorResponse(404, 'Modpack not found');
  }
  
  const data = JSON.parse(await manifest.text());
  
  // 호환성 확인
  if (data.minecraft.version !== minecraft.version ||
      data.minecraft.loaderType !== minecraft.loaderType) {
    return errorResponse(400, 'Incompatible minecraft version or loader');
  }
  
  return new Response(JSON.stringify({
    modpackId: data.modpack.id,
    modpackVersion: data.modpack.version,
    manifestUrl: `/api/v2/modpacks/${modpackId}/manifests/latest.json`,
    serverType: data.modpack.serverType,
    updateRequired: true
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
```

### E. 런처 통합

```typescript
// src/main/services/modpack-sync-service.ts

async syncModpack(profileId: string): Promise<SyncResult> {
  const profile = await profileRpc.getProfile({ id: profileId });
  const instanceDir = getProfileInstanceDir(profileId);
  
  // 1. 토큰 가져오기
  const token = await this.getUserToken(instanceDir);
  if (!token) {
    return { success: true, upToDate: true, noToken: true };
  }
  
  // 2. 서버 주소 가져오기
  const serverAddress = await this.getServerAddress(instanceDir, profile);
  if (!serverAddress) {
    return { success: true, upToDate: true, noServer: true };
  }
  
  // 3. 서버에 모드팩 확인 요청
  const resolution = await this.resolveModpack({
    token,
    serverAddress,
    minecraft: {
      version: profile.gameVersion,
      loaderType: profile.loaderType,
      loaderVersion: profile.loaderVersion
    }
  });
  
  if (!resolution.modpackId) {
    // 모드팩 없음 (바닐라 또는 수동 관리)
    return { success: true, upToDate: true, noModpack: true };
  }
  
  // 4. 버전 비교
  if (resolution.modpackVersion === profile.modpackVersion) {
    return { success: true, upToDate: true };
  }
  
  // 5. Manifest 가져오기 및 동기화
  const manifest = await fetch(resolution.manifestUrl).then(r => r.json());
  const diff = await this.calculateDiff(instanceDir, manifest);
  await this.applyChanges(profileId, instanceDir, diff, onProgress);
  
  // 6. Profile 업데이트
  await profileRpc.updateProfile({
    id: profileId,
    patch: {
      modpackId: resolution.modpackId,
      modpackVersion: resolution.modpackVersion,
      lastModpackSync: new Date()
    }
  });
  
  return this.buildResult(manifest, diff);
}

private async resolveModpack(params: {
  token: string;
  serverAddress: string;
  minecraft: { version: string; loaderType: string; loaderVersion?: string };
}): Promise<ModpackResolution> {
  const url = `${ENV_CONFIG.HYENIMC_WORKER_URL}/api/v2/modpacks/resolve`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      ...params,
      timestamp: new Date().toISOString(),
      launcherVersion: app.getVersion()
    })
  });
  
  if (!response.ok) {
    throw new Error(`Failed to resolve modpack: ${response.status}`);
  }
  
  return await response.json();
}
```

---

## 🎯 최종 시스템 아키텍처

```
[런처]
  ├─ Token (hyenihelper config)
  ├─ Server Address (servers.dat)
  ├─ MC Version, Loader Type/Version
  └─ Launcher Version
       ↓ POST /api/v2/modpacks/resolve
[Cloudflare Worker]
  ├─ 토큰 검증
  ├─ 사용자 전용 모드팩 확인 (D1)
  ├─ 서버별 기본 모드팩 확인 (D1)
  └─ 전역 기본 모드팩 (KV)
       ↓ 응답
  { modpackId, modpackVersion, manifestUrl }
       ↓
[런처]
  ├─ Manifest 다운로드
  ├─ Diff 계산
  ├─ 모드 추가/제거/업데이트
  └─ Profile 업데이트
```

---

## ✅ 최종 방안의 장점

1. **유연한 관리**
   - 사용자별, 서버별, 역할별 모드팩 할당
   - 중앙화된 관리 (DB 또는 Discord Bot)

2. **기존 시스템 활용**
   - 이미 구현된 토큰 시스템
   - servers.dat 정보
   - 추가 클라이언트 변경 최소화

3. **동적 제어**
   - 서버 측에서 실시간 제어
   - 런처 재배포 불필요
   - A/B 테스팅 가능 (특정 사용자만 베타 모드팩)

4. **확장성**
   - 새 서버 추가 용이
   - 새 모드팩 추가 용이
   - 규칙 기반 자동화 가능

---

## 📝 다음 단계

1. **서버 측 관리 방식 결정**
   - Discord Bot vs 웹 대시보드 vs 규칙 기반
   - 데이터베이스 스키마 설계

2. **Cloudflare Worker API 구현**
   - `/api/v2/modpacks/resolve` 엔드포인트
   - D1 또는 KV 연동

3. **런처 통합**
   - ModpackSyncService 구현
   - 게임 시작 시 자동 동기화

4. **혜니팩 Export UI 개선**
   - Manifest 자동 생성
   - 업로드 스크립트 생성

5. **테스트 및 배포**
   - 소규모 베타 테스트
   - 점진적 롤아웃

---

## 💬 참고사항

- 모든 변경사항은 기존 hyenipack-importer의 에러 처리 로직 재사용
- 재시도 메커니즘, 타임아웃, Partial Success 지원
- SHA256 체크섬 검증
- 상세한 진행률 표시 및 사용자 알림
