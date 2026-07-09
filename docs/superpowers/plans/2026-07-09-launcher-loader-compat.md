# 런처 로더 호환 처리(Plan B) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 서버 필수 모드의 (loader, gameVersion)별 최신 버전이 프로필의 현재 로더 버전 범위를 벗어나면, 런처가 [min,max] 내 **최신 로더로 loader_version을 자동 상향**하고(다운그레이드 없음) 기존 launch 흐름으로 로더를 설치한다. 사용자 선택권 없음.

**Architecture:** 설계 §4-3(B). 서버(Plan A)는 이미 (loader,gv)의 진짜 최신 모드 manifest를 반환한다. 런처는 그 manifest의 `min/maxLoaderVersion`을 프로필 loader_version과 비교해 벗어나면 로더를 올린다. 로더 후보는 `loader.rs`가 메이븐/메타에서 가져오고, [min,max] 교집합 내 최신 릴리스를 고른다. 실제 로더 설치는 `game.rs`의 기존 로더 설치 단계가 수행하므로, **실행 흐름에서 워커모드 확인·로더 해석을 로더 설치보다 앞으로 재배치**한다.

**Tech Stack:** Rust (`crates/hyenimc-launcher` 라이브러리 + `apps/launcher/src-tauri` Tauri 바이너리), TypeScript/React 렌더러(`src/renderer`, Tauri는 `tauri-shim.ts`로 배선), cargo test/build.

## Global Constraints

- **다운그레이드 금지**: 로더는 [min,max] 내 **최신 릴리스**로만 올린다. 현재 버전이 이미 범위 내이거나 제약이 없으면 변경하지 않는다.
- **자동 교체 지원 로더 = fabric, neoforge, forge**. quilt/vanilla는 후보 목록이 비어(=변경 없음) 기존 동작 유지(quilt는 더 이상 사용 안 함).
- **forge 버전 정규화**: forge 메이븐 버전은 `{mc}-{build}`(예: `1.20.1-47.4.20`)이고 MC 프리픽스가 프로필 MC로 고정된다. 비교 시 `{mc}-` 프리픽스를 떼어 **build 부분(`47.4.20`)끼리** `version_key`로 비교하고, 설치용으로는 **전체 형식**을 반환한다(프로필 loader_version·`install_forge`가 전체 형식을 요구). 관리자가 min/max를 전체/ build-only 어느 형식으로 넣어도 견고. neoforge(`21.1.186`)·fabric(`0.16.10`)은 프리픽스가 없어 정규화 없이 그대로 비교.
- **사용자 선택권 없음**. 렌더러 문구는 정확히 `모드 로더도 함께 업데이트됩니다`.
- **버전 비교는 `version_key`(`Vec<u32>`)** 재사용. 세그먼트 구분자 `. - +`, 숫자만.
- **커밋 메시지에 attribution 금지**(전역 설정). 형식 `<type>: <설명>`.
- **loader_version 반영**은 `hyenimc_core::profile::update_profile(conn, id, &ProfilePatch{ loader_version: Some(v), ..Default::default() }, now_secs())`.
- 실행 경로 에러는 `crate::pack::forceable(msg)`로 감싸 사용자가 [강제 실행]할 여지를 준다(기존 패턴).

---

## 파일 구조

| 파일 | 책임 | 변경 |
|---|---|---|
| `crates/hyenimc-launcher/src/workermods.rs` | 업데이트 항목 + 로더 해석(순수+async) | `WorkerModUpdate` 3필드 추가, 로더 스킵/param 제거, `newest_in_range`·`loader_range_intersection`·`resolve_loader_for_updates`·`LoaderBump` 추가 |
| `crates/hyenimc-launcher/src/loader.rs` | 설치 가능한 로더 버전 목록 + forge 정규화 | `installable_loader_versions(http, loader_type, mc_version)`, `forge_build_part(version, mc_version)` 추가 |
| `apps/launcher/src-tauri/src/game.rs` | 실행 흐름 | 워커모드 확인+로더 해석을 로더 설치 앞으로 재배치, loader_version 상향+반영, 모드 설치는 로더 설치 뒤 |
| `apps/launcher/src-tauri/src/hyeni.rs` | 업데이트 패널 커맨드 | `worker_mods_check`에 `loader_version` 인자 + 해석 후 `required_loader_version` 스탬프 |
| `src/shared/types/worker-mods.ts` | 렌더러 타입 | `WorkerModUpdateCheck.requiredLoaderVersion` 추가 |
| `src/renderer/tauri-shim.ts` | Tauri 배선 | `checkUpdates`에 `loaderVersion` 전달 |
| `src/renderer/hooks/useWorkerModUpdates.ts` | 업데이트 훅 | `loaderVersion` 옵션 → checkUpdates 전달 |
| `src/renderer/pages/ProfileDetailPage.tsx` | 프로필 상세 | 훅에 `loaderVersion: profile.loaderVersion` 전달 |
| `src/renderer/components/worker-mods/WorkerModUpdatePanel.tsx` | 업데이트 패널 | 로더 변경 안내 한 줄 |

---

### Task 1: `WorkerModUpdate` 로더 필드 추가 + 로더 스킵/param 제거

프로필 loader_version 기반 스킵을 제거하고(로더 상향은 Task 3에서 수행) 각 업데이트가 자기 (loader,gv) 타깃의 `min/maxLoaderVersion`을 실어 나르게 한다. 이 태스크만으로는 실행 경로가 불완전하다(스킵만 빠지고 상향 미구현) — Task 3에서 완성된다.

