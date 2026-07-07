//! 설치된 모드 목록/토글/삭제 커맨드 (M6 보완) — 기존 mod.list/toggle/remove IPC 대응.
//! 파싱/파일 조작은 hyenimc_launcher::modmeta에 위임.

use std::path::PathBuf;

use tauri::State;

use hyenimc_launcher::modmeta::{self, InstalledMod};

use crate::commands::DbState;
use crate::game::load_profile_pub;

fn mods_dir(db: &State<'_, DbState>, profile_id: &str) -> Result<PathBuf, String> {
    let profile = load_profile_pub(db, profile_id)?;
    Ok(PathBuf::from(&profile.game_directory).join("mods"))
}

#[tauri::command]
pub async fn mod_list(
    db: State<'_, DbState>,
    profile_id: String,
) -> Result<Vec<InstalledMod>, String> {
    // DB 조회는 즉시 끝나지만 jar 파싱(수백 개 zip)은 무거우므로 blocking 풀로 넘겨
    // webview 이벤트 루프(메인 스레드)를 막지 않는다 — 모드 탭 프리즈 방지.
    let dir = mods_dir(&db, &profile_id)?;
    tauri::async_runtime::spawn_blocking(move || modmeta::list_mods(&dir))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn mod_toggle(
    db: State<'_, DbState>,
    profile_id: String,
    file_name: String,
    enabled: bool,
) -> Result<serde_json::Value, String> {
    modmeta::toggle_mod(&mods_dir(&db, &profile_id)?, &file_name, enabled)
        .map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "success": true }))
}

#[tauri::command]
pub fn mod_remove(
    db: State<'_, DbState>,
    profile_id: String,
    file_name: String,
) -> Result<serde_json::Value, String> {
    modmeta::remove_mod(&mods_dir(&db, &profile_id)?, &file_name).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "success": true }))
}
