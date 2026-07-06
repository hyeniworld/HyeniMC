// HyeniMC Tauri 런처 (M0 스파이크)
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri_plugin_deep_link::DeepLinkExt;

/// 프로필 목록 — 기존 Electron 판 DB를 그대로 읽는다 (in-place 호환).
#[tauri::command]
fn get_profiles() -> Result<Vec<hyenimc_core::Profile>, String> {
    let conn = open_legacy_db()?;
    hyenimc_core::list_profiles(&conn).map_err(|e| e.to_string())
}

/// DB 상태 — M0 스파이크 검증용.
#[tauri::command]
fn db_status() -> Result<serde_json::Value, String> {
    let data_dir = hyenimc_core::paths::legacy_data_dir()
        .ok_or_else(|| "legacy data dir을 결정할 수 없음".to_string())?;
    let db_path = hyenimc_core::paths::database_path(&data_dir);
    let conn = hyenimc_core::open_database(&db_path).map_err(|e| e.to_string())?;
    let version = hyenimc_core::db::schema_version(&conn).map_err(|e| e.to_string())?;
    let profiles = hyenimc_core::list_profiles(&conn).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "dbPath": db_path.display().to_string(),
        "schemaVersion": version,
        "profileCount": profiles.len(),
    }))
}

fn open_legacy_db() -> Result<hyenimc_core::rusqlite::Connection, String> {
    let data_dir = hyenimc_core::paths::legacy_data_dir()
        .ok_or_else(|| "legacy data dir을 결정할 수 없음".to_string())?;
    let db_path = hyenimc_core::paths::database_path(&data_dir);
    hyenimc_core::open_database(&db_path).map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        // single-instance는 가장 먼저 등록 (플러그인 문서 요구사항).
        // 두 번째 인스턴스의 argv로 딥링크가 들어오는 Windows/Linux 경로를 로그로 확인.
        .plugin(tauri_plugin_single_instance::init(|_app, argv, _cwd| {
            println!("[single-instance] second instance argv: {argv:?}");
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            // hyenimc:// 딥링크 수신 로그 (macOS는 번들 앱에서만 OS 등록됨 — M0 메모)
            app.deep_link().on_open_url(|event| {
                println!("[deep-link] received: {:?}", event.urls());
            });

            // M0 검증: 기존 DB in-place 읽기
            match db_status() {
                Ok(status) => println!("[db] legacy DB OK: {status}"),
                Err(e) => eprintln!("[db] legacy DB unavailable: {e}"),
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_profiles, db_status])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
