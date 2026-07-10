//! 혜니팩 커맨드 (M4b) — import / 업데이트 체크 / 설치 메타 조회.
//! 업데이트 적용은 렌더러가 download(pack_download_from_worker) + import를 조합한다.

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

/// 워커 다운로드용 토큰: 프로필 config 토큰 1순위, 저장소 최신 토큰 폴백(다운로드는 스코프 무관).
fn resolve_download_token(db: &State<'_, DbState>, game_dir: Option<&std::path::Path>) -> Option<String> {
    if let Some(dir) = game_dir {
        if let Some(t) = hyenimc_launcher::hyeni::read_hyenihelper_token(dir) {
            return Some(t);
        }
    }
    let conn = db.0.lock().unwrap();
    hyenimc_core::hyeni_tokens::any_token(&conn).ok().flatten()
}

/// 설치/게이트 후 config 기록 — 저장소에서 이 game_dir의 servers.dat와 매칭되는 토큰만 기록.
/// 매칭 없으면 false(호출자가 "/인증 필요" 안내). 아무 토큰이나 쓰지 않는다(스펙 §2-1).
pub(crate) fn apply_matching_store_token(db: &State<'_, DbState>, game_dir: &std::path::Path) -> bool {
    let tokens = {
        let conn = db.0.lock().unwrap();
        hyenimc_core::hyeni_tokens::list_tokens(&conn).unwrap_or_default()
    };
    let servers_dat = game_dir.join("servers.dat");
    for t in tokens {
        if t
            .servers
            .iter()
            .any(|s| hyenimc_launcher::hyeni::servers_dat_contains(&servers_dat, s))
        {
            return hyenimc_launcher::hyeni::write_hyenihelper_config(game_dir, &t.token, true)
                .unwrap_or(false);
        }
    }
    false
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

/// 다운로드 가능한 인증 토큰(프로필 무관 — 저장소 기준) 존재 여부. 렌더러 프리플라이트용.
#[tauri::command]
pub fn hyeni_has_any_token(db: State<'_, DbState>) -> Result<bool, String> {
    let conn = db.0.lock().unwrap();
    Ok(hyenimc_core::hyeni_tokens::any_token(&conn).map_err(|e| e.to_string())?.is_some())
}

/// 저장된 인증 토큰 현황(표시 전용) — 토큰 값은 반환하지 않는다.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredTokenInfo {
    pub servers: Vec<String>,
    pub received_at: i64,
}

