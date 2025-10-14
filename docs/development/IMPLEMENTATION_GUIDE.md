# 구현 가이드

혜니MC 런처 개발을 위한 단계별 구현 가이드입니다.

## 목차

1. [개발 환경 설정](#개발-환경-설정)
2. [Phase별 구현 가이드](#phase별-구현-가이드)
3. [핵심 모듈 구현 예시](#핵심-모듈-구현-예시)
4. [테스트 전략](#테스트-전략)
5. [배포 가이드](#배포-가이드)

---

## 개발 환경 설정

### 1. 프로젝트 초기화 (Electron + Go)

```bash
# 프로젝트 디렉토리 생성
mkdir HyeniMC
cd HyeniMC

# Node/Electron 초기화
npm init -y
npm install -D typescript @types/node
npx tsc --init

# Go 워크스페이스 초기화
mkdir -p backend/{cmd/internal}
cd backend && go mod init hyenimc/backend && cd ..
```

### 5. Go 백엔드(gRPC) 설정

#### 5.1 디렉토리 구조

```
backend/
├── cmd/hyenimc/main.go         # gRPC 서버 엔트리포인트
├── internal/
│   ├── server/                 # gRPC 서버 초기화
│   ├── services/               # Profile/Version/Download/Instance 등
│   ├── repo/                   # 파일시스템/캐시 접근
│   └── domain/                 # 도메인 모델(고)
└── go.mod
proto/
└── launcher/
    ├── profile.proto
    ├── version.proto
    ├── download.proto
    ├── instance.proto
    └── mod.proto
```

#### 5.2 프로토 생성(예)

`proto/launcher/download.proto`
```proto
syntax = "proto3";
package launcher;
option go_package = "hyenimc/backend/gen/launcher;launcher";

service DownloadService {
  rpc StreamProgress(ProgressRequest) returns (stream ProgressEvent);
}

message ProgressRequest { string profile_id = 1; }
message ProgressEvent { string task_id = 1; int32 progress = 2; int64 downloaded = 3; int64 total = 4; string name = 5; }
```

생성 명령(예):
```bash
buf generate # buf.gen.yaml 구성 시
# 또는 protoc 사용 예시
protoc \
  --go_out=backend/gen --go-grpc_out=backend/gen \
  --ts_proto_out=src/main/gen --ts_proto_opt=env=both,outputServices=grpc-js \
  -I proto proto/launcher/*.proto
```

#### 5.3 gRPC 서버 부팅(예시 코드 스니펫)

```go
// backend/cmd/hyenimc/main.go (요약)
lis, _ := net.Listen("tcp", "127.0.0.1:0") // 동적 포트
grpcSrv := grpc.NewServer()
launcher.RegisterDownloadServiceServer(grpcSrv, downloadSvc)
go grpcSrv.Serve(lis)
fmt.Println(lis.Addr().String()) // Electron Main이 읽어 IPC에 저장
```

#### 5.4 Electron Main 연동

- 앱 시작 시 OS별 내장 바이너리 `backend/bin/hyenimc-backend`를 spawn
- 표준 출력으로 포트를 받아 gRPC 클라이언트 초기화(`@grpc/grpc-js`)
- 서버-스트림은 IPC 이벤트(`IPC_EVENTS`)로 Renderer에 재전달

```ts
// src/main/grpc/client.ts (요약)
import { credentials } from '@grpc/grpc-js';
import { DownloadServiceClient } from './gen/launcher/download_grpc_pb';

export function createClients(addr: string) {
  return {
    download: new DownloadServiceClient(addr, credentials.createInsecure()),
  };
}
```

### 2. Electron + Vite + React 설정

```bash
# Electron 및 개발 도구
npm install -D electron electron-builder vite

# React 및 TypeScript
npm install react react-dom
npm install -D @types/react @types/react-dom
npm install -D @vitejs/plugin-react

# UI 라이브러리
npm install tailwindcss postcss autoprefixer
npm install lucide-react
npm install zustand
npm install react-hook-form zod @hookform/resolvers

# 유틸리티
npm install axios fs-extra semver
npm install -D @types/fs-extra @types/semver

# 마인크래프트 런처 코어
npm install minecraft-launcher-core
npm install node-stream-zip adm-zip

# gRPC/Proto 도구 (로컬 개발용)
brew install protobuf bufbuild/buf/buf || true
npm install -D ts-proto @grpc/grpc-js @grpc/proto-loader
```

### 3. 프로젝트 구조 생성

```bash
mkdir -p src/{main,renderer,shared,preload}
mkdir -p src/main/{managers,services,utils}
mkdir -p src/renderer/{components,stores,hooks}
mkdir -p src/shared/{types,constants}
mkdir -p resources proto/launcher
```

### 4. 설정 파일

#### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020", "DOM"],
    "jsx": "react-jsx",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "moduleResolution": "node",
    "allowSyntheticDefaultImports": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

#### vite.config.ts

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, './src/shared'),
    },
  },
});
```

#### electron-builder.yml

```yaml
appId: com.hyeniworld.hyenimc
productName: HyeniMC
directories:
  output: release
  buildResources: resources
