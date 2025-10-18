# HyeniMC 배포 시스템 구조

## 개요

HyeniMC는 **하이브리드 배포 방식**을 사용합니다:
- **런처 (HyeniMC)**: GitHub Releases (Public)
- **전용 모드 (HyeniHelper)**: Cloudflare R2 (Private)

---

## 🏗️ 시스템 구조

```
┌─────────────────────────────────────────────────────────────┐
│                         사용자                               │
└───────────────────┬─────────────────────────────────────────┘
                    │
                    │ 1. 런처 다운로드
                    ↓
┌─────────────────────────────────────────────────────────────┐
│              GitHub Releases (Public)                        │
│  https://github.com/hyeniworld/HyeniMC/releases             │
│                                                              │
│  ✅ 런처 설치 파일 (.exe, .dmg)                              │
│  ✅ 자동 업데이트 메타데이터 (latest.yml)                    │
│  ✅ 소스코드 공개 (신뢰성 ↑)                                 │
└─────────────────────────────────────────────────────────────┘
                    │
                    │ 2. 인증 (Discord Bot)
                    ↓
┌─────────────────────────────────────────────────────────────┐
│          hyenimc://auth?token={USER_TOKEN}                   │
│                                                              │
│  → Config 파일 생성: hyenihelper-config.json                │
│  → 토큰 저장                                                 │
└─────────────────────────────────────────────────────────────┘
                    │
                    │ 3. 모드 업데이트 체크 (인증됨)
                    ↓
┌─────────────────────────────────────────────────────────────┐
│       Cloudflare Worker API (Public Endpoint)                │
│       https://releases.hyenimc.com                           │
│                                                              │
│  GET /api/hyenihelper/latest                                 │
│    → Returns: { version, downloadUrl, sha256, ... }          │
│                                                              │
│  GET /download/hyenihelper/{version}/{file}?token={TOKEN}    │
│    → Validates token                                         │
│    → Returns: JAR file from R2                               │
└─────────────────────────────────────────────────────────────┘
                    │
                    │ Token 검증 후 다운로드
                    ↓
┌─────────────────────────────────────────────────────────────┐
│          Cloudflare R2 Bucket (Private)                      │
│          hyenimc-releases                                    │
│                                                              │
│  hyenihelper/                                                │
│    ├── 1.0.0/                                                │
│    │   ├── hyenihelper-fabric-1.21.1-1.0.0.jar              │
│    │   ├── hyenihelper-neoforge-1.21.1-1.0.0.jar            │
│    │   └── manifest.json                                    │
│    ├── 1.0.1/                                                │
│    │   └── ...                                               │
│    └── latest.json                                           │
└─────────────────────────────────────────────────────────────┘
```

---

## 📦 파일 구조

### GitHub Releases (Public)

```
HyeniMC Repository
├── releases/
│   ├── v0.1.0/
│   │   ├── HyeniMC-Setup-0.1.0.exe        (Windows 설치 파일)
│   │   ├── HyeniMC-0.1.0.dmg              (macOS 설치 파일)
│   │   ├── HyeniMC-0.1.0.AppImage         (Linux 설치 파일)
│   │   └── latest.yml                     (electron-updater 메타데이터)
│   └── v0.1.1/
│       └── ...
```

**다운로드 URL 예시:**
```
https://github.com/hyeniworld/HyeniMC/releases/download/v0.1.0/HyeniMC-Setup-0.1.0.exe
```

---

### Cloudflare R2 (Private)

```
R2 Bucket: hyenimc-releases
├── hyenihelper/
│   ├── 1.0.0/
│   │   ├── hyenihelper-fabric-1.21.1-1.0.0.jar
│   │   ├── hyenihelper-neoforge-1.21.1-1.0.0.jar
│   │   └── manifest.json
│   ├── 1.0.1/
│   │   ├── hyenihelper-fabric-1.21.1-1.0.1.jar
│   │   ├── hyenihelper-neoforge-1.21.1-1.0.1.jar
│   │   └── manifest.json
│   └── latest.json
```

#### latest.json
```json
{
  "version": "1.0.1",
  "releaseDate": "2025-10-13T00:00:00Z",
  "minLauncherVersion": "0.1.0",
  "gameVersions": ["1.21.1"],
  "changelog": "버그 수정 및 성능 개선"
}
```

#### manifest.json (각 버전별)
```json
{
  "version": "1.0.1",
  "gameVersion": "1.21.1",
  "loaders": {
    "fabric": {
      "fileName": "hyenihelper-fabric-1.21.1-1.0.1.jar",
      "sha256": "abc123...",
      "size": 1234567,
      "downloadPath": "hyenihelper/1.0.1/hyenihelper-fabric-1.21.1-1.0.1.jar"
    },
    "neoforge": {
      "fileName": "hyenihelper-neoforge-1.21.1-1.0.1.jar",
      "sha256": "def456...",
      "size": 1234567,
      "downloadPath": "hyenihelper/1.0.1/hyenihelper-neoforge-1.21.1-1.0.1.jar"
    }
  },
  "changelog": "버그 수정 및 성능 개선",
  "required": false
}
```

