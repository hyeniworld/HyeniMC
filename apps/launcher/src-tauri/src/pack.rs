//! 혜니팩 커맨드 (M4b) — import / 업데이트 체크 / 업데이트 적용.

use std::path::PathBuf;

use tauri::{AppHandle, Emitter, State};

use hyenimc_launcher::hyenipack;
use hyenimc_launcher::install::GameDirs;

use crate::account::CryptoState;
use crate::commands::DbState;
use crate::game::{game_dirs_for, load_profile_pub};

/// Worker base URL — HYENIMC_WORKER_URL env 또는 빌드 시 주입. 미설정이면 명시적 에러.
pub fn worker_base() -> Result<String, String> {
    std::env::var("HYENIMC_WORKER_URL")
        .ok()
        .filter(|v| !v.is_empty())
        .or_else(|| {
            option_env!("HYENIMC_WORKER_URL")
                .filter(|v| !v.is_empty())
                .map(String::from)
        })
        .ok_or_else(|| "HYENIMC_WORKER_URL이 설정되지 않았습니다 (.env 또는 환경변수)".to_string())
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
    let cfg = crate::game::download_config(&settings);

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
            // 혜니팩 설치는 전용 이벤트로 진행률을 보낸다(전역 game 다운로드 모달이 아니라
            // HyeniPackImportTab 인라인 진행률이 소비). download:progress를 쓰면 전역 모달이 떠서
            // 완료 시 닫히지 않는 문제가 있었음.
            let percent = if p.total > 0 {
                (p.completed as f64 / p.total as f64) * 100.0
            } else {
                0.0
            };
            let _ = app.emit(
                "hyenipack:import-progress",
                serde_json::json!({
                    "profileId": pid,
                    "stage": p.stage,
                    "completed": p.completed,
                    "total": p.total,
                    "percent": percent
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

/// 팩 미리보기 — 설치 없이 매니페스트만 읽기 (preload hyenipack.preview 대응)
#[tauri::command]
pub fn hyenipack_preview(file_path: String) -> Result<hyenipack::PackManifest, String> {
    hyenipack::read_manifest_from_zip(&PathBuf::from(&file_path)).map_err(|e| e.to_string())
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
    hyenipack::check_pack_update(&http, &worker_base()?, &dirs.instance_dir)
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

    let update = hyenipack::check_pack_update(&http, &worker_base()?, &dirs.instance_dir)
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
        &worker_base()?,
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
/// game_launch가 반환하는 "강제 실행 가능" 에러 접두사. 프론트가 이 접두사를 감지하면
/// 안내 + [강제 실행]/[닫기] 확인 다이얼로그를 띄우고, 강제 시 force=true로 재실행한다.
pub const FORCE_MARKER: &str = "FORCE_LAUNCH_AVAILABLE:";

/// 강제 실행 가능한(= 업데이트 서버 접근 불가) 실패 메시지를 마커와 함께 만든다.
pub fn forceable(msg: &str) -> String {
    format!("{FORCE_MARKER}{msg}")
}

/// 실행 전 혜니팩 게이트.
/// - `force=true`: 사용자가 강제 실행 선택 → 게이트 우회.
/// - Worker(업데이트 확인 서버) 접근 불가/미설정: 강제 실행 가능 에러(프론트가 확인 다이얼로그).
/// - breaking(호환성 파괴) 업데이트: 강제 불가 하드 차단(팩 업데이트로만 해소).
pub async fn pre_launch_pack_gate(dirs: &GameDirs, force: bool) -> Result<(), String> {
    // 팩 미설치 프로필(바닐라 등)은 게이트 대상 아님
    if hyenipack::read_pack_meta(&dirs.instance_dir).is_none() {
        return Ok(());
    }
    if force {
        return Ok(()); // 사용자가 강제 실행 선택
    }

    let base = match worker_base() {
        Ok(b) => b,
        Err(_) => {
            return Err(forceable(
                "업데이트 서버 주소가 설정되지 않아 팩 최신 여부를 확인할 수 없습니다.\n그대로 실행하면 서버 접속이 안 될 수 있습니다.",
            ));
        }
    };

    let http = reqwest::Client::new();
    match hyenipack::check_pack_update(&http, &base, &dirs.instance_dir).await {
        Ok(None) => Ok(()), // 최신
        Ok(Some(update)) if update.breaking => Err(format!(
            "호환성 파괴 업데이트(v{})가 있어 적용 전까지 실행할 수 없습니다. 팩을 업데이트하세요.",
            update.latest_version
        )),
        Ok(Some(_)) => Ok(()), // non-breaking: 배너로 안내(렌더러), 실행 허용
        // 서버 접근 불가 → 강제 실행 가능(사용자 선택)
        Err(_) => Err(forceable(
            "업데이트 서버에 연결할 수 없어 팩 최신 여부를 확인하지 못했습니다.\n그대로 실행하면 서버 접속이 안 될 수 있습니다.",
        )),
    }
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}
