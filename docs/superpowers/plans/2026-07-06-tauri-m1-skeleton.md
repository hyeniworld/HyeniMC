# Tauri M1 골격 (프로필/설정 CRUD + 어댑터 정식화) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tauri 앱에서 프로필 목록/상세/생성/수정/삭제와 전역 설정이 **기존 Electron 판 SQLite 데이터로** 동작하게 한다 (M1 완료 조건: 프로필 화면이 실데이터로 렌더 + CRUD 동작).

**Architecture:** hyenimc-core에 settings/stats 모듈과 profile CRUD를 추가(전부 순수 rusqlite, 테스트 가능) → Tauri 커맨드 14개가 `Mutex<Connection>` State로 노출 → 렌더러 tauri-shim(M0 Proxy 스텁)을 명시적 매핑 어댑터로 대체.

**Tech Stack:** Rust(rusqlite bundled, uuid v4, sysinfo), Tauri v2, TypeScript(어댑터만).

## Global Constraints

- 기존 DB 스키마 무변경 (in-place 호환). 타임스탬프는 **epoch 초** (실DB 실측: 1760686796)
- 설정 프론트 형태는 기존 IPC와 동일한 **snake_case 중첩** — `{download:{request_timeout_ms,max_retries,max_parallel}, java:{java_path,memory_min,memory_max}, resolution:{width,height,fullscreen}, cache:{enabled,max_size_gb,ttl_days}, update:{check_interval_hours,auto_download}}`, 기본값은 ipc/settings.ts와 동일(3000/5/10, ''/1024/4096, 854/480/false, true/10/30, 2/false)
- DB 설정 키 매핑 예외 2개: `request_timeout_ms`↔`download.timeout_ms`, `java_path`↔`java.path` (실DB 실측). 나머지는 `<섹션>.<필드>` 패턴
- 프로필 직렬화는 camelCase (기존 fromPbProfile 응답 호환), 인스턴스 디렉터리는 `<userData>/instances/<uuid>` (실DB 실측)
- Electron 경로 무손상: shim은 Tauri 환경에서만 동작, `npm run build` + vitest 19개 회귀 통과 필수
- 브랜치 `feat/tauri-m0` 위에 계속. 커밋 형식 `feat(tauri): ...`

---

### Task 1: hyenimc-core settings 모듈

**Files:**
- Create: `crates/hyenimc-core/src/settings.rs`
- Modify: `crates/hyenimc-core/src/lib.rs` (모듈 등록 + re-export)

**Interfaces:**
- Produces: `GlobalSettings` (serde 중첩 구조체, snake_case), `get_settings(&Connection) -> Result<GlobalSettings, CoreError>`, `update_settings(&Connection, &GlobalSettings, now_secs: i64) -> Result<(), CoreError>` — Task 4가 의존

- [ ] **Step 1: 실DB 설정 키 전수 확인** (매핑 검증)

Run: `sqlite3 "$HOME/Library/Application Support/hyenimc/data/hyenimc.db" "SELECT key FROM global_settings ORDER BY key;"`
Expected: `cache.enabled, download.max_parallel, download.max_retries, download.timeout_ms, java.memory_max, java.memory_min, java.path, resolution.fullscreen, resolution.height, resolution.width` (±update/cache 추가 키 — 있으면 매핑 테이블에 반영)

