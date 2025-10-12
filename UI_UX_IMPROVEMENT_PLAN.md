# UI/UX 개선 계획서

**작성일**: 2025-01-12  
**목표**: Modrinth 앱 수준의 사용자 편의성 확보

---

## 📊 현재 상태 분석

### 발견된 문제점

#### 1. 색상 일관성 부족 🎨
**위치**: 
- `ProfileList.tsx`: Purple 계열 (`purple-500`, `pink-500`)
- `ProfileDetailPage.tsx`: Blue 계열 (`blue-100`, `blue-900`)
- 버튼: Green/Red 혼용

**문제**:
- 브랜드 아이덴티티 부족
- 사용자 혼란
- 프로페셔널하지 않은 인상

**영향도**: ⭐⭐⭐ (중간)

---

#### 2. 모드 업데이트 UX 불편 🔄
**위치**: `ModList.tsx`

**문제**:
- ❌ 업데이트 가능한 모드를 목록에서 구분 불가
- ❌ 개별 업데이트 버튼 없음 (일괄만 가능)
- ❌ 버전 비교 정보 없음 (현재 vs 최신)
- ❌ 변경사항 미리보기 없음

**현재 동작**:
```
1. "업데이트 확인" 클릭
2. alert(`${count}개 업데이트 가능`)
3. "전체 업데이트" 버튼만 표시
4. 어떤 모드가 업데이트 가능한지 모름
```

**Modrinth 방식**:
```
1. 업데이트 확인
2. 각 모드에 "업데이트 가능" 뱃지 표시
3. 버전 정보 표시 (v1.2.3 → v1.3.0)
4. 개별 업데이트 버튼
5. 변경사항 표시
```

**영향도**: ⭐⭐⭐⭐⭐ (매우 높음)

---

#### 3. 게임 시작 블로킹 ⏱️
**위치**: `ProfileList.tsx`, `ProfileDetailPage.tsx`

**문제**:
- 게임 시작 시 모달 띄우고 완료까지 UI 블록
- 다운로드 중 다른 작업 불가
- 백그라운드 다운로드 없음

**현재 흐름**:
```
1. 플레이 버튼 클릭
2. GlobalDownloadModal 표시 (블로킹)
3. 에셋/라이브러리 다운로드 (UI 블록됨)
4. 다운로드 완료 후 게임 시작
```

**Modrinth 방식**:
```
1. 플레이 버튼 클릭
2. 백그라운드에서 다운로드 시작
3. 상단에 작은 진행바 표시
4. 다운로드 중에도 다른 프로필 관리 가능
5. 다운로드 완료 시 토스트 알림
```

**영향도**: ⭐⭐⭐⭐ (높음)

---

#### 4. alert() 남용 💬
**위치**: 모든 컴포넌트

**문제**:
- 모든 성공/에러 메시지가 `alert()`
- 모던하지 않은 UX
- 페이지 블로킹

**영향도**: ⭐⭐⭐ (중간)

---

## 🎯 개선 계획 (4단계)

### ✅ Phase 1: 디자인 시스템 통일 (1-2시간)

#### 목표
통일된 색상 테마로 브랜드 아이덴티티 확립

#### 작업 내용

##### 1.1 색상 테마 정의
**파일**: `src/renderer/styles/theme.ts` (신규)

```typescript
export const theme = {
  primary: {
    50: '#faf5ff',
    100: '#f3e8ff',
    200: '#e9d5ff',
    // ... purple 계열
    500: '#a855f7',  // 메인 브랜드 색상
    600: '#9333ea',
    // ...
  },
  success: '#10b981',  // green-500
  error: '#ef4444',    // red-500
  warning: '#f59e0b',  // amber-500
  info: '#3b82f6',     // blue-500
};
```

##### 1.2 적용 대상
- [x] `ProfileList.tsx`: Purple 유지 (✅ 이미 일치)
- [ ] `ProfileDetailPage.tsx`: 탭 색상 Blue → Purple
- [ ] 모든 Primary 버튼: Purple 통일
- [ ] 상태 색상: Success(Green), Error(Red), Warning(Amber)

##### 1.3 예상 결과
- 통일된 브랜드 색상 (Purple 계열)
- 전문적인 외관
- 색상 유지보수 용이

