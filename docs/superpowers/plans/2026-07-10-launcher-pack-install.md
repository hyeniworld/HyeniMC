# Plan C-2: 런처 혜니팩 검색·설치 + 토큰 저장소 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 런처에서 혜니팩을 목록·검색으로 설치(파일 전달 불필요)하고, 서버 스코프별 토큰 저장소로 신규 사용자 온보딩(딥링크 원클릭 포함)을 완성한다. 스펙: [2026-07-10-hyenipack-install-from-worker-design.md](../specs/2026-07-10-hyenipack-install-from-worker-design.md) §2-1/2-3/2-4/2-5. **Plan C-1(워커) 배포 완료 전제.**

**Architecture:** 토큰 저장소는 기존 `global_settings` kv 테이블에 JSON 배열 1키(`hyeni.auth_tokens`) — 마이그레이션 불필요. 딥링크가 항상 적재(같은 서버 세트 교체). 다운로드 토큰 우선순위 = 프로필 config → 저장소(스코프 무관). **config 기록은 언제나 서버 매칭 통과 시만.** 설치는 기존 파이프(`download_pack_version`→`hyenipack_import`) 재사용. UI는 기존 혜니팩 탭(`HyeniPackImportTab`)을 온라인 목록 우선으로 확장.

**Tech Stack:** Rust(hyenimc-core rusqlite / hyenimc-launcher reqwest·serde / Tauri 커맨드), React 렌더러(tauri-shim 배선), cargo test / tsc.

## Global Constraints

- **토큰은 (디스코드 채널×서버) 세트별** — 프로필 config(`config/hyenihelper-config.json`)에 쓰는 것은 **항상 서버 매칭(`servers_dat_contains`) 통과 시만**. 아무 토큰이나 config에 쓰는 경로 금지.
- **다운로드 토큰 우선순위**: 프로필 config 토큰 → 저장소 아무 유효 토큰(최신 우선) → 없으면 `"모드 업데이트를 위한 인증이 필요합니다.\n\nDiscord에서 /인증 명령어로 인증하세요."` 계열 안내.
- **hyenipack_import 내부는 건드리지 않는다**(파일 import는 실사용 검증된 경로). 교정 대상은 `download_pack_version`에 넘기는 토큰뿐.
- 딥링크 `hyenipack` 파라미터 없으면 기존 동작 그대로(하위호환). 자동 설치는 **확인 다이얼로그 필수**.
- 저장소 JSON 스키마: `[{"token":"...","servers":["mc.x.y"],"receivedAt":123}]` (camelCase). servers 정규화 = trim+lowercase, 세트 비교는 순서 무관.
- 커밋 attribution 금지. 검증: `cargo test -p hyenimc-core -p hyenimc-launcher` + `cargo build` + `npx tsc -p tsconfig.json --noEmit`.

---

## 파일 구조

| 파일 | 변경 |
|---|---|
| `crates/hyenimc-core/src/hyeni_tokens.rs` | 신규 — 토큰 저장소(kv JSON) CRUD |
| `crates/hyenimc-core/src/lib.rs` | `pub mod hyeni_tokens;` |
| `crates/hyenimc-launcher/src/hyeni.rs` | `parse_auth_url` 3-튜플 확장(hyenipack) |
| `crates/hyenimc-launcher/src/hyenipack.rs` | `PackListItem`/`fetch_pack_list`/`fetch_pack_latest_version` |
| `apps/launcher/src-tauri/src/hyeni.rs` | 딥링크: 항상 저장 + 0-프로필 성공 + pack suggest/exists emit |
| `apps/launcher/src-tauri/src/pack.rs` | 토큰 해석 헬퍼 + `pack_apply_update` 교정 + `pack_list_available`/`pack_install_from_worker` |
| `apps/launcher/src-tauri/src/game.rs` | ②.9 no-token 시 저장소 매칭 폴백 |
| `apps/launcher/src-tauri/src/main.rs` | 커맨드 2개 등록 |
| `src/renderer/tauri-shim.ts` | `hyenipack.listAvailable`/`installFromWorker` |
| `src/renderer/components/profiles/HyeniPackImportTab.tsx` | 온라인 목록+검색 우선, 파일은 보조 |
| `src/renderer/components/hyeni/HyeniPackSuggestDialog.tsx` | 신규 — 딥링크 확인→설치 |

---

### Task 1: 토큰 저장소 (hyenimc-core)

**Files:**
- Create: `crates/hyenimc-core/src/hyeni_tokens.rs`
- Modify: `crates/hyenimc-core/src/lib.rs` (`pub mod hyeni_tokens;` 추가)

**Interfaces:**
- Produces:
  - `pub struct StoredToken { pub token: String, pub servers: Vec<String>, pub received_at: i64 }` (serde camelCase)
  - `pub fn list_tokens(conn) -> Result<Vec<StoredToken>, CoreError>` — 최신(received_at desc) 정렬, 키 부재/손상 JSON → 빈 Vec
  - `pub fn upsert_token(conn, token: &str, servers: &[String], now_secs: i64) -> Result<(), CoreError>` — 같은 servers 세트(정규화·순서무관)면 교체, 아니면 추가
  - `pub fn any_token(conn) -> Result<Option<String>, CoreError>` — 최신 엔트리의 token
- 저장: `global_settings` kv, key = `hyeni.auth_tokens`.

