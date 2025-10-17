# 장애 대응 및 복구 시스템 계획

> **작성일**: 2025-10-17  
> **상태**: 계획 단계 (검토 대기)  
> **우선순위**: 🔴 높음 (안정성 핵심)

---

## 📋 개요

현재 시스템의 주요 문제점:
- ❌ 환경 설정 누락 시 무한 대기 또는 암호화된 에러
- ❌ 백엔드 연결 실패 시 명확한 안내 없음
- ❌ DB 스키마 불일치 시 자동 복구 불가
- ❌ 데이터 손상 시 복구 방법 없음
- ❌ 캐시 오염 시 대응 불가

**목표**: 자동 복구 가능한 상황은 자동으로, 수동 개입 필요한 상황은 명확히 안내

---

## 🎯 예상되는 장애 시나리오 분류

### 1️⃣ 환경 설정 관련 장애

#### 1-1. .env 파일 누락/불완전

**증상**:
```
- 백엔드 주소 없음 → gRPC 연결 실패
- 데이터 디렉토리 없음 → DB 파일 생성 불가
- API 키 없음 → 외부 API 호출 실패
```

**현재 상황**:
```typescript
// 현재: 조용히 실패
const backendAddr = process.env.HYENIMC_ADDR || '';  // 빈 문자열
const result = await accountRpc.getAllAccounts({});  // 연결 실패
```

**복구 가능성**: ✅ 자동 복구 가능

---

#### 1-2. 잘못된 환경 설정값

**증상**:
```
- 백엔드 주소 형식 오류 (localhost:5000 vs 127.0.0.1:5000)
- 데이터 디렉토리 권한 없음
- 포트 번호 범위 초과
```

**현재 상황**:
```
연결 시도 → 타임아웃 → 사용자 혼란
```

**복구 가능성**: ✅ 수동 개입 필요

---

### 2️⃣ 백엔드 연결 장애

#### 2-1. 백엔드 프로세스 미실행

**증상**:
```
Error: connect ECONNREFUSED 127.0.0.1:5000
```

**현재 상황**:
```
gRPC 클라이언트가 계속 재시도 → UI 응답 불가
```

**복구 가능성**: ✅ 자동 복구 가능 (백엔드 시작 후)

---

#### 2-2. 백엔드 버전 불일치

**증상**:
```
gRPC 메서드 시그니처 불일치
프로토콜 버전 호환성 문제
```

**현재 상황**:
```
런타임 에러 → 예측 불가능한 동작
```

**복구 가능성**: ✅ 수동 개입 필요 (버전 맞춤)

---

### 3️⃣ 데이터베이스 장애

#### 3-1. DB 파일 손상

**증상**:
```
SQL logic error: database disk image is malformed
```

**현재 상황**:
```
모든 DB 작업 실패 → 애플리케이션 사용 불가
```

**복구 가능성**: ✅ 자동 복구 가능 (DB 재생성)

---

#### 3-2. 스키마 버전 불일치 (이번 사건!)

**증상**:
```
schema_version = 16 (DB)
accounts 테이블 없음 (실제)
```

**현재 상황**:
```
마이그레이션 스킵됨 → 테이블 누락
```

**복구 가능성**: ✅ 자동 복구 가능 (DB 재초기화)

---

#### 3-3. 마이그레이션 실패

**증상**:
```
Migration 16 실행 중 SQL 에러
트랜잭션 롤백됨
schema_version 미업데이트
```

**현재 상황**:
```
다음 실행 시 재시도 → 계속 실패
```

**복구 가능성**: ✅ 자동 복구 가능 (에러 로깅 + 재시도)

---

#### 3-4. 데이터 무결성 위반

**증상**:
```
FOREIGN KEY constraint failed
UNIQUE constraint failed
CHECK constraint failed
```

**현재 상황**:
```
특정 작업만 실패 → 부분적 데이터 손상
```

**복구 가능성**: ⚠️ 부분 복구 가능 (트랜잭션 롤백)

---

### 4️⃣ 캐시 오염

#### 4-1. API 응답 캐시 손상

**증상**:
```
api_cache 테이블의 JSON 파싱 실패
```

**현재 상황**:
```
캐시 사용 불가 → 매번 API 호출
```

