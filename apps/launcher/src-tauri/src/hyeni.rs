//! 혜니월드 통합 커맨드 (M5) — worker mods + 딥링크 인증.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Emitter, Manager};

use hyenimc_launcher::hyeni as hy;
use hyenimc_launcher::workermods;

use crate::commands::DbState;

/// 승인 서버 도메인 (기존 shared/config/server-config.ts와 동일)
const AUTHORIZED_DOMAINS: [&str; 2] = ["*.devbug.ing", "*.devbug.me"];

/// 와일드카드 도메인 매칭 — `*.devbug.ing`은 서브도메인 및 루트 도메인 자체도 허용
pub fn is_authorized_server(address: &str) -> bool {
    let host = address.to_lowercase();
    let host = host.split(':').next().unwrap_or(&host);
    AUTHORIZED_DOMAINS.iter().any(|pattern| {
        if let Some(root) = pattern.strip_prefix("*.") {
            host == root || host.ends_with(&format!(".{root}"))
        } else {
            host == *pattern
        }
    })
}

/// 트리거 판정 — 프로필 serverAddress 우선, 없으면 servers.dat에 승인 서버 존재 여부(TS 우선순위)
pub fn should_check(profile_dir: &Path, server_address: Option<&str>) -> bool {
    match server_address {
        Some(addr) if !addr.is_empty() => is_authorized_server(addr),
        _ => hy::servers_dat_ips(&profile_dir.join("servers.dat"))
            .iter()
            .any(|ip| is_authorized_server(ip)),
    }
}

#[tauri::command]
pub async fn worker_mods_check(
    profile_path: String,
    game_version: String,
    loader_type: String,
    loader_version: String,
    server_address: Option<String>,
) -> Result<Vec<workermods::WorkerModUpdate>, String> {
    let profile_dir = PathBuf::from(&profile_path);
    // 기설치 워커 모드는 서버와 무관하게 항상 업데이트 확인(서버 미등록 시 구버전 방치 방지).
    // 신규(미설치) 모드는 인증 서버일 때만 — has_authorized_server로 check_all_updates에 위임.
    // 수동 패널은 Electron checkAllModUpdates와 동일하게 프로필 serverAddress만 보고
    // servers.dat 폴백은 하지 않는다(pre-launch 게이트와 다름).
    let has_authorized_server = server_address
        .as_deref()
        .is_some_and(|s| !s.is_empty() && is_authorized_server(s));
    let base = crate::pack::worker_base()?;
    let http = reqwest::Client::new();
    // check_all_updates 자체는 로더 필터를 하지 않고(각 update에 min/max 실음),
    // 아래에서 resolve로 최종 loader_version을 정한 뒤 retain_loader_compatible로 필터한다.
    let updates = workermods::check_all_updates(
        &http,
        &base,
        &profile_dir.join("mods"),
        &game_version,
        &loader_type,
        false, // include_all=false — 수동 패널은 게이트 적용(Electron checkAllModUpdates)
        has_authorized_server,
    )
    .await
    .map_err(|e| e.to_string())?;

    // 로더 호환 판단 → 최종 loader_version 결정. 실제 로더 설치/프로필 반영은 게임 실행(game.rs)이 수행하고,
    // 여기서는 표시 일관성을 위해 최종 loader_version 기준으로 필터 + required_loader_version 스탬프만 한다.
    let bump = match workermods::resolve_loader_for_updates(
        &http,
        &loader_type,
        &game_version,
        &loader_version,
        &updates,
    )
    .await
    {
        Ok(b) => b,
        Err(e) => {
            log::warn!("업데이트 패널 로더 해석 실패(무시): {e}");
            None
        }
    };
    // 상향으로도 범위를 못 맞춘 모드(현재 로더가 max 초과 → 다운그레이드 회피)는 game.rs 설치 경로와
    // 동일하게 목록에서 제외해 표시를 일치시킨다.
    let final_loader = bump
        .as_ref()
        .map(|b| b.version.clone())
        .unwrap_or_else(|| loader_version.clone());
    let mut updates = workermods::retain_loader_compatible(updates, &loader_type, &game_version, &final_loader);
    if let Some(b) = &bump {
        for u in &mut updates {
            u.required_loader_version = Some(b.version.clone());
        }
    }

    Ok(updates)
}

