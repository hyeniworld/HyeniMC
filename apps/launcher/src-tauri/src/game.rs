//! 게임 실행/설치 커맨드 (M2b) — 기존 game.ts IPC 핸들러 대응.
//! 이벤트: download:progress / game:log / game:started / game:stopped (기존 렌더러 리스너와 동일 이름)

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Instant;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use hyenimc_launcher::download::DownloadConfig;
use hyenimc_launcher::install::{ensure_version, native_jars_for, GameDirs};
use hyenimc_launcher::launch::{build_arguments, build_classpath, spawn_game, GameHandle, LaunchSpec};
use hyenimc_launcher::manifest::{VersionManifest, VERSION_MANIFEST_URL};

use crate::commands::DbState;

struct RunningEntry {
    version_id: String,
    handle: Option<GameHandle>,
    started_at: Instant,
}

#[derive(Default)]
pub struct GameState {
    running: Mutex<HashMap<String, RunningEntry>>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ActiveGame {
    pub profile_id: String,
    pub version_id: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VersionEntry {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
}

fn game_dirs_for(profile: &hyenimc_core::Profile) -> Result<GameDirs, String> {
    let user_data = hyenimc_core::paths::legacy_user_data_dir()
        .ok_or_else(|| "userData 경로를 결정할 수 없음".to_string())?;
    Ok(GameDirs {
        instance_dir: std::path::PathBuf::from(&profile.game_directory),
        shared_libraries: user_data.join("shared/libraries"),
        shared_assets: user_data.join("shared/assets"),
    })
}

fn load_profile(db: &State<'_, DbState>, profile_id: &str) -> Result<hyenimc_core::Profile, String> {
    hyenimc_core::profile::get_profile(&db.0.lock().unwrap(), profile_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("프로필 없음: {profile_id}"))
}

fn download_config(settings: &hyenimc_core::settings::GlobalSettings) -> DownloadConfig {
    DownloadConfig {
        max_parallel: settings.download.max_parallel.max(1) as usize,
        max_retries: settings.download.max_retries.max(0) as u32,
        timeout: std::time::Duration::from_millis(settings.download.request_timeout_ms.max(1000) as u64),
        retry_base_ms: 1000,
    }
}

async fn resolve_version_url(
    http: &reqwest::Client,
    version_id: &str,
) -> Result<Option<String>, String> {
    let manifest: VersionManifest = http
        .get(VERSION_MANIFEST_URL)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    Ok(manifest
        .versions
        .into_iter()
        .find(|v| v.id == version_id)
        .map(|v| v.url))
}

/// 버전 설치 (버전 json이 이미 있으면 URL 조회 생략 — 오프라인 재실행 허용)
async fn ensure_profile_version(
    app: &AppHandle,
    profile: &hyenimc_core::Profile,
    dirs: &GameDirs,
    cfg: &DownloadConfig,
) -> Result<hyenimc_launcher::manifest::VersionDetail, String> {
    let http = reqwest::Client::new();
    let version_id = profile.game_version.clone();
    let url = if dirs.version_json(&version_id).exists() {
        None
    } else {
        let u = resolve_version_url(&http, &version_id)
            .await?
            .ok_or_else(|| format!("매니페스트에 없는 버전: {version_id}"))?;
        Some(u)
    };
    let app2 = app.clone();
    let profile_id = profile.id.clone();
    let detail = ensure_version(&http, url.as_deref(), &version_id, dirs, cfg, move |p| {
        let _ = app2.emit(
            "download:progress",
            serde_json::json!({
                "profileId": profile_id,
                "phase": p.phase,
                "completed": p.completed,
                "total": p.total,
                "currentFile": p.current_file,
            }),
        );
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(detail)
}

#[tauri::command]
pub async fn java_detect() -> Vec<hyenimc_launcher::java::JavaInstallation> {
    hyenimc_launcher::java::detect_java_installations().await
}

#[tauri::command]
pub async fn version_list_minecraft() -> Result<Vec<VersionEntry>, String> {
    let http = reqwest::Client::new();
    let manifest: VersionManifest = http
        .get(VERSION_MANIFEST_URL)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    Ok(manifest
        .versions
        .into_iter()
        .map(|v| VersionEntry { id: v.id, kind: v.kind })
        .collect())
}

#[tauri::command]
pub async fn game_download_version(
    app: AppHandle,
    db: State<'_, DbState>,
    profile_id: String,
) -> Result<(), String> {
    let (profile, settings) = {
        let p = load_profile(&db, &profile_id)?;
        let s = hyenimc_core::settings::get_settings(&db.0.lock().unwrap()).map_err(|e| e.to_string())?;
        (p, s)
    };
    let dirs = game_dirs_for(&profile)?;
    let cfg = download_config(&settings);
    ensure_profile_version(&app, &profile, &dirs, &cfg).await?;
    Ok(())
}

#[tauri::command]
pub async fn game_launch(
    app: AppHandle,
    db: State<'_, DbState>,
    game_state: State<'_, GameState>,
    crypto: State<'_, crate::account::CryptoState>,
    profile_id: String,
    account_id: Option<String>,
) -> Result<(), String> {
    if game_state.running.lock().unwrap().contains_key(&profile_id) {
        return Err(format!("프로필 {profile_id}이(가) 이미 실행 중입니다"));
    }

    let (profile, settings) = {
        let p = load_profile(&db, &profile_id)?;
        let s = hyenimc_core::settings::get_settings(&db.0.lock().unwrap()).map_err(|e| e.to_string())?;
        (p, s)
    };
    let dirs = game_dirs_for(&profile)?;
    let cfg = download_config(&settings);

    // ① 설치 보장 (이미 설치면 SHA1 스킵으로 빠르게 통과)
    let detail = ensure_profile_version(&app, &profile, &dirs, &cfg).await?;

    // ② Java 결정: 프로필 오버라이드 → 전역 설정 → 자동 감지 최상위
    let java_path = profile
        .java_path
        .clone()
        .filter(|p| !p.is_empty())
        .or_else(|| {
            let p = settings.java.java_path.clone();
            (!p.is_empty()).then_some(p)
        });
    let java_path = match java_path {
        Some(p) => p,
        None => hyenimc_launcher::java::detect_java_installations()
            .await
            .first()
            .map(|j| j.path.clone())
            .ok_or_else(|| "Java를 찾을 수 없습니다. 설정에서 Java 경로를 지정하세요.".to_string())?,
    };

    // ③ natives + classpath + 인자
    let version_id = profile.game_version.clone();
    let native_jars = native_jars_for(&detail, &dirs);
    let natives_dir = hyenimc_launcher::natives::extract_natives(&dirs.version_dir(&version_id), &native_jars)
        .map_err(|e| e.to_string())?;
    let (classpath, missing) = build_classpath(&detail, &dirs);
    if !missing.is_empty() {
        eprintln!("[game] 누락 라이브러리 {}개: {:?}", missing.len(), missing);
    }

    // 계정: account_id가 있으면 실계정(만료 임박 시 자동 갱신), 없으면 더미
    let (username, uuid, access_token, user_type) = match &account_id {
        Some(aid) => {
            let tokens = crate::account::get_valid_tokens(&db, &crypto, aid).await?;
            let account = {
                let conn = db.0.lock().unwrap();
                hyenimc_core::account::get_account(&conn, aid)
                    .map_err(|e| e.to_string())?
                    .ok_or_else(|| format!("계정 없음: {aid}"))?
            };
            (account.name, account.uuid, Some(tokens.access_token), Some("msa".to_string()))
        }
        None => (
            "Player".to_string(),
            "00000000-0000-0000-0000-000000000000".to_string(),
            None,
            None,
        ),
    };

    let spec = LaunchSpec {
        profile_id: profile_id.clone(),
        version_id: version_id.clone(),
        java_path: java_path.clone(),
        min_memory_mb: profile.memory_min.unwrap_or(settings.java.memory_min).max(1) as u32,
        max_memory_mb: profile.memory_max.unwrap_or(settings.java.memory_max).max(1) as u32,
        username,
        uuid,
        access_token,
        user_type,
        resolution: Some((
            profile.resolution_width.unwrap_or(settings.resolution.width).max(1) as u32,
            profile.resolution_height.unwrap_or(settings.resolution.height).max(1) as u32,
        )),
        fullscreen: profile.fullscreen.unwrap_or(settings.resolution.fullscreen),
    };
    let args = build_arguments(&detail, &spec, &dirs, &natives_dir, &classpath)
        .map_err(|e| e.to_string())?;

    // ④ 통계 + spawn + 이벤트
    hyenimc_core::stats::record_launch(&db.0.lock().unwrap(), &profile_id, now_secs())
        .map_err(|e| e.to_string())?;

    let app_log = app.clone();
    let pid_for_log = profile_id.clone();
    let app_exit = app.clone();
    let pid_for_exit = profile_id.clone();
    let started_at = Instant::now();

    let handle = spawn_game(
        &java_path,
        &args,
        &dirs.instance_dir,
        move |line| {
            let _ = app_log.emit(
                "game:log",
                serde_json::json!({ "profileId": pid_for_log, "line": line }),
            );
        },
        move |code| {
            // 종료: 상태 정리 + 플레이타임/크래시 기록 + 이벤트
            let elapsed = started_at.elapsed().as_secs() as i64;
            let db = app_exit.state::<DbState>();
            if elapsed > 0 {
                let _ = hyenimc_core::stats::record_play_time(
                    &db.0.lock().unwrap(),
                    &pid_for_exit,
                    elapsed,
                );
            }
            if matches!(code, Some(c) if c != 0) {
                let _ = hyenimc_core::stats::record_crash(
                    &db.0.lock().unwrap(),
                    &pid_for_exit,
                    now_secs(),
                );
            }
            let gs = app_exit.state::<GameState>();
            gs.running.lock().unwrap().remove(&pid_for_exit);
            let _ = app_exit.emit(
                "game:stopped",
                serde_json::json!({ "profileId": pid_for_exit, "versionId": pid_for_exit, "code": code }),
            );
        },
    )
    .await
    .map_err(|e| e.to_string())?;

    game_state.running.lock().unwrap().insert(
        profile_id.clone(),
        RunningEntry {
            version_id: version_id.clone(),
            handle: Some(handle),
            started_at,
        },
    );
    let _ = app.emit(
        "game:started",
        serde_json::json!({ "profileId": profile_id, "versionId": version_id }),
    );
    Ok(())
}

#[tauri::command]
pub fn game_stop(game_state: State<'_, GameState>, profile_id: String) -> Result<bool, String> {
    let mut running = game_state.running.lock().unwrap();
    if let Some(entry) = running.get_mut(&profile_id) {
        if let Some(handle) = entry.handle.take() {
            handle.kill();
            return Ok(true);
        }
    }
    Ok(false)
}

#[tauri::command]
pub fn game_is_running(game_state: State<'_, GameState>, profile_id: String) -> bool {
    game_state.running.lock().unwrap().contains_key(&profile_id)
}

#[tauri::command]
pub fn game_get_active(game_state: State<'_, GameState>) -> Vec<ActiveGame> {
    game_state
        .running
        .lock()
        .unwrap()
        .iter()
        .map(|(pid, entry)| ActiveGame {
            profile_id: pid.clone(),
            version_id: entry.version_id.clone(),
        })
        .collect()
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}
