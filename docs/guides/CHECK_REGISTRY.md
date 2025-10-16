# registry.json 확인 가이드

## 방법 1: API 호출 (터미널)

```bash
# Worker URL 확인 (cloudflare-worker/.env 파일 참고)
# 예: https://your-worker.workers.dev

# 모드 레지스트리 조회
curl https://your-worker.workers.dev/api/mods

# 예쁘게 출력 (jq 사용)
curl https://your-worker.workers.dev/api/mods | jq .
```

**예상 응답:**
```json
{
  "version": "1.0",
  "lastUpdated": "2025-10-16T12:00:00Z",
  "mods": [
    {
      "id": "hyenihelper",
      "name": "Hyenihelper",
      "description": "HyeniMC hyenihelper mod",
      "latestVersion": "1.0.0",
      "gameVersions": ["1.21.1"],
      "loaders": ["fabric", "neoforge"],
      "required": true,     ← 이 필드 확인!
      "category": "gameplay"
    }
  ]
}
```

---

## 방법 2: 브라우저

1. 브라우저에서 열기:
   ```
   https://your-worker.workers.dev/api/mods
   ```

2. JSON 응답에서 `required` 필드 확인

---

## 방법 3: R2 직접 확인 (고급)

```bash
# Wrangler CLI로 R2 객체 다운로드
cd cloudflare-worker
wrangler r2 object get hyenimc-releases/mods/registry.json --remote --file registry.json

# 파일 확인
cat registry.json | jq .
```

---

## ✅ 확인 사항

### 필수 필드 체크리스트

- [ ] `mods` 배열 존재
- [ ] 각 모드에 `id` 필드
- [ ] 각 모드에 `required` 필드 (boolean)
- [ ] `required: true`인 모드가 있는지 확인

### `required` 필드가 없다면?

**현재 상태:**
```json
{
  "mods": [
    {
      "id": "hyenihelper",
      "latestVersion": "1.0.0",
      // ❌ required 필드 없음
    }
  ]
}
```

**수정 필요:**
1. Worker 배포 스크립트 수정 (`deploy-mod.ps1` 또는 `deploy-mod.sh`)
2. `update-registry.ps1` 수정
3. 모드별로 `required` 플래그 설정

---

## 🔧 `required` 필드 추가 방법

### 옵션 A: deploy-mod 스크립트에서 파라미터로 받기

**deploy-mod.ps1 수정:**
```powershell
param(
    [string]$ModId,
    [string]$Version,
    # ... 기타 파라미터
    [bool]$Required = $false  # 새 파라미터
)

# latest.json 생성 시 required 포함
$latestJson = @{
    version = $Version
    gameVersions = $GameVersions
    loaders = $loaders
    required = $Required  # 추가
    changelog = $Changelog
} | ConvertTo-Json -Depth 10
```

**사용:**
```powershell
.\deploy-mod.ps1 `
  -ModId "hyenihelper" `
  -Version "1.0.0" `
  -Required $true  # 필수 모드로 설정
```

### 옵션 B: update-registry 스크립트에서 하드코딩

**update-registry.ps1 수정 (라인 53-62):**
```powershell
$mods += @{
    id = $modId
    name = $modId.Substring(0,1).ToUpper() + $modId.Substring(1)
    description = "HyeniMC $modId mod"
    latestVersion = $response.version
    gameVersions = $response.gameVersions
    loaders = @($response.loaders.Keys)
    required = ($modId -eq "hyenihelper")  # hyenihelper만 필수
    category = "gameplay"
}
```

### 옵션 C: latest.json에 수동 추가 후 registry 재생성

1. R2에서 각 모드의 `latest.json` 다운로드
2. `required: true` 필드 추가
3. R2에 업로드
4. `update-registry.ps1` 실행

---

## 📝 권장 사항

**옵션 A (권장)**: 
- 모드 배포 시점에 명시적으로 설정
- 유연함
- 실수 방지

**구현 예:**
```powershell
# HyeniHelper 배포 (필수)
.\deploy-mod.ps1 -ModId "hyenihelper" -Version "1.0.0" -Required $true

# HyeniUtils 배포 (선택)
.\deploy-mod.ps1 -ModId "hyeniutils" -Version "1.0.0" -Required $false
```
