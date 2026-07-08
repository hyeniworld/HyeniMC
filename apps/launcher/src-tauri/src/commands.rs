//! Tauri 커맨드 표면 (M1) — 기존 Electron IPC 핸들러 대응.
//! 어댑터(src/renderer/tauri-shim.ts)가 이 이름들에 의존한다.

use std::sync::Mutex;
use tauri::State;

use hyenimc_core::profile::{NewProfile, ProfilePatch};
use hyenimc_core::rusqlite::Connection;
use hyenimc_core::settings::GlobalSettings;

use crate::game::GameState;

pub struct DbState(pub Mutex<Connection>);

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[tauri::command]
pub fn profile_list(db: State<DbState>) -> Result<Vec<hyenimc_core::Profile>, String> {
    let conn = db.0.lock().unwrap();
    let mut profiles = hyenimc_core::list_profiles(&conn).map_err(|e| e.to_string())?;
    // 플레이 시간/통계는 profile_stats 테이블이 원본(profiles.total_play_time은 미사용) —
    // Electron(Go)과 동일하게 stats 값으로 채운다.
    for p in &mut profiles {
        if let Ok(stats) = hyenimc_core::stats::get_stats(&conn, &p.id) {
            p.total_play_time = stats.total_play_time;
        }
    }
    Ok(profiles)
}

#[tauri::command]
pub fn profile_get(db: State<DbState>, id: String) -> Result<Option<hyenimc_core::Profile>, String> {
    let conn = db.0.lock().unwrap();
    let mut profile = hyenimc_core::profile::get_profile(&conn, &id).map_err(|e| e.to_string())?;
    if let Some(p) = profile.as_mut() {
        if let Ok(stats) = hyenimc_core::stats::get_stats(&conn, &p.id) {
            p.total_play_time = stats.total_play_time;
        }
    }
    Ok(profile)
}

#[tauri::command]
pub fn profile_create(db: State<DbState>, data: NewProfile) -> Result<hyenimc_core::Profile, String> {
    let instances = hyenimc_core::paths::instances_dir()
        .ok_or_else(|| "instances dir을 결정할 수 없음".to_string())?;
    let conn = db.0.lock().unwrap();

    // id는 create_profile 내부에서 생성되므로, 생성 후 실경로로 갱신
    let created = hyenimc_core::profile::create_profile(&conn, &data, "", now_secs())
        .map_err(|e| e.to_string())?;
    let dir = instances.join(&created.id);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE profiles SET game_directory = ?1 WHERE id = ?2",
        hyenimc_core::rusqlite::params![dir.display().to_string(), created.id],
    )
    .map_err(|e| e.to_string())?;

    hyenimc_core::profile::get_profile(&conn, &created.id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "created profile vanished".into())
}

