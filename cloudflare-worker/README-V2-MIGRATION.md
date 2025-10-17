# Worker API v2 마이그레이션 가이드

## 🎯 빠른 시작

### 기존 사용자 (v1 → v2)

**macOS / Linux**:
```bash
# 1. Worker 재배포
cd cloudflare-worker
wrangler deploy

# 2. v2 스크립트 사용
./deploy-mod-v2.sh --config deploy-config.json
./update-registry-v2.sh hyenihelper

# 완료! v1 API는 계속 작동합니다.
```

**Windows (PowerShell)**:
```powershell
# 1. Worker 재배포
cd cloudflare-worker
wrangler deploy

# 2. v2 스크립트 사용
.\deploy-mod-v2.ps1 -ConfigFile deploy-config.json
.\update-registry-v2.ps1 hyenihelper

# 완료! v1 API는 계속 작동합니다.
```

---

## 📋 v1 vs v2 비교

### API 엔드포인트

| 기능 | v1 | v2 |
|------|----|----|
| 레지스트리 | `/api/mods` | `/api/v2/mods` |
| 모드 상세 | `/api/mods/{id}/latest` | `/api/v2/mods/{id}/latest` |
| 다운로드 | `/download/mods/{id}/{ver}/{file}` | `/download/v2/mods/{id}/versions/{ver}/{loader}/{gameVer}/{file}` |

### 데이터 구조

**v1**:
```json
{
  "loaders": {
    "neoforge": "file.jar"
  }
}
```

**v2**:
```json
{
  "loaders": {
    "neoforge": {
      "gameVersions": {
        "1.21.1": {
          "file": "file-1.21.1.jar",
          "minLoaderVersion": "21.1.0",
          "dependencies": {...}
        }
      }
    }
  }
}
```

---

## 🚀 새 기능

### 1. 게임 버전별 파일
```json
"neoforge": {
  "gameVersions": {
    "1.21.1": {...},
    "1.21.4": {...},
    "1.21.11": {...}  // ← 추가 가능
  }
}
```

### 2. 로더 버전 호환성
```json
{
  "minLoaderVersion": "21.1.0",
  "maxLoaderVersion": null,
  "recommended": "21.1.42"
}
```

### 3. 파일별 의존성
```json
{
  "dependencies": {
    "required": ["geckolib"],
    "optional": ["jei"]
  }
}
```

---

## 📝 배포 예시

### 설정 파일 (deploy-config.json)
```json
{
  "modId": "hyenihelper",
  "version": "1.0.1",
  "files": [
    {
      "loader": "neoforge",
      "gameVersion": "1.21.1",
      "file": "./build/hyenihelper-neoforge-1.21.1.jar",
      "minLoaderVersion": "21.1.0"
    }
  ]
}
```

### 배포

**macOS / Linux**:
```bash
./deploy-mod-v2.sh --config deploy-config.json
./update-registry-v2.sh hyenihelper
```

**Windows (PowerShell)**:
```powershell
.\deploy-mod-v2.ps1 -ConfigFile deploy-config.json
.\update-registry-v2.ps1 hyenihelper
```

---

## 🖥️ 크로스 플랫폼 지원

### 스크립트 종류

| 플랫폼 | 배포 스크립트 | 레지스트리 스크립트 |
|--------|--------------|-------------------|
| macOS | `deploy-mod-v2.sh` | `update-registry-v2.sh` |
| Linux | `deploy-mod-v2.sh` | `update-registry-v2.sh` |
| Windows | `deploy-mod-v2.ps1` | `update-registry-v2.ps1` |

### 호환성 보장

**Bash 스크립트** (`*.sh`):
- ✅ macOS (Monterey, Ventura, Sonoma)
- ✅ Linux (Ubuntu, Debian, RHEL, Arch)
- ✅ WSL (Windows Subsystem for Linux)
- OS 자동 감지 및 적절한 명령어 사용
  - macOS: `stat -f%z`, `date -u`
  - Linux: `stat -c%s`, `date -u --iso-8601`

**PowerShell 스크립트** (`*.ps1`):
- ✅ Windows 10/11 (PowerShell 5.1+)
- ✅ PowerShell Core 7+ (크로스 플랫폼)
- 네이티브 .NET API 사용으로 완전한 호환성

### 필수 도구

모든 플랫폼:
- `wrangler` CLI
- JSON 파일 처리 (Bash: `jq`, PowerShell: 내장)

설치:
```bash
# wrangler
npm install -g wrangler

# jq (macOS/Linux만)
brew install jq          # macOS
sudo apt install jq      # Debian/Ubuntu
sudo yum install jq      # RHEL/CentOS
```

---

## ⚠️ 주의사항

1. **하위 호환성**: v1 API는 계속 작동합니다
2. **런처 업데이트 필요**: v2 기능을 사용하려면 런처 업데이트 필요
3. **파일 이름 규칙**: `{modId}-{loader}-{gameVersion}.jar` 권장
4. **스크립트 실행 권한**: Bash 스크립트는 `chmod +x` 필요

---

## 🔍 트러블슈팅

### Q: 기존 모드가 작동하지 않나요?
A: 아니요! v1 API는 계속 작동합니다. `/api/mods`는 그대로 사용 가능합니다.

### Q: v1 데이터를 v2로 변환해야 하나요?
A: 아니요. 새 버전 배포할 때만 v2 스크립트를 사용하세요.

### Q: 로더 버전을 꼭 지정해야 하나요?
A: 예. 호환성 체크를 위해 필수입니다.

### Q: Bash 스크립트 실행 시 "Permission denied" 오류
A: 실행 권한을 부여하세요:
```bash
chmod +x deploy-mod-v2.sh update-registry-v2.sh
```

### Q: PowerShell 스크립트 실행 시 "cannot be loaded" 오류
A: 실행 정책을 변경하세요 (관리자 권한):
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Q: Linux에서 "date: invalid option" 오류
A: 스크립트가 자동으로 감지하지만, 수동 수정이 필요한 경우:
```bash
# 스크립트에서 OS="linux"로 설정되었는지 확인
echo $OSTYPE
```

---

## 📚 참고 문서

- [완전 가이드](../docs/development/MOD_AUTO_UPDATE_V2_COMPLETE_GUIDE.md)
- [Worker API 구현](../docs/development/WORKER_MOD_API_IMPLEMENTATION.md)
- [변경 사항](../docs/development/MOD_AUTO_UPDATE_CHANGELOG.md)
