# 강혜니 일러스트 배치 및 테마 시스템

## 📋 목차
1. [Phase 1: 기본 디자인 (즉시 구현)](#phase-1-기본-디자인-즉시-구현)
2. [Phase 2: 테마 시스템 (추후 구현)](#phase-2-테마-시스템-추후-구현)
3. [필요 애셋](#필요-애셋)
4. [구현 체크리스트](#구현-체크리스트)

---

## Phase 1: 기본 디자인 (즉시 구현)

### 목표
테마 시스템 없이도 강혜니 일러스트를 배치하여 브랜드 아이덴티티 확립

### 화면 레이아웃

```
┌─────────────────────────────────────────────────────────────┐
│  [로고]              HyeniMC                    [계정]       │  ← 헤더
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  [캐릭터]                                       [데코]        │  ← 데코레이션
│   ↑                                                ↑          │     (fixed)
│  왼쪽 하단                                      우측 상단      │
│  (300x400)                                    (200x200)      │
│                                                               │
│              ┌──────────┐  ┌──────────┐                      │
│              │ 프로필1   │  │ 프로필2   │                      │  ← 컨텐츠
│              │  [🎮]    │  │  [⚔️]    │                      │
│              └──────────┘  └──────────┘                      │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### 구현 코드

#### 1. 데코레이션 컴포넌트

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
      {/* 왼쪽 하단: 메인 캐릭터 */}
      <div 
        className="absolute bottom-0 left-0 transition-transform duration-300"
        style={{
          width: `${300 * scale}px`,
          height: `${400 * scale}px`,
        }}
      >
        <img 
          src="/assets/hyeni/character-main.png" 
          alt="Hyeni Character"
          className="w-full h-full object-contain animate-float opacity-90"
        />
      </div>

      {/* 우측 상단: 반짝임/작은 캐릭터 */}
      <div 
        className="absolute top-20 right-10 transition-transform duration-300"
        style={{
          width: `${200 * scale}px`,
          height: `${200 * scale}px`,
        }}
      >
        <img 
          src="/assets/hyeni/deco-sparkles.png" 
          alt="Decoration"
          className="w-full h-full object-contain animate-pulse opacity-70"
        />
      </div>

      {/* 선택: 그라데이션 오버레이 */}
      <div className="absolute inset-0 bg-gradient-to-br from-purple-900/10 via-transparent to-pink-900/10" />
    </div>
  );
}
```

#### 2. App.tsx 통합

```typescript
// src/renderer/App.tsx
import { HyeniDecorations } from './components/common/HyeniDecorations';

function App() {
  return (
    <>
      {/* 데코레이션 레이어 (최하단) */}
      <HyeniDecorations />
      
      {/* 기존 컨텐츠 (상단) */}
      <div className="relative z-10">
        <Router>
          {/* 기존 라우터 내용 */}
        </Router>
      </div>
    </>
  );
}
```

#### 3. CSS 애니메이션

```css
/* src/renderer/index.css 에 추가 */

@keyframes float {
  0%, 100% {
    transform: translateY(0px);
  }
  50% {
    transform: translateY(-20px);
  }
}

.animate-float {
  animation: float 6s ease-in-out infinite;
}

/* 선택: 더 부드러운 페이드 인 */
@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.animate-fadeIn {
  animation: fadeIn 1s ease-out;
}
```

### 디자인 가이드라인

#### 촌스럽지 않게 하려면:
1. **투명도 조절**: opacity 0.7~0.9 사용하여 배경과 자연스럽게 blend
2. **크기 제한**: 화면의 1/4 이하 차지
3. **위치**: 컨텐츠와 겹치지 않도록 구석 배치
4. **애니메이션**: 부드럽고 느린 애니메이션 (6초 주기)
5. **색상**: 메인 컬러와 조화로운 톤 (보라/핑크 계열)

#### 강혜니를 부각시키려면:
1. **메인 캐릭터**: 왼쪽 하단에 크게 배치 (시선 유도)
2. **고품질 이미지**: 최소 300dpi, 투명 배경 PNG
3. **조명 효과**: 필요 시 glow 효과 추가
4. **브랜드 컬러**: 보라색 그라데이션 오버레이

---

## Phase 2: 테마 시스템 (추후 구현)

### 테마 구조

```typescript
// src/shared/types/theme.ts
export interface Theme {
  id: string;
  name: string;
  author: string;
  version: string;
  description: string;
  
  colors: ThemeColors;
  decorations: ThemeDecoration[];
  randomOnStartup?: boolean;
}

export interface ThemeColors {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
  text: {
    primary: string;
    secondary: string;
  };
}

export interface ThemeDecoration {
  id: string;
  image: string;
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
  width: number;
  height: number;
  opacity: number;
  animation?: 'float' | 'pulse' | 'bounce' | 'none';
  offset: { x: number; y: number };
  zIndex?: number;
}
```

### 테마 프리셋 예시

```json
// public/themes/hyeni-official.json
{
  "id": "hyeni-official",
  "name": "강혜니 공식",
  "author": "HyeniMC Team",
  "version": "1.0.0",
  "description": "강혜니 스트리머 공식 테마",
  "colors": {
    "primary": "#C77DFF",
    "secondary": "#E0AAFF",
    "accent": "#FF6B9D",
    "background": "#1A0B2E",
    "surface": "#251451",
    "text": {
      "primary": "#FFFFFF",
      "secondary": "#C8B6E2"
    }
  },
  "decorations": [
    {
      "id": "main-character",
      "image": "/assets/hyeni/character-main.png",
      "position": "bottom-left",
      "width": 300,
      "height": 400,
      "opacity": 0.9,
      "animation": "float",
      "offset": { "x": 0, "y": 0 }
    },
    {
      "id": "sparkles",
      "image": "/assets/hyeni/deco-sparkles.png",
      "position": "top-right",
      "width": 200,
      "height": 200,
      "opacity": 0.7,
      "animation": "pulse",
      "offset": { "x": -50, "y": 80 }
    }
  ]
}
```

### ThemeContext 구현

```typescript
// src/renderer/contexts/ThemeContext.tsx
import React, { createContext, useContext, useState, useEffect } from 'react';

interface ThemeContextType {
  currentTheme: Theme;
  setTheme: (theme: Theme) => void;
  availableThemes: Theme[];
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [currentTheme, setCurrentTheme] = useState<Theme>(defaultTheme);
  const [availableThemes, setAvailableThemes] = useState<Theme[]>([]);

  useEffect(() => {
    loadThemes();
    
    const savedThemeId = localStorage.getItem('selectedTheme');
    const randomEnabled = localStorage.getItem('themeRandomOnStartup') === 'true';

    if (randomEnabled && availableThemes.length > 0) {
      const randomTheme = availableThemes[Math.floor(Math.random() * availableThemes.length)];
      applyTheme(randomTheme);
    } else if (savedThemeId) {
      const theme = availableThemes.find(t => t.id === savedThemeId);
      if (theme) applyTheme(theme);
    }
  }, []);

  const applyTheme = (theme: Theme) => {
    const root = document.documentElement;
    
    // CSS 변수 적용
    root.style.setProperty('--color-primary', theme.colors.primary);
    root.style.setProperty('--color-secondary', theme.colors.secondary);
    root.style.setProperty('--color-accent', theme.colors.accent);
    root.style.setProperty('--color-background', theme.colors.background);
    root.style.setProperty('--color-surface', theme.colors.surface);
    
    setCurrentTheme(theme);
    localStorage.setItem('selectedTheme', theme.id);
  };

  const loadThemes = async () => {
    // 테마 파일 로드
    const themes = await window.electronAPI.theme.listThemes();
    setAvailableThemes(themes);
  };

  return (
    <ThemeContext.Provider value={{ currentTheme, setTheme: applyTheme, availableThemes }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within ThemeProvider');
  return context;
};
```

### 테마 선택 UI

```typescript
// src/renderer/pages/SettingsPage.tsx (테마 탭)
function ThemeSettings() {
  const { currentTheme, setTheme, availableThemes } = useTheme();
  const [randomOnStartup, setRandomOnStartup] = useState(
    localStorage.getItem('themeRandomOnStartup') === 'true'
  );

  return (
    <div className="space-y-6 p-6">
      <h2 className="text-2xl font-bold">테마 설정</h2>
      
      {/* 테마 그리드 */}
      <div className="grid grid-cols-3 gap-4">
        {availableThemes.map(theme => (
          <button
            key={theme.id}
            onClick={() => setTheme(theme)}
            className={cn(
              "p-4 rounded-lg border-2 transition-all hover:scale-105",
              currentTheme.id === theme.id 
                ? "border-primary bg-primary/10 shadow-lg" 
                : "border-gray-700 hover:border-gray-500"
            )}
          >
            {/* 미리보기 */}
            <div className="aspect-video bg-gray-800 rounded mb-3 relative overflow-hidden">
              {theme.decorations[0] && (
                <img 
                  src={theme.decorations[0].image} 
                  alt={theme.name}
                  className="w-full h-full object-cover opacity-50"
                />
              )}
              <div 
                className="absolute inset-0" 
                style={{ backgroundColor: theme.colors.background }}
              />
            </div>
            
            {/* 테마 정보 */}
            <div className="text-left">
              <div className="font-semibold">{theme.name}</div>
              <div className="text-xs text-gray-400">{theme.author}</div>
            </div>
          </button>
        ))}
      </div>

      {/* 옵션 */}
      <div className="flex items-center gap-3 pt-4 border-t border-gray-700">
        <input
          type="checkbox"
          checked={randomOnStartup}
          onChange={(e) => {
            setRandomOnStartup(e.target.checked);
            localStorage.setItem('themeRandomOnStartup', String(e.target.checked));
          }}
          className="w-4 h-4 rounded"
        />
        <label className="text-sm">런처 시작 시 랜덤 테마 적용</label>
      </div>
    </div>
  );
}
```

---

## 필요 애셋

### 기본 구현 (Phase 1)

#### 필수 애셋
| 파일명 | 크기 | 설명 | 위치 |
|--------|------|------|------|
| `character-main.png` | 300x400px | 메인 캐릭터 일러스트 | `public/assets/hyeni/` |
| `deco-sparkles.png` | 200x200px | 반짝임/장식 효과 | `public/assets/hyeni/` |

#### 권장 사양
- **포맷**: PNG (투명 배경)
- **해상도**: 최소 300dpi
- **색상**: RGB, 8-bit
- **용량**: 각 파일 500KB 이하 (최적화)

#### 디자인 방향
1. **메인 캐릭터**: 전신 또는 상반신, 귀여운 포즈
2. **데코레이션**: 별, 하트, 반짝임 등 심플한 요소

### 테마 시스템 (Phase 2)

추가로 2~3종의 테마를 위한 애셋:
- `character-cute.png` (귀여운 버전)
- `character-cool.png` (멋진 버전)
- 각 테마별 추가 데코레이션

---

## 구현 체크리스트

### Phase 1: 기본 디자인 (2일)

#### Day 1: 컴포넌트 구현
- [ ] `src/renderer/components/common/HyeniDecorations.tsx` 생성
- [ ] 반응형 크기 조정 로직 구현
- [ ] CSS 애니메이션 추가 (`index.css`)
- [ ] `App.tsx`에 통합
- [ ] 빌드 테스트

#### Day 2: 애셋 통합 및 조정
- [ ] 애셋 파일 준비 (`public/assets/hyeni/`)
- [ ] 이미지 경로 설정
- [ ] 위치/크기/투명도 조정
- [ ] 다양한 화면 크기에서 테스트
- [ ] 최종 디자인 검토

### Phase 2: 테마 시스템 (5일)

#### Day 1-2: 인프라
- [ ] `src/shared/types/theme.ts` 타입 정의
- [ ] `ThemeContext` 구현
- [ ] 테마 JSON 로더 (IPC)
- [ ] CSS 변수 시스템 구현

#### Day 3: 테마 프리셋
- [ ] 테마 JSON 3종 작성
- [ ] 추가 애셋 준비
- [ ] 테마 적용 테스트

#### Day 4-5: UI
- [ ] 설정 페이지에 테마 탭 추가
- [ ] 테마 선택 그리드
- [ ] 랜덤 선택 옵션
- [ ] 테마 전환 애니메이션

---

**작성일**: 2025-10-12  
**우선순위**: ⭐⭐⭐⭐⭐ (긴급 - Phase 1) / ⭐⭐⭐ (단기 - Phase 2)
