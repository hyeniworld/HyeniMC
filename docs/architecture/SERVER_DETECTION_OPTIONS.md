# 서버 감지 전략 옵션 분석

## 📋 개요

필수 모드 자동 업데이트 시스템에서 **"혜니월드 서버인지 판단하는 방법"**에 대한 3가지 옵션 비교 분석

---

## 🏗️ 현재 시스템 분석

### ✅ 이미 구현된 기능

1. **Profile 타입의 serverAddress 필드**
   - 위치: `src/shared/types/profile.ts:51`
   - 타입: `serverAddress?: string`
   - 상태: ✅ 이미 존재

2. **UI 서버 주소 입력**
   - 위치: `src/renderer/components/profiles/ProfileSettingsTab.tsx:709-733`
   - 섹션: "혜니월드 서버 설정"
   - 기능: 사용자가 서버 주소 입력 가능
   - 상태: ✅ 이미 구현됨

3. **servers.dat 파싱 로직**
   - 위치: `src/main/protocol/handler.ts:311-337`
   - 함수: `checkServersDat(gameDirectory, serverAddress): Promise<boolean>`
   - 기능: NBT 파싱으로 멀티플레이 서버 목록 읽기
   - 상태: ✅ 이미 구현됨

4. **hyenimc://auth 프로토콜**
   - 위치: `src/main/protocol/handler.ts:45-105`
   - 기능: Discord 인증 링크 처리
   - 사용: 서버 주소로 프로필 필터링 후 토큰 저장
   - 상태: ✅ 이미 구현됨

---

## 🎯 Option A: Hybrid (3단계 Fallback) 🌟 **[권장]**

### 개념

**우선순위 기반 다단계 감지**

```
1순위: Profile.serverAddress (명시적 설정)
2순위: servers.dat 파싱 (자동 감지)
3순위: 없음 (스킵)
```

### 동작 흐름

```typescript
async isRequiredModServer(
  profileServerAddress: string | undefined,
  gameDirectory: string
): Promise<boolean> {
  // Step 1: Profile 설정 체크 (최우선)
  if (profileServerAddress?.trim()) {
    const normalized = profileServerAddress.toLowerCase().trim();
    const isHyeniWorld = normalized.endsWith('.hyeniworld.com');
    
    if (isHyeniWorld) {
      console.log('✅ HyeniWorld server from profile');
      return true;
    }
    
    // 명시적으로 다른 주소 설정 → servers.dat 체크 스킵
    console.log('⏭️ Non-HyeniWorld server specified, skip servers.dat');
    return false;
  }
  
  // Step 2: servers.dat 자동 감지
  console.log('🔍 Checking servers.dat...');
  return await checkServersDatForHyeniWorld(gameDirectory);
}

private async checkServersDatForHyeniWorld(gameDirectory: string): Promise<boolean> {
  const serversDatPath = path.join(gameDirectory, 'servers.dat');
  
  try {
    const data = await fs.readFile(serversDatPath);
    const parsed = await nbt.parse(data);
    const servers = parsed?.parsed?.value?.servers?.value?.value || [];
    
    return servers.some((server: any) => {
      const ip = (server?.ip?.value || '').toLowerCase();
      return ip.endsWith('.hyeniworld.com');
    });
  } catch {
    return false;
  }
}
```

### 사용자 시나리오

#### 시나리오 1: 완전 자동 (가장 일반적)
```
1. 사용자가 Minecraft 멀티플레이에서 play.example.com 추가
2. 프로필 생성 (서버 주소 입력 안 함)
3. 게임 실행 → servers.dat 자동 감지 → 모드 자동 체크 ✅
```

#### 시나리오 2: 명시적 설정 (고급 사용자)
```
1. 프로필 설정에서 "서버 주소: play.example.com" 입력
2. 게임 실행 → Profile 설정 우선 적용 → 모드 자동 체크 ✅
3. servers.dat는 무시됨
```

#### 시나리오 3: 오버라이드 (다른 서버로 변경)
```
1. servers.dat에 play.example.com 있음
2. 프로필 설정에서 "서버 주소: mc.hypixel.net" 입력
3. 게임 실행 → Profile 설정 우선 → 모드 체크 스킵 ❌
```

