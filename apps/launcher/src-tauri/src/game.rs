//! 게임 실행/설치 커맨드 (M2b) — 기존 game.ts IPC 핸들러 대응.
//! 이벤트: download:progress / game:log / game:started / game:stopped (기존 렌더러 리스너와 동일 이름)

use std::collections::{HashMap, HashSet};
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
}

#[derive(Default)]
pub struct GameState {
    running: Mutex<HashMap<String, RunningEntry>>,
    /// 실행 준비(다운로드~spawn 이전) 진행 중인 프로필 — 렌더러 이중 트리거 방어(레이스프리).
    /// `running`은 spawn 성공 후에야 채워지므로, 그 이전 구간의 중복 호출은 이 집합으로 막는다.
    launching: Mutex<HashSet<String>>,
    /// 프로필별 최근 로그 링버퍼(최대 500줄) — 종료 후에도 보존(크래시 리포트용)
    pub log_buffers: Mutex<HashMap<String, Vec<String>>>,
}

const MAX_LOG_LINES: usize = 500;

/// game_launch 진입 시 `launching`에 등록하고, 함수 종료(성공/에러 무관) 시 자동 해제하는 RAII 가드.
/// 여러 `?` 조기 반환 경로에서도 누수 없이 정리된다.
struct LaunchGuard {
    app: AppHandle,
    profile_id: String,
}

impl Drop for LaunchGuard {
    fn drop(&mut self) {
        if let Some(gs) = self.app.try_state::<GameState>() {
            gs.launching.lock().unwrap().remove(&self.profile_id);
        }
    }
}

impl GameState {
    pub fn push_log(&self, profile_id: &str, line: String) {
        let mut buffers = self.log_buffers.lock().unwrap();
        let buf = buffers.entry(profile_id.to_string()).or_default();
        buf.push(line);
        if buf.len() > MAX_LOG_LINES {
            let overflow = buf.len() - MAX_LOG_LINES;
            buf.drain(0..overflow);
        }
    }

    pub fn log_snapshot(&self, profile_id: &str) -> Vec<String> {
        self.log_buffers
            .lock()
            .unwrap()
            .get(profile_id)
            .cloned()
            .unwrap_or_default()
    }

    /// 해당 프로필의 게임이 실행 중인지 (삭제 차단 등에 사용).
    pub fn is_running(&self, profile_id: &str) -> bool {
        self.running.lock().unwrap().contains_key(profile_id)
    }