**복구 가능성**: ✅ 자동 복구 가능 (캐시 초기화)

---

#### 4-2. 프로필 모드 캐시 불일치

**증상**:
```
profile_mods 테이블의 파일이 실제로 없음
파일 해시 불일치
```

**현재 상황**:
```
모드 목록 표시 오류
```

**복구 가능성**: ✅ 자동 복구 가능 (캐시 재스캔)

---

### 5️⃣ 계정 관련 장애

#### 5-1. 계정 데이터 손상

**증상**:
```
accounts 테이블 없음 (이번 사건)
암호화 데이터 복호화 실패
```

**현재 상황**:
```
계정 로그인 불가
```

**복구 가능성**: ⚠️ 부분 복구 (오프라인 계정만)

---

#### 5-2. 암호화 키 손실

**증상**:
```
encryption.key 파일 없음
```

**현재 상황**:
```
저장된 토큰 복호화 불가
```

**복구 가능성**: ❌ 복구 불가 (재로그인 필요)

---

### 6️⃣ 파일 시스템 장애

#### 6-1. 디렉토리 권한 문제

**증상**:
```
EACCES: permission denied
```

**현재 상황**:
```
DB 파일 생성/읽기 불가
```

**복구 가능성**: ❌ 복구 불가 (시스템 권한 문제)

---

#### 6-2. 디스크 공간 부족

**증상**:
```
ENOSPC: no space left on device
```

**현재 상황**:
```
DB 쓰기 작업 실패
```

**복구 가능성**: ❌ 복구 불가 (디스크 정리 필요)

---

## 📊 복구 가능성 매트릭스

| 장애 유형 | 복구 가능 | 자동 복구 | 수동 개입 | 우선순위 |
|----------|---------|---------|---------|---------|
| .env 누락 | ✅ | ❌ | ✅ | 🔴 높음 |
| 백엔드 미실행 | ✅ | ⚠️ | ✅ | 🔴 높음 |
| DB 손상 | ✅ | ✅ | ❌ | 🔴 높음 |
| 스키마 불일치 | ✅ | ✅ | ❌ | 🔴 높음 |
| 마이그레이션 실패 | ✅ | ✅ | ⚠️ | 🟡 중간 |
| 캐시 오염 | ✅ | ✅ | ❌ | 🟡 중간 |
| 계정 손상 | ⚠️ | ⚠️ | ✅ | 🟡 중간 |
| 암호화 키 손실 | ❌ | ❌ | ❌ | 🔴 높음 |
| 권한 문제 | ❌ | ❌ | ✅ | 🟢 낮음 |
| 디스크 부족 | ❌ | ❌ | ✅ | 🟢 낮음 |

---

## 🛠️ 복구 전략

### 레벨 1: 자동 복구 (조용히 처리)

**적용 대상**:
- DB 손상 → 재생성
- 스키마 불일치 → DB 초기화
- 캐시 오염 → 캐시 초기화

**구현**:
```typescript
// 1. DB 초기화 감지
if (dbCorrupted || schemaVersionMismatch) {
  // 2. 백업 생성
  await backupDatabase();
  
  // 3. DB 재생성
  await reinitializeDatabase();
  
  // 4. 로그 기록
  logger.warn('Database auto-recovered', { reason, timestamp });
}
```

---

### 레벨 2: 안내 + 수동 복구 (사용자 개입)

**적용 대상**:
- .env 누락 → 설정 안내
- 백엔드 미실행 → 백엔드 시작 안내
- 버전 불일치 → 버전 확인 안내

**구현**:
```typescript
// 1. 문제 감지
if (!envConfigured) {
  // 2. 상세 안내 표시
  showErrorDialog({
    title: '환경 설정 필요',
    message: '.env 파일에 다음 값을 설정하세요:\n- HYENIMC_ADDR\n- HYENIMC_DATA_DIR',
    details: 'docs/guides/SETUP_GUIDE.md 참고',
    buttons: ['설정 파일 열기', '가이드 보기', '닫기']
  });
}
```

---

### 레벨 3: 부분 기능 제한 (Graceful Degradation)

**적용 대상**:
- 백엔드 연결 실패 → 오프라인 모드
- 캐시 접근 불가 → 캐시 없이 진행
- 특정 계정 손상 → 다른 계정 사용 가능

