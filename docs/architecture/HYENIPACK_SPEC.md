# HyeniPack 스펙 정의

## 개요

HyeniPack은 HyeniMC 런처의 자체 모드팩 형식으로, 기존 Modrinth/CurseForge 형식의 장점을 흡수하면서 HyeniWorld 특화 기능을 지원합니다.

## 파일 형식

- **확장자**: `.hyenipack`
- **구조**: ZIP 압축 파일
- **매니페스트**: `hyenipack.json` (필수)

## 디렉토리 구조

```
example-modpack.hyenipack (ZIP)
├── hyenipack.json              # 메인 매니페스트 (필수)
├── icon.png                    # 모드팩 아이콘 (선택)
├── banner.png                  # 배너 이미지 (선택)
├── README.md                   # 설명 문서 (선택)
├── overrides/                  # 게임 디렉토리에 복사될 파일
│   ├── config/                 # 설정 파일
│   ├── resourcepacks/          # 리소스팩
│   ├── shaderpacks/            # 셰이더팩
│   └── options.txt             # 게임 옵션
└── server-overrides/           # 서버 전용 파일 (선택)
    └── config/
```

## hyenipack.json 스펙

### 전체 구조

```json
{
  "formatVersion": 1,
  "name": "혜니월드 공식 모드팩",
  "version": "1.0.0",
  "author": "HyeniWorld Team",
  "description": "혜니월드 서버 공식 모드팩입니다.",
  
  "minecraft": {
    "version": "1.21.1",
    "loaders": [
      {
        "type": "neoforge",
        "version": "21.1.42",
        "primary": true
      }
    ]
  },
  
  "mods": [
    {
      "id": "sodium",
      "name": "Sodium",
      "source": "modrinth",
      "projectId": "AANobbMI",
      "fileId": "abc123",
      "fileName": "sodium-fabric-0.5.8+mc1.21.1.jar",
      "url": "https://cdn.modrinth.com/...",
      "sha256": "abc...def",
      "sha1": "123...456",
      "size": 1048576,
      "required": true,
      "clientSide": true,
      "serverSide": false,
      "category": "optimization"
    },
    {
      "id": "hyenicore",
      "name": "HyeniCore",
      "source": "hyeniworld",
      "url": "https://mods.hyeniworld.com/hyenicore-1.0.0.jar",
      "sha256": "def...ghi",
      "size": 524288,
      "required": true,
      "clientSide": true,
      "serverSide": true,
      "category": "core",
      "metadata": {
        "updateChannel": "stable",
        "autoUpdate": true
      }
    }
  ],
  
  "dependencies": {
    "hyenicore": {
      "type": "required",
      "minVersion": "1.0.0"
    },
    "fabric-api": {
      "type": "optional",
      "minVersion": "0.90.0"
    }
  },
  
  "hyeniworld": {
    "serverId": "main",
    "serverAddress": "play.hyeniworld.com",
    "authRequired": true,
    "spaEnabled": true,
    "workerModRegistry": "https://worker.hyeniworld.com/mods/registry.json",
    "features": {
      "autoModUpdate": true,
      "serverResourceSync": true,
      "customAuth": true
    }
  },
  
  "settings": {
    "memory": {
      "recommended": 4096,
      "minimum": 2048
    },
    "java": {
      "minimumVersion": 21,
      "recommendedVersion": 21
    },
    "resolution": {
      "width": 1920,
      "height": 1080
    }
  },
  
  "metadata": {
    "iconFile": "icon.png",
    "bannerFile": "banner.png",
    "readmeFile": "README.md",
    "categories": ["adventure", "technology", "magic"],
    "tags": ["multiplayer", "hyeniworld", "rpg"],
    "homepage": "https://hyeniworld.com/modpack",
    "issues": "https://github.com/hyeniworld/modpack/issues",
    "discord": "https://discord.gg/hyeniworld",
    "changelogUrl": "https://hyeniworld.com/modpack/changelog"
  },
  
  "overrides": "overrides",
  "serverOverrides": "server-overrides"
}
```

## 필드 상세 설명

