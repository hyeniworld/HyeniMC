# P0 (최우선) 구현 계획 (최종)

> **작성일**: 2025-10-20  
> **우선순위**: 🔴 최우선 (1-2주 내 완료)  
> **목표**: 게임 실행 성공률 70% → 90% 향상

---

## 📊 기존 구현 현황

### ✅ 이미 구현된 기능

#### 1. 메모리 설정 자동 조정 ⭐
**위치**: 
- `src/renderer/components/profiles/ProfileSettingsTab.tsx` (268-284줄)
- `src/renderer/pages/SettingsPage.tsx` (130-160줄)

**구현 내용**:
```typescript
// min > max 자동 수정
if (minMemory > maxMemory) {
  setMaxMemory(minMemory);
  toast.info('메모리 자동 조정', '최대 메모리가 조정되었습니다.');
}

// max < min 자동 수정
if (maxMemory < minMemory) {
  setMinMemory(maxMemory);
  toast.info('메모리 자동 조정', '최소 메모리가 조정되었습니다.');
}
```

**커버하는 케이스**:
- ✅ 최소 > 최대 논리 오류

**커버하지 않는 케이스**:
- ❌ 시스템 메모리 초과
- ❌ 가용 메모리 초과
- ❌ 최소 메모리가 불필요하게 큼

---

#### 2. 에러 메시지 변환 ⭐⭐⭐⭐⭐
**위치**: `src/main/utils/error-handler.ts`

**구현 내용**:
- 7가지 에러 타입 변환
- 사용자 친화적 메시지 + 해결 방법

**완성도**: **90%** (UI 통합만 필요)

---

#### 3. 재시도 로직 ⭐⭐⭐⭐⭐
**위치**: `src/main/utils/retry.ts`

**구현 내용**:
- 지수 백오프
- 네트워크 에러 자동 재시도
- 병렬 처리

**완성도**: **95%** (완벽)

---

#### 4. Java 자동 감지 ⭐⭐⭐⭐
**위치**: `src/main/services/java-detector.ts`

**구현 내용**:
- macOS, Windows, Linux 지원
- 버전 파싱 및 캐싱

**완성도**: **85%** (검증 로직만 추가 필요)

---

## 🎯 P0 구현 목록 (3개)

### 1️⃣ GameLaunchValidator (게임 실행 전 검증)

#### 목표
**게임 실행 전 문제를 미리 발견해서 실행 실패 방지**

#### 검증 항목

**A. 설정 검증 (Configuration)**
```typescript
// 1. Java 경로 유효성
checkJavaPathValidity(profile)
  - 파일 존재 여부
  - 실행 권한
  - 실제 Java인지 확인

// 2. Java 버전 불일치
checkJavaVersionMismatch(profile)
  - MC 1.21 → Java 21 필요
  - MC 1.20 → Java 17 필요
  - 설정된 Java 버전과 비교
  - ✅ 자동 수정: 더 적절한 Java 자동 선택

// 3. 메모리 설정 (추가 검증)
checkMemoryConfiguration(profile)
  - ✅ 기존: min > max (이미 UI에서 처리됨)
  - 🆕 추가: min이 가용 메모리 70% 초과
  - 🆕 추가: max가 시스템 메모리 80% 초과
  - 🆕 추가: min = max이고 시스템 메모리 80% 초과 (위험)
  - ✅ 자동 수정: 안전한 범위로 조정

// 4. 로더 호환성
checkLoaderCompatibility(profile)
  - 로더 설치 여부
  - 로더 버전 vs 모드 요구사항

// 5. 게임 디렉토리
checkGameDirectory(profile)
  - 존재 여부
  - 읽기/쓰기 권한
```

**B. 시스템 검증 (System)**
```typescript
// 1. Java 설치 (기존 java-detector 활용)
checkJavaInstallation()

// 2. 가용 메모리
checkAvailableMemory(profile)

// 3. 디스크 공간
checkDiskSpace(profile)
```

**C. 파일 검증 (Files)**
```typescript
// 1. 게임 파일
checkGameFiles(profile)
  - {version}.jar 존재
  - 체크섬 (선택)

// 2. 로더 파일
checkLoaderFiles(profile)
  - 로더 jar 존재
```

#### 구현 파일
```
src/main/services/
  └─ game-launch-validator.ts (신규)
     ├─ class GameLaunchValidator
     ├─ validateBeforeLaunch()
     └─ 개별 검증 함수들

src/main/utils/
  └─ configuration-fixer.ts (신규)
     ├─ class ConfigurationFixer
     └─ 자동 수정 함수들
```

#### 통합 지점
```typescript
// src/main/services/game-launcher.ts
async launch(options: LaunchOptions, ...): Promise<GameProcess> {
  // ✨ 추가: 실행 전 검증
  const validator = new GameLaunchValidator();
  const validation = await validator.validateBeforeLaunch(options);
  
  if (!validation.canLaunch) {
    throw new GameLaunchError(validation.issues[0]);
  }
  
  // 기존 로직 계속...
}
```