**구현**:
```typescript
// 1. 기능별 헬스 체크
const health = {
  backend: await checkBackendConnection(),
  database: await checkDatabaseAccess(),
  cache: await checkCacheAccess(),
};

// 2. 기능 제한
if (!health.backend) {
  disableFeature('account-management');
  disableFeature('profile-sync');
  enableFeature('offline-mode');
}
```

---

### 레벨 4: 복구 불가 (명확한 에러)

**적용 대상**:
- 암호화 키 손실
- 권한 문제
- 디스크 부족

**구현**:
```typescript
// 1. 복구 불가 감지
if (encryptionKeyLost) {
  // 2. 명확한 에러 메시지
  showFatalErrorDialog({
    title: '복구 불가능한 오류',
    message: '암호화 키가 손실되어 저장된 계정에 접근할 수 없습니다.',
    solution: '다시 로그인하거나 백업에서 복구하세요.',
    buttons: ['다시 로그인', '종료']
  });
}
```

---

## 🏗️ 구현 계획

### Phase 1: 진단 시스템 (1-2일)

#### 1-1. 헬스 체크 서비스

**파일**: `src/main/services/health-check.ts`

```typescript
interface HealthStatus {
  overall: 'healthy' | 'degraded' | 'critical';
  components: {
    backend: ComponentHealth;
    database: ComponentHealth;
    cache: ComponentHealth;
    encryption: ComponentHealth;
    filesystem: ComponentHealth;
  };
  issues: HealthIssue[];
  recoveryOptions: RecoveryOption[];
}

interface ComponentHealth {
  status: 'ok' | 'warning' | 'error';
  message: string;
  lastCheck: number;
  autoRecoverable: boolean;
}

class HealthCheckService {
  async checkBackendConnection(): Promise<ComponentHealth>
  async checkDatabaseIntegrity(): Promise<ComponentHealth>
  async checkSchemaVersion(): Promise<ComponentHealth>
  async checkCacheValidity(): Promise<ComponentHealth>
  async checkEncryptionKey(): Promise<ComponentHealth>
  async checkFileSystemAccess(): Promise<ComponentHealth>
  
  async getFullStatus(): Promise<HealthStatus>
}
```

#### 1-2. 문제 감지 로직

```typescript
// 각 컴포넌트별 감지
class DiagnosticsService {
  async detectDatabaseCorruption(): Promise<boolean>
  async detectSchemaMismatch(): Promise<boolean>
  async detectCacheCorruption(): Promise<boolean>
  async detectAccountDataLoss(): Promise<boolean>
  async detectEncryptionKeyLoss(): Promise<boolean>
}
```

---

### Phase 2: 자동 복구 (1-2일)

#### 2-1. DB 복구

```typescript
class DatabaseRecoveryService {
  async autoRecoverCorruptedDatabase(): Promise<void> {
    // 1. 백업 생성
    await this.createBackup();
    
    // 2. DB 파일 삭제
    await fs.unlink(dbPath);
    
    // 3. 새 DB 초기화
    await db.Initialize(dataDir);
    
    // 4. 로그 기록
    logger.warn('Database auto-recovered', {
      backupPath: backupPath,
      timestamp: new Date()
    });
  }
  
  async fixSchemaMismatch(): Promise<void> {
    // 1. 현재 버전 확인
    const currentVersion = await this.getCurrentSchemaVersion();
    
    // 2. 누락된 마이그레이션 재실행
    await this.runPendingMigrations();
    
    // 3. 검증
    await this.validateSchema();
  }
}
```

#### 2-2. 캐시 복구

```typescript
class CacheRecoveryService {
  async clearCorruptedCache(): Promise<void> {
    // 1. 캐시 테이블 초기화
    await db.exec('DELETE FROM api_cache');
    await db.exec('DELETE FROM profile_mods');
    
    // 2. 로그 기록
    logger.info('Cache cleared due to corruption');
  }
  
  async rescanProfileMods(): Promise<void> {
    // 1. 실제 파일 스캔
    const actualMods = await this.scanModsFromDisk();
    
    // 2. 캐시와 비교
    const cachedMods = await this.getCachedMods();
    
    // 3. 불일치 항목 제거
    const orphaned = cachedMods.filter(m => !actualMods.find(a => a.path === m.path));
    await this.removeCachedMods(orphaned);
  }
}
```

