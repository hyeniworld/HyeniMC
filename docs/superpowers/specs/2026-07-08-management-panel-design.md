# HyeniMC 관리 패널 설계

- **작성일**: 2026-07-08
- **대상 리포/경로**: `HyeniMC/cloudflare-worker`
- **상태**: 승인됨(설계) → 구현 계획 대기

## 1. 목적과 범위

### 목적
HyeniHelper·HAF(HyeniAdditionalFunctions)·혜니팩(HyeniPack)의 배포/관리를 현재의 **CLI 스크립트 + 손으로 쓰는 `deploy-config.json` + `wrangler r2 object put`** 방식에서 **웹 관리 패널**로 대체한다. 사용자 본인이 직접 쓰는 개인 관리 도구이므로 UX 폴리시보다 "지금보다 편함"과 정확성이 우선이다.

### 현재 시스템(개선 대상)
- **백엔드**: Cloudflare Worker(`cloudflare-worker/src/index.js`) + R2 버킷 `hyenimc-releases` + KV(rate limit).
- **R2 레이아웃**:
  - `mods/registry.json` — 모드 목록.
  - `mods/{id}/latest.json` — 모드별 최신 버전 메타.
  - `mods/{id}/versions/{ver}/{loader}/{gameVersion}/{file}.jar` — 버전별 jar.
  - `mods/{id}/versions/{ver}/manifest.json` — 버전별 매니페스트(loaders→gameVersions→다운로드경로/min·maxLoader/deps).
  - `modpacks/{id}/latest.json` — 혜니팩 최신 메타.
  - `modpacks/{id}/versions/{ver}/pack.hyenipack` — 버전별 팩 파일.
- **공개 API**: `/api/v2/mods`, `/api/v2/mods/{id}/latest`, `/api/v2/modpacks/{id}/latest`, `/download/v2/*`(토큰 게이트). **이 경로/포맷은 런처가 소비하므로 변경하지 않는다.**
- **현재 관리 방식**: `deploy-mod-v2.{sh,ps1}`, `update-registry-v2.{sh,ps1}`, `deploy-hyenipack.{sh,ps1}`, `rollback-mod.{sh,ps1}`, `list-versions.{sh,ps1}` 등 셸/PowerShell 스크립트 세트.

### 이 설계가 덮는 범위(풀 스코프)
모드(HyeniHelper/HAF)와 혜니팩 **양쪽**에 대해:
- **게시**(새 버전 업로드): 미리 빌드된 jar/`.hyenipack`을 업로드. (Gradle 빌드 자체는 범위 밖 — 각 모드 프로젝트에서 수행.)
- **목록**: 모드/팩 목록, 버전 목록, 현재 latest 확인.
- **롤백**: latest 포인터를 기존 버전으로 교체.
- **삭제**: 버전 삭제.
- **메타 편집**: changelog, category, min·maxLoaderVersion, dependencies, (팩) breaking 플래그.

### 비범위(YAGNI)
- 모드 소스 빌드(Gradle) 자동화.
- 다중 관리자/권한 모델(본인 전용).
- 공개 API/다운로드 경로·응답 포맷 변경.
- 별도 인프라(Pages 등) 추가.

## 2. 아키텍처

기존 `hyenimc-worker` **단일 Worker**가 세 가지를 서빙한다.

| 경로 | 역할 | 변경 |
|------|------|------|
| `/api/v2/*`, `/download/v2/*` | 공개 API/다운로드 | **무변경** |
| `/admin/*` | 관리 SPA(Vite+Preact 번들) | 신규 — Workers Static Assets |
| `/admin/api/*` | 관리 API(R2 쓰기) | 신규 — Worker 핸들러 |

### 라우팅
`wrangler.toml`에 `run_worker_first = true`를 설정해 Worker가 먼저 모든 요청을 받고 디스패치한다.
1. `/admin/api/*` → 관리 API 핸들러.
2. `/admin` 또는 `/admin/*`(비-API) → `env.ASSETS.fetch(request)`로 SPA 서빙(SPA 폴백: 매칭 없는 경로는 `index.html`).
3. 그 외 → 기존 공개 API(`index.js`의 현재 라우팅).

### 인증
- **Cloudflare Access**(Zero Trust self-hosted 앱)가 엣지에서 `/admin*` 전체를 게이트(본인 이메일 정책). 1회 설정.
- Worker는 관리 API 요청마다 `Cf-Access-Jwt-Assertion` 헤더의 JWT를 **재검증**(Access 팀 공개키로 서명·`aud`·`iss` 확인). 엣지 게이트가 이미 있지만 방어적 2중 확인.
- 공개 API/다운로드 경로는 Access 밖(현행 유지).

