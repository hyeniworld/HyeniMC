# 프로필 정렬 및 즐겨찾기

## 📋 목차
1. [개요](#개요)
2. [즐겨찾기 기능](#즐겨찾기-기능)
3. [정렬 로직](#정렬-로직)
4. [구현](#구현)
5. [구현 체크리스트](#구현-체크리스트)

---

## 개요

### 목표
프로필 목록을 사용자 친화적으로 정렬하여 자주 사용하는 프로필에 빠르게 접근

### 정렬 우선순위
1. **즐겨찾기** (상단 고정)
2. **플레이한 순서** (lastPlayed 기준, 최신 우선)
3. **추가한 순서** (createdAt 기준, 최신 우선)

### 예시
```
┌────────────────────────────────────┐
│  ⭐ 혜니월드 서버          (즐겨찾기) │  ← lastPlayed: 10분 전
├────────────────────────────────────┤
│  ⭐ 테스트 프로필          (즐겨찾기) │  ← lastPlayed: 없음 (createdAt: 어제)
├────────────────────────────────────┤
│     바닐라 1.20.1                  │  ← lastPlayed: 1시간 전
├────────────────────────────────────┤
│     Create 모드팩                  │  ← lastPlayed: 3일 전
├────────────────────────────────────┤
│     오래된 프로필                   │  ← lastPlayed: 없음 (createdAt: 1주 전)
└────────────────────────────────────┘
```

---

## 즐겨찾기 기능

### UI 디자인

#### 프로필 카드
```typescript
// 즐겨찾기 아이콘
<button
  onClick={(e) => {
    e.stopPropagation();
    toggleFavorite();
  }}
  className="absolute top-2 right-2 p-1.5 rounded hover:bg-gray-700 transition-colors"
>
  {profile.favorite ? (
    <Star className="w-5 h-5 fill-yellow-400 text-yellow-400" />
  ) : (
    <Star className="w-5 h-5 text-gray-500" />
  )}
</button>
```

#### 시각적 구분
```typescript
// 즐겨찾기 프로필은 테두리 강조
<div className={cn(
  "profile-card",
  profile.favorite && "ring-2 ring-yellow-400/50 bg-gradient-to-br from-yellow-900/10 to-transparent"
)}>
  {profile.favorite && (
    <div className="absolute top-0 left-0 px-2 py-0.5 bg-yellow-400 text-black text-xs font-semibold rounded-br">
      즐겨찾기
    </div>
  )}
  {/* 프로필 내용 */}
</div>
```

---

## 정렬 로직

### 구현

```typescript
// src/renderer/utils/profileSorter.ts

export interface SortableProfile extends Profile {
  favorite: boolean;
  lastPlayed?: Date;
  createdAt: Date;
}

export function sortProfiles(profiles: SortableProfile[]): SortableProfile[] {
  return profiles.sort((a, b) => {
    // 1. 즐겨찾기 우선
    if (a.favorite !== b.favorite) {
      return a.favorite ? -1 : 1;
    }

    // 2. 즐겨찾기가 같으면, lastPlayed 기준
    const aHasPlayed = a.lastPlayed != null;
    const bHasPlayed = b.lastPlayed != null;

    if (aHasPlayed && bHasPlayed) {
      // 둘 다 플레이 기록 있음 → 최신 플레이 우선
      return new Date(b.lastPlayed!).getTime() - new Date(a.lastPlayed!).getTime();
    }

    if (aHasPlayed !== bHasPlayed) {
      // 플레이 기록 있는 것 우선
      return aHasPlayed ? -1 : 1;
    }

    // 3. 둘 다 플레이 기록 없음 → createdAt 기준 (최신 우선)
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}
```

### 테스트 케이스

```typescript
// src/renderer/utils/profileSorter.test.ts

describe('sortProfiles', () => {
  it('should prioritize favorites', () => {
    const profiles = [
      { id: '1', name: 'Normal', favorite: false, createdAt: new Date('2025-01-01') },
      { id: '2', name: 'Favorite', favorite: true, createdAt: new Date('2025-01-02') },
    ];

    const sorted = sortProfiles(profiles);
    expect(sorted[0].id).toBe('2'); // Favorite
  });

  it('should sort by lastPlayed within favorites', () => {
    const profiles = [
      { id: '1', name: 'Fav Old', favorite: true, lastPlayed: new Date('2025-01-01') },
      { id: '2', name: 'Fav New', favorite: true, lastPlayed: new Date('2025-01-10') },
    ];

    const sorted = sortProfiles(profiles);
    expect(sorted[0].id).toBe('2'); // Fav New (최신 플레이)
  });

  it('should sort played profiles before never-played', () => {
    const profiles = [
      { id: '1', name: 'Never', favorite: false, createdAt: new Date('2025-01-10') },
      { id: '2', name: 'Played', favorite: false, lastPlayed: new Date('2025-01-01'), createdAt: new Date('2024-12-01') },
    ];

    const sorted = sortProfiles(profiles);
    expect(sorted[0].id).toBe('2'); // Played
  });

  it('should sort never-played by createdAt', () => {
    const profiles = [
      { id: '1', name: 'Old', favorite: false, createdAt: new Date('2025-01-01') },
      { id: '2', name: 'New', favorite: false, createdAt: new Date('2025-01-10') },
    ];

    const sorted = sortProfiles(profiles);
    expect(sorted[0].id).toBe('2'); // New (최신 생성)
  });
});
```

---

## 구현

### 1. DB 마이그레이션

```go
// backend/internal/db/migrations.go

func migration_15_add_favorite_and_server_address() migrationFunc {
	return func(db *sql.DB) error {
		_, err := db.Exec(`
			ALTER TABLE profiles ADD COLUMN favorite BOOLEAN DEFAULT 0;
			ALTER TABLE profiles ADD COLUMN server_address TEXT;
			CREATE INDEX idx_profiles_favorite ON profiles(favorite);
			CREATE INDEX idx_profiles_server_address ON profiles(server_address);
		`)
		return err
	}
}
```

### 2. Go Domain 수정

```go
// backend/internal/domain/profile.go

type Profile struct {
	// ... 기존 필드들
	Favorite      bool      `json:"favorite"`
	ServerAddress string    `json:"serverAddress,omitempty"`
}
```

### 3. Repository 수정

```go
// backend/internal/services/profile_service.go

func (s *ProfileService) UpdateProfile(id string, updates map[string]interface{}) (*domain.Profile, error) {
	profile, err := s.repo.Get(id)
	if err != nil {
		return nil, err
	}

	// favorite 업데이트
	if favorite, ok := updates["favorite"].(bool); ok {
		profile.Favorite = favorite
	}

	// serverAddress 업데이트
	if serverAddress, ok := updates["serverAddress"].(string); ok {
		profile.ServerAddress = serverAddress
	}

	// ... 기존 업데이트 로직

	return s.repo.Update(profile)
}
```

### 4. Proto 정의

```protobuf
// proto/launcher/profile.proto

message Profile {
  // ... 기존 필드들
  bool favorite = 21;
  string server_address = 22;
}

message UpdateProfileRequest {
  string id = 1;
  // ... 기존 필드들
  optional bool favorite = 20;
  optional string server_address = 21;
}
```

### 5. TypeScript 타입 수정

```typescript
// src/shared/types/profile.ts

export interface Profile {
  // ... 기존 필드들
  favorite: boolean;
  serverAddress?: string;
}
```

### 6. IPC Handler

```typescript
// src/main/ipc/profile.ts

ipcMain.handle(IPC_CHANNELS.PROFILE_TOGGLE_FAVORITE, async (event, profileId: string) => {
  try {
    const profile = await grpcClient.profile.getProfile({ id: profileId });
    const updatedProfile = await grpcClient.profile.updateProfile({
      id: profileId,
      favorite: !profile.favorite,
    });
    return updatedProfile;
  } catch (error) {
    console.error('[IPC Profile] Toggle favorite failed:', error);
    throw error;
  }
});
```

### 7. Preload API

```typescript
// src/preload/preload.ts

export const electronAPI = {
  profile: {
    // ... 기존 메서드들
    toggleFavorite: (profileId: string) => 
      ipcRenderer.invoke(IPC_CHANNELS.PROFILE_TOGGLE_FAVORITE, profileId),
  },
};
```

### 8. UI 구현

#### ProfileList 컴포넌트

```typescript
// src/renderer/components/profiles/ProfileList.tsx
import { Star } from 'lucide-react';
import { sortProfiles } from '../../utils/profileSorter';

export function ProfileList() {
  const [profiles, setProfiles] = useState<Profile[]>([]);

  useEffect(() => {
    loadProfiles();
  }, []);

  const loadProfiles = async () => {
    const data = await window.electronAPI.profile.list();
    setProfiles(sortProfiles(data));
  };

  const toggleFavorite = async (profileId: string) => {
    try {
      await window.electronAPI.profile.toggleFavorite(profileId);
      await loadProfiles(); // 재정렬
    } catch (error) {
      console.error('Failed to toggle favorite:', error);
    }
  };

  return (
    <div className="grid grid-cols-3 gap-4">
      {profiles.map(profile => (
        <ProfileCard 
          key={profile.id}
          profile={profile}
          onToggleFavorite={() => toggleFavorite(profile.id)}
        />
      ))}
    </div>
  );
}
```

#### ProfileCard 컴포넌트

```typescript
// src/renderer/components/profiles/ProfileCard.tsx
import { Star } from 'lucide-react';
import { cn } from '../../utils/cn';

interface Props {
  profile: Profile;
  onToggleFavorite: () => void;
}

export function ProfileCard({ profile, onToggleFavorite }: Props) {
  return (
    <div 
      className={cn(
        "relative p-4 bg-gray-800 rounded-lg hover:bg-gray-750 transition-all cursor-pointer",
        profile.favorite && "ring-2 ring-yellow-400/50 bg-gradient-to-br from-yellow-900/10"
      )}
    >
      {/* 즐겨찾기 배지 */}
      {profile.favorite && (
        <div className="absolute top-0 left-0 px-2 py-0.5 bg-yellow-400 text-black text-xs font-semibold rounded-br">
          즐겨찾기
        </div>
      )}

      {/* 즐겨찾기 버튼 */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite();
        }}
        className="absolute top-2 right-2 p-1.5 rounded hover:bg-gray-700 transition-colors z-10"
        aria-label={profile.favorite ? '즐겨찾기 해제' : '즐겨찾기 추가'}
      >
        {profile.favorite ? (
          <Star className="w-5 h-5 fill-yellow-400 text-yellow-400" />
        ) : (
          <Star className="w-5 h-5 text-gray-500 hover:text-gray-300" />
        )}
      </button>

      {/* 프로필 내용 */}
      <div className="pt-6">
        <div className="text-2xl mb-2">{profile.icon || '🎮'}</div>
        <h3 className="font-semibold text-lg">{profile.name}</h3>
        <p className="text-sm text-gray-400">{profile.gameVersion}</p>
        
        {/* 플레이 정보 */}
        {profile.lastPlayed && (
          <p className="text-xs text-gray-500 mt-2">
            마지막 플레이: {formatRelativeTime(profile.lastPlayed)}
          </p>
        )}
      </div>
    </div>
  );
}

// 유틸리티 함수
function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - new Date(date).getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (minutes < 1) return '방금 전';
  if (minutes < 60) return `${minutes}분 전`;
  if (hours < 24) return `${hours}시간 전`;
  if (days < 7) return `${days}일 전`;
  return new Date(date).toLocaleDateString();
}
```

### 9. IPC 상수 추가

```typescript
// src/shared/constants/ipc.ts

export const IPC_CHANNELS = {
  // ... 기존 채널들
  PROFILE_TOGGLE_FAVORITE: 'profile:toggle-favorite',
};
```

---

## 구현 체크리스트

### Day 1: 백엔드 및 데이터 (4시간)
- [ ] DB 마이그레이션 작성 및 실행
- [ ] Go Domain에 `favorite` 필드 추가
- [ ] Repository CRUD 수정
- [ ] Profile Service 업데이트 로직 추가
- [ ] Proto 파일 수정 및 재생성
- [ ] 백엔드 빌드 테스트

### Day 1: 프론트엔드 (4시간)
- [ ] TypeScript 타입 업데이트
- [ ] IPC Handler 구현
- [ ] Preload API 추가
- [ ] `profileSorter.ts` 유틸리티 작성
- [ ] `ProfileCard` 즐겨찾기 버튼 추가
- [ ] `ProfileList` 정렬 로직 적용
- [ ] 통합 테스트
- [ ] UI/UX 최종 점검

---

## 추가 개선 사항 (선택)

### 1. 정렬 옵션
```typescript
// 사용자가 정렬 방식 선택 가능
type SortOption = 'smart' | 'name' | 'played' | 'created';

function ProfileList() {
  const [sortBy, setSortBy] = useState<SortOption>('smart');

  const sortedProfiles = useMemo(() => {
    switch (sortBy) {
      case 'name':
        return profiles.sort((a, b) => a.name.localeCompare(b.name));
      case 'played':
        return profiles.sort((a, b) => 
          (b.lastPlayed?.getTime() || 0) - (a.lastPlayed?.getTime() || 0)
        );
      case 'created':
        return profiles.sort((a, b) => 
          b.createdAt.getTime() - a.createdAt.getTime()
        );
      default:
        return sortProfiles(profiles);
    }
  }, [profiles, sortBy]);

  return (
    <>
      <div className="mb-4">
        <select value={sortBy} onChange={e => setSortBy(e.target.value as SortOption)}>
          <option value="smart">스마트 정렬</option>
          <option value="name">이름순</option>
          <option value="played">플레이 순</option>
          <option value="created">생성 순</option>
        </select>
      </div>
      {/* ... */}
    </>
  );
}
```

### 2. 즐겨찾기 섹션 분리
```typescript
function ProfileList() {
  const favorites = profiles.filter(p => p.favorite);
  const others = profiles.filter(p => !p.favorite);

  return (
    <>
      {favorites.length > 0 && (
        <section className="mb-8">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <Star className="w-5 h-5 fill-yellow-400 text-yellow-400" />
            즐겨찾기
          </h2>
          <div className="grid grid-cols-3 gap-4">
            {favorites.map(profile => <ProfileCard key={profile.id} profile={profile} />)}
          </div>
        </section>
      )}

      <section>
        <h2 className="text-xl font-bold mb-4">모든 프로필</h2>
        <div className="grid grid-cols-3 gap-4">
          {others.map(profile => <ProfileCard key={profile.id} profile={profile} />)}
        </div>
      </section>
    </>
  );
}
```

---

**작성일**: 2025-10-12  
**우선순위**: ⭐⭐⭐⭐ (빠른 구현)  
**예상 시간**: 1일