/// 저장된 인증 토큰 현황(표시 전용) — 토큰 값은 반환하지 않는다.
#[tauri::command]
pub fn hyeni_list_tokens(db: State<'_, DbState>) -> Result<Vec<StoredTokenInfo>, String> {
    let conn = db.0.lock().unwrap();
    let tokens = hyenimc_core::hyeni_tokens::list_tokens(&conn).map_err(|e| e.to_string())?;
    Ok(tokens
        .into_iter()
        .map(|t| StoredTokenInfo {
            servers: t.servers,
            received_at: t.received_at,
        })
        .collect())
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

/// 현재 프로필에 설치된 팩 메타(없으면 null). 팩 프로필 여부 판별 + 현재 버전 표시용.
/// `PackInstallMeta`는 이미 camelCase(hyenipackId, version)로 직렬화되므로 그대로 반환한다.
#[tauri::command]
pub fn pack_get_installed(
    db: State<'_, DbState>,
    profile_id: String,
) -> Result<Option<hyenipack::PackInstallMeta>, String> {
    let profile = load_profile_pub(&db, &profile_id)?;
    let dirs = game_dirs_for(&profile)?;
    Ok(hyenipack::read_pack_meta(&dirs.instance_dir))
}

/// 공개 혜니팩 목록(토큰 불필요).
#[tauri::command]
pub async fn pack_list_available() -> Result<Vec<hyenimc_launcher::hyenipack::PackListItem>, String> {
    let http = reqwest::Client::new();
    hyenimc_launcher::hyenipack::fetch_pack_list(&http, &worker_base()?)
        .await
        .map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackDownloadResult {
    pub path: String,
    pub version: String,
}

/// 팩 최신 버전을 프로필 독립 temp로 다운로드(진행 이벤트 emit). 설치는 렌더러가 기존 import 흐름으로.
#[tauri::command]
pub async fn pack_download_from_worker(
    app: AppHandle,
    db: State<'_, DbState>,
    pack_id: String,
) -> Result<PackDownloadResult, String> {
    let base = worker_base()?;
    let http = reqwest::Client::new();
    let version = hyenimc_launcher::hyenipack::fetch_pack_latest_version(&http, &base, &pack_id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "혜니팩을 찾을 수 없습니다(비공개이거나 존재하지 않음).".to_string())?;
    // 프로필이 아직 없으므로 저장소 토큰만 사용(다운로드는 스코프 무관)
    let token = resolve_download_token(&db, None).ok_or_else(|| {
        "팩 다운로드를 위한 인증이 필요합니다.\n\nDiscord에서 /인증 명령어로 인증하세요.".to_string()
    })?;
    let data_dir = hyenimc_core::paths::legacy_data_dir()
        .ok_or_else(|| "데이터 디렉터리를 결정할 수 없습니다.".to_string())?;
    let dest = data_dir.join(".temp").join(format!("{pack_id}-{version}.hyenipack"));

    let app2 = app.clone();
    let pid = pack_id.clone();
    let mut last_pct: i64 = -1;
    let mut last_bytes: u64 = 0;
    hyenimc_launcher::hyenipack::download_pack_version(
        &http, &base, &pack_id, &version, &token, &dest,
        move |received, total| {
            // 정수 % 변화 시에만 emit(이벤트 폭주 방지).
            // Content-Length 미상이면 256KB 수신마다 emit(percent 0 고정 — 진행 중임은 표시).
            let pct = total.filter(|t| *t > 0).map(|t| (received * 100 / t) as i64);
            let should_emit = match pct {
                Some(p) => p != last_pct,
                None => last_bytes == 0 || received.saturating_sub(last_bytes) >= 262_144,
            };
            if should_emit {
                if let Some(p) = pct { last_pct = p; }
                last_bytes = received.max(1);
                let _ = app2.emit("hyenipack:download-progress", serde_json::json!({
                    "packId": &pid,
                    "percent": pct.unwrap_or(0),
                    "receivedBytes": received,
                    "totalBytes": total,
                }));
            }
        },
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(PackDownloadResult { path: dest.display().to_string(), version })
}

/// 설치 후 토큰 매칭 기록(렌더러가 import 성공 후 호출). true=기록됨.
#[tauri::command]
pub fn hyeni_apply_matching_token(db: State<'_, DbState>, profile_id: String) -> Result<bool, String> {
    let profile = load_profile_pub(&db, &profile_id)?;
    let dirs = game_dirs_for(&profile)?;
    Ok(apply_matching_store_token(&db, &dirs.instance_dir))
}

/// 다운로드 temp 파일 정리 — 데이터 디렉터리의 .temp 하위만 허용(임의 경로 삭제 방지).
#[tauri::command]
pub fn hyeni_remove_temp_file(path: String) -> Result<(), String> {
    let data_dir = hyenimc_core::paths::legacy_data_dir()
        .ok_or_else(|| "데이터 디렉터리를 결정할 수 없습니다.".to_string())?;
    let temp_root = data_dir.join(".temp");
    let p = std::path::Path::new(&path);
    // canonicalize는 파일이 존재해야 하므로, 부모 canonical + 파일명으로 검증
    let canon_parent = p.parent().and_then(|d| d.canonicalize().ok());
    let canon_root = temp_root.canonicalize().ok();
    match (canon_parent, canon_root) {
        (Some(parent), Some(root)) if parent == root => {
            let _ = std::fs::remove_file(p);
            Ok(())
        }
        _ => Err("temp 디렉터리 밖의 파일은 삭제할 수 없습니다.".to_string()),
    }
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
/// - Worker(업데이트 확인 서버) 접근 불가/미설정: `force=false`면 강제 실행 가능 에러(프론트가 확인
///   다이얼로그), `force=true`면 우회.
/// - breaking(호환성 파괴) 업데이트: **force와 무관하게** 하드 차단(팩 업데이트로만 해소).
///   force여도 check_pack_update를 계속 수행해, 강제 실행 순간 서버가 살아있고 breaking이면 여전히 차단.
pub async fn pre_launch_pack_gate(dirs: &GameDirs, force: bool) -> Result<(), String> {
    // 팩 미설치 프로필(바닐라 등)은 게이트 대상 아님
    if hyenipack::read_pack_meta(&dirs.instance_dir).is_none() {
        return Ok(());
    }

    let base = match worker_base() {
        Ok(b) => b,
        // URL 미설정 = 확인 불가 → force면 우회, 아니면 강제 실행 가능 안내
        Err(_) => {
            return if force {
                Ok(())
            } else {
                Err(forceable(
                    "업데이트 서버 주소가 설정되지 않아 팩 최신 여부를 확인할 수 없습니다.\n그대로 실행하면 서버 접속이 안 될 수 있습니다.",
                ))
            };
        }
    };

    let http = reqwest::Client::new();
    match hyenipack::check_pack_update(&http, &base, &dirs.instance_dir).await {
        Ok(None) => Ok(()), // 최신
        // breaking은 강제로도 우회 불가 — 확인된 호환성 파괴는 실행 시 크래시/접속불가로 이어짐
        Ok(Some(update)) if update.breaking => Err(format!(
            "호환성 파괴 업데이트(v{})가 있어 적용 전까지 실행할 수 없습니다. 팩을 업데이트하세요.",
            update.latest_version
        )),
        Ok(Some(_)) => Ok(()), // non-breaking: 배너로 안내(렌더러), 실행 허용
        // 서버 접근 불가 → force면 우회, 아니면 강제 실행 가능 안내
        Err(_) => {
            if force {
                Ok(())
            } else {
                Err(forceable(
                    "업데이트 서버에 연결할 수 없어 팩 최신 여부를 확인하지 못했습니다.\n그대로 실행하면 서버 접속이 안 될 수 있습니다.",
                ))
            }
        }
    }
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}