    /// 실행 중인 게임이 하나라도 있는지 (공유 캐시 삭제 차단 등에 사용).
    pub fn any_running(&self) -> bool {
        !self.running.lock().unwrap().is_empty()
    }
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

pub fn game_dirs_for(profile: &hyenimc_core::Profile) -> Result<GameDirs, String> {
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

/// pack.rs에서 재사용
pub fn load_profile_pub(
    db: &State<'_, DbState>,
    profile_id: &str,
) -> Result<hyenimc_core::Profile, String> {
    load_profile(db, profile_id)
}

pub fn download_config(settings: &hyenimc_core::settings::GlobalSettings) -> DownloadConfig {
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
    // 다운로드 모달 제목용 — useDownloadProgress가 profileName/versionId로 헤더를 채운다.
    let profile_name = profile.name.clone();
    let version_id_ev = version_id.clone();
    let detail = ensure_version(&http, url.as_deref(), &version_id, dirs, cfg, move |p| {
        // 렌더러(useDownloadProgress)는 `percent`로 모달 표시를 트리거하고 `totalTasks`/`completedTasks`로
        // 바를 채운다. 기존 `completed`/`total`만 보내면 total이 '현재 파일 바이트'로 오해석되어 바가 안 뜬다.
        let percent = if p.total > 0 {
            (p.completed as f64 / p.total as f64) * 100.0
        } else {
            0.0
        };
        let _ = app2.emit(
            "download:progress",
            serde_json::json!({
                "profileId": profile_id,
                "profileName": profile_name,
                "versionId": version_id_ev,
                "phase": p.phase,
                "percent": percent,
                "totalTasks": p.total,
                "completedTasks": p.completed,
                "currentFile": p.current_file,
            }),
        );
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(detail)
}

/// Java 감지 결과 캐시 — Electron판이 앱 시작 시 감지 후 캐시(getCached)하던 것과 동등.
/// Tauri는 setup에서 감지하지 않으므로, 첫 조회 시 감지→캐시하는 lazy 방식.
#[derive(Default)]
pub struct JavaCache(pub Mutex<Option<Vec<hyenimc_launcher::java::JavaInstallation>>>);

/// 강제 재감지 — 결과를 캐시에 갱신 (SettingsPage '재감지' / 프로필 생성·설정).
#[tauri::command]
pub async fn java_detect(
    cache: State<'_, JavaCache>,
) -> Result<Vec<hyenimc_launcher::java::JavaInstallation>, String> {
    let list = hyenimc_launcher::java::detect_java_installations().await;
    *cache.0.lock().unwrap() = Some(list.clone());
    Ok(list)
}

/// 캐시 우선 조회 — 없으면 1회 감지 후 캐시(초기 화면에서 미감지 방지).
#[tauri::command]
pub async fn java_get_cached(
    cache: State<'_, JavaCache>,
) -> Result<Vec<hyenimc_launcher::java::JavaInstallation>, String> {
    if let Some(list) = cache.0.lock().unwrap().clone() {
        return Ok(list);
    }
    let list = hyenimc_launcher::java::detect_java_installations().await;
    *cache.0.lock().unwrap() = Some(list.clone());
    Ok(list)
}

/// MC 버전에 필요한 최소 Java 메이저 버전 (26.1+ → 25 등).
#[tauri::command]
pub fn java_get_recommended(game_version: String) -> u32 {
    hyenimc_launcher::java::recommended_java_major(&game_version)
}

#[tauri::command]
pub async fn loader_get_versions(
    loader_type: String,
    game_version: String,
    include_unstable: bool,
) -> Result<Vec<hyenimc_launcher::loader::LoaderVersion>, String> {
    let http = reqwest::Client::new();
    let mut list: Vec<hyenimc_launcher::loader::LoaderVersion> = match loader_type.as_str() {
        "fabric" => hyenimc_launcher::loader::fabric_loader_versions(&http, &game_version)
            .await
            .map_err(|e| e.to_string())?,
        "neoforge" => {
            let all = hyenimc_launcher::loader::neoforge_versions(&http)
                .await
                .map_err(|e| e.to_string())?;
            let mut list: Vec<_> = all
                .into_iter()
                .filter(|v| hyenimc_launcher::loader::neoforge_matches_mc(v, &game_version))
                .map(|v| hyenimc_launcher::loader::LoaderVersion {
                    // Go/Electron과 동일: beta·alpha 라벨은 불안정 취급
                    stable: !(v.contains("beta") || v.contains("alpha")),
                    version: v,
                })
                .collect();
            // 최신 우선 (렌더러가 첫 항목을 자동 선택)
            list.reverse();
            list
        }
        "forge" => {
            let all = hyenimc_launcher::loader::forge_versions(&http, &game_version)
                .await
                .map_err(|e| e.to_string())?;
            let mut list: Vec<_> = all
                .into_iter()
                .map(|v| hyenimc_launcher::loader::LoaderVersion {
                    // Forge는 beta/rc 라벨을 버전에 포함 — 그 외는 안정
                    stable: !(v.contains("beta") || v.contains("rc")),
                    version: v,
                })
                .collect();
            list.reverse();
            list
        }
        other => return Err(format!("지원하지 않는 로더: {other}")),
    };
    // 불안정 미포함이면 stable만 (사용자 '불안정 버전 포함' 체크박스)
    if !include_unstable {
        list.retain(|v| v.stable);
    }
    Ok(list)
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
    force: Option<bool>,
) -> Result<(), String> {
    let force = force.unwrap_or(false);
    if game_state.running.lock().unwrap().contains_key(&profile_id) {
        return Err(format!("프로필 {profile_id}이(가) 이미 실행 중입니다"));
    }

    // 중복 실행 준비 방지 — 더블클릭 등으로 인한 동시 실행 방어. 렌더러 가드(isLaunching state)는
    // 비동기라 같은 tick 중복을 못 막으므로 서버측 레이스프리 가드로 보강(중복 다운로드·이중 spawn 방지).
    // 이미 준비 중이면 에러 대신 조용히 무시(진행 중인 실행이 이벤트를 몰아주므로 중복 모달 방지).
    let _launch_guard = {
        let mut launching = game_state.launching.lock().unwrap();
        if !launching.insert(profile_id.clone()) {
            log::warn!("게임 실행 중복 호출 무시(이미 준비 중): {profile_id}");
            return Ok(());
        }
        LaunchGuard { app: app.clone(), profile_id: profile_id.clone() }
    };

    // 계정 필수 — 오프라인 미지원(정품 온라인 서버 전용). 다운로드 전에 차단.
    // 미선택뿐 아니라 '선택된 id가 삭제되어 실존하지 않는 경우'도 여기서 명확히 거른다.
    match &account_id {
        None => {
            return Err("Microsoft 계정으로 로그인해야 게임을 실행할 수 있습니다.".into());
        }
        Some(aid) => {
            let exists = {
                let conn = db.0.lock().unwrap();
                hyenimc_core::account::get_account(&conn, aid)
                    .map_err(|e| e.to_string())?
                    .is_some()
            };
            if !exists {
                return Err("선택한 계정을 찾을 수 없습니다. Microsoft 계정으로 다시 로그인해주세요.".into());
            }
        }
    }

    let (profile, settings) = {
        let p = load_profile(&db, &profile_id)?;
        let s = hyenimc_core::settings::get_settings(&db.0.lock().unwrap()).map_err(|e| e.to_string())?;
        (p, s)
    };
    let dirs = game_dirs_for(&profile)?;
    let cfg = download_config(&settings);

    log::info!(
        "게임 실행 시작: profile={profile_id} game_version={} loader={} loader_version={:?} dir={}",
        profile.game_version,
        profile.loader_type,
        profile.loader_version,
        profile.game_directory
    );

    // ⓪ 실행 전 검증 (Electron GameLaunchValidator) — Java 설치/경로/버전 + 메모리 + 디렉터리를
    //    spawn 이전에 확인해 잘못된 설정을 친절한 안내와 함께 차단(암호적 OS/JVM 오류 방지).
    validate_launch(&app, &profile, &settings).await?;

    // ⓪ 실행 전 팩 게이트 (breaking 차단 / 서버 접근 불가 시 정책)
    crate::pack::pre_launch_pack_gate(&dirs, force).await?;

    // ① 베이스 게임 설치 보장 (이미 설치면 SHA1 스킵으로 빠르게 통과)
    ensure_profile_version(&app, &profile, &dirs, &cfg).await?;

    // ② Java 결정: 프로필 오버라이드 → 전역 설정 → 자동 감지 최상위
    //    (NeoForge installer가 Java를 필요로 하므로 로더 설치 전에 결정)
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

    // ②.9 워커 모드 사전 확인 + 로더 호환 판단 (로더 설치 전에 loader_version 확정)
    // 서버 필수 모드의 최신 버전이 현재 로더 버전 범위를 벗어나면 [min,max] 내 최신 로더로 상향한다
    // (다운그레이드 없음). 실제 로더 설치는 아래 ③가 이 loader_version으로 수행. force면 건너뜀.
    let http = reqwest::Client::new();
    let mut loader_version = profile.loader_version.clone().unwrap_or_default();
    let mut pending_worker_updates: Vec<hyenimc_launcher::workermods::WorkerModUpdate> = Vec::new();
    let mut worker_install_token: Option<String> = None;
    let mut worker_base_url: Option<String> = None;
    {
        let game_dir = std::path::PathBuf::from(&profile.game_directory);
        if !force && crate::hyeni::should_check(&game_dir, profile.server_address.as_deref()) {
            let _ = app.emit(
                "game:log",
                serde_json::json!({ "profileId": profile_id, "line": "[worker-mods] 모드 업데이트 확인 중..." }),
            );
            let base = crate::pack::worker_base().map_err(|_| {
                crate::pack::forceable(
                    "업데이트 서버 주소가 설정되지 않아 모드 최신 여부를 확인할 수 없습니다.\n그대로 실행하면 서버 접속이 안 될 수 있습니다.",
                )
            })?;
            let mods_dir = game_dir.join("mods");
            let updates = hyenimc_launcher::workermods::check_all_updates(
                &http,
                &base,
                &mods_dir,
                &profile.game_version,
                &profile.loader_type,
                true, // include_all — 실행 전엔 적용 가능한 모든 모드 확인
                true, // has_authorized_server — should_check 통과 시에만 진입
            )
            .await
            .map_err(|_| {
                crate::pack::forceable(
                    "업데이트 서버에 연결할 수 없어 모드 최신 여부를 확인하지 못했습니다.\n그대로 실행하면 서버 접속이 안 될 수 있습니다.",
                )
            })?;
            if !updates.is_empty() {
                let token = match hyenimc_launcher::hyeni::read_hyenihelper_token(&game_dir) {
                    Some(t) => t,
                    None => {
                        log::warn!(
                            "워커 모드 {}건 업데이트 필요하나 인증 토큰 없음 — 실행 중단",
                            updates.len()
                        );
                        return Err("모드 업데이트를 위한 인증이 필요합니다.\n\nDiscord에서 /인증 명령어로 인증하세요.".to_string());
                    }
                };
                // 로더 호환 판단 → 필요 시 loader_version 상향 + 프로필 반영
                match hyenimc_launcher::workermods::resolve_loader_for_updates(
                    &http,
                    &profile.loader_type,
                    &profile.game_version,
                    &loader_version,
                    &updates,
                )
                .await
                {
                    Ok(Some(bump)) if bump.version != loader_version => {
                        let _ = app.emit(
                            "game:log",
                            serde_json::json!({ "profileId": profile_id, "line": format!("[loader] 모드 호환을 위해 로더 버전을 {}로 변경합니다.", bump.version) }),
                        );
                        loader_version = bump.version.clone();
                        let patch = hyenimc_core::profile::ProfilePatch {
                            loader_version: Some(bump.version.clone()),
                            ..Default::default()
                        };
                        if let Err(e) = hyenimc_core::profile::update_profile(
                            &db.0.lock().unwrap(),
                            &profile_id,
                            &patch,
                            now_secs(),
                        ) {
                            log::warn!("로더 버전 프로필 반영 실패: {e}");
                        }
                    }
                    Ok(_) => {}
                    Err(e) => {
                        return Err(crate::pack::forceable(&format!(
                            "{e}\n그대로 실행하면 서버 접속이 안 될 수 있습니다."
                        )));
                    }
                }
                pending_worker_updates = updates;
                worker_install_token = Some(token);
                worker_base_url = Some(base);
            }
        }
    }

    // ③ 로더 설치 → 실효 version_id 결정 (loader_version은 ②.9에서 확정, vanilla면 게임 버전 그대로)
    let version_id = match profile.loader_type.as_str() {
        "fabric" if !loader_version.is_empty() => {
            let _ = app.emit("game:log", serde_json::json!({ "profileId": profile_id, "line": "[loader] Fabric 설치 확인 중..." }));
            hyenimc_launcher::loader::install_fabric(&http, &profile.game_version, &loader_version, &dirs, &cfg)
                .await
                .map_err(|e| e.to_string())?
        }
        "neoforge" if !loader_version.is_empty() => {
            let _ = app.emit("game:log", serde_json::json!({ "profileId": profile_id, "line": "[loader] NeoForge 설치 확인 중..." }));
            let app_log = app.clone();
            let pid = profile_id.clone();
            hyenimc_launcher::loader::install_neoforge(&http, &loader_version, &java_path, &dirs, &cfg, move |line| {
                let _ = app_log.emit("game:log", serde_json::json!({ "profileId": pid, "line": line }));
            })
            .await
            .map_err(|e| e.to_string())?
        }
        "forge" if !loader_version.is_empty() => {
            let _ = app.emit("game:log", serde_json::json!({ "profileId": profile_id, "line": "[loader] Forge 설치 확인 중..." }));
            let app_log = app.clone();
            let pid = profile_id.clone();
            hyenimc_launcher::loader::install_forge(&http, &loader_version, &java_path, &dirs, &cfg, move |line| {
                let _ = app_log.emit("game:log", serde_json::json!({ "profileId": pid, "line": line }));
            })
            .await
            .map_err(|e| e.to_string())?
        }
        _ => profile.game_version.clone(),
    };

    // ③.5 워커 모드 설치 (②.9에서 확인한 업데이트를 로더 설치 뒤에 설치)
    if let (Some(token), Some(base)) = (worker_install_token.as_ref(), worker_base_url.as_ref()) {
        // ②.9에서 로더가 항상 교집합 안으로 맞춰지므로(위/아래 이동) pending 업데이트는 모두 설치 가능.
        if !pending_worker_updates.is_empty() {
            let mods_dir = std::path::PathBuf::from(&profile.game_directory).join("mods");
            let app_log = app.clone();
            let pid = profile_id.clone();
            hyenimc_launcher::workermods::install_updates(
                &http,
                base,
                &mods_dir,
                &pending_worker_updates,
                token,
                &cfg,
                move |name, pct| {
                    let _ = app_log.emit(
                        "game:log",
                        serde_json::json!({ "profileId": &pid, "line": format!("[worker-mods] {name} {pct}%") }),
                    );
                    let _ = app_log.emit(
                        "download:progress",
                        serde_json::json!({
                            "profileId": &pid,
                            "phase": "worker-mods",
                            "percent": pct,
                            "currentFile": name,
                        }),
                    );
                },
            )
            .await
            .map_err(|e| e.to_string())?;
        }
    }

    // 로더 프로필이면 병합된 상세를 다시 로드
    let detail = hyenimc_launcher::install::load_version_detail(&dirs, &version_id)
        .map_err(|e| e.to_string())?;

    // ④ natives + classpath + 인자
    let native_jars = native_jars_for(&detail, &dirs);
    let natives_dir = hyenimc_launcher::natives::extract_natives(&dirs.version_dir(&version_id), &native_jars)
        .map_err(|e| e.to_string())?;
    let (classpath, missing) = build_classpath(&detail, &dirs);
    log::info!(
        "실행 준비: version_id={version_id} java={java_path} classpath_libs={} 누락={}",
        classpath.split(if cfg!(windows) { ';' } else { ':' }).count(),
        missing.len()
    );
    if !missing.is_empty() {
        // 누락 라이브러리는 로더 실행 실패의 흔한 원인 — 로그 파일에 남겨 진단 가능하게.
        log::warn!("[game] 누락 라이브러리 {}개: {:?}", missing.len(), missing);
    }

    // 계정 필수(위에서 None 차단). 실계정 토큰 확보(만료 임박 시 자동 갱신).
    let aid = account_id
        .as_ref()
        .ok_or_else(|| "Microsoft 계정으로 로그인해야 게임을 실행할 수 있습니다.".to_string())?;
    let (username, uuid, access_token, user_type) = {
        let tokens = crate::account::get_valid_tokens(&db, &crypto, aid).await?;
        let account = {
            let conn = db.0.lock().unwrap();
            hyenimc_core::account::get_account(&conn, aid)
                .map_err(|e| e.to_string())?
                .ok_or_else(|| format!("계정 없음: {aid}"))?
        };
        (account.name, account.uuid, Some(tokens.access_token), Some("msa".to_string()))
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

    // 새 실행마다 로그 버퍼 초기화 (크래시 리포트용)
    game_state.log_buffers.lock().unwrap().insert(profile_id.clone(), Vec::new());

    let app_log = app.clone();
    let pid_for_log = profile_id.clone();
    let app_exit = app.clone();
    let pid_for_exit = profile_id.clone();
    let started_at = Instant::now();
    let crash_dir = dirs.instance_dir.clone(); // 종료 후 crash-report 진단용

    let handle = spawn_game(
        &java_path,
        &args,
        &dirs.instance_dir,
        move |line| {
            // 로더/MC의 stdout·stderr를 런처 로그 파일에도 남긴다(Electron 동작 복원).
            // 로더 실패 시 실제 예외/스택이 stderr로 나오는데 이게 없으면 진단 불가.
            log::info!("[game] {line}");
            app_log.state::<GameState>().push_log(&pid_for_log, line.clone());
            let _ = app_log.emit(
                "game:log",
                serde_json::json!({ "profileId": pid_for_log, "line": line }),
            );
        },
        move |code| {
            // 종료: 상태 정리 + 플레이타임/크래시 기록 + 이벤트
            let elapsed = started_at.elapsed().as_secs() as i64;
            let elapsed_ms = started_at.elapsed().as_millis();
            let db = app_exit.state::<DbState>();
            if elapsed > 0 {
                let _ = hyenimc_core::stats::record_play_time(
                    &db.0.lock().unwrap(),
                    &pid_for_exit,
                    elapsed,
                );
            }
            let gs = app_exit.state::<GameState>();
            if matches!(code, Some(c) if c != 0) {
                let _ = hyenimc_core::stats::record_crash(
                    &db.0.lock().unwrap(),
                    &pid_for_exit,
                    now_secs(),
                );
                // 크래시 자동 진단 → error-dialog 표시 (Electron 동작 복원)
                let logs = gs.log_snapshot(&pid_for_exit);
                crate::crash_analyzer::report_crash(&app_exit, &crash_dir, &logs, code, elapsed_ms);
            }
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
        },
    );
    // 주의: 렌더러는 Electron 의미(processKey=profileId)로 versionId 필드를 키잉한다 —
    // 실제 로더 버전 id가 아니라 profileId를 넣어야 상태 표시가 맞는다 (전체 리뷰 G1)
    let _ = app.emit(
        "game:started",
        serde_json::json!({ "profileId": profile_id, "versionId": profile_id }),
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

/// 실행 전 검증 이슈 하나 (Electron ValidationIssue 대응).
struct LaunchIssue {
    severity: &'static str, // "critical" | "error" | "warning"
    title: String,
    message: String,
    solution: String,
    action: &'static str,
}

/// 실행 전 검증 (Electron GameLaunchValidator.validateBeforeLaunch).
/// Java 설치/경로/버전 + 메모리 + 게임 디렉터리를 검사해, warning은 로그로 남기고
/// critical/error가 하나라도 있으면 첫 항목을 show-error-dialog로 안내하며 실행을 차단한다.
/// (가용 메모리·게임 파일·디스크 공간은 Electron도 의도적으로 검사하지 않음 — 무동작이라 미포함)
async fn validate_launch(
    app: &AppHandle,
    profile: &hyenimc_core::Profile,
    settings: &hyenimc_core::settings::GlobalSettings,
) -> Result<(), String> {
    let mut issues: Vec<LaunchIssue> = Vec::new();

    // 1. Java 설치 확인 (critical) — 하나도 없으면 실행 불가
    if hyenimc_launcher::java::detect_java_installations().await.is_empty() {
        issues.push(LaunchIssue {
            severity: "critical",
            title: "Java를 찾을 수 없습니다".into(),
            message: "Minecraft를 실행하려면 Java가 필요합니다.".into(),
            solution: "Java를 설치하거나 Java 경로를 수동으로 설정해주세요.".into(),
            action: "openJavaInstallGuide",
        });
    }

    // 2·3. Java 경로가 지정된 경우만(자동 선택이면 스킵) 경로 유효성 + 버전 확인
    let java_path = profile.java_path.as_deref().filter(|p| !p.is_empty());
    if let Some(jp) = java_path {
        match hyenimc_launcher::java::probe(std::path::Path::new(jp)).await {
            None => issues.push(LaunchIssue {
                severity: "error",
                title: "Java 경로가 잘못되었습니다".into(),
                message: format!("설정된 Java 경로({jp})를 찾을 수 없거나 유효한 Java가 아닙니다."),
                solution: "Java 경로를 다시 선택하거나 자동 선택으로 변경하세요.".into(),
                action: "resetJavaPath",
            }),
            Some(inst) => {
                let required = hyenimc_launcher::java::recommended_java_major(&profile.game_version);
                if inst.major_version < required {
                    issues.push(LaunchIssue {
                        severity: "warning",
                        title: "Java 버전이 권장 사양보다 낮습니다".into(),
                        message: format!(
                            "Minecraft {}은(는) Java {required} 이상을 권장하지만, 현재 Java {}이(가) 설정되어 있습니다.",
                            profile.game_version, inst.major_version
                        ),
                        solution: format!("Java {required} 이상으로 변경하면 더 안정적입니다."),
                        action: "fixJavaVersion",
                    });
                }
            }
        }
    }

    // 4. 메모리 (critical/error)
    let max_mem = profile.memory_max.unwrap_or(settings.java.memory_max).max(1) as u64;
    let min_mem = profile.memory_min.unwrap_or(settings.java.memory_min).max(1) as u64;
    let sys_mb = {
        let mut sys = sysinfo::System::new();
        sys.refresh_memory();
        sys.total_memory() / (1024 * 1024)
    };
    if sys_mb > 0 {
        if (max_mem as f64) > (sys_mb as f64) * 0.9 {
            let suggested = (sys_mb as f64 * 0.7) as u64;
            issues.push(LaunchIssue {
                severity: "critical",
                title: "메모리 설정이 시스템 메모리를 초과합니다".into(),
                message: format!("최대 메모리 {max_mem}MB가 시스템 메모리 {sys_mb}MB의 {}%입니다.", max_mem * 100 / sys_mb),
                solution: format!("최대 메모리를 {suggested}MB 이하로 줄이세요."),
                action: "reduceMaxMemory",
            });
        } else if min_mem == max_mem && (min_mem as f64) > (sys_mb as f64) * 0.8 {
            issues.push(LaunchIssue {
                severity: "error",
                title: "메모리 설정이 위험합니다".into(),
                message: format!(
                    "최소/최대 메모리가 모두 {min_mem}MB로 시스템 메모리 {sys_mb}MB의 {}%를 차지합니다.",
                    min_mem * 100 / sys_mb
                ),
                solution: "최소 메모리를 줄이거나 최소≠최대로 설정하세요.".into(),
                action: "fixDangerousMemory",
            });
        }
    }

    // 5. 게임 디렉터리 (error) — 없으면 생성, 쓰기 권한 확인
    if let Some(issue) = check_game_directory(&profile.game_directory) {
        issues.push(issue);
    }

    // warning은 실행을 막지 않고 로그로만 남긴다 (Electron 동일)
    for w in issues.iter().filter(|i| i.severity == "warning") {
        let _ = app.emit(
            "game:log",
            serde_json::json!({ "profileId": &profile.id, "line": format!("[검증 경고] {}: {}", w.title, w.message) }),
        );
    }

    // critical/error가 하나라도 있으면 첫 critical(없으면 첫 error)로 차단 + 안내
    let blocking = issues
        .iter()
        .find(|i| i.severity == "critical")
        .or_else(|| issues.iter().find(|i| i.severity == "error"));
    if let Some(issue) = blocking {
        // 버튼 둘: '닫기'(그냥 닫음) + 상황별 액션. Java 미설치는 설치 안내(브라우저), 그 외는 설정 화면 이동.
        let (primary_label, primary_action) = if issue.action == "openJavaInstallGuide" {
            ("Java 설치 안내", "openJavaInstallGuide")
        } else {
            ("설정 열기", "openSettings")
        };
        let _ = app.emit(
            "show-error-dialog",
            serde_json::json!({
                "type": "error",
                "title": issue.title,
                "message": issue.message,
                "suggestions": [issue.solution],
                "actions": [
                    { "label": "닫기", "type": "secondary", "action": "close" },
                    { "label": primary_label, "type": "primary", "action": primary_action },
                ],
            }),
        );
        return Err(format!("{}: {}", issue.title, issue.message));
    }
    Ok(())
}

/// 게임 디렉터리 검사: 존재/디렉터리 여부, 없으면 생성, 쓰기 권한(임시 파일). 문제 없으면 None.
fn check_game_directory(game_dir: &str) -> Option<LaunchIssue> {
    if game_dir.is_empty() {
        return None; // 경로 미설정은 별도 경로로 처리
    }
    let path = std::path::Path::new(game_dir);
    match std::fs::metadata(path) {
        Ok(m) if !m.is_dir() => {
            return Some(LaunchIssue {
                severity: "error",
                title: "게임 디렉터리가 유효하지 않습니다".into(),
                message: format!("{game_dir}는 디렉터리가 아닙니다."),
                solution: "올바른 경로를 선택하세요.".into(),
                action: "selectGameDirectory",
            });
        }
        Ok(_) => {}
        Err(_) => {
            // 없으면 생성 시도
            if std::fs::create_dir_all(path).is_err() {
                return Some(LaunchIssue {
                    severity: "error",
                    title: "게임 디렉터리를 생성할 수 없습니다".into(),
                    message: format!("{game_dir} 경로를 생성할 수 없습니다."),
                    solution: "디렉터리 권한을 확인하거나 다른 경로를 선택하세요.".into(),
                    action: "selectDifferentDirectory",
                });
            }
        }
    }
    // 쓰기 권한 확인 — 임시 파일 생성/삭제
    let probe = path.join(".hyenimc-write-test");
    match std::fs::File::create(&probe) {
        Ok(_) => {
            let _ = std::fs::remove_file(&probe);
            None
        }
        Err(_) => Some(LaunchIssue {
            severity: "error",
            title: "게임 디렉터리 권한이 없습니다".into(),
            message: format!("{game_dir}에 읽기/쓰기 권한이 없습니다."),
            solution: "디렉터리 권한을 확인하거나 다른 경로를 선택하세요.".into(),
            action: "fixPermissions",
        }),
    }
}