**Files:**
- Modify: `crates/hyenimc-launcher/src/workermods.rs` (struct 71-89, check_all_updates 192-295)
- Modify: `apps/launcher/src-tauri/src/game.rs:461` (호출 인자 1개 제거)
- Modify: `apps/launcher/src-tauri/src/hyeni.rs:56` (호출 인자 1개 제거)
- Test: `crates/hyenimc-launcher/src/workermods.rs` (하단 `#[cfg(test)]`)

**Interfaces:**
- Produces: `WorkerModUpdate`에 `min_loader_version: Option<String>`, `max_loader_version: Option<String>`, `required_loader_version: Option<String>` (모두 `#[serde(default)]`, camelCase 직렬화). `check_all_updates`는 `loader_version` 인자를 **더 이상 받지 않는다**(시그니처: `http, worker_base, mods_dir, game_version, loader_type, include_all, has_authorized_server`).

- [ ] **Step 1: 실패하는 테스트 작성** — 새 필드가 camelCase로 직렬화/기본값 역직렬화되는지

`crates/hyenimc-launcher/src/workermods.rs`의 `#[cfg(test)] mod tests` 안에 추가:

```rust
    #[test]
    fn worker_mod_update_serde_loader_fields() {
        let u = WorkerModUpdate {
            mod_id: "m".into(),
            mod_name: "M".into(),
            current_version: None,
            latest_version: "1.0.0".into(),
            is_installed: true,
            category: "required".into(),
            changelog: None,
            file: "m.jar".into(),
            sha256: None,
            size: None,
            loader_type: "neoforge".into(),
            game_version: "1.21.1".into(),
            min_loader_version: Some("21.1.0".into()),
            max_loader_version: None,
            required_loader_version: Some("21.1.186".into()),
        };
        let json = serde_json::to_string(&u).unwrap();
        assert!(json.contains("\"minLoaderVersion\":\"21.1.0\""));
        assert!(json.contains("\"requiredLoaderVersion\":\"21.1.186\""));
        // 렌더러가 되돌려 보낼 때 로더 필드가 없어도 역직렬화 성공(기본값 None)
        let back: WorkerModUpdate = serde_json::from_str(
            r#"{"modId":"m","modName":"M","currentVersion":null,"latestVersion":"1.0.0","isInstalled":true,"category":"required","file":"m.jar","loaderType":"neoforge","gameVersion":"1.21.1"}"#,
        ).unwrap();
        assert_eq!(back.min_loader_version, None);
        assert_eq!(back.required_loader_version, None);
    }
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cargo test -p hyenimc-launcher worker_mod_update_serde_loader_fields`
Expected: FAIL — `missing field ... min_loader_version` / `no field required_loader_version`

- [ ] **Step 3: 구조체에 필드 추가**

`crates/hyenimc-launcher/src/workermods.rs`의 `pub struct WorkerModUpdate`(71-89)에서 `game_version` 아래에 추가:

```rust
    pub loader_type: String,
    pub game_version: String,
    /// 이 업데이트가 해석된 (loader,gv) 타깃이 요구하는 로더 버전 범위(없으면 제약 없음).
    #[serde(default)]
    pub min_loader_version: Option<String>,
    #[serde(default)]
    pub max_loader_version: Option<String>,
    /// 로더 호환을 위해 프로필 loader_version을 이 값으로 올려야 함(해석 결과 스탬프). 없으면 변경 불필요.
    #[serde(default)]
    pub required_loader_version: Option<String>,
}
```

- [ ] **Step 4: push에서 min/max 채우기**

`check_all_updates`의 `updates.push(WorkerModUpdate { ... })`(272-289) 마지막에 추가:

```rust
            loader_type: loader_type.to_string(),
            game_version: game_version.to_string(),
            min_loader_version: file_info.min_loader_version.clone(),
            max_loader_version: file_info.max_loader_version.clone(),
            required_loader_version: None,
        });
```

- [ ] **Step 5: 로더 버전 스킵 + param 제거**

`check_all_updates` 시그니처(192-201)에서 `loader_version: &str,` 줄을 삭제:

```rust
pub async fn check_all_updates(
    http: &reqwest::Client,
    worker_base: &str,
    mods_dir: &Path,
    game_version: &str,
    loader_type: &str,
    include_all: bool,
    has_authorized_server: bool,
) -> Result<Vec<WorkerModUpdate>, LauncherError> {
```

그리고 로더 호환 스킵 블록(245-260, `// 로더 버전 호환성 ...` 부터 `continue; }` 까지) 전체를 삭제한다. 독스트링(185-191)에서 `loader_version` 관련 줄도 삭제하고 다음 한 줄로 대체:

```rust
/// 워커 모드 업데이트 확인. 로더 버전 호환(min/maxLoaderVersion)은 여기서 필터하지 않고,
/// 각 업데이트에 min/max를 실어 `resolve_loader_for_updates`가 로더 상향을 판단하게 한다.
```

- [ ] **Step 6: 두 호출부 인자 제거**

`apps/launcher/src-tauri/src/game.rs:461-470`의 호출에서 `profile.loader_version.as_deref().unwrap_or(""),` 줄을 삭제:

```rust
            let updates = hyenimc_launcher::workermods::check_all_updates(
                &http,
                &base,
                &mods_dir,
                &profile.game_version,
                &profile.loader_type,
                true, // include_all
                true, // has_authorized_server
            )
```

`apps/launcher/src-tauri/src/hyeni.rs:56-65`의 호출에서 `"",` 줄을 삭제:

```rust
    workermods::check_all_updates(
        &http,
        &base,
        &profile_dir.join("mods"),
        &game_version,
        &loader_type,
        false, // include_all=false — 수동 패널은 게이트 적용
        has_authorized_server,
    )
```

기존 테스트 `download_url_encodes_token`의 `WorkerModUpdate { ... }`(454-470)에도 세 필드를 추가한다:

```rust
            loader_type: "neoforge".into(),
            game_version: "1.21.1".into(),
            min_loader_version: None,
            max_loader_version: None,
            required_loader_version: None,
        };
```

- [ ] **Step 7: 테스트 통과 + 빌드 확인**

Run: `cargo test -p hyenimc-launcher`
Expected: PASS (신규 + 기존 모두)
Run: `cargo build -p hyenimc-launcher-app` (또는 워크스페이스 `cargo build`)
Expected: 컴파일 성공(두 호출부 인자 정합)

- [ ] **Step 8: 커밋**

```bash
git add crates/hyenimc-launcher/src/workermods.rs apps/launcher/src-tauri/src/game.rs apps/launcher/src-tauri/src/hyeni.rs
git commit -m "refactor: WorkerModUpdate에 로더 범위 필드 추가, check_all_updates 로더 스킵 제거"
```

---

### Task 2: 로더 해석 로직 (순수 계산 + async 후보 조회)

[min,max] 교집합과 최신 후보 선택은 순수 함수로 분리해 네트워크 없이 테스트한다. 후보 목록만 `loader.rs`가 async로 가져온다.

**Files:**
- Modify: `crates/hyenimc-launcher/src/loader.rs` (`neoforge_versions` 근처에 추가)
- Modify: `crates/hyenimc-launcher/src/workermods.rs` (`is_newer_version` 근처 + 하단 async)
- Test: `crates/hyenimc-launcher/src/workermods.rs` (`#[cfg(test)]`)

**Interfaces:**
- Consumes (Task 1): `WorkerModUpdate.min_loader_version/max_loader_version`, `version_key`(private, 동일 모듈), `loader_version_ok`(private, 동일 모듈).
- Produces:
  - `loader::installable_loader_versions(http: &reqwest::Client, loader_type: &str, mc_version: &str) -> Result<Vec<String>, LauncherError>`
  - `loader::forge_build_part<'a>(version: &'a str, mc_version: &str) -> &'a str` (pub)
  - `workermods::newest_in_range(candidates: &[String], lo: Option<&str>, hi: Option<&str>) -> Option<String>` (pub)
  - `workermods::loader_range_intersection(ranges: &[(Option<String>, Option<String>)]) -> (Option<String>, Option<String>)` (pub)
  - `workermods::LoaderBump { pub version: String }` (pub struct)
  - `workermods::resolve_loader_for_updates(http, loader_type, game_version, current_loader_version, updates) -> Result<Option<LoaderBump>, LauncherError>` (pub async) — forge는 `forge_build_part`로 정규화 후 비교, 반환은 전체 형식.

- [ ] **Step 1: 실패하는 순수 테스트 작성**

`workermods.rs`의 `#[cfg(test)] mod tests`에 추가:

```rust
    #[test]
    fn newest_in_range_picks_highest_within_bounds() {
        let c = vec!["0.16.5".to_string(), "0.16.10".to_string(), "0.17.0".to_string(), "0.15.0".to_string()];
        assert_eq!(newest_in_range(&c, Some("0.16.0"), Some("0.16.10")).as_deref(), Some("0.16.10"));
        assert_eq!(newest_in_range(&c, Some("0.16.0"), None).as_deref(), Some("0.17.0"));
        assert_eq!(newest_in_range(&c, None, Some("0.15.0")).as_deref(), Some("0.15.0"));
        assert_eq!(newest_in_range(&c, Some("0.18.0"), None), None);          // 범위 밖
        assert_eq!(newest_in_range(&c, Some(""), Some("")).as_deref(), Some("0.17.0")); // 빈=제약없음
    }

    #[test]
    fn loader_range_intersection_narrows() {
        let ranges = vec![
            (Some("0.16.0".to_string()), None),
            (Some("0.15.0".to_string()), Some("0.17.0".to_string())),
            (None, Some("0.16.10".to_string())),
        ];
        let (lo, hi) = loader_range_intersection(&ranges);
        assert_eq!(lo.as_deref(), Some("0.16.0"));  // max of mins
        assert_eq!(hi.as_deref(), Some("0.16.10")); // min of maxs
    }

    #[test]
    fn loader_range_intersection_none_when_unconstrained() {
        let ranges = vec![(None, None), (Some(String::new()), Some(String::new()))];
        let (lo, hi) = loader_range_intersection(&ranges);
        assert_eq!(lo, None);
        assert_eq!(hi, None);
    }

    #[test]
    fn forge_build_part_strips_mc_prefix_for_comparison() {
        use crate::loader::forge_build_part;
        assert_eq!(forge_build_part("1.20.1-47.4.20", "1.20.1"), "47.4.20");
        assert_eq!(forge_build_part("47.4.20", "1.20.1"), "47.4.20"); // build-only 입력은 그대로
        // build 부분만 비교하면 47.4.20 > 47.4.9 로 정상 정렬(문자열 비교였다면 47.4.9가 뒤).
        let c = vec!["1.20.1-47.4.20".to_string(), "1.20.1-47.4.9".to_string()];
        let norm: Vec<String> = c.iter().map(|v| forge_build_part(v, "1.20.1").to_string()).collect();
        assert_eq!(newest_in_range(&norm, Some("47.4.0"), None).as_deref(), Some("47.4.20"));
    }
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cargo test -p hyenimc-launcher newest_in_range_picks_highest_within_bounds`
Expected: FAIL — `cannot find function newest_in_range`

- [ ] **Step 3: 순수 함수 구현**

`workermods.rs`의 `is_newer_version`(134-136) 아래에 추가. `loader_range_intersection`은 (min,max) 범위 슬라이스를 받아, forge 정규화를 호출부(resolve)가 미리 적용할 수 있게 한다:

```rust
/// candidates 중 [lo, hi] 범위(빈 문자열/None = 경계 없음)를 만족하는 최신(version_key 최대) 반환.
pub fn newest_in_range(candidates: &[String], lo: Option<&str>, hi: Option<&str>) -> Option<String> {
    let lo_key = lo.filter(|s| !s.is_empty()).map(version_key);
    let hi_key = hi.filter(|s| !s.is_empty()).map(version_key);
    candidates
        .iter()
        .filter(|c| {
            let k = version_key(c);
            lo_key.as_ref().is_none_or(|l| &k >= l) && hi_key.as_ref().is_none_or(|h| &k <= h)
        })
        .max_by_key(|c| version_key(c))
        .cloned()
}

/// (min,max) 범위들의 교집합: lo = 최대 min, hi = 최소 max. 빈/None은 제약 없음.
pub fn loader_range_intersection(
    ranges: &[(Option<String>, Option<String>)],
) -> (Option<String>, Option<String>) {
    let mut lo: Option<String> = None;
    let mut hi: Option<String> = None;
    for (min, max) in ranges {
        if let Some(m) = min.as_deref().filter(|s| !s.is_empty()) {
            if lo.as_deref().is_none_or(|cur| version_key(m) > version_key(cur)) {
                lo = Some(m.to_string());
            }
        }
        if let Some(m) = max.as_deref().filter(|s| !s.is_empty()) {
            if hi.as_deref().is_none_or(|cur| version_key(m) < version_key(cur)) {
                hi = Some(m.to_string());
            }
        }
    }
    (lo, hi)
}
```

> `Option::is_none_or`는 Rust 1.82+ 안정화. toolchain이 낮으면 `map_or(true, ...)`로 대체(동일 의미).

- [ ] **Step 4: 순수 테스트 통과 확인**

Run: `cargo test -p hyenimc-launcher newest_in_range_picks_highest_within_bounds loader_range_intersection_narrows loader_range_intersection_none_when_unconstrained`
Expected: PASS (forge_build_part 테스트는 Step 5 후 통과)

- [ ] **Step 5: 후보 조회 + forge 정규화(loader.rs) 구현**

`crates/hyenimc-launcher/src/loader.rs`의 `neoforge_versions`(121-130) 아래에 추가. `forge_versions(http, mc_version)`는 이미 `forge_matches_mc`로 MC 필터된 **전체 형식** 목록을 반환한다:

```rust
/// forge 메이븐 버전(`{mc}-{build}`, 예 `1.20.1-47.4.20`)에서 `{mc}-` 프리픽스를 떼어 build만 남긴다.
/// 프리픽스가 없으면(build-only 입력) 원본 그대로. 비교(version_key)가 build끼리 이뤄지게 정규화.
pub fn forge_build_part<'a>(version: &'a str, mc_version: &str) -> &'a str {
    version.strip_prefix(&format!("{mc_version}-")).unwrap_or(version)
}

/// 주어진 로더/ MC 버전에 설치 가능한 로더 버전 목록(설치용 전체 형식). 자동 교체는
/// fabric/neoforge/forge만 지원(그 외는 빈 목록 → 로더 상향 없음).
pub async fn installable_loader_versions(
    http: &reqwest::Client,
    loader_type: &str,
    mc_version: &str,
) -> Result<Vec<String>, LauncherError> {
    match loader_type {
        "fabric" => Ok(fabric_loader_versions(http, mc_version)
            .await?
            .into_iter()
            .map(|v| v.version)
            .collect()),
        "neoforge" => Ok(neoforge_versions(http)
            .await?
            .into_iter()
            .filter(|v| neoforge_matches_mc(v, mc_version))
            .collect()),
        "forge" => forge_versions(http, mc_version).await, // 이미 mc 필터·전체 형식
        _ => Ok(Vec::new()),
    }
}
```

- [ ] **Step 6: async 해석 함수 구현**

`workermods.rs` 하단(테스트 모듈 위, `download_url` 근처)에 추가:

```rust
/// 로더 상향 결과.
#[derive(Debug, Clone)]
pub struct LoaderBump {
    pub version: String,
}

/// updates의 로더 범위 교집합과 현재 loader_version을 비교해 필요 시 상향 버전을 계산.
/// - Ok(None): 변경 불필요(제약 없음 / 현재가 이미 범위 내 / 자동교체 미지원 로더).
/// - Ok(Some): loader_version을 이 값으로 올려야 함([min,max] 내 최신 릴리스, 설치용 전체 형식).
/// - Err: 범위를 만족하는 설치 가능한 로더가 없음.
///
/// forge는 `{mc}-{build}` 형식이라 비교 시 build 부분만 정규화해 쓰고, 반환은 전체 형식.
/// fabric/neoforge는 정규화가 항등(그대로 비교).
pub async fn resolve_loader_for_updates(
    http: &reqwest::Client,
    loader_type: &str,
    game_version: &str,
    current_loader_version: &str,
    updates: &[WorkerModUpdate],
) -> Result<Option<LoaderBump>, LauncherError> {
    // fabric/neoforge/forge 외에는 자동 교체 미지원 → 변경 없음.
    if !matches!(loader_type, "fabric" | "neoforge" | "forge") {
        return Ok(None);
    }
    // forge만 mc 프리픽스를 떼어 build 부분끼리 비교. 그 외는 항등.
    let norm = |v: &str| -> String {
        if loader_type == "forge" {
            crate::loader::forge_build_part(v, game_version).to_string()
        } else {
            v.to_string()
        }
    };

    let ranges: Vec<(Option<String>, Option<String>)> = updates
        .iter()
        .map(|u| {
            (
                u.min_loader_version.as_deref().map(&norm),
                u.max_loader_version.as_deref().map(&norm),
            )
        })
        .collect();
    let (lo, hi) = loader_range_intersection(&ranges);
    if lo.is_none() && hi.is_none() {
        return Ok(None); // 제약 없음
    }
    let cur = norm(current_loader_version);
    if !cur.is_empty() && loader_version_ok(&cur, lo.as_deref(), hi.as_deref()) {
        return Ok(None); // 이미 범위 내
    }

    let candidates_full =
        crate::loader::installable_loader_versions(http, loader_type, game_version).await?;
    let normalized: Vec<String> = candidates_full.iter().map(|c| norm(c)).collect();
    match newest_in_range(&normalized, lo.as_deref(), hi.as_deref()) {
        Some(win) => {
            // 정규화형 승자에 대응하는 전체 형식 후보를 되찾아 설치용으로 반환.
            let full = candidates_full
                .iter()
                .find(|c| norm(c) == win)
                .cloned()
                .unwrap_or(win);
            Ok(Some(LoaderBump { version: full }))
        }
        None => Err(LauncherError::Other(format!(
            "모드가 요구하는 로더 버전({}~{})을 설치할 수 없습니다.",
            lo.as_deref().unwrap_or("*"),
            hi.as_deref().unwrap_or("*"),
        ))),
    }
}
```