**예상 시간**: 1-2시간  
**우선순위**: ⭐⭐⭐ (중간)

---

### ✅ Phase 2: 모드 업데이트 UX 개선 (완료!)

#### 목표
Modrinth처럼 직관적인 모드 업데이트 경험 제공

#### 구현 내용

##### 2.1 ModList UI 개선
**파일**: `src/renderer/components/mods/ModList.tsx`

**추가 기능**:
1. **업데이트 가능 뱃지**
   ```tsx
   {mod.hasUpdate && (
     <span className="px-2 py-1 bg-green-500/20 text-green-400 text-xs rounded">
       업데이트 가능
     </span>
   )}
   ```

2. **버전 정보 표시**
   ```tsx
   <div className="text-sm text-gray-400">
     v{mod.currentVersion} → v{mod.latestVersion}
   </div>
   ```

3. **개별 업데이트 버튼**
   ```tsx
   {mod.hasUpdate && (
     <button 
       onClick={() => handleUpdateSingle(mod.id)}
       className="px-3 py-1 bg-green-600 hover:bg-green-700"
     >
       업데이트
     </button>
   )}
   ```

4. **변경사항 미리보기 (옵션)**
   ```tsx
   <button onClick={() => showChangelog(mod.id)}>
     변경사항 보기
   </button>
   ```

##### 2.2 업데이트 상태 관리
**추가 State**:
```typescript
interface Mod {
  // 기존 필드...
  hasUpdate?: boolean;
  currentVersion?: string;
  latestVersion?: string;
  updateInfo?: {
    changelog?: string;
    releaseDate?: string;
  };
}
```

##### 2.3 백엔드 API 수정 (필요 시)
**파일**: `src/main/services/mod-updater.ts`

**개선**:
- 업데이트 체크 시 각 모드의 상세 정보 반환
- 현재 버전 vs 최신 버전 비교
- 변경사항 포함

**실제 시간**: 3시간  
**상태**: ✅ 완료

**구현 결과**:
- ✅ 모드 목록에 "✨ 업데이트 가능" 뱃지 추가 (animate-pulse)
- ✅ 버전 정보 표시 (v1.2.3 → v1.3.0)
- ✅ 개별 업데이트 버튼 추가 (업데이트 중 스피너 포함)
- ✅ `updateMod` IPC API 추가 (`src/main/ipc/mod.ts`)
- ✅ preload API 확장 (`src/preload/preload.ts`)
- ✅ 타입 안전성 확보 (ModUpdateInfo 인터페이스)
- ✅ 빌드 성공

**변경 파일**:
- `src/renderer/components/mods/ModList.tsx` - UI 및 핸들러
- `src/main/ipc/mod.ts` - `mod:update-single` 핸들러
- `src/preload/preload.ts` - `updateMod` API 노출

**우선순위**: ⭐⭐⭐⭐⭐ (최고)

---

### 💬 Phase 3: 토스트 알림 시스템 (2-3시간)

#### 목표
`alert()` 제거, 모던한 토스트 알림으로 대체

#### 작업 내용

##### 3.1 토스트 컴포넌트 구현
**파일**: `src/renderer/components/common/Toast.tsx` (신규)

**기능**:
- Success, Error, Warning, Info 4가지 타입
- 자동 사라짐 (3-5초)
- 닫기 버튼
- 애니메이션 (fade in/out)
- 다중 토스트 스택

**라이브러리 옵션**:
1. **직접 구현** (추천): 커스터마이징 용이
2. `react-hot-toast`: 간단한 사용
3. `sonner`: 모던한 디자인

##### 3.2 Toast Provider 설정
**파일**: `src/renderer/App.tsx`

```tsx
import { ToastProvider, useToast } from './components/common/Toast';

function App() {
  return (
    <ToastProvider>
      {/* 기존 코드 */}
    </ToastProvider>
  );
}
```

##### 3.3 적용 대상
- [ ] `ProfileList.tsx`: 삭제 성공/실패
- [ ] `ModList.tsx`: 모드 설치/삭제/업데이트
- [ ] `ProfileDetailPage.tsx`: 게임 시작/중단
- [ ] 모든 `alert()` 제거 (약 15곳)

