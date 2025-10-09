# 혜니월드 마인크래프트 런처 설계 문서

## 목차
1. [개요](#개요)
2. [기술 스택](#기술-스택)
3. [시스템 아키텍처](#시스템-아키텍처)
4. [데이터 모델](#데이터-모델)
5. [핵심 모듈 설계](#핵심-모듈-설계)
6. [API 설계](#api-설계)
7. [UI/UX 설계](#uiux-설계)
8. [파일 시스템 구조](#파일-시스템-구조)
9. [개발 로드맵](#개발-로드맵)

---

## 개요

### 프로젝트 목표
혜니월드 전용 마인크래프트 런처로, 프로필 기반 인스턴스 관리와 모드팩 지원을 제공하는 크로스 플랫폼 애플리케이션

### 주요 기능
- ✅ 프로필 기반 마인크래프트 인스턴스 관리
- ✅ Modrinth 기반 모드팩 지원
- ✅ 모드 자동 업데이트 (강제/선택적)
- ✅ 멀티플랫폼 지원 (Windows, macOS including Apple Silicon)
- ✅ 다양한 프로필 생성 방법 (수동, 모드팩, 외부 런처 가져오기)
- 🔜 혜니월드 인증 연동 (추후 구현)
- 🔜 SPA(Single Packet Authorization) 연동 (추후 구현)

---

## 기술 스택

### Frontend
- **Framework**: Electron 28+
- **UI Library**: React 18+ with TypeScript
- **Styling**: TailwindCSS 3+
- **Component Library**: shadcn/ui
- **Icons**: Lucide React
- **State Management**: Zustand
- **Form Handling**: React Hook Form + Zod
- **HTTP Client**: Axios

### Backend (Go gRPC Daemon)
- **Runtime**: Go 1.22+
- **Transport**: gRPC (HTTP/2), 서버-스트리밍 지원
- **Codegen**: `protoc`/`buf`, Protobuf v3
- **HTTP Gateway(옵션)**: grpc-gateway(v2)로 REST 노출 가능
- **Libs**: `net/http`, `crypto`, `archive/zip`, `hash`, `os/exec`, `x/sync/errgroup`
- **배포**: 단일 정적 바이너리(Windows x64, macOS x64/arm64)

### Build & Development
- **Bundler**: Vite
- **Builder**: electron-builder
- **Linter**: ESLint
- **Formatter**: Prettier
- **Testing**: Vitest, Playwright

### External APIs
- Modrinth API v2
- CurseForge API v1
- Minecraft Version Manifest
- Forge Meta API
- NeoForge Meta API

---

### 시스템 아키텍처

### 전체 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                    Renderer Process (UI)                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │   Profiles   │  │     Mods     │  │   Settings   │     │
│  │   Manager    │  │   Manager    │  │              │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │   Modpack    │  │   Instance   │  │     Logs     │     │
│  │   Browser    │  │   Console    │  │    Viewer    │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└────────────────────────┬────────────────────────────────────┘
                         │ IPC (contextBridge)
┌────────────────────────▼────────────────────────────────────┐
│                    Main Process (Bridge)                    │
│  ┌──────────────────────────────────────────────────────┐  │
│  │             IPC Router / gRPC Client                  │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐            │  │
│  │  │  IPC     │  │  Auth    │  │  Events  │            │  │
│  │  │ Handlers │  │ (stub)   │  │ Bridge   │            │  │
│  │  └──────────┘  └──────────┘  └──────────┘            │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │               Go gRPC Daemon (Core)                   │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐             │  │
│  │  │ Profile  │ │ Version  │ │ Download │             │  │
│  │  │ Service  │ │ Service  │ │ Service  │             │  │
│  │  ├──────────┤ ├──────────┤ ├──────────┤             │  │
│  │  │ Mod      │ │ Instance │ │ Modpack  │             │  │
│  │  │ Service  │ │ Service  │ │ Service  │             │  │
│  │  └──────────┘ └──────────┘ └──────────┘             │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│                    External Resources                       │
│  - Modrinth API (https://api.modrinth.com/v2)              │
│  - CurseForge API (https://api.curseforge.com/v1)          │
│  - Minecraft Manifest (launchermeta.mojang.com)            │
│  - Fabric Meta (meta.fabricmc.net)                         │
│  - Forge Meta (files.minecraftforge.net)                   │
│  - NeoForge Meta (maven.neoforged.net)                     │
└─────────────────────────────────────────────────────────────┘
```

### IPC 통신 구조

```typescript
// Renderer → Main
ipcRenderer.invoke('profile:create', profileData)
ipcRenderer.invoke('profile:launch', profileId)
ipcRenderer.invoke('mod:install', modData)
ipcRenderer.invoke('modpack:import', modpackUrl)

// Main → Renderer (Events)
ipcRenderer.on('download:progress', (event, progress) => {})
ipcRenderer.on('game:log', (event, log) => {})
ipcRenderer.on('mod:update-available', (event, updates) => {})
```

---

## 데이터 모델

### Profile (프로필)

```typescript
interface Profile {
  id: string;                          // UUID
  name: string;                        // 프로필 이름
  description?: string;                // 프로필 설명
  icon?: string;                       // 아이콘 경로 또는 URL
  
  // 게임 버전 정보
  gameVersion: string;                 // 마인크래프트 버전 (e.g., "1.20.1")
  loaderType: LoaderType;              // 'vanilla' | 'fabric' | 'forge' | 'neoforge'
  loaderVersion?: string;              // 로더 버전
  
  // 경로 설정
  gameDirectory: string;               // 게임 디렉토리 절대 경로
  
  // Java 설정
  javaPath?: string;                   // 커스텀 Java 경로
  jvmArgs: string[];                   // JVM 인자
  memory: {
    min: number;                       // 최소 메모리 (MB)
    max: number;                       // 최대 메모리 (MB)
  };
  
  // 게임 설정
  gameArgs: string[];                  // 게임 인자
  resolution?: {
    width: number;
    height: number;
  };
  
  // 모드 관리
  mods: Mod[];                         // 설치된 모드 리스트
  modpackId?: string;                  // 모드팩 ID (Modrinth/CurseForge)
  modpackSource?: 'modrinth' | 'curseforge';
  
  // 메타데이터
  createdAt: Date;
  updatedAt: Date;
  lastPlayed?: Date;
  totalPlayTime: number;               // 총 플레이 타임 (초)
  
  // 추후 추가 예정
  authRequired?: boolean;              // 혜니월드 인증 필요 여부
  spaEnabled?: boolean;                // SPA 활성화 여부
  serverAddress?: string;              // 서버 주소
}

type LoaderType = 'vanilla' | 'fabric' | 'forge' | 'neoforge';
```

### Mod (모드)

```typescript
interface Mod {
  id: string;                          // 로컬 고유 ID
  name: string;                        // 모드 이름
  version: string;                     // 모드 버전
  fileName: string;                    // 파일명
  
  // 소스 정보
  source: ModSource;                   // 'modrinth' | 'curseforge' | 'custom' | 'url'
  sourceId?: string;                   // Modrinth/CurseForge 프로젝트 ID
  projectSlug?: string;                // 프로젝트 슬러그
  fileId?: string;                     // 파일 ID
  
  // 메타데이터
  description?: string;
  author?: string;
  iconUrl?: string;
  websiteUrl?: string;
  
  // 의존성
  dependencies: ModDependency[];
  
  // 상태
  enabled: boolean;                    // 활성화 여부
  required: boolean;                   // 강제 업데이트 대상 여부
  
  // 호환성
  gameVersions: string[];              // 지원하는 마인크래프트 버전
  loaders: LoaderType[];               // 지원하는 로더
  
  // 업데이트
  updateAvailable?: boolean;
  latestVersion?: string;
  
  // 파일 정보
  fileSize: number;                    // 바이트
  sha1?: string;                       // 체크섬
  sha512?: string;
  
  installedAt: Date;
  updatedAt?: Date;
}

type ModSource = 'modrinth' | 'curseforge' | 'custom' | 'url';

interface ModDependency {
  modId: string;
  type: 'required' | 'optional' | 'incompatible' | 'embedded';
  versionRange?: string;
}
```

### Modpack (모드팩)

```typescript
interface Modpack {
  id: string;                          // Modrinth/CurseForge ID
  slug: string;
  name: string;
  description: string;
  author: string;
  
  source: 'modrinth' | 'curseforge';
  
  iconUrl?: string;
  bannerUrl?: string;
  
  gameVersion: string;
  loaderType: LoaderType;
  loaderVersion: string;
  
  versions: ModpackVersion[];
  
  downloads: number;
  followers: number;
  
  categories: string[];
  tags: string[];
  
  websiteUrl?: string;
  sourceUrl?: string;
  issuesUrl?: string;
  
  createdAt: Date;
  updatedAt: Date;
}

interface ModpackVersion {
  id: string;
  name: string;
  versionNumber: string;
  changelog?: string;
  
  gameVersion: string;
  loaderVersion: string;
  
  downloadUrl: string;
  fileSize: number;
  sha1?: string;
  sha512?: string;
  
  dependencies: ModpackDependency[];
  
  downloads: number;
  publishedAt: Date;
}

interface ModpackDependency {
  projectId: string;
  versionId: string;
  fileName: string;
  required: boolean;
}
```

### DownloadTask (다운로드 작업)

```typescript
interface DownloadTask {
  id: string;
  type: 'mod' | 'modpack' | 'minecraft' | 'loader' | 'java' | 'asset';
  name: string;
  url: string;
  destination: string;
  
  status: DownloadStatus;
  progress: number;                    // 0-100
  downloadedBytes: number;
  totalBytes: number;
  speed: number;                       // bytes/sec
  
  sha1?: string;
  sha512?: string;
  
  error?: string;
  retryCount: number;
  maxRetries: number;
  
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

type DownloadStatus = 'pending' | 'downloading' | 'completed' | 'failed' | 'cancelled';
```

### GameInstance (게임 인스턴스)

```typescript
interface GameInstance {
  profileId: string;
  processId?: number;
  
  status: InstanceStatus;
  
  startedAt: Date;
  stoppedAt?: Date;
  
  logs: GameLog[];
  
  crashReport?: string;
  exitCode?: number;
}

type InstanceStatus = 'preparing' | 'launching' | 'running' | 'stopped' | 'crashed';

interface GameLog {
  timestamp: Date;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  source?: string;
}
```

### AppConfig (앱 설정)

```typescript
interface AppConfig {
  // 일반 설정
  language: string;                    // 'ko' | 'en'
  theme: 'light' | 'dark' | 'system';
  
  // 경로 설정
  dataDirectory: string;               // 앱 데이터 디렉토리
  defaultGameDirectory: string;        // 기본 게임 디렉토리
  
  // Java 설정
  autoDetectJava: boolean;
  javaExecutables: JavaInstallation[];
  
  // 다운로드 설정
  maxConcurrentDownloads: number;
  downloadThreads: number;
  
  // 모드 업데이트 설정
  autoCheckUpdates: boolean;
  autoUpdateRequired: boolean;         // 강제 업데이트 자동 적용
  updateCheckInterval: number;         // 시간 (분)
  
  // 네트워크 설정
  useProxy: boolean;
  proxyHost?: string;
  proxyPort?: number;
  
  // 고급 설정
  keepLauncherOpen: boolean;           // 게임 실행 후 런처 유지
  showConsole: boolean;                // 게임 콘솔 표시
  enableAnalytics: boolean;
  
  // 추후 추가
  hyeniAuthEnabled?: boolean;
  spaEnabled?: boolean;
}

interface JavaInstallation {
  path: string;
  version: string;
  architecture: 'x64' | 'arm64';
  vendor: string;
  isDefault: boolean;
}
```

---

## 핵심 모듈 설계

### 1. ProfileManager

프로필 생성, 수정, 삭제 및 관리를 담당

```typescript
class ProfileManager {
  private profiles: Map<string, Profile>;
  private profilesPath: string;
  
  constructor(dataDirectory: string);
  
  // CRUD
  async createProfile(data: CreateProfileData): Promise<Profile>;
  async getProfile(id: string): Promise<Profile | null>;
  async getAllProfiles(): Promise<Profile[]>;
  async updateProfile(id: string, data: Partial<Profile>): Promise<Profile>;
  async deleteProfile(id: string): Promise<void>;
  
  // 프로필 생성 방법
  async createFromScratch(data: ManualProfileData): Promise<Profile>;
  async createFromModpack(modpackId: string, source: 'modrinth' | 'curseforge'): Promise<Profile>;
  async importFromExternal(path: string, launcherType: 'multimc' | 'prism' | 'atlauncher'): Promise<Profile>;
  
  // 프로필 관리
  async duplicateProfile(id: string, newName: string): Promise<Profile>;
  async exportProfile(id: string, destination: string): Promise<void>;
  
  // 통계
  async updatePlayTime(id: string, duration: number): Promise<void>;
  async getRecentProfiles(limit: number): Promise<Profile[]>;
  
  // 유효성 검사
  async validateProfile(profile: Profile): Promise<ValidationResult>;
  
  private async saveProfiles(): Promise<void>;
  private async loadProfiles(): Promise<void>;
}

interface CreateProfileData {
  name: string;
  description?: string;
  gameVersion: string;
  loaderType: LoaderType;
  loaderVersion?: string;
  icon?: string;
}

interface ManualProfileData extends CreateProfileData {
  memory?: { min: number; max: number };
  jvmArgs?: string[];
  gameArgs?: string[];
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}
```

### 2. ModManager

모드 설치, 제거, 업데이트 관리

```typescript
class ModManager {
  private modrinthService: ModrinthService;
  private curseforgeService: CurseForgeService;
  private downloadManager: DownloadManager;
  
  constructor(services: ModManagerServices);
  
  // 모드 설치
  async installMod(profileId: string, modData: InstallModData): Promise<Mod>;
  async installModFromUrl(profileId: string, url: string, metadata?: Partial<Mod>): Promise<Mod>;
  async installModFromFile(profileId: string, filePath: string, metadata?: Partial<Mod>): Promise<Mod>;
  
  // 모드 관리
  async removeMod(profileId: string, modId: string): Promise<void>;
  async toggleMod(profileId: string, modId: string, enabled: boolean): Promise<void>;
  async getMods(profileId: string): Promise<Mod[]>;
  
  // 모드 검색
  async searchMods(query: string, filters: ModSearchFilters): Promise<ModSearchResult[]>;
  async getModDetails(modId: string, source: ModSource): Promise<ModDetails>;
  async getModVersions(modId: string, source: ModSource, filters: VersionFilters): Promise<ModVersion[]>;
  
  // 모드 업데이트
  async checkUpdates(profileId: string): Promise<ModUpdate[]>;
  async updateMod(profileId: string, modId: string, versionId: string): Promise<Mod>;
  async updateAllMods(profileId: string, onProgress?: ProgressCallback): Promise<UpdateResult>;
  async updateRequiredMods(profileId: string, onProgress?: ProgressCallback): Promise<UpdateResult>;
  
  // 의존성 관리
  async resolveDependencies(profileId: string, mod: Mod): Promise<Mod[]>;
  async checkDependencies(profileId: string): Promise<DependencyIssue[]>;
  async installDependencies(profileId: string, modId: string): Promise<Mod[]>;
  
  // 호환성 검사
  async checkCompatibility(profileId: string, mod: Mod): Promise<CompatibilityResult>;
  
  private async downloadMod(mod: Mod, destination: string): Promise<void>;
  private async verifyMod(filePath: string, checksum?: string): Promise<boolean>;
}

interface InstallModData {
  source: ModSource;
  projectId: string;
  versionId?: string;
  required?: boolean;
}

interface ModSearchFilters {
  gameVersion?: string;
  loaderType?: LoaderType;
  categories?: string[];
  source?: ModSource;
  limit?: number;
  offset?: number;
}

interface ModUpdate {
  mod: Mod;
  currentVersion: string;
  latestVersion: string;
  versionId: string;
  changelog?: string;
  required: boolean;
}

interface UpdateResult {
  success: Mod[];
  failed: Array<{ mod: Mod; error: string }>;
  skipped: Mod[];
}

interface DependencyIssue {
  mod: Mod;
  type: 'missing' | 'incompatible' | 'version-mismatch';
  dependency: ModDependency;
  suggestion?: string;
}

interface CompatibilityResult {
  compatible: boolean;
  issues: string[];
  warnings: string[];
}
```

### 3. VersionManager

마인크래프트 및 모드 로더 버전 관리

```typescript
class VersionManager {
  private minecraftService: MinecraftService;
  private fabricService: FabricService;
  private forgeService: ForgeService;
  private neoforgeService: NeoForgeService;
  private cache: VersionCache;
  
  constructor(services: VersionManagerServices);
  
  // 마인크래프트 버전
  async getMinecraftVersions(type?: 'release' | 'snapshot' | 'all'): Promise<MinecraftVersion[]>;
  async getMinecraftVersionManifest(version: string): Promise<VersionManifest>;
  async downloadMinecraft(version: string, destination: string, onProgress?: ProgressCallback): Promise<void>;
  
  // 로더 버전
  async getLoaderVersions(loaderType: LoaderType, gameVersion: string): Promise<LoaderVersion[]>;
  async getLatestLoaderVersion(loaderType: LoaderType, gameVersion: string): Promise<LoaderVersion>;
  async downloadLoader(loaderType: LoaderType, version: string, gameVersion: string, destination: string): Promise<void>;
  
  // 호환성
  async checkCompatibility(gameVersion: string, loaderType: LoaderType, loaderVersion: string): Promise<boolean>;
  async getCompatibleLoaders(gameVersion: string): Promise<CompatibleLoaders>;
  
  // 캐시 관리
  async refreshCache(): Promise<void>;
  async clearCache(): Promise<void>;
  
  private async fetchVersionManifest(): Promise<void>;
}

interface MinecraftVersion {
  id: string;
  type: 'release' | 'snapshot' | 'old_beta' | 'old_alpha';
  url: string;
  releaseTime: Date;
  sha1: string;
}

interface VersionManifest {
  id: string;
  type: string;
  mainClass: string;
  libraries: Library[];
  assetIndex: AssetIndex;
  downloads: {
    client: Download;
    server: Download;
  };
  javaVersion: {
    majorVersion: number;
    component: string;
  };
}

interface LoaderVersion {
  version: string;
  stable: boolean;
  releaseTime?: Date;
}

interface CompatibleLoaders {
  fabric: LoaderVersion[];
  forge: LoaderVersion[];
  neoforge: LoaderVersion[];
}
```

### 4. DownloadManager

파일 다운로드 및 진행률 관리

```typescript
class DownloadManager {
  private queue: DownloadQueue;
  private activeDownloads: Map<string, DownloadTask>;
  private maxConcurrent: number;
  
  constructor(config: DownloadConfig);
  
  // 다운로드 작업
  async download(task: CreateDownloadTask): Promise<string>;
  async downloadBatch(tasks: CreateDownloadTask[], onProgress?: BatchProgressCallback): Promise<DownloadBatchResult>;
  
  // 큐 관리
  async pauseDownload(taskId: string): Promise<void>;
  async resumeDownload(taskId: string): Promise<void>;
  async cancelDownload(taskId: string): Promise<void>;
  async retryDownload(taskId: string): Promise<void>;
  
  // 상태 조회
  getDownloadTask(taskId: string): DownloadTask | null;
  getActiveDownloads(): DownloadTask[];
  getQueuedDownloads(): DownloadTask[];
  
  // 이벤트
  on(event: 'progress', callback: (task: DownloadTask) => void): void;
  on(event: 'complete', callback: (task: DownloadTask) => void): void;
  on(event: 'error', callback: (task: DownloadTask, error: Error) => void): void;
  
  private async processQueue(): Promise<void>;
  private async downloadFile(task: DownloadTask): Promise<void>;
  private async verifyChecksum(filePath: string, checksum: string, algorithm: 'sha1' | 'sha512'): Promise<boolean>;
}

interface DownloadConfig {
  maxConcurrent: number;
  threadsPerDownload: number;
  retryAttempts: number;
  timeout: number;
}

interface CreateDownloadTask {
  name: string;
  url: string;
  destination: string;
  checksum?: { algorithm: 'sha1' | 'sha512'; hash: string };
  headers?: Record<string, string>;
}

interface DownloadBatchResult {
  completed: DownloadTask[];
  failed: Array<{ task: DownloadTask; error: string }>;
}

type BatchProgressCallback = (completed: number, total: number, currentTask: DownloadTask) => void;
```

### 5. InstanceManager

게임 인스턴스 생성 및 실행 관리

```typescript
class InstanceManager {
  private javaManager: JavaManager;
  private versionManager: VersionManager;
  private activeInstances: Map<string, GameInstance>;
  
  constructor(managers: InstanceManagerDeps);
  
  // 인스턴스 준비
  async prepareInstance(profile: Profile): Promise<void>;
  async installGameFiles(profile: Profile, onProgress?: ProgressCallback): Promise<void>;
  async installLoader(profile: Profile): Promise<void>;
  async installMods(profile: Profile, onProgress?: ProgressCallback): Promise<void>;
  
  // 게임 실행
  async launchGame(profileId: string, options?: LaunchOptions): Promise<GameInstance>;
  async stopGame(profileId: string): Promise<void>;
  async killGame(profileId: string): Promise<void>;
  
  // 인스턴스 관리
  getActiveInstance(profileId: string): GameInstance | null;
  getAllActiveInstances(): GameInstance[];
  isGameRunning(profileId: string): boolean;
  
  // 로그 관리
  async getGameLogs(profileId: string, limit?: number): Promise<GameLog[]>;
  async exportLogs(profileId: string, destination: string): Promise<void>;
  
  // 이벤트
  on(event: 'launch', callback: (instance: GameInstance) => void): void;
  on(event: 'log', callback: (profileId: string, log: GameLog) => void): void;
  on(event: 'exit', callback: (profileId: string, exitCode: number) => void): void;
  on(event: 'crash', callback: (profileId: string, crashReport: string) => void): void;
  
  private async buildLaunchCommand(profile: Profile, options: LaunchOptions): Promise<string[]>;
  private async validateGameFiles(profile: Profile): Promise<boolean>;
  private async setupGameDirectory(profile: Profile): Promise<void>;
}

interface LaunchOptions {
  username?: string;
  uuid?: string;
  accessToken?: string;
  userType?: string;
  
  customJavaPath?: string;
  customJvmArgs?: string[];
  customGameArgs?: string[];
  
  serverAddress?: string;
  serverPort?: number;
  
  // 추후 추가
  hyeniAuth?: {
    token: string;
    refreshToken: string;
  };
  spaPacket?: string;
}
```

### 6. ModpackManager

모드팩 검색, 설치 및 관리

```typescript
class ModpackManager {
  private modrinthService: ModrinthService;
  private curseforgeService: CurseForgeService;
  private downloadManager: DownloadManager;
  private modManager: ModManager;
  
  constructor(services: ModpackManagerServices);
  
  // 모드팩 검색
  async searchModpacks(query: string, filters: ModpackSearchFilters): Promise<Modpack[]>;
  async getModpack(id: string, source: 'modrinth' | 'curseforge'): Promise<Modpack>;
  async getModpackVersions(id: string, source: 'modrinth' | 'curseforge'): Promise<ModpackVersion[]>;
  
  // 모드팩 설치
  async installModpack(
    modpackId: string,
    versionId: string,
    source: 'modrinth' | 'curseforge',
    profileName: string,
    onProgress?: ModpackInstallProgress
  ): Promise<Profile>;
  
  async importModpackFromFile(filePath: string, profileName: string, onProgress?: ModpackInstallProgress): Promise<Profile>;
  async importModpackFromUrl(url: string, profileName: string, onProgress?: ModpackInstallProgress): Promise<Profile>;
  
  // 모드팩 업데이트
  async checkModpackUpdate(profileId: string): Promise<ModpackUpdate | null>;
  async updateModpack(profileId: string, versionId: string, onProgress?: ModpackInstallProgress): Promise<void>;
  
  // 모드팩 파싱
  async parseModpackManifest(filePath: string): Promise<ModpackManifest>;
  
  private async downloadModpack(version: ModpackVersion, destination: string): Promise<string>;
  private async extractModpack(archivePath: string, destination: string): Promise<void>;
  private async installModpackMods(manifest: ModpackManifest, profile: Profile, onProgress?: ProgressCallback): Promise<void>;
}

interface ModpackSearchFilters {
  gameVersion?: string;
  loaderType?: LoaderType;
  categories?: string[];
  source?: 'modrinth' | 'curseforge' | 'all';
  limit?: number;
  offset?: number;
}

interface ModpackInstallProgress {
  stage: 'downloading' | 'extracting' | 'installing-loader' | 'installing-mods' | 'finalizing';
  progress: number;
  currentFile?: string;
  totalFiles?: number;
}

interface ModpackUpdate {
  currentVersion: string;
  latestVersion: string;
  versionId: string;
  changelog?: string;
}

interface ModpackManifest {
  name: string;
  version: string;
  author: string;
  
  minecraft: {
    version: string;
    loaders: Array<{
      id: string;
      primary: boolean;
    }>;
  };
  
  files: Array<{
    projectId: string;
    fileId: string;
    required: boolean;
  }>;
  
  overrides?: string;
}
```

### 7. JavaManager

Java 설치 감지 및 관리

```typescript
class JavaManager {
  private javaInstallations: JavaInstallation[];
  
  constructor();
  
  // Java 감지
  async detectJavaInstallations(): Promise<JavaInstallation[]>;
  async findJavaExecutable(version?: number): Promise<string | null>;
  async getJavaVersion(javaPath: string): Promise<string>;
  
  // Java 다운로드
  async downloadJava(version: number, architecture: 'x64' | 'arm64', destination: string): Promise<string>;
  async getRecommendedJava(minecraftVersion: string): Promise<number>;
  
  // 유효성 검사
  async validateJava(javaPath: string, requiredVersion?: number): Promise<boolean>;
  async testJavaExecution(javaPath: string): Promise<boolean>;
  
  // 관리
  async setDefaultJava(javaPath: string): Promise<void>;
  async removeJava(javaPath: string): Promise<void>;
  
  private async scanCommonLocations(): Promise<string[]>;
  private async parseJavaVersion(output: string): Promise<string>;
}
```

### 8. External Services

#### ModrinthService

```typescript
class ModrinthService {
  private baseUrl = 'https://api.modrinth.com/v2';
  private httpClient: AxiosInstance;
  
  constructor();
  
  // 프로젝트 검색
  async searchProjects(query: string, facets?: ModrinthFacets, limit?: number, offset?: number): Promise<ModrinthProject[]>;
  async getProject(id: string): Promise<ModrinthProject>;
  
  // 버전 관리
  async getProjectVersions(id: string, loaders?: string[], gameVersions?: string[]): Promise<ModrinthVersion[]>;
  async getVersion(id: string): Promise<ModrinthVersion>;
  
  // 모드팩
  async getModpack(id: string): Promise<ModrinthModpack>;
  async getModpackVersions(id: string): Promise<ModrinthVersion[]>;
  
  // 다운로드
  async getDownloadUrl(versionId: string): Promise<string>;
  
  private buildFacets(facets: ModrinthFacets): string;
}

interface ModrinthFacets {
  categories?: string[];
  versions?: string[];
  license?: string[];
  projectType?: 'mod' | 'modpack' | 'resourcepack' | 'shader';
}
```

#### CurseForgeService

```typescript
class CurseForgeService {
  private baseUrl = 'https://api.curseforge.com/v1';
  private apiKey: string;
  private httpClient: AxiosInstance;
  
  constructor(apiKey: string);
  
  // 모드 검색
  async searchMods(query: string, gameVersion?: string, modLoaderType?: number): Promise<CurseForgeMod[]>;
  async getMod(modId: number): Promise<CurseForgeMod>;
  
  // 파일 관리
  async getModFiles(modId: number, gameVersion?: string): Promise<CurseForgeFile[]>;
  async getFile(modId: number, fileId: number): Promise<CurseForgeFile>;
  
  // 모드팩
  async getModpack(modpackId: number): Promise<CurseForgeModpack>;
  async getModpackFiles(modpackId: number): Promise<CurseForgeFile[]>;
  
  // 다운로드
  async getDownloadUrl(modId: number, fileId: number): Promise<string>;
}
```

#### MinecraftService

```typescript
class MinecraftService {
  private manifestUrl = 'https://launchermeta.mojang.com/mc/game/version_manifest.json';
  private httpClient: AxiosInstance;
  
  constructor();
  
  async getVersionManifest(): Promise<VersionManifestIndex>;
  async getVersionDetails(versionId: string): Promise<VersionManifest>;
  async downloadClient(version: string, destination: string): Promise<void>;
  async downloadAssets(assetIndex: AssetIndex, destination: string, onProgress?: ProgressCallback): Promise<void>;
  async downloadLibraries(libraries: Library[], destination: string, onProgress?: ProgressCallback): Promise<void>;
}
```

---

## API 설계

### IPC API (Renderer ↔ Main)

#### Profile APIs

```typescript
// 프로필 생성
ipcRenderer.invoke('profile:create', {
  name: string,
  gameVersion: string,
  loaderType: LoaderType,
  loaderVersion?: string
}): Promise<Profile>

// 프로필 목록 조회
ipcRenderer.invoke('profile:list'): Promise<Profile[]>

// 프로필 상세 조회
ipcRenderer.invoke('profile:get', profileId: string): Promise<Profile>

// 프로필 수정
ipcRenderer.invoke('profile:update', profileId: string, data: Partial<Profile>): Promise<Profile>

// 프로필 삭제
ipcRenderer.invoke('profile:delete', profileId: string): Promise<void>

// 프로필 복제
ipcRenderer.invoke('profile:duplicate', profileId: string, newName: string): Promise<Profile>

// 게임 실행
ipcRenderer.invoke('profile:launch', profileId: string, options?: LaunchOptions): Promise<void>

// 게임 종료
ipcRenderer.invoke('profile:stop', profileId: string): Promise<void>
```

#### Mod APIs

```typescript
// 모드 검색
ipcRenderer.invoke('mod:search', query: string, filters: ModSearchFilters): Promise<ModSearchResult[]>

// 모드 설치
ipcRenderer.invoke('mod:install', profileId: string, modData: InstallModData): Promise<Mod>

// 모드 제거
ipcRenderer.invoke('mod:remove', profileId: string, modId: string): Promise<void>

// 모드 토글
ipcRenderer.invoke('mod:toggle', profileId: string, modId: string, enabled: boolean): Promise<void>

// 모드 업데이트 확인
ipcRenderer.invoke('mod:check-updates', profileId: string): Promise<ModUpdate[]>

// 모드 업데이트
ipcRenderer.invoke('mod:update', profileId: string, modId: string, versionId: string): Promise<Mod>

// 모드 일괄 업데이트
ipcRenderer.invoke('mod:update-all', profileId: string): Promise<UpdateResult>
```

#### Modpack APIs

```typescript
// 모드팩 검색
ipcRenderer.invoke('modpack:search', query: string, filters: ModpackSearchFilters): Promise<Modpack[]>

// 모드팩 상세
ipcRenderer.invoke('modpack:get', modpackId: string, source: 'modrinth' | 'curseforge'): Promise<Modpack>

// 모드팩 설치
ipcRenderer.invoke('modpack:install', {
  modpackId: string,
  versionId: string,
  source: 'modrinth' | 'curseforge',
  profileName: string
}): Promise<Profile>

// 모드팩 업데이트 확인
ipcRenderer.invoke('modpack:check-update', profileId: string): Promise<ModpackUpdate | null>

// 모드팩 업데이트
ipcRenderer.invoke('modpack:update', profileId: string, versionId: string): Promise<void>
```

#### Version APIs

```typescript
// 마인크래프트 버전 목록
ipcRenderer.invoke('version:minecraft-list', type?: 'release' | 'snapshot'): Promise<MinecraftVersion[]>

// 로더 버전 목록
ipcRenderer.invoke('version:loader-list', loaderType: LoaderType, gameVersion: string): Promise<LoaderVersion[]>
```

#### Settings APIs

```typescript
// 설정 조회
ipcRenderer.invoke('settings:get'): Promise<AppConfig>

// 설정 업데이트
ipcRenderer.invoke('settings:update', config: Partial<AppConfig>): Promise<AppConfig>

// Java 감지
ipcRenderer.invoke('settings:detect-java'): Promise<JavaInstallation[]>

// 디렉토리 선택
ipcRenderer.invoke('settings:select-directory', defaultPath?: string): Promise<string | null>

// 파일 선택
ipcRenderer.invoke('settings:select-file', filters?: FileFilter[]): Promise<string | null>
```

### IPC Events (Main → Renderer)

```typescript
// 다운로드 진행률
ipcRenderer.on('download:progress', (event, data: {
  taskId: string,
  progress: number,
  downloadedBytes: number,
  totalBytes: number,
  speed: number
}) => void)

// 다운로드 완료
ipcRenderer.on('download:complete', (event, data: {
  taskId: string,
  filePath: string
}) => void)

// 다운로드 실패
ipcRenderer.on('download:error', (event, data: {
  taskId: string,
  error: string
}) => void)

// 게임 로그
ipcRenderer.on('game:log', (event, data: {
  profileId: string,
  log: GameLog
}) => void)

// 게임 시작
ipcRenderer.on('game:started', (event, data: {
  profileId: string
}) => void)

// 게임 종료
ipcRenderer.on('game:stopped', (event, data: {
  profileId: string,
  exitCode: number,
  playTime: number
}) => void)

// 게임 크래시
ipcRenderer.on('game:crashed', (event, data: {
  profileId: string,
  crashReport: string
}) => void)

// 모드 업데이트 가능
ipcRenderer.on('mod:updates-available', (event, data: {
  profileId: string,
  updates: ModUpdate[]
}) => void)
```

---

## UI/UX 설계

### 화면 구성

```
┌─────────────────────────────────────────────────────────────┐
│  [Logo] HyeniMC                    [Settings] [User] [Min]  │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │  혜니월드   │  │  원블록     │  │  바닐라     │  [+]    │
│  │  본서버     │  │  서버       │  │  서버       │         │
│  │             │  │             │  │             │         │
│  │  1.20.1     │  │  1.19.4     │  │  1.20.4     │         │
│  │  Fabric     │  │  Fabric     │  │  Vanilla    │         │
│  │             │  │             │  │             │         │
│  │  [Play]     │  │  [Play]     │  │  [Play]     │         │
│  │  [Edit]     │  │  [Edit]     │  │  [Edit]     │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
│                                                               │
│  최근 플레이: 혜니월드 본서버 (2시간 전)                     │
│  업데이트 가능한 모드: 3개                                   │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### 주요 화면

#### 1. 메인 화면 (Home)
- 프로필 카드 그리드
- 프로필별 정보 (이름, 버전, 로더, 아이콘)
- 빠른 실행 버튼
- 프로필 추가 버튼
- 최근 활동 요약
- 업데이트 알림

#### 2. 프로필 생성 화면
**탭 1: 수동 생성**
- 프로필 이름 입력
- 마인크래프트 버전 선택 (드롭다운)
- 로더 타입 선택 (라디오 버튼)
- 로더 버전 선택 (드롭다운)
- 아이콘 선택
- 고급 설정 (메모리, JVM 인자 등)

**탭 2: 모드팩 설치**
- 검색바
- 모드팩 카드 그리드
- 필터 (버전, 로더, 카테고리)
- 모드팩 상세 정보
- 버전 선택
- 설치 버튼

**탭 3: 가져오기**
- 런처 타입 선택 (MultiMC, Prism, ATLauncher)
- 프로필 디렉토리 선택
- 프로필 목록 표시
- 가져오기 버튼

#### 3. 프로필 편집 화면
**탭 1: 일반**
- 프로필 이름
- 설명
- 아이콘
- 게임 디렉토리

**탭 2: 버전**
- 마인크래프트 버전
- 로더 타입
- 로더 버전
- 버전 변경 버튼

**탭 3: 모드**
- 설치된 모드 리스트 (테이블)
  - 체크박스 (활성화/비활성화)
  - 모드 이름
  - 버전
  - 소스
  - 업데이트 상태
  - 작업 버튼 (업데이트, 제거)
- 모드 추가 버튼
- 모드 검색
- 일괄 업데이트 버튼

**탭 4: 설정**
- Java 경로
- 메모리 할당 (슬라이더)
- JVM 인자
- 게임 인자
- 해상도

**탭 5: 로그**
- 게임 로그 뷰어
- 로그 레벨 필터
- 로그 내보내기

#### 4. 모드 검색 화면
- 검색바
- 필터 사이드바
  - 소스 (Modrinth, CurseForge)
  - 카테고리
  - 마인크래프트 버전
  - 로더
- 모드 카드 그리드
  - 아이콘
  - 이름
  - 설명
  - 다운로드 수
  - 업데이트 날짜
- 모드 상세 모달
  - 상세 설명
  - 스크린샷
  - 버전 목록
  - 의존성
  - 설치 버튼

#### 5. 게임 실행 화면
- 프로필 정보
- 실행 상태
- 실시간 로그
- 종료 버튼
- 로그 레벨 필터
- 로그 검색

#### 6. 설정 화면
**탭 1: 일반**
- 언어
- 테마
- 기본 게임 디렉토리

**탭 2: Java**
- 자동 감지 버튼
- Java 설치 목록
- Java 추가 버튼
- 기본 Java 설정

**탭 3: 다운로드**
- 최대 동시 다운로드
- 다운로드 스레드
- 프록시 설정

**탭 4: 모드 업데이트**
- 자동 업데이트 확인
- 강제 모드 자동 업데이트
- 확인 주기

**탭 5: 고급**
- 게임 실행 후 런처 유지
- 콘솔 표시
- 분석 활성화

### UI 컴포넌트 (shadcn/ui 기반)

```typescript
// 주요 컴포넌트
- Button
- Card
- Dialog
- DropdownMenu
- Input
- Label
- Select
- Slider
- Switch
- Table
- Tabs
- Toast
- Progress
- Badge
- Avatar
- Separator
- ScrollArea
- Command (검색)
```

### 디자인 시스템

**색상**
```css
/* Light Mode */
--background: 0 0% 100%;
--foreground: 222.2 84% 4.9%;
--primary: 221.2 83.2% 53.3%;
--primary-foreground: 210 40% 98%;
--secondary: 210 40% 96.1%;
--secondary-foreground: 222.2 47.4% 11.2%;

/* Dark Mode */
--background: 222.2 84% 4.9%;
--foreground: 210 40% 98%;
--primary: 217.2 91.2% 59.8%;
--primary-foreground: 222.2 47.4% 11.2%;
--secondary: 217.2 32.6% 17.5%;
--secondary-foreground: 210 40% 98%;
```

**타이포그래피**
- 제목: Pretendard Bold
- 본문: Pretendard Regular
- 코드: JetBrains Mono

---

## 파일 시스템 구조

### 앱 데이터 디렉토리

```
~/.hyenimc/                          # 앱 데이터 루트
├── config.json                      # 앱 설정
├── profiles/                        # 프로필 메타데이터
│   ├── profile-uuid-1.json
│   ├── profile-uuid-2.json
│   └── profile-uuid-3.json
├── instances/                       # 게임 인스턴스
│   ├── hyeni-main/                  # 프로필별 게임 디렉토리
│   │   ├── mods/
│   │   │   ├── mod1.jar
│   │   │   ├── mod2.jar.disabled
│   │   │   └── ...
│   │   ├── config/
│   │   ├── saves/
│   │   ├── resourcepacks/
│   │   ├── shaderpacks/
│   │   ├── logs/
│   │   └── crash-reports/
│   ├── hyeni-oneblock/
│   └── vanilla-server/
├── cache/                           # 캐시
│   ├── versions/                    # 버전 매니페스트 캐시
│   │   ├── minecraft.json
│   │   ├── fabric.json
│   │   ├── forge.json
│   │   └── neoforge.json
│   ├── mods/                        # 모드 메타데이터 캐시
│   └── modpacks/                    # 모드팩 캐시
├── runtime/                         # 런타임 파일
│   ├── java/                        # 다운로드된 Java
│   │   ├── java-17-x64/
│   │   ├── java-21-x64/
│   │   └── java-21-arm64/
│   ├── minecraft/                   # 마인크래프트 파일
│   │   ├── versions/
│   │   │   ├── 1.20.1/
│   │   │   │   ├── 1.20.1.jar
│   │   │   │   └── 1.20.1.json
│   │   │   └── ...
│   │   ├── libraries/
│   │   └── assets/
│   └── loaders/                     # 모드 로더
│       ├── fabric/
│       ├── forge/
│       └── neoforge/
├── downloads/                       # 임시 다운로드
│   └── temp/
└── logs/                            # 런처 로그
    ├── launcher.log
    └── launcher.log.1
```

### 프로필 JSON 구조

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "혜니월드 본서버",
  "description": "혜니월드 메인 서버용 프로필",
  "icon": "https://example.com/icon.png",
  
  "gameVersion": "1.20.1",
  "loaderType": "fabric",
  "loaderVersion": "0.15.0",
  
  "gameDirectory": "/Users/user/.hyenimc/instances/hyeni-main",
  
  "javaPath": "/Users/user/.hyenimc/runtime/java/java-17-arm64/bin/java",
  "jvmArgs": [
    "-Xms2G",
    "-Xmx4G",
    "-XX:+UseG1GC"
  ],
  "memory": {
    "min": 2048,
    "max": 4096
  },
  
  "gameArgs": [],
  "resolution": {
    "width": 1920,
    "height": 1080
  },
  
  "mods": [
    {
      "id": "mod-uuid-1",
      "name": "Fabric API",
      "version": "0.92.0+1.20.1",
      "fileName": "fabric-api-0.92.0+1.20.1.jar",
      "source": "modrinth",
      "sourceId": "P7dR8mSH",
      "projectSlug": "fabric-api",
      "fileId": "file-id-123",
      "enabled": true,
      "required": true,
      "dependencies": [],
      "gameVersions": ["1.20.1"],
      "loaders": ["fabric"],
      "fileSize": 2048576,
      "sha512": "abc123...",
      "installedAt": "2025-10-01T00:00:00.000Z"
    }
  ],
  
  "modpackId": null,
  "modpackSource": null,
  
  "createdAt": "2025-10-01T00:00:00.000Z",
  "updatedAt": "2025-10-05T00:00:00.000Z",
  "lastPlayed": "2025-10-06T00:00:00.000Z",
  "totalPlayTime": 7200,
  
  "authRequired": false,
  "spaEnabled": false,
  "serverAddress": null
}
```

---

## 개발 로드맵

### Phase 1: 프로젝트 초기화 및 기본 구조 (1-2주)
- [x] Electron + React + TypeScript 프로젝트 설정
- [x] 기본 UI 레이아웃 구현
- [x] IPC 통신 구조 설정
- [x] 파일 시스템 구조 설정
- [x] 설정 관리 시스템
- [x] Go 백엔드 설정 (HTTP REST API)

### Phase 2: 프로필 관리 (2-3주)
- [x] ProfileManager 구현
- [x] 프로필 CRUD 기능
- [x] 프로필 UI (목록, 생성, 편집)
- [x] 프로필 상세 페이지 (탭 네비게이션)
- [x] 프로필 데이터 영속성
- [ ] 프로필 복제 기능
- [ ] 프로필 내보내기 기능

### Phase 3: 버전 관리 및 Java (2주)
- [x] VersionManager 구현
- [x] MinecraftService 구현
- [x] JavaManager 구현
- [x] Java 자동 감지
- [x] 버전 선택 UI

### Phase 4: 기본 게임 실행 (2-3주)
- [x] GameLauncher 구현
- [x] 바닐라 마인크래프트 실행
- [x] 게임 로그 수집
- [x] 게임 콘솔 UI
- [x] 프로세스 관리

### Phase 5: 모드 로더 지원 (2-3주)
- [x] Fabric 로더 설치 및 실행
- [ ] Forge 로더 설치 및 실행
- [x] NeoForge 로더 설치 및 실행
- [x] Quilt 로더 설치 및 실행
- [x] 로더별 프로필 생성

### Phase 6: 다운로드 시스템 (1-2주)
- [x] DownloadManager 구현
- [x] 병렬 다운로드
- [x] 진행률 추적
- [x] 체크섬 검증
- [x] 재시도 로직

### Phase 7: 모드 관리 (3-4주)
- [x] ModManager 구현
- [x] 모드 메타데이터 파싱 (Fabric, NeoForge/Forge, Quilt)
- [x] TOML 파서 구현 (NeoForge용)
- [x] ModrinthService 구현
- [x] CurseForgeService 구현
- [x] 모드 검색 UI
- [x] 모드 설치/제거
- [x] 모드 활성화/비활성화
- [x] 모드 목록 UI
- [x] ResourcePackManager 구현
- [x] ShaderPackManager 구현
- [x] 의존성 해결

### Phase 8: 계정 관리 시스템 (1-2주)
- [ ] Microsoft OAuth 2.0 구현 (심사 대기 중)
- [x] AccountManager 구현
- [x] 다중 계정 지원
- [x] 오프라인 계정 지원
- [x] 계정 UI (선택, 추가, 삭제)

### Phase 9: 모드 업데이트 (2주)
- [x] 모드 업데이트 확인
- [ ] 강제 업데이트 시스템
- [x] 선택적 업데이트
- [x] 업데이트 UI
- [ ] 자동 업데이트 설정

### Phase 10: 모드팩 지원 (3-4주)
- [x] ModpackManager 구현
- [x] 모드팩 검색
- [x] 모드팩 설치
- [x] 모드팩 파싱 (Modrinth)
- [ ] 모드팩 업데이트
- [x] 모드팩 UI

### Phase 11: 외부 런처 가져오기 (2주)
- [ ] MultiMC 프로필 파싱
- [ ] Prism Launcher 프로필 파싱
- [ ] ATLauncher 프로필 파싱
- [ ] 프로필 변환
- [ ] 가져오기 UI

### Phase 12: 고급 기능 (2-3주)
- [ ] 프로필 내보내기/공유
- [ ] 프로필 복제
- [ ] 커스텀 모드 추가
- [x] 리소스팩/셰이더팩 관리
- [ ] 스크린샷 관리

### Phase 13: 최적화 및 테스트 (2-3주)
- [ ] 성능 최적화
- [ ] 메모리 관리
- [ ] 에러 처리
- [ ] 단위 테스트
- [ ] 통합 테스트
- [ ] E2E 테스트

### Phase 14: 빌드 및 배포 (1-2주)
- [x] electron-builder 설정
- [x] Windows 빌드 설정 (x64)
- [x] macOS 빌드 설정 (Intel + Apple Silicon)
- [x] Go 백엔드 빌드 스크립트 (크로스 컴파일)
- [ ] 코드 서명
- [ ] 자동 업데이트 시스템 (electron-updater)
- [ ] CI/CD 파이프라인
- [ ] 배포 자동화

### Phase 15: 혜니월드 통합 (추후)
- [ ] 혜니월드 인증 API 연동
- [ ] 디스코드 OAuth 연동
- [ ] 토큰 관리
- [ ] SPA 패킷 생성
- [ ] 서버 직접 접속

---

## 기술적 고려사항

### 보안
- API 키 안전한 저장 (electron-store with encryption)
- 파일 다운로드 체크섬 검증
- HTTPS 통신 강제
- 코드 서명

### 성능
- 가상 스크롤 (react-window)
- 이미지 레이지 로딩
- 다운로드 병렬화
- 캐싱 전략

### 에러 처리
- 전역 에러 핸들러
- 사용자 친화적 에러 메시지
- 에러 로깅
- 크래시 리포트

### 로깅
- Winston 또는 Pino
- 로그 레벨 (debug, info, warn, error)
- 로그 로테이션
- 로그 파일 관리

### 테스트
- 단위 테스트 (Vitest)
- 통합 테스트
- E2E 테스트 (Playwright)
- 커버리지 목표: 80%+

### 국제화
- i18next
- 한국어, 영어 지원
- 추후 다국어 확장

---

## 참고 자료

### API 문서
- [Modrinth API](https://docs.modrinth.com/)
- [CurseForge API](https://docs.curseforge.com/)
- [Minecraft Launcher Wiki](https://minecraft.fandom.com/wiki/Tutorials/Creating_a_launcher)
- [Fabric Meta](https://meta.fabricmc.net/docs)

### 오픈소스 런처
- [PrismLauncher](https://github.com/PrismLauncher/PrismLauncher)
- [ATLauncher](https://github.com/ATLauncher/ATLauncher)
- [GDLauncher](https://github.com/gorilla-devs/GDLauncher)

### 라이브러리
- [minecraft-launcher-core](https://github.com/Pierce01/MinecraftLauncher-core)
- [electron-builder](https://www.electron.build/)
- [shadcn/ui](https://ui.shadcn.com/)