- [ ] **Step 7: 전체 테스트 + 빌드**

Run: `cargo test -p hyenimc-launcher`
Expected: PASS
Run: `cargo build -p hyenimc-launcher`
Expected: 성공

- [ ] **Step 8: 커밋**

```bash
git add crates/hyenimc-launcher/src/workermods.rs crates/hyenimc-launcher/src/loader.rs
git commit -m "feat: 로더 범위 해석(newest_in_range/교집합/resolve_loader_for_updates) 추가"
```

---

### Task 3: 실행 흐름 재배치 — 로더 설치 전에 로더 상향

`game.rs`의 로더 설치(③, 409-440)는 현재 워커모드 확인(③.5, 442-513)보다 **먼저** 실행된다. 로더 상향은 확인 결과에 의존하므로, **확인+해석을 로더 설치 앞으로 옮기고**, 모드 설치는 로더 설치 뒤에 둔다. 로더 설치는 상향된 loader_version을 그대로 사용한다.

**Files:**
- Modify: `apps/launcher/src-tauri/src/game.rs:409-513` (③ + ③.5 재구성)

**Interfaces:**
- Consumes: `hyenimc_launcher::workermods::{check_all_updates(Task1 시그니처), resolve_loader_for_updates, LoaderBump, WorkerModUpdate, install_updates}`, `hyenimc_launcher::hyeni::read_hyenihelper_token`, `crate::hyeni::should_check`, `crate::pack::{worker_base, forceable}`, `hyenimc_core::profile::{ProfilePatch, update_profile}`, `now_secs()`(game.rs:676), `db: State<DbState>`(game_launch 인자), `cfg`(③ 이전 정의됨).

- [ ] **Step 1: loader_version 선언을 ③ 앞으로 이동(가변) + 워커모드 사전 확인 블록 추가**

`game.rs`에서 `// ③ 로더 설치 → ...` 주석과 그 아래 `let http = ...; let loader_version = ...;`(409-411)를 다음으로 교체한다:

```rust
    // ②.9 워커 모드 사전 확인 + 로더 호환 판단 (로더 설치 전에 loader_version 확정)
    // 서버 필수 모드의 최신 버전이 현재 로더 버전 범위를 벗어나면 [min,max] 내 최신 로더로 상향한다
    // (다운그레이드 없음). 실제 로더 설치는 아래 ③가 이 loader_version으로 수행. force면 건너뜀.
    let http = reqwest::Client::new();
    let mut loader_version = profile.loader_version.clone().unwrap_or_default();
    let mut pending_worker_updates: Vec<hyenimc_launcher::workermods::WorkerModUpdate> = Vec::new();
    let mut worker_install_token: Option<String> = None;
    let mut worker_base_url: Option<String> = None;
    {
        let game_dir = std::path::PathBuf::from(&profile.game_directory);
        if !force && crate::hyeni::should_check(&game_dir, profile.server_address.as_deref()) {
            let _ = app.emit(
                "game:log",
                serde_json::json!({ "profileId": profile_id, "line": "[worker-mods] 모드 업데이트 확인 중..." }),
            );
            let base = crate::pack::worker_base().map_err(|_| {
                crate::pack::forceable(
                    "업데이트 서버 주소가 설정되지 않아 모드 최신 여부를 확인할 수 없습니다.\n그대로 실행하면 서버 접속이 안 될 수 있습니다.",
                )
            })?;
            let mods_dir = game_dir.join("mods");
            let updates = hyenimc_launcher::workermods::check_all_updates(
                &http,
                &base,
                &mods_dir,
                &profile.game_version,
                &profile.loader_type,
                true, // include_all — 실행 전엔 적용 가능한 모든 모드 확인
                true, // has_authorized_server — should_check 통과 시에만 진입
            )
            .await
            .map_err(|_| {
                crate::pack::forceable(
                    "업데이트 서버에 연결할 수 없어 모드 최신 여부를 확인하지 못했습니다.\n그대로 실행하면 서버 접속이 안 될 수 있습니다.",
                )
            })?;
            if !updates.is_empty() {
                let token = match hyenimc_launcher::hyeni::read_hyenihelper_token(&game_dir) {
                    Some(t) => t,
                    None => {
                        log::warn!(
                            "워커 모드 {}건 업데이트 필요하나 인증 토큰 없음 — 실행 중단",
                            updates.len()
                        );
                        return Err("모드 업데이트를 위한 인증이 필요합니다.\n\nDiscord에서 /인증 명령어로 인증하세요.".to_string());
                    }
                };
                // 로더 호환 판단 → 필요 시 loader_version 상향 + 프로필 반영
                match hyenimc_launcher::workermods::resolve_loader_for_updates(
                    &http,
                    &profile.loader_type,
                    &profile.game_version,
                    &loader_version,
                    &updates,
                )
                .await
                {
                    Ok(Some(bump)) if bump.version != loader_version => {
                        let _ = app.emit(
                            "game:log",
                            serde_json::json!({ "profileId": profile_id, "line": format!("[loader] 모드 호환을 위해 로더 버전을 {}로 변경합니다.", bump.version) }),
                        );
                        loader_version = bump.version.clone();
                        let patch = hyenimc_core::profile::ProfilePatch {
                            loader_version: Some(bump.version.clone()),
                            ..Default::default()
                        };
                        if let Err(e) = hyenimc_core::profile::update_profile(
                            &db.0.lock().unwrap(),
                            &profile_id,
                            &patch,
                            now_secs(),
                        ) {
                            log::warn!("로더 버전 프로필 반영 실패: {e}");
                        }
                    }
                    Ok(_) => {}
                    Err(e) => {
                        return Err(crate::pack::forceable(&format!(
                            "{e}\n그대로 실행하면 서버 접속이 안 될 수 있습니다."
                        )));
                    }
                }
                pending_worker_updates = updates;
                worker_install_token = Some(token);
                worker_base_url = Some(base);
            }
        }
    }

    // ③ 로더 설치 → 실효 version_id 결정 (loader_version은 ②.9에서 확정, vanilla면 게임 버전 그대로)
    let version_id = match profile.loader_type.as_str() {
```

