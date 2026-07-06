//! 리소스팩/셰이더팩 읽기전용 리스트 + 파일 감시 (M5 T4).
//! 사용자 런처는 설치/삭제 없이 목록만 — 폴더 열기(shell)로 직접 관리.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use notify::Watcher;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use hyenimc_launcher::hyenipack::read_provided_packs;

use crate::commands::DbState;
use crate::game::game_dirs_for;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackEntry {
    pub file_name: String,
    pub name: String,
    pub size: u64,
    pub enabled: bool,          // 사용자 런처는 항상 enabled(읽기전용)
    pub is_directory: bool,
    pub provided_by_pack: bool, // 혜니팩이 설치한 것 vs 사용자 추가
}

fn list_dir(dir: &std::path::Path, provided: &[String]) -> Vec<PackEntry> {
    let mut out = Vec::new();
    let Ok(rd) = std::fs::read_dir(dir) else { return out };
    for entry in rd.flatten() {
        let file_name = entry.file_name().to_string_lossy().to_string();
        if file_name.starts_with('.') {
            continue;
        }
        let meta = entry.metadata().ok();
        let is_directory = meta.as_ref().map(|m| m.is_dir()).unwrap_or(false);
        // 셰이더/리소스팩 = zip 또는 폴더
        if !is_directory && !file_name.to_lowercase().ends_with(".zip") {
            continue;
        }
        out.push(PackEntry {
            name: file_name.trim_end_matches(".zip").to_string(),
            size: meta.map(|m| m.len()).unwrap_or(0),
            enabled: true,
            is_directory,
            provided_by_pack: provided.iter().any(|p| p == &file_name),
            file_name,
        });
    }
    out.sort_by(|a, b| a.file_name.to_lowercase().cmp(&b.file_name.to_lowercase()));
    out
}

fn pack_list(db: &State<'_, DbState>, profile_id: &str, subdir: &str, kind: &str) -> Result<Vec<PackEntry>, String> {
    let profile = crate::game::load_profile_pub(db, profile_id)?;
    let dirs = game_dirs_for(&profile)?;
    let provided_meta = read_provided_packs(&dirs.instance_dir);
    let provided = match kind {
        "resourcepacks" => provided_meta.resourcepacks,
        _ => provided_meta.shaderpacks,
    };
    Ok(list_dir(&dirs.instance_dir.join(subdir), &provided))
}

#[tauri::command]
pub fn resourcepack_list(db: State<DbState>, profile_id: String) -> Result<Vec<PackEntry>, String> {
    pack_list(&db, &profile_id, "resourcepacks", "resourcepacks")
}

#[tauri::command]
pub fn shaderpack_list(db: State<DbState>, profile_id: String) -> Result<Vec<PackEntry>, String> {
    pack_list(&db, &profile_id, "shaderpacks", "shaderpacks")
}

// ── 파일 감시 ────────────────────────────────────────────

#[derive(Default)]
pub struct WatchState {
    watchers: Mutex<HashMap<String, notify::RecommendedWatcher>>,
}

#[tauri::command]
pub fn file_watch_start(
    app: AppHandle,
    watch_state: State<WatchState>,
    profile_id: String,
    game_directory: String,
) -> Result<(), String> {
    let dir = PathBuf::from(&game_directory);
    let app2 = app.clone();
    let pid = profile_id.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(event) = res {
            // resourcepacks/shaderpacks/mods 변경만 통지
            if event.paths.iter().any(|p| {
                p.components().any(|c| {
                    matches!(
                        c.as_os_str().to_str(),
                        Some("resourcepacks") | Some("shaderpacks") | Some("mods")
                    )
                })
            }) {
                let _ = app2.emit("file:changed", serde_json::json!({ "profileId": pid }));
            }
        }
    })
    .map_err(|e| e.to_string())?;

    // 하위 폴더가 없을 수 있으므로 인스턴스 루트를 재귀 감시
    watcher
        .watch(&dir, notify::RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;
    watch_state.watchers.lock().unwrap().insert(profile_id, watcher);
    let _ = app;
    Ok(())
}

#[tauri::command]
pub fn file_watch_stop(watch_state: State<WatchState>, profile_id: String) -> Result<(), String> {
    watch_state.watchers.lock().unwrap().remove(&profile_id);
    Ok(())
}