- [ ] **Step 2: 실패하는 테스트** — `settings.rs` 하단 `#[cfg(test)]`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn fixture() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE global_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);",
        )
        .unwrap();
        conn
    }

    #[test]
    fn empty_table_yields_defaults() {
        let conn = fixture();
        let s = get_settings(&conn).unwrap();
        assert_eq!(s.download.request_timeout_ms, 3000);
        assert_eq!(s.java.memory_max, 4096);
        assert_eq!(s.resolution.width, 854);
        assert!(s.cache.enabled);
        assert_eq!(s.update.check_interval_hours, 2);
    }

    #[test]
    fn reads_legacy_dotted_keys() {
        let conn = fixture();
        conn.execute_batch(
            "INSERT INTO global_settings VALUES
             ('download.timeout_ms','5000',1),
             ('java.path','/usr/bin/java',1),
             ('java.memory_max','8192',1),
             ('resolution.fullscreen','true',1);",
        )
        .unwrap();
        let s = get_settings(&conn).unwrap();
        assert_eq!(s.download.request_timeout_ms, 5000);
        assert_eq!(s.java.java_path, "/usr/bin/java");
        assert_eq!(s.java.memory_max, 8192);
        assert!(s.resolution.fullscreen);
    }

    #[test]
    fn update_roundtrips() {
        let conn = fixture();
        let mut s = get_settings(&conn).unwrap();
        s.java.memory_min = 2048;
        s.download.max_parallel = 20;
        update_settings(&conn, &s, 12345).unwrap();
        let s2 = get_settings(&conn).unwrap();
        assert_eq!(s2.java.memory_min, 2048);
        assert_eq!(s2.download.max_parallel, 20);
        let ts: i64 = conn
            .query_row("SELECT updated_at FROM global_settings WHERE key='java.memory_min'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(ts, 12345);
    }

    #[test]
    fn serializes_snake_case_nested() {
        let conn = fixture();
        let s = get_settings(&conn).unwrap();
        let json = serde_json::to_value(&s).unwrap();
        assert!(json["download"]["request_timeout_ms"].is_number());
        assert!(json["java"]["java_path"].is_string());
        assert!(json["update"]["auto_download"].is_boolean());
    }
}
```

- [ ] **Step 3: 실패 확인** — Run: `cargo test -p hyenimc-core settings` / Expected: 컴파일 실패(모듈 없음)

- [ ] **Step 4: 구현** — `settings.rs`:

```rust
//! 전역 설정 — 기존 global_settings KV(dotted key) 테이블 그대로 사용.
//! 프론트 형태는 기존 IPC(snake_case 중첩)와 동일, 기본값도 ipc/settings.ts와 동일.

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::CoreError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlobalSettings {
    pub download: DownloadSettings,
    pub java: JavaSettings,
    pub resolution: ResolutionSettings,
    pub cache: CacheSettings,
    pub update: UpdateSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadSettings {
    pub request_timeout_ms: i64,
    pub max_retries: i64,
    pub max_parallel: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JavaSettings {
    pub java_path: String,
    pub memory_min: i64,
    pub memory_max: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolutionSettings {
    pub width: i64,
    pub height: i64,
    pub fullscreen: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheSettings {
    pub enabled: bool,
    pub max_size_gb: i64,
    pub ttl_days: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateSettings {
    pub check_interval_hours: i64,
    pub auto_download: bool,
}

fn read_kv(conn: &Connection) -> Result<HashMap<String, String>, CoreError> {
    let mut stmt = conn.prepare("SELECT key, value FROM global_settings")?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
    Ok(rows.collect::<Result<HashMap<_, _>, _>>()?)
}

fn get_i64(kv: &HashMap<String, String>, key: &str, default: i64) -> i64 {
    kv.get(key).and_then(|v| v.parse().ok()).unwrap_or(default)
}

fn get_bool(kv: &HashMap<String, String>, key: &str, default: bool) -> bool {
    kv.get(key).map(|v| v == "true" || v == "1").unwrap_or(default)
}

pub fn get_settings(conn: &Connection) -> Result<GlobalSettings, CoreError> {
    let kv = read_kv(conn)?;
    Ok(GlobalSettings {
        download: DownloadSettings {
            request_timeout_ms: get_i64(&kv, "download.timeout_ms", 3000),
            max_retries: get_i64(&kv, "download.max_retries", 5),
            max_parallel: get_i64(&kv, "download.max_parallel", 10),
        },
        java: JavaSettings {
            java_path: kv.get("java.path").cloned().unwrap_or_default(),
            memory_min: get_i64(&kv, "java.memory_min", 1024),
            memory_max: get_i64(&kv, "java.memory_max", 4096),
        },
        resolution: ResolutionSettings {
            width: get_i64(&kv, "resolution.width", 854),
            height: get_i64(&kv, "resolution.height", 480),
            fullscreen: get_bool(&kv, "resolution.fullscreen", false),
        },
        cache: CacheSettings {
            enabled: get_bool(&kv, "cache.enabled", true),
            max_size_gb: get_i64(&kv, "cache.max_size_gb", 10),
            ttl_days: get_i64(&kv, "cache.ttl_days", 30),
        },
        update: UpdateSettings {
            check_interval_hours: get_i64(&kv, "update.check_interval_hours", 2),
            auto_download: get_bool(&kv, "update.auto_download", false),
        },
    })
}

pub fn update_settings(
    conn: &Connection,
    s: &GlobalSettings,
    now_secs: i64,
) -> Result<(), CoreError> {
    let pairs: Vec<(&str, String)> = vec![
        ("download.timeout_ms", s.download.request_timeout_ms.to_string()),
        ("download.max_retries", s.download.max_retries.to_string()),
        ("download.max_parallel", s.download.max_parallel.to_string()),
        ("java.path", s.java.java_path.clone()),
        ("java.memory_min", s.java.memory_min.to_string()),
        ("java.memory_max", s.java.memory_max.to_string()),
        ("resolution.width", s.resolution.width.to_string()),
        ("resolution.height", s.resolution.height.to_string()),
        ("resolution.fullscreen", s.resolution.fullscreen.to_string()),
        ("cache.enabled", s.cache.enabled.to_string()),
        ("cache.max_size_gb", s.cache.max_size_gb.to_string()),
        ("cache.ttl_days", s.cache.ttl_days.to_string()),
        ("update.check_interval_hours", s.update.check_interval_hours.to_string()),
        ("update.auto_download", s.update.auto_download.to_string()),
    ];
    let mut stmt = conn.prepare(
        "INSERT INTO global_settings (key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value=?2, updated_at=?3",
    )?;
    for (k, v) in pairs {
        stmt.execute(rusqlite::params![k, v, now_secs])?;
    }
    Ok(())
}
```

`lib.rs`에 추가: `pub mod settings;` + `pub use settings::{get_settings, update_settings, GlobalSettings};`

- [ ] **Step 5: 통과 확인** — Run: `cargo test -p hyenimc-core settings` / Expected: 4 passed
- [ ] **Step 6: 커밋** — `git add crates/hyenimc-core && git commit -m "feat(tauri): hyenimc-core settings 모듈 (global_settings KV 호환)"`

---

### Task 2: hyenimc-core profile CRUD 확장

**Files:**
- Modify: `crates/hyenimc-core/src/profile.rs` (Profile 필드 확장 + CRUD 함수)
- Modify: `crates/hyenimc-core/src/paths.rs` (`legacy_user_data_dir`/`instances_dir` 추가)
- Modify: `crates/hyenimc-core/Cargo.toml` (uuid 의존)

**Interfaces:**
- Consumes: 기존 `Profile`, `list_profiles`
- Produces: `Profile`에 오버라이드 필드 추가(java_path/memory_min/memory_max/resolution_width/resolution_height/fullscreen/jvm_args/game_args/modpack_id/modpack_source — 전부 Option, camelCase 직렬화), `NewProfile{name, description, icon, game_version, loader_type, loader_version}`, `create_profile(&Connection, &NewProfile, game_directory: &str, now_secs: i64) -> Result<Profile, CoreError>` (uuid v4 id), `get_profile(&Connection, id) -> Result<Option<Profile>, CoreError>`, `update_profile(&Connection, id, &ProfilePatch, now_secs) -> Result<Option<Profile>, CoreError>` (Option 필드만 갱신), `delete_profile(&Connection, id) -> Result<bool, CoreError>`, `toggle_favorite(&Connection, id, now_secs) -> Result<Option<Profile>, CoreError>`; `paths::legacy_user_data_dir()` (data 상위 = userData), `paths::instances_dir()` (`<userData>/instances`)

- [ ] **Step 1: 실패하는 테스트 추가** — `profile.rs` tests 모듈에:

```rust
    #[test]
    fn create_get_update_delete_roundtrip() {
        let (_dir, path) = fixture_db();
        let conn = open_database(&path).unwrap();

        let new = NewProfile {
            name: "새 프로필".into(),
            description: Some("desc".into()),
            icon: None,
            game_version: "1.21.1".into(),
            loader_type: "fabric".into(),
            loader_version: Some("0.16.7".into()),
        };
        let created = create_profile(&conn, &new, "/tmp/inst/x", 1000).unwrap();
        assert_eq!(created.name, "새 프로필");
        assert_eq!(created.game_directory, "/tmp/inst/x");
        assert_eq!(created.created_at, 1000);
        assert_eq!(created.id.len(), 36); // uuid v4

        let got = get_profile(&conn, &created.id).unwrap().unwrap();
        assert_eq!(got.game_version, "1.21.1");

        let patch = ProfilePatch { name: Some("이름변경".into()), memory_max: Some(Some(8192)), ..Default::default() };
        let updated = update_profile(&conn, &created.id, &patch, 2000).unwrap().unwrap();
        assert_eq!(updated.name, "이름변경");
        assert_eq!(updated.memory_max, Some(8192));
        assert_eq!(updated.updated_at, 2000);
        assert_eq!(updated.game_version, "1.21.1"); // 미지정 필드 보존

        let fav = toggle_favorite(&conn, &created.id, 3000).unwrap().unwrap();
        assert!(fav.favorite);

        assert!(delete_profile(&conn, &created.id).unwrap());
        assert!(get_profile(&conn, &created.id).unwrap().is_none());
        assert!(!delete_profile(&conn, "no-such-id").unwrap());
    }
```

(fixture DDL은 기존 것 재사용 — 오버라이드 컬럼이 이미 포함되어 있음)

- [ ] **Step 2: 실패 확인** — Run: `cargo test -p hyenimc-core profile` / Expected: 컴파일 실패(NewProfile 등 없음)

- [ ] **Step 3: 구현** — Profile 구조체에 필드 추가(모두 `Option`, SELECT/query_map에 포함):

```rust
    pub java_path: Option<String>,
    pub memory_min: Option<i64>,
    pub memory_max: Option<i64>,
    pub resolution_width: Option<i64>,
    pub resolution_height: Option<i64>,
    pub fullscreen: Option<bool>,   // INTEGER NULL → Option<i64> → map(|v| v != 0)
    pub jvm_args: Option<String>,
    pub game_args: Option<String>,
    pub modpack_id: Option<String>,
    pub modpack_source: Option<String>,
```

CRUD 함수(발췌 — SELECT 컬럼 리스트는 상수 `PROFILE_COLUMNS`로 추출해 list/get에서 공유):

```rust
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewProfile {
    pub name: String,
    pub description: Option<String>,
    pub icon: Option<String>,
    pub game_version: String,
    pub loader_type: String,
    pub loader_version: Option<String>,
}

#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfilePatch {
    pub name: Option<String>,
    pub description: Option<String>,
    pub icon: Option<String>,
    pub game_version: Option<String>,
    pub loader_type: Option<String>,
    pub loader_version: Option<String>,
    pub server_address: Option<String>,
    pub java_path: Option<Option<String>>,      // Some(None) = NULL로 초기화
    pub memory_min: Option<Option<i64>>,
    pub memory_max: Option<Option<i64>>,
    pub resolution_width: Option<Option<i64>>,
    pub resolution_height: Option<Option<i64>>,
    pub fullscreen: Option<Option<bool>>,
    pub jvm_args: Option<Option<String>>,
    pub game_args: Option<Option<String>>,
}

pub fn create_profile(conn: &Connection, new: &NewProfile, game_directory: &str, now_secs: i64) -> Result<Profile, CoreError> {
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO profiles (id, name, description, icon, game_version, loader_type, loader_version,
                               game_directory, created_at, updated_at, favorite, installation_status)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?9,0,'complete')",
        rusqlite::params![id, new.name, new.description, new.icon, new.game_version,
                          new.loader_type, new.loader_version, game_directory, now_secs],
    )?;
    Ok(get_profile(conn, &id)?.expect("just inserted"))
}
```

`update_profile`은 patch의 Some 필드만 `UPDATE ... SET` 절을 동적 조립(rusqlite `params_from_iter`), 마지막에 `updated_at=?`. `toggle_favorite`은 `UPDATE profiles SET favorite = 1-favorite, updated_at=? WHERE id=?`. `delete_profile`은 `DELETE ... RETURNING` 대신 `execute` 후 `changes()>0`.

paths.rs 추가:

```rust
/// Electron userData 루트 (data의 상위). 인스턴스/에셋 등이 이 아래에 있다.
pub fn legacy_user_data_dir() -> Option<PathBuf> {
    legacy_data_dir().map(|d| d.parent().map(|p| p.to_path_buf()).unwrap_or(d))
}

/// 프로필 인스턴스 루트 — 실DB 실측: <userData>/instances/<uuid>
pub fn instances_dir() -> Option<PathBuf> {
    legacy_user_data_dir().map(|d| d.join("instances"))
}
```

Cargo.toml(core): `uuid = { version = "1", features = ["v4"] }` (workspace.dependencies에 추가 후 참조)

- [ ] **Step 4: 통과 확인** — Run: `cargo test -p hyenimc-core` / Expected: 기존 4 + settings 4 + 신규 1 all pass
- [ ] **Step 5: 커밋** — `git commit -m "feat(tauri): hyenimc-core 프로필 CRUD (기존 스키마 in-place)"`

---

### Task 3: hyenimc-core stats 모듈

**Files:**
- Create: `crates/hyenimc-core/src/stats.rs`
- Modify: `crates/hyenimc-core/src/lib.rs`

**Interfaces:**
- Produces: `ProfileStats{profile_id, last_launched_at: Option<i64>, total_play_time: i64, launch_count: i64, crash_count: i64, last_crash_at: Option<i64>}` (camelCase 직렬화), `get_stats(&Connection, profile_id) -> Result<ProfileStats, CoreError>` (행 없으면 0 기본값), `record_launch(&Connection, profile_id, now_secs)`, `record_play_time(&Connection, profile_id, seconds)`, `record_crash(&Connection, profile_id, now_secs)` — UPSERT

- [ ] **Step 1: 실패하는 테스트** (fixture에 profile_stats DDL 추가 — 실DB .schema 그대로):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn fixture() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE profile_stats (
                profile_id TEXT PRIMARY KEY,
                last_launched_at INTEGER,
                total_play_time INTEGER DEFAULT 0,
                launch_count INTEGER DEFAULT 0,
                crash_count INTEGER DEFAULT 0,
                last_crash_at INTEGER
            );",
        )
        .unwrap();
        conn
    }

    #[test]
    fn missing_row_yields_zeroes() {
        let conn = fixture();
        let s = get_stats(&conn, "p1").unwrap();
        assert_eq!(s.launch_count, 0);
        assert_eq!(s.last_launched_at, None);
    }

    #[test]
    fn record_launch_play_crash_accumulate() {
        let conn = fixture();
        record_launch(&conn, "p1", 100).unwrap();
        record_launch(&conn, "p1", 200).unwrap();
        record_play_time(&conn, "p1", 3600).unwrap();
        record_crash(&conn, "p1", 250).unwrap();
        let s = get_stats(&conn, "p1").unwrap();
        assert_eq!(s.launch_count, 2);
        assert_eq!(s.last_launched_at, Some(200));
        assert_eq!(s.total_play_time, 3600);
        assert_eq!(s.crash_count, 1);
        assert_eq!(s.last_crash_at, Some(250));
    }
}
```

- [ ] **Step 2: 실패 확인** — `cargo test -p hyenimc-core stats` → 컴파일 실패
- [ ] **Step 3: 구현** — UPSERT 3종 + SELECT(없으면 Default). 예: `record_launch`:

```rust
pub fn record_launch(conn: &Connection, profile_id: &str, now_secs: i64) -> Result<(), CoreError> {
    conn.execute(
        "INSERT INTO profile_stats (profile_id, last_launched_at, launch_count) VALUES (?1, ?2, 1)
         ON CONFLICT(profile_id) DO UPDATE SET last_launched_at=?2, launch_count=launch_count+1",
        rusqlite::params![profile_id, now_secs],
    )?;
    Ok(())
}
```

- [ ] **Step 4: 통과 확인** — `cargo test -p hyenimc-core` all pass
- [ ] **Step 5: 커밋** — `git commit -m "feat(tauri): hyenimc-core profile_stats 모듈"`

---

### Task 4: Tauri 커맨드 표면 (14개)

**Files:**
- Modify: `apps/launcher/src-tauri/src/main.rs` → 커맨드를 `src/commands.rs`로 분리
- Create: `apps/launcher/src-tauri/src/commands.rs`
- Modify: `apps/launcher/src-tauri/Cargo.toml` (sysinfo)

**Interfaces:**
- Consumes: Task 1~3의 core 함수 전부
- Produces: 커맨드 이름(어댑터가 의존): `profile_list, profile_get, profile_create, profile_update, profile_delete, profile_toggle_favorite, profile_get_stats, profile_record_launch, profile_record_play_time, profile_record_crash, settings_get, settings_update, system_memory, system_get_path`

- [ ] **Step 1: DbState 도입 + 커맨드 구현** — `commands.rs`:

```rust
//! Tauri 커맨드 표면 (M1) — 기존 IPC 핸들러 대응.

use std::sync::Mutex;
use tauri::State;

use hyenimc_core::rusqlite::Connection;
use hyenimc_core::{settings::GlobalSettings, profile::{NewProfile, ProfilePatch}};

pub struct DbState(pub Mutex<Connection>);

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[tauri::command]
pub fn profile_list(db: State<DbState>) -> Result<Vec<hyenimc_core::Profile>, String> {
    hyenimc_core::list_profiles(&db.0.lock().unwrap()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn profile_get(db: State<DbState>, id: String) -> Result<Option<hyenimc_core::Profile>, String> {
    hyenimc_core::profile::get_profile(&db.0.lock().unwrap(), &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn profile_create(db: State<DbState>, data: NewProfile) -> Result<hyenimc_core::Profile, String> {
    let instances = hyenimc_core::paths::instances_dir()
        .ok_or_else(|| "instances dir을 결정할 수 없음".to_string())?;
    let conn = db.0.lock().unwrap();
    // id는 create_profile 내부에서 생성되므로 디렉터리는 생성 후 실경로로 만든다
    let created = hyenimc_core::profile::create_profile(
        &conn, &data, &instances.join("__pending__").display().to_string(), now_secs(),
    ).map_err(|e| e.to_string())?;
    let dir = instances.join(&created.id);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let patch = ProfilePatch::default();
    drop(patch); // game_directory는 전용 UPDATE로
    conn.execute(
        "UPDATE profiles SET game_directory=?1 WHERE id=?2",
        hyenimc_core::rusqlite::params![dir.display().to_string(), created.id],
    ).map_err(|e| e.to_string())?;
    hyenimc_core::profile::get_profile(&conn, &created.id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "created profile vanished".into())
}

#[tauri::command]
pub fn profile_update(db: State<DbState>, id: String, data: ProfilePatch) -> Result<Option<hyenimc_core::Profile>, String> {
    hyenimc_core::profile::update_profile(&db.0.lock().unwrap(), &id, &data, now_secs()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn profile_delete(db: State<DbState>, id: String) -> Result<bool, String> {
    let conn = db.0.lock().unwrap();
    if let Ok(Some(p)) = hyenimc_core::profile::get_profile(&conn, &id) {
        let _ = std::fs::remove_dir_all(&p.game_directory); // best-effort
    }
    hyenimc_core::profile::delete_profile(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn profile_toggle_favorite(db: State<DbState>, id: String) -> Result<Option<hyenimc_core::Profile>, String> {
    hyenimc_core::profile::toggle_favorite(&db.0.lock().unwrap(), &id, now_secs()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn profile_get_stats(db: State<DbState>, profile_id: String) -> Result<hyenimc_core::stats::ProfileStats, String> {
    hyenimc_core::stats::get_stats(&db.0.lock().unwrap(), &profile_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn profile_record_launch(db: State<DbState>, profile_id: String) -> Result<(), String> {
    hyenimc_core::stats::record_launch(&db.0.lock().unwrap(), &profile_id, now_secs()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn profile_record_play_time(db: State<DbState>, profile_id: String, seconds: i64) -> Result<(), String> {
    hyenimc_core::stats::record_play_time(&db.0.lock().unwrap(), &profile_id, seconds).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn profile_record_crash(db: State<DbState>, profile_id: String) -> Result<(), String> {
    hyenimc_core::stats::record_crash(&db.0.lock().unwrap(), &profile_id, now_secs()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn settings_get(db: State<DbState>) -> Result<GlobalSettings, String> {
    hyenimc_core::get_settings(&db.0.lock().unwrap()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn settings_update(db: State<DbState>, settings: GlobalSettings) -> Result<(), String> {
    hyenimc_core::update_settings(&db.0.lock().unwrap(), &settings, now_secs()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn system_memory() -> u64 {
    let mut sys = sysinfo::System::new();
    sys.refresh_memory();
    sys.total_memory() // bytes
}

#[tauri::command]
pub fn system_get_path(name: String) -> Result<String, String> {
    match name.as_str() {
        "userData" => hyenimc_core::paths::legacy_user_data_dir()
            .map(|p| p.display().to_string())
            .ok_or_else(|| "userData 경로를 결정할 수 없음".into()),
        other => Err(format!("unsupported path name: {other}")),
    }
}
```

main.rs: `mod commands;` + setup에서 `app.manage(commands::DbState(Mutex::new(open_legacy_db()?)))` (열기 실패 시 명시적 로그 후 에러 — silent 초기화 금지), `generate_handler!`에 14개 + 기존 get_profiles/db_status는 profile_list/db_status로 정리(get_profiles 제거, shim도 profile_list 사용).

- [ ] **Step 2: 컴파일 확인** — Run: `cargo check --workspace` / Expected: clean
- [ ] **Step 3: 커밋** — `git commit -m "feat(tauri): M1 커맨드 표면 14개 (프로필 CRUD/통계/설정/시스템)"`

---

### Task 5: 어댑터 shim 정식화

**Files:**
- Modify: `src/renderer/tauri-shim.ts` (Proxy 스텁 → 명시적 매핑)

**Interfaces:**
- Consumes: Task 4 커맨드 14개
- Produces: `window.electronAPI` 중 profile(11)/settings(2)/system(2) 실구현, game/mod/resourcepack/shaderpack/account/version 등은 명시적 스텁(빈 배열/false/no-op + 최초 1회 console.warn)

- [ ] **Step 1: 재작성** — 핵심 구조 (전체 파일 교체):

```typescript
function installTauriShim(): void {
  const tauri = window.__TAURI__;
  if (!tauri || (window as any).electronAPI) return;
  const invoke = tauri.core.invoke;

  const warned = new Set<string>();
  const stub = (name: string, value: unknown = []) => async () => {
    if (!warned.has(name)) { console.warn(`[tauri-shim] stub: ${name}`); warned.add(name); }
    return value;
  };

  (window as any).electronAPI = {
    profile: {
      list: () => invoke('profile_list'),
      get: (id: string) => invoke('profile_get', { id }),
      create: (data: unknown) => invoke('profile_create', { data }),
      update: (id: string, data: unknown) => invoke('profile_update', { id, data }),
      delete: (id: string) => invoke('profile_delete', { id }),
      toggleFavorite: (id: string) => invoke('profile_toggle_favorite', { id }),
      launch: stub('profile.launch', undefined),          // M2
      getStats: (profileId: string) => invoke('profile_get_stats', { profileId }),
      recordLaunch: (profileId: string) => invoke('profile_record_launch', { profileId }),
      recordPlayTime: (profileId: string, seconds: number) => invoke('profile_record_play_time', { profileId, seconds }),
      recordCrash: (profileId: string) => invoke('profile_record_crash', { profileId }),
    },
    settings: {
      get: () => invoke('settings_get'),
      update: (settings: unknown) => invoke('settings_update', { settings }),
      resetCache: stub('settings.resetCache', { success: true, message: 'stub' }),
      getCacheStats: stub('settings.getCacheStats', { size: 0, files: 0 }),
      export: stub('settings.export', '{}'),
      import: stub('settings.import', { success: false, message: 'M1 미구현' }),
    },
    system: {
      getPath: (name: string) => invoke('system_get_path', { name }),
      getMemory: () => invoke('system_memory'),
    },
    game: {
      getActive: stub('game.getActive', []),
      isRunning: stub('game.isRunning', false),
      stop: stub('game.stop', undefined),
    },
    on: () => () => undefined,
    once: () => () => undefined,
    off: () => undefined,
    // 나머지 카테고리(mod/modpack/resourcepack/shaderpack/account/version/java/loader/
    // hyeni/workerMods/hyenipack/shell/dialog/fs/launcher/fileWatcher/errorDialog)는
    // 카테고리 Proxy로 빈 응답 스텁 + warn (M2+에서 순차 실구현)
  };
  // 카테고리 Proxy 부착
  const api = (window as any).electronAPI;
  for (const cat of ['mod','modpack','resourcepack','shaderpack','account','version','java',
                     'loader','hyeni','workerMods','hyenipack','shell','dialog','fs',
                     'launcher','fileWatcher','errorDialog']) {
    api[cat] = new Proxy({}, { get: (_t, m: string) => stub(`${cat}.${String(m)}`) });
  }
  console.info('[tauri-shim] M1 adapter installed');
}
```

- [ ] **Step 2: 검증** — Run: `npm run build && npx vitest run` / Expected: 빌드 클린 + 19 tests pass (Electron 경로 무손상)
- [ ] **Step 3: 커밋** — `git commit -m "feat(tauri): 어댑터 shim 정식화 — profile/settings/system 실연결"`

---

### Task 6: M1 마감 검증

- [ ] **Step 1: 전체 검증** — Run: `cargo test -p hyenimc-core && cargo check --workspace && npm run build && npx vitest run`
Expected: core 테스트 전부 + 컴파일 클린 + vitest 19
- [ ] **Step 2: 실DB 스모크(헤드리스)** — `read_real_db` example에 settings/stats 출력 추가 후 실행, 실DB에서 설정 로드 확인:
Run: `cargo run -p hyenimc-core --example read_real_db`
Expected: 기존 프로필 4개 + `settings: java.memory_max=4096 ...` 출력
- [ ] **Step 3: 설계 문서 M1 상태 갱신 + 커밋** — TAURI_MIGRATION_PHASE1.md M1 줄에 완료 표기(잔여: tauri dev 육안 렌더 확인은 일괄 테스트로). `git commit -m "docs: M1 완료 반영"`

---

## Self-Review 결과

- **커버리지**: M1 완료 조건(프로필 화면 실데이터 렌더 + CRUD) ← 커맨드 14 + 어댑터 매핑으로 충족. 화면 육안 확인만 일괄 테스트로 연기(사용자 방침).
- **의도된 보류**: 계정(M3)/게임 실행·버전(M2)/모드류(M4~) — 전부 명시적 스텁으로 경계 표시. settings export/import·cache는 스텁(사용 빈도 낮음, M6 정리).
- **타입 일관성**: 커맨드 이름 14개가 Task 4 정의 ↔ Task 5 어댑터 호출에서 일치함을 대조 완료. ProfilePatch의 이중 Option(Some(None)=NULL 초기화) 의미를 Task 2와 4에서 동일 사용.