## 3. 컴포넌트

코딩 스타일 원칙(작은 파일 다수, 고응집·저결합)을 따른다.

### 프론트엔드 — `cloudflare-worker/admin/` (Vite + Preact)
- `src/main.tsx` — 부트스트랩 + 라우터(preact-router 또는 경량 hash 라우터).
- `src/api/client.ts` — 관리 API fetch 래퍼(Access 쿠키 자동, 에러 정규화).
- `src/pages/ModsPage.tsx` — 모드 목록(registry+latest 요약) + 버전 목록 진입.
- `src/pages/ModPublishForm.tsx` — 모드 새 버전 게시 폼(멀티파일: loader/gameVersion/jar/min·maxLoader/deps 행 추가·삭제).
- `src/pages/PacksPage.tsx` — 혜니팩 목록/버전.
- `src/pages/PackPublishForm.tsx` — `.hyenipack` + `.latest.json` 업로드(클라이언트 sha256 사전검증).
- `src/components/` — `VersionTable`, `FileRow`, `ConfirmDialog`, `Toast` 등 공용.

### 백엔드 — `cloudflare-worker/src/admin/`
- `router.js` — `/admin/api/*` 디스패치 + Access JWT 검증 미들웨어.
- `mods.js` — 모드 게시(멀티파일 업로드 + manifest 생성 + latest + registry), 목록, 롤백, 삭제, 메타 편집.
- `packs.js` — 팩 게시(sha256 검증 + pack/latest 업로드), 목록, 롤백, 삭제, 메타 편집.
- `r2.js` — R2 헬퍼(putObject/getJson/putJson/list/delete).
- `registry.js` — `mods/registry.json` 재생성(모든 `mods/*/latest.json` 취합). **멱등**.
- `access.js` — Cf-Access-Jwt 검증(공개키 캐시).

### 관리 API 엔드포인트
```
GET    /admin/api/mods                       모드 목록(registry + latest 요약)
GET    /admin/api/mods/{id}/versions         버전 목록
POST   /admin/api/mods/{id}/versions         게시(multipart: 메타 JSON + jar 파일들)
PATCH  /admin/api/mods/{id}/latest           롤백(latest 포인터 교체) {version}
PATCH  /admin/api/mods/{id}/versions/{ver}   메타 편집(changelog/category/min·maxLoader/deps)
DELETE /admin/api/mods/{id}/versions/{ver}   버전 삭제

GET    /admin/api/modpacks                    팩 목록
GET    /admin/api/modpacks/{id}/versions      버전 목록
POST   /admin/api/modpacks/{id}/versions      게시(multipart: .hyenipack + .latest.json) — sha256 검증
PATCH  /admin/api/modpacks/{id}/latest        롤백
PATCH  /admin/api/modpacks/{id}/versions/{ver} 메타 편집(changelog/breaking)
DELETE /admin/api/modpacks/{id}/versions/{ver} 버전 삭제

POST   /admin/api/registry/rebuild            레지스트리 강제 재생성(복구용)
```

## 4. 데이터 흐름

### 모드 게시
1. 프론트 폼 입력: `modId`, `name`, `version`, `category`, `changelog`, `releaseDate`, `files[]{loader, gameVersion, jar파일, minLoaderVersion, maxLoaderVersion, dependencies}`.
2. `POST /admin/api/mods/{id}/versions` — multipart(jar 바이너리들 + 메타 JSON).
3. Worker: Access JWT 검증 → 각 jar를 `mods/{id}/versions/{ver}/{loader}/{gameVersion}/{file}`에 put + sha256 계산 → 버전 `manifest.json` 생성/put → `mods/{id}/latest.json` put → `mods/registry.json` 재생성.
4. 응답: 성공 요약 또는 부분 실패(실패 파일 목록).

기존 `deploy-mod-v2.sh`가 생성하던 R2 오브젝트 구조·JSON 포맷을 **그대로** 재현한다(런처 호환).

### 혜니팩 게시
1. 프론트: `.hyenipack` + 사이드카 `.latest.json`(런처 export 산출물; `hyenipackId`/`version`/`sha256` 포함) 선택.
2. **클라이언트 sha256 사전검증**: 팩 파일 해시 == latest.json의 sha256. 불일치 시 업로드 자체를 막는다.
3. `POST /admin/api/modpacks/{id}/versions` — multipart.
4. Worker: Access 검증 → **서버 sha256 재검증** → `modpacks/{id}/versions/{ver}/pack.hyenipack` put → `modpacks/{id}/latest.json` put.

