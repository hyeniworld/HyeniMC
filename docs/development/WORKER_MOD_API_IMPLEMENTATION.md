# Worker Mod API 구현 가이드

## 📋 개요

런처의 모드 자동 업데이트 시스템을 위한 Cloudflare Worker API 구현 가이드입니다.

**버전**: 2.0  
**마지막 업데이트**: 2025-10-17

---

## 🎯 API 엔드포인트

### 1. GET `/api/mods` - 모드 레지스트리

**목적**: 사용 가능한 모든 모드 목록 제공 (빠른 필터링용)

**응답 예시**:
```json
{
  "version": "2.0",
  "lastUpdated": "2025-10-17T08:00:00Z",
  "mods": [
    {
      "id": "hyenihelper",
      "name": "HyeniHelper",
      "description": "HyeniMC core functionality mod",
      "latestVersion": "1.0.1",
      "category": "required",
      
      "gameVersions": ["1.21.1", "1.21"],
      
      "loaders": [
        {
          "type": "neoforge",
          "minVersion": "21.1.0",
          "maxVersion": null,
          "recommended": "21.1.42"
        },
        {
          "type": "forge",
          "minVersion": "51.0.0",
          "maxVersion": null,
          "recommended": "51.0.22"
        }
      ],
      
      "dependencies": {
        "required": [],
        "optional": ["jei"]
      }
    },
    {
      "id": "HyeniAdditionalFunctions",
      "name": "Hyeni Additional Functions",
      "description": "Additional server features",
      "latestVersion": "1.0.0",
      "category": "required",
      
      "gameVersions": ["1.21.1"],
      
      "loaders": [
        {
          "type": "neoforge",
          "minVersion": "21.1.0",
          "maxVersion": null,
          "recommended": "21.1.42"
        }
      ],
      
      "dependencies": {
        "required": ["hyenihelper"],
        "optional": []
      }
    }
  ]
}
```

---

### 2. GET `/api/mods/{modId}/latest` - 최신 버전 상세 정보

**목적**: 특정 모드의 최신 버전 다운로드 정보 제공

**예시**: `GET /api/mods/hyenihelper/latest`

**응답**:
```json
{
  "modId": "hyenihelper",
  "name": "HyeniHelper",
  "version": "1.0.1",
  "releaseDate": "2025-10-16T08:00:00Z",
  "changelog": "- Added new features\n- Fixed bugs\n- Performance improvements",
  
  "gameVersions": ["1.21.1", "1.21"],
  
  "loaders": {
    "neoforge": {
      "file": "hyenihelper-1.0.1-neoforge.jar",
      "sha256": "a1b2c3d4e5f6...",
      "size": 524288,
      "minLoaderVersion": "21.1.0",
      "maxLoaderVersion": null,
      "downloadUrl": "/download/mods/hyenihelper/versions/1.0.1/neoforge/hyenihelper-1.0.1-neoforge.jar"
    },
    "forge": {
      "file": "hyenihelper-1.0.1-forge.jar",
      "sha256": "f6e5d4c3b2a1...",
      "size": 528384,
      "minLoaderVersion": "51.0.0",
      "maxLoaderVersion": null,
      "downloadUrl": "/download/mods/hyenihelper/versions/1.0.1/forge/hyenihelper-1.0.1-forge.jar"
    }
  },
  
  "dependencies": {
    "required": [],
    "optional": ["jei"]
  }
}
```

---

### 3. GET `/api/mods/{modId}/versions/{version}` - 특정 버전 정보

**예시**: `GET /api/mods/hyenihelper/versions/1.0.0`

**응답**: `/latest`와 동일한 구조 (version 필드만 다름)

---

### 4. GET `/download/mods/{modId}/versions/{version}/{loader}/{file}` - 파일 다운로드

**예시**: 
```
GET /download/mods/hyenihelper/versions/1.0.1/neoforge/hyenihelper-1.0.1-neoforge.jar
```

**응답**: 
- Status: 200 OK
- Content-Type: application/java-archive
- Content-Length: {size}
- Body: JAR 파일 바이너리

**인증**: 
- Header: `Authorization: Bearer {token}`
- 토큰은 Discord `/auth` 명령어로 발급

---

## 📦 데이터 구조

### TypeScript 타입 정의