**예상 시간**: 2-3시간  
**우선순위**: ⭐⭐⭐⭐ (높음)

---

### 🚀 Phase 4: 백그라운드 다운로드 시스템 (선택, 6-8시간)

#### 목표
게임 시작 시 백그라운드 다운로드로 UI 블록 해제

#### 작업 내용

##### 4.1 다운로드 상태 관리
**파일**: `src/renderer/store/downloadStore.ts` (수정)

**추가 기능**:
- 다중 다운로드 큐 지원
- 진행 상태 추적
- 백그라운드/포그라운드 모드

##### 4.2 UI 변경
**파일**: `src/renderer/components/common/BackgroundDownloadBar.tsx` (신규)

**디자인**:
```
┌─────────────────────────────────────────┐
│ 🔽 에셋 다운로드 중... 45% (125/280 MB) │
│ ███████████░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
└─────────────────────────────────────────┘
```

- 화면 상단 고정 (sticky)
- 최소화 가능
- 클릭 시 상세 진행 상황 표시

##### 4.3 다운로드 로직 수정
**파일**: `src/main/services/game-launcher.ts`

**개선**:
- 에셋 다운로드를 별도 프로세스로 분리
- 다운로드 완료 전 프로필 관리 가능
- 다운로드 완료 후 토스트 알림

**장점**:
- ✅ 게임 시작 대기 시간 단축 (사용자 인지)
- ✅ 다운로드 중 다른 작업 가능
- ✅ Modrinth와 동일한 UX

**단점**:
- ❌ 구현 복잡도 높음
- ❌ 시간 많이 소요
- ❌ 버그 가능성

**예상 시간**: 6-8시간  
**우선순위**: ⭐⭐ (낮음, 선택)

---

## 📅 권장 실행 순서

### 🥇 1순위: Phase 2 (모드 업데이트 UX)
**이유**: 
- 사용자가 가장 불편해하는 부분
- 즉각적인 효과
- 상대적으로 간단한 구현

**예상 시간**: 3-4시간

---

### 🥈 2순위: Phase 3 (토스트 알림)
**이유**:
- `alert()` 제거로 전체 UX 향상
- 모든 페이지에 영향
- 모던한 느낌

**예상 시간**: 2-3시간

---

### 🥉 3순위: Phase 1 (디자인 통일)
**이유**:
- 시각적 완성도
- 빠른 구현
- 브랜드 이미지

**예상 시간**: 1-2시간

---

### ⚠️ 4순위: Phase 4 (백그라운드 다운로드)
**이유**:
- 시간 많이 소요
- 복잡도 높음
- Phase 5 이후로 미룰 수 있음

**예상 시간**: 6-8시간 (선택)

---

## 🎯 최종 권장안

### Option A: 필수만 (6-9시간)
```
Phase 2 → Phase 3 → Phase 1
```
- 모드 업데이트 UX 개선 (3-4h)
- 토스트 알림 시스템 (2-3h)
- 디자인 통일 (1-2h)

**결과**: 사용자 만족도 크게 향상 ✅

---

### Option B: 완전 개선 (12-17시간)
```
Phase 2 → Phase 3 → Phase 1 → Phase 4
```
- 필수 개선 (6-9h)
- 백그라운드 다운로드 (6-8h)

**결과**: Modrinth 수준 도달 ✅✅✅

---

## 📊 예상 효과

### Before (현재)
- 업데이트할 모드를 모름
- 일괄 업데이트만 가능
- alert() 팝업 남발
- 색상 테마 혼란
- 게임 시작 시 UI 블록

### After (개선 후)
- ✅ 업데이트 가능한 모드 한눈에 파악
- ✅ 개별/일괄 업데이트 선택 가능
- ✅ 우아한 토스트 알림
- ✅ 통일된 브랜드 색상
- ✅ (Option B) 백그라운드 다운로드

---

## 🚀 시작 제안

**즉시 시작할 단계**: **Phase 2 (모드 업데이트 UX)**

**이유**:
1. 사용자가 가장 불편해하는 부분
2. 즉각적인 효과
3. 3-4시간이면 완료
4. 다른 Phase에 영향 없음

**준비가 되시면 말씀해주세요!** 🎉
