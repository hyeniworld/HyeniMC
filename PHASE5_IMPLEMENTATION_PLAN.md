# 5단계 구현 계획 및 실행 가이드

## 📋 목차
1. [요약](#요약)
2. [즉시 실행 가능한 작업](#즉시-실행-가능한-작업)
3. [3주 로드맵](#3주-로드맵)
4. [필요한 리소스](#필요한-리소스)
5. [성공 기준](#성공-기준)

---

## 요약

### 완료된 설계 문서
✅ **[PHASE5_OVERVIEW.md](./PHASE5_OVERVIEW.md)** - 전체 개요 및 우선순위  
✅ **[PHASE5_THEME_DESIGN.md](./PHASE5_THEME_DESIGN.md)** - 일러스트 배치 및 테마 시스템  
✅ **[PHASE5_AUTH_INTEGRATION.md](./PHASE5_AUTH_INTEGRATION.md)** - 혜니헬퍼 인증 연동  
✅ **[PHASE5_PROFILE_IMPROVEMENTS.md](./PHASE5_PROFILE_IMPROVEMENTS.md)** - 정렬/즐겨찾기  
✅ **[PHASE5_MOD_UPDATE.md](./PHASE5_MOD_UPDATE.md)** - 전용 모드 업데이트  

### 핵심 기능 요약

| 기능 | 우선순위 | 시간 | 외부 의존성 |
|------|----------|------|------------|
| 1. 일러스트 고정 배치 | ⭐⭐⭐⭐⭐ | 2일 | 애셋 필요 |
| 2. 혜니헬퍼 인증 | ⭐⭐⭐⭐⭐ | 3일 | Discord 봇 |
| 3. 프로필 정렬/즐겨찾기 | ⭐⭐⭐⭐ | 1일 | 없음 |
| 4. 테마 시스템 | ⭐⭐⭐ | 5일 | 추가 애셋 |
| 5. 전용 모드 업데이트 | ⭐⭐⭐ | 1주 | 배포 서버 |

---

## 즉시 실행 가능한 작업

### Day 1: 프로필 정렬/즐겨찾기 (가장 빠름)

#### 체크리스트
```bash
# 백엔드
[ ] backend/internal/db/migrations.go
    - migration_15: favorite, server_address 필드 추가
[ ] backend/internal/domain/profile.go
    - Favorite bool 필드 추가
    - ServerAddress string 필드 추가
[ ] proto/launcher/profile.proto
    - favorite, server_address 필드 추가
[ ] npm run proto:gen

# 프론트엔드
[ ] src/shared/types/profile.ts
    - favorite, serverAddress 필드 추가
[ ] src/main/ipc/profile.ts
    - toggleFavorite 핸들러 추가
[ ] src/preload/preload.ts
    - toggleFavorite API 노출
[ ] src/renderer/utils/profileSorter.ts (새 파일)
    - sortProfiles 함수 구현
[ ] src/renderer/components/profiles/ProfileCard.tsx
    - 즐겨찾기 버튼 추가 (Star 아이콘)
    - 즐겨찾기 뱃지 추가
[ ] src/renderer/components/profiles/ProfileList.tsx
    - sortProfiles 적용

# 테스트
[ ] 빌드 테스트
[ ] 즐겨찾기 토글 테스트
[ ] 정렬 순서 확인
```

#### 코드 시작점

1. **DB 마이그레이션**
```go
// backend/internal/db/migrations.go
func migration_15_add_favorite_and_server_address() migrationFunc {
	return func(db *sql.DB) error {
		_, err := db.Exec(`
			ALTER TABLE profiles ADD COLUMN favorite BOOLEAN DEFAULT 0;
			ALTER TABLE profiles ADD COLUMN server_address TEXT;
			CREATE INDEX idx_profiles_favorite ON profiles(favorite);
		`)
		return err
	}
}

// migrations 슬라이스에 추가
var migrations = []migrationFunc{
	// ... 기존 마이그레이션들
	migration_15_add_favorite_and_server_address,
}
```

2. **정렬 유틸리티**
```typescript
// src/renderer/utils/profileSorter.ts
export function sortProfiles(profiles: Profile[]): Profile[] {
  return profiles.sort((a, b) => {
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
    
    const aPlayed = a.lastPlayed ? new Date(a.lastPlayed).getTime() : 0;
    const bPlayed = b.lastPlayed ? new Date(b.lastPlayed).getTime() : 0;
    
    if (aPlayed !== bPlayed) return bPlayed - aPlayed;
    
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}
```

---

### Day 2-3: 강혜니 일러스트 배치

#### 사전 준비: 애셋 수집
```
필요한 파일:
1. character-main.png (300x400px, 투명 배경)
   - 전신 또는 상반신
   - 귀여운 포즈
   - PNG, 투명 배경 필수

2. deco-sparkles.png (200x200px, 투명 배경)
   - 반짝임, 별, 하트 등
   - 심플한 디자인
```

#### 체크리스트
```bash
# 준비
[ ] public/assets/hyeni/ 디렉토리 생성
[ ] 애셋 파일 복사
[ ] 이미지 최적화 (TinyPNG 등)

# 구현
[ ] src/renderer/components/common/HyeniDecorations.tsx (새 파일)
[ ] src/renderer/index.css - 애니메이션 추가
[ ] src/renderer/App.tsx - HyeniDecorations 통합
[ ] 반응형 크기 조정 테스트

# 조정
[ ] 위치 미세 조정
[ ] 투명도 조정 (opacity: 0.7~0.9)
[ ] 애니메이션 속도 조정
[ ] 다양한 해상도 테스트 (1280, 1600, 1920, 2560)
```

#### 빠른 시작 코드

```typescript
// src/renderer/components/common/HyeniDecorations.tsx
import { useState, useEffect } from 'react';

export function HyeniDecorations() {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const handleResize = () => {
      const width = window.innerWidth;
      if (width < 1280) setScale(0.6);
      else if (width < 1600) setScale(0.8);
      else setScale(1);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
      <div 
        className="absolute bottom-0 left-0 transition-transform"
        style={{ width: `${300 * scale}px`, height: `${400 * scale}px` }}
      >
        <img 
          src="/assets/hyeni/character-main.png" 
          alt="Hyeni"
          className="w-full h-full object-contain animate-float opacity-90"
        />
      </div>
      
      <div 
        className="absolute top-20 right-10 transition-transform"
        style={{ width: `${200 * scale}px`, height: `${200 * scale}px` }}
      >
        <img 
          src="/assets/hyeni/deco-sparkles.png" 
          alt="Decoration"
          className="w-full h-full object-contain animate-pulse opacity-70"
        />
      </div>
    </div>
  );
}
```

```typescript
// src/renderer/App.tsx
import { HyeniDecorations } from './components/common/HyeniDecorations';

function App() {
  return (
    <>
      <HyeniDecorations />
      <div className="relative z-10">
        {/* 기존 컨텐츠 */}
      </div>
    </>
  );
}
```

```css
/* src/renderer/index.css */
@keyframes float {
  0%, 100% { transform: translateY(0px); }
  50% { transform: translateY(-20px); }
}

.animate-float {
  animation: float 6s ease-in-out infinite;
}
```

---

### Day 4-6: 혜니헬퍼 인증 연동

#### 사전 준비: Discord 봇 (선택)
- 봇이 없어도 런처 기능은 구현 가능
- 테스트는 브라우저나 HTML 파일로 가능

#### 체크리스트
```bash
# Day 4: Protocol 등록
[ ] src/main/protocol/register.ts
[ ] src/main/protocol/register-windows.ts
[ ] src/main/protocol/register-macos.ts
[ ] src/main/main.ts - registerCustomProtocol() 호출
[ ] package.json - macOS CFBundleURLTypes 추가
[ ] 개발 모드 테스트

# Day 5: Handler 구현
[ ] src/main/protocol/handler.ts
    - setupProtocolHandler()
    - handleProtocolUrl()
    - handleAuthRequest()
    - findProfilesByServer()
    - writeHyeniHelperConfig()
[ ] src/main/main.ts - setupProtocolHandler() 호출

# Day 6: UI 및 테스트
[ ] src/renderer/App.tsx - IPC 이벤트 리스너
[ ] src/renderer/components/profiles/ProfileSettingsTab.tsx
    - serverAddress 입력 필드
[ ] 토스트 알림 통합
[ ] 통합 테스트
[ ] Windows 빌드 테스트
[ ] macOS 빌드 테스트
```

#### 빠른 테스트 방법

```html
<!-- test-auth.html -->
<!DOCTYPE html>
<html>
<head>
  <title>HyeniMC Auth Test</title>
</head>
<body>
  <h1>HyeniMC 인증 테스트</h1>
  <p>런처를 실행한 상태에서 아래 링크를 클릭하세요:</p>
  <a href="hyenimc://auth?token=test-token-12345&server=play.hyeniworld.com">
    혜니월드 인증하기
  </a>
</body>
</html>
```

---

## 3주 로드맵

### Week 1: 긴급 기능 (필수)

#### Day 1 (Mon): 프로필 정렬/즐겨찾기 ✅
- 오전: DB 마이그레이션, 백엔드 구현
- 오후: 프론트엔드 UI, 테스트
- **결과**: 즐겨찾기 및 스마트 정렬 작동

#### Day 2-3 (Tue-Wed): 일러스트 배치 ✅
- Day 2 오전: 애셋 준비 및 최적화
- Day 2 오후: HyeniDecorations 컴포넌트
- Day 3: 반응형 조정, 다양한 해상도 테스트
- **결과**: 강혜니 일러스트 2~3개 배치

#### Day 4-6 (Thu-Sat): 혜니헬퍼 인증 ✅
- Day 4: Custom URL Protocol 등록
- Day 5: Protocol Handler 구현
- Day 6: UI, 테스트, 빌드
- **결과**: Discord 링크로 인증 자동 설정

### Week 2: 테마 시스템 (선택)

#### Day 7-9: 테마 인프라
- ThemeContext 구현
- 테마 JSON 로더
- CSS 변수 시스템

#### Day 10-11: 테마 UI
- 설정 페이지 테마 탭
- 테마 프리셋 3종
- 랜덤 선택 옵션

### Week 3: 외부 인프라 (장기)

#### 전용 모드 업데이트 시스템
- 배포 서버 구축 (GitHub + Cloudflare Pages)
- CustomModUpdater 서비스
- UI 통합

---

## 필요한 리소스

### 1. 애셋 (긴급)

#### 최소 요구사항
```
public/assets/hyeni/
├── character-main.png    (300x400px, 투명 배경)
└── deco-sparkles.png     (200x200px, 투명 배경)
```

#### 제작 가이드
- **포맷**: PNG
- **해상도**: 300dpi 이상
- **배경**: 완전 투명
- **스타일**: 귀엽고 밝은 톤
- **색상**: 보라/핑크 계열 권장
- **파일 크기**: 각 500KB 이하 (최적화)

#### 소스
1. 직접 커미션
2. 기존 일러스트 편집
3. 임시: 무료 일러스트 사이트 (상업 이용 가능)

### 2. Discord 봇 (선택)

#### 최소 구현
```python
@bot.command(name='hyeni-auth')
async def hyeni_auth(ctx):
    token = str(uuid.uuid4())
    link = f"hyenimc://auth?token={token}&server=play.hyeniworld.com"
    await ctx.author.send(f"인증 링크: {link}")
```

### 3. 배포 서버 (장기)

#### Option 1: 정적 호스팅 (권장)
- **플랫폼**: Cloudflare Pages (무료)
- **저장소**: GitHub
- **비용**: $0/month
- **시간**: 1시간 설정

#### Option 2: 동적 백엔드
- **플랫폼**: Cloudflare Workers / Railway / Fly.io
- **DB**: PostgreSQL
- **비용**: ~$5-10/month
- **시간**: 1주

---

## 성공 기준

### Week 1 완료 시

#### ✅ 기능 체크리스트
- [ ] 프로필 목록이 즐겨찾기 → 플레이 순 → 생성 순으로 정렬됨
- [ ] 별표 아이콘으로 즐겨찾기 토글 가능
- [ ] 런처 실행 시 강혜니 일러스트 2~3개 표시
- [ ] 일러스트가 컨텐츠와 겹치지 않음
- [ ] 부드러운 애니메이션 (float, pulse)
- [ ] 다양한 해상도에서 반응형 작동 (1280~2560px)
- [ ] 브라우저에서 `hyenimc://auth?...` 링크 클릭 시 런처 실행
- [ ] 프로필 설정에 서버 주소 입력 가능
- [ ] 인증 성공/실패 토스트 알림 표시

#### 📊 품질 기준
- 빌드 성공 (Windows + macOS)
- 메모리 누수 없음
- 콘솔 에러 없음
- UI 버그 없음 (깜빡임, 레이아웃 깨짐 등)

### Week 2 완료 시 (선택)
- [ ] 테마 선택 UI 작동
- [ ] 3~5종 테마 프리셋 제공
- [ ] 런처 재시작 시 선택한 테마 유지
- [ ] 랜덤 테마 옵션 작동

### Week 3 완료 시 (장기)
- [ ] 배포 서버 작동 (manifest.json 접근 가능)
- [ ] 게임 실행 전 업데이트 체크
- [ ] 업데이트 다이얼로그 표시
- [ ] 모드 자동 업데이트 및 백업/롤백

---

## 위험 요소 및 대응

### 1. 애셋 부족
**위험**: 일러스트가 준비되지 않으면 구현 불가  
**대응**: 
- 임시 플레이스홀더 사용 (무료 일러스트)
- 텍스트 기반 대체 디자인
- 커뮤니티 공모

### 2. Custom URL Protocol 작동 안 함
**위험**: OS별 권한 문제, Gatekeeper (macOS)  
**대응**:
- 개발자 서명 (macOS)
- 사용자 가이드 문서 제공
- Fallback: 수동 config 파일 생성

### 3. 배포 서버 지연
**위험**: 외부 인프라 구축 시간 초과  
**대응**:
- Phase 1~3 먼저 완료
- 정적 호스팅으로 시작 (빠름)
- 동적 백엔드는 나중에 추가

---

## 다음 단계

### 즉시 시작
1. ✅ 설계 문서 검토 완료
2. **애셋 준비 시작** (일러스트 요청/제작)
3. **Day 1 작업 시작** (프로필 정렬/즐겨찾기)

### 질문 사항
- 애셋 제작 방법 결정 (커미션 vs 기존 사용)
- Discord 봇 구현 여부
- 배포 서버 우선순위

### 진행 방식
- **긴급 기능 우선**: Day 1-6 집중
- **선택 기능은 여유 시**: Week 2-3
- **점진적 배포**: 기능별로 머지 및 테스트

---

**작성일**: 2025-10-12  
**다음 액션**: 애셋 준비 + Day 1 구현 시작  
**예상 완료**: Week 1 (6일), Week 2 (선택), Week 3 (장기)