- [ ] **Step 1: 실패하는 테스트 작성** — `hyeni_tokens.rs` 하단 `#[cfg(test)]`. 인메모리 DB에 `global_settings` DDL(settings.rs 테스트와 동일: `CREATE TABLE global_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);`)을 만든 뒤:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE global_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);",
        ).unwrap();
        conn
    }

    #[test]
    fn upsert_and_list_ordered_by_recency() {
        let conn = db();
        upsert_token(&conn, "tok-a", &["mc.a.com".into()], 100).unwrap();
        upsert_token(&conn, "tok-b", &["mc.b.com".into()], 200).unwrap();
        let list = list_tokens(&conn).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].token, "tok-b"); // 최신 우선
        assert_eq!(any_token(&conn).unwrap().as_deref(), Some("tok-b"));
    }

    #[test]
    fn same_server_set_replaces_regardless_of_order_and_case() {
        let conn = db();
        upsert_token(&conn, "old", &["MC.A.com".into(), "mc.b.com".into()], 100).unwrap();
        upsert_token(&conn, "new", &["mc.b.com".into(), "mc.a.com ".into()], 200).unwrap();
        let list = list_tokens(&conn).unwrap();
        assert_eq!(list.len(), 1); // 교체, 추가 아님
        assert_eq!(list[0].token, "new");
    }

    #[test]
    fn empty_servers_entry_is_its_own_set() {
        let conn = db();
        upsert_token(&conn, "scoped", &["mc.a.com".into()], 100).unwrap();
        upsert_token(&conn, "unscoped", &[], 200).unwrap();
        assert_eq!(list_tokens(&conn).unwrap().len(), 2);
        upsert_token(&conn, "unscoped2", &[], 300).unwrap(); // 빈 세트끼리는 교체
        let list = list_tokens(&conn).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].token, "unscoped2");
    }

    #[test]
    fn missing_or_corrupt_value_yields_empty() {
        let conn = db();
        assert!(list_tokens(&conn).unwrap().is_empty());
        conn.execute(
            "INSERT INTO global_settings(key,value,updated_at) VALUES('hyeni.auth_tokens','{broken',0)",
            [],
        ).unwrap();
        assert!(list_tokens(&conn).unwrap().is_empty()); // 손상 → 빈 목록(에러 아님)
        assert_eq!(any_token(&conn).unwrap(), None);
    }
}
```

- [ ] **Step 2: 실패 확인**

Run: `cargo test -p hyenimc-core hyeni_tokens`
Expected: FAIL — 모듈 없음(컴파일 에러).

- [ ] **Step 3: 구현**

```rust
//! 런처 전역 인증 토큰 저장소 — (디스코드 채널×서버) 세트별 다중 엔트리.
//! global_settings kv 1키(hyeni.auth_tokens)에 JSON 배열로 저장(스키마 마이그레이션 불필요).
//! 프로필 config 기록은 호출자가 서버 매칭을 통과했을 때만 한다(스펙 §2-1).

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::CoreError;

const KV_KEY: &str = "hyeni.auth_tokens";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredToken {
    pub token: String,
    #[serde(default)]
    pub servers: Vec<String>,
    #[serde(default)]
    pub received_at: i64,
}

fn normalize_set(servers: &[String]) -> Vec<String> {
    let mut v: Vec<String> = servers.iter().map(|s| s.trim().to_lowercase()).filter(|s| !s.is_empty()).collect();
    v.sort();
    v.dedup();
    v
}

fn read_raw(conn: &Connection) -> Result<Vec<StoredToken>, CoreError> {
    let raw: Option<String> = conn
        .query_row("SELECT value FROM global_settings WHERE key = ?1", [KV_KEY], |r| r.get(0))
        .map(Some)
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(other),
        })?;
    let Some(raw) = raw else { return Ok(Vec::new()) };
    Ok(serde_json::from_str(&raw).unwrap_or_default()) // 손상 → 빈 목록
}

fn write_raw(conn: &Connection, tokens: &[StoredToken], now_secs: i64) -> Result<(), CoreError> {
    let json = serde_json::to_string(tokens).map_err(|e| CoreError::Other(e.to_string()))?;
    conn.execute(
        "INSERT INTO global_settings(key, value, updated_at) VALUES(?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = ?3",
        rusqlite::params![KV_KEY, json, now_secs],
    )?;
    Ok(())
}

/// 최신(received_at desc) 정렬 목록. 키 부재/손상 JSON → 빈 Vec.
pub fn list_tokens(conn: &Connection) -> Result<Vec<StoredToken>, CoreError> {
    let mut tokens = read_raw(conn)?;
    tokens.sort_by(|a, b| b.received_at.cmp(&a.received_at));
    Ok(tokens)
}

/// 같은 servers 세트(정규화·순서 무관)면 교체, 아니면 추가.
pub fn upsert_token(conn: &Connection, token: &str, servers: &[String], now_secs: i64) -> Result<(), CoreError> {
    let mut tokens = read_raw(conn)?;
    let key = normalize_set(servers);
    tokens.retain(|t| normalize_set(&t.servers) != key);
    tokens.push(StoredToken {
        token: token.to_string(),
        servers: servers.to_vec(),
        received_at: now_secs,
    });
    write_raw(conn, &tokens, now_secs)
}

