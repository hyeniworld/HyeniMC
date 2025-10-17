# 🔄 멀티 모드 지원 마이그레이션 가이드

## 📋 변경 사항 요약

### 1. API 구조 변경
**이전 (단일 모드):**
```
/api/hyenihelper/latest
/api/hyenihelper/versions
/download/hyenihelper/{version}/{file}
```

**이후 (멀티 모드):**
```
/api/mods                              ← 전체 모드 목록
/api/mods/{modId}/latest               ← 특정 모드 최신 버전
/api/mods/{modId}/versions             ← 특정 모드 전체 버전
/download/mods/{modId}/{version}/{file}  ← 파일 다운로드
```

**하위 호환성:** 기존 `/api/hyenihelper/*` 경로도 여전히 작동합니다 (자동 리다이렉트)

### 2. R2 구조 변경
**이전:**
```
hyenimc-releases/
├── hyenihelper/
│   ├── latest.json
│   └── 1.0.0/
│       ├── manifest.json
│       └── *.jar
```

**이후:**
```
hyenimc-releases/
├── mods/
│   ├── registry.json            ← 새로 추가!
│   ├── hyenihelper/
│   │   ├── latest.json
│   │   └── versions/            ← 디렉토리 추가
│   │       └── 1.0.0/
│   │           ├── manifest.json
│   │           └── *.jar
│   ├── hyenicore/               ← 새 모드
│   └── hyeniutils/              ← 새 모드
```

---

## 🚀 마이그레이션 단계

### Step 1: Worker 재배포

```powershell
cd d:\git\HyeniMC\cloudflare-worker

# Worker 배포 (새 API 구조 적용)
wrangler deploy
```

✅ 출력 확인:
```
Published hyenimc-worker (1.23s)
  HYENIMC_WORKER_URL
```

---

### Step 2: 기존 파일 마이그레이션 (선택사항)

기존 `hyenihelper/` 파일을 새 구조로 이동:

```powershell
# 기존 구조 확인
# hyenimc-releases/
#   hyenihelper/
#     latest.json
#     1.0.0/manifest.json
#     1.0.0/hyenihelper-*.jar

# 새 구조로 수동 마이그레이션은 불필요!
# 대신 새로운 배포 스크립트로 재배포하세요.
```

---

### Step 3: 런처 빌드

```powershell
cd d:\git\HyeniMC

# TypeScript 빌드
npm run build
```

---

### Step 4: 기존 HyeniHelper 재배포 (새 구조)

```powershell
cd d:\git\HyeniMC\cloudflare-worker

# 배포 스크립트 사용
.\deploy-mod.ps1 `
  -ModId "hyenihelper" `
  -Version "1.0.1" `
  -GameVersion "1.21.1" `
  -Changelog "멀티 모드 지원 업데이트" `
  -Required $true `
  -JarsPath "C:\path\to\jars"
```

---

### Step 5: 레지스트리 생성

```powershell
.\update-registry.ps1
# 입력: hyenihelper
```

---

### Step 6: 테스트

```powershell
# 새 API 엔드포인트 테스트
curl HYENIMC_WORKER_URL/api/mods
curl HYENIMC_WORKER_URL/api/mods/hyenihelper/latest

# 기존 엔드포인트 (하위 호환성 확인)
curl HYENIMC_WORKER_URL/api/hyenihelper/latest

# 런처 테스트
npm run dev
```

---

## ✅ 체크리스트

```
□ Worker 재배포 완료
□ 런처 빌드 완료
□ 기존 모드 재배포 (새 구조)
□ 레지스트리 생성 완료
□ API 테스트 성공
□ 런처에서 업데이트 확인
```

---

## 🆕 새 모드 추가하기

### 1. JAR 파일 준비
```
hyenicore-fabric-1.21.1-1.0.0.jar
hyenicore-neoforge-1.21.1-1.0.0.jar
```

### 2. 배포
```powershell
.\deploy-mod.ps1 `
  -ModId "hyenicore" `
  -Version "1.0.0" `
  -GameVersion "1.21.1" `
  -Changelog "HyeniCore 초기 릴리스" `
  -JarsPath "C:\build\hyenicore"
```

### 3. 레지스트리 업데이트
```powershell
.\update-registry.ps1
# 입력: hyenihelper,hyenicore
```

### 4. 런처에서 확인
- 새 프로필 생성
- "개요" 탭에서 업데이트 확인
- 두 모드 모두 알림 표시되어야 함

---

## 🔧 문제 해결

### Q: 기존 API 경로가 안 됨
**A:** Worker 재배포가 필요합니다:
```powershell
wrangler deploy
```

### Q: 런처에서 업데이트 안 보임
**A:** 런처 재빌드 필요:
```powershell
npm run build
npm run dev
```

### Q: 다운로드 URL이 404
**A:** `downloadPath` 형식 확인:
```json
{
  "downloadPath": "mods/hyenihelper/versions/1.0.1/hyenihelper-neoforge-1.21.1-1.0.1.jar"
}
```
- `hyenihelper/` 시작 (X)
- `mods/` 시작 (O)

---

## 📚 추가 문서

- **배포 가이드**: `README-DEPLOYMENT.md`
- **기존 문서**: `DEPLOYMENT.md`
- **Worker 코드**: `src/index.js`
- **런처 업데이터**: `d:\git\HyeniMC\src\main\services\hyeni-updater.ts`

---

## 💡 주요 이점

1. **멀티 모드 지원**: 여러 모드를 한 Worker에서 관리
2. **자동화된 배포**: `deploy-mod.ps1` 스크립트로 원클릭 배포
3. **레지스트리**: `/api/mods`로 전체 모드 목록 조회 가능
4. **하위 호환성**: 기존 API 경로도 여전히 작동
5. **확장성**: 새 모드 추가가 매우 간단함

---

**마이그레이션 완료 후**: 기존 `hyenihelper/` 디렉토리는 삭제하거나 백업해두세요.