### 1. 기본 정보

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `formatVersion` | number | ✅ | 스펙 버전 (현재: 1) |
| `name` | string | ✅ | 모드팩 이름 |
| `version` | string | ✅ | 모드팩 버전 (Semantic Versioning) |
| `author` | string | ✅ | 제작자 |
| `description` | string | ❌ | 설명 |

### 2. minecraft 객체

```typescript
interface MinecraftConfig {
  version: string;              // 마인크래프트 버전
  loaders: LoaderConfig[];      // 모드 로더 목록
}

interface LoaderConfig {
  type: 'vanilla' | 'fabric' | 'forge' | 'neoforge' | 'quilt';
  version: string;              // 로더 버전
  primary: boolean;             // 주 로더 여부
}
```

### 3. mods 배열

각 모드는 다음 구조를 가집니다:

```typescript
interface ModEntry {
  // 기본 정보
  id: string;                   // 모드 ID (고유)
  name: string;                 // 표시 이름
  
  // 출처 정보
  source: 'modrinth' | 'curseforge' | 'hyeniworld' | 'url' | 'local';
  projectId?: string;           // Modrinth/CurseForge 프로젝트 ID
  fileId?: string;              // 파일 ID
  fileName: string;             // 파일명
  url: string;                  // 다운로드 URL
  
  // 체크섬
  sha256?: string;              // SHA-256 해시 (권장)
  sha1?: string;                // SHA-1 해시 (호환성)
  md5?: string;                 // MD5 해시 (레거시)
  size: number;                 // 파일 크기 (bytes)
  
  // 설치 옵션
  required: boolean;            // 필수 모드 여부
  clientSide: boolean;          // 클라이언트 필요 여부
  serverSide: boolean;          // 서버 필요 여부
  
  // 분류
  category?: string;            // 카테고리 (core, optimization, etc.)
  
  // HyeniWorld 전용
  metadata?: {
    updateChannel?: 'stable' | 'beta' | 'dev';
    autoUpdate?: boolean;       // 자동 업데이트 활성화
    priority?: number;          // 로드 우선순위
  };
}
```

### 4. dependencies 객체

의존성 관계를 명시합니다.

```typescript
interface Dependencies {
  [modId: string]: {
    type: 'required' | 'optional' | 'incompatible';
    minVersion?: string;        // 최소 버전
    maxVersion?: string;        // 최대 버전
    exactVersion?: string;      // 정확한 버전
  };
}
```

### 5. hyeniworld 객체 (HyeniWorld 전용)

```typescript
interface HyeniWorldConfig {
  serverId: string;             // 서버 ID
  serverAddress: string;        // 서버 주소
  authRequired: boolean;        // 인증 필요 여부
  spaEnabled: boolean;          // SPA 활성화 여부
  workerModRegistry?: string;   // Worker API 모드 레지스트리 URL
  
  features?: {
    autoModUpdate?: boolean;    // 자동 모드 업데이트
    serverResourceSync?: boolean; // 서버 리소스 동기화
    customAuth?: boolean;       // 커스텀 인증
  };
}
```

### 6. settings 객체

```typescript
interface ModpackSettings {
  memory?: {
    recommended: number;        // 권장 메모리 (MB)
    minimum: number;            // 최소 메모리 (MB)
  };
  java?: {
    minimumVersion: number;     // 최소 Java 버전
    recommendedVersion: number; // 권장 Java 버전
  };
  resolution?: {
    width: number;
    height: number;
  };
}
```

### 7. metadata 객체

```typescript
interface ModpackMetadata {
  iconFile?: string;            // 아이콘 파일 경로
  bannerFile?: string;          // 배너 파일 경로
  readmeFile?: string;          // README 파일 경로
  categories?: string[];        // 카테고리
  tags?: string[];              // 태그
  homepage?: string;            // 홈페이지 URL
  issues?: string;              // 이슈 트래커 URL
  discord?: string;             // Discord 서버 URL
  changelogUrl?: string;        // 체인지로그 URL
}
```

## 설치 프로세스

### 1. 검증 단계
```typescript
async function validateHyeniPack(filePath: string): Promise<ValidationResult> {
  // 1. ZIP 파일 확인
  // 2. hyenipack.json 존재 확인
  // 3. formatVersion 호환성 확인
  // 4. 필수 필드 검증
  // 5. 체크섬 검증 (선택)
}
```