/// 최신 엔트리의 토큰(다운로드 폴백용 — 스코프 무관하게 유효하기만 하면 됨).
pub fn any_token(conn: &Connection) -> Result<Option<String>, CoreError> {
    Ok(list_tokens(conn)?.into_iter().next().map(|t| t.token))
}
```

`CoreError::Other`가 없으면 lib.rs의 CoreError를 확인해 기존 variant(예: serde/json용)를 쓰거나 동일 관례의 variant를 추가한다(기존 코드 관례 우선).

- [ ] **Step 4: 통과 확인**

Run: `cargo test -p hyenimc-core`
Expected: 전체 PASS.

- [ ] **Step 5: 커밋**

```bash
git add crates/hyenimc-core/src/hyeni_tokens.rs crates/hyenimc-core/src/lib.rs
git commit -m "feat: 런처 토큰 저장소(hyeni_tokens) — 서버 세트별 다중 엔트리 kv 저장"
```

---

### Task 2: parse_auth_url 확장 + 팩 목록/latest fetch (hyenimc-launcher)

**Files:**
- Modify: `crates/hyenimc-launcher/src/hyeni.rs` (parse_auth_url, 기존 테스트)
- Modify: `crates/hyenimc-launcher/src/hyenipack.rs` (fetch 함수 + 타입)

**Interfaces:**
- Produces:
  - `parse_auth_url(url) -> Option<(String, Vec<String>, Option<String>)>` — 세 번째 = `hyenipack` 쿼리 파라미터(비면 None)
  - `hyenipack::PackListItem { id, name, latest_version: Option<String>, breaking: bool, minecraft: Option<PackListMinecraft> }`, `PackListMinecraft { version, loader_type, loader_version }` (모두 serde camelCase, Serialize+Deserialize — 렌더러로 그대로 직렬화)
  - `hyenipack::fetch_pack_list(http, worker_base) -> Result<Vec<PackListItem>, LauncherError>` — `GET {base}/api/v2/modpacks`의 `{packs}`
  - `hyenipack::fetch_pack_latest_version(http, worker_base, id) -> Result<Option<String>, LauncherError>` — `GET /{id}/latest`의 `version`, 404→`Ok(None)`

- [ ] **Step 1: 실패하는 테스트 작성**

hyeni.rs 테스트 모듈에(기존 parse 테스트 관례 확인 후):

```rust
    #[test]
    fn parse_auth_url_with_hyenipack() {
        let (t, s, p) = parse_auth_url("hyenimc://auth?token=abc&server=mc.a.com&hyenipack=season3").unwrap();
        assert_eq!(t, "abc");
        assert_eq!(s, vec!["mc.a.com"]);
        assert_eq!(p.as_deref(), Some("season3"));
        // 파라미터 없음 → None (하위호환)
        let (_, _, p2) = parse_auth_url("hyenimc://auth?token=abc").unwrap();
        assert_eq!(p2, None);
        // 빈 값 → None
        let (_, _, p3) = parse_auth_url("hyenimc://auth?token=abc&hyenipack=").unwrap();
        assert_eq!(p3, None);
    }
```

hyenipack.rs 테스트 모듈에(HTTP 없이 serde만):

```rust
    #[test]
    fn pack_list_item_deserializes_worker_response() {
        let json = r#"{"packs":[{"id":"season3","name":"시즌3 팩","latestVersion":"1.2.0","breaking":false,
            "minecraft":{"version":"1.21.1","loaderType":"neoforge","loaderVersion":"21.1.186"}},
            {"id":"legacy","name":"legacy","latestVersion":"0.9.0","breaking":true,"minecraft":null}]}"#;
        let resp: PackListResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.packs.len(), 2);
        assert_eq!(resp.packs[0].minecraft.as_ref().unwrap().loader_type, "neoforge");
        assert!(resp.packs[1].minecraft.is_none());
        assert!(resp.packs[1].breaking);
    }
```

- [ ] **Step 2: 실패 확인**

Run: `cargo test -p hyenimc-launcher parse_auth_url_with_hyenipack pack_list_item_deserializes`
Expected: FAIL(컴파일 — 3-튜플/타입 없음).

- [ ] **Step 3: 구현**

parse_auth_url — 반환 3-튜플 + match에 `"hyenipack" => hyenipack = Some(percent_decode(v)),` 추가, 마지막:

```rust
    token
        .filter(|t| !t.is_empty())
        .map(|t| (t, servers, hyenipack.filter(|p| !p.is_empty())))
```

기존 parse 테스트들의 구조분해를 3-튜플로 갱신(기존 assert는 유지).

hyenipack.rs에 추가(기존 `check_pack_update`의 reqwest·404 처리 관례 그대로):

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackListMinecraft {
    pub version: String,
    pub loader_type: String,
    #[serde(default)]
    pub loader_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackListItem {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub latest_version: Option<String>,
    #[serde(default)]
    pub breaking: bool,
    #[serde(default)]
    pub minecraft: Option<PackListMinecraft>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct PackListResponse {
    pub packs: Vec<PackListItem>,
}

/// 공개 팩 목록(GET /api/v2/modpacks). 토큰 불필요.
pub async fn fetch_pack_list(
    http: &reqwest::Client,
    worker_base: &str,
) -> Result<Vec<PackListItem>, LauncherError> {
    let url = format!("{}/api/v2/modpacks", worker_base.trim_end_matches('/'));
    let resp: PackListResponse = http.get(&url).send().await?.error_for_status()?.json().await?;
    Ok(resp.packs)
}

/// 팩 공개 latest 버전. 404(비공개/부재) → Ok(None).
pub async fn fetch_pack_latest_version(
    http: &reqwest::Client,
    worker_base: &str,
    id: &str,
) -> Result<Option<String>, LauncherError> {
    let url = format!("{}/api/v2/modpacks/{}/latest", worker_base.trim_end_matches('/'), id);
    let resp = http.get(&url).send().await?;
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    #[derive(Deserialize)]
    struct L { version: String }
    let l: L = resp.error_for_status()?.json().await?;
    Ok(Some(l.version))
}
```

(hyenipack.rs의 기존 import에 Serialize가 없으면 추가. `PackListResponse`는 테스트에서 접근 가능해야 하므로 `pub(crate)`.)

- [ ] **Step 4: 통과 + 호출부 컴파일**

Run: `cargo test -p hyenimc-launcher` → PASS. `cargo build` → apps의 `parse_auth_url` 호출부(handle_deep_link)가 3-튜플로 깨지면 **일단 `let Some((token, servers, _hyenipack))`로 받아 컴파일만 green**(활용은 Task 3).

- [ ] **Step 5: 커밋**

```bash
git add crates/hyenimc-launcher/src/hyeni.rs crates/hyenimc-launcher/src/hyenipack.rs apps/launcher/src-tauri/src/hyeni.rs
git commit -m "feat: 딥링크 hyenipack 파라미터 파싱 + 공개 팩 목록/latest fetch"
```

