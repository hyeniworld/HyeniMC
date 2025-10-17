# 🚀 자동화된 모드 배포 가이드

## 📋 준비사항

1. **Wrangler CLI 설치 및 로그인**
   ```powershell
   npm install -g wrangler
   wrangler login
   ```

2. **R2 버킷 생성** (최초 1회)
   ```powershell
   wrangler r2 bucket create hyenimc-releases
   ```

3. **Worker 배포** (최초 1회 또는 Worker 코드 변경 시)
   ```powershell
   cd cloudflare-worker
   wrangler deploy
   ```

---

## 🎯 사용법

### 1️⃣ 모드 배포 (단일 명령어!)

```powershell
cd cloudflare-worker

.\deploy-mod.ps1 `
  -ModId "hyenihelper" `
  -Version "1.0.1" `
  -GameVersion "1.21.1" `
  -Changelog "버그 수정 및 성능 개선" `
  -Required $false `
  -JarFiles @("C:\path\to\hyenihelper-neoforge.jar", "C:\path\to\hyenihelper-fabric.jar")
```

**파라미터 설명:**
- `-ModId`: 모드 ID (소문자, 하이픈 없음)
- `-Version`: 버전 번호 (Semantic Versioning)
- `-GameVersion`: 마인크래프트 버전
- `-Changelog`: 변경사항 설명
- `-Required`: 필수 업데이트 여부 (`$true` 또는 `$false`)
- `-JarFiles`: JAR 파일 경로 배열 (직접 지정)

**JAR 파일명 자동 감지:**
스크립트가 다음 패턴으로 로더 타입을 자동 감지합니다:
- `*-fabric-*.jar` → fabric
- `*-neoforge.jar` → neoforge
- `fabric-*.jar` → fabric
- 파일명에 `fabric` 포함 → fabric

감지 실패 시 수동 입력을 요청합니다.

**표준 파일명으로 자동 변환:**
- 원본: `mymod-weird-name.jar`
- 업로드: `hyenihelper-neoforge-1.21.1-1.0.1.jar`

---

### 2️⃣ 레지스트리 업데이트 (새 모드 추가 시)

새로운 모드를 처음 배포한 후 실행:

```powershell
.\update-registry.ps1
```

프롬프트에 배포된 모든 모드 ID를 입력:
```
모드 목록: hyenihelper,hyenicore,hyeniutils
```

---

## 📦 실제 배포 예시

### 예시 1: HyeniHelper 1.0.1 배포

```powershell
# 1. JAR 파일 확인
dir C:\hyenihelper\build
# 출력:
#   HyeniHelper-NeoForge-1.21.1-1.0.1.jar
#   HyeniHelper-Fabric-1.21.1-1.0.1.jar

# 2. 배포 (파일명이 불규칙해도 OK!)
.\deploy-mod.ps1 `
  -ModId "hyenihelper" `
  -Version "1.0.1" `
  -GameVersion "1.21.1" `
  -Changelog "초기 릴리스" `
  -Required $true `
  -JarFiles @(
    "C:\hyenihelper\build\HyeniHelper-NeoForge-1.21.1-1.0.1.jar",
    "C:\hyenihelper\build\HyeniHelper-Fabric-1.21.1-1.0.1.jar"
  )

# 출력:
# 🚀 HyeniMC 모드 배포 시작
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 📦 모드 ID: hyenihelper
# 🔢 버전: 1.0.1
# 🎮 게임 버전: 1.21.1
# 
# ✅ 발견된 JAR 파일: 2개
# 
# 📝 처리 중: HyeniHelper-NeoForge-1.21.1-1.0.1.jar
#    🔍 로더: neoforge
#    🔐 SHA256 계산 중...
#    ✅ SHA256: FC4864D0AF02D53A227A0B79841413AA...
#    📦 표준명: hyenihelper-neoforge-1.21.1-1.0.1.jar
# 
# 📝 처리 중: HyeniHelper-Fabric-1.21.1-1.0.1.jar
#    🔍 로더: fabric
#    🔐 SHA256 계산 중...
#    ✅ SHA256: ABC123DEF456789...
#    📦 표준명: hyenihelper-fabric-1.21.1-1.0.1.jar
# 
# 📄 manifest.json 생성 중...
#    ✅ 생성 완료
# 
# ☁️  R2 업로드 시작
# 
#    📤 hyenihelper-neoforge-1.21.1-1.0.1.jar [neoforge]
#       ✅ 업로드 완료
#    📤 hyenihelper-fabric-1.21.1-1.0.1.jar [fabric]
#       ✅ 업로드 완료
#    📤 manifest.json
#       ✅ 업로드 완료
# 
# 🔄 latest.json 업데이트
#    ✅ 업데이트 완료
# 
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 🎉 배포 완료!
# 
# 📊 배포 정보:
#    • 모드: hyenihelper
#    • 버전: 1.0.1
#    • 로더: fabric, neoforge
#    • 파일 수: 3 (JAR + manifest)
# 
# 🔗 API 엔드포인트:
#    HYENIMC_WORKER_URL/api/mods/hyenihelper/latest

# 3. 테스트
curl HYENIMC_WORKER_URL/api/mods/hyenihelper/latest
```