> `let version_id = match ...` 이하 fabric/neoforge/forge/`_` 분기(412-440)는 **그대로 둔다**. 이제 그 분기가 참조하는 `loader_version`이 ②.9에서 상향된 값이다.

- [ ] **Step 2: 기존 ③.5 블록을 로더 설치 뒤 설치 전용으로 교체**

`// ③.5 워커 모드 자동 업데이트 ...` 주석부터 블록 끝 `}`(442-513, `let detail = ...` 바로 위)까지 전체를 다음으로 교체한다:

```rust
    // ③.5 워커 모드 설치 (②.9에서 확인한 업데이트를 로더 설치 뒤에 설치)
    if let (Some(token), Some(base)) = (worker_install_token.as_ref(), worker_base_url.as_ref()) {
        if !pending_worker_updates.is_empty() {
            let mods_dir = std::path::PathBuf::from(&profile.game_directory).join("mods");
            let app_log = app.clone();
            let pid = profile_id.clone();
            hyenimc_launcher::workermods::install_updates(
                &http,
                base,
                &mods_dir,
                &pending_worker_updates,
                token,
                &cfg,
                move |name, pct| {
                    let _ = app_log.emit(
                        "game:log",
                        serde_json::json!({ "profileId": &pid, "line": format!("[worker-mods] {name} {pct}%") }),
                    );
                    let _ = app_log.emit(
                        "download:progress",
                        serde_json::json!({
                            "profileId": &pid,
                            "phase": "worker-mods",
                            "percent": pct,
                            "currentFile": name,
                        }),
                    );
                },
            )
            .await
            .map_err(|e| e.to_string())?;
        }
    }
```

- [ ] **Step 3: 컴파일 확인**

Run: `cargo build -p hyenimc-launcher-app`
Expected: 성공. (경고 확인: `worker_install_token`/`worker_base_url`은 ③.5에서 소비됨. `cfg`가 ③ 이전에 정의돼 있는지 확인 — install_fabric/neoforge 호출이 `&cfg`를 쓰므로 이미 정의됨.)

- [ ] **Step 4: 기존 런처 테스트 회귀 없음 확인**

Run: `cargo test -p hyenimc-launcher`
Expected: PASS (11 테스트 유지)

- [ ] **Step 5: 수동 점검 체크리스트(문서화, 실행은 사용자 몫)**

계획서에 다음을 남긴다(실 게임 실행은 사용자 검증):
1. fabric 프로필 + 현재 로더가 모드 요구 범위 밖 → 로그에 `[loader] 모드 호환을 위해 로더 버전을 X로 변경합니다.` 후 그 로더로 설치.
2. 현재 로더가 범위 내 → 로더 변경 없음, 모드만 업데이트.
3. force 실행 → ②.9 건너뜀(기존과 동일).
4. 인증 토큰 없음 + 업데이트 필요 → 실행 중단(기존과 동일).

- [ ] **Step 6: 커밋**

```bash
git add apps/launcher/src-tauri/src/game.rs
git commit -m "feat: 실행 시 로더 설치 전 워커모드 확인·로더 상향 재배치"
```

---

### Task 4: 업데이트 패널 경로에 로더 변경 정보 전달 (hyeni.rs)

프로필 개요 업데이트 패널이 "모드 로더도 함께 업데이트됩니다"를 보이도록, `worker_mods_check`가 프로필 loader_version을 받아 해석하고 `required_loader_version`을 스탬프한다. (설치/반영은 하지 않음 — 실제 로더 설치는 다음 실행의 game.rs가 수행.)

**Files:**
- Modify: `apps/launcher/src-tauri/src/hyeni.rs:39-68` (`worker_mods_check`)

**Interfaces:**
- Consumes: `workermods::resolve_loader_for_updates`, `workermods::WorkerModUpdate`.
- Produces: `worker_mods_check(profile_path, game_version, loader_type, loader_version, server_address)` — 인자에 `loader_version: String` 추가(순서: game_version, loader_type, **loader_version**, server_address). 반환 `Vec<WorkerModUpdate>`의 각 항목에 로더 변경 필요 시 `required_loader_version = Some(v)` 스탬프.

