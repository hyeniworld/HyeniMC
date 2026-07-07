//! Tauri 커맨드 표면 (M1) — 기존 Electron IPC 핸들러 대응.
//! 어댑터(src/renderer/tauri-shim.ts)가 이 이름들에 의존한다.

use std::sync::Mutex;
use tauri::State;

use hyenimc_core::profile::{NewProfile, ProfilePatch};
use hyenimc_core::rusqlite::Connection;
use hyenimc_core::settings::GlobalSettings;

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
pub fn profile_delete(db: State<DbState>, id: String) -> Result<bool, String> {
    let conn = db.0.lock().unwrap();
    if let Ok(Some(p)) = hyenimc_core::profile::get_profile(&conn, &id) {
        if !p.game_directory.is_empty() {
            let _ = std::fs::remove_dir_all(&p.game_directory); // best-effort
        }
    }
    hyenimc_core::profile::delete_profile(&conn, &id).map_err(|e| e.to_string())
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
        other => Err(format!("unsupported path name: {other}")),
    }
}