files:
  - dist/**/*
  - package.json
  - backend/**
mac:
  category: public.app-category.games
  target:
    - target: dmg
      arch:
        - x64
        - arm64
  icon: resources/icon.icns
win:
  target:
    - target: nsis
      arch:
        - x64
  icon: resources/icon.ico
```

---

## Phase별 구현 가이드

### Phase 1: 기본 Electron 앱 구조

#### 1.1 Main Process 기본 구조

**src/main/main.ts**

```typescript
import { app, BrowserWindow } from 'electron';
import path from 'path';

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
```

#### 1.2 Preload Script

**src/preload/preload.ts**

```typescript
import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, IPC_EVENTS } from '@shared/constants';

// API 노출
contextBridge.exposeInMainWorld('electronAPI', {
  // Profile APIs
  profile: {
    create: (data: any) => ipcRenderer.invoke(IPC_CHANNELS.PROFILE_CREATE, data),
    list: () => ipcRenderer.invoke(IPC_CHANNELS.PROFILE_LIST),
    get: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.PROFILE_GET, id),
    update: (id: string, data: any) => ipcRenderer.invoke(IPC_CHANNELS.PROFILE_UPDATE, id, data),
    delete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.PROFILE_DELETE, id),
    launch: (id: string, options?: any) => ipcRenderer.invoke(IPC_CHANNELS.PROFILE_LAUNCH, id, options),
    stop: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.PROFILE_STOP, id),
  },
  
  // Event listeners
  on: (channel: string, callback: (...args: any[]) => void) => {
    ipcRenderer.on(channel, (event, ...args) => callback(...args));
  },
  
  off: (channel: string, callback: (...args: any[]) => void) => {
    ipcRenderer.removeListener(channel, callback);
  },
});
```

#### 1.3 React 앱 기본 구조

**src/renderer/App.tsx**

```typescript
import React from 'react';
import { ProfileList } from './components/profiles/ProfileList';

function App() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4">
          <h1 className="text-2xl font-bold">HyeniMC</h1>
        </div>
      </header>
      <main className="container mx-auto px-4 py-8">
        <ProfileList />
      </main>
    </div>
  );
}

export default App;
```

### Phase 2: 프로필 관리 구현 (Bridge → gRPC)

#### 2.1 ProfileManager 구현

**src/main/managers/ProfileManager.ts**

```typescript
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs-extra';
import path from 'path';
import { Profile, CreateProfileData } from '@shared/types';
import { getAppDataPath, APP_PATHS } from '@shared/constants';

export class ProfileManager {
  private profiles: Map<string, Profile>;
  private profilesPath: string;

  constructor() {
    this.profiles = new Map();
    this.profilesPath = path.join(getAppDataPath(), APP_PATHS.PROFILES);
    this.init();
  }

  private async init() {
    await fs.ensureDir(this.profilesPath);
    await this.loadProfiles();
  }

  async createProfile(data: CreateProfileData): Promise<Profile> {
    const profile: Profile = {
      id: uuidv4(),
      name: data.name,
      description: data.description,
      icon: data.icon,
      gameVersion: data.gameVersion,
      loaderType: data.loaderType,
      loaderVersion: data.loaderVersion,
      gameDirectory: path.join(
        getAppDataPath(),
        APP_PATHS.INSTANCES,
        this.sanitizeName(data.name)
      ),
      jvmArgs: [],
      memory: { min: 2048, max: 4096 },
      gameArgs: [],
      mods: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      totalPlayTime: 0,
    };

    this.profiles.set(profile.id, profile);
    await this.saveProfile(profile);
    await fs.ensureDir(profile.gameDirectory);

    return profile;
  }

  async getProfile(id: string): Promise<Profile | null> {
    return this.profiles.get(id) || null;
  }

  async getAllProfiles(): Promise<Profile[]> {
    return Array.from(this.profiles.values());
  }

  async updateProfile(id: string, data: Partial<Profile>): Promise<Profile> {
    const profile = this.profiles.get(id);
    if (!profile) {
      throw new Error(`Profile not found: ${id}`);
    }

    const updated = {
      ...profile,
      ...data,
      updatedAt: new Date(),
    };

    this.profiles.set(id, updated);
    await this.saveProfile(updated);

    return updated;
  }

  async deleteProfile(id: string): Promise<void> {
    const profile = this.profiles.get(id);
    if (!profile) {
      throw new Error(`Profile not found: ${id}`);
    }

    // 프로필 파일 삭제
    const profileFile = path.join(this.profilesPath, `${id}.json`);
    await fs.remove(profileFile);

    // 게임 디렉토리 삭제 (선택적)
    // await fs.remove(profile.gameDirectory);

    this.profiles.delete(id);
  }

  private async saveProfile(profile: Profile): Promise<void> {
    const profileFile = path.join(this.profilesPath, `${profile.id}.json`);
    await fs.writeJson(profileFile, profile, { spaces: 2 });
  }

  private async loadProfiles(): Promise<void> {
    const files = await fs.readdir(this.profilesPath);
    
    for (const file of files) {
      if (file.endsWith('.json')) {
        const profilePath = path.join(this.profilesPath, file);
        const profile = await fs.readJson(profilePath);
        
        // Date 객체 복원
        profile.createdAt = new Date(profile.createdAt);
        profile.updatedAt = new Date(profile.updatedAt);
        if (profile.lastPlayed) {
          profile.lastPlayed = new Date(profile.lastPlayed);
        }
        
        this.profiles.set(profile.id, profile);
      }
    }
  }

  private sanitizeName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  }
}
```

#### 2.2 IPC 핸들러 등록

**src/main/ipc/profileHandlers.ts**

```typescript
import { ipcMain } from 'electron';
import { ProfileManager } from '../managers/ProfileManager';
import { IPC_CHANNELS } from '@shared/constants';

export function registerProfileHandlers(profileManager: ProfileManager) {
  ipcMain.handle(IPC_CHANNELS.PROFILE_CREATE, async (event, data) => {
    return await profileManager.createProfile(data);
  });

  ipcMain.handle(IPC_CHANNELS.PROFILE_LIST, async () => {
    return await profileManager.getAllProfiles();
  });

  ipcMain.handle(IPC_CHANNELS.PROFILE_GET, async (event, id) => {
    return await profileManager.getProfile(id);
  });

  ipcMain.handle(IPC_CHANNELS.PROFILE_UPDATE, async (event, id, data) => {
    return await profileManager.updateProfile(id, data);
  });

  ipcMain.handle(IPC_CHANNELS.PROFILE_DELETE, async (event, id) => {
    return await profileManager.deleteProfile(id);
  });
}
```

#### 2.3 React 컴포넌트

**src/renderer/components/profiles/ProfileList.tsx**

```typescript
import React, { useEffect, useState } from 'react';
import { Profile } from '@shared/types';

export function ProfileList() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadProfiles();
  }, []);

  const loadProfiles = async () => {
    try {
      const data = await window.electronAPI.profile.list();
      setProfiles(data);
    } catch (error) {
      console.error('Failed to load profiles:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLaunch = async (profileId: string) => {
    try {
      await window.electronAPI.profile.launch(profileId);
    } catch (error) {
      console.error('Failed to launch profile:', error);
    }
  };

  if (loading) {
    return <div>Loading...</div>;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {profiles.map((profile) => (
        <div key={profile.id} className="border rounded-lg p-4">
          <h3 className="text-xl font-bold">{profile.name}</h3>
          <p className="text-sm text-muted-foreground">
            {profile.gameVersion} - {profile.loaderType}
          </p>
          <button
            onClick={() => handleLaunch(profile.id)}
            className="mt-4 w-full bg-primary text-primary-foreground py-2 rounded"
          >
            Play
          </button>
        </div>
      ))}
    </div>
  );
}
```

### Phase 3: Java 관리 구현 (Go 서비스)

**src/main/managers/JavaManager.ts**

```typescript
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs-extra';
import path from 'path';
import { JavaInstallation } from '@shared/types';

const execAsync = promisify(exec);

export class JavaManager {
  private javaInstallations: JavaInstallation[] = [];

  async detectJavaInstallations(): Promise<JavaInstallation[]> {
    const installations: JavaInstallation[] = [];
    const searchPaths = this.getSearchPaths();

    for (const searchPath of searchPaths) {
      try {
        const found = await this.scanDirectory(searchPath);
        installations.push(...found);
      } catch (error) {
        // 디렉토리가 없거나 접근 불가능한 경우 무시
      }
    }

    // 시스템 PATH의 java도 확인
    try {
      const systemJava = await this.checkSystemJava();
      if (systemJava) {
        installations.push(systemJava);
      }
    } catch (error) {
      // 시스템 Java가 없는 경우 무시
    }

    this.javaInstallations = installations;
    return installations;
  }

  async getJavaVersion(javaPath: string): Promise<string> {
    try {
      const { stdout } = await execAsync(`"${javaPath}" -version`);
      const versionMatch = stdout.match(/version "(.+?)"/);
      return versionMatch ? versionMatch[1] : 'unknown';
    } catch (error) {
      throw new Error(`Failed to get Java version: ${error}`);
    }
  }

  async findJavaExecutable(version?: number): Promise<string | null> {
    if (this.javaInstallations.length === 0) {
      await this.detectJavaInstallations();
    }

    if (version) {
      const compatible = this.javaInstallations.find((java) => {
        const majorVersion = parseInt(java.version.split('.')[0]);
        return majorVersion >= version;
      });
      return compatible?.path || null;
    }

    const defaultJava = this.javaInstallations.find((java) => java.isDefault);
    return defaultJava?.path || this.javaInstallations[0]?.path || null;
  }

  private getSearchPaths(): string[] {
    const paths: string[] = [];

    switch (process.platform) {
      case 'darwin':
        paths.push(
          '/Library/Java/JavaVirtualMachines',
          path.join(process.env.HOME || '', 'Library/Java/JavaVirtualMachines')
        );
        break;
      case 'win32':
        paths.push(
          'C:\\Program Files\\Java',
          'C:\\Program Files (x86)\\Java',
          'C:\\Program Files\\Eclipse Adoptium',
          'C:\\Program Files\\Zulu'
        );
        break;
      default:
        paths.push(
          '/usr/lib/jvm',
          '/usr/java',
          path.join(process.env.HOME || '', '.sdkman/candidates/java')
        );
    }

    return paths;
  }

  private async scanDirectory(dir: string): Promise<JavaInstallation[]> {
    const installations: JavaInstallation[] = [];

    if (!(await fs.pathExists(dir))) {
      return installations;
    }

    const entries = await fs.readdir(dir);

    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      const javaPath = this.getJavaExecutablePath(fullPath);

      if (await fs.pathExists(javaPath)) {
        try {
          const version = await this.getJavaVersion(javaPath);
          installations.push({
            path: javaPath,
            version,
            architecture: process.arch === 'arm64' ? 'arm64' : 'x64',
            vendor: this.detectVendor(fullPath),
            isDefault: false,
          });
        } catch (error) {
          // Java 버전을 가져올 수 없는 경우 무시
        }
      }
    }

    return installations;
  }

  private getJavaExecutablePath(javaHome: string): string {
    const executable = process.platform === 'win32' ? 'java.exe' : 'java';
    return path.join(javaHome, 'bin', executable);
  }

  private async checkSystemJava(): Promise<JavaInstallation | null> {
    try {
      const { stdout } = await execAsync('which java');
      const javaPath = stdout.trim();
      const version = await this.getJavaVersion(javaPath);

      return {
        path: javaPath,
        version,
        architecture: process.arch === 'arm64' ? 'arm64' : 'x64',
        vendor: 'System',
        isDefault: true,
      };
    } catch (error) {
      return null;
    }
  }

  private detectVendor(path: string): string {
    if (path.includes('Adoptium') || path.includes('adoptopenjdk')) {
      return 'Eclipse Adoptium';
    }
    if (path.includes('Zulu')) {
      return 'Azul Zulu';
    }
    if (path.includes('Oracle')) {
      return 'Oracle';
    }
    if (path.includes('openjdk')) {
      return 'OpenJDK';
    }
    return 'Unknown';
  }
}
```

### Phase 4: 다운로드 매니저 구현 (서버-스트리밍)

**src/main/managers/DownloadManager.ts**

```typescript
import axios from 'axios';
import fs from 'fs-extra';
import path from 'path';
import crypto from 'crypto';
import { EventEmitter } from 'events';
import { DownloadTask, CreateDownloadTask, DownloadConfig } from '@shared/types';
import { v4 as uuidv4 } from 'uuid';

export class DownloadManager extends EventEmitter {
  private queue: DownloadTask[] = [];
  private activeDownloads: Map<string, DownloadTask> = new Map();
  private config: DownloadConfig;

  constructor(config: DownloadConfig) {
    super();
    this.config = config;
  }

  async download(task: CreateDownloadTask): Promise<string> {
    const downloadTask: DownloadTask = {
      id: uuidv4(),
      type: 'mod',
      name: task.name,
      url: task.url,
      destination: task.destination,
      status: 'pending',
      progress: 0,
      downloadedBytes: 0,
      totalBytes: 0,
      speed: 0,
      sha1: task.checksum?.algorithm === 'sha1' ? task.checksum.hash : undefined,
      sha512: task.checksum?.algorithm === 'sha512' ? task.checksum.hash : undefined,
      retryCount: 0,
      maxRetries: this.config.retryAttempts,
      createdAt: new Date(),
    };

    this.queue.push(downloadTask);
    await this.processQueue();

    return downloadTask.destination;
  }

  private async processQueue(): Promise<void> {
    while (
      this.queue.length > 0 &&
      this.activeDownloads.size < this.config.maxConcurrent
    ) {
      const task = this.queue.shift();
      if (task) {
        this.activeDownloads.set(task.id, task);
        this.downloadFile(task).catch((error) => {
          console.error(`Download failed: ${task.name}`, error);
        });
      }
    }
  }

  private async downloadFile(task: DownloadTask): Promise<void> {
    try {
      task.status = 'downloading';
      task.startedAt = new Date();

      await fs.ensureDir(path.dirname(task.destination));

      const response = await axios({
        method: 'GET',
        url: task.url,
        responseType: 'stream',
        timeout: this.config.timeout,
        onDownloadProgress: (progressEvent) => {
          task.downloadedBytes = progressEvent.loaded;
          task.totalBytes = progressEvent.total || 0;
          task.progress = task.totalBytes > 0
            ? (task.downloadedBytes / task.totalBytes) * 100
            : 0;

          this.emit('progress', task);
        },
      });

      const writer = fs.createWriteStream(task.destination);
      response.data.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });

      // 체크섬 검증
      if (task.sha1 || task.sha512) {
        const valid = await this.verifyChecksum(task);
        if (!valid) {
          throw new Error('Checksum verification failed');
        }
      }

      task.status = 'completed';
      task.completedAt = new Date();
      task.progress = 100;

      this.emit('complete', task);
    } catch (error) {
      task.status = 'failed';
      task.error = error instanceof Error ? error.message : 'Unknown error';

      if (task.retryCount < task.maxRetries) {
        task.retryCount++;
        task.status = 'pending';
        this.queue.unshift(task);
      } else {
        this.emit('error', task, error);
      }
    } finally {
      this.activeDownloads.delete(task.id);
      await this.processQueue();
    }
  }

  private async verifyChecksum(task: DownloadTask): Promise<boolean> {
    const algorithm = task.sha512 ? 'sha512' : 'sha1';
    const expectedHash = task.sha512 || task.sha1;

    if (!expectedHash) {
      return true;
    }

    const hash = crypto.createHash(algorithm);
    const stream = fs.createReadStream(task.destination);

    return new Promise((resolve, reject) => {
      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => {
        const actualHash = hash.digest('hex');
        resolve(actualHash === expectedHash);
      });
      stream.on('error', reject);
    });
  }
}
```

---

## 테스트 전략

### 단위 테스트 예시

**tests/managers/ProfileManager.test.ts**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProfileManager } from '../../src/main/managers/ProfileManager';
import fs from 'fs-extra';
import path from 'path';

describe('ProfileManager', () => {
  let profileManager: ProfileManager;
  const testDataDir = path.join(__dirname, '../test-data');

  beforeEach(async () => {
    await fs.ensureDir(testDataDir);
    process.env.TEST_DATA_DIR = testDataDir;
    profileManager = new ProfileManager();
  });

  afterEach(async () => {
    await fs.remove(testDataDir);
  });

  it('should create a profile', async () => {
    const profile = await profileManager.createProfile({
      name: 'Test Profile',
      gameVersion: '1.20.1',
      loaderType: 'fabric',
    });

    expect(profile.id).toBeDefined();
    expect(profile.name).toBe('Test Profile');
    expect(profile.gameVersion).toBe('1.20.1');
  });

  it('should get all profiles', async () => {
    await profileManager.createProfile({
      name: 'Profile 1',
      gameVersion: '1.20.1',
      loaderType: 'fabric',
    });

    await profileManager.createProfile({
      name: 'Profile 2',
      gameVersion: '1.19.4',
      loaderType: 'forge',
    });

    const profiles = await profileManager.getAllProfiles();
    expect(profiles).toHaveLength(2);
  });

  it('should delete a profile', async () => {
    const profile = await profileManager.createProfile({
      name: 'To Delete',
      gameVersion: '1.20.1',
      loaderType: 'vanilla',
    });

    await profileManager.deleteProfile(profile.id);
    const retrieved = await profileManager.getProfile(profile.id);
    expect(retrieved).toBeNull();
  });
});
```

---

## 배포 가이드

### 1. 빌드 스크립트

**package.json**

```json
{
  "scripts": {
    "dev": "concurrently \"npm run dev:vite\" \"npm run dev:electron\"",
    "dev:vite": "vite",
    "dev:electron": "tsc && electron .",
    "build": "npm run build:renderer && npm run build:main",
    "build:renderer": "vite build",
    "build:main": "tsc",
    "package": "npm run build && electron-builder",
    "package:mac": "npm run build && electron-builder --mac",
    "package:win": "npm run build && electron-builder --win"
  }
}
```

### 2. 코드 서명 (macOS)

```bash
# Apple Developer 인증서 필요
export APPLE_ID="your-apple-id@email.com"
export APPLE_ID_PASSWORD="app-specific-password"
export CSC_LINK="path/to/certificate.p12"
export CSC_KEY_PASSWORD="certificate-password"

npm run package:mac
```

### 3. 자동 업데이트 설정

**src/main/updater.ts**

```typescript
import { autoUpdater } from 'electron-updater';
import { app } from 'electron';

export function setupAutoUpdater() {
  if (process.env.NODE_ENV === 'development') {
    return;
  }

  autoUpdater.checkForUpdatesAndNotify();

  autoUpdater.on('update-available', () => {
    console.log('Update available');
  });

  autoUpdater.on('update-downloaded', () => {
    console.log('Update downloaded');
    autoUpdater.quitAndInstall();
  });
}
```

---

## 다음 단계

1. **Phase 1-2 구현**: 기본 Electron 앱과 프로필 관리 완성
2. **Phase 3-4 구현**: Java 관리와 게임 실행 기능 추가
3. **Phase 5-8 구현**: 모드 관리 및 업데이트 시스템
4. **Phase 9-11 구현**: 모드팩 지원 및 고급 기능
5. **Phase 12-13 구현**: 테스트 및 배포

각 Phase를 완료한 후 충분한 테스트를 거쳐 다음 단계로 진행하세요.