#[tauri::command]
pub fn profile_update(
    db: State<DbState>,
    id: String,
    data: ProfilePatch,
) -> Result<Option<hyenimc_core::Profile>, String> {
    hyenimc_core::profile::update_profile(&db.0.lock().unwrap(), &id, &data, now_secs())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn profile_delete(
    db: State<'_, DbState>,
    game_state: State<'_, GameState>,
    id: String,
) -> Result<bool, String> {
    // 0) 실행 중이면 차단 — 사용 중인 파일을 지우면 게임이 깨지므로 먼저 종료해야 한다.
    if game_state.is_running(&id) {
        return Err("게임이 실행 중인 프로필은 삭제할 수 없습니다. 먼저 게임을 종료하세요.".into());
    }

    // 1) game_directory 읽기 (짧은 락)
    let game_dir = {
        let conn = db.0.lock().unwrap();
        hyenimc_core::profile::get_profile(&conn, &id)
            .ok()
            .flatten()
            .map(|p| p.game_directory)
            .filter(|d| !d.is_empty())
    };

    // 2) 파일 먼저 삭제 — blocking 풀에서(락 미보유 → UI/다른 DB 작업 안 막힘, 프리즈 해소).
    //    순서가 중요: 파일→DB. 삭제 도중 앱을 강제 종료하면 DB 행이 아직 남아 프로필이 그대로
    //    보이고 다시 삭제할 수 있다. 만약 DB를 먼저 지우면 "기록 없는 잔여 파일(orphan)"이 남는다.
    if let Some(dir) = game_dir {
        let result = tauri::async_runtime::spawn_blocking(move || std::fs::remove_dir_all(&dir)).await;
        // 이미 없는 디렉터리(NotFound)는 성공 취급. 그 외 실패(권한/사용 중 등)는 파일이 일부만
        // 남은 불완전 상태 → DB를 지우지 않고 'incomplete'로 표시해 사용자가 다시 삭제하도록 안내한다.
        let delete_failed = match result {
            Ok(Ok(())) => false,
            Ok(Err(e)) if e.kind() == std::io::ErrorKind::NotFound => false,
            _ => true,
        };
        if delete_failed {
            let conn = db.0.lock().unwrap();
            let _ = conn.execute(
                "UPDATE profiles SET installation_status = 'delete-failed' WHERE id = ?1",
                [&id],
            );
            return Err(
                "프로필 파일을 완전히 삭제하지 못했습니다. 다른 프로그램이 파일을 사용 중일 수 있습니다. \
                 프로필이 '삭제 실패' 상태로 표시되며, 잠시 후 다시 삭제를 시도하세요."
                    .into(),
            );
        }
    }

    // 3) 파일 정리 후 DB 행 삭제 (짧은 락)
    let deleted = {
        let conn = db.0.lock().unwrap();
        hyenimc_core::profile::delete_profile(&conn, &id).map_err(|e| e.to_string())?
    };
    Ok(deleted)
}

#[tauri::command]
pub fn profile_toggle_favorite(
    db: State<DbState>,
    id: String,
) -> Result<Option<hyenimc_core::Profile>, String> {
    hyenimc_core::profile::toggle_favorite(&db.0.lock().unwrap(), &id, now_secs())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn profile_get_stats(
    db: State<DbState>,
    profile_id: String,
) -> Result<hyenimc_core::stats::ProfileStats, String> {
    hyenimc_core::stats::get_stats(&db.0.lock().unwrap(), &profile_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn profile_record_launch(db: State<DbState>, profile_id: String) -> Result<(), String> {
    hyenimc_core::stats::record_launch(&db.0.lock().unwrap(), &profile_id, now_secs())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn profile_record_play_time(
    db: State<DbState>,
    profile_id: String,
    seconds: i64,
) -> Result<(), String> {
    hyenimc_core::stats::record_play_time(&db.0.lock().unwrap(), &profile_id, seconds)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn profile_record_crash(db: State<DbState>, profile_id: String) -> Result<(), String> {
    hyenimc_core::stats::record_crash(&db.0.lock().unwrap(), &profile_id, now_secs())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn settings_get(db: State<DbState>) -> Result<GlobalSettings, String> {
    hyenimc_core::settings::get_settings(&db.0.lock().unwrap()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn settings_update(db: State<DbState>, settings: serde_json::Value) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    // 렌더러가 모르는 섹션(advanced 등)이 빠진 채 저장돼도 기존 값이 리셋되지 않도록 병합
    let mut incoming = settings;
    if incoming.is_object() && incoming.get("advanced").is_none() {
        let current = hyenimc_core::settings::get_settings(&conn).map_err(|e| e.to_string())?;
        incoming["advanced"] =
            serde_json::to_value(&current.advanced).map_err(|e| e.to_string())?;
    }
    let parsed: GlobalSettings = serde_json::from_value(incoming).map_err(|e| e.to_string())?;
    hyenimc_core::settings::update_settings(&conn, &parsed, now_secs()).map_err(|e| e.to_string())
}

/// 재다운로드 가능한 캐시 디렉터리 = `<userData>/shared` (shared 에셋/라이브러리).
/// SettingsPage 위험영역 설명("에셋과 라이브러리")과 일치.
fn cache_dir() -> Result<std::path::PathBuf, String> {
    hyenimc_core::paths::legacy_user_data_dir()
        .map(|d| d.join("shared"))
        .ok_or_else(|| "userData 경로를 결정할 수 없음".to_string())
}

/// 디렉터리 전체 크기(바이트)와 파일 개수 재귀 집계.
fn dir_stats(dir: &std::path::Path) -> (u64, u64) {
    let mut size = 0u64;
    let mut files = 0u64;
    let Ok(rd) = std::fs::read_dir(dir) else {
        return (0, 0);
    };
    for entry in rd.flatten() {
        match entry.metadata() {
            Ok(m) if m.is_dir() => {
                let (s, f) = dir_stats(&entry.path());
                size += s;
                files += f;
            }
            Ok(m) => {
                size += m.len();
                files += 1;
            }
            Err(_) => {}
        }
    }
    (size, files)
}

/// 캐시 통계 {size, files} — SettingsPage 표시용 (기존 스텁을 실구현으로 대체).
#[tauri::command]
pub fn settings_cache_stats() -> serde_json::Value {
    let (size, files) = cache_dir().map(|d| dir_stats(&d)).unwrap_or((0, 0));
    serde_json::json!({ "size": size, "files": files })
}

/// 캐시 전체 삭제 — shared 에셋/라이브러리 제거(다음 실행 시 자동 재다운로드).
/// 실행 중인 게임이 읽고 있을 수 있으므로 하나라도 실행 중이면 거부한다(Tauri 보강).
#[tauri::command]
pub fn settings_reset_cache(game_state: State<GameState>) -> serde_json::Value {
    if game_state.any_running() {
        return serde_json::json!({
            "success": false,
            "message": "게임이 실행 중입니다. 모든 게임을 종료한 뒤 다시 시도하세요."
        });
    }
    match cache_dir().map(|d| std::fs::remove_dir_all(&d)) {
        Ok(Ok(())) => serde_json::json!({ "success": true, "message": "캐시가 삭제되었습니다." }),
        Ok(Err(e)) if e.kind() == std::io::ErrorKind::NotFound => {
            serde_json::json!({ "success": true, "message": "삭제할 캐시가 없습니다." })
        }
        Ok(Err(e)) => {
            serde_json::json!({ "success": false, "message": format!("캐시 삭제에 실패했습니다: {e}") })
        }
        Err(e) => serde_json::json!({ "success": false, "message": e }),
    }
}

#[tauri::command]
pub fn system_memory() -> u64 {
    let mut sys = sysinfo::System::new();
    sys.refresh_memory();
    // 기존 IPC와 동일하게 MB 단위 (shell.ts system:getMemory — 전체 리뷰 G2)
    sys.total_memory() / (1024 * 1024)
}

#[tauri::command]
pub fn system_get_path(name: String) -> Result<String, String> {
    match name.as_str() {
        "userData" => hyenimc_core::paths::legacy_user_data_dir()
            .map(|p| p.display().to_string())
            .ok_or_else(|| "userData 경로를 결정할 수 없음".into()),
        "documents" => home_dir()
            .map(|h| h.join("Documents").display().to_string())
            .ok_or_else(|| "documents 경로를 결정할 수 없음".into()),
        "downloads" => home_dir()
            .map(|h| h.join("Downloads").display().to_string())
            .ok_or_else(|| "downloads 경로를 결정할 수 없음".into()),
        other => Err(format!("unsupported path name: {other}")),
    }
}

fn home_dir() -> Option<std::path::PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(std::path::PathBuf::from)
}