---

## 🔐 인증 흐름

### 1. 사용자 인증
```
Discord Bot → /인증 명령어 → 버튼 클릭
  ↓
hyenimc://auth?token={USER_TOKEN}&server=play.hyeniworld.com
  ↓
런처: config/hyenihelper-config.json 생성
{
  "token": "user-specific-token",
  "enabled": true,
  ...
}
```

### 2. 업데이트 체크 (인증 불필요)
```
런처 → GET https://releases.hyenimc.com/api/hyenihelper/latest
  ↓
{
  "version": "1.0.1",
  "changelog": "...",
  ...
}
```

### 3. 다운로드 (인증 필요)
```
런처 → GET https://releases.hyenimc.com/download/hyenihelper/1.0.1/hyenihelper-neoforge-1.21.1-1.0.1.jar?token={USER_TOKEN}
  ↓
Worker: 토큰 검증 (config에서 읽음)
  ↓
유효하면: R2에서 파일 스트리밍
무효하면: 401 Unauthorized
```

---

## 🌐 Cloudflare Worker API

### 엔드포인트

#### 1. 최신 버전 조회
```
GET /api/hyenihelper/latest
```

**응답:**
```json
{
  "version": "1.0.1",
  "releaseDate": "2025-10-13T00:00:00Z",
  "minLauncherVersion": "0.1.0",
  "gameVersions": ["1.21.1"],
  "changelog": "버그 수정 및 성능 개선",
  "loaders": {
    "fabric": {
      "downloadUrl": "/download/hyenihelper/1.0.1/hyenihelper-fabric-1.21.1-1.0.1.jar",
      "sha256": "abc123...",
      "size": 1234567
    },
    "neoforge": {
      "downloadUrl": "/download/hyenihelper/1.0.1/hyenihelper-neoforge-1.21.1-1.0.1.jar",
      "sha256": "def456...",
      "size": 1234567
    }
  }
}
```

#### 2. 버전 목록 조회
```
GET /api/hyenihelper/versions
```

**응답:**
```json
{
  "versions": [
    {
      "version": "1.0.1",
      "releaseDate": "2025-10-13T00:00:00Z",
      "gameVersions": ["1.21.1"]
    },
    {
      "version": "1.0.0",
      "releaseDate": "2025-10-10T00:00:00Z",
      "gameVersions": ["1.21.1"]
    }
  ]
}
```

#### 3. 파일 다운로드 (인증 필요)
```
GET /download/hyenihelper/{version}/{fileName}?token={USER_TOKEN}
```

**헤더:**
```
Authorization: Bearer {USER_TOKEN}
```

**응답:**
- 성공: JAR 파일 바이너리
- 실패: 401 Unauthorized

---

## 🔧 런처 구현

### HyeniHelper 업데이트 체크

```typescript
// src/main/services/hyeni-updater.ts

interface HyeniHelperUpdate {
  available: boolean;
  currentVersion: string;
  latestVersion: string;
  downloadUrl: string;
  sha256: string;
  size: number;
  changelog: string;
  required: boolean;
}

export class HyeniUpdater {
  private apiUrl = 'https://releases.hyenimc.com/api';
  
  async checkHyeniHelperUpdate(
    profileId: string,
    gameVersion: string,
    loaderType: string
  ): Promise<HyeniHelperUpdate | null> {
    // 1. 로컬 버전 확인
    const localVersion = await this.getLocalVersion(profileId);
    
    // 2. 최신 버전 조회
    const response = await fetch(`${this.apiUrl}/hyenihelper/latest`);
    const latest = await response.json();
    
    // 3. 버전 비교
    if (this.isNewerVersion(latest.version, localVersion)) {
      const loaderInfo = latest.loaders[loaderType];
      
      return {
        available: true,
        currentVersion: localVersion,
        latestVersion: latest.version,
        downloadUrl: loaderInfo.downloadUrl,
        sha256: loaderInfo.sha256,
        size: loaderInfo.size,
        changelog: latest.changelog,
        required: latest.required || false
      };
    }
    
    return null;
  }
  
  async installUpdate(
    profileId: string,
    update: HyeniHelperUpdate
  ): Promise<void> {
    // 1. 토큰 읽기
    const token = await this.getUserToken(profileId);
    if (!token) {
      throw new Error('인증 토큰이 없습니다. /인증 명령어로 인증하세요.');
    }
    
    // 2. 다운로드
    const downloadUrl = `https://releases.hyenimc.com${update.downloadUrl}?token=${token}`;
    const tempPath = await this.downloadFile(downloadUrl, update.sha256);
    
    // 3. 기존 파일 백업
    const modsDir = path.join(getProfilePath(profileId), 'mods');
    const oldFiles = await this.findHyeniHelperFiles(modsDir);
    
    for (const file of oldFiles) {
      await fs.rename(file, `${file}.backup`);
    }
    
    // 4. 새 파일 설치
    const fileName = path.basename(update.downloadUrl);
    await fs.copyFile(tempPath, path.join(modsDir, fileName));
    
    // 5. 백업 삭제
    for (const file of oldFiles) {
      await fs.remove(`${file}.backup`);
    }
  }
  
  private async getUserToken(profileId: string): Promise<string | null> {
    const configPath = path.join(
      getProfilePath(profileId),
      'config',
      'hyenihelper-config.json'
    );
    
    if (await fs.pathExists(configPath)) {
      const config = await fs.readJSON(configPath);
      return config.token || null;
    }
    
    return null;
  }
}
```

---

## 📤 업로드 워크플로우

### HyeniHelper JAR 업로드 (수동/자동)

```bash
# Wrangler CLI 설치
npm install -g wrangler