---

### Task 3: 딥링크 — 항상 저장 + 0-프로필 성공 + 팩 제안 emit (apps/hyeni.rs)

**Files:**
- Modify: `apps/launcher/src-tauri/src/hyeni.rs` (`handle_deep_link`, `apply_auth`)

**Interfaces:**
- Consumes: Task 1 `hyenimc_core::hyeni_tokens::upsert_token`, Task 2 3-튜플 + `fetch_pack_list`, 기존 `hyenimc_launcher::hyenipack::read_pack_meta`, `crate::pack::worker_base`.
- Produces(렌더러 이벤트):
  - `auth:success` — 기존 payload 유지하되 **프로필 0건도 성공**: `profileCount: 0`, `servers` 동일, `profileNames: []`. (`auth:error`는 파싱 실패 등에만)
  - `hyeni:pack-suggest` `{ packId, name, version, mcVersion, loaderType }` — 딥링크에 hyenipack이 있고, 동일 팩 설치 프로필이 없으며, 공개 목록에서 찾았을 때
  - `hyeni:pack-exists` `{ packId, profileName }` — 이미 설치된 프로필이 있을 때

- [ ] **Step 1: apply_auth 수정** — 프로필 기록 로직은 그대로 두고, (a) 함수 시작에서 저장소 적재, (b) `updated.is_empty()`를 에러가 아닌 성공(0건)으로:

```rust
fn apply_auth(app: &AppHandle, token: &str, servers: &[String]) -> Result<(usize, Vec<String>), String> {
    let db = app.state::<DbState>();
    // 저장소 적재(항상) — 프로필이 없어도 토큰을 버리지 않는다(스펙 §2-1).
    {
        let conn = db.0.lock().unwrap();
        if let Err(e) = hyenimc_core::hyeni_tokens::upsert_token(&conn, token, servers, now_secs()) {
            log::warn!("토큰 저장소 적재 실패: {e}");
        }
    }
    let profiles = { /* 기존 그대로 */ };
    // ... 기존 MODE1/2 프로필 기록 루프 그대로 ...
    // 기존 `if updated.is_empty() { return Err(...) }` 블록 삭제 —
    // 0건도 성공(토큰은 저장소에 있고, 팩 설치/실행 시 매칭 기록됨).
    Ok((updated.len(), updated))
}
```

`now_secs()`가 apps/hyeni.rs에 없으면 파일 관례대로 추가(commands.rs 등과 동일 구현):

```rust
fn now_secs() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}
```

- [ ] **Step 2: handle_deep_link — 3-튜플 + 팩 제안**

```rust
pub fn handle_deep_link(app: &AppHandle, url: &str) {
    let Some((token, servers, hyenipack)) = hy::parse_auth_url(url) else {
        if url.starts_with("hyenimc://") {
            let _ = app.emit("auth:error", serde_json::json!({ "message": "잘못된 인증 링크입니다" }));
        }
        return;
    };
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        match apply_auth(&app, &token, &servers) {
            Ok((count, names)) => {
                let server_message = if servers.is_empty() { "모든 프로필".to_string() } else { servers.join(", ") };
                let _ = app.emit("auth:success", serde_json::json!({
                    "servers": server_message,
                    "token": token,
                    "profileCount": count,
                    "profileNames": names,
                }));
            }
            Err(e) => {
                let _ = app.emit("auth:error", serde_json::json!({ "message": e }));
                return; // 인증 실패면 팩 제안도 중단
            }
        }
        // 딥링크에 hyenipack= 이 있으면 설치 제안(확인 다이얼로그는 렌더러)
        if let Some(pack_id) = hyenipack {
            suggest_pack_install(&app, &pack_id).await;
        }
    });
}

/// 팩 제안: 이미 설치된 프로필이 있으면 exists, 없으면 공개 목록에서 찾아 suggest.
/// 비공개/부재/네트워크 실패는 조용히 무시(인증 자체는 이미 성공).
async fn suggest_pack_install(app: &AppHandle, pack_id: &str) {
    // 동일 팩 설치 프로필 검사 (.hyenipack-meta.json의 hyenipack_id)
    let profiles = {
        let db = app.state::<DbState>();
        let conn = db.0.lock().unwrap();
        hyenimc_core::list_profiles(&conn).unwrap_or_default()
    };
    for p in &profiles {
        let meta = hyenimc_launcher::hyenipack::read_pack_meta(std::path::Path::new(&p.game_directory));
        if meta.is_some_and(|m| m.hyenipack_id == pack_id) {
            let _ = app.emit("hyeni:pack-exists", serde_json::json!({
                "packId": pack_id, "profileName": p.name,
            }));
            return;
        }
    }
    let Ok(base) = crate::pack::worker_base() else { return };
    let http = reqwest::Client::new();
    let Ok(packs) = hyenimc_launcher::hyenipack::fetch_pack_list(&http, &base).await else { return };
    let Some(item) = packs.into_iter().find(|x| x.id == pack_id) else { return }; // 비공개/부재 → 무시
    let _ = app.emit("hyeni:pack-suggest", serde_json::json!({
        "packId": item.id,
        "name": item.name,
        "version": item.latest_version,
        "mcVersion": item.minecraft.as_ref().map(|m| m.version.clone()),
        "loaderType": item.minecraft.as_ref().map(|m| m.loader_type.clone()),
    }));
}
```

(`read_pack_meta`의 인자가 instance_dir 기준인지 확인 — `check_pack_update`가 `dirs.instance_dir`을 쓰므로 프로필 `game_directory`와 동일 경로인지 `game_dirs_for`/GameDirs에서 확인하고 맞는 경로를 쓴다. 다르면 pack.rs의 기존 계산 방식을 재사용.)

- [ ] **Step 3: 빌드 + 기존 테스트**

