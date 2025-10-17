# 다운로드 에러 처리 개선 계획

> **작성일**: 2025-10-17  
> **우선순위**: 🔴 높음

---

## 📋 현재 문제

### 1. 에러 처리 불일치
- ✅ 모드 업데이트 에러: 확인 버튼으로 닫기 가능 (방금 수정)
- ❌ Java 에러, 다운로드 실패, 디스크 부족 등: 모달 멈춤

### 2. 발생 가능한 에러들
| 에러 유형 | 발생 위치 | 현재 상태 | 우선순위 |
|----------|---------|----------|---------|
| 모드 인증 필요 | WorkerModUpdater | ✅ 처리됨 | - |
| Java 미설치 | Java 감지 | ❌ 멈춤 | 🔴 P0 |
| 다운로드 실패 | VersionManager | ❌ 멈춤 | 🔴 P0 |
| 네트워크 끊김 | 다운로드 중 | ❌ 멈춤 | 🔴 P0 |
| 디스크 부족 | 파일 쓰기 | ❌ 멈춤 | 🟡 P1 |
| 로더 설치 실패 | LoaderManager | ❌ 멈춤 | 🟡 P1 |
| 권한 문제 | 파일 접근 | ❌ 멈춤 | 🟡 P1 |

---

## 🎯 해결 방안

### 개념
1. **모든 에러에 대해 모달 닫기 가능**
2. **에러별 적절한 안내 메시지**
3. **실행 가능한 액션 제공** (재시도/취소/설정 등)

### 구현 접근
```
에러 발생
  ↓
에러 분석 (ErrorHandler)
  ↓
사용자 친화적 메시지 생성
  ↓
다운로드 모달에 표시
  ↓
사용자 액션 (재시도/취소/설정)
```

---

## 🛠️ 구현 계획 (3단계)

### Step 1: 에러 타입 및 핸들러 (2일)

**파일 1**: `src/shared/types/errors.ts`
```typescript
export interface UserFriendlyError {
  title: string;              // "Java를 찾을 수 없습니다"
  message: string;            // 상세 메시지
  suggestions: string[];      // 해결 방법 리스트
  actions: ErrorAction[];     // 버튼들
  canClose: boolean;          // 닫기 가능 여부
  autoRetryIn?: number;       // 자동 재시도 (초)
}

export interface ErrorAction {
  label: string;              // 버튼 텍스트
  type: 'retry' | 'cancel' | 'external' | 'configure';
  isPrimary?: boolean;
  externalUrl?: string;
}
```

**파일 2**: `src/main/services/error-handler.ts`
```typescript
export class ErrorHandlerService {
  toUserFriendlyError(error: Error, context: string): UserFriendlyError {
    const msg = error.message.toLowerCase();
    
    // Java 에러
    if (msg.includes('java')) {
      return {
        title: 'Java를 찾을 수 없습니다',
        message: 'Java 17 이상이 필요합니다.',
        suggestions: ['Java를 설치하세요', '재시작하세요'],
        actions: [
          { label: 'Java 다운로드', type: 'external', 
            externalUrl: 'https://adoptium.net/...' },
          { label: '취소', type: 'cancel' }
        ],
        canClose: true
      };
    }
    
    // 네트워크 에러
    if (msg.includes('network') || msg.includes('econnrefused')) {
      return {
        title: '네트워크 오류',
        message: '인터넷 연결을 확인하세요.',
        suggestions: ['네트워크 확인', '방화벽 확인'],
        actions: [
          { label: '재시도', type: 'retry', isPrimary: true },
          { label: '취소', type: 'cancel' }
        ],
        canClose: true,
        autoRetryIn: 5  // 5초 후 자동 재시도
      };
    }
    
    // ... 다른 에러들
  }
}
```

---

### Step 2: 다운로드 모달 확장 (1일)

**수정**: `src/renderer/components/DownloadModal.tsx`

주요 변경사항:
1. `structuredError` prop 추가
2. 에러 UI 개선 (제목, 메시지, 제안, 액션 버튼)
3. 자동 재시도 카운트다운