#[tauri::command]
pub async fn worker_mods_install(
    app: AppHandle,
    profile_path: String,
    updates: Vec<workermods::WorkerModUpdate>,
) -> Result<Vec<workermods::InstallResult>, String> {
    let base = crate::pack::worker_base()?;
    let profile_dir = PathBuf::from(&profile_path);

    // 다운로드 인증 토큰 = HyeniHelper config 토큰(딥링크 /인증). game_launch·Electron과 동일 출처.
    // (기존엔 MS 계정 access_token을 보내 Worker가 401로 거부 — 오이식 수정.
    //  Worker /download/v2는 config token을 TOKEN_CHECK_API_URL 화이트리스트로 검증한다.)
    let token = hy::read_hyenihelper_token(&profile_dir).ok_or_else(|| {
        "모드 업데이트를 위한 인증이 필요합니다.\n\nDiscord에서 /인증 명령어로 인증하세요.".to_string()
    })?;

    let settings = {
        let db = app.state::<DbState>();
        let conn = db.0.lock().unwrap();
        hyenimc_core::settings::get_settings(&conn).map_err(|e| e.to_string())?
    };
    let cfg = crate::game::download_config(&settings);
    let http = reqwest::Client::new();

    let app2 = app.clone();
    let results = workermods::install_updates(
        &http,
        &base,
        &PathBuf::from(&profile_path).join("mods"),
        &updates,
        &token,
        &cfg,
        move |mod_id, progress| {
            let _ = app2.emit(
                "worker-mods:install-progress",
                serde_json::json!({ "modId": mod_id, "progress": progress }),
            );
        },
    )
    .await
    .map_err(|e| e.to_string())?;

    let _ = app.emit(
        "worker-mods:update-complete",
        serde_json::json!({ "results": results }),
    );
    Ok(results)
}

/// hyenimc:// 딥링크 처리 — main.rs의 on_open_url/single-instance에서 호출.
pub fn handle_deep_link(app: &AppHandle, url: &str) {
    let Some((token, servers)) = hy::parse_auth_url(url) else {
        if url.starts_with("hyenimc://") {
            let _ = app.emit(
                "auth:error",
                serde_json::json!({ "message": "잘못된 인증 링크입니다" }),
            );
        }
        return;
    };
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        match apply_auth(&app, &token, &servers) {
            Ok((count, names)) => {
                let server_message = if servers.is_empty() {
                    "모든 프로필".to_string()
                } else {
                    servers.join(", ")
                };
                let _ = app.emit(
                    "auth:success",
                    serde_json::json!({
                        "servers": server_message,
                        "token": token,
                        "profileCount": count,
                        "profileNames": names,
                    }),
                );
            }
            Err(e) => {
                let _ = app.emit("auth:error", serde_json::json!({ "message": e }));
            }
        }
    });
}

/// MODE1(servers 있음): servers.dat 매칭 프로필에 무조건 기록.
/// MODE2(없음): HyeniHelper 설치 프로필에 기존 토큰 없을 때만 기록. (TS handleAuthRequest 의미)
fn apply_auth(app: &AppHandle, token: &str, servers: &[String]) -> Result<(usize, Vec<String>), String> {
    let db = app.state::<DbState>();
    let profiles = {
        let conn = db.0.lock().unwrap();
        hyenimc_core::list_profiles(&conn).map_err(|e| e.to_string())?
    };

    // 프로필별 독립 처리 — 한 프로필 실패가 전체를 막지 않음 (TS handleAuthRequest 의미)
    let mut updated: Vec<String> = Vec::new();
    for profile in &profiles {
        let game_dir = PathBuf::from(&profile.game_directory);
        let applied = if servers.is_empty() {
            // MODE 2: HyeniHelper 설치 프로필에 기존 토큰 없을 때만
            hy::has_hyenihelper(&game_dir.join("mods"))
                && hy::write_hyenihelper_config(&game_dir, token, false).unwrap_or(false)
        } else {
            // MODE 1: servers.dat 매칭 + HyeniHelper 설치 프로필에 무조건 덮어쓰기.
            // (Electron handleAuthRequest와 동일 — HyeniHelper 없는 프로필엔 기록하지 않는다)
            let matches = servers
                .iter()
                .any(|s| hy::servers_dat_contains(&game_dir.join("servers.dat"), s));
            matches
                && hy::has_hyenihelper(&game_dir.join("mods"))
                && hy::write_hyenihelper_config(&game_dir, token, true).unwrap_or(false)
        };
        if applied {
            updated.push(profile.name.clone());
        }
    }

    if updated.is_empty() {
        return Err(if servers.is_empty() {
            "HyeniHelper가 설치된 프로필을 찾을 수 없습니다".to_string()
        } else {
            format!(
                "서버({})가 등록되고 HyeniHelper가 설치된 프로필을 찾을 수 없습니다",
                servers.join(", ")
            )
        });
    }
    Ok((updated.len(), updated))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn authorized_domain_wildcard() {
        assert!(is_authorized_server("mc.devbug.ing"));
        assert!(is_authorized_server("MC.DEVBUG.ING:25565"));
        assert!(is_authorized_server("devbug.ing"));
        assert!(is_authorized_server("a.b.devbug.me"));
        assert!(!is_authorized_server("devbug.ing.evil.com"));
        assert!(!is_authorized_server("hypixel.net"));
    }
}