Run: `cargo build` → green(경고 0). `cargo test -p hyenimc-launcher -p hyenimc-core` → PASS.

- [ ] **Step 4: 커밋**

```bash
git add apps/launcher/src-tauri/src/hyeni.rs
git commit -m "feat: 딥링크 인증 토큰 항상 저장(0-프로필 성공) + hyenipack 설치 제안 이벤트"
```

---

### Task 4: 팩 커맨드 — 토큰 해석 + 목록/설치 + apply_update 교정 (apps/pack.rs)

**Files:**
- Modify: `apps/launcher/src-tauri/src/pack.rs`
- Modify: `apps/launcher/src-tauri/src/main.rs` (커맨드 등록 2개)

**Interfaces:**
- Consumes: Task 1 `hyeni_tokens::{list_tokens, any_token}`, Task 2 `fetch_pack_list`/`fetch_pack_latest_version`, 기존 `hyenipack::download_pack_version`, `hyenipack_import`, `hy::{read_hyenihelper_token, write_hyenihelper_config, servers_dat_contains}`.
- Produces(Tauri 커맨드):
  - `pack_list_available() -> Vec<PackListItem>`
  - `pack_install_from_worker(profile_id, pack_id, account_id?) -> PackInstallOutcome { token_applied: bool }` (serde camelCase)
- `pack_apply_update`: 다운로드 토큰을 **MS access_token → (프로필 config 토큰 → 저장소 폴백)** 으로 교체.

- [ ] **Step 1: 토큰 해석 헬퍼**

pack.rs에 추가:

```rust
/// 워커 다운로드용 토큰: 프로필 config 토큰 1순위, 저장소 최신 토큰 폴백(다운로드는 스코프 무관).
fn resolve_download_token(db: &tauri::State<'_, DbState>, game_dir: Option<&std::path::Path>) -> Option<String> {
    if let Some(dir) = game_dir {
        if let Some(t) = hyenimc_launcher::hyeni::read_hyenihelper_token(dir) {
            return Some(t);
        }
    }
    let conn = db.0.lock().unwrap();
    hyenimc_core::hyeni_tokens::any_token(&conn).ok().flatten()
}

/// 설치/게이트 후 config 기록 — 저장소에서 이 game_dir의 servers.dat와 매칭되는 토큰만 기록.
/// 매칭 없으면 false(호출자가 "/인증 필요" 안내). 아무 토큰이나 쓰지 않는다(스펙 §2-1).
fn apply_matching_store_token(db: &tauri::State<'_, DbState>, game_dir: &std::path::Path) -> bool {
    let tokens = {
        let conn = db.0.lock().unwrap();
        hyenimc_core::hyeni_tokens::list_tokens(&conn).unwrap_or_default()
    };
    let servers_dat = game_dir.join("servers.dat");
    for t in tokens {
        if t.servers.iter().any(|s| hyenimc_launcher::hyeni::servers_dat_contains(&servers_dat, s)) {
            return hyenimc_launcher::hyeni::write_hyenihelper_config(game_dir, &t.token, true).unwrap_or(false);
        }
    }
    false
}
```

(hy 모듈 경로는 파일의 기존 import 관례(`hyenimc_launcher::hyeni` as `hy` 등)에 맞춘다.)

- [ ] **Step 2: pack_apply_update 토큰 교정**

기존:
```rust
    let aid = account_id.ok_or_else(|| "업데이트 다운로드에 로그인이 필요합니다".to_string())?;
    let token = crate::account::get_valid_tokens(&db, &crypto, &aid).await?.access_token;
```
을 다음으로 교체(§2-1 우선순위; account_id는 hyenipack_import에 계속 전달하므로 파라미터는 유지):

```rust
    // 다운로드 인증: 프로필 config 토큰 → 저장소 폴백 (MS 토큰 오이식 교정 — 워커는 /인증 토큰만 검증)
    let token = resolve_download_token(&db, Some(&dirs.instance_dir)).ok_or_else(|| {
        "팩 다운로드를 위한 인증이 필요합니다.\n\nDiscord에서 /인증 명령어로 인증하세요.".to_string()
    })?;
```

(`dirs.instance_dir`이 config가 있는 game_dir인지 확인 — `read_hyenihelper_token(game_dir)`은 `game_dir/config/...`를 읽으므로, 이 프로필의 game_directory 기준 경로를 쓴다. pack.rs의 기존 `game_dirs_for(&profile)` 사용 코드에 맞춘다.)

- [ ] **Step 3: 신규 커맨드 2개**

```rust
/// 공개 혜니팩 목록(토큰 불필요).
#[tauri::command]
pub async fn pack_list_available() -> Result<Vec<hyenimc_launcher::hyenipack::PackListItem>, String> {
    let http = reqwest::Client::new();
    hyenimc_launcher::hyenipack::fetch_pack_list(&http, &worker_base()?)
        .await
        .map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackInstallOutcome {
    pub token_applied: bool,
}

/// 워커에서 혜니팩 최신 버전을 받아 지정 프로필에 설치(기존 import 파이프 재사용).
/// 설치 후 저장소에서 서버 매칭 토큰이 있으면 프로필 config에 기록.
#[tauri::command]
pub async fn pack_install_from_worker(
    app: AppHandle,
    db: State<'_, DbState>,
    crypto: State<'_, CryptoState>,
    profile_id: String,
    pack_id: String,
    account_id: Option<String>,
) -> Result<PackInstallOutcome, String> {
    let profile = load_profile_pub(&db, &profile_id)?;
    let dirs = game_dirs_for(&profile)?;
    let http = reqwest::Client::new();
    let base = worker_base()?;

    let version = hyenimc_launcher::hyenipack::fetch_pack_latest_version(&http, &base, &pack_id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "혜니팩을 찾을 수 없습니다(비공개이거나 존재하지 않음).".to_string())?;

    let token = resolve_download_token(&db, Some(&dirs.instance_dir)).ok_or_else(|| {
        "팩 다운로드를 위한 인증이 필요합니다.\n\nDiscord에서 /인증 명령어로 인증하세요.".to_string()
    })?;

    let temp = dirs.instance_dir.join(".temp").join(format!("{pack_id}-{version}.hyenipack"));
    hyenimc_launcher::hyenipack::download_pack_version(&http, &base, &pack_id, &version, &token, &temp)
        .await
        .map_err(|e| e.to_string())?;

    // 재사용: 파일 import 파이프(내부 불변 — 실사용 검증 경로)
    hyenipack_import(app, db.clone(), profile_id, temp.display().to_string(), account_id, crypto).await?;
    let _ = std::fs::remove_file(&temp);

    // 설치 후 토큰 매칭 기록(팩이 깔아준 servers.dat 기준; 매칭 없으면 렌더러가 /인증 안내)
    let token_applied = apply_matching_store_token(&db, &dirs.instance_dir);
    Ok(PackInstallOutcome { token_applied })
}
```