- [ ] **Step 1: `worker_mods_check` 시그니처 + 해석/스탬프 구현**

`apps/launcher/src-tauri/src/hyeni.rs`의 `worker_mods_check`(39-68)를 교체:

```rust
pub async fn worker_mods_check(
    profile_path: String,
    game_version: String,
    loader_type: String,
    loader_version: String,
    server_address: Option<String>,
) -> Result<Vec<workermods::WorkerModUpdate>, String> {
    let profile_dir = PathBuf::from(&profile_path);
    let has_authorized_server = server_address
        .as_deref()
        .is_some_and(|s| !s.is_empty() && is_authorized_server(s));
    let base = crate::pack::worker_base()?;
    let http = reqwest::Client::new();
    let mut updates = workermods::check_all_updates(
        &http,
        &base,
        &profile_dir.join("mods"),
        &game_version,
        &loader_type,
        false, // include_all=false — 수동 패널은 게이트 적용
        has_authorized_server,
    )
    .await
    .map_err(|e| e.to_string())?;

    // 로더 호환 판단 → 필요하면 각 업데이트에 required_loader_version 스탬프(표시용).
    // 실제 로더 설치/프로필 반영은 다음 게임 실행(game.rs)이 수행한다.
    match workermods::resolve_loader_for_updates(
        &http,
        &loader_type,
        &game_version,
        &loader_version,
        &updates,
    )
    .await
    {
        Ok(Some(bump)) => {
            for u in &mut updates {
                u.required_loader_version = Some(bump.version.clone());
            }
        }
        Ok(None) => {}
        Err(e) => log::warn!("업데이트 패널 로더 해석 실패(무시): {e}"),
    }

    Ok(updates)
}
```

- [ ] **Step 2: 컴파일 확인(호출부 불일치 노출)**

Run: `cargo build -p hyenimc-launcher-app`
Expected: FAIL — `worker_mods_check` 인자 수 불일치는 Tauri 매크로 경유라 빌드는 통과할 수 있음. 실제 인자 배선은 Task 5(shim). 여기서는 **컴파일만** 확인(Tauri command는 인자를 이름 기반으로 역직렬화하므로 시그니처 추가는 컴파일 OK).
실제 Expected: PASS (컴파일). 런타임 계약은 Task 5에서 맞춘다.

- [ ] **Step 3: 런처 테스트 회귀 없음**

Run: `cargo test -p hyenimc-launcher`
Expected: PASS

- [ ] **Step 4: 커밋**

```bash
git add apps/launcher/src-tauri/src/hyeni.rs
git commit -m "feat: worker_mods_check에 loader_version 인자 + required_loader_version 스탬프"
```

---

### Task 5: 렌더러 배선 — loaderVersion 전달 + 타입

`worker_mods_check`가 loader_version을 요구하므로 shim→훅→페이지로 프로필 loader_version을 흘려보내고, 타입에 `requiredLoaderVersion`을 추가한다. Rust가 camelCase로 직렬화하므로 shim의 `...u` 스프레드로 자동 전달된다.

**Files:**
- Modify: `src/shared/types/worker-mods.ts` (`WorkerModUpdateCheck`)
- Modify: `src/renderer/tauri-shim.ts:222-234` (`checkUpdates`)
- Modify: `src/renderer/hooks/useWorkerModUpdates.ts` (옵션 + 호출)
- Modify: `src/renderer/pages/ProfileDetailPage.tsx:432-444` (훅 인자)

**Interfaces:**
- Consumes(Task 4): Tauri `worker_mods_check`가 `loaderVersion` 인자 요구, 응답에 `requiredLoaderVersion` 포함.
- Produces: `WorkerModUpdateCheck.requiredLoaderVersion?: string | null`. `checkUpdates(profilePath, gameVersion, loaderType, loaderVersion, serverAddress?)`.

- [ ] **Step 1: 타입에 필드 추가**

`src/shared/types/worker-mods.ts`의 `WorkerModUpdateCheck` 끝(`loader: string;` 아래)에 추가:

```ts
  loader: string;
  /** 이 업데이트가 로더 버전 변경을 요구하면 대상 로더 버전(없으면 변경 불필요) */
  requiredLoaderVersion?: string | null;
}
```

- [ ] **Step 2: shim `checkUpdates`에 loaderVersion 인자 추가**

`src/renderer/tauri-shim.ts`의 `checkUpdates`(222-231)를 교체:

```ts
    checkUpdates: async (profilePath: string, gameVersion: string, loaderType: string, loaderVersion: string, serverAddress?: string) => {
      const updates = (await invoke('worker_mods_check', {
        profilePath,
        gameVersion,
        loaderType,
        loaderVersion,
        serverAddress,
      })) as any[];
      // Rust는 modName/loaderType으로 주지만 렌더러(ModUpdateItem)는 name/loader를 표시하므로 매핑.
      // requiredLoaderVersion 등 나머지 필드는 ...u로 그대로 통과.
      return updates.map((u) => ({ ...u, name: u.modName, loader: u.loaderType }));
    },
```

- [ ] **Step 3: 훅에 loaderVersion 옵션 추가 + 전달**

`src/renderer/hooks/useWorkerModUpdates.ts`:

옵션 인터페이스(9-16)에 추가:

```ts
interface UseWorkerModUpdatesOptions {
  profilePath: string;
  gameVersion: string;
  loaderType: string;
  loaderVersion: string;
  serverAddress?: string;
  autoCheck?: boolean;
  checkInterval?: number;
}
```

구조 분해(18-25)에 `loaderVersion` 추가:

```ts
export function useWorkerModUpdates({
  profilePath,
  gameVersion,
  loaderType,
  loaderVersion,
  serverAddress,
  autoCheck = true,
  checkInterval = 30 * 60 * 1000
}: UseWorkerModUpdatesOptions) {
```