#### 시나리오 4: 일반 서버
```
1. servers.dat에 mc.hypixel.net만 있음
2. 프로필 설정 비어있음
3. 게임 실행 → servers.dat 체크 → 혜니월드 서버 없음 → 스킵 ❌
```

#### 시나리오 5: 싱글플레이
```
1. servers.dat 없음 (또는 비어있음)
2. 프로필 설정 비어있음
3. 게임 실행 → 스킵 ❌
```

### 장점

1. **최고의 사용자 경험**
   - 아무것도 설정 안 해도 자동 작동
   - 고급 사용자는 명시적 제어 가능
   - 두 가지 장점 모두 활용

2. **Graceful Degradation**
   - 단계별 fallback으로 안정적
   - 어떤 상황에서도 적절히 대응

3. **기존 시스템 완전 호환**
   - `hyenimc://auth` 프로토콜 그대로 작동
   - `checkServersDat` 로직 재사용
   - UI 변경 최소화

4. **유연성**
   - 혜니월드 서버 여러 개 → 자동 감지
   - 특정 서버 강제 지정 → Profile 설정
   - 일반 서버로 오버라이드 가능

5. **디버깅 용이**
   - 로그로 어느 단계에서 감지했는지 명확

### 단점

1. **복잡성 증가**
   - 두 가지 로직 유지 필요
   - 테스트 케이스 많아짐

2. **혼동 가능성**
   - 사용자가 왜 모드가 체크되는지/안 되는지 헷갈릴 수 있음
   - 해결: UI에 명확한 설명 추가

### 구현 복잡도

- **코드 양**: 중간 (~100 lines)
- **의존성**: `prismarine-nbt` (이미 사용 중)
- **테스트**: 5개 시나리오
- **소요 시간**: +1-2시간

### 코드 위치

```
src/main/services/mod-updater.ts
├─ isRequiredModServer(profileServerAddress, gameDirectory)
└─ checkServersDatForHyeniWorld(gameDirectory)

src/main/ipc/profile.ts (PROFILE_LAUNCH)
└─ await ModUpdater.isRequiredModServer(profile.serverAddress, instanceDir)
```

---

## 🎯 Option B: Profile Only (UI 우선)

### 개념

**Profile 설정만 사용, servers.dat 무시**

```
Profile.serverAddress 있음 → 체크
Profile.serverAddress 없음 → 스킵
```

### 동작 흐름

```typescript
static isRequiredModServer(serverAddress: string | undefined): boolean {
  if (!serverAddress?.trim()) return false;
  
  const normalized = serverAddress.toLowerCase().trim();
  return normalized.endsWith('.hyeniworld.com');
}
```

### 사용자 시나리오

#### 시나리오 1: 설정 필수
```
1. 프로필 설정에서 "서버 주소: play.example.com" 입력 필수
2. 게임 실행 → 모드 자동 체크 ✅
```

#### 시나리오 2: 설정 안 함
```
1. 프로필 설정 비어있음
2. 게임 실행 → 모드 체크 스킵 ❌
3. servers.dat에 혜니월드 서버 있어도 무시됨
```

### 장점

1. **단순함**
   - 로직이 매우 간단
   - 이해하기 쉬움

2. **명확한 제어**
   - 사용자가 100% 제어
   - "설정했으면 체크, 안 했으면 스킵"

3. **예측 가능**
   - 동작이 직관적
   - 디버깅 쉬움

4. **구현 빠름**
   - 10분이면 완성
   - 테스트 2개면 충분

### 단점

1. **수동 설정 필요**
   - 모든 사용자가 서버 주소 입력해야 함
   - UX 떨어짐

2. **기존 시스템 미활용**
   - servers.dat 파싱 기능 낭비
   - `hyenimc://auth`와 일관성 부족

3. **자동화 불가**
   - 완전 수동

4. **실수 가능성**
   - 사용자가 주소 입력 안 하면 모드 안 됨
   - 오타 위험

### 구현 복잡도

- **코드 양**: 매우 적음 (~20 lines)
- **의존성**: 없음
- **테스트**: 2개 시나리오
- **소요 시간**: +10분

