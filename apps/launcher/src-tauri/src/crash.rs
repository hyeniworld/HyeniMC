//! 크래시 리포트 수집·전달 (M5 T4) — 분석 대신 운영자에게 전달할 zip 생성 + 로그 폴더 열기.

use std::io::Write;
use std::path::Path;

use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;
use zip::write::SimpleFileOptions;

use crate::commands::DbState;
use crate::game::{game_dirs_for, load_profile_pub, GameState};

fn add_file(
    zip: &mut zip::ZipWriter<std::fs::File>,
    arcname: &str,
    path: &Path,
    opts: SimpleFileOptions,
) {
    if let Ok(bytes) = std::fs::read(path) {
        if zip.start_file(arcname, opts).is_ok() {
            let _ = zip.write_all(&bytes);
        }
    }
}

/// 크래시 리포트 zip 생성 → 다운로드 폴더 경로 반환.
/// 내용: 로그 버퍼 + latest.log + crash-reports 최신 3개 + 프로필/시스템 정보.
#[tauri::command]
pub fn crash_export_report(
    db: State<DbState>,
    game_state: State<GameState>,
    profile_id: String,
) -> Result<String, String> {
    let profile = load_profile_pub(&db, &profile_id)?;
    let dirs = game_dirs_for(&profile)?;
    let instance = &dirs.instance_dir;

    let downloads = hyenimc_core::paths::legacy_user_data_dir()
        .and_then(|u| u.parent().map(|p| p.to_path_buf()))
        .map(|home| home.join("Downloads"))
        .filter(|d| d.exists())
        .or_else(|| std::env::var_os("HOME").map(|h| Path::new(&h).join("Downloads")))
        .ok_or_else(|| "다운로드 폴더를 찾을 수 없습니다".to_string())?;
    std::fs::create_dir_all(&downloads).map_err(|e| e.to_string())?;

    let safe_name: String = profile
        .name
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect();
    let out_path = downloads.join(format!("hyenimc-crash-{safe_name}.zip"));

    let file = std::fs::File::create(&out_path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    let opts = SimpleFileOptions::default();

    // ① 인메모리 로그 버퍼 (게임 종료 후에도 보존)
    let logs = game_state.log_snapshot(&profile_id);
    if !logs.is_empty() {
        if zip.start_file("launcher-captured.log", opts).is_ok() {
            let _ = zip.write_all(logs.join("\n").as_bytes());
        }
    }

    // ② latest.log
    add_file(&mut zip, "latest.log", &instance.join("logs/latest.log"), opts);

    // ③ crash-reports 최신 3개
    if let Ok(rd) = std::fs::read_dir(instance.join("crash-reports")) {
        let mut reports: Vec<_> = rd
            .flatten()
            .filter(|e| e.path().extension().map(|x| x == "txt").unwrap_or(false))
            .collect();
        reports.sort_by_key(|e| e.metadata().and_then(|m| m.modified()).ok());
        for entry in reports.iter().rev().take(3) {
            let name = entry.file_name().to_string_lossy().to_string();
            add_file(&mut zip, &format!("crash-reports/{name}"), &entry.path(), opts);
        }
    }

    // ④ 프로필/시스템 정보
    let mut sys = sysinfo::System::new();
    sys.refresh_memory();
    let info = serde_json::json!({
        "profile": {
            "name": profile.name,
            "gameVersion": profile.game_version,
            "loaderType": profile.loader_type,
            "loaderVersion": profile.loader_version,
        },
        "system": {
            "os": std::env::consts::OS,
            "arch": std::env::consts::ARCH,
            "totalMemoryMb": sys.total_memory() / (1024 * 1024),
        },
        "mods": list_mod_files(&instance.join("mods")),
    });
    if zip.start_file("report.json", opts).is_ok() {
        let _ = zip.write_all(serde_json::to_string_pretty(&info).unwrap_or_default().as_bytes());
    }

    zip.finish().map_err(|e| e.to_string())?;
    Ok(out_path.display().to_string())
}

fn list_mod_files(mods_dir: &Path) -> Vec<String> {
    std::fs::read_dir(mods_dir)
        .map(|rd| {
            rd.flatten()
                .map(|e| e.file_name().to_string_lossy().to_string())
                .filter(|n| n.ends_with(".jar"))
                .collect()
        })
        .unwrap_or_default()
}

/// 로그 폴더 열기 (사용자가 직접 접근/전달)
#[tauri::command]
pub fn crash_open_logs(
    app: AppHandle,
    db: State<DbState>,
    profile_id: String,
) -> Result<(), String> {
    let profile = load_profile_pub(&db, &profile_id)?;
    let dirs = game_dirs_for(&profile)?;
    let logs_dir = dirs.instance_dir.join("logs");
    std::fs::create_dir_all(&logs_dir).map_err(|e| e.to_string())?;
    app.opener()
        .open_path(logs_dir.display().to_string(), None::<String>)
        .map_err(|e| e.to_string())
}
