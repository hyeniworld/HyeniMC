//! 런처 자체 업데이트 커맨드 (M6) — tauri-plugin-updater 래핑.
//! preload launcher 계약: getVersion / checkForUpdates / downloadUpdate / quitAndInstall.

use std::sync::Mutex;

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

/// 다운로드된 업데이트를 quitAndInstall까지 들고 있기 위한 보관소
#[derive(Default)]
pub struct PendingUpdate(pub Mutex<Option<tauri_plugin_updater::Update>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionResult {
    pub success: bool,
    pub version: String,
}

#[tauri::command]
pub fn launcher_get_version(app: AppHandle) -> VersionResult {
    VersionResult {
        success: true,
        version: app.package_info().version.to_string(),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub success: bool,
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

#[tauri::command]
pub async fn launcher_check_updates(
    app: AppHandle,
    pending: tauri::State<'_, PendingUpdate>,
) -> Result<UpdateCheckResult, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    match updater.check().await {
        Ok(Some(update)) => {
            let result = UpdateCheckResult {
                success: true,
                available: true,
                version: Some(update.version.clone()),
                notes: update.body.clone(),
            };
            *pending.0.lock().unwrap() = Some(update);
            Ok(result)
        }
        Ok(None) => Ok(UpdateCheckResult {
            success: true,
            available: false,
            version: None,
            notes: None,
        }),
        // 업데이트 서버 미구성/네트워크 실패는 "업데이트 없음"으로 완만 처리(개발 중 무해)
        Err(e) => {
            eprintln!("[updater] check 실패: {e}");
            Ok(UpdateCheckResult {
                success: false,
                available: false,
                version: None,
                notes: None,
            })
        }
    }
}

#[tauri::command]
pub async fn launcher_download_update(
    pending: tauri::State<'_, PendingUpdate>,
) -> Result<bool, String> {
    let update = pending.0.lock().unwrap().clone();
    let Some(update) = update else {
        return Err("다운로드할 업데이트가 없습니다 (먼저 확인하세요)".into());
    };
    update
        .download(|_chunk, _total| {}, || {})
        .await
        .map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn launcher_quit_and_install(
    app: AppHandle,
    pending: tauri::State<'_, PendingUpdate>,
) -> Result<(), String> {
    let update = pending.0.lock().unwrap().clone();
    let Some(update) = update else {
        return Err("설치할 업데이트가 없습니다".into());
    };
    // 다운로드 + 설치 (이미 받았으면 즉시 설치)
    let bytes = update
        .download(|_c, _t| {}, || {})
        .await
        .map_err(|e| e.to_string())?;
    update.install(bytes).map_err(|e| e.to_string())?;
    app.restart();
}