### 코드 위치

```
src/main/services/mod-updater.ts
└─ isRequiredModServer(serverAddress)

src/main/ipc/profile.ts (PROFILE_LAUNCH)
└─ ModUpdater.isRequiredModServer(profile.serverAddress)
```

---

## 🎯 Option C: servers.dat Only (완전 자동)

### 개념

**servers.dat만 사용, Profile 설정 무시**

```
servers.dat에 혜니월드 서버 있음 → 체크
servers.dat에 혜니월드 서버 없음 → 스킵
```

### 동작 흐름

```typescript
static async isRequiredModServer(gameDirectory: string): Promise<boolean> {
  const serversDatPath = path.join(gameDirectory, 'servers.dat');
  
  try {
    const data = await fs.readFile(serversDatPath);
    const parsed = await nbt.parse(data);
    const servers = parsed?.parsed?.value?.servers?.value?.value || [];
    
    return servers.some((server: any) => {
      const ip = (server?.ip?.value || '').toLowerCase();
      return ip.endsWith('.hyeniworld.com');
    });
  } catch {
    return false;
  }
}
```

### 사용자 시나리오

#### 시나리오 1: 완전 자동
```
1. 멀티플레이에서 play.example.com 추가
2. 게임 실행 → 자동 감지 → 모드 체크 ✅
```

#### 시나리오 2: 일반 서버
```
1. 멀티플레이에서 mc.hypixel.net만 추가
2. 게임 실행 → 혜니월드 서버 없음 → 스킵 ❌
```

#### 시나리오 3: 오버라이드 불가
```
1. servers.dat에 play.example.com 있음
2. 프로필 설정에서 "mc.hypixel.net" 입력
3. 게임 실행 → Profile 설정 무시 → 모드 강제 체크 ✅
4. ⚠️ 사용자 의도와 다를 수 있음
```

### 장점

1. **완전 자동화**
   - 사용자 설정 불필요
   - 서버 추가만 하면 끝

2. **기존 시스템 활용**
   - `hyenimc://auth`와 일관성
   - servers.dat 파싱 재사용

3. **실수 방지**
   - 사용자가 뭘 해도 자동 작동

### 단점

1. **제어 불가**
   - 사용자가 명시적으로 비활성화할 방법 없음
   - Profile 설정 UI 무용지물

2. **유연성 부족**
   - 강제로 체크됨
   - 테스트/디버깅 불편

3. **혼란 가능성**
   - "왜 모드가 체크되는지 모르겠어요"
   - UI에 설정 있는데 작동 안 함

4. **엣지 케이스**
   - servers.dat에 여러 서버 → 혜니월드 하나라도 있으면 체크
   - 의도와 다를 수 있음

### 구현 복잡도

- **코드 양**: 적음 (~50 lines)
- **의존성**: `prismarine-nbt` (이미 사용 중)
- **테스트**: 3개 시나리오
- **소요 시간**: +30분

### 코드 위치

```
src/main/services/mod-updater.ts
└─ isRequiredModServer(gameDirectory)

src/main/ipc/profile.ts (PROFILE_LAUNCH)
└─ await ModUpdater.isRequiredModServer(instanceDir)
```

---

## 📊 종합 비교표

| 항목 | Option A (Hybrid) | Option B (Profile Only) | Option C (servers.dat Only) |
|------|-------------------|-------------------------|------------------------------|
| **자동화** | ⭐⭐⭐ 우수 | ❌ 수동 필수 | ⭐⭐⭐ 완전 자동 |
| **사용자 제어** | ⭐⭐⭐ 우수 | ⭐⭐⭐ 완전 제어 | ❌ 불가능 |
| **UX** | ⭐⭐⭐ 최고 | ⭐ 번거로움 | ⭐⭐ 좋음 |
| **구현 복잡도** | ⭐⭐ 중간 | ⭐⭐⭐ 매우 쉬움 | ⭐⭐⭐ 쉬움 |
| **기존 시스템 호환** | ⭐⭐⭐ 완벽 | ⭐ 일부만 | ⭐⭐⭐ 완벽 |
| **유연성** | ⭐⭐⭐ 매우 높음 | ⭐⭐ 보통 | ❌ 낮음 |
| **디버깅** | ⭐⭐ 보통 | ⭐⭐⭐ 쉬움 | ⭐⭐ 보통 |
| **테스트 양** | ⭐ 많음 (5개) | ⭐⭐⭐ 적음 (2개) | ⭐⭐ 보통 (3개) |
| **예측 가능성** | ⭐⭐ 보통 | ⭐⭐⭐ 매우 명확 | ⭐⭐ 보통 |
| **실수 방지** | ⭐⭐⭐ 우수 | ❌ 낮음 | ⭐⭐⭐ 우수 |