`checkForUpdates`의 호출(45-50)과 의존성 배열(65)에 반영:

```ts
      const result = await window.electronAPI.workerMods.checkUpdates(
        profilePath,
        gameVersion,
        loaderType,
        loaderVersion,
        serverAddress
      );
```

```ts
  }, [profilePath, gameVersion, loaderType, loaderVersion, serverAddress]);
```

- [ ] **Step 4: ProfileDetailPage에서 loaderVersion 전달**

`src/renderer/pages/ProfileDetailPage.tsx`의 `useWorkerModUpdates({ ... })` 호출(432-444 근처, `loaderType: profile?.loaderType || '',` 줄 아래)에 추가:

```ts
    loaderType: profile?.loaderType || '',
    loaderVersion: profile?.loaderVersion || '',
```

- [ ] **Step 5: 타입체크 + 빌드**

Run: `npm run build` (또는 프로젝트의 `tsc --noEmit` 스크립트)
Expected: 타입 오류 없음. `checkUpdates` 인자 5개 정합, `requiredLoaderVersion` 인식.

- [ ] **Step 6: 커밋**

```bash
git add src/shared/types/worker-mods.ts src/renderer/tauri-shim.ts src/renderer/hooks/useWorkerModUpdates.ts src/renderer/pages/ProfileDetailPage.tsx
git commit -m "feat: 렌더러에 loaderVersion 배선 + requiredLoaderVersion 타입"
```

---

### Task 6: 업데이트 패널에 로더 변경 안내

업데이트 중 하나라도 `requiredLoaderVersion`을 가지면 헤더 아래에 `모드 로더도 함께 업데이트됩니다 (→ X)` 한 줄을 표시한다.

**Files:**
- Modify: `src/renderer/components/worker-mods/WorkerModUpdatePanel.tsx`

**Interfaces:**
- Consumes(Task 5): `WorkerModUpdateCheck.requiredLoaderVersion`.

- [ ] **Step 1: 로더 변경 대상 계산 + 안내 렌더**

`WorkerModUpdatePanel.tsx`의 `newOptionalMods` useMemo(46-49) 아래에 추가:

```tsx
  const loaderChange = useMemo(
    () => updates.find(u => u.requiredLoaderVersion)?.requiredLoaderVersion ?? null,
    [updates]
  );
```

헤더의 부제 `<p>`(90-95) 바로 아래(같은 `<div>` 안)에 삽입:

```tsx
          {loaderChange && (
            <p className="text-sm text-amber-300 mt-1 flex items-center gap-1">
              🔧 모드 로더도 함께 업데이트됩니다 <span className="font-mono">(→ {loaderChange})</span>
            </p>
          )}
```

- [ ] **Step 2: 빌드 확인**

Run: `npm run build`
Expected: 성공. (선택) 개발 서버에서 패널에 안내가 뜨는지 시각 확인.

- [ ] **Step 3: 커밋**

```bash
git add src/renderer/components/worker-mods/WorkerModUpdatePanel.tsx
git commit -m "feat: 업데이트 패널에 로더 변경 안내 표시"
```

---

## Self-Review

**Spec 커버리지(§4-3 B + 렌더러):**
- (B) 로더 범위 판단 → Task 2 `resolve_loader_for_updates` + Task 1 필드. ✅
- [min,max] 내 최신 로더로 loader_version 세팅 → Task 2 `newest_in_range`/교집합 + Task 3 상향·반영. ✅
- 실제 설치는 기존 launch 흐름 → Task 3 로더 설치 분기 그대로 사용(loader_version만 상향). ✅
- [min,max] 만족 로더 없음 → Task 2 `Err` + Task 3 forceable 안내. ✅
- `WorkerModUpdate`에 로더 변경 정보 → Task 1 `required_loader_version` + Task 4 스탬프. ✅
- 렌더러 "모드 로더도 함께 업데이트됩니다" → Task 6. ✅
- '업데이트'/'게임 시작' 양쪽 → 게임 시작=Task 3(설치까지), 업데이트 패널=Task 4/6(표시) + 다음 실행 설치. ✅
- 혜니팩 로더 = 기존 install_pack이 처리(무변경). ✅ (범위 밖, 확인만)

**플레이스홀더 스캔:** 없음(모든 코드 블록 완전). `is_none_or` toolchain 노트 명시.

**타입 정합:** `resolve_loader_for_updates`/`LoaderBump`/`newest_in_range`/`loader_range_intersection`/`installable_loader_versions`/`required_loader_version`/`check_all_updates`(7-arg) 시그니처가 Task 1·2·3·4에서 일관. `checkUpdates` 5-arg가 Task 4(Rust)·5(shim/훅/페이지)에서 일관.

## 미결/주의
- **forge 지원됨**(이번 배포 주 작업). `{mc}-{build}` 프리픽스 정규화로 build끼리 비교, 설치는 전체 형식. 관리자가 min/max를 전체(`1.20.1-47.4.20`)/ build-only(`47.4.20`) 어느 형식으로 넣어도 동작. 단 **아주 오래된 forge**(1.7.10대 `<mc>-<build>-<mc>` 이중 접미사)는 대상 아님(HyeniWorld 미사용).
- **quilt 미지원**(더 이상 사용 안 함) — 후보 빈 목록 → 변경 없음.
- **Task 3는 실행 흐름 재배치**라 회귀 위험이 가장 크다. 리뷰에서 force/인증/에러 경로가 기존과 동일 의미인지 집중 확인.
- 배포/검증은 사용자 몫: 런처 빌드 후 실제 프로필로 로더 상향 시나리오 확인(특히 forge).
