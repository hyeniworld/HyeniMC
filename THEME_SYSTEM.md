# HyeniMC 테마 시스템 설계

## 📋 목차
1. [개요](#개요)
2. [테마 구조](#테마-구조)
3. [구현 방법](#구현-방법)
4. [강혜니 공식 테마](#강혜니-공식-테마)
5. [테마 편집기](#테마-편집기)
6. [단계별 구현 계획](#단계별-구현-계획)

---

## 개요

### 목표
강혜니 스트리머의 브랜드 이미지를 반영한 아름다운 런처를 만들기 위한 포괄적인 테마 시스템

### 핵심 기능
- ✅ **간단한 색상 커스터마이징**: 3분 안에 개인화
- ✅ **배경 이미지 설정**: 좋아하는 일러스트를 배경으로
- ✅ **데코레이션 배치**: 캐릭터 이미지를 원하는 위치에
- ✅ **공식 테마**: 강혜니 테마 기본 제공
- ✅ **테마 공유**: 커뮤니티와 테마 교환

---

## 테마 구조

### 기본 테마 JSON

```json
{
  "id": "hyeni-official",
  "name": "혜니 공식 테마",
  "author": "HyeniMC Team",
  "version": "1.0.0",
  "description": "강혜니 스트리머 공식 테마",
  
  "colors": {
    "primary": "#C77DFF",        // 보라색
    "secondary": "#E0AAFF",      // 연보라
    "accent": "#FF6B9D",         // 핑크
    "background": "#1A0B2E",     // 다크 보라
    "surface": "#251451",        // 카드 배경
    "text": {
      "primary": "#FFFFFF",
      "secondary": "#C8B6E2"
    },
    "success": "#4ADE80",
    "warning": "#FBBF24",
    "error": "#EF4444"
  },
  
  "images": {
    "background": "themes/hyeni-official/bg.png",
    "logo": "themes/hyeni-official/logo.png",
    "profileCardBackground": "themes/hyeni-official/card-bg.png",
    
    "decorations": [
      {
        "id": "main-character-left",
        "image": "themes/hyeni-official/character-left.png",
        "position": "top-left",
        "width": 300,
        "height": 400,
        "opacity": 0.9,
        "animation": "float",
        "offset": {
          "x": 20,
          "y": 100
        }
      },
      {
        "id": "sparkles",
        "image": "themes/hyeni-official/sparkles.png",
        "position": "top-right",
        "width": 200,
        "height": 200,
        "opacity": 0.6,
        "animation": "pulse",
        "offset": {
          "x": -50,
          "y": 50
        }
      }
    ]
  },
  
  "layout": {
    "profilesGrid": "comfortable",
    "sidebarWidth": 280,
    "headerHeight": 80,
    "cardSpacing": 16,
    "borderRadius": 12
  },
  
  "effects": {
    "backgroundBlur": 10,
    "backgroundOverlay": 0.3,
    "cardShadow": true,
    "glowEffect": true,
    "animations": true,
    "particles": {
      "enabled": true,
      "type": "stars",
      "count": 50,
      "speed": 1
    }
  },
  
  "fonts": {
    "primary": "Pretendard Variable",
    "accent": "Gmarket Sans"
  },
  
  "sounds": {
    "buttonClick": "themes/hyeni-official/sounds/click.mp3",
    "notification": "themes/hyeni-official/sounds/notify.mp3",
    "launch": "themes/hyeni-official/sounds/launch.mp3"
  }
}
```

---

## 구현 방법

### 1단계: CSS 변수 시스템

#### TailwindCSS 설정
```typescript
// tailwind.config.js
export default {
  theme: {
    extend: {
      colors: {
        primary: 'var(--color-primary)',
        secondary: 'var(--color-secondary)',
        accent: 'var(--color-accent)',
        background: 'var(--color-background)',
        surface: 'var(--color-surface)',
      }
    }
  }
}
```

#### CSS 변수 동적 적용
```typescript
// ThemeProvider.tsx
const applyTheme = (theme: Theme) => {
  const root = document.documentElement;
  
  // 색상 적용
  root.style.setProperty('--color-primary', theme.colors.primary);
  root.style.setProperty('--color-secondary', theme.colors.secondary);
  root.style.setProperty('--color-accent', theme.colors.accent);
  root.style.setProperty('--color-background', theme.colors.background);
  root.style.setProperty('--color-surface', theme.colors.surface);
  
  // 배경 이미지 적용
  if (theme.images.background) {
    root.style.setProperty('--bg-image', `url('${theme.images.background}')`);
    root.style.setProperty('--bg-blur', `${theme.effects.backgroundBlur}px`);
  }
};
```

### 2단계: React Context

```typescript
// contexts/ThemeContext.tsx
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
    // 테마 로드
    loadThemes();
    
    // 저장된 테마 불러오기
    const savedThemeId = localStorage.getItem('selectedTheme');
    if (savedThemeId) {
      const theme = availableThemes.find(t => t.id === savedThemeId);
      if (theme) applyTheme(theme);
    }
  }, []);

  const setTheme = (theme: Theme) => {
    setCurrentTheme(theme);
    applyTheme(theme);
    localStorage.setItem('selectedTheme', theme.id);
  };

  return (
    <ThemeContext.Provider value={{ currentTheme, setTheme, availableThemes }}>
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

### 3단계: 데코레이션 컴포넌트

```typescript
// components/ThemeDecorations.tsx
export function ThemeDecorations() {
  const { currentTheme } = useTheme();
  
  if (!currentTheme.images.decorations) return null;

  return (
    <div className="fixed inset-0 pointer-events-none z-0">
      {currentTheme.images.decorations.map((deco) => (
        <div
          key={deco.id}
          className={`absolute ${getPositionClass(deco.position)} ${getAnimationClass(deco.animation)}`}
          style={{
            width: deco.width,
            height: deco.height,
            opacity: deco.opacity || 1,
            transform: `translate(${deco.offset.x}px, ${deco.offset.y}px)`,
          }}
        >
          <img src={deco.image} alt={deco.id} className="w-full h-full object-contain" />
        </div>
      ))}
    </div>
  );
}

function getPositionClass(position: string) {
  const positions = {
    'top-left': 'top-0 left-0',
    'top-right': 'top-0 right-0',
    'bottom-left': 'bottom-0 left-0',
    'bottom-right': 'bottom-0 right-0',
  };
  return positions[position] || '';
}

function getAnimationClass(animation?: string) {
  const animations = {
    'float': 'animate-float',
    'pulse': 'animate-pulse',
    'none': '',
  };
  return animations[animation || 'none'] || '';
}
```

### 4단계: 애니메이션

```css
/* animations.css */
@keyframes float {
  0%, 100% {
    transform: translateY(0px);
  }
  50% {
    transform: translateY(-20px);
  }
}

@keyframes sparkle {
  0%, 100% {
    opacity: 0;
  }
  50% {
    opacity: 1;
  }
}

.animate-float {
  animation: float 6s ease-in-out infinite;
}

.animate-sparkle {
  animation: sparkle 2s ease-in-out infinite;
}
```

---

## 강혜니 공식 테마

### 디자인 컨셉

#### 색상 팔레트
```
주 색상:
- Primary: #C77DFF (보라색) - 강혜니의 시그니처 컬러
- Secondary: #E0AAFF (연보라) - 부드러운 강조
- Accent: #FF6B9D (핑크) - 포인트 컬러

배경:
- Dark Purple: #1A0B2E - 메인 배경
- Surface: #251451 - 카드/패널 배경

텍스트:
- White: #FFFFFF - 주 텍스트
- Light Purple: #C8B6E2 - 보조 텍스트
```

#### 비주얼 요소

**메인 화면**
```
┌─────────────────────────────────────────────┐
│  [로고]              HyeniMC       [계정]    │  ← 헤더
├─────────────────────────────────────────────┤
│                                             │
│  [캐릭터]                         [반짝임]  │  ← 데코레이션
│    ↑                                   ↑    │
│  좌측 배치                          우측 배치 │
│                                             │
│         ┌─────────┐ ┌─────────┐            │
│         │ 프로필1  │ │ 프로필2  │            │  ← 프로필 그리드
│         │  [🎮]   │ │  [⚔️]   │            │
│         └─────────┘ └─────────┘            │
│                                             │
│         [+ 새 프로필]                       │
│                                             │
└─────────────────────────────────────────────┘
```

**프로필 생성 모달**
```
┌──────────────────────────────────────┐
│  새 프로필 만들기                     │
│                                      │
│  [배경: 캐릭터 실루엣 + 그래디언트]   │
│                                      │
│  ┌────────────────────────────┐     │
│  │ 프로필 이름                 │     │
│  └────────────────────────────┘     │
│                                      │
│  ┌────────────────────────────┐     │
│  │ 게임 버전 선택              │     │
│  └────────────────────────────┘     │
│                                      │
│     [취소]          [생성] ✨        │
└──────────────────────────────────────┘
```

#### 파일 구조
```
public/
  themes/
    hyeni-official/
      images/
        bg.png                    # 메인 배경 (2560x1440)
        character-left.png        # 왼쪽 캐릭터 (300x400)
        character-right.png       # 오른쪽 캐릭터 (선택)
        sparkles.png              # 반짝임 효과 (200x200)
        logo.png                  # 커스텀 로고 (200x60)
        card-bg.png               # 프로필 카드 배경
        modal-bg.png              # 모달 배경
      sounds/
        click.mp3                 # 버튼 클릭음
        notify.mp3                # 알림음
        launch.mp3                # 게임 실행음
      theme.json                  # 테마 설정
```

---

## 테마 편집기

### UI 구조

```
┌────────────────────────────────────────────────────┐
│  테마 편집기                            [저장] [취소]│
├──────────┬─────────────────────────────────────────┤
│          │                                         │
│  🎨 색상  │  ┌─────────────────────────────────┐   │
│  🖼️ 이미지│  │                                 │   │
│  📐 레이아웃│  │    실시간 미리보기               │   │
│  ✨ 효과  │  │                                 │   │
│  🔊 사운드 │  │    [프로필 목록 예시]            │   │
│          │  │                                 │   │
│  ───────  │  └─────────────────────────────────┘   │
│          │                                         │
│  [선택된 항목에 따라 설정 표시]                    │
│                                                    │
│  색상 선택:                                        │
│  ┌──────┐ Primary                                 │
│  │ 🎨   │ #C77DFF                                 │
│  └──────┘                                          │
│                                                    │
│  ┌──────┐ Secondary                               │
│  │ 🎨   │ #E0AAFF                                 │
│  └──────┘                                          │
│                                                    │
└────────────────────────────────────────────────────┘
```

### 주요 기능

#### 1. 색상 피커
```typescript
function ColorPicker({ label, value, onChange }) {
  return (
    <div className="flex items-center gap-3">
      <label className="w-32">{label}</label>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-12 h-12 rounded cursor-pointer"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 px-3 py-2 bg-surface rounded"
        placeholder="#000000"
      />
    </div>
  );
}
```

#### 2. 이미지 업로더
```typescript
function ImageUploader({ label, value, onChange }) {
  const handleFileSelect = async (file: File) => {
    // 이미지를 themes 폴더에 복사
    const path = await window.electronAPI.saveThemeImage(file);
    onChange(path);
  };

  return (
    <div className="space-y-2">
      <label>{label}</label>
      <div className="border-2 border-dashed border-gray-600 rounded p-4">
        {value ? (
          <img src={value} alt={label} className="max-h-32" />
        ) : (
          <div className="text-center text-gray-500">
            이미지를 드래그하거나 클릭하여 선택
          </div>
        )}
      </div>
    </div>
  );
}
```

#### 3. 데코레이션 배치 도구
```typescript
function DecorationEditor({ decorations, onChange }) {
  const [selectedDeco, setSelectedDeco] = useState(null);

  return (
    <div className="grid grid-cols-2 gap-4">
      {/* 왼쪽: 설정 */}
      <div>
        <h3>데코레이션 목록</h3>
        {decorations.map((deco) => (
          <div key={deco.id} onClick={() => setSelectedDeco(deco)}>
            <img src={deco.image} className="w-16 h-16" />
            <span>{deco.id}</span>
          </div>
        ))}
        <button>+ 추가</button>
      </div>

      {/* 오른쪽: 미리보기 + 드래그 */}
      <div className="relative bg-background rounded aspect-video">
        {decorations.map((deco) => (
          <Draggable
            key={deco.id}
            position={{ x: deco.offset.x, y: deco.offset.y }}
            onStop={(e, data) => updateDecoPosition(deco.id, data.x, data.y)}
          >
            <div>
              <img src={deco.image} style={{ width: deco.width }} />
            </div>
          </Draggable>
        ))}
      </div>
    </div>
  );
}
```

---

## 단계별 구현 계획

### Phase 1: 기본 인프라 (1주)
- [x] ThemeProvider 구현
- [x] CSS 변수 시스템
- [x] 테마 JSON 파서
- [x] 기본 테마 3개 (Default, Dark, Light)

### Phase 2: 커스터마이징 (1주)
- [ ] 색상 커스터마이징
- [ ] 배경 이미지 설정
- [ ] 데코레이션 배치
- [ ] 효과 설정 (블러, 그림자)

### Phase 3: 강혜니 테마 (3일)
- [ ] 디자인 컨셉 확정
- [ ] 이미지 에셋 준비
  - 캐릭터 일러스트 (투명 배경)
  - 로고
  - 반짝임 효과
  - 배경 이미지
- [ ] 사운드 효과
- [ ] 테마 JSON 작성
- [ ] 테스트 및 조정

### Phase 4: 테마 편집기 (4일)
- [ ] UI 레이아웃
- [ ] 색상 피커
- [ ] 이미지 업로더
- [ ] 실시간 미리보기
- [ ] 테마 저장/불러오기

### Phase 5: 고급 기능 (선택)
- [ ] 드래그 앤 드롭 배치
- [ ] 애니메이션 편집기
- [ ] 커스텀 위젯
- [ ] 테마 공유 시스템

---

## 기술 스택

### 필수
- **React Context API**: 테마 상태 관리
- **CSS Variables**: 동적 스타일링
- **TailwindCSS**: 유틸리티 클래스
- **TypeScript**: 타입 안정성

### 선택 (고급 기능)
- **Framer Motion**: 애니메이션
- **react-colorful**: 색상 피커
- **react-draggable**: 드래그 앤 드롭
- **Particles.js**: 파티클 효과

---

## 예상 성과

### 사용자 경험
- ✅ **개인화**: 자신만의 스타일로 커스터마이징
- ✅ **브랜드 강화**: 강혜니 이미지 부각
- ✅ **커뮤니티**: 테마 공유로 참여도 증가

### 기술적 이점
- ✅ **유연성**: 쉬운 테마 추가/수정
- ✅ **성능**: CSS 변수로 빠른 전환
- ✅ **유지보수**: 테마 파일 분리로 관리 용이

---

## 참고 자료

### 영감
- **Discord**: 테마 시스템, 배경 이미지
- **Spotify**: 다이나믹 컬러
- **OperaGX**: 커스터마이징 UI
- **Prism Launcher**: 간단한 테마 설정

### 디자인 도구
- **Figma**: 테마 디자인
- **Coolors.co**: 색상 팔레트
- **Unsplash**: 배경 이미지 (또는 직접 제작)

---

**마지막 업데이트**: 2025-01-10