### 2. 메타데이터 추출
```typescript
async function extractHyeniPackMetadata(filePath: string): Promise<HyeniPackManifest> {
  const zip = new AdmZip(filePath);
  const manifestEntry = zip.getEntry('hyenipack.json');
  return JSON.parse(manifestEntry.getData().toString('utf8'));
}
```

### 3. 설치 단계
1. **준비** (Validating)
   - 파일 검증
   - 메타데이터 추출
   - 디스크 공간 확인

2. **모드 다운로드** (Downloading Mods)
   - 각 모드 다운로드
   - 체크섬 검증
   - 진행률 추적

3. **로더 설치** (Installing Loader)
   - 모드 로더 다운로드 및 설치

4. **Overrides 적용** (Applying Overrides)
   - overrides 디렉토리 복사
   - server-overrides 처리 (서버용)

5. **메타 파일 생성** (Finalizing)
   - 통합 메타 파일 `.hyenimc-metadata.json` 생성
   - 프로필 설정 적용

6. **완료** (Complete)

### 4. 통합 메타 파일 생성

**중요**: 개별 `.meta.json` 파일 대신 **하나의 통합 메타 파일** 생성

`mods/.hyenimc-metadata.json`:

```json
{
  "source": "hyenipack",
  "modpackId": "hyeniworld-official",
  "modpackName": "혜니월드 공식 모드팩",
  "modpackVersion": "1.0.0",
  "installedAt": "2024-10-24T14:30:00Z",
  "mods": {
    "sodium-fabric-0.5.8.jar": {
      "source": "modrinth",
      "sourceModId": "AANobbMI",
      "sourceFileId": "abc123",
      "versionNumber": "0.5.8",
      "installedAt": "2024-10-24T14:30:00Z",
      "installedFrom": "hyenipack",
      "modpackId": "hyeniworld-official",
      "modpackVersion": "1.0.0"
    },
    "hyenicore-neoforge-2.0.0.jar": {
      "source": "hyeniworld",
      "sourceModId": "hyenicore",
      "sourceFileId": "2.0.0",
      "versionNumber": "2.0.0",
      "installedAt": "2024-10-24T14:30:00Z",
      "installedFrom": "hyenipack",
      "modpackId": "hyeniworld-official",
      "modpackVersion": "1.0.0",
      "updateChannel": "stable",
      "autoUpdate": true
    }
  }
}
```

**이점:**
- 파일 개수 감소 (모드 100개 → 메타 파일 1개)
- 더 빠른 읽기/쓰기 성능
- 모드팩 정보를 한 곳에서 관리
- 파일 시스템 부담 감소

## 생성 (Export) 기능

### 프로필에서 모드팩 생성

```typescript
async function exportToHyeniPack(
  profile: Profile,
  options: ExportOptions
): Promise<string> {
  // 1. 현재 프로필의 모드 목록 수집
  // 2. .hyenimc-metadata.json에서 출처 정보 읽기
  // 3. hyenipack.json 생성
  // 4. overrides 수집 (config, options.txt 등)
  //    - ⚠️ .meta.json 파일들은 자동 제외됨
  //    - ⚠️ .hyenimc-metadata.json도 제외됨
  //    - ⚠️ mods/ 폴더는 포함하지 않음 (manifest에 정의)
  // 5. ZIP으로 압축
  // 6. .hyenipack 파일 생성
}

interface ExportOptions {
  includeOverrides: boolean;    // overrides 포함 여부 (config, options.txt 등)
  includeServerFiles: boolean;  // 서버 파일 포함 여부
  includeResourcePacks: boolean;
  includeShaderPacks: boolean;
  includeScreenshots: boolean;
  minify: boolean;              // JSON 압축 여부
}

// ⚠️ 주의사항:
// - .meta.json 파일들은 자동으로 제외됩니다
// - .hyenimc-metadata.json도 제외됩니다
// - mods/ 폴더는 포함되지 않습니다 (hyenipack.json에 정의)
// - overrides에는 설정 파일만 포함됩니다
```

## 업데이트 메커니즘

### 모드팩 버전 확인

