# Cloudflare Worker 배포 가이드

## 준비사항

1. **Cloudflare 계정**
2. **Wrangler CLI 설치**
   ```bash
   npm install -g wrangler
   ```

3. **Cloudflare 로그인**
   ```bash
   wrangler login
   ```

## R2 버킷 생성

```bash
# R2 버킷 생성
wrangler r2 bucket create hyenimc-releases

# 생성 확인
wrangler r2 bucket list
```

## Worker 배포

### 1. 환경 변수 설정

```bash
# CurseForge API Key 설정 (기존)
wrangler secret put CURSEFORGE_API_KEY
```

### 2. Worker 배포

```bash
cd cloudflare-worker
wrangler deploy
```

배포 후 URL: `https://hyenimc-worker.YOUR_SUBDOMAIN.workers.dev`

### 3. 커스텀 도메인 설정 (선택사항)

Cloudflare Dashboard → Workers & Pages → your-worker → Settings → Triggers → Custom Domains

예시: `releases.hyenimc.com`

## HyeniHelper 업로드

### 수동 업로드

```bash
# 버전 1.0.0 업로드 예시
wrangler r2 object put hyenimc-releases/hyenihelper/1.0.0/hyenihelper-fabric-1.21.1-1.0.0.jar \
  --file ./path/to/hyenihelper-fabric-1.21.1-1.0.0.jar

wrangler r2 object put hyenimc-releases/hyenihelper/1.0.0/hyenihelper-neoforge-1.21.1-1.0.0.jar \
  --file ./path/to/hyenihelper-neoforge-1.21.1-1.0.0.jar
```

### manifest.json 생성 및 업로드

**파일: `manifests/1.0.0.json`**
```json
{
  "version": "1.0.0",
  "gameVersion": "1.21.1",
  "loaders": {
    "fabric": {
      "fileName": "hyenihelper-fabric-1.21.1-1.0.0.jar",
      "sha256": "abc123...",
      "size": 1234567,
      "downloadPath": "hyenihelper/1.0.0/hyenihelper-fabric-1.21.1-1.0.0.jar"
    },
    "neoforge": {
      "fileName": "hyenihelper-neoforge-1.21.1-1.0.0.jar",
      "sha256": "def456...",
      "size": 1234567,
      "downloadPath": "hyenihelper/1.0.0/hyenihelper-neoforge-1.21.1-1.0.0.jar"
    }
  },
  "changelog": "초기 릴리스",
  "releaseDate": "2025-10-13T00:00:00Z",
  "required": false
}
```

**SHA256 생성:**
```bash
# Windows (PowerShell)
Get-FileHash hyenihelper-fabric-1.21.1-1.0.0.jar -Algorithm SHA256

# Linux/Mac
shasum -a 256 hyenihelper-fabric-1.21.1-1.0.0.jar
```

**업로드:**
```bash
wrangler r2 object put hyenimc-releases/hyenihelper/1.0.0/manifest.json \
  --file ./manifests/1.0.0.json
```

### latest.json 업데이트

**파일: `manifests/latest.json`**
```json
{
  "version": "1.0.0",
  "releaseDate": "2025-10-13T00:00:00Z",
  "minLauncherVersion": "0.1.0",
  "gameVersions": ["1.21.1"],
  "changelog": "초기 릴리스",
  "loaders": {
    "fabric": {
      "fileName": "hyenihelper-fabric-1.21.1-1.0.0.jar",
      "sha256": "abc123...",
      "size": 1234567,
      "downloadPath": "hyenihelper/1.0.0/hyenihelper-fabric-1.21.1-1.0.0.jar"
    },
    "neoforge": {
      "fileName": "hyenihelper-neoforge-1.21.1-1.0.0.jar",
      "sha256": "def456...",
      "size": 1234567,
      "downloadPath": "hyenihelper/1.0.0/hyenihelper-neoforge-1.21.1-1.0.0.jar"
    }
  }
}
```

**업로드:**
```bash
wrangler r2 object put hyenimc-releases/hyenihelper/latest.json \
  --file ./manifests/latest.json
```

## 배포 검증

### 1. Health Check
```bash
curl https://hyenimc-worker.YOUR_SUBDOMAIN.workers.dev/health
```

응답:
```json
{
  "status": "ok",
  "timestamp": 1697184000000,
  "services": {
    "curseforge": "proxy",
    "releases": "enabled"
  }
}
```

### 2. Latest Release 조회
```bash
curl https://hyenimc-worker.YOUR_SUBDOMAIN.workers.dev/api/hyenihelper/latest
```

### 3. 다운로드 테스트 (인증 필요)
```bash
curl -O "https://hyenimc-worker.YOUR_SUBDOMAIN.workers.dev/download/hyenihelper/1.0.0/hyenihelper-neoforge-1.21.1-1.0.0.jar?token=YOUR_TEST_TOKEN"
```

## 자동화 스크립트

**upload-release.sh:**
```bash
#!/bin/bash

VERSION=$1
GAME_VERSION="1.21.1"

if [ -z "$VERSION" ]; then
  echo "Usage: ./upload-release.sh <version>"
  exit 1
fi

# Upload JARs
wrangler r2 object put hyenimc-releases/hyenihelper/${VERSION}/hyenihelper-fabric-${GAME_VERSION}-${VERSION}.jar \
  --file ./build/hyenihelper-fabric-${GAME_VERSION}-${VERSION}.jar

wrangler r2 object put hyenimc-releases/hyenihelper/${VERSION}/hyenihelper-neoforge-${GAME_VERSION}-${VERSION}.jar \
  --file ./build/hyenihelper-neoforge-${GAME_VERSION}-${VERSION}.jar

# Upload manifest
wrangler r2 object put hyenimc-releases/hyenihelper/${VERSION}/manifest.json \
  --file ./manifests/${VERSION}.json

# Update latest.json
wrangler r2 object put hyenimc-releases/hyenihelper/latest.json \
  --file ./manifests/latest.json

echo "✅ Release ${VERSION} uploaded successfully!"
```

**사용:**
```bash
chmod +x upload-release.sh
./upload-release.sh 1.0.1
```

## 모니터링

### Worker Logs
```bash
wrangler tail
```

### R2 사용량 확인
Cloudflare Dashboard → R2 → Usage

## 비용 최적화

- **R2 스토리지**: 첫 10GB 무료, 이후 $0.015/GB/월
- **Workers**: 무료 티어 (10만 요청/일)
- **예상 비용**: $1-3/월 (사용자 100명 기준)

## 보안

1. **R2 버킷**: Private로 유지 (Worker를 통해서만 접근)
2. **토큰 검증**: `isValidToken()` 함수 강화 권장
3. **Rate Limiting**: 필요시 Worker에 추가 구현

## 문제 해결

### Worker 배포 실패
```bash
# Wrangler 버전 확인
wrangler --version

# 재로그인
wrangler logout
wrangler login
```

### R2 권한 오류
- Cloudflare Dashboard → R2 → Settings → Permissions 확인
- Worker에 R2 read 권한 필요

### API 응답 없음
- Worker logs 확인: `wrangler tail`
- R2 객체 존재 확인: `wrangler r2 object list hyenimc-releases`

## 참고

- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Cloudflare R2 Docs](https://developers.cloudflare.com/r2/)
- [Wrangler CLI Docs](https://developers.cloudflare.com/workers/wrangler/)