### 점수 합계 (30점 만점)

- **Option A (Hybrid)**: 26점 🥇
- **Option B (Profile Only)**: 20점 🥉
- **Option C (servers.dat Only)**: 22점 🥈

---

## 💡 권장 사항

### 🌟 **Option A (Hybrid)를 권장합니다**

**이유:**

1. **최고의 UX**
   - 일반 사용자: 아무것도 안 해도 자동
   - 고급 사용자: 명시적 제어 가능

2. **기존 시스템과 완벽 호환**
   - UI 그대로 활용
   - servers.dat 파싱 재사용
   - `hyenimc://auth` 일관성

3. **모든 시나리오 커버**
   - 자동 감지 ✅
   - 수동 설정 ✅
   - 오버라이드 ✅

4. **미래 확장성**
   - 새로운 도메인 추가 쉬움
   - 서버별 설정 확장 가능

### 구현 우선순위

**Phase 1 (필수):**
```
1. Option A 핵심 로직 구현
2. profile.ts 통합
3. 기본 테스트 (시나리오 1, 4)
```

**Phase 2 (권장):**
```
4. UI 설명 개선
5. 로그 메시지 추가
6. 전체 시나리오 테스트
```

**Phase 3 (선택):**
```
7. 디버그 모드 추가
8. 서버 감지 결과 UI 표시
```

---

## 🔧 기술적 고려사항

### 성능

- **servers.dat 파싱**: ~10-50ms
- **Profile 설정 체크**: <1ms
- **영향**: 무시 가능 (게임 실행 시 한 번만)

### 에러 처리

```typescript
// servers.dat 파싱 실패 시
try {
  return await checkServersDatForHyeniWorld(gameDirectory);
} catch (error) {
  console.error('[ModUpdater] servers.dat parse error:', error);
  return false; // fallback to false (safe)
}
```

### 캐싱

**불필요함** - 게임 실행 시 한 번만 체크하므로 캐싱 불필요

### 의존성

```typescript
import nbt from 'prismarine-nbt'; // 이미 사용 중
```

---

## 📝 UI 개선 제안 (Option A 선택 시)

### ProfileSettingsTab.tsx 수정

```typescript
// 기존 (line 725-728)
<p className="text-xs text-gray-400 mt-2">
  💡 <strong>디스코드 인증 연동:</strong> 이 주소를 설정하면 디스코드에서 인증 링크를 클릭할 때<br/>
  HyeniHelper 모드 설정이 자동으로 업데이트됩니다.
</p>

// 개선안
<p className="text-xs text-gray-400 mt-2">
  💡 <strong>자동 감지:</strong> 멀티플레이 서버 목록에 혜니월드 서버가 있으면 자동으로 감지됩니다.<br/>
  이 필드에 주소를 입력하면 자동 감지를 덮어씁니다 (예: 테스트 서버 강제 지정).
</p>
<p className="text-xs text-hyeni-pink-400 mt-1">
  ✨ 일반 사용자는 비워두셔도 됩니다!
</p>
```

### 서버 감지 상태 표시 (선택)

```typescript
// 프로필 상세 페이지에 표시
<div className="card">
  <h3>서버 감지 상태</h3>
  {detectedServer ? (
    <div className="text-green-400">
      ✅ 혜니월드 서버 감지됨: {detectedServer}
      {source === 'profile' && ' (프로필 설정)'}
      {source === 'servers.dat' && ' (서버 목록)'}
    </div>
  ) : (
    <div className="text-gray-400">
      ℹ️ 혜니월드 서버 감지 안 됨 (모드 자동 업데이트 비활성)
    </div>
  )}
</div>
```