---

### Phase 3: 사용자 안내 (1-2일)

#### 3-1. 에러 다이얼로그 시스템

**파일**: `src/renderer/components/ErrorDialog.tsx`

```typescript
interface ErrorDialogProps {
  type: 'info' | 'warning' | 'error' | 'fatal';
  title: string;
  message: string;
  details?: string;
  suggestions?: string[];
  actions?: ErrorAction[];
  autoRecoveryProgress?: number;
}

interface ErrorAction {
  label: string;
  action: 'retry' | 'recover' | 'configure' | 'exit' | 'custom';
  onClick?: () => Promise<void>;
}
```

#### 3-2. 복구 안내 UI

```typescript
// 예시: .env 누락 시
<ErrorDialog
  type="error"
  title="환경 설정 필요"
  message=".env 파일이 설정되지 않았습니다."
  suggestions={[
    "1. .env.example을 .env로 복사",
    "2. HYENIMC_ADDR 설정 (예: localhost:5000)",
    "3. 애플리케이션 재시작"
  ]}
  actions={[
    { label: '설정 파일 열기', action: 'custom', onClick: openEnvFile },
    { label: '가이드 보기', action: 'custom', onClick: openGuide },
    { label: '재시도', action: 'retry' }
  ]}
/>
```

---

### Phase 4: 모니터링 및 로깅 (1일)

#### 4-1. 상세 로깅

```typescript
class ErrorLogger {
  async logError(error: Error, context: ErrorContext): Promise<void> {
    const errorReport = {
      timestamp: new Date(),
      type: error.constructor.name,
      message: error.message,
      stack: error.stack,
      context: {
        component: context.component,
        action: context.action,
        state: context.state,
        environment: {
          nodeEnv: process.env.NODE_ENV,
          appVersion: app.getVersion(),
          platform: process.platform,
        }
      },
      systemInfo: {
        memory: process.memoryUsage(),
        uptime: process.uptime(),
      }
    };
    
    // 1. 파일에 기록
    await this.writeToFile(errorReport);
    
    // 2. 콘솔에 출력
    console.error('[ERROR]', errorReport);
    
    // 3. 원격 로깅 (선택)
    if (shouldReportRemotely(error)) {
      await this.sendToRemote(errorReport);
    }
  }
}
```

#### 4-2. 에러 리포트 생성

```typescript
class ErrorReportService {
  async generateReport(): Promise<ErrorReport> {
    return {
      timestamp: new Date(),
      appVersion: app.getVersion(),
      systemInfo: {
        platform: process.platform,
        arch: process.arch,
        memory: os.totalmem(),
        freeMemory: os.freemem(),
      },
      databaseStatus: await this.checkDatabaseStatus(),
      backendStatus: await this.checkBackendStatus(),
      recentErrors: await this.getRecentErrors(100),
      logs: await this.getRecentLogs(1000),
    };
  }
  
  async exportReport(path: string): Promise<void> {
    const report = await this.generateReport();
    await fs.writeFile(path, JSON.stringify(report, null, 2));
  }
}
```

---

### Phase 5: 초기화 및 재설정 (1일)

#### 5-1. 초기화 마법사

**파일**: `src/renderer/pages/InitializationWizard.tsx`

```typescript
// 단계별 초기화
enum InitializationStep {
  WELCOME = 'welcome',
  ENV_CONFIG = 'env_config',
  BACKEND_CHECK = 'backend_check',
  DATABASE_INIT = 'database_init',
  ACCOUNT_SETUP = 'account_setup',
  COMPLETE = 'complete',
}

interface InitializationState {
  currentStep: InitializationStep;
  completed: InitializationStep[];
  errors: Map<InitializationStep, Error>;
  autoRecoveryAttempts: number;
}
```

#### 5-2. 공장 초기화 (Nuclear Option)

```typescript
class FactoryResetService {
  async performFactoryReset(options: FactoryResetOptions): Promise<void> {
    // 1. 백업 생성
    await this.createFullBackup();
    
    // 2. 선택적 삭제
    if (options.clearDatabase) {
      await fs.unlink(dbPath);
    }
    if (options.clearCache) {
      await fs.rm(cachePath, { recursive: true });
    }
    if (options.clearAccounts) {
      await this.clearAllAccounts();
    }
    if (options.clearSettings) {
      await this.resetAllSettings();
    }
    
    // 3. 재초기화
    await this.reinitialize();
    
    // 4. 로그
    logger.warn('Factory reset performed', { options, timestamp: new Date() });
  }
}
```

