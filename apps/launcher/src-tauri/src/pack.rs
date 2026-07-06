//! 혜니팩 커맨드 (M4b) — import / 업데이트 체크 / 업데이트 적용.

use std::path::PathBuf;

use tauri::{AppHandle, Emitter, State};

use hyenimc_launcher::hyenipack;
use hyenimc_launcher::install::GameDirs;

use crate::account::CryptoState;
use crate::commands::DbState;
use crate::game::{game_dirs_for, load_profile_pub};

/// Worker base URL — HYENIMC_WORKER_URL env, 없으면 컴파일 상수(배포 시 주입).
pub fn worker_base() -> String {
    std::env::var("HYENIMC_WORKER_URL")
        .ok()
        .filter(|v| !v.is_empty())
        .or_else(|| option_env!("HYENIMC_WORKER_URL").map(String::from))
        .unwrap_or_else(|| "https://worker.hyeniworld.invalid".into())
}

fn download_cfg(settings: &hyenimc_core::settings::GlobalSettings) -> hyenimc_launcher::download::DownloadConfig {
    hyenimc_launcher::download::DownloadConfig {
        max_parallel: settings.download.max_parallel.max(1) as usize,
        max_retries: settings.download.max_retries.max(0) as u32,
        timeout: std::time::Duration::from_millis(settings.download.request_timeout_ms.max(1000) as u64),
        retry_base_ms: 1000,
    }
}

/// 로컬 .hyenipack import — 모드 동기화 + overrides + 프로필 버전/로더 반영.
#[tauri::command]
pub async fn hyenipack_import(
    app: AppHandle,
    db: State<'_, DbState>,
    profile_id: String,
    file_path: String,
    account_id: Option<String>,
    crypto: State<'_, CryptoState>,
) -> Result<(), String> {
    let (profile, settings) = {
        let p = load_profile_pub(&db, &profile_id)?;
        let s = hyenimc_core::settings::get_settings(&db.0.lock().unwrap()).map_err(|e| e.to_string())?;
        (p, s)
    };
    let dirs = game_dirs_for(&profile)?;
    let cfg = download_cfg(&settings);

    // CF 프록시용 토큰 (계정 있으면)
    let token = match &account_id {
        Some(aid) => crate::account::get_valid_tokens(&db, &crypto, aid)
            .await
            .ok()
            .map(|t| t.access_token),
        None => None,
    };

    let http = reqwest::Client::new();
    let pid = profile_id.clone();
    let manifest = hyenipack::install_pack(
        &http,
        &PathBuf::from(&file_path),
        &dirs,
        &cfg,
        token.as_deref(),
        move |p| {
            let _ = app.emit(
                "download:progress",
                serde_json::json!({
                    "profileId": pid, "phase": p.stage,
                    "completed": p.completed, "total": p.total, "currentFile": ""
                }),
            );
        },
    )
    .await
    .map_err(|e| e.to_string())?;

    // 프로필 게임/로더 버전 반영 (다음 실행 시 로더 설치)
    let patch = hyenimc_core::profile::ProfilePatch {
        game_version: Some(manifest.minecraft.version.clone()),
        loader_type: Some(manifest.minecraft.loader_type.clone()),
        loader_version: Some(manifest.minecraft.loader_version.clone()),
        ..Default::default()
    };
    let now = now_secs();
    hyenimc_core::profile::update_profile(&db.0.lock().unwrap(), &profile_id, &patch, now)
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 팩 업데이트 확인 (없으면 null, 네트워크 실패는 에러)
#[tauri::command]
pub async fn pack_check_update(
    db: State<'_, DbState>,
    profile_id: String,
) -> Result<Option<hyenipack::PackUpdate>, String> {
    let profile = load_profile_pub(&db, &profile_id)?;
    let dirs = game_dirs_for(&profile)?;
    let http = reqwest::Client::new();
    hyenipack::check_pack_update(&http, &worker_base(), &dirs.instance_dir)
        .await
        .map_err(|e| e.to_string())
}

/// 팩 업데이트 적용 — 최신 버전 다운로드 후 재설치(동일 sync 로직).
#[tauri::command]
pub async fn pack_apply_update(
    app: AppHandle,
    db: State<'_, DbState>,
    crypto: State<'_, CryptoState>,
    profile_id: String,
    account_id: Option<String>,
) -> Result<(), String> {
    let profile = load_profile_pub(&db, &profile_id)?;
    let dirs = game_dirs_for(&profile)?;
    let http = reqwest::Client::new();

    let update = hyenipack::check_pack_update(&http, &worker_base(), &dirs.instance_dir)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "적용할 업데이트가 없습니다".to_string())?;

    // 토큰 필수 (다운로드 인증)
    let aid = account_id.ok_or_else(|| "업데이트 다운로드에 로그인이 필요합니다".to_string())?;
    let token = crate::account::get_valid_tokens(&db, &crypto, &aid).await?.access_token;

    let temp = dirs.instance_dir.join(".temp").join(format!(
        "{}-{}.hyenipack",
        update.hyenipack_id, update.latest_version
    ));
    hyenipack::download_pack_version(
        &http,
        &worker_base(),
        &update.hyenipack_id,
        &update.latest_version,
        &token,
        &temp,
    )
    .await
    .map_err(|e| e.to_string())?;

    // 재사용: import 흐름
    hyenipack_import(
        app,
        db,
        profile_id,
        temp.display().to_string(),
        Some(aid),
        crypto,
    )
    .await?;
    let _ = std::fs::remove_file(&temp);
    Ok(())
}

/// 실행 전 팩 게이트 (game_launch 내부 호출).
/// Ok(()) = 실행 허용, Err = 차단(이유 포함).
pub async fn pre_launch_pack_gate(
    dirs: &GameDirs,
    settings: &hyenimc_core::settings::GlobalSettings,
) -> Result<(), String> {
    let http = reqwest::Client::new();
    match hyenipack::check_pack_update(&http, &worker_base(), &dirs.instance_dir).await {
        Ok(None) => Ok(()), // 최신
        Ok(Some(update)) if update.breaking => Err(format!(
            "호환성 파괴 업데이트(v{})가 있어 적용 전까지 실행할 수 없습니다. 팩을 업데이트하세요.",
            update.latest_version
        )),
        Ok(Some(_)) => Ok(()), // non-breaking: 배너로 안내(렌더러), 실행 허용
        Err(_) => {
            // 서버 접근 불가
            if read_pack_installed(dirs) && !settings.advanced.force_launch {
                Err("업데이트 서버에 연결할 수 없습니다. 설정에서 '강제 실행'을 켜거나 잠시 후 다시 시도하세요."
                    .into())
            } else {
                Ok(())
            }
        }
    }
}

fn read_pack_installed(dirs: &GameDirs) -> bool {
    hyenipack::read_pack_meta(&dirs.instance_dir).is_some()
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}