---

## 🧪 테스트 계획

### Option A - 5개 시나리오

```typescript
describe('ModUpdater.isRequiredModServer (Hybrid)', () => {
  test('Scenario 1: 완전 자동 (servers.dat만)', async () => {
    // servers.dat에 play.example.com
    // Profile 설정 없음
    expect(await isRequiredModServer(undefined, gameDir)).toBe(true);
  });
  
  test('Scenario 2: 명시적 설정 (Profile)', async () => {
    // Profile: play.example.com
    expect(await isRequiredModServer('play.example.com', gameDir)).toBe(true);
  });
  
  test('Scenario 3: 오버라이드 (Profile > servers.dat)', async () => {
    // servers.dat: play.example.com
    // Profile: mc.hypixel.net
    expect(await isRequiredModServer('mc.hypixel.net', gameDir)).toBe(false);
  });
  
  test('Scenario 4: 일반 서버', async () => {
    // servers.dat: mc.hypixel.net
    // Profile 없음
    expect(await isRequiredModServer(undefined, gameDir)).toBe(false);
  });
  
  test('Scenario 5: 싱글플레이', async () => {
    // servers.dat 없음
    // Profile 없음
    expect(await isRequiredModServer(undefined, gameDir)).toBe(false);
  });
});
```

### Option B - 2개 시나리오

```typescript
describe('ModUpdater.isRequiredModServer (Profile Only)', () => {
  test('HyeniWorld server set', () => {
    expect(isRequiredModServer('play.example.com')).toBe(true);
  });
  
  test('no server or other server', () => {
    expect(isRequiredModServer(undefined)).toBe(false);
    expect(isRequiredModServer('mc.hypixel.net')).toBe(false);
  });
});
```

### Option C - 3개 시나리오

```typescript
describe('ModUpdater.isRequiredModServer (servers.dat Only)', () => {
  test('HyeniWorld server in servers.dat', async () => {
    expect(await isRequiredModServer(gameDirWithHyeniWorld)).toBe(true);
  });
  
  test('no HyeniWorld server in servers.dat', async () => {
    expect(await isRequiredModServer(gameDirWithoutHyeniWorld)).toBe(false);
  });
  
  test('servers.dat not found', async () => {
    expect(await isRequiredModServer(gameDirEmpty)).toBe(false);
  });
});
```

---

## 🚀 구현 로드맵 (Option A 선택 시)

### Day 1: 핵심 로직 (2-3시간)

```
1. mod-updater.ts 작성
   - isRequiredModServer() 구현
   - checkServersDatForHyeniWorld() 구현
   
2. profile.ts 통합
   - PROFILE_LAUNCH 핸들러 수정
   - 에러 처리 추가
   
3. 기본 테스트
   - 시나리오 1, 4 테스트
```

### Day 2: 완성 및 테스트 (2-3시간)

```
4. 전체 시나리오 테스트
   - 5개 시나리오 모두
   
5. UI 개선
   - ProfileSettingsTab 설명 수정
   
6. 로그 개선
   - 디버깅 메시지 추가
   
7. 문서화
   - README 업데이트
```

---

## 🤔 의사결정 체크리스트

Option 선택 시 고려할 점:

- [ ] **사용자 경험**: 자동화 vs 명시적 제어
- [ ] **구현 복잡도**: 개발 시간 vs 기능
- [ ] **유지보수**: 테스트 양 vs 안정성
- [ ] **확장성**: 미래 기능 추가 가능성
- [ ] **기존 시스템 호환**: UI/프로토콜 일관성
- [ ] **팀 선호도**: 단순함 vs 완성도

---

## 📞 다음 단계

1. **팀 리뷰**: 이 문서 검토
2. **의사결정**: 옵션 선택
3. **구현 시작**: IMPLEMENTATION_PLAN.md 업데이트
4. **테스트**: 선택한 옵션의 시나리오 실행

---

**문서 작성일**: 2025-10-16  
**작성자**: Cascade AI  
**상태**: 검토 대기 ⏳
