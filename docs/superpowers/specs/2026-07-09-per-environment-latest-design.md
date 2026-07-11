# 환경별 최신 버전 해석(Per-Environment Latest) 설계

- **작성일**: 2026-07-09
- **대상**: `HyeniMC/cloudflare-worker`(워커 + 관리 패널) + `HyeniMC/crates/hyenimc-launcher`(런처)
- **상태**: 승인됨(방향 + 3단계 포함) → 구현 계획 대기

## 1. 목적과 문제

### 목적
모드의 "최신 버전"을 **프로필 환경 (마인크래프트 버전 × 모드 로더)별로** 해석해서, 런처가 그 환경에 실제로 맞는 최신 버전을 받도록 한다.

### 현재 동작(문제)
- 각 모드는 단일 `mods/{id}/latest.json`(관리자가 찍은 전역 latest) 하나를 가진다.
- 런처 `check_all_updates`([workermods.rs:223](../../../crates/hyenimc-launcher/src/workermods.rs))는 `GET /api/v2/mods/{id}/latest`를 **쿼리 없이** 호출해 전역 latest를 받고, 로컬에서 `loaders[loader].gameVersions[gv]`를 찾아 매칭한다([:238](../../../crates/hyenimc-launcher/src/workermods.rs)).
- **결과**: latest가 (MC, 로더)와 무관한 단일 포인터라, 관리자가 예컨대 `v1.0.5(fabric/1.21.8)`를 latest로 찍으면 `neoforge/1.21.1` 프로필용으로 더 새 버전(`v1.0.6`)이 있어도 그 환경은 업데이트를 놓치거나 엉뚱한 버전을 잡아 실행 실패로 이어진다.

### 핵심 통찰
- **데이터는 이미 충분하다.** 각 버전 manifest에 `loaders.{loader}.gameVersions.{gv}` 타깃이 다 들어있다. 부족한 건 "(modId, MC, loader)별 latest 해석" 한 조각뿐.
- 따라서 **modId를 쪼개지 않는다.** (MC, loader)는 ID가 아니라 **질의 컨텍스트**로 다룬다.

## 2. 아키텍처

```
런처: GET /api/v2/mods/{id}/latest?gameVersion=1.21.1&loader=neoforge
워커: 그 (loader, gameVersion)에 대해 해석된 버전의 manifest 반환
```

- 런처는 프로필의 `game_version`/`loader_type`을 이미 갖고 있으므로([workermods.rs:196-198](../../../crates/hyenimc-launcher/src/workermods.rs)) 요청 URL에 붙이기만 하면 된다.
- 워커는 관리 패널이 빌드한 **인덱스**로 (loader, gv) → 해석 버전을 O(1) 조회한다(버전 스캔 없음).
- **하위호환**: 쿼리가 없으면(구 Electron 런처) 기존 전역 `latest.json`을 그대로 반환 → 아무도 깨지지 않는다.

## 3. 데이터 모델 — 인덱스

`mods/{id}/index.json` (관리 패널이 생성·유지, 공개 API가 소비):

```json
{
  "version": "1",
  "updatedAt": "<iso>",
  "targets": {
    "neoforge": {
      "1.21.1": { "auto": "1.0.6", "pinned": null },
      "26.1.2": { "auto": "1.0.6", "pinned": null }
    },
    "fabric": {
      "1.21.1": { "auto": "1.0.5", "pinned": null },
      "1.21.8": { "auto": "1.0.6", "pinned": "1.0.4" }
    }
  }
}
```

- **auto**: 그 (loader, gv) 타깃을 가진 버전들 중 **최고 모드버전**(모든 버전 manifest에서 집계).
- **pinned**: 관리자가 그 (loader, gv)에 고정한 버전 또는 `null`.
- **해석(resolved) = pinned ?? auto.**

## 4. 계층별 변경