(`hyenipack_import` 시그니처의 State 전달 방식은 `pack_apply_update`가 이미 같은 파일에서 호출하는 형태를 그대로 따른다. `db.clone()`이 안 되면 그 호출과 동일하게 재구성.)

`main.rs` invoke_handler에 `pack::pack_list_available, pack::pack_install_from_worker` 등록.

- [ ] **Step 4: 빌드 + 테스트**

Run: `cargo build`(경고 0) + `cargo test -p hyenimc-launcher -p hyenimc-core` PASS.

- [ ] **Step 5: 커밋**

```bash
git add apps/launcher/src-tauri/src/pack.rs apps/launcher/src-tauri/src/main.rs
git commit -m "feat: 팩 목록/워커 설치 커맨드 + 다운로드 토큰 해석(config→저장소, MS 토큰 교정)"
```

---

### Task 5: 실행 전 게이트 no-token 폴백 (game.rs)

**Files:**
- Modify: `apps/launcher/src-tauri/src/game.rs` (②.9 무토큰 분기)

**Interfaces:**
- Consumes: Task 4의 `crate::pack::apply_matching_store_token`(pub(crate)로 가시성 조정 필요 시 조정) 또는 동일 로직.

- [ ] **Step 1: ②.9 무토큰 분기 수정**

기존(②.9 안):
```rust
                let token = match hyenimc_launcher::hyeni::read_hyenihelper_token(&game_dir) {
                    Some(t) => t,
                    None => { ...실행 중단 Err... }
                };
```
을 다음으로(매칭되면 config 기록+진행, 아니면 기존 중단 — 어중간 상태 방지, 스펙 §2-1):

```rust
                let token = match hyenimc_launcher::hyeni::read_hyenihelper_token(&game_dir) {
                    Some(t) => t,
                    None => {
                        // 저장소에서 이 프로필 서버와 매칭되는 토큰이 있으면 config에 기록하고 사용
                        if crate::pack::apply_matching_store_token(&db, &game_dir) {
                            hyenimc_launcher::hyeni::read_hyenihelper_token(&game_dir).unwrap_or_default()
                        } else {
                            log::warn!(
                                "워커 모드 {}건 업데이트 필요하나 인증 토큰 없음 — 실행 중단",
                                updates.len()
                            );
                            return Err("모드 업데이트를 위한 인증이 필요합니다.\n\nDiscord에서 /인증 명령어로 인증하세요.".to_string());
                        }
                    }
                };
                if token.is_empty() {
                    return Err("모드 업데이트를 위한 인증이 필요합니다.\n\nDiscord에서 /인증 명령어로 인증하세요.".to_string());
                }
```

`apply_matching_store_token`을 game.rs에서 쓰려면 pack.rs에서 `pub(crate) fn`으로.

- [ ] **Step 2: 빌드 + 기존 테스트**

Run: `cargo build`(경고 0) + `cargo test -p hyenimc-launcher` PASS(회귀 없음 — 이 경로는 통합 수준).

- [ ] **Step 3: 커밋**

```bash
git add apps/launcher/src-tauri/src/game.rs apps/launcher/src-tauri/src/pack.rs
git commit -m "feat: 실행 전 게이트 무토큰 시 저장소 서버-매칭 폴백(매칭 없으면 기존 중단)"
```

---

### Task 6: 렌더러 — 혜니팩 온라인 목록·검색·설치

**Files:**
- Modify: `src/renderer/tauri-shim.ts` (hyenipack 섹션)
- Modify: `src/renderer/components/profiles/HyeniPackImportTab.tsx`

**Interfaces:**
- Consumes: `pack_list_available`/`pack_install_from_worker`(Task 4), 기존 `profile.create`/`hyenipack:import-progress` 이벤트.
- Produces(shim):
  - `hyenipack.listAvailable(): Promise<PackListItem[]>` — `invoke('pack_list_available')`
  - `hyenipack.installFromWorker(profileId, packId, accountId?): Promise<{tokenApplied: boolean}>` — `invoke('pack_install_from_worker', { profileId, packId, accountId })`

- [ ] **Step 1: shim 추가** — `api.hyenipack` 객체(tauri-shim.ts:158 근처)에:

```ts
    listAvailable: () => invoke('pack_list_available'),
    installFromWorker: (profileId: string, packId: string, accountId?: string) =>
      invoke('pack_install_from_worker', { profileId, packId, accountId }),
```

- [ ] **Step 2: HyeniPackImportTab 확장** — 온라인 목록을 기본으로, 파일 선택은 보조로. 기존 파일 import 로직·진행률 UI는 그대로 두고 상단에 온라인 섹션 추가:

상태/로드(컴포넌트 상단):