### 예시 2: 여러 모드 순차 배포

```powershell
# HyeniHelper 배포
.\deploy-mod.ps1 -ModId "hyenihelper" -Version "1.0.1" -GameVersion "1.21.1" `
  -Changelog "초기 릴리스" -Required $true `
  -JarFiles @("C:\build\hyenihelper\hyenihelper-neoforge.jar")

# HyeniCore 배포
.\deploy-mod.ps1 -ModId "hyenicore" -Version "2.0.0" -GameVersion "1.21.1" `
  -Changelog "코어 기능 개선" -Required $false `
  -JarFiles @("C:\build\hyenicore\core-neoforge.jar", "C:\build\hyenicore\core-fabric.jar")

# HyeniUtils 배포
.\deploy-mod.ps1 -ModId "hyeniutils" -Version "1.5.3" -GameVersion "1.21.1" `
  -Changelog "유틸리티 추가" -Required $false `
  -JarFiles @("C:\build\hyeniutils\utils.jar")

# 레지스트리 업데이트
.\update-registry.ps1
# 입력: hyenihelper,hyenicore,hyeniutils
```

---

## 🚨 긴급 롤백 (문제 발생 시)

### 빠른 롤백

```powershell
# 방법 1: 대화형 (권장)
.\rollback-mod.ps1 -ModId hyenihelper

# 버전 목록이 표시됨:
#   [1] v1.0.2 ← 현재
#   [2] v1.0.1
#   [3] v1.0.0
# 
# 🔢 롤백할 버전을 선택하세요:
#    번호 입력 (1-3) 또는 버전 번호 (예: 1.0.1):
#    선택: 2 ← 입력
# 
# ⚠️  경고: 다음 작업을 수행합니다:
#    • 현재 버전: 1.0.2 → 1.0.1
# 계속하시겠습니까? (y/n): y

# 방법 2: 직접 지정
.\rollback-mod.ps1 -ModId hyenihelper -Version 1.0.1
```

**처리 시간:** 5-10초  
**효과:** 즉시 모든 사용자가 안전한 버전으로 다운로드

---

## 🔄 업데이트 워크플로우

### 기존 모드 업데이트

```powershell
# 1. 새 버전 빌드
# 2. 배포 스크립트 실행
.\deploy-mod.ps1 `
  -ModId "hyenihelper" `
  -Version "1.0.2" `
  -GameVersion "1.21.1" `
  -Changelog "버그 수정: XYZ 문제 해결" `
  -JarFiles @("C:\build\hyenihelper-v1.0.2.jar")

# 3. 끝! (레지스트리는 자동 업데이트 안 해도 됨)
```

### 새 모드 추가

```powershell
# 1. 새 모드 배포
.\deploy-mod.ps1 `
  -ModId "hyeninew" `
  -Version "1.0.0" `
  -GameVersion "1.21.1" `
  -Changelog "새 모드 출시!" `
  -JarFiles @("C:\build\hyeninew\hyeninew.jar")

# 2. 레지스트리 업데이트 (필수!)
.\update-registry.ps1
# 입력: hyenihelper,hyenicore,hyeniutils,hyeninew
```

---

## 🗂️ R2 구조 (자동 생성됨)

```
hyenimc-releases/
├── mods/
│   ├── registry.json              ← 전체 모드 목록
│   ├── hyenihelper/
│   │   ├── latest.json            ← 최신 버전 정보
│   │   └── versions/
│   │       ├── 1.0.0/
│   │       │   ├── manifest.json
│   │       │   ├── hyenihelper-fabric-1.21.1-1.0.0.jar
│   │       │   └── hyenihelper-neoforge-1.21.1-1.0.0.jar
│   │       └── 1.0.1/
│   │           ├── manifest.json
│   │           ├── hyenihelper-fabric-1.21.1-1.0.1.jar
│   │           └── hyenihelper-neoforge-1.21.1-1.0.1.jar
│   ├── hyenicore/
│   │   ├── latest.json
│   │   └── versions/...
│   └── hyeniutils/
│       ├── latest.json
│       └── versions/...
```

---

## 📋 버전 관리

### 버전 목록 조회

```powershell
.\list-versions.ps1 -ModId hyenihelper

# 출력:
# 📋 모드 버전 목록
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 📦 모드 ID: hyenihelper
# 
# 🔍 현재 버전 확인 중...
#    ✅ 현재 버전: 1.0.1
# 
# 📡 모든 버전 조회 중...
#    ✅ 3개 버전 발견
# 
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 
#   📦 v1.0.2
#      🎮 게임 버전: 1.21.1
#      📅 출시일: 2025-10-14
#      📝 변경사항: 테스트
# 
#   📦 v1.0.1 ← 현재 배포 버전
#      🎮 게임 버전: 1.21.1
#      📅 출시일: 2025-10-13
#      📝 변경사항: 초기 배포
```

