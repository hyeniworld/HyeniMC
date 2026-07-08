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
    // 리소스팩 pack.mcmeta 메타 (셰이더팩은 기본값). 프론트가 "Format {packFormat}"·설명·아이콘 표시.
    pub pack_format: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
}

fn list_dir(dir: &std::path::Path, provided: &[String], parse_meta: bool) -> Vec<PackEntry> {
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
        // 리소스팩만 pack.mcmeta에서 pack_format/설명/아이콘 파싱 (셰이더팩은 미해당)
        let (pack_format, description, icon) = if parse_meta {
            read_pack_metadata(&entry.path(), is_directory)
        } else {
            (0, None, None)
        };
        out.push(PackEntry {
            name: file_name.trim_end_matches(".zip").to_string(),
            size: meta.map(|m| m.len()).unwrap_or(0),
            enabled: true,
            is_directory,
            provided_by_pack: provided.iter().any(|p| p == &file_name),
            file_name,
            pack_format,
            description,
            icon,
        });
    }
    out.sort_by(|a, b| a.file_name.to_lowercase().cmp(&b.file_name.to_lowercase()));
    out
}

fn pack_list(db: &State<'_, DbState>, profile_id: &str, subdir: &str, kind: &str) -> Result<Vec<PackEntry>, String> {
    let profile = crate::game::load_profile_pub(db, profile_id)?;
    let dirs = game_dirs_for(&profile)?;
    let provided_meta = read_provided_packs(&dirs.instance_dir);
    let (provided, parse_meta) = match kind {
        "resourcepacks" => (provided_meta.resourcepacks, true),
        _ => (provided_meta.shaderpacks, false),
    };
    Ok(list_dir(&dirs.instance_dir.join(subdir), &provided, parse_meta))
}

/// 리소스팩(zip 또는 폴더)의 pack.mcmeta/pack.png → (pack_format, description, iconDataUri).
/// Electron resourcepack-manager.parsePackInfo 동일 처리.
fn read_pack_metadata(pack_path: &std::path::Path, is_directory: bool) -> (u32, Option<String>, Option<String>) {
    let (mcmeta, png) = if is_directory {
        (
            std::fs::read(pack_path.join("pack.mcmeta")).ok(),
            std::fs::read(pack_path.join("pack.png")).ok(),
        )
    } else {
        read_zip_pack_files(pack_path)
    };

    let mut pack_format = 0u32;
    let mut description = None;
    if let Some(bytes) = mcmeta {
        // pack.mcmeta에 제어문자가 섞여 있으면 파싱이 깨지므로 공백으로 치환(Electron safeParse 동일)
        let sanitized = sanitize_json_bytes(&bytes);
        if let Ok(json) = serde_json::from_slice::<serde_json::Value>(&sanitized) {
            let pack = json.get("pack");
            pack_format = pack
                .and_then(|p| p.get("pack_format"))
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as u32;
            description = pack.and_then(|p| p.get("description")).and_then(normalize_description);
        }
    }
    let icon = png.map(|data| format!("data:image/png;base64,{}", base64_encode(&data)));
    (pack_format, description, icon)
}

fn read_zip_pack_files(zip_path: &std::path::Path) -> (Option<Vec<u8>>, Option<Vec<u8>>) {
    let Ok(file) = std::fs::File::open(zip_path) else { return (None, None) };
    let Ok(mut zip) = zip::ZipArchive::new(file) else { return (None, None) };
    fn entry_bytes(zip: &mut zip::ZipArchive<std::fs::File>, name: &str) -> Option<Vec<u8>> {
        let mut e = zip.by_name(name).ok()?;
        let mut buf = Vec::new();
        std::io::Read::read_to_end(&mut e, &mut buf).ok()?;
        Some(buf)
    }
    let mcmeta = entry_bytes(&mut zip, "pack.mcmeta");
    let png = entry_bytes(&mut zip, "pack.png");
    (mcmeta, png)
}

/// pack.mcmeta description 정규화 — 문자열 / {translate,fallback} / 배열 모두 문자열로.
fn normalize_description(v: &serde_json::Value) -> Option<String> {
    match v {
        serde_json::Value::String(s) => Some(s.clone()),
        serde_json::Value::Object(o) => o
            .get("fallback")
            .or_else(|| o.get("translate"))
            .and_then(|x| x.as_str())
            .map(String::from)
            .or_else(|| Some(v.to_string())),
        serde_json::Value::Array(a) => {
            let joined: Vec<String> =
                a.iter().filter_map(|x| x.as_str().map(String::from)).collect();
            (!joined.is_empty()).then(|| joined.join(" "))
        }
        _ => None,
    }
}

/// JSON 문자열 내 제어문자(0x00-0x19, 0x7F)를 공백으로 — \n\r\t는 보존.
fn sanitize_json_bytes(bytes: &[u8]) -> Vec<u8> {
    bytes
        .iter()
        .map(|&b| {
            if (b <= 0x19 || b == 0x7F) && b != b'\n' && b != b'\r' && b != b'\t' {
                b' '
            } else {
                b
            }
        })
        .collect()
}

/// 표준 base64 인코딩 (pack.png → data URI용, 소량이라 의존성 없이 직접 구현).
fn base64_encode(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(T[((n >> 18) & 63) as usize] as char);
        out.push(T[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 { T[((n >> 6) & 63) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { T[(n & 63) as usize] as char } else { '=' });
    }
    out
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
        let Ok(event) = res else { return };
        // 이벤트 종류 → 렌더러 action. Access/Other 등은 무시.
        let action = match event.kind {
            notify::EventKind::Create(_) => "add",
            notify::EventKind::Modify(_) => "change",
            notify::EventKind::Remove(_) => "remove",
            _ => return,
        };
        for path in &event.paths {
            // 어느 하위 폴더(mods/resourcepacks/shaderpacks)의 변경인지 판별
            let Some(kind) = path.components().find_map(|c| match c.as_os_str().to_str() {
                Some("mods") => Some("mods"),
                Some("resourcepacks") => Some("resourcepacks"),
                Some("shaderpacks") => Some("shaderpacks"),
                _ => None,
            }) else {
                continue;
            };
            let file_name = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            // 폴더 자체 이벤트나 빈 파일명은 건너뜀 (렌더러는 파일 단위로 처리)
            if file_name.is_empty() || file_name == kind {
                continue;
            }
            // 렌더러(ModList/ResourcePackList/ShaderPackList)가 기대하는 페이로드
            let _ = app2.emit(
                "file:changed",
                serde_json::json!({
                    "profileId": pid,
                    "type": kind,
                    "action": action,
                    "fileName": file_name,
                }),
            );
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_known_vectors() {
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"M"), "TQ==");
        assert_eq!(base64_encode(b"Ma"), "TWE=");
        assert_eq!(base64_encode(b"Man"), "TWFu");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn description_normalization() {
        assert_eq!(normalize_description(&serde_json::json!("hi")).as_deref(), Some("hi"));
        assert_eq!(
            normalize_description(&serde_json::json!({"fallback":"fb","translate":"t"})).as_deref(),
            Some("fb")
        );
        assert_eq!(
            normalize_description(&serde_json::json!({"translate":"t"})).as_deref(),
            Some("t")
        );
        assert_eq!(normalize_description(&serde_json::json!(["a", "b"])).as_deref(), Some("a b"));
        assert_eq!(normalize_description(&serde_json::json!(42)), None);
    }

    #[test]
    fn sanitize_replaces_control_chars_keeps_whitespace() {
        let input = b"a\x01b\tc\nd";
        assert_eq!(sanitize_json_bytes(input), b"a b\tc\nd");
    }
}