```typescript
interface ModpackUpdateCheck {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  updateUrl?: string;
  changelog?: string;
  breaking: boolean;            // 호환성 깨지는 업데이트 여부
}
```

### 모드 개별 업데이트

HyeniWorld Worker API와 연동:
- `workerModRegistry` URL에서 최신 모드 정보 가져오기
- 각 모드의 `updateChannel`에 따라 업데이트 확인
- `autoUpdate: true`인 모드 자동 업데이트

## 호환성

### 다른 형식에서 변환

```typescript
// Modrinth → HyeniPack
async function convertModrinthToHyeniPack(mrpackPath: string): Promise<string>;

// CurseForge → HyeniPack
async function convertCurseForgeToHyeniPack(zipPath: string): Promise<string>;

// MultiMC → HyeniPack
async function convertMultiMCToHyeniPack(zipPath: string): Promise<string>;
```

### 다른 형식으로 내보내기

```typescript
// HyeniPack → Modrinth
async function convertHyeniPackToModrinth(hyenipackPath: string): Promise<string>;
```

## 보안 고려사항

1. **체크섬 검증**: 모든 다운로드 파일에 대해 SHA-256 검증
2. **HTTPS 강제**: 모든 다운로드 URL은 HTTPS 사용
3. **소스 검증**: `hyeniworld` 소스는 인증된 도메인만 허용
4. **코드 서명**: .hyenipack 파일에 대한 선택적 디지털 서명 지원

## 예제

### 간단한 모드팩

```json
{
  "formatVersion": 1,
  "name": "Simple Performance Pack",
  "version": "1.0.0",
  "author": "YourName",
  "description": "Basic optimization mods",
  
  "minecraft": {
    "version": "1.21.1",
    "loaders": [
      {
        "type": "fabric",
        "version": "0.16.0",
        "primary": true
      }
    ]
  },
  
  "mods": [
    {
      "id": "sodium",
      "name": "Sodium",
      "source": "modrinth",
      "projectId": "AANobbMI",
      "fileName": "sodium-fabric-0.5.8+mc1.21.1.jar",
      "url": "https://cdn.modrinth.com/data/AANobbMI/versions/...",
      "sha256": "...",
      "size": 1048576,
      "required": true,
      "clientSide": true,
      "serverSide": false
    }
  ],
  
  "overrides": "overrides"
}
```

### HyeniWorld 전용 모드팩

```json
{
  "formatVersion": 1,
  "name": "혜니월드 RPG 모드팩",
  "version": "2.1.0",
  "author": "HyeniWorld Team",
  
  "minecraft": {
    "version": "1.21.1",
    "loaders": [
      {
        "type": "neoforge",
        "version": "21.1.42",
        "primary": true
      }
    ]
  },
  
  "mods": [
    {
      "id": "hyenicore",
      "name": "HyeniCore",
      "source": "hyeniworld",
      "url": "https://worker.hyeniworld.com/download/v2/mods/hyenicore/versions/2.0.0/neoforge/1.21.1/hyenicore-neoforge-2.0.0.jar",
      "sha256": "...",
      "size": 524288,
      "required": true,
      "clientSide": true,
      "serverSide": true,
      "category": "core",
      "metadata": {
        "updateChannel": "stable",
        "autoUpdate": true,
        "priority": 0
      }
    }
  ],
  
  "hyeniworld": {
    "serverId": "main",
    "serverAddress": "play.hyeniworld.com",
    "authRequired": true,
    "spaEnabled": true,
    "workerModRegistry": "https://worker.hyeniworld.com/api/v2/mods",
    "features": {
      "autoModUpdate": true,
      "serverResourceSync": true,
      "customAuth": true
    }
  },
  
  "settings": {
    "memory": {
      "recommended": 6144,
      "minimum": 4096
    },
    "java": {
      "minimumVersion": 21,
      "recommendedVersion": 21
    }
  }
}
```

## 버전 관리

### formatVersion 히스토리

- **Version 1** (현재): 초기 스펙

향후 버전에서 추가될 수 있는 기능:
- 조건부 모드 로딩 (OS, 메모리 기반)
- 모드 프리셋 (Light/Normal/Ultra)
- 서버 사이드 모드팩 동기화
- 압축 형식 개선 (tar.gz, 7z 지원)