```typescript
{structuredError && (
  <div>
    {/* 에러 아이콘 */}
    <div className="error-icon">⚠️</div>
    
    {/* 메시지 */}
    <div className="error-message">{structuredError.message}</div>
    
    {/* 제안 사항 */}
    <ul className="suggestions">
      {structuredError.suggestions.map(s => <li>• {s}</li>)}
    </ul>
    
    {/* 액션 버튼들 */}
    <div className="actions">
      {structuredError.actions.map(action => (
        <button onClick={() => handleAction(action)}>
          {action.label}
        </button>
      ))}
    </div>
    
    {/* 자동 재시도 */}
    {structuredError.autoRetryIn && (
      <p>{structuredError.autoRetryIn}초 후 재시도...</p>
    )}
  </div>
)}
```

---

### Step 3: IPC 핸들러 통합 (2일)

**수정**: `src/main/ipc/profile.ts`

```typescript
import { errorHandler } from '../services/error-handler';

ipcMain.handle(IPC_CHANNELS.PROFILE_LAUNCH, async (event, id) => {
  try {
    // ... 기존 로직 ...
  } catch (error) {
    console.error('[IPC Profile] Launch failed:', error);
    
    // 사용자 친화적 에러로 변환
    const userError = errorHandler.toUserFriendlyError(
      error as Error,
      'game-launch'
    );
    
    // UI로 전송
    window.webContents.send('launch:error', userError);
    
    throw error;
  }
});
```

**수정**: `src/renderer/pages/ProfileDetailPage.tsx`

```typescript
useEffect(() => {
  // 구조화된 에러 수신
  const cleanup = window.electronAPI.on('launch:error', (error) => {
    setIsLaunching(false);
    setDl({ structuredError: error });
  });
  
  return () => cleanup();
}, []);
```

---

## 📋 작업 리스트

### Week 1: Core Implementation
- [ ] Day 1-2: 에러 타입 및 핸들러 작성
  - [ ] `errors.ts` 타입 정의
  - [ ] `error-handler.ts` 서비스 구현
  - [ ] 5가지 주요 에러 패턴 구현

- [ ] Day 3: 다운로드 모달 확장
  - [ ] `DownloadModal.tsx` 수정
  - [ ] 구조화된 에러 UI 구현
  - [ ] 액션 핸들러 구현

- [ ] Day 4-5: IPC 통합 및 테스트
  - [ ] `profile.ts` 에러 처리 개선
  - [ ] 각 에러 시나리오 테스트
  - [ ] UI/UX 검증

---

## 🎯 핵심 에러 패턴 5가지

### 1. Java 에러
```
제목: "Java를 찾을 수 없습니다"
메시지: "Java 17 이상이 필요합니다"
액션: [Java 다운로드] [설정] [취소]
```

### 2. 네트워크 에러
```
제목: "네트워크 연결 오류"
메시지: "인터넷 연결을 확인하세요"
액션: [재시도 (5초)] [취소]
자동 재시도: 5초
```

### 3. 디스크 부족
```
제목: "디스크 공간 부족"
메시지: "최소 10GB가 필요합니다"
액션: [디스크 정리] [취소]
```

### 4. 권한 문제
```
제목: "권한 오류"
메시지: "파일에 접근할 수 없습니다"
액션: [관리자로 재시작] [취소]
```

### 5. 다운로드 실패
```
제목: "다운로드 실패"
메시지: "파일을 다운로드할 수 없습니다"
액션: [재시도] [취소]
자동 재시도: 3초
```

---

## 📊 예상 효과

| 지표 | 현재 | 개선 후 |
|-----|------|---------|
| 에러 발생 시 모달 상태 | 멈춤 | 닫기 가능 |
| 에러 메시지 명확성 | 낮음 | 높음 |
| 자동 복구 | 없음 | 네트워크 등 |
| 사용자 액션 제공 | 없음 | 있음 |
| 사용자 만족도 | 낮음 | 높음 |

---

## 💡 추가 고려사항

### Phase 2 (선택, +1주)
- 에러 로깅 시스템
- 에러 통계 및 리포트
- 에러 자동 복구 고도화
- 에러 패턴 분석

### 참고 문서
- `CRITICAL_FAILURE_SCENARIOS.md`: 런처 특화 장애 분석
- `ERROR_RECOVERY_PLAN.md`: 시스템 장애 복구 전략
- `SYSTEM_STABILITY_INDEX.md`: 전체 안정성 가이드