### 4-1. 관리 패널 백엔드 (핵심 rework)
- **인덱스 재계산**: publish/rollback/편집/삭제 시 모든 버전 manifest를 스캔해 (loader, gv)별 `auto`를 다시 계산하고 `mods/{id}/index.json`에 기록. 기존 `pinned`는 보존하되, 핀 대상 버전이 그 타깃을 더는 갖지 않으면 핀 해제(→ auto). (registry 재생성과 같은 지점에 얹음.)
- **핀 엔드포인트**: `PATCH /admin/api/mods/{id}/pins` body `{loader, gameVersion, version|null}` → 해당 타깃 `pinned` 설정/해제. `version`이 그 (loader, gv) 타깃을 실제로 가진 버전인지 검증(아니면 400).
- **조회**: `GET /admin/api/mods/{id}/index` (또는 listModVersions에 인덱스 동봉) — 프론트 매트릭스용.

### 4-2. 워커
- `getLatestRelease`가 쿼리 `gameVersion`·`loader`를 읽는다.
  - 있으면: `mods/{id}/index.json` 읽어 resolved = `pinned ?? auto` for (loader, gv). 없으면(그 환경 타깃 없음) 404. 있으면 `mods/{id}/versions/{resolved}/manifest.json`을 반환(현행과 동일한 manifest 형식 + downloadUrl 주입).
  - 없으면: 기존 `mods/{id}/latest.json` 반환(하위호환).
- 인덱스가 아예 없으면(마이그레이션 전 모드) 전역 latest로 폴백.

### 4-3. 런처 (Tauri, Rust) — 두 부분
**(A) 요청에 환경 쿼리 추가**: [workermods.rs](../../../crates/hyenimc-launcher/src/workermods.rs)의 latest 요청에 `?gameVersion={game_version}&loader={loader_type}` 추가. loaderVersion은 서버로 보내지 않는다(서버는 (loader,gv) 진짜 최신만 해석). 응답은 기존과 같은 manifest.

**(B) 로더 호환 판단 + loader_version 세팅**: 서버가 준 진짜 최신 버전의 (loader,gv) 타깃 min/maxLoaderVersion을 프로필의 현재 loader_version과 비교(`loader_version_ok`).
- 범위 내 → 그냥 모드 업데이트.
- 범위 밖 → **[min,max]를 만족하는 설치 가능한 로더 중 최신 릴리스**를 [`loader.rs`](../../../crates/hyenimc-launcher/src/loader.rs)(fabric_loader_versions / neoforge_versions+neoforge_matches_mc)로 찾아 프로필 `loader_version`을 그 값으로 세팅. 실제 로더 설치는 **기존 launch 흐름**([game.rs:411](../../../apps/launcher/src-tauri/src/game.rs))이 수행(별도 설치 코드 불필요). `WorkerModUpdate`에 "로더 변경" 정보를 실어 렌더러가 표시.
- [min,max] 만족 로더 없음 → "로더 불일치 — 업데이트 불가" 안내.

**렌더러(TS)**: 프로필 개요 업데이트 표시에 **"모드 로더도 함께 업데이트 됩니다."** 한 줄(선택권 없음). '업데이트'/'게임 시작' 어느 쪽이든 모드 갱신 + loader_version 세팅 → launch가 로더 설치. 이후 사용자가 설정에서 loader_version 변경 시 다음 실행에 그 버전으로 재설치.

> **혜니팩 로더**: `install_pack`이 이미 loader_version을 팩 값으로 덮으므로(사용자 수동 변경도 팩 값으로 교체), 팩 업데이트 → 다음 실행에 새 로더 설치. 확인됨(pack.rs:86-94, "다음 실행 시 로더 설치").

### 4-4. 관리 UI — 환경별 최신 매트릭스 + 핀 (3단계)
모드 상세에 매트릭스 추가:

