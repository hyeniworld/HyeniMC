//! 설치된 모드 목록/토글/삭제 커맨드 — 기존 mod.list/toggle/remove IPC 대응.
//! 목록은 `profile_mods` 캐시(Electron in-place 공유) + 파일 개수·mtime 비교로 변경분만 재파싱.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use tauri::State;

use hyenimc_core::mod_cache::{self, CachedMod};
use hyenimc_launcher::modmeta::{self, InstalledMod};

use crate::commands::DbState;
use crate::game::load_profile_pub;

const DISABLED: &str = ".disabled";

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn mods_dir(db: &State<'_, DbState>, profile_id: &str) -> Result<PathBuf, String> {
    let profile = load_profile_pub(db, profile_id)?;
    Ok(PathBuf::from(&profile.game_directory).join("mods"))
}

/// 캐시 miss 시 파싱할 디스크 파일 + 기존 캐시의 소스 메타(worker mods 연동 보존).
struct ParseTask {
    disk_name: String,
    mtime: i64,
    size: i64,
    prev_source_mod_id: Option<String>,
    prev_source_file_id: Option<String>,
}

struct DiskFile {
    disk_name: String,
    mtime: i64,
    size: i64,
}

/// mods 디렉터리를 stat만으로 스캔(개수+mtime 비교용 — zip 파싱 없음, 빠름).
fn scan_mods_dir(dir: &Path) -> Vec<DiskFile> {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    rd.flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            let lower = name.to_lowercase();
            if !(lower.ends_with(".jar") || lower.ends_with(".jar.disabled")) {
                return None;
            }
            let meta = entry.metadata().ok()?;
            if !meta.is_file() {
                return None;
            }
            let mtime = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);
            Some(DiskFile { disk_name: name, mtime, size: meta.len() as i64 })
        })
        .collect()
}

fn to_installed(c: &CachedMod) -> InstalledMod {
    let canonical = c.file_name.trim_end_matches(DISABLED).to_string();
    // 캐시에 name/version이 비어 있을 수 있음(메타 없는 라이브러리 jar를 Electron이 빈 값으로
    // 저장한 경우). 표시용으로 파일명/추론값 폴백 — '이름 없음, v —' 방지.
    let name = if c.name.is_empty() {
        canonical.clone()
    } else {
        c.name.clone()
    };
    let version = if c.version.is_empty() {
        let stem = canonical.trim_end_matches(".jar");
        hyenimc_launcher::workermods::parse_mod_version(stem).unwrap_or_else(|| "Unknown".into())
    } else {
        c.version.clone()
    };
    InstalledMod {
        file_name: canonical,
        name,
        version,
        mod_id: c.mod_id.clone(),
        description: c.description.clone(),
        authors: c.authors.clone(),
        enabled: c.enabled,
        file_size: c.file_size as u64,
    }
}

#[tauri::command]
pub async fn mod_list(
    db: State<'_, DbState>,
    profile_id: String,
) -> Result<Vec<InstalledMod>, String> {
    let dir = mods_dir(&db, &profile_id)?;
    let disk = scan_mods_dir(&dir);

    // 캐시 조회(빠름)
    let cached = {
        let conn = db.0.lock().unwrap();
        mod_cache::list_cached_mods(&conn, &profile_id).map_err(|e| e.to_string())?
    };
    let cache_map: HashMap<String, CachedMod> =
        cached.into_iter().map(|m| (m.file_name.clone(), m)).collect();

    // 변경 없는 파일은 캐시 사용, 신규/변경만 재파싱 대상
    let mut result: Vec<CachedMod> = Vec::new();
    let mut tasks: Vec<ParseTask> = Vec::new();
    for f in &disk {
        match cache_map.get(&f.disk_name) {
            Some(c) if c.last_modified == f.mtime => result.push(c.clone()),
            prev => tasks.push(ParseTask {
                disk_name: f.disk_name.clone(),
                mtime: f.mtime,
                size: f.size,
                prev_source_mod_id: prev.and_then(|c| c.source_mod_id.clone()),
                prev_source_file_id: prev.and_then(|c| c.source_file_id.clone()),
            }),
        }
    }

    // 재파싱은 blocking 풀에서(zip 파싱이 무거움 — webview 스레드 보호)
    if !tasks.is_empty() {
        let dir2 = dir.clone();
        let parsed: Vec<CachedMod> = tauri::async_runtime::spawn_blocking(move || {
            // 통합 메타(.hyenimc-metadata.json)에서 출처를 채운다 — 없으면 이전 캐시/'local' 폴백.
            // (재파싱마다 source를 'local'로 덮어 Electron이 기록한 출처가 사라지던 문제 수정)
            let unified = hyenimc_launcher::instmeta::read_unified(&dir2);
            tasks
                .into_iter()
                .map(|t| {
                    let canonical = t.disk_name.trim_end_matches(DISABLED);
                    let enabled = !t.disk_name.ends_with(DISABLED);
                    let meta = modmeta::parse_mod_metadata(&dir2.join(&t.disk_name), canonical);
                    let inst = unified
                        .as_ref()
                        .and_then(|u| u.mods.get(&t.disk_name).or_else(|| u.mods.get(canonical)));
                    let source = inst
                        .map(|m| m.source.clone())
                        .filter(|s| !s.is_empty())
                        .unwrap_or_else(|| "local".into());
                    let source_mod_id =
                        inst.and_then(|m| m.source_mod_id.clone()).or(t.prev_source_mod_id);
                    let source_file_id =
                        inst.and_then(|m| m.source_file_id.clone()).or(t.prev_source_file_id);
                    CachedMod {
                        file_name: t.disk_name,
                        file_size: t.size,
                        mod_id: meta.mod_id,
                        name: meta.name,
                        version: meta.version,
                        description: meta.description,
                        authors: meta.authors,
                        enabled,
                        source,
                        last_modified: t.mtime,
                        source_mod_id,
                        source_file_id,
                    }
                })
                .collect()
        })
        .await
        .map_err(|e| e.to_string())?;

        {
            let conn = db.0.lock().unwrap();
            let dir_str = dir.to_string_lossy();
            mod_cache::upsert_mods(&conn, &profile_id, &dir_str, &parsed, now_secs())
                .map_err(|e| e.to_string())?;
        }
        result.extend(parsed);
    }

    // 디스크에서 사라진 캐시 정리
    {
        let conn = db.0.lock().unwrap();
        let names: Vec<String> = disk.iter().map(|f| f.disk_name.clone()).collect();
        mod_cache::delete_missing(&conn, &profile_id, &names).map_err(|e| e.to_string())?;
    }

    let mut installed: Vec<InstalledMod> = result.iter().map(to_installed).collect();
    installed.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(installed)
}

#[tauri::command]
pub fn mod_toggle(
    db: State<'_, DbState>,
    profile_id: String,
    file_name: String,
    enabled: bool,
) -> Result<serde_json::Value, String> {
    // 파일만 rename — 캐시 정합은 다음 mod_list가 개수/mtime 차이로 자동 처리.
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