```typescript
interface ModRegistry {
  version: string;
  lastUpdated: string;
  mods: ModInfo[];
}

interface ModInfo {
  id: string;
  name: string;
  description: string;
  latestVersion: string;
  category: 'required' | 'optional' | 'server-side';
  gameVersions: string[];
  loaders: LoaderCompatibility[];
  dependencies?: {
    required: string[];
    optional: string[];
  };
}

interface LoaderCompatibility {
  type: string;              // "neoforge" | "forge" | "fabric" | "quilt"
  minVersion: string;        // Minimum loader version (e.g., "21.1.0")
  maxVersion: string | null; // Maximum loader version (null = no limit)
  recommended?: string;      // Recommended loader version
}

interface ModDetailInfo {
  modId: string;
  name: string;
  version: string;
  gameVersions: string[];
  loaders: Record<string, LoaderFileInfo>;
  changelog: string;
  releaseDate: string;
  dependencies?: {
    required: string[];
    optional: string[];
  };
}

interface LoaderFileInfo {
  file: string;
  sha256: string;
  size: number;
  minLoaderVersion: string;
  maxLoaderVersion: string | null;
  downloadUrl: string;
}
```

---

## 🗄️ Cloudflare Worker 구현

### 파일 구조

```
cloudflare-worker/
  src/
    index.ts          # Main worker
    handlers/
      registry.ts     # /api/mods handler
      modDetail.ts    # /api/mods/{id}/latest handler
      download.ts     # /download/* handler
    storage/
      kv.ts          # KV namespace wrapper
      r2.ts          # R2 bucket wrapper
    auth/
      token.ts       # Token verification
  wrangler.toml      # Worker configuration
```

### Worker 코드 예시

```typescript
// src/index.ts
export interface Env {
  MOD_REGISTRY: KVNamespace;  // 메타데이터 저장
  MOD_FILES: R2Bucket;        // JAR 파일 저장
  AUTH_KV: KVNamespace;       // 토큰 검증
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    
    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
    
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }
    
    try {
      let response: Response;
      
      // GET /api/mods
      if (url.pathname === '/api/mods') {
        response = await handleGetRegistry(env);
      }
      // GET /api/mods/{modId}/latest
      else if (url.pathname.match(/^\/api\/mods\/[^/]+\/latest$/)) {
        const modId = url.pathname.split('/')[3];
        response = await handleGetLatestModInfo(modId, env);
      }
      // GET /api/mods/{modId}/versions/{version}
      else if (url.pathname.match(/^\/api\/mods\/[^/]+\/versions\/[^/]+$/)) {
        const [, , , modId, , version] = url.pathname.split('/');
        response = await handleGetModVersion(modId, version, env);
      }
      // GET /download/mods/...
      else if (url.pathname.startsWith('/download/mods/')) {
        response = await handleDownload(request, url, env);
      }
      else {
        response = new Response('Not Found', { status: 404 });
      }
      
      // Add CORS headers to response
      Object.keys(corsHeaders).forEach(key => {
        response.headers.set(key, corsHeaders[key]);
      });
      
      return response;
      
    } catch (error) {
      console.error('Worker error:', error);
      return new Response(
        JSON.stringify({ error: 'Internal Server Error' }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        }
      );
    }
  }
};

// src/handlers/registry.ts
async function handleGetRegistry(env: Env): Promise<Response> {
  const registry = await env.MOD_REGISTRY.get('registry.json', 'json');
  
  if (!registry) {
    return new Response(
      JSON.stringify({ error: 'Registry not found' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  }
  
  return new Response(JSON.stringify(registry), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300', // 5분 캐시
    }
  });
}

// src/handlers/modDetail.ts
async function handleGetLatestModInfo(modId: string, env: Env): Promise<Response> {
  // Get metadata
  const metadata = await env.MOD_REGISTRY.get(`mods/${modId}/metadata.json`, 'json');
  
  if (!metadata) {
    return new Response(
      JSON.stringify({ error: 'Mod not found' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  }
  
  const latestVersion = metadata.latestVersion;
  
  // Get version info
  const versionInfo = await env.MOD_REGISTRY.get(
    `mods/${modId}/versions/${latestVersion}.json`,
    'json'
  );
  
  if (!versionInfo) {
    return new Response(
      JSON.stringify({ error: 'Version info not found' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  }
  
  return new Response(JSON.stringify(versionInfo), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300',
    }
  });
}

// src/handlers/download.ts
async function handleDownload(request: Request, url: URL, env: Env): Promise<Response> {
  // Extract path: /download/mods/{modId}/versions/{version}/{loader}/{file}
  const parts = url.pathname.split('/');
  if (parts.length < 8) {
    return new Response('Invalid download path', { status: 400 });
  }
  
  const [, , , modId, , version, loader, file] = parts;
  
  // Verify token
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response('Unauthorized', { status: 401 });
  }
  
  const token = authHeader.substring(7);
  const isValid = await verifyToken(token, env);
  
  if (!isValid) {
    return new Response('Invalid token', { status: 403 });
  }
  
  // Get file from R2
  const r2Key = `mods/${modId}/versions/${version}/${loader}/${file}`;
  const object = await env.MOD_FILES.get(r2Key);
  
  if (!object) {
    return new Response('File not found', { status: 404 });
  }
  
  return new Response(object.body, {
    headers: {
      'Content-Type': 'application/java-archive',
      'Content-Length': object.size.toString(),
      'Cache-Control': 'public, max-age=31536000', // 1년 캐시
    }
  });
}

// src/auth/token.ts
async function verifyToken(token: string, env: Env): Promise<boolean> {
  const tokenData = await env.AUTH_KV.get(`token:${token}`, 'json');
  
  if (!tokenData) {
    return false;
  }
  
  // Check expiration
  if (tokenData.expiresAt && Date.now() > tokenData.expiresAt) {
    return false;
  }
  
  return true;
}
```