```
로더        MC 버전    해석된 latest      지정
neoforge    1.21.1     1.0.6  (자동)      [ 자동  ▾ ]
fabric      1.21.8     1.0.4  (고정)      [ 1.0.4 ▾ ]
```

- 각 행 = 인덱스의 (loader, gv). "해석된 latest" = pinned ?? auto.
- **지정 드롭다운**: 그 타깃을 가진 버전들 + "자동". 선택 시 `PATCH pins` 호출. "자동" = 핀 해제.

## 5. 하위호환 / 마이그레이션
- 워커는 쿼리 없음 → 전역 latest, 인덱스 없음 → 전역 latest 폴백. **구 Electron 런처 무영향.**
- 기존 모드는 다음 관리 작업(또는 "레지스트리 재생성" 유사의 "인덱스 재생성" 버튼) 시 인덱스가 생성된다. 일회성 백필: 배포 후 각 모드 인덱스 1회 생성.

## 6. 확정된 결정
- **latest 정의**: (loader, gv) 타깃을 가진 버전 중 최고 모드버전 = `auto`(자동). 핀으로 override.
- **loaderVersion은 서버가 아닌 런처가 처리**(사용자 확정): 서버는 (loader, gv) 진짜 최신만 반환. 로더버전 min/max 불일치는 런처가 판단해 **[min,max] 내 최신 로더로 loader_version을 세팅**(모드 다운그레이드 아님 — 서버필수 모드는 다운그레이드 시 접속 불가). 실제 설치는 기존 launch 흐름 재사용. **로더**는 범위를 만족하도록 위/아래 어느 방향이든 이동한다(다운그레이드 허용, 2026-07-10 확정).
- **로더 교체 방식**: 설치할 로더 = [min,max] 내 **최신 릴리스**. **선택권 없음**(자동), 렌더러에 "모드 로더도 함께 업데이트 됩니다." 표시. 이후 사용자가 설정에서 자유 변경 가능.
- **전역 `latest.json` 유지**: 쿼리 미지정 클라이언트(구 런처)용 폴백. 관리자의 "latest로 지정"(롤백)은 이 전역 포인터를 계속 설정.
- **삭제 상호작용**: 버전 삭제 시 인덱스 auto 재계산, 핀 대상이면 핀 해제. 전역 latest 삭제 차단은 유지.

## 7. 비목표(YAGNI)
- 서버 측 loaderVersion 해석(후보+범위 저장) — 불필요(런처가 처리).
- 혜니팩 서버 로직 — **무관**. 팩이 MC/로더를 자체 보유하고 같은 팩ID로 업데이트. (단 팩의 로더 교체는 런처 launch가 이미 처리 — §4-3.)
- modId에 MC/loader 인코딩 — 명시적 기각(ID 폭증 + 로더 동시배포 강제 + 런처 매핑 복잡).

## 9. 구현 단계
- **Plan A (서버 + 관리)**: 인덱스((loader,gv)→auto/pinned) + 워커 (loader,gv) 해석 + 하위호환 + 관리 UI 매트릭스/핀. [docs/superpowers/plans/2026-07-09-per-environment-latest.md](../plans/2026-07-09-per-environment-latest.md) Task 1–4 + 런처 쿼리(Task 5).
- **Plan B (런처 로더 호환)**: §4-3 (B) — 로더 범위 판단 + [min,max] 내 최신 로더로 loader_version 세팅 + `WorkerModUpdate` 확장 + 렌더러 표시. Plan A 완료·검증 후 런처 코드를 읽어 별도 계획으로 상세화.

## 8. 계층별 규모 요약
| 계층 | 변경 | 규모 |
|---|---|---|
| 관리 백엔드 | 인덱스 재계산 + 핀 엔드포인트 + 조회 | 중 |
| 워커 | latest에 쿼리 해석 + 폴백 | 소~중 |
| 런처(Rust) | 요청에 쿼리 추가 | 소 |
| 관리 UI | 매트릭스 + 핀 드롭다운 | 중 |