### 롤백
`latest.json`의 version 포인터를 기존 버전 중 하나로 교체(버전 파일은 R2에 그대로 존재). 모드는 registry 재생성 포함.

### 업로드 경로(확정)
jar/pack을 **Worker로 스트리밍하여 R2에 put**한다(jar 수 MB, 팩은 URL 참조형이라 소용량 가정). 팩이 Worker 요청 본문 한도(무료 플랜 100MB)를 넘길 만큼 커지는 상황이 생기면 presigned R2 직업로드로 폴백한다 — 현재는 스트리밍으로 시작(YAGNI).

## 5. 에러 처리

- **부분 실패(멀티파일 게시)**: 일부 jar 실패 시 실패 파일 목록을 반환하고, `latest.json`/`registry.json`은 **모든 파일 성공 시에만** 갱신한다(원자성 근사). 실패 시 이미 올라간 오브젝트는 남되 latest는 이전 상태를 유지 → 재시도로 주워담기 쉽다.
- **sha256 불일치(팩)**: 400 + 명확한 메시지, 업로드 중단.
- **버전 중복**: 같은 `version`이 이미 있으면 **기본 차단**. 덮어쓰기는 프론트에서 명시적 확인 후 `?overwrite=true`로만 허용.
- **latest 버전 삭제 시도**: **차단**하고 "먼저 다른 버전으로 롤백하라"고 안내(자동 재지정보다 안전·명시적).
- **registry 재생성 실패**: registry 재생성은 멱등이므로 `POST /admin/api/registry/rebuild`(또는 UI 버튼)로 언제든 복구.
- **Access JWT 실패**: 401(엣지에서 이미 걸러지지만 방어).
- **R2/네트워크 오류**: 5xx + 재시도 안내. 서버는 상세 로그, UI는 사용자 친화 메시지. 에러를 조용히 삼키지 않는다.

## 6. 테스트

- **Worker 단위**(`vitest` + `@cloudflare/vitest-pool-workers`, miniflare R2/KV 모킹):
  - 각 관리 엔드포인트(게시/목록/롤백/삭제/메타 편집).
  - Access JWT 검증(유효/무효/누락).
  - sha256 검증(일치/불일치).
  - registry 재생성 정확성 + 멱등성.
  - 부분 실패 시 latest/registry 미갱신 보장.
  - 버전 중복 차단, latest 삭제 차단.
- **프론트 단위**: 폼 검증(version 형식 `x.y.z`, 멀티파일 필수값, 클라이언트 sha256 계산). 컴포넌트 렌더 테스트는 개인 도구라 최소.
- **로컬 왕복**: `wrangler dev --local`(로컬 R2) + Access 개발 바이패스 플래그로 게시→목록→롤백→삭제 수동 확인.
- 목표 커버리지 80%(핵심은 관리 API 로직).

## 7. 배포/설정 변경

- `wrangler.toml`:
  - `[assets] directory = "./admin/dist"`, `run_worker_first = true`.
  - 기존 R2(`RELEASES`)/KV(`RATE_LIMIT`) 바인딩, secrets 유지.
- `package.json`:
  - `build:admin` = `vite build`(admin/).
  - `deploy` = `build:admin` → `wrangler deploy`.
- **Cloudflare Access**: `/admin*`를 커버하는 self-hosted 앱 1회 생성(본인 이메일 정책). Worker에 Access 팀 도메인/`aud` 환경변수 주입.
- **기존 공개 API/다운로드 경로·포맷은 무변경**(런처 호환성 유지).

## 8. 확정된 판단 기본값(요약)

| 항목 | 결정 |
|------|------|
| 호스팅 | 기존 Worker에 `/admin` 패널 통합 |
| 인증 | Cloudflare Access(+Worker JWT 재검증) |
| 작업 범위 | 게시 + 목록 + 롤백 + 삭제 + 메타 편집 |
| 빌드 통합 | 미리 빌드된 jar/`.hyenipack` 업로드 전용 |
| 구현 | Vite+Preact 번들 SPA + Workers Static Assets |
| 업로드 경로 | Worker 스트리밍 → R2 put(대용량 시 presigned 폴백) |
| 부분 실패 | 전체 성공 시에만 latest/registry 갱신 |
| 버전 중복 | 기본 차단(명시적 덮어쓰기만 허용) |
| latest 삭제 | 차단(먼저 롤백 안내) |