#### 예상 시간
**3-4일**
- 1일: 기본 검증 로직 (Java, 메모리)
- 1일: 파일 검증
- 1일: 자동 수정 로직
- 0.5일: 통합 및 테스트

#### 예상 효과
- 게임 실행 성공률 **70% → 90%**
- 사용자 혼란 **80% 감소**

---

### 2️⃣ ErrorDialog (통합 에러 다이얼로그 UI)

#### 목표
**에러 발생 시 사용자에게 명확히 안내하고 해결 방법 제시**

#### 구현 내용

```typescript
// src/renderer/components/common/ErrorDialog.tsx
interface ErrorDialogProps {
  type: 'info' | 'warning' | 'error' | 'critical';
  title: string;
  message: string;
  details?: string;          // 접을 수 있는 상세 정보
  suggestions?: string[];    // 해결 방법 리스트
  actions?: ErrorAction[];   // 액션 버튼
}

interface ErrorAction {
  label: string;
  type: 'primary' | 'secondary' | 'danger';
  onClick: () => Promise<void>;
}
```

#### UI 구조
```
┌─────────────────────────────────┐
│ 🔴 Java를 찾을 수 없습니다      │
│                              [X] │
├─────────────────────────────────┤
│ Minecraft를 실행하려면 Java가   │
│ 필요합니다.                     │
│                                 │
│ 💡 해결 방법:                   │
│ 1. Java를 설치하세요            │
│ 2. Java 경로를 수동으로 설정    │
│                                 │
│ ▶ 상세 정보                     │
├─────────────────────────────────┤
│ [Java 설치 가이드] [재시도][닫기]│
└─────────────────────────────────┘
```

#### 통합 방법

**A. IPC 추가**
```typescript
// src/main/main.ts
ipcMain.handle('dialog:showError', async (_, errorData) => {
  // Renderer로 에러 전달
  mainWindow?.webContents.send('show-error-dialog', errorData);
});
```

**B. Context 생성**
```typescript
// src/renderer/contexts/ErrorDialogContext.tsx
export function ErrorDialogProvider({ children }) {
  const [errorData, setErrorData] = useState(null);
  
  useEffect(() => {
    window.electronAPI.onShowErrorDialog((data) => {
      setErrorData(data);
    });
  }, []);
  
  return (
    <ErrorDialogContext.Provider value={{ showError }}>
      {children}
      {errorData && <ErrorDialog {...errorData} />}
    </ErrorDialogContext.Provider>
  );
}
```

**C. Main에서 사용**
```typescript
// src/main/services/game-launcher.ts
try {
  await this.launch(options);
} catch (error) {
  const userError = createUserFriendlyError(error); // 기존 활용!
  
  ipcMain.emit('dialog:showError', {
    type: 'error',
    title: userError.title,
    message: userError.message,
    details: userError.technicalDetails,
    suggestions: [userError.solution],
    actions: [
      { label: 'Java 설치 가이드', type: 'primary', action: 'openJavaGuide' },
      { label: '재시도', type: 'secondary', action: 'retry' },
      { label: '닫기', type: 'secondary', action: 'close' }
    ]
  });
}
```

#### 예상 시간
**2-3일**
- 1일: ErrorDialog 컴포넌트
- 1일: IPC + Context 통합
- 0.5일: 액션 핸들러
- 0.5일: 테스트

#### 예상 효과
- 사용자 안내 **10% → 80%**
- 자가 해결률 **30% → 70%**

---

### 3️⃣ CrashAnalyzer (크래시 분석기)

#### 목표
**게임 크래시 시 로그를 분석해서 원인과 해결 방법 자동 제안**

#### 분석 패턴

```typescript
// src/main/services/crash-analyzer.ts
class CrashAnalyzer {
  async analyzeCrashLog(logPath: string): CrashAnalysis {
    const log = await fs.readFile(logPath, 'utf-8');
    
    // 1. OutOfMemoryError
    if (log.includes('OutOfMemoryError')) {
      return {
        type: 'memory',
        title: '메모리 부족으로 종료',
        fixes: [
          { title: '메모리 6GB로 증가', automated: true },
          { title: '일부 모드 비활성화', automated: false }
        ]
      };
    }
    
    // 2. ModLoadingException
    if (log.includes('ModLoadingException')) {
      const mods = this.extractProblematicMods(log);
      return {
        type: 'mod-conflict',
        title: '모드 충돌로 종료',
        fixes: [
          { title: `${mods.join(', ')} 비활성화`, automated: true },
          { title: '모드 업데이트', automated: false }
        ]
      };
    }
    
    // 3. GLException
    if (log.includes('GLException')) {
      return {
        type: 'graphics',
        title: '그래픽 에러',
        fixes: [
          { title: '그래픽 드라이버 업데이트', automated: false }
        ]
      };
    }
    
    // 4. ZipException
    if (log.includes('ZipException')) {
      return {
        type: 'file-corruption',
        title: '파일 손상',
        fixes: [
          { title: '프로필 재생성', automated: false }
        ]
      };
    }
    
    return { type: 'unknown', ... };
  }
}
```