---

## 📝 KV 데이터 입력 예시

### 1. 레지스트리 업로드
```bash
wrangler kv:key put --namespace-id=<NAMESPACE_ID> \
  "registry.json" \
  @registry.json
```

**registry.json**:
```json
{
  "version": "2.0",
  "lastUpdated": "2025-10-17T08:00:00Z",
  "mods": [...]
}
```

### 2. 모드 메타데이터
```bash
wrangler kv:key put --namespace-id=<NAMESPACE_ID> \
  "mods/hyenihelper/metadata.json" \
  '{"id":"hyenihelper","latestVersion":"1.0.1"}'
```

### 3. 버전 정보
```bash
wrangler kv:key put --namespace-id=<NAMESPACE_ID> \
  "mods/hyenihelper/versions/1.0.1.json" \
  @hyenihelper-1.0.1.json
```

### 4. 파일 업로드 (R2)
```bash
wrangler r2 object put MOD_FILES/mods/hyenihelper/versions/1.0.1/neoforge/hyenihelper-1.0.1-neoforge.jar \
  --file=hyenihelper-1.0.1-neoforge.jar
```

---

## 🧪 테스트

### 1. 레지스트리 조회
```bash
curl https://hyenimc-worker.devbug.me/api/mods | jq .
```

### 2. 모드 상세 정보
```bash
curl https://hyenimc-worker.devbug.me/api/mods/hyenihelper/latest | jq .
```

### 3. 파일 다운로드
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://hyenimc-worker.devbug.me/download/mods/hyenihelper/versions/1.0.1/neoforge/hyenihelper-1.0.1-neoforge.jar \
  -o hyenihelper.jar
```

---

## ✅ 체크리스트

- [ ] Cloudflare Worker 프로젝트 생성
- [ ] KV Namespace 생성 (`MOD_REGISTRY`, `AUTH_KV`)
- [ ] R2 Bucket 생성 (`MOD_FILES`)
- [ ] Worker 코드 구현
- [ ] 레지스트리 데이터 입력
- [ ] 모드 메타데이터 입력
- [ ] 버전 정보 입력
- [ ] JAR 파일 업로드
- [ ] 엔드포인트 테스트
- [ ] 토큰 인증 테스트
- [ ] 런처 통합 테스트

---

## 🚀 배포

```bash
# Worker 배포
wrangler deploy

# 배포 확인
curl https://hyenimc-worker.devbug.me/api/mods
```

---

## 📊 필요한 필드 요약

### 필수 필드

| 필드 | 레지스트리 | 상세 정보 | 설명 |
|------|-----------|----------|------|
| `id` | ✅ | ✅ | 모드 고유 ID |
| `name` | ✅ | ✅ | 표시 이름 |
| `latestVersion` | ✅ | - | 최신 버전 |
| `version` | - | ✅ | 현재 버전 |
| `gameVersions` | ✅ | ✅ | 지원 게임 버전 |
| `loaders` | ✅ | ✅ | 로더 호환성 |
| `loaders[].type` | ✅ | - | 로더 타입 |
| `loaders[].minVersion` | ✅ | - | 최소 로더 버전 |
| `loaders[].maxVersion` | ✅ | - | 최대 로더 버전 |
| `loaders.{loader}.file` | - | ✅ | 파일명 |
| `loaders.{loader}.sha256` | - | ✅ | 체크섬 |
| `loaders.{loader}.size` | - | ✅ | 파일 크기 |

---

## 🎯 다음 단계

1. **Worker API 구현** (이 가이드 참고)
2. **데이터 입력**
3. **런처 테스트**
4. **프로덕션 배포**
