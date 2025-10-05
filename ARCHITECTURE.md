# 아키텍처 문서

혜니MC 런처의 상세 아키텍처 설명입니다.

## 목차

1. [시스템 개요](#시스템-개요)
2. [레이어 아키텍처](#레이어-아키텍처)
3. [데이터 플로우](#데이터-플로우)
4. [모듈 간 의존성](#모듈-간-의존성)
5. [보안 고려사항](#보안-고려사항)
6. [성능 최적화](#성능-최적화)

---

## 시스템 개요

혜니MC는 Electron 기반의 크로스 플랫폼 마인크래프트 런처로, Main Process와 Renderer Process로 분리된 아키텍처를 사용합니다.

### 핵심 원칙

1. **관심사의 분리**: UI 로직과 비즈니스 로직 분리
2. **단일 책임**: 각 모듈은 하나의 명확한 책임만 가짐
3. **의존성 역전**: 인터페이스를 통한 느슨한 결합
4. **확장성**: 새로운 기능 추가가 용이한 구조

---

## 레이어 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                     Presentation Layer                      │
│                    (Renderer Process)                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │  Components  │  │    Stores    │  │    Hooks     │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└────────────────────────┬────────────────────────────────────┘
                         │ IPC Bridge
┌────────────────────────▼────────────────────────────────────┐
│                    Application Layer                        │
│                      (Main Process)                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │   Managers   │  │   Services   │  │  Controllers │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│                      Domain Layer                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │   Entities   │  │  Value Objs  │  │  Interfaces  │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│                  Infrastructure Layer                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ File System  │  │   Network    │  │   External   │     │
│  │   Access     │  │    Client    │  │     APIs     │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

### Presentation Layer (Renderer Process)

**책임**: 사용자 인터페이스 렌더링 및 사용자 입력 처리

**구성요소**:
- **Components**: React 컴포넌트 (UI 렌더링)
- **Stores**: 상태 관리 (Zustand)
- **Hooks**: 재사용 가능한 로직

**특징**:
- Node.js API 직접 접근 불가
- IPC를 통해서만 Main Process와 통신
- 순수한 UI 로직만 포함

### Application Layer (Main Process)

**책임**: 비즈니스 로직 실행 및 시스템 리소스 관리

**구성요소**:

#### Managers
프로필, 모드, 인스턴스 등의 핵심 도메인 관리

```typescript
ProfileManager
├── createProfile()
├── updateProfile()
├── deleteProfile()
└── validateProfile()

ModManager
├── installMod()
├── updateMod()
├── checkDependencies()
└── resolveDependencies()

InstanceManager
├── prepareInstance()
├── launchGame()
├── stopGame()
└── monitorProcess()
```

#### Services
외부 API 통신 및 데이터 변환

```typescript
ModrinthService
├── searchProjects()
├── getProject()
└── getVersions()

CurseForgeService
├── searchMods()
├── getMod()
└── getFiles()

MinecraftService
├── getVersionManifest()
├── downloadClient()
└── downloadAssets()
```

#### Controllers
IPC 요청 처리 및 라우팅

```typescript
ProfileController
├── handleCreate()
├── handleUpdate()
└── handleDelete()
```

### Domain Layer

**책임**: 핵심 비즈니스 규칙 및 도메인 모델

**구성요소**:
- **Entities**: Profile, Mod, Modpack 등
- **Value Objects**: Version, Memory, Resolution 등
- **Interfaces**: 계약 정의

### Infrastructure Layer

**책임**: 외부 시스템과의 통신 및 기술적 세부사항

**구성요소**:
- **File System**: 파일 읽기/쓰기
- **Network**: HTTP 클라이언트
- **External APIs**: Modrinth, CurseForge 등

---

## 데이터 플로우

### 1. 프로필 생성 플로우

```
User Input (UI)
    │
    ▼
[CreateProfileForm]
    │
    ▼
electronAPI.profile.create(data)
    │
    ▼ IPC
[ProfileController.handleCreate]
    │
    ▼
[ProfileManager.createProfile]
    │
    ├──▶ [Validation]
    │
    ├──▶ [File System] - 디렉토리 생성
    │
    ├──▶ [File System] - 프로필 저장
    │
    └──▶ Return Profile
    │
    ▼ IPC
[UI Update]
```

### 2. 모드 설치 플로우

```
User Input (모드 선택)
    │
    ▼
electronAPI.mod.install(profileId, modData)
    │
    ▼ IPC
[ModController.handleInstall]
    │
    ▼
[ModManager.installMod]
    │
    ├──▶ [ModrinthService.getVersion] - 모드 정보 조회
    │
    ├──▶ [ModManager.checkDependencies] - 의존성 확인
    │
    ├──▶ [DownloadManager.download] - 모드 다운로드
    │     │
    │     ├──▶ [Network] - HTTP 다운로드
    │     │
    │     ├──▶ [File System] - 파일 저장
    │     │
    │     └──▶ Emit 'download:progress' Event
    │
    ├──▶ [File System] - mods 폴더로 이동
    │
    ├──▶ [ProfileManager.updateProfile] - 프로필 업데이트
    │
    └──▶ Return Mod
    │
    ▼ IPC
[UI Update]
```

### 3. 게임 실행 플로우

```
User Input (Play 버튼)
    │
    ▼
electronAPI.profile.launch(profileId)
    │
    ▼ IPC
[ProfileController.handleLaunch]
    │
    ▼
[InstanceManager.launchGame]
    │
    ├──▶ [ProfileManager.getProfile] - 프로필 조회
    │
    ├──▶ [InstanceManager.prepareInstance]
    │     │
    │     ├──▶ [VersionManager] - 버전 확인
    │     │
    │     ├──▶ [DownloadManager] - 필요 파일 다운로드
    │     │
    │     └──▶ [File System] - 게임 디렉토리 설정
    │
    ├──▶ [JavaManager.findJavaExecutable] - Java 경로 찾기
    │
    ├──▶ [InstanceManager.buildLaunchCommand] - 실행 명령 생성
    │
    ├──▶ [Child Process] - 게임 프로세스 시작
    │     │
    │     └──▶ Emit 'game:log' Events
    │
    └──▶ Return GameInstance
    │
    ▼ IPC Events
[UI - 게임 콘솔 표시]
```

---

## 모듈 간 의존성

### 의존성 그래프

```
ProfileManager
    ├── depends on → FileSystemService
    ├── depends on → ValidationService
    └── uses → Profile (Entity)

ModManager
    ├── depends on → ModrinthService
    ├── depends on → CurseForgeService
    ├── depends on → DownloadManager
    ├── depends on → ProfileManager
    └── uses → Mod (Entity)

InstanceManager
    ├── depends on → ProfileManager
    ├── depends on → VersionManager
    ├── depends on → JavaManager
    ├── depends on → DownloadManager
    └── uses → GameInstance (Entity)

DownloadManager
    ├── depends on → NetworkClient
    ├── depends on → FileSystemService
    └── uses → DownloadTask (Entity)

ModrinthService
    ├── depends on → NetworkClient
    └── uses → ModrinthAPI (Interface)

VersionManager
    ├── depends on → MinecraftService
    ├── depends on → FabricService
    ├── depends on → ForgeService
    └── depends on → NeoForgeService
```

### 의존성 주입

모든 Manager는 생성자를 통해 의존성을 주입받습니다:

```typescript
// Bad - 직접 생성
class ModManager {
  private modrinthService = new ModrinthService();
}

// Good - 의존성 주입
class ModManager {
  constructor(
    private modrinthService: ModrinthService,
    private downloadManager: DownloadManager
  ) {}
}

// 사용
const modrinthService = new ModrinthService(httpClient);
const downloadManager = new DownloadManager(config);
const modManager = new ModManager(modrinthService, downloadManager);
```

---

## 보안 고려사항

### 1. Context Isolation

Renderer Process는 Node.js API에 직접 접근할 수 없습니다:

```typescript
// preload.ts
contextBridge.exposeInMainWorld('electronAPI', {
  // 허용된 API만 노출
  profile: {
    create: (data) => ipcRenderer.invoke('profile:create', data),
  },
});
```

### 2. IPC 검증

모든 IPC 요청은 Main Process에서 검증됩니다:

```typescript
ipcMain.handle('profile:create', async (event, data) => {
  // 입력 검증
  if (!data.name || !data.gameVersion) {
    throw new Error('Invalid input');
  }
  
  // 권한 확인
  // ...
  
  return await profileManager.createProfile(data);
});
```

### 3. 파일 시스템 접근 제한

파일 시스템 접근은 앱 데이터 디렉토리로 제한됩니다:

```typescript
function validatePath(targetPath: string): boolean {
  const appDataPath = getAppDataPath();
  const resolvedPath = path.resolve(targetPath);
  return resolvedPath.startsWith(appDataPath);
}
```

### 4. 다운로드 검증

모든 다운로드는 체크섬으로 검증됩니다:

```typescript
async function verifyDownload(filePath: string, expectedSha512: string): Promise<boolean> {
  const hash = crypto.createHash('sha512');
  const stream = fs.createReadStream(filePath);
  
  return new Promise((resolve) => {
    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => {
      const actualHash = hash.digest('hex');
      resolve(actualHash === expectedSha512);
    });
  });
}
```

### 5. API 키 보안

API 키는 환경 변수로 관리되며 코드에 하드코딩하지 않습니다:

```typescript
// .env
CURSEFORGE_API_KEY=your-api-key

// 사용
const apiKey = process.env.CURSEFORGE_API_KEY;
```

---

## 성능 최적화

### 1. 병렬 다운로드

여러 파일을 동시에 다운로드하여 속도 향상:

```typescript
class DownloadManager {
  private maxConcurrent = 3;
  
  async downloadBatch(tasks: DownloadTask[]): Promise<void> {
    const chunks = this.chunk(tasks, this.maxConcurrent);
    
    for (const chunk of chunks) {
      await Promise.all(chunk.map(task => this.download(task)));
    }
  }
}
```

### 2. 캐싱 전략

자주 사용되는 데이터는 메모리와 디스크에 캐싱:

```typescript
class VersionManager {
  private cache = new Map<string, VersionManifest>();
  private cacheExpiry = 60 * 60 * 1000; // 1시간
  
  async getVersionManifest(version: string): Promise<VersionManifest> {
    // 메모리 캐시 확인
    if (this.cache.has(version)) {
      return this.cache.get(version)!;
    }
    
    // 디스크 캐시 확인
    const cached = await this.loadFromDiskCache(version);
    if (cached && !this.isCacheExpired(cached)) {
      this.cache.set(version, cached);
      return cached;
    }
    
    // 네트워크에서 가져오기
    const manifest = await this.fetchFromNetwork(version);
    this.cache.set(version, manifest);
    await this.saveToDiskCache(version, manifest);
    
    return manifest;
  }
}
```

### 3. 가상 스크롤

긴 목록은 가상 스크롤로 렌더링 성능 향상:

```typescript
import { useVirtualizer } from '@tanstack/react-virtual';

function ModList({ mods }: { mods: Mod[] }) {
  const parentRef = useRef<HTMLDivElement>(null);
  
  const virtualizer = useVirtualizer({
    count: mods.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80,
  });
  
  return (
    <div ref={parentRef} style={{ height: '600px', overflow: 'auto' }}>
      <div style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualizer.getVirtualItems().map((virtualItem) => (
          <ModCard
            key={virtualItem.key}
            mod={mods[virtualItem.index]}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualItem.start}px)`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
```

### 4. 이미지 레이지 로딩

이미지는 뷰포트에 들어올 때만 로드:

```typescript
function ModIcon({ src, alt }: { src: string; alt: string }) {
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
    />
  );
}
```

### 5. 디바운싱 & 쓰로틀링

검색 등 빈번한 이벤트는 디바운싱:

```typescript
import { useDebouncedCallback } from 'use-debounce';

function SearchBar() {
  const [query, setQuery] = useState('');
  
  const debouncedSearch = useDebouncedCallback(
    async (value: string) => {
      const results = await electronAPI.mod.search(value);
      setResults(results);
    },
    500
  );
  
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);
    debouncedSearch(value);
  };
  
  return <input value={query} onChange={handleChange} />;
}
```

### 6. 메모이제이션

비용이 큰 계산은 메모이제이션:

```typescript
import { useMemo } from 'react';

function ProfileStats({ profile }: { profile: Profile }) {
  const stats = useMemo(() => {
    return {
      totalMods: profile.mods.length,
      enabledMods: profile.mods.filter(m => m.enabled).length,
      totalSize: profile.mods.reduce((sum, m) => sum + m.fileSize, 0),
    };
  }, [profile.mods]);
  
  return <div>{/* stats 표시 */}</div>;
}
```

### 7. 백그라운드 작업

무거운 작업은 Worker Thread로 분리:

```typescript
import { Worker } from 'worker_threads';

class ModpackParser {
  async parseModpack(filePath: string): Promise<ModpackManifest> {
    return new Promise((resolve, reject) => {
      const worker = new Worker('./workers/modpack-parser.js');
      
      worker.postMessage({ filePath });
      
      worker.on('message', (manifest) => {
        resolve(manifest);
        worker.terminate();
      });
      
      worker.on('error', reject);
    });
  }
}
```

---

## 에러 처리 전략

### 1. 계층별 에러 처리

```typescript
// Infrastructure Layer - 기술적 에러
class NetworkClient {
  async get(url: string): Promise<any> {
    try {
      return await axios.get(url);
    } catch (error) {
      throw new NetworkError('Failed to fetch data', { cause: error });
    }
  }
}

// Application Layer - 비즈니스 에러
class ModManager {
  async installMod(profileId: string, modData: InstallModData): Promise<Mod> {
    try {
      const profile = await this.profileManager.getProfile(profileId);
      if (!profile) {
        throw new ProfileNotFoundError(profileId);
      }
      
      // ...
    } catch (error) {
      if (error instanceof ProfileNotFoundError) {
        throw error;
      }
      throw new ModInstallationError('Failed to install mod', { cause: error });
    }
  }
}

// Presentation Layer - 사용자 친화적 메시지
function ModInstallButton({ profileId, modData }: Props) {
  const handleInstall = async () => {
    try {
      await electronAPI.mod.install(profileId, modData);
      toast.success('모드가 설치되었습니다');
    } catch (error) {
      if (error instanceof ProfileNotFoundError) {
        toast.error('프로필을 찾을 수 없습니다');
      } else if (error instanceof ModInstallationError) {
        toast.error('모드 설치에 실패했습니다');
      } else {
        toast.error('알 수 없는 오류가 발생했습니다');
      }
    }
  };
  
  return <button onClick={handleInstall}>설치</button>;
}
```

### 2. 전역 에러 핸들러

```typescript
// Main Process
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // 로그 파일에 기록
  // 사용자에게 알림
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Renderer Process
window.addEventListener('error', (event) => {
  console.error('Global error:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
});
```

---

## 로깅 전략

### 로그 레벨

```typescript
enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

class Logger {
  private level: LogLevel = LogLevel.INFO;
  
  debug(message: string, meta?: any): void {
    if (this.level <= LogLevel.DEBUG) {
      this.write('DEBUG', message, meta);
    }
  }
  
  info(message: string, meta?: any): void {
    if (this.level <= LogLevel.INFO) {
      this.write('INFO', message, meta);
    }
  }
  
  warn(message: string, meta?: any): void {
    if (this.level <= LogLevel.WARN) {
      this.write('WARN', message, meta);
    }
  }
  
  error(message: string, error?: Error, meta?: any): void {
    if (this.level <= LogLevel.ERROR) {
      this.write('ERROR', message, { error, ...meta });
    }
  }
  
  private write(level: string, message: string, meta?: any): void {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      ...meta,
    };
    
    console.log(JSON.stringify(logEntry));
    // 파일에도 기록
  }
}
```

---

## 확장성 고려사항

### 1. 플러그인 시스템 (추후)

```typescript
interface Plugin {
  name: string;
  version: string;
  onLoad(): Promise<void>;
  onUnload(): Promise<void>;
}

class PluginManager {
  private plugins: Map<string, Plugin> = new Map();
  
  async loadPlugin(plugin: Plugin): Promise<void> {
    await plugin.onLoad();
    this.plugins.set(plugin.name, plugin);
  }
  
  async unloadPlugin(name: string): Promise<void> {
    const plugin = this.plugins.get(name);
    if (plugin) {
      await plugin.onUnload();
      this.plugins.delete(name);
    }
  }
}
```

### 2. 이벤트 기반 아키텍처

```typescript
class EventBus extends EventEmitter {
  private static instance: EventBus;
  
  static getInstance(): EventBus {
    if (!EventBus.instance) {
      EventBus.instance = new EventBus();
    }
    return EventBus.instance;
  }
  
  publish(event: string, data: any): void {
    this.emit(event, data);
  }
  
  subscribe(event: string, handler: (data: any) => void): void {
    this.on(event, handler);
  }
}

// 사용
const eventBus = EventBus.getInstance();

// 발행
eventBus.publish('mod:installed', { modId: '123', profileId: 'abc' });

// 구독
eventBus.subscribe('mod:installed', (data) => {
  console.log('Mod installed:', data);
});
```

---

## 마이그레이션 전략

데이터 구조 변경 시 마이그레이션 시스템:

```typescript
interface Migration {
  version: number;
  up(data: any): any;
  down(data: any): any;
}

class MigrationManager {
  private migrations: Migration[] = [];
  
  register(migration: Migration): void {
    this.migrations.push(migration);
    this.migrations.sort((a, b) => a.version - b.version);
  }
  
  async migrate(data: any, fromVersion: number, toVersion: number): Promise<any> {
    let result = data;
    
    const applicableMigrations = this.migrations.filter(
      m => m.version > fromVersion && m.version <= toVersion
    );
    
    for (const migration of applicableMigrations) {
      result = await migration.up(result);
    }
    
    return result;
  }
}

// 예시 마이그레이션
const migration_v2: Migration = {
  version: 2,
  up: (profile) => ({
    ...profile,
    // v2에서 추가된 필드
    authRequired: false,
  }),
  down: (profile) => {
    const { authRequired, ...rest } = profile;
    return rest;
  },
};
```

이 아키텍처는 확장 가능하고 유지보수가 용이하며, 향후 혜니월드 인증 및 SPA 연동 기능을 추가할 때도 최소한의 변경으로 통합할 수 있도록 설계되었습니다.