#### 통합 지점

```typescript
// src/main/services/game-launcher.ts
childProcess.on('exit', async (code) => {
  if (code !== 0 && code !== null) {
    // 크래시 감지
    const analyzer = new CrashAnalyzer();
    const latestLog = await this.findLatestCrashLog(gameDir);
    
    if (latestLog) {
      const analysis = await analyzer.analyzeCrashLog(latestLog);
      
      // ErrorDialog로 표시
      ipcMain.emit('dialog:showError', {
        type: 'error',
        title: analysis.title,
        message: analysis.message,
        suggestions: analysis.fixes.map(f => f.title),
        actions: analysis.fixes
          .filter(f => f.automated)
          .map(f => ({
            label: f.title,
            type: 'primary',
            action: f.action
          }))
      });
      
      // 통계 기록
      await cacheRpc.recordProfileCrash({ profileId });
    }
  }
});
```

#### 예상 시간
**3-4일**
- 1일: 기본 패턴 분석 (OutOfMemoryError, ModConflict)
- 1일: 추가 패턴 (Graphics, FileCorruption)
- 1일: 자동 수정 로직
- 1일: 통합 및 테스트

#### 예상 효과
- 크래시 후 즉시 원인 파악
- 자동 복구 옵션 제공

---

## 📅 구현 일정

### Week 1 (5일)
```
Day 1-2: GameLaunchValidator (기본)
  - Java 검증
  - 메모리 검증
  - 파일 검증

Day 3-4: ErrorDialog
  - 컴포넌트
  - IPC 통합
  - Context

Day 5: GameLaunchValidator (완성)
  - 자동 수정 로직
  - 통합
```

### Week 2 (5일)
```
Day 1-3: CrashAnalyzer
  - 패턴 분석
  - 자동 수정
  - 통합

Day 4-5: 통합 테스트 + 버그 수정
  - 전체 흐름 테스트
  - 각 시나리오별 검증
```

**총 예상 시간**: **10일 (2주)**

---

## 🎯 성공 기준

### GameLaunchValidator
- [ ] Java 미설치 감지
- [ ] Java 버전 불일치 감지 + 자동 수정
- [ ] 메모리 설정 오류 감지 + 자동 수정
- [ ] 가용 메모리 부족 감지
- [ ] 게임 파일 누락 감지

### ErrorDialog
- [ ] 에러 발생 시 다이얼로그 표시
- [ ] 해결 방법 명확히 제시
- [ ] 자동 복구 버튼 작동
- [ ] 상세 정보 접기/펼치기

### CrashAnalyzer
- [ ] OutOfMemoryError 분석
- [ ] ModConflict 분석
- [ ] 자동 복구 옵션 제공
- [ ] 통계 기록

---

## 📊 예상 효과

| 지표 | 현재 | P0 구현 후 | 개선율 |
|------|------|-----------|--------|
| 게임 실행 성공률 | 70% | **90%** | +29% |
| 사용자 안내 | 10% | **80%** | +700% |
| 자동 복구 | 25% | **60%** | +140% |
| 평균 문제 해결 시간 | 30분 | **5분** | -83% |
| 지원 요청 | 많음 | **60% 감소** | -60% |

---

## 💡 핵심 포인트

### 기존 코드 최대 활용
- ✅ `error-handler.ts` - 에러 메시지 변환 (완벽)
- ✅ `retry.ts` - 재시도 로직 (완벽)
- ✅ `java-detector.ts` - Java 감지 (85%)
- ✅ ProfileSettingsTab - 메모리 자동 조정 (부분)

### 새로 구현 필요
- 🆕 `game-launch-validator.ts` - 검증 로직
- 🆕 `crash-analyzer.ts` - 크래시 분석
- 🆕 `ErrorDialog.tsx` - UI 컴포넌트
- 🆕 IPC + Context 통합

### 구현 우선순위
1. **GameLaunchValidator** (가장 큰 영향)
2. **ErrorDialog** (사용자 경험 필수)
3. **CrashAnalyzer** (크래시 대응)

---

## 🚀 다음 단계

1. **즉시 시작**: GameLaunchValidator 구현
2. **병렬 진행 가능**: ErrorDialog (독립적)
3. **마지막**: CrashAnalyzer (1, 2 완성 후)

**예상 투자**: 2주  
**예상 수익**: 사용자 만족도 **5배** 향상
