# 혜니월드 전용 모드 업데이트 시스템

## 📋 목차
1. [개요](#개요)
2. [시스템 아키텍처](#시스템-아키텍처)
3. [배포 서버 설계](#배포-서버-설계)
4. [런처 클라이언트 구현](#런처-클라이언트-구현)
5. [게임 실행 전 업데이트 플로우](#게임-실행-전-업데이트-플로우)
6. [배포 프로세스](#배포-프로세스)
7. [구현 체크리스트](#구현-체크리스트)

---

## 개요

### 목표
혜니월드 서버 전용 모드들을 자동으로 업데이트하여 사용자가 항상 최신 버전을 사용하도록 보장

### 핵심 기능
1. **자동 업데이트 체크**: 게임 실행 전 자동으로 업데이트 확인
2. **버전 관리**: 모드별 버전 추적 및 비교
3. **선택적 다운로드**: 필요한 모드만 다운로드
4. **안전한 업데이트**: 기존 모드 백업 및 롤백 지원
5. **배포 시스템**: 모드 등록 및 버전 관리 인터페이스

### 대상 모드
- HyeniHelper (혜니헬퍼)
- 기타 혜니월드 전용 커스텀 모드

---

## 시스템 아키텍처

### 전체 구조

```
┌─────────────────────────────────────────────────────────────┐
│                        배포 서버                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  REST API (공개)                                     │   │
│  │  - GET /api/mods/list                                │   │
│  │  - GET /api/mods/{modId}/versions                    │   │
│  │  - GET /api/mods/{modId}/latest                      │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Admin Panel (인증 필요)                             │   │
│  │  - 모드 등록/수정/삭제                                │   │
│  │  - 버전 업로드                                        │   │
│  │  - 통계 대시보드                                      │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  CDN / Storage                                       │   │
│  │  - /files/{modId}/{version}/{fileName}.jar          │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                             ↕ HTTPS
┌─────────────────────────────────────────────────────────────┐
│                      HyeniMC 런처                            │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Custom Mod Updater Service                          │   │
│  │  - 서버 API 호출                                      │   │
│  │  - 로컬 모드 버전 비교                                 │   │
│  │  - 다운로드 및 설치                                   │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Game Launch Hook                                    │   │
│  │  - 실행 전 업데이트 체크                              │   │
│  │  - 사용자 확인 (선택)                                 │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## 배포 서버 설계

### Option 1: 간단한 정적 호스팅 + JSON (권장 시작)

#### 장점
- 빠른 구현
- 비용 최소화 (GitHub Pages, Cloudflare Pages 등 무료)
- 유지보수 간단

#### 구조

```
https://hyeniworld-mods.pages.dev/
├── manifest.json              # 전체 모드 목록
├── mods/
│   ├── hyenihelper/
│   │   ├── meta.json          # 버전 정보
│   │   └── files/
│   │       ├── 1.0.0/
│   │       │   └── HyeniHelper-1.0.0.jar
│   │       └── 1.0.1/
│   │           └── HyeniHelper-1.0.1.jar
│   └── custom-mod-2/
│       └── ...
└── index.html                 # 간단한 다운로드 페이지
```

#### manifest.json

```json
{
  "version": "1.0",
  "lastUpdated": "2025-10-12T12:00:00Z",
  "mods": [
    {
      "id": "hyenihelper",
      "name": "HyeniHelper",
      "description": "혜니월드 서버 전용 헬퍼 모드",
      "author": "HyeniWorld Team",
      "homepage": "https://hyeniworld.com",
      "latestVersion": "1.0.1",
      "gameVersions": ["1.20.1", "1.20.4"],
      "loaders": ["fabric"],
      "metaUrl": "https://hyeniworld-mods.pages.dev/mods/hyenihelper/meta.json"
    }
  ]
}
```

#### mods/hyenihelper/meta.json

```json
{
  "id": "hyenihelper",
  "name": "HyeniHelper",
  "versions": [
    {
      "version": "1.0.1",
      "gameVersions": ["1.20.1", "1.20.4"],
      "loaders": ["fabric"],
      "releaseDate": "2025-10-12T12:00:00Z",
      "changelog": "- 버그 수정\n- 성능 개선",
      "files": [
        {
          "fileName": "HyeniHelper-1.0.1.jar",
          "url": "https://hyeniworld-mods.pages.dev/mods/hyenihelper/files/1.0.1/HyeniHelper-1.0.1.jar",
          "size": 524288,
          "sha256": "abcdef1234567890..."
        }
      ]
    },
    {
      "version": "1.0.0",
      "gameVersions": ["1.20.1"],
      "loaders": ["fabric"],
      "releaseDate": "2025-10-01T00:00:00Z",
      "changelog": "- 초기 릴리즈",
      "files": [
        {
          "fileName": "HyeniHelper-1.0.0.jar",
          "url": "https://hyeniworld-mods.pages.dev/mods/hyenihelper/files/1.0.0/HyeniHelper-1.0.0.jar",
          "size": 512000,
          "sha256": "1234567890abcdef..."
        }
      ]
    }
  ]
}
```

#### 배포 방법

1. **GitHub Repository 생성**
   ```bash
   mkdir hyeniworld-mods
   cd hyeniworld-mods
   git init
   # 위 구조대로 파일 생성
   ```

2. **Cloudflare Pages 연결**
   - Cloudflare Dashboard → Pages → Create a project
   - GitHub 연동
   - Build settings: None (정적 파일)
   - Deploy!

3. **모드 업데이트 프로세스**
   ```bash
   # 1. 새 버전 추가
   mkdir -p mods/hyenihelper/files/1.0.2
   cp HyeniHelper-1.0.2.jar mods/hyenihelper/files/1.0.2/
   
   # 2. meta.json 업데이트 (새 버전 추가)
   # 3. manifest.json 업데이트 (latestVersion 변경)
   
   # 4. Git push
   git add .
   git commit -m "Release HyeniHelper 1.0.2"
   git push origin main
   
   # 5. Cloudflare Pages 자동 배포 (1~2분)
   ```

### Option 2: 동적 백엔드 (장기)

#### 장점
- 관리자 패널 제공
- 자동화된 업로드
- 통계 수집
- 권한 관리

#### 기술 스택
- **Backend**: Go (Gin/Echo) 또는 Node.js (Express)
- **Database**: PostgreSQL 또는 SQLite
- **Storage**: S3 호환 (Cloudflare R2, AWS S3)
- **Auth**: JWT

#### API 엔드포인트

```typescript
// 공개 API
GET  /api/v1/mods                      // 모드 목록
GET  /api/v1/mods/{id}                 // 모드 상세
GET  /api/v1/mods/{id}/versions        // 버전 목록
GET  /api/v1/mods/{id}/latest          // 최신 버전
GET  /api/v1/download/{id}/{version}   // 다운로드 리다이렉트

// 관리 API (인증 필요)
POST   /api/v1/admin/mods              // 모드 생성
PUT    /api/v1/admin/mods/{id}         // 모드 수정
DELETE /api/v1/admin/mods/{id}         // 모드 삭제
POST   /api/v1/admin/mods/{id}/upload  // 버전 업로드
```

---

## 런처 클라이언트 구현

### Custom Mod Updater Service

```typescript
// src/main/services/custom-mod-updater.ts

interface CustomMod {
  id: string;
  name: string;
  latestVersion: string;
  gameVersions: string[];
  loaders: string[];
  metaUrl: string;
}

interface CustomModVersion {
  version: string;
  gameVersions: string[];
  loaders: string[];
  releaseDate: string;
  changelog: string;
  files: {
    fileName: string;
    url: string;
    size: number;
    sha256: string;
  }[];
}

export class CustomModUpdater {
  private manifestUrl = 'https://hyeniworld-mods.pages.dev/manifest.json';

  /**
   * 사용 가능한 커스텀 모드 목록 가져오기
   */
  async listAvailableMods(): Promise<CustomMod[]> {
    try {
      const response = await fetch(this.manifestUrl);
      const data = await response.json();
      return data.mods;
    } catch (error) {
      console.error('[CustomModUpdater] Failed to fetch manifest:', error);
      return [];
    }
  }

  /**
   * 특정 모드의 최신 버전 정보 가져오기
   */
  async getLatestVersion(
    modId: string,
    gameVersion: string,
    loader: string
  ): Promise<CustomModVersion | null> {
    try {
      const mods = await this.listAvailableMods();
      const mod = mods.find(m => m.id === modId);
      if (!mod) return null;

      const response = await fetch(mod.metaUrl);
      const data = await response.json();

      // 게임 버전과 로더가 호환되는 최신 버전 찾기
      const compatibleVersions = data.versions.filter((v: CustomModVersion) =>
        v.gameVersions.includes(gameVersion) &&
        v.loaders.includes(loader)
      );

      if (compatibleVersions.length === 0) return null;

      // 버전 비교 (semver)
      compatibleVersions.sort((a, b) => 
        this.compareVersions(b.version, a.version)
      );

      return compatibleVersions[0];
    } catch (error) {
      console.error(`[CustomModUpdater] Failed to get latest version for ${modId}:`, error);
      return null;
    }
  }

  /**
   * 프로필에 설치된 커스텀 모드 확인
   */
  async checkInstalledCustomMods(
    profile: Profile
  ): Promise<{ modId: string; currentVersion: string; fileName: string }[]> {
    const modsDir = path.join(profile.gameDirectory, 'mods');
    const installedMods: { modId: string; currentVersion: string; fileName: string }[] = [];

    try {
      const files = await fs.readdir(modsDir);
      const mods = await this.listAvailableMods();

      for (const mod of mods) {
        // 파일명에 모드 ID가 포함되어 있는지 확인
        const modFile = files.find(file => 
          file.toLowerCase().includes(mod.id.toLowerCase()) &&
          file.endsWith('.jar')
        );

        if (modFile) {
          // 파일명에서 버전 추출 (예: HyeniHelper-1.0.1.jar → 1.0.1)
          const versionMatch = modFile.match(/(\d+\.\d+\.\d+)/);
          const currentVersion = versionMatch ? versionMatch[1] : 'unknown';

          installedMods.push({
            modId: mod.id,
            currentVersion,
            fileName: modFile,
          });
        }
      }
    } catch (error) {
      console.error('[CustomModUpdater] Failed to check installed mods:', error);
    }

    return installedMods;
  }

  /**
   * 업데이트 가능한 모드 찾기
   */
  async checkForUpdates(profile: Profile): Promise<{
    modId: string;
    name: string;
    currentVersion: string;
    latestVersion: string;
    downloadUrl: string;
    fileName: string;
    size: number;
    sha256: string;
    changelog: string;
  }[]> {
    const installedMods = await this.checkInstalledCustomMods(profile);
    const updates = [];

    for (const installed of installedMods) {
      const latest = await this.getLatestVersion(
        installed.modId,
        profile.gameVersion,
        profile.loaderType
      );

      if (!latest) continue;

      if (this.compareVersions(latest.version, installed.currentVersion) > 0) {
        const mods = await this.listAvailableMods();
        const modInfo = mods.find(m => m.id === installed.modId);

        updates.push({
          modId: installed.modId,
          name: modInfo?.name || installed.modId,
          currentVersion: installed.currentVersion,
          latestVersion: latest.version,
          downloadUrl: latest.files[0].url,
          fileName: latest.files[0].fileName,
          size: latest.files[0].size,
          sha256: latest.files[0].sha256,
          changelog: latest.changelog,
        });
      }
    }

    return updates;
  }

  /**
   * 모드 업데이트 실행
   */
  async updateMod(
    profile: Profile,
    modId: string,
    update: {
      downloadUrl: string;
      fileName: string;
      sha256: string;
      currentFileName: string;
    }
  ): Promise<void> {
    const modsDir = path.join(profile.gameDirectory, 'mods');
    const oldFilePath = path.join(modsDir, update.currentFileName);
    const newFilePath = path.join(modsDir, update.fileName);
    const backupPath = path.join(modsDir, `${update.currentFileName}.backup`);

    try {
      // 1. 기존 파일 백업
      if (await this.fileExists(oldFilePath)) {
        await fs.rename(oldFilePath, backupPath);
      }

      // 2. 새 버전 다운로드
      await this.downloadFile(update.downloadUrl, newFilePath, update.sha256);

      // 3. 백업 파일 삭제
      if (await this.fileExists(backupPath)) {
        await fs.unlink(backupPath);
      }

      console.log(`[CustomModUpdater] Updated ${modId} successfully`);
    } catch (error) {
      console.error(`[CustomModUpdater] Update failed for ${modId}:`, error);

      // 4. 롤백
      if (await this.fileExists(backupPath)) {
        if (await this.fileExists(newFilePath)) {
          await fs.unlink(newFilePath);
        }
        await fs.rename(backupPath, oldFilePath);
      }

      throw error;
    }
  }

  /**
   * 파일 다운로드 with SHA256 검증
   */
  private async downloadFile(url: string, dest: string, expectedSha256: string): Promise<void> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Download failed: ${response.statusText}`);
    }

    const buffer = await response.arrayBuffer();
    await fs.writeFile(dest, Buffer.from(buffer));

    // SHA256 검증
    const hash = crypto.createHash('sha256');
    const fileBuffer = await fs.readFile(dest);
    hash.update(fileBuffer);
    const actualSha256 = hash.digest('hex');

    if (actualSha256 !== expectedSha256) {
      await fs.unlink(dest);
      throw new Error('SHA256 checksum mismatch');
    }
  }

  /**
   * 버전 비교 (semver)
   */
  private compareVersions(v1: string, v2: string): number {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const a = parts1[i] || 0;
      const b = parts2[i] || 0;
      if (a > b) return 1;
      if (a < b) return -1;
    }

    return 0;
  }

  private async fileExists(path: string): Promise<boolean> {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }
}
```

---

## 게임 실행 전 업데이트 플로우

### 구현

```typescript
// src/main/ipc/profile.ts (launch 핸들러 수정)

ipcMain.handle(IPC_CHANNELS.PROFILE_LAUNCH, async (event, profileId: string) => {
  try {
    const profile = await grpcClient.profile.getProfile({ id: profileId });
    
    // 1. 커스텀 모드 업데이트 체크
    if (profile.serverAddress) {
      console.log('[Launch] Checking custom mod updates...');
      
      const updater = new CustomModUpdater();
      const updates = await updater.checkForUpdates(profile);
      
      if (updates.length > 0) {
        console.log(`[Launch] Found ${updates.length} custom mod updates`);
        
        // UI에 업데이트 알림
        const shouldUpdate = await new Promise<boolean>((resolve) => {
          event.sender.send('custom-mod-updates-available', {
            profileId,
            updates,
          });
          
          // 사용자 응답 대기
          ipcMain.once(`custom-mod-update-response-${profileId}`, (_, response) => {
            resolve(response.update);
          });
        });
        
        if (shouldUpdate) {
          // 업데이트 실행
          for (const update of updates) {
            try {
              await updater.updateMod(profile, update.modId, update);
              event.sender.send('custom-mod-update-progress', {
                modId: update.modId,
                status: 'success',
              });
            } catch (error) {
              event.sender.send('custom-mod-update-progress', {
                modId: update.modId,
                status: 'failed',
                error: error.message,
              });
            }
          }
        }
      }
    }
    
    // 2. 게임 실행
    const gameLauncher = new GameLauncher();
    await gameLauncher.launch(profile);
    
    return { success: true };
  } catch (error) {
    console.error('[Launch] Failed:', error);
    throw error;
  }
});
```

### UI: 업데이트 확인 다이얼로그

```typescript
// src/renderer/components/modals/CustomModUpdateModal.tsx

interface Props {
  profileId: string;
  updates: CustomModUpdate[];
  onConfirm: (update: boolean) => void;
}

export function CustomModUpdateModal({ profileId, updates, onConfirm }: Props) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg p-6 max-w-md w-full">
        <h2 className="text-xl font-bold mb-4">🔄 모드 업데이트 가능</h2>
        
        <p className="text-sm text-gray-300 mb-4">
          혜니월드 전용 모드의 새 버전이 있습니다.
        </p>

        <div className="space-y-3 mb-6">
          {updates.map(update => (
            <div key={update.modId} className="bg-gray-700 rounded p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold">{update.name}</span>
                <span className="text-xs bg-green-600 px-2 py-1 rounded">
                  NEW
                </span>
              </div>
              <div className="text-sm text-gray-400">
                {update.currentVersion} → {update.latestVersion}
              </div>
              {update.changelog && (
                <details className="mt-2">
                  <summary className="text-xs cursor-pointer text-primary">
                    변경사항 보기
                  </summary>
                  <pre className="text-xs text-gray-400 mt-1 whitespace-pre-wrap">
                    {update.changelog}
                  </pre>
                </details>
              )}
            </div>
          ))}
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => onConfirm(false)}
            className="flex-1 py-2 bg-gray-700 rounded hover:bg-gray-600"
          >
            나중에
          </button>
          <button
            onClick={() => onConfirm(true)}
            className="flex-1 py-2 bg-primary rounded hover:bg-primary-dark font-semibold"
          >
            업데이트 및 실행
          </button>
        </div>
      </div>
    </div>
  );
}
```

---

## 배포 프로세스

### 초기 설정 (1회)

```bash
# 1. GitHub Repository 생성
gh repo create hyeniworld-mods --public

# 2. 디렉토리 구조 생성
mkdir -p mods/hyenihelper/files/1.0.0
touch manifest.json
touch mods/hyenihelper/meta.json

# 3. Cloudflare Pages 연결
# - Cloudflare Dashboard에서 설정
# - GitHub 연동
# - Branch: main
# - Build command: (none)
# - Build output directory: /
```

### 새 모드 버전 배포

```bash
#!/bin/bash
# scripts/deploy-mod.sh

MOD_ID=$1
VERSION=$2
JAR_FILE=$3

if [ -z "$MOD_ID" ] || [ -z "$VERSION" ] || [ -z "$JAR_FILE" ]; then
  echo "Usage: ./deploy-mod.sh <mod-id> <version> <jar-file>"
  exit 1
fi

# 1. 파일 복사
mkdir -p "mods/$MOD_ID/files/$VERSION"
cp "$JAR_FILE" "mods/$MOD_ID/files/$VERSION/"

# 2. SHA256 계산
SHA256=$(sha256sum "$JAR_FILE" | awk '{print $1}')
FILE_SIZE=$(stat -f%z "$JAR_FILE" 2>/dev/null || stat -c%s "$JAR_FILE")
FILE_NAME=$(basename "$JAR_FILE")

# 3. meta.json 업데이트
# (수동으로 편집하거나 jq 사용)

# 4. Git commit & push
git add .
git commit -m "Release $MOD_ID $VERSION"
git push origin main

echo "✅ Deployed $MOD_ID $VERSION"
echo "SHA256: $SHA256"
```

---

## 구현 체크리스트

### Week 1: 배포 인프라 (외부 작업)
- [ ] GitHub Repository 생성
- [ ] 디렉토리 구조 설정
- [ ] `manifest.json` 작성
- [ ] 첫 번째 모드 `meta.json` 작성
- [ ] Cloudflare Pages 연결
- [ ] 배포 스크립트 작성
- [ ] 테스트 배포

### Week 2: 런처 구현 (4일)
- [ ] `CustomModUpdater` 서비스 구현
- [ ] IPC Handler 수정 (launch 전 체크)
- [ ] `CustomModUpdateModal` 컴포넌트
- [ ] 업데이트 진행률 표시
- [ ] 에러 처리 및 롤백
- [ ] 통합 테스트

### Week 3: 선택 기능 (2일)
- [ ] 자동 업데이트 옵션 (설정)
- [ ] 업데이트 히스토리 로그
- [ ] 관리자 패널 (Option 2)

---

## SPA (Single Packet Authorization) 추가 구현

### 개요
게임 실행 시 서버에 UDP 패킷을 전송하여 보안 강화

### 구현

```typescript
// src/main/services/spa-sender.ts
import dgram from 'dgram';

export class SPASender {
  /**
   * SPA 패킷 전송
   */
  async sendSPA(
    serverAddress: string,
    port: number,
    secret: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const client = dgram.createSocket('udp4');
      
      // 패킷 생성 (서버와 약속된 형식)
      const timestamp = Date.now();
      const payload = JSON.stringify({
        secret,
        timestamp,
        version: '1.0',
      });
      
      const message = Buffer.from(payload);
      
      client.send(message, port, serverAddress, (error) => {
        if (error) {
          client.close();
          reject(error);
        } else {
          console.log(`[SPA] Packet sent to ${serverAddress}:${port}`);
          client.close();
          resolve();
        }
      });
      
      // 타임아웃
      setTimeout(() => {
        client.close();
        reject(new Error('SPA timeout'));
      }, 5000);
    });
  }
}

// Launch 시 호출
if (profile.spaEnabled && profile.serverAddress) {
  const spa = new SPASender();
  await spa.sendSPA(profile.serverAddress, 12345, 'shared-secret');
}
```

---

**작성일**: 2025-10-12  
**우선순위**: ⭐⭐⭐ (중기 - 외부 인프라 필요)  
**예상 시간**: 1주 (런처) + 외부 인프라 구축
