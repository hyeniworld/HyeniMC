//! 런처 자체 업데이트 커맨드 (M6) — tauri-plugin-updater 래핑.
//! preload launcher 계약: getVersion / checkForUpdates / downloadUpdate / quitAndInstall.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;

use crate::util::cmd_err;

/// 다운로드된 업데이트를 quitAndInstall까지 들고 있기 위한 보관소
#[derive(Default)]
pub struct PendingUpdate {
    pub update: Mutex<Option<tauri_plugin_updater::Update>>,
    /// 자동 다운로드를 이미 시작/완료한 버전 — 4시간마다 재확인 시 같은 버전 재다운로드 방지
    pub auto_downloaded: Mutex<Option<String>>,
}

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
    db: tauri::State<'_, crate::commands::DbState>,
) -> Result<UpdateCheckResult, String> {
    let current = app.package_info().version.to_string();
    let updater = app.updater().map_err(cmd_err("launcher_check_updates"))?;
    match updater.check().await {
        Ok(Some(update)) => {
            let version = update.version.clone();
            let notes = update.body.clone();
            // 설정의 '자동 다운로드'가 켜져 있으면 업데이트 발견 즉시 자동 다운로드(Electron autoUpdater 동일)
            let auto_download = {
                let conn = db.0.lock().unwrap();
                hyenimc_core::settings::get_settings(&conn)
                    .map(|s| s.update.auto_download)
                    .unwrap_or(false)
            };
            *pending.update.lock().unwrap() = Some(update.clone());
            // useLauncherUpdate 훅은 반환값이 아니라 이벤트로 배너를 띄운다(Electron autoUpdater와 동일).
            let _ = app.emit(
                "launcher:update-available",
                serde_json::json!({
                    "version": version,
                    "releaseNotes": notes.clone().unwrap_or_default(),
                    "releaseDate": "",
                    "required": false,
                }),
            );
            // 같은 버전을 이미 자동 다운로드했으면 재확인(4시간 주기)마다 다시 받지 않는다.
            if auto_download
                && pending.auto_downloaded.lock().unwrap().as_deref() != Some(version.as_str())
            {
                *pending.auto_downloaded.lock().unwrap() = Some(version.clone());
                let app2 = app.clone();
                let ver = version.clone();
                tauri::async_runtime::spawn(async move {
                    if run_download(&app2, &update).await.is_err() {
                        // 실패 시 다음 체크에서 재시도할 수 있게 표식 해제
                        if let Some(p) = app2.try_state::<PendingUpdate>() {
                            let mut g = p.auto_downloaded.lock().unwrap();
                            if g.as_deref() == Some(ver.as_str()) {
                                *g = None;
                            }
                        }
                    }
                });
            }
            Ok(UpdateCheckResult { success: true, available: true, version: Some(version), notes })
        }
        Ok(None) => {
            let _ = app.emit("launcher:update-not-available", serde_json::json!({ "version": current }));
            Ok(UpdateCheckResult { success: true, available: false, version: None, notes: None })
        }
        // 아직 릴리스가 없으면 GitHub Releases의 latest.json이 404 → 여기로 온다.
        // 정상 상황(업데이트 없음)이므로 조용히 처리(에러 배너 대신 not-available) — 릴리스가 올라오면 자동 동작.
        Err(_) => {
            let _ = app.emit("launcher:update-not-available", serde_json::json!({ "version": current }));
            Ok(UpdateCheckResult { success: true, available: false, version: None, notes: None })
        }
    }
}

/// 업데이트 다운로드 + 진행률/완료/에러 이벤트 발행 (수동 다운로드·자동 다운로드 공용).
async fn run_download(app: &AppHandle, update: &tauri_plugin_updater::Update) -> Result<(), String> {
    let version = update.version.clone();
    // 진행률 이벤트(launcher:download-progress) — 퍼센트 정수가 바뀔 때만 발행(과다 emit 방지).
    let transferred = Arc::new(AtomicU64::new(0));
    let last_pct = Arc::new(AtomicU64::new(u64::MAX));
    let started = Instant::now();
    let app_cb = app.clone();
    let result = update
        .download(
            move |chunk, total| {
                let t = transferred.fetch_add(chunk as u64, Ordering::Relaxed) + chunk as u64;
                let total = total.unwrap_or(0);
                let percent = if total > 0 { (t * 100 / total).min(100) } else { 0 };
                if last_pct.swap(percent, Ordering::Relaxed) == percent {
                    return;
                }
                let elapsed = started.elapsed().as_secs_f64().max(0.001);
                let bps = (t as f64 / elapsed) as u64;
                let _ = app_cb.emit(
                    "launcher:download-progress",
                    serde_json::json!({
                        "percent": percent,
                        "bytesPerSecond": bps,
                        "transferred": t,
                        "total": total,
                    }),
                );
            },
            || {},
        )
        .await;

    match result {
        Ok(_) => {
            let _ = app.emit("launcher:update-downloaded", serde_json::json!({ "version": version }));
            Ok(())
        }
        Err(e) => {
            let msg = e.to_string();
            let _ = app.emit("launcher:update-error", serde_json::json!({ "message": msg.clone() }));
            Err(msg)
        }
    }
}

#[tauri::command]
pub async fn launcher_download_update(
    app: AppHandle,
    pending: tauri::State<'_, PendingUpdate>,
) -> Result<bool, String> {
    let update = pending.update.lock().unwrap().clone();
    let Some(update) = update else {
        return Err("다운로드할 업데이트가 없습니다 (먼저 확인하세요)".into());
    };
    run_download(&app, &update).await?;
    Ok(true)
}

#[tauri::command]
pub async fn launcher_quit_and_install(
    app: AppHandle,
    pending: tauri::State<'_, PendingUpdate>,
) -> Result<(), String> {
    let update = pending.update.lock().unwrap().clone();
    let Some(update) = update else {
        return Err("설치할 업데이트가 없습니다".into());
    };
    // 다운로드 + 설치 (이미 받았으면 즉시 설치)
    let bytes = update
        .download(|_c, _t| {}, || {})
        .await
        .map_err(cmd_err("launcher_quit_and_install"))?;
    update.install(bytes).map_err(cmd_err("launcher_quit_and_install"))?;
    app.restart();
}