---

## 📋 구현 우선순위

### 🔴 Phase 1 (필수, 1-2주)

1. **헬스 체크 서비스** (3-4일)
   - 각 컴포넌트 상태 진단
   - 문제 자동 감지

2. **DB 자동 복구** (2-3일)
   - 손상된 DB 재생성
   - 스키마 불일치 수정

3. **상세 에러 메시지** (2-3일)
   - 사용자 친화적 메시지
   - 해결 방법 제시

### 🟡 Phase 2 (권장, 1-2주)

4. **캐시 복구** (2일)
   - 캐시 자동 정리
   - 모드 캐시 재스캔

5. **초기화 마법사** (3-4일)
   - 단계별 설정 안내
   - 자동 검증

### 🟢 Phase 3 (선택, 1주)

6. **모니터링 시스템** (2-3일)
   - 에러 로깅
   - 리포트 생성

7. **공장 초기화** (1-2일)
   - 완전 초기화 옵션

---

## 🎯 성공 기준

### 자동 복구 가능한 장애

- [ ] DB 손상 → 자동 재생성
- [ ] 스키마 불일치 → 자동 수정
- [ ] 캐시 오염 → 자동 정리
- [ ] 마이그레이션 실패 → 자동 재시도

### 사용자 안내 가능한 장애

- [ ] .env 누락 → 상세 안내 표시
- [ ] 백엔드 미실행 → 시작 방법 안내
- [ ] 버전 불일치 → 확인 방법 안내

### 부분 기능 제한

- [ ] 백엔드 연결 실패 → 오프라인 모드 활성화
- [ ] 캐시 접근 불가 → 캐시 없이 진행
- [ ] 특정 계정 손상 → 다른 계정 사용 가능

### 명확한 에러 표시

- [ ] 복구 불가능한 상황 명시
- [ ] 사용자 조치 방법 제시
- [ ] 에러 리포트 생성 가능

---

## 💡 추가 고려사항

### 1. 백업 전략

```typescript
// 자동 백업
- 매일 자정: 전체 DB 백업
- 주 1회: 전체 설정 백업
- 에러 발생 시: 즉시 백업

// 백업 보관
- 최근 7일: 매일 백업
- 최근 4주: 주간 백업
- 최근 12개월: 월간 백업
```

### 2. 버전 호환성

```typescript
// 마이그레이션 검증
- 마이그레이션 실행 전: 사전 검증
- 마이그레이션 실행 중: 진행 상황 로깅
- 마이그레이션 실행 후: 결과 검증

// 롤백 지원
- 마이그레이션 실패 시: 자동 롤백
- 이전 버전 호환성: 유지
```

### 3. 사용자 커뮤니케이션

```typescript
// 에러 메시지 원칙
1. 무엇이 잘못되었는가? (명확)
2. 왜 잘못되었는가? (이해)
3. 어떻게 해결하는가? (행동)
4. 도움을 받으려면? (지원)
```

---

## 📊 예상 효과

| 항목 | 현재 | 개선 후 |
|------|------|--------|
| **자동 복구 가능** | 0% | 70% |
| **사용자 안내** | 10% | 90% |
| **평균 복구 시간** | 30분 | 2분 |
| **사용자 만족도** | 낮음 | 높음 |
| **지원 요청** | 많음 | 적음 |

---

## 📝 결론

**현재 상황**:
- 장애 발생 시 사용자가 무엇을 해야 할지 모름
- 자동 복구 메커니즘 없음
- 에러 메시지가 불명확함

**개선 후**:
- 대부분의 장애 자동 복구
- 복구 불가능한 상황 명확히 안내
- 사용자가 스스로 해결 가능

**투자 대비 효과**:
- 개발 시간: 2-3주
- 사용자 만족도 향상: 크게
- 지원 비용 절감: 상당함

---

**다음 단계**: 이 계획을 검토하신 후, 어느 Phase부터 시작할지 결정해주세요.