---

## 🧪 테스트

### API 테스트

```powershell
# 모드 목록
curl HYENIMC_WORKER_URL/api/mods

# 특정 모드 최신 버전
curl HYENIMC_WORKER_URL/api/mods/hyenihelper/latest

# 특정 모드 전체 버전 목록
curl HYENIMC_WORKER_URL/api/mods/hyenihelper/versions

# Health check
curl HYENIMC_WORKER_URL/health
```

### 런처 테스트

1. 런처 빌드
   ```powershell
   cd d:\git\HyeniMC
   npm run build
   ```

2. 런처 실행
   ```powershell
   npm run dev
   ```

3. 프로필 → "개요" 탭
4. 업데이트 알림 확인

---

## 🛠️ 문제 해결

### 로더 타입 자동 감지 실패
```powershell
# 스크립트 실행 중:
# ⚠️  로더 타입을 자동으로 감지할 수 없습니다.
# 📝 파일명: my-weird-mod.jar
# 💡 로더 타입을 입력하세요 (fabric, neoforge, forge, quilt):
#       로더 타입: neoforge ← 직접 입력
```
→ 파일명에 `fabric`, `neoforge` 등을 포함시키면 자동 감지됩니다

### 파일 경로 오류
```powershell
# 절대 경로 사용 권장
-JarFiles @("C:\full\path\to\file.jar")

# 상대 경로도 가능
-JarFiles @(".\build\file.jar")
```

### Wrangler 명령 실패
```powershell
# 재로그인
wrangler logout
wrangler login

# 버전 확인
wrangler --version
```

### R2 업로드 실패
- Cloudflare Dashboard → R2 → hyenimc-releases 버킷 확인
- Worker에 R2 바인딩 설정 확인 (`wrangler.toml`)

---

## 🆘 긴급 상황 대응

### 시나리오 1: 버그가 있는 버전 배포

```powershell
# 1. v1.0.2 배포
.\deploy-mod.ps1 -ModId hyenihelper -Version 1.0.2 ...

# 2. 사용자 보고: 치명적 버그 발견!

# 3. 즉시 롤백 (30초 소요)
.\rollback-mod.ps1 -ModId hyenihelper -Version 1.0.1

# 4. 확인
curl HYENIMC_WORKER_URL/api/mods/hyenihelper/latest
# { "version": "1.0.1" } ← 안전한 버전으로 복구됨
```

### 시나리오 2: 잘못된 파일 업로드

```powershell
# 1. 잘못된 파일로 배포함
.\deploy-mod.ps1 -ModId hyenihelper -Version 1.0.3 -JarFiles @("wrong-file.jar")

# 2. 올바른 파일로 재배포 (같은 버전)
.\deploy-mod.ps1 -ModId hyenihelper -Version 1.0.3 -JarFiles @("correct-file.jar")
# ✅ R2에서 파일 덮어쓰기됨

# 3. 확인
curl HYENIMC_WORKER_URL/api/mods/hyenihelper/latest
```

### 시나리오 3: 최신 버전 확인

```powershell
# 현재 배포된 버전 확인
.\list-versions.ps1 -ModId hyenihelper

# 최신 버전이 아닌 경우 스크립트가 알려줌:
# ⚠️  현재 버전이 최신 버전이 아닙니다!
# 💡 최신 버전으로 업데이트하려면:
#    .\rollback-mod.ps1 -ModId hyenihelper -Version 1.0.2
```

---

## 💡 팁

### 한 번에 모든 모드 배포

**batch-deploy.ps1** 생성:
```powershell
$mods = @(
    @{ 
        Id="hyenihelper"
        Version="1.0.1"
        Files=@("C:\build\hyenihelper\helper-neo.jar", "C:\build\hyenihelper\helper-fab.jar")
    },
    @{ 
        Id="hyenicore"
        Version="2.0.0"
        Files=@("C:\build\hyenicore\core.jar")
    },
    @{ 
        Id="hyeniutils"
        Version="1.5.3"
        Files=@("C:\build\hyeniutils\utils-neoforge.jar")
    }
)

foreach ($mod in $mods) {
    .\deploy-mod.ps1 `
        -ModId $mod.Id `
        -Version $mod.Version `
        -GameVersion "1.21.1" `
        -Changelog "릴리스 노트 참조" `
        -JarFiles $mod.Files
}

.\update-registry.ps1
```

실행:
```powershell
.\batch-deploy.ps1
```

---

## 📚 참고

- Worker API: `cloudflare-worker/src/index.js`
- 배포 스크립트: `cloudflare-worker/deploy-mod.ps1`
- 레지스트리 스크립트: `cloudflare-worker/update-registry.ps1`
- 기존 문서: `cloudflare-worker/DEPLOYMENT.md`