# R2에 업로드
wrangler r2 object put hyenimc-releases/hyenihelper/1.0.1/hyenihelper-neoforge-1.21.1-1.0.1.jar \
  --file ./build/hyenihelper-neoforge-1.21.1-1.0.1.jar

# manifest.json 업로드
wrangler r2 object put hyenimc-releases/hyenihelper/1.0.1/manifest.json \
  --file ./manifests/1.0.1.json

# latest.json 업데이트
wrangler r2 object put hyenimc-releases/hyenihelper/latest.json \
  --file ./manifests/latest.json
```

### GitHub Actions (자동화)

```yaml
# .github/workflows/release-hyenihelper.yml
name: Release HyeniHelper

on:
  workflow_dispatch:
    inputs:
      version:
        description: 'Version (e.g., 1.0.1)'
        required: true
      gameVersion:
        description: 'Game Version (e.g., 1.21.1)'
        required: true

jobs:
  upload:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Build
        run: ./gradlew build
      
      - name: Generate SHA256
        run: |
          sha256sum build/libs/*.jar > checksums.txt
      
      - name: Install Wrangler
        run: npm install -g wrangler
      
      - name: Upload to R2
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
        run: |
          VERSION=${{ github.event.inputs.version }}
          GAME_VERSION=${{ github.event.inputs.gameVersion }}
          
          # Upload JARs
          wrangler r2 object put hyenimc-releases/hyenihelper/${VERSION}/hyenihelper-fabric-${GAME_VERSION}-${VERSION}.jar \
            --file build/libs/hyenihelper-fabric-${GAME_VERSION}-${VERSION}.jar
          
          wrangler r2 object put hyenimc-releases/hyenihelper/${VERSION}/hyenihelper-neoforge-${GAME_VERSION}-${VERSION}.jar \
            --file build/libs/hyenihelper-neoforge-${GAME_VERSION}-${VERSION}.jar
          
          # Upload manifest
          wrangler r2 object put hyenimc-releases/hyenihelper/${VERSION}/manifest.json \
            --file manifests/${VERSION}.json
          
          # Update latest.json
          wrangler r2 object put hyenimc-releases/hyenihelper/latest.json \
            --file manifests/latest.json
```

---

## 💰 비용 예상

### Cloudflare R2
- **저장 용량**: 첫 10GB 무료, 이후 $0.015/GB/월
- **다운로드**: Class A (write) $4.50/million, Class B (read) $0.36/million
- **예상**: 월 $1-3 (사용자 100명 기준)

### GitHub
- **Public Repository**: 무료
- **Releases**: 무료
- **Actions**: 월 2,000분 무료 (충분함)

**총 예상 비용: ~$1-3/월**

---

## 🔒 보안 고려사항

### 토큰 관리
- ✅ 토큰은 config 파일에 저장 (로컬만)
- ✅ HTTPS만 사용
- ✅ 토큰 만료 지원 (선택)
- ✅ Rate limiting (Worker에서)

### 파일 무결성
- ✅ SHA256 체크섬 검증
- ✅ 서명 검증 (선택)

### 접근 제어
- ✅ R2 버킷 private
- ✅ Worker를 통해서만 접근
- ✅ 토큰 검증 필수

---

## 📝 다음 단계

1. ✅ 시스템 구조 문서 작성 (완료)
2. ⏭️ Cloudflare Worker 구현
3. ⏭️ 런처 업데이트 체크 서비스 구현
4. ⏭️ UI 컴포넌트 추가
5. ⏭️ GitHub Actions 설정
6. ⏭️ 테스트 및 배포

---

**작성일**: 2025-10-13  
**버전**: 1.0.0  
**작성자**: HyeniMC Team