```tsx
  interface OnlinePack {
    id: string; name: string; latestVersion?: string | null; breaking?: boolean;
    minecraft?: { version: string; loaderType: string; loaderVersion?: string } | null;
  }
  const [onlinePacks, setOnlinePacks] = useState<OnlinePack[] | null>(null); // null=로딩/실패
  const [onlineError, setOnlineError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selectedPack, setSelectedPack] = useState<OnlinePack | null>(null);

  useEffect(() => {
    (async () => {
      try { setOnlinePacks(await (window.electronAPI as any).hyenipack.listAvailable()); }
      catch (e) { setOnlineError(errorText(e, '팩 목록을 불러올 수 없습니다.')); setOnlinePacks([]); }
    })();
  }, []);

  const filteredPacks = (onlinePacks ?? []).filter((p) => {
    const q = query.trim().toLowerCase();
    return !q || p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q);
  });
```

온라인 설치 핸들러(기존 `handleCreate`와 같은 패턴 — profile.create → installFromWorker → 진행률 구독 → toast):

```tsx
  const handleInstallOnline = async () => {
    if (!selectedPack || !name.trim()) return;
    const mc = selectedPack.minecraft;
    setImportingState(true);
    setError(null);
    setProgress(null);
    let unlisten: (() => void) | undefined;
    try {
      const profile = await window.electronAPI.profile.create({
        name: name.trim(),
        gameVersion: mc?.version || '1.21.1',      // 팩 설치가 실제 값으로 덮어씀
        loaderType: mc?.loaderType || 'neoforge',
        loaderVersion: mc?.loaderVersion || '',
      });
      unlisten = window.electronAPI.on('hyenipack:import-progress', (raw: unknown) => {
        const data = raw as { profileId?: string; completed?: number; total?: number; percent?: number; stage?: string };
        if (data?.profileId && data.profileId !== profile.id) return;
        setProgress({ completed: data?.completed ?? 0, total: data?.total ?? 0, percent: data?.percent ?? 0, stage: data?.stage ?? 'mods' });
      });
      const outcome = await (window.electronAPI as any).hyenipack.installFromWorker(
        profile.id, selectedPack.id, selectedAccountId,
      );
      toast.success('혜니팩 설치 완료', `${name} 프로필이 생성되었습니다.`);
      if (!outcome?.tokenApplied) {
        toast.info('인증 안내', '이 서버의 디스코드 채널에서 /인증을 실행하면 서버 접속 준비가 끝납니다.');
      }
      onSuccess();
    } catch (e) {
      setError(errorText(e, '혜니팩 설치에 실패했습니다.'));
    } finally {
      unlisten?.();
      setImportingState(false);
      setProgress(null);
    }
  };
```

렌더 상단(파일 선택 버튼 위)에 온라인 섹션:

```tsx
      <div className="space-y-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="혜니팩 검색 (이름 또는 ID)"
          className="input text-sm"
          disabled={importing}
        />
        {onlineError && <div className="text-xs text-gray-500">{onlineError}</div>}
        {onlinePacks === null && !onlineError && (
          <div className="text-xs text-gray-500 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> 목록 불러오는 중...</div>
        )}
        {filteredPacks.length > 0 && (
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {filteredPacks.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={importing}
                onClick={() => { setSelectedPack(p); setManifest(null); setName(p.name); }}
                className={`w-full text-left p-3 rounded-lg border transition-colors ${
                  selectedPack?.id === p.id
                    ? 'bg-purple-500/10 border-purple-500/40'
                    : 'bg-gray-800/40 border-gray-700 hover:border-gray-500'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Package className="w-4 h-4 text-purple-400" />
                  <span className="font-medium text-gray-200">{p.name}</span>
                  <span className="text-xs text-gray-500">v{p.latestVersion ?? '?'}</span>
                </div>
                {p.minecraft && (
                  <div className="text-xs text-gray-500 mt-1">
                    {p.minecraft.version} · {p.minecraft.loaderType}{p.minecraft.loaderVersion ? ` ${p.minecraft.loaderVersion}` : ''}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
        {onlinePacks !== null && filteredPacks.length === 0 && !onlineError && (
          <div className="text-xs text-gray-500">{query ? '검색 결과가 없습니다.' : '설치 가능한 혜니팩이 없습니다.'}</div>
        )}
      </div>

      {selectedPack && !importing && (
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 space-y-3">
          <div>
            <label className="block text-sm font-semibold mb-1 text-gray-300">프로필 이름</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)}
              className="input text-base" placeholder="프로필 이름" disabled={importing} />
          </div>
          <button type="button" onClick={handleInstallOnline} disabled={!name.trim()}
            className="w-full py-3 bg-purple-600 hover:bg-purple-700 rounded-lg font-medium text-white disabled:opacity-50 transition-colors">
            혜니팩 설치
          </button>
        </div>
      )}

      <div className="text-xs text-gray-500 text-center">— 또는 파일에서 —</div>
```

(파일 선택 시에는 `setSelectedPack(null)`을 handleSelectFile 시작에 추가해 두 흐름의 상태 충돌 방지. 기존 manifest 기반 파일 흐름·진행률·에러 UI는 그대로.)

- [ ] **Step 3: 타입체크**

Run: `npx tsc -p tsconfig.json --noEmit` → 0 오류.

- [ ] **Step 4: 커밋**

```bash
git add src/renderer/tauri-shim.ts src/renderer/components/profiles/HyeniPackImportTab.tsx
git commit -m "feat: 혜니팩 탭에 온라인 목록·검색·설치(파일은 보조)"
```

---

### Task 7: 렌더러 — 딥링크 팩 제안 다이얼로그

**Files:**
- Create: `src/renderer/components/hyeni/HyeniPackSuggestDialog.tsx`
- Modify: `HyeniUpdateNotification`이 마운트된 곳(App 루트 레벨 — grep으로 확인)에 함께 마운트

**Interfaces:**
- Consumes: `hyeni:pack-suggest`/`hyeni:pack-exists` 이벤트(Task 3), `profile.create` + `hyenipack.installFromWorker`(Task 6 shim).

- [ ] **Step 1: 컴포넌트 작성**

```tsx
import React, { useEffect, useState } from 'react';
import { Package, Loader2 } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { errorText } from '../../utils/errorText';

interface PackSuggest {
  packId: string;
  name: string;
  version?: string | null;
  mcVersion?: string | null;
  loaderType?: string | null;
}

/** 딥링크(hyenimc://auth?...&hyenipack=)로 온 혜니팩 설치 제안 — 확인 후 프로필 생성+설치. */
export function HyeniPackSuggestDialog() {
  const toast = useToast();
  const [suggest, setSuggest] = useState<PackSuggest | null>(null);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    const off1 = window.electronAPI.on('hyeni:pack-suggest', (raw: unknown) => {
      setSuggest(raw as PackSuggest);
    });
    const off2 = window.electronAPI.on('hyeni:pack-exists', (raw: unknown) => {
      const d = raw as { profileName?: string };
      toast.info('혜니팩', `이미 '${d?.profileName ?? ''}' 프로필에 설치되어 있어요. 프로필에서 업데이트를 확인하세요.`);
    });
    return () => { off1?.(); off2?.(); };
  }, []);

  const handleInstall = async () => {
    if (!suggest) return;
    setInstalling(true);
    try {
      const profile = await window.electronAPI.profile.create({
        name: suggest.name,
        gameVersion: suggest.mcVersion || '1.21.1',   // 팩 설치가 실제 값으로 덮어씀
        loaderType: suggest.loaderType || 'neoforge',
        loaderVersion: '',
      });
      const outcome = await (window.electronAPI as any).hyenipack.installFromWorker(
        profile.id, suggest.packId, undefined,
      );
      toast.success('혜니팩 설치 완료', `${suggest.name} 프로필이 생성되었습니다.`);
      if (!outcome?.tokenApplied) {
        toast.info('인증 안내', '이 서버의 디스코드 채널에서 /인증을 실행하면 서버 접속 준비가 끝납니다.');
      }
      setSuggest(null);
    } catch (e) {
      toast.error('혜니팩 설치 실패', errorText(e, '설치에 실패했습니다.'));
    } finally {
      setInstalling(false);
    }
  };

  if (!suggest) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-sm space-y-4 shadow-2xl">
        <div className="flex items-center gap-2">
          <Package className="w-5 h-5 text-purple-400" />
          <h3 className="font-bold text-white">혜니팩 설치</h3>
        </div>
        <p className="text-sm text-gray-300">
          '<span className="font-semibold">{suggest.name}</span>'
          {suggest.version ? ` v${suggest.version}` : ''}을(를) 설치할까요?
          {suggest.mcVersion && (
            <span className="block text-xs text-gray-500 mt-1">
              {suggest.mcVersion} · {suggest.loaderType}
            </span>
          )}
        </p>
        <div className="flex gap-2 justify-end">
          <button type="button" disabled={installing} onClick={() => setSuggest(null)}
            className="px-4 py-2 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors">
            나중에
          </button>
          <button type="button" disabled={installing} onClick={handleInstall}
            className="px-4 py-2 text-sm bg-purple-600 hover:bg-purple-700 rounded-lg font-semibold text-white transition-colors flex items-center gap-2">
            {installing && <Loader2 className="w-4 h-4 animate-spin" />} 설치
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 마운트** — `HyeniUpdateNotification`(기존 딥링크/업데이트 알림 컴포넌트)이 렌더되는 위치를 grep으로 찾아 그 옆에 `<HyeniPackSuggestDialog />` 추가.

- [ ] **Step 3: 타입체크 + 커밋**

Run: `npx tsc -p tsconfig.json --noEmit` → 0 오류.

```bash
git add src/renderer/components/hyeni/HyeniPackSuggestDialog.tsx <마운트 파일>
git commit -m "feat: 딥링크 혜니팩 설치 제안 다이얼로그(확인 후 프로필 생성+설치)"
```

---

## Self-Review

**스펙 커버리지**: §2-1 토큰 저장소/우선순위/매칭 기록(Task 1·3·4·5), §2-3 커맨드+apply_update 교정(Task 4), §2-4 진입점+검색(Task 6), §2-5 딥링크(Task 2·3·7 — 확인 다이얼로그·exists·비공개 무시·하위호환). hyenipack_import 내부 불변(Task 4 재사용만). ✅

**타입 일관성**: `StoredToken`(1↔3·4·5), `PackListItem`(2↔4↔6 camelCase 직렬화), `PackInstallOutcome.token_applied↔tokenApplied`(4↔6·7), 3-튜플 parse(2↔3), `apply_matching_store_token` pub(crate)(4↔5). ✅

**플레이스홀더**: 없음 — 앵커 확인 지시 2곳(read_pack_meta 경로, HyeniUpdateNotification 마운트 위치)은 검증 지시. ✅

## 주의(리뷰 집중점)
- Task 3의 apply_auth 시맨틱 변경(0건 성공)이 렌더러 auth:success 처리와 어긋나지 않는지(payload 형태 유지).
- Task 4·5의 config 기록이 **반드시 서버 매칭 경유**인지(스펙 하드 제약).
- Task 5는 game.rs ②.9 재수정 — Plan B의 force/에러 경로 의미 보존 재확인.

## 배포/후속
- 런처 빌드는 사용자. 실기 검증 시나리오: (1) 프로필 0개에서 /인증 → 성공 메시지, (2) 혜니팩 탭 목록/검색/설치+토큰 자동 기록, (3) 딥링크 hyenipack= 원클릭, (4) 팩 업데이트(pack_apply_update) 정상 다운로드.
- HyeniAPIServer/디스코드 봇의 `hyenipack=` 부가는 후속(스펙 §8).
