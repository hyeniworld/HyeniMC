// HyeniMC Tauri 런처
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod account;
mod commands;
mod crash;
mod game;
mod hyeni;
mod launcher;
mod mods;
mod resources;
mod pack;

use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_deep_link::DeepLinkExt;

fn open_legacy_db() -> Result<hyenimc_core::rusqlite::Connection, String> {
    let data_dir = hyenimc_core::paths::legacy_data_dir()
        .ok_or_else(|| "legacy data dir을 결정할 수 없음".to_string())?;
    let db_path = hyenimc_core::paths::database_path(&data_dir);
    hyenimc_core::open_database(&db_path).map_err(|e| e.to_string())
}

/// DB 상태 — 스파이크/디버그 검증용.
#[tauri::command]
fn db_status(db: tauri::State<commands::DbState>) -> Result<serde_json::Value, String> {
    let conn = db.0.lock().unwrap();
    let version = hyenimc_core::db::schema_version(&conn).map_err(|e| e.to_string())?;
    let profiles = hyenimc_core::list_profiles(&conn).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "schemaVersion": version,
        "profileCount": profiles.len(),
    }))
}

fn main() {
    tauri::Builder::default()
        // single-instance는 가장 먼저 등록 (플러그인 문서 요구사항).
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // Windows/Linux: 두 번째 인스턴스 argv로 딥링크가 들어온다
            for arg in &argv {
                if arg.starts_with("hyenimc://") {
                    hyeni::handle_deep_link(app, arg);
                }
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // hyenimc:// 딥링크 수신 로그 (macOS는 번들 앱에서만 OS 등록됨)
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    hyeni::handle_deep_link(&handle, url.as_str());
                }
            });

            // 기존 DB in-place 접속 — 실패 시 명시적 에러 (silent 초기화 금지)
            let conn = open_legacy_db().map_err(|e| {
                eprintln!("[db] legacy DB open failed: {e}");
                e
            })?;
            app.manage(commands::DbState(Mutex::new(conn)));
            app.manage(game::GameState::default());
            app.manage(resources::WatchState::default());
            app.manage(launcher::PendingUpdate::default());
            app.manage(game::JavaCache::default());

            // 암호화 컨텍스트 (.key / .device_id — 기존 Go 판과 동일 파일)
            let data_dir = hyenimc_core::paths::legacy_data_dir()
                .ok_or("legacy data dir을 결정할 수 없음")?;
            let key = hyenimc_core::crypto::load_or_create_encryption_key(&data_dir)?;
            let device_id = hyenimc_core::crypto::load_or_create_device_id(&data_dir)?;
            app.manage(account::CryptoState { key, device_id });

            println!("[db] legacy DB connected");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db_status,
            commands::profile_list,
            commands::profile_get,
            commands::profile_create,
            commands::profile_update,
            commands::profile_delete,
            commands::profile_toggle_favorite,
            commands::profile_get_stats,
            commands::profile_record_launch,
            commands::profile_record_play_time,
            commands::profile_record_crash,
            commands::settings_get,
            commands::settings_update,
            commands::system_memory,
            commands::system_get_path,
            game::java_detect,
            game::java_get_cached,
            game::version_list_minecraft,
            game::loader_get_versions,
            game::game_download_version,
            game::game_launch,
            game::game_stop,
            game::game_is_running,
            game::game_get_active,
            account::account_list,
            account::account_login_microsoft,
            account::account_refresh,
            account::account_remove,
            pack::hyenipack_import,
            pack::hyenipack_preview,
            pack::pack_check_update,
            pack::pack_apply_update,
            hyeni::worker_mods_check,
            hyeni::worker_mods_install,
            resources::resourcepack_list,
            resources::shaderpack_list,
            resources::file_watch_start,
            resources::file_watch_stop,
            crash::crash_export_report,
            crash::crash_open_logs,
            mods::mod_list,
            mods::mod_toggle,
            mods::mod_remove,
            launcher::launcher_get_version,
            launcher::launcher_check_updates,
            launcher::launcher_download_update,
            launcher::launcher_quit_and_install,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
