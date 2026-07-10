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
    // 아래에서 resolve로 로더 호환을 판단해 required_loader_version만 스탬프한다.
    let mut updates = workermods::check_all_updates(
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

    // 로더 호환 판단 → 필요하면 각 업데이트에 required_loader_version 스탬프(표시용).
    // 실제 로더 설치/프로필 반영은 다음 게임 실행(game.rs)이 수행한다.
    match workermods::resolve_loader_for_updates(
        &http,
        &loader_type,
        &game_version,
        &loader_version,
        &updates,
    )
    .await
    {
        Ok(Some(bump)) => {
            for u in &mut updates {
                u.required_loader_version = Some(bump.version.clone());
            }
        }
        Ok(None) => {}
        Err(e) => log::warn!("업데이트 패널 로더 해석 실패(무시): {e}"),
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

/// 로그/에러 표시용 토큰 마스킹 — token= 값 부분만 ***로 치환(방송·로그 노출 방지).
fn mask_token(url: &str) -> String {
    match url.find("token=") {
        Some(i) => {
            let start = i + "token=".len();
            let end = url[start..].find('&').map(|j| start + j).unwrap_or(url.len());
            format!("{}***{}", &url[..start], &url[end..])
        }
        None => url.to_string(),
    }
}

/// hyenimc:// 딥링크 처리 — main.rs의 on_open_url/single-instance에서 호출.
pub fn handle_deep_link(app: &AppHandle, url: &str) {
    log::info!("[deeplink] 수신: {}", mask_token(url));
    let Some((token, servers, hyenipack)) = hy::parse_auth_url(url) else {
        if url.starts_with("hyenimc://") {
            log::warn!("[deeplink] 인증 링크 파싱 실패: {}", mask_token(url));
            let _ = app.emit(
                "auth:error",
                serde_json::json!({ "message": format!("잘못된 인증 링크입니다: {}", mask_token(url)) }),
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
                // 토큰 원문은 렌더러로 보내지 않는다(방송 중 devtools 콘솔 노출 방지).
                // 렌더러 소비처(App.tsx)는 servers/profileCount만 사용.
                let _ = app.emit(
                    "auth:success",
                    serde_json::json!({
                        "servers": server_message,
                        "profileCount": count,
                        "profileNames": names,
                    }),
                );
            }
            Err(e) => {
                let _ = app.emit("auth:error", serde_json::json!({ "message": e }));
                return; // 인증 실패면 팩 제안도 중단
            }
        }
        // 딥링크에 hyenipack= 이 있으면 설치 제안(확인 다이얼로그는 렌더러)
        if let Some(pack_id) = hyenipack {
            suggest_pack_install(&app, &pack_id).await;
        }
    });
}

/// 팩 제안: 이미 설치된 프로필이 있으면 exists, 없으면 공개 목록에서 찾아 suggest.
/// 비공개/부재/네트워크 실패는 조용히 무시(인증 자체는 이미 성공).
async fn suggest_pack_install(app: &AppHandle, pack_id: &str) {
    // 동일 팩 설치 프로필 검사 (.hyenipack-meta.json의 hyenipack_id).
    // instance_dir == profile.game_directory (game_dirs_for 참조).
    let profiles = {
        let db = app.state::<DbState>();
        let conn = db.0.lock().unwrap();
        hyenimc_core::list_profiles(&conn).unwrap_or_default()
    };
    for p in &profiles {
        let meta = hyenimc_launcher::hyenipack::read_pack_meta(Path::new(&p.game_directory));
        if meta.is_some_and(|m| m.hyenipack_id == pack_id) {
            let _ = app.emit(
                "hyeni:pack-exists",
                serde_json::json!({ "packId": pack_id, "profileName": p.name }),
            );
            return;
        }
    }
    let Ok(base) = crate::pack::worker_base() else {
        return;
    };
    let http = reqwest::Client::new();
    let Ok(packs) = hyenimc_launcher::hyenipack::fetch_pack_list(&http, &base).await else {
        return;
    };
    let Some(item) = packs.into_iter().find(|x| x.id == pack_id) else {
        return; // 비공개/부재 → 무시
    };
    let _ = app.emit(
        "hyeni:pack-suggest",
        serde_json::json!({
            "packId": item.id,
            "name": item.name,
            "version": item.latest_version,
            "mcVersion": item.minecraft.as_ref().map(|m| m.version.clone()),
            "loaderType": item.minecraft.as_ref().map(|m| m.loader_type.clone()),
        }),
    );
}

/// MODE1(servers 있음): servers.dat 매칭 프로필에 무조건 기록.
/// MODE2(없음): HyeniHelper 설치 프로필에 기존 토큰 없을 때만 기록. (TS handleAuthRequest 의미)
fn apply_auth(app: &AppHandle, token: &str, servers: &[String]) -> Result<(usize, Vec<String>), String> {
    let db = app.state::<DbState>();
    // 저장소 적재(항상) — 프로필이 없어도 토큰을 버리지 않는다(닭-달걀 방지).
    // 팩 설치/실행 시 servers.dat 매칭으로 프로필에 뒤늦게 기록된다.
    {
        let conn = db.0.lock().unwrap();
        if let Err(e) = hyenimc_core::hyeni_tokens::upsert_token(&conn, token, servers, now_secs()) {
            log::warn!("토큰 저장소 적재 실패: {e}");
        }
    }
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

    // 0건도 성공 — 토큰은 저장소에 적재되었고, 팩 설치/실행 시 매칭 기록된다.
    Ok((updated.len(), updated))
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
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
