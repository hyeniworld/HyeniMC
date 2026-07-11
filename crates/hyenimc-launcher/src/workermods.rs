//! Worker mods 자동 관리 — Cloudflare Worker v2 API (HyeniHelper/HAF 등 필수 모드).
//! TS worker-mod-registry/updater 의미 포팅 (C1+C2 통합).

use std::collections::HashMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::download::{download_all, DownloadConfig, DownloadTask};
use crate::LauncherError;

// ── Worker API 응답 모델 ─────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
pub struct RegistryResponse {
    #[serde(default)]
    pub mods: Vec<RegistryItem>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryItem {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub latest_version: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub category: String, // "required" | "optional"
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LatestResponse {
    pub version: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub changelog: Option<String>,
    #[serde(default)]
    pub loaders: HashMap<String, LoaderEntry>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoaderEntry {
    #[serde(default)]
    pub game_versions: HashMap<String, FileInfo>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    pub file: String,
    #[serde(default)]
    pub sha256: Option<String>,
    #[serde(default)]
    pub size: Option<u64>,
    /// 이 파일이 요구하는 로더 버전 범위 (없으면 제약 없음). 프로필 로더 버전이 벗어나면 제외.
    #[serde(default)]
    pub min_loader_version: Option<String>,
    #[serde(default)]
    pub max_loader_version: Option<String>,
}

/// 렌더러(useWorkerModUpdates)가 소비하는 업데이트 항목
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerModUpdate {
    pub mod_id: String,
    pub mod_name: String,
    pub current_version: Option<String>,
    pub latest_version: String,
    pub is_installed: bool,
    pub category: String,
    #[serde(default)]
    pub changelog: Option<String>,
    pub file: String,
    #[serde(default)]
    pub sha256: Option<String>,
    #[serde(default)]
    pub size: Option<u64>,
    // 설치 URL 구성에 필요 (installMultiple 계약이 updates만 받으므로 내장)
    pub loader_type: String,
    pub game_version: String,
    /// 이 업데이트가 해석된 (loader,gv) 타깃이 요구하는 로더 버전 범위(없으면 제약 없음).
    #[serde(default)]
    pub min_loader_version: Option<String>,
    #[serde(default)]
    pub max_loader_version: Option<String>,
    /// 로더 호환을 위해 프로필 loader_version을 이 값으로 올려야 함(해석 결과 스탬프). 없으면 변경 불필요.
    #[serde(default)]
    pub required_loader_version: Option<String>,
}

// ── 버전 파싱/비교 (순수) ────────────────────────────────

/// 파일명에서 버전 추출 — 마지막 `x.y.z(-suffix)?` 세그먼트.
/// "hyenihelper-fabric-1.21.1-1.0.5" → "1.0.5", "FastSuite-1.21.1-6.0.5" → "6.0.5"
/// pre-release 접미사(버전 뒤에 붙는 `-SNAPSHOT`/`-beta` 등). 로더명(neoforge 등)과 구분.
const PRERELEASE_SUFFIXES: [&str; 6] = ["snapshot", "beta", "rc", "alpha", "pre", "dev"];

pub fn parse_mod_version(file_stem: &str) -> Option<String> {
    // x.y.z(3자리)를 우선하되, 없으면 x.y(2자리)도 허용.
    // 버전 세그먼트 뒤에 pre-release 접미사(-SNAPSHOT 등)가 오면 표시용으로 붙인다.
    // 예: `HyeniAdditionalFunctions-neoforge-1.0-SNAPSHOT` → "1.0-SNAPSHOT".
    let segs: Vec<&str> = file_stem.split('-').collect();
    let mut best: Option<usize> = None;
    let mut best_is3 = false;
    for (i, seg) in segs.iter().enumerate() {
        let core = seg.split('+').next().unwrap_or(seg);
        let parts: Vec<&str> = core.split('.').collect();
        let is3 = parts.len() >= 3 && parts.iter().take(3).all(|p| p.parse::<u32>().is_ok());
        let is2 = parts.len() == 2 && parts.iter().all(|p| p.parse::<u32>().is_ok());
        if is3 {
            best = Some(i);
            best_is3 = true;
        } else if is2 && !best_is3 {
            best = Some(i);
        }
    }
    let idx = best?;
    let mut version = segs[idx].split('+').next().unwrap_or(segs[idx]).to_string();
    if let Some(next) = segs.get(idx + 1) {
        let lower = next.to_lowercase();
        if PRERELEASE_SUFFIXES.iter().any(|p| lower.starts_with(p)) {
            version = format!("{version}-{next}");
        }
    }
    Some(version)
}

/// 알려진 pre-release 접미사면 (순위, 번호). 순위: snapshot/dev=0 < alpha=1 < beta=2 < pre/rc=3 < 정식=4.
/// 미인식 접미사(로더 빌드 등)는 None — 호출측이 기존 숫자 세그먼트 방식으로 처리.
fn prerelease_rank(suffix: &str) -> Option<(u8, u32)> {
    let lower = suffix.to_lowercase();
    let (rank, rest) = if let Some(r) = lower.strip_prefix("alpha") {
        (1, r)
    } else if let Some(r) = lower.strip_prefix("beta") {
        (2, r)
    } else if let Some(r) = lower.strip_prefix("pre") {
        (3, r)
    } else if let Some(r) = lower.strip_prefix("rc") {
        (3, r)
    } else if let Some(r) = lower.strip_prefix("snapshot") {
        (0, r)
    } else if let Some(r) = lower.strip_prefix("dev") {
        (0, r)
    } else {
        return None;
    };
    let num = rest.trim_start_matches(['.', '-']).parse::<u32>().unwrap_or(0);
    Some((rank, num))
}

/// (숫자 세그먼트, pre-release 순위, pre 번호). 정식 x.y.z는 순위 4 —
/// 같은 x.y.z에서 `1.2.3-beta001 < 1.2.3`이 되도록(SemVer 의미, 워커 배포 형식과 정합).
fn version_key(v: &str) -> (Vec<u32>, u8, u32) {
    if let Some((core, suffix)) = v.split_once('-') {
        if let Some((rank, num)) = prerelease_rank(suffix) {
            let nums = core
                .split(['.', '+'])
                .filter_map(|p| p.parse::<u32>().ok())
                .collect();
            return (nums, rank, num);
        }
    }
    // pre-release 접미사가 아니면 기존 동작: 모든 숫자 세그먼트(forge 풀 형식 등), 정식 취급
    let nums = v
        .split(['.', '-', '+'])
        .filter_map(|p| p.parse::<u32>().ok())
        .collect();
    (nums, 4, 0)
}

/// remote가 local보다 최신인가 (동일/구버전이면 false — 다운그레이드 없음)
pub fn is_newer_version(remote: &str, local: &str) -> bool {
    version_key(remote) > version_key(local)
}

/// candidates 중 [lo, hi] 범위(빈 문자열/None = 경계 없음)를 만족하는 최신(version_key 최대) 반환.
pub fn newest_in_range(candidates: &[String], lo: Option<&str>, hi: Option<&str>) -> Option<String> {
    let lo_key = lo.filter(|s| !s.is_empty()).map(version_key);
    let hi_key = hi.filter(|s| !s.is_empty()).map(version_key);
    candidates
        .iter()
        .filter(|c| {
            let k = version_key(c);
            lo_key.as_ref().is_none_or(|l| &k >= l) && hi_key.as_ref().is_none_or(|h| &k <= h)
        })
        .max_by_key(|c| version_key(c))
        .cloned()
}

/// (min,max) 범위들의 교집합: lo = 최대 min, hi = 최소 max. 빈/None은 제약 없음.
pub fn loader_range_intersection(
    ranges: &[(Option<String>, Option<String>)],
) -> (Option<String>, Option<String>) {
    let mut lo: Option<String> = None;
    let mut hi: Option<String> = None;
    for (min, max) in ranges {
        if let Some(m) = min.as_deref().filter(|s| !s.is_empty()) {
            if lo.as_deref().is_none_or(|cur| version_key(m) > version_key(cur)) {
                lo = Some(m.to_string());
            }
        }
        if let Some(m) = max.as_deref().filter(|s| !s.is_empty()) {
            if hi.as_deref().is_none_or(|cur| version_key(m) < version_key(cur)) {
                hi = Some(m.to_string());
            }
        }
    }
    (lo, hi)
}

/// 프로필 로더 버전이 모드가 요구하는 [min, max] 범위 내인지 (Electron checkLoaderVersionCompatibility).
/// min/max가 없거나 빈 문자열이면 해당 제약 없음. resolve_loader_for_updates가 재사용한다.
fn loader_version_ok(current: &str, min: Option<&str>, max: Option<&str>) -> bool {
    let cur = version_key(current);
    let above_min = match min.filter(|m| !m.is_empty()) {
        Some(m) => cur >= version_key(m),
        None => true,
    };
    let below_max = match max.filter(|m| !m.is_empty()) {
        Some(m) => cur <= version_key(m),
        None => true,
    };
    above_min && below_max
}

/// 이 모드를 확인 대상에 포함할지: 기설치는 서버와 무관하게 항상, 미설치는 (인증 서버 + required)일 때만.
fn should_include_mod(installed: bool, category: &str, has_authorized_server: bool) -> bool {
    installed || (has_authorized_server && category == "required")
}

// ── 로컬 상태 ────────────────────────────────────────────

/// mods/에서 `{modId}-*.jar` 파일 목록 (TS `^{modId}-.*\.jar$` 동일 — 하이픈 필수).
/// 하이픈을 요구해야 modId가 다른 modId의 프리픽스일 때 오검출/오삭제를 막는다
/// (예: "hyeni"가 "hyenihelper-*.jar"를 잡지 않도록).
pub fn find_mod_files(mods_dir: &Path, mod_id: &str) -> Vec<std::path::PathBuf> {
    let mut out = Vec::new();
    let Ok(rd) = std::fs::read_dir(mods_dir) else { return out };
    let prefix = format!("{}-", mod_id.to_lowercase());
    for entry in rd.flatten() {
        let name = entry.file_name().to_string_lossy().to_lowercase();
        if name.starts_with(&prefix) && name.ends_with(".jar") {
            out.push(entry.path());
        }
    }
    out
}

pub fn local_mod_version(mods_dir: &Path, mod_id: &str) -> Option<String> {
    let files = find_mod_files(mods_dir, mod_id);
    let first = files.first()?;
    let stem = first.file_stem()?.to_string_lossy();
    parse_mod_version(&stem)
}

// ── 체크/설치 ────────────────────────────────────────────

/// 워커 모드 업데이트 확인. 로더 버전 호환(min/maxLoaderVersion)은 여기서 필터하지 않고,
/// 각 업데이트에 min/max를 실어 `resolve_loader_for_updates`가 로더 상향을 판단하게 한다.
/// - `include_all`: true면 적용 가능한 모든 모드를 확인(실행 전 자동 업데이트 — Electron checkAllMods).
///   false면 아래 게이트를 적용(수동 패널 — Electron checkAllModUpdates).
/// - `has_authorized_server`: (include_all=false일 때) 신규(미설치) 모드는 인증 서버 + required일 때만
///   포함. 기설치 모드는 서버와 무관하게 항상 확인(서버 미등록이어도 구버전 방치 방지).
pub async fn check_all_updates(
    http: &reqwest::Client,
    worker_base: &str,
    mods_dir: &Path,
    game_version: &str,
    loader_type: &str,
    include_all: bool,
    has_authorized_server: bool,
) -> Result<Vec<WorkerModUpdate>, LauncherError> {
    let registry: RegistryResponse = http
        .get(format!("{worker_base}/api/v2/mods"))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;

    let mut updates = Vec::new();
    for item in registry.mods {
        // 설치 여부는 파일 존재로 판정 — 버전 파싱이 실패해도(예: `-1.0-SNAPSHOT` 등
        // 비정형 버전) 설치된 모드를 '미설치'로 오인하지 않게 한다.
        let installed = !find_mod_files(mods_dir, &item.id).is_empty();

        // 게이트: include_all(실행 전)은 모두 확인. 그 외(수동 패널)는 기설치 → 항상,
        // 미설치 → (인증 서버 + required)일 때만 (Electron 동일)
        if !include_all && !should_include_mod(installed, &item.category, has_authorized_server) {
            continue;
        }

        let latest: LatestResponse = match http
            .get(format!("{worker_base}/api/v2/mods/{}/latest", item.id))
            .query(&[("gameVersion", game_version), ("loader", loader_type)])
            .send()
            .await
            .and_then(|r| r.error_for_status())
        {
            Ok(resp) => match resp.json().await {
                Ok(v) => v,
                Err(e) => {
                    log::warn!("[workermods] {} latest 응답 파싱 실패(스킵): {e}", item.id);
                    continue;
                }
            },
            Err(e) => {
                log::warn!("[workermods] {} latest 조회 실패(스킵): {e}", item.id);
                continue;
            }
        };

        // 로더/게임버전 지원 여부
        let Some(file_info) = latest
            .loaders
            .get(loader_type)
            .and_then(|l| l.game_versions.get(game_version))
        else {
            continue;
        };

        let local = local_mod_version(mods_dir, &item.id);
        let needs_update = match (installed, &local) {
            (false, _) => true,                                   // 미설치 → 신규
            (true, Some(lv)) => is_newer_version(&latest.version, lv),
            (true, None) => true, // 설치됐으나 버전 미상 → 업데이트 권장(최신으로)
        };
        if !needs_update {
            continue;
        }

        updates.push(WorkerModUpdate {
            mod_id: item.id.clone(),
            mod_name: latest
                .name
                .clone()
                .or(item.name.clone())
                .unwrap_or_else(|| item.id.clone()),
            is_installed: installed,
            current_version: local,
            latest_version: latest.version.clone(),
            category: item.category.clone(),
            changelog: latest.changelog.clone(),
            file: file_info.file.clone(),
            sha256: file_info.sha256.clone(),
            size: file_info.size,
            loader_type: loader_type.to_string(),
            game_version: game_version.to_string(),
            min_loader_version: file_info.min_loader_version.clone(),
            max_loader_version: file_info.max_loader_version.clone(),
            required_loader_version: None,
        });
    }
    log::info!(
        "워커 모드 체크 완료: {} 업데이트 필요 (게임 {game_version}, 로더 {loader_type})",
        updates.len()
    );
    Ok(updates)
}

/// 로더 이동 결과(범위를 만족하는 버전으로 상향/하향).
#[derive(Debug, Clone)]
pub struct LoaderBump {
    pub version: String,
}

/// updates의 로더 범위 교집합과 현재 loader_version을 비교해 필요 시 이동할 버전을 계산.
/// loader_version은 자유 변수 — game_version·loader_type만 고정하고, 교집합 [min,max]를
/// 만족하도록 위/아래 어느 방향으로든 이동한다.
/// - Ok(None): 변경 불필요(제약 없음 / 현재가 이미 범위 내 / 자동교체 미지원 로더).
/// - Ok(Some): loader_version을 이 값으로 이동해야 함([min,max] 내 최신 안정 릴리스,
///   설치용 전체 형식). 범위 밖이면 위/아래 어디든 이동하며, 내릴 땐 범위 내 최신 =
///   최소한의 다운그레이드가 된다.
/// - Err: 범위를 만족하는 설치 가능한 로더가 없음.
///
/// forge는 `{mc}-{build}` 형식이라 비교 시 build 부분만 정규화해 쓰고, 반환은 전체 형식.
/// fabric/neoforge는 정규화가 항등(그대로 비교).
pub async fn resolve_loader_for_updates(
    http: &reqwest::Client,
    loader_type: &str,
    game_version: &str,
    current_loader_version: &str,
    updates: &[WorkerModUpdate],
) -> Result<Option<LoaderBump>, LauncherError> {
    // fabric/neoforge/forge 외에는 자동 교체 미지원 → 변경 없음.
    if !matches!(loader_type, "fabric" | "neoforge" | "forge") {
        return Ok(None);
    }
    // forge만 mc 프리픽스를 떼어 build 부분끼리 비교. 그 외는 항등.
    let norm = |v: &str| -> String {
        if loader_type == "forge" {
            crate::loader::forge_build_part(v, game_version).to_string()
        } else {
            v.to_string()
        }
    };

    let ranges: Vec<(Option<String>, Option<String>)> = updates
        .iter()
        .map(|u| {
            (
                u.min_loader_version.as_deref().map(&norm),
                u.max_loader_version.as_deref().map(&norm),
            )
        })
        .collect();
    let (lo, hi) = loader_range_intersection(&ranges);
    if lo.is_none() && hi.is_none() {
        return Ok(None); // 제약 없음
    }
    let cur = norm(current_loader_version);
    if !cur.is_empty() && loader_version_ok(&cur, lo.as_deref(), hi.as_deref()) {
        return Ok(None); // 이미 범위 내
    }

    let candidates_full =
        crate::loader::installable_loader_versions(http, loader_type, game_version).await?;
    let normalized: Vec<String> = candidates_full.iter().map(|c| norm(c)).collect();
    match newest_in_range(&normalized, lo.as_deref(), hi.as_deref()) {
        Some(win) => {
            // 정규화형 승자에 대응하는 전체 형식 후보를 되찾아 설치용으로 반환.
            let full = candidates_full
                .iter()
                .find(|c| norm(c) == win)
                .cloned()
                .unwrap_or(win);
            Ok(Some(LoaderBump { version: full }))
        }
        None => Err(LauncherError::Other(format!(
            "모드가 요구하는 로더 버전({}~{})을 설치할 수 없습니다.",
            lo.as_deref().unwrap_or("*"),
            hi.as_deref().unwrap_or("*"),
        ))),
    }
}

/// 쿼리 파라미터 값용 percent-encoding(RFC 3986 unreserved만 남기고 나머지 %XX).
/// 토큰은 base64라 `+`/`/`/`=`를 포함할 수 있는데, 인코딩하지 않으면 쿼리에서 `+`가 공백으로
/// 해석되어 서버가 잘못된 토큰을 받는다(다운로드 401의 원인). 팩·모드 다운로드 URL 공용.
pub fn encode_query_value(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

pub fn download_url(worker_base: &str, update: &WorkerModUpdate, token: &str) -> String {
    let loader_type = &update.loader_type;
    let game_version = &update.game_version;
    let encoded = encode_query_value(token);
    format!(
        "{worker_base}/download/v2/mods/{}/versions/{}/{loader_type}/{game_version}/{}?token={encoded}",
        update.mod_id, update.latest_version, update.file
    )
}

/// 워커 모드 다운로드 실패를 사용자 친화 메시지로 변환 (Electron worker-mod-updater.ts와 동일 매핑).
/// 401/403 = 토큰 만료·무효 → /인증 재인증 안내, 404 = 서버에 파일 없음. 그 외는 원본 사유 유지.
fn map_worker_download_error(e: LauncherError) -> LauncherError {
    match &e {
        LauncherError::DownloadFailed { status: Some(401 | 403), .. } => LauncherError::Other(
            "인증이 만료되었거나 유효하지 않습니다.\n\nDiscord에서 /인증 명령어로 재인증해주세요.".into(),
        ),
        LauncherError::DownloadFailed { status: Some(404), .. } => LauncherError::Other(
            "모드 파일을 서버에서 찾을 수 없습니다. 잠시 후 다시 시도해주세요.".into(),
        ),
        _ => e,
    }
}

/// 모드별 설치 결과 — 렌더러(useWorkerModUpdates)가 `{modId, success, error}[]`로 소비.
/// Electron WorkerModInstallResult와 동일 계약(한 모드 실패해도 나머지는 계속 시도).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallResult {
    pub mod_id: String,
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// 선택 업데이트 설치 — sha256 검증 다운로드 후 구버전 파일 제거. 모드별로 성공/실패를 누적하며,
/// 한 모드가 실패해도 전체를 중단하지 않는다(Electron installMultipleMods의 per-mod try/catch).
/// 반환 Result의 Err은 mods 디렉터리 생성 실패 같은 설정 단계 오류에만 쓴다.
pub async fn install_updates(
    http: &reqwest::Client,
    worker_base: &str,
    mods_dir: &Path,
    updates: &[WorkerModUpdate],
    token: &str,
    cfg: &DownloadConfig,
    on_progress: impl Fn(&str, u32) + Send + Sync,
) -> Result<Vec<InstallResult>, LauncherError> {
    std::fs::create_dir_all(mods_dir)?;
    let mut results = Vec::new();
    for update in updates {
        log::info!(
            "워커 모드 설치: {} {} → {} ({}/{})",
            update.mod_id,
            update.current_version.as_deref().unwrap_or("없음"),
            update.latest_version,
            update.loader_type,
            update.file
        );
        on_progress(&update.mod_id, 0);
        // 구버전 파일 목록 (설치 후 제거 — 새 파일과 이름이 같으면 덮어써지므로 제외)
        let old_files: Vec<_> = find_mod_files(mods_dir, &update.mod_id)
            .into_iter()
            .filter(|p| p.file_name().map(|n| n.to_string_lossy() != update.file.as_str()).unwrap_or(true))
            .collect();

        let dest = mods_dir.join(&update.file);
        let dl = download_all(
            http,
            vec![DownloadTask {
                url: download_url(worker_base, update, token),
                dest,
                sha1: None,
                sha256: update.sha256.clone(),
                size: update.size,
                // 모드 업데이트는 설치 의도 — 기존 파일 체크섬이 같아도 스킵하지 않고 항상 새로 받는다
                force: true,
            }],
            cfg,
            |_| {},
        )
        .await
        .map_err(map_worker_download_error);

        match dl {
            Ok(_) => {
                for old in old_files {
                    let _ = std::fs::remove_file(&old);
                }
                on_progress(&update.mod_id, 100);
                results.push(InstallResult { mod_id: update.mod_id.clone(), success: true, error: None });
            }
            Err(e) => {
                log::warn!("워커 모드 설치 실패: {} — {e}", update.mod_id);
                results.push(InstallResult {
                    mod_id: update.mod_id.clone(),
                    success: false,
                    error: Some(e.to_string()),
                });
            }
        }
    }
    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn newest_in_range_supports_downgrade_target() {
        // 현재 로더(0.17.0)가 max(0.16.5)를 초과하는 상황에서 로더가 내려가야 할 때,
        // 후보 중 [*,0.16.5] 내 최신(=최소한의 다운그레이드)이 선택되는지 고정.
        let c = vec!["0.15.0".to_string(), "0.16.0".to_string(), "0.16.5".to_string(), "0.17.0".to_string()];
        assert_eq!(newest_in_range(&c, None, Some("0.16.5")).as_deref(), Some("0.16.5"));
    }

    #[test]
    fn newest_in_range_picks_highest_within_bounds() {
        let c = vec!["0.16.5".to_string(), "0.16.10".to_string(), "0.17.0".to_string(), "0.15.0".to_string()];
        assert_eq!(newest_in_range(&c, Some("0.16.0"), Some("0.16.10")).as_deref(), Some("0.16.10"));
        assert_eq!(newest_in_range(&c, Some("0.16.0"), None).as_deref(), Some("0.17.0"));
        assert_eq!(newest_in_range(&c, None, Some("0.15.0")).as_deref(), Some("0.15.0"));
        assert_eq!(newest_in_range(&c, Some("0.18.0"), None), None);          // 범위 밖
        assert_eq!(newest_in_range(&c, Some(""), Some("")).as_deref(), Some("0.17.0")); // 빈=제약없음
    }

    #[test]
    fn loader_range_intersection_narrows() {
        let ranges = vec![
            (Some("0.16.0".to_string()), None),
            (Some("0.15.0".to_string()), Some("0.17.0".to_string())),
            (None, Some("0.16.10".to_string())),
        ];
        let (lo, hi) = loader_range_intersection(&ranges);
        assert_eq!(lo.as_deref(), Some("0.16.0"));  // max of mins
        assert_eq!(hi.as_deref(), Some("0.16.10")); // min of maxs
    }

    #[test]
    fn loader_range_intersection_none_when_unconstrained() {
        let ranges = vec![(None, None), (Some(String::new()), Some(String::new()))];
        let (lo, hi) = loader_range_intersection(&ranges);
        assert_eq!(lo, None);
        assert_eq!(hi, None);
    }

    #[test]
    fn forge_build_part_strips_mc_prefix_for_comparison() {
        use crate::loader::forge_build_part;
        assert_eq!(forge_build_part("1.20.1-47.4.20", "1.20.1"), "47.4.20");
        assert_eq!(forge_build_part("47.4.20", "1.20.1"), "47.4.20"); // build-only 입력은 그대로
        // build 부분만 비교하면 47.4.20 > 47.4.9 로 정상 정렬(문자열 비교였다면 47.4.9가 뒤).
        let c = vec!["1.20.1-47.4.20".to_string(), "1.20.1-47.4.9".to_string()];
        let norm: Vec<String> = c.iter().map(|v| forge_build_part(v, "1.20.1").to_string()).collect();
        assert_eq!(newest_in_range(&norm, Some("47.4.0"), None).as_deref(), Some("47.4.20"));
    }

    #[test]
    fn parses_versions_from_filenames() {
        assert_eq!(parse_mod_version("hyenihelper-fabric-1.21.1-1.0.5").as_deref(), Some("1.0.5"));
        assert_eq!(parse_mod_version("hyenihelper-1.0.0").as_deref(), Some("1.0.0"));
        assert_eq!(parse_mod_version("hyenicore-neoforge-2.0.1").as_deref(), Some("2.0.1"));
        assert_eq!(parse_mod_version("FastSuite-1.21.1-6.0.5").as_deref(), Some("6.0.5"));
        assert_eq!(parse_mod_version("no-version-here"), None);
    }

    #[test]
    fn newer_version_comparison() {
        assert!(is_newer_version("1.0.5", "1.0.4"));
        assert!(!is_newer_version("1.0.5", "1.0.5"));
        assert!(!is_newer_version("1.0.4", "1.0.5")); // 다운그레이드 없음
        assert!(is_newer_version("1.10.0", "1.9.9"));
    }

    #[test]
    fn newer_version_prerelease_semantics() {
        // 정식이 같은 x.y.z의 프리릴리즈보다 최신 — beta 설치자가 정식을 받아야 함
        assert!(is_newer_version("1.2.3", "1.2.3-beta001"));
        assert!(!is_newer_version("1.2.3-beta001", "1.2.3"));
        // 프리릴리즈끼리: 번호 증가, 레이블 단계(alpha<beta<pre)
        assert!(is_newer_version("1.2.3-beta002", "1.2.3-beta001"));
        assert!(is_newer_version("1.2.3-pre001", "1.2.3-beta005"));
        assert!(is_newer_version("1.2.3-beta001", "1.2.3-alpha009"));
        // 상위 x.y.z의 프리릴리즈 > 하위 정식 (핀으로 의도 배포 시 업데이트 동작)
        assert!(is_newer_version("1.2.4-alpha001", "1.2.3"));
        assert!(!is_newer_version("1.2.3-pre001", "1.2.4"));
        // 레거시 SNAPSHOT: 같은 자릿수 정식이 더 최신
        assert!(is_newer_version("1.0.0", "1.0-SNAPSHOT"));
        // 미인식 접미사(forge 풀 형식 등)는 기존 숫자 세그먼트 동작 유지
        assert!(is_newer_version("1.20.1-47.3.0", "1.20.1-47.2.0"));
    }

    #[test]
    fn deserializes_registry_and_latest() {
        let reg: RegistryResponse = serde_json::from_str(
            r#"{"version":"2","mods":[{"id":"hyenihelper","name":"HyeniHelper","latestVersion":"1.0.5",
                 "description":"","category":"required","gameVersions":["1.21.1"],"loaders":[]}],
                 "lastUpdated":"x"}"#,
        )
        .unwrap();
        assert_eq!(reg.mods[0].id, "hyenihelper");
        assert_eq!(reg.mods[0].category, "required");

        let latest: LatestResponse = serde_json::from_str(
            r#"{"version":"1.0.5","name":"HyeniHelper","modId":"hyenihelper","gameVersions":["1.21.1"],
                "releaseDate":"x","changelog":"fix",
                "loaders":{"neoforge":{"gameVersions":{"1.21.1":
                  {"file":"hyenihelper-neoforge-1.21.1-1.0.5.jar","sha256":"ab","size":10,
                   "downloadPath":"p","downloadUrl":"u","minLoaderVersion":"1"}}}}}"#,
        )
        .unwrap();
        let fi = &latest.loaders["neoforge"].game_versions["1.21.1"];
        assert_eq!(fi.file, "hyenihelper-neoforge-1.21.1-1.0.5.jar");
    }

    #[test]
    fn encode_query_value_escapes_base64() {
        // base64 토큰의 +//= 가 percent-encode 되어야 함(팩·모드 다운로드 공용 — 401 방지)
        assert_eq!(encode_query_value("v+CDG/h6I="), "v%2BCDG%2Fh6I%3D");
        assert_eq!(encode_query_value("plain-token_1.0"), "plain-token_1.0");
    }

    #[test]
    fn download_url_encodes_token() {
        let u = WorkerModUpdate {
            mod_id: "hyenihelper".into(),
            mod_name: "H".into(),
            current_version: None,
            latest_version: "1.0.5".into(),
            is_installed: false,
            category: "required".into(),
            changelog: None,
            file: "h.jar".into(),
            sha256: None,
            size: None,
            loader_type: "neoforge".into(),
            game_version: "1.21.1".into(),
            min_loader_version: None,
            max_loader_version: None,
            required_loader_version: None,
        };
        let url = download_url("https://w", &u, "a+b/c=");
        assert!(url.ends_with("?token=a%2Bb%2Fc%3D"));
        assert!(url.contains("/download/v2/mods/hyenihelper/versions/1.0.5/neoforge/1.21.1/h.jar"));
    }

    #[test]
    fn worker_mod_update_serde_loader_fields() {
        let u = WorkerModUpdate {
            mod_id: "m".into(),
            mod_name: "M".into(),
            current_version: None,
            latest_version: "1.0.0".into(),
            is_installed: true,
            category: "required".into(),
            changelog: None,
            file: "m.jar".into(),
            sha256: None,
            size: None,
            loader_type: "neoforge".into(),
            game_version: "1.21.1".into(),
            min_loader_version: Some("21.1.0".into()),
            max_loader_version: None,
            required_loader_version: Some("21.1.186".into()),
        };
        let json = serde_json::to_string(&u).unwrap();
        assert!(json.contains("\"minLoaderVersion\":\"21.1.0\""));
        assert!(json.contains("\"requiredLoaderVersion\":\"21.1.186\""));
        // 렌더러가 되돌려 보낼 때 로더 필드가 없어도 역직렬화 성공(기본값 None)
        let back: WorkerModUpdate = serde_json::from_str(
            r#"{"modId":"m","modName":"M","currentVersion":null,"latestVersion":"1.0.0","isInstalled":true,"category":"required","file":"m.jar","loaderType":"neoforge","gameVersion":"1.21.1"}"#,
        ).unwrap();
        assert_eq!(back.min_loader_version, None);
        assert_eq!(back.required_loader_version, None);
    }

    #[test]
    fn local_version_from_mods_dir() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("hyenihelper-neoforge-1.21.1-1.0.4.jar"), b"x").unwrap();
        std::fs::write(tmp.path().join("other-mod-2.0.0.jar"), b"x").unwrap();
        assert_eq!(local_mod_version(tmp.path(), "hyenihelper").as_deref(), Some("1.0.4"));
        assert_eq!(local_mod_version(tmp.path(), "hyenicore"), None);
    }

    #[test]
    fn parses_x_y_snapshot_version() {
        // HAF `-1.0-SNAPSHOT`: x.y(2자리) + pre-release 접미사를 표시용으로 포함
        assert_eq!(parse_mod_version("HyeniAdditionalFunctions-neoforge-1.0-SNAPSHOT").as_deref(), Some("1.0-SNAPSHOT"));
        // 3자리가 있으면 그쪽을 우선, 로더명(neoforge)은 접미사로 붙지 않음
        assert_eq!(parse_mod_version("hyenihelper-neoforge-1.21.1-1.0.1").as_deref(), Some("1.0.1"));
        assert_eq!(parse_mod_version("HyeniAdditionalFunctions-neoforge-1.0.2").as_deref(), Some("1.0.2"));
        // SNAPSHOT은 숫자 비교 시 무시되어 업데이트 감지 정상
        assert!(is_newer_version("1.0.5", "1.0-SNAPSHOT"));
    }

    #[test]
    fn installed_detected_even_when_version_unparseable() {
        // SNAPSHOT jar도 설치로 인식(파일 존재 기준) + 표시 버전에 접미사 포함
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("HyeniAdditionalFunctions-neoforge-1.0-SNAPSHOT.jar"), b"x").unwrap();
        assert!(!find_mod_files(tmp.path(), "hyeniadditionalfunctions").is_empty());
        assert_eq!(local_mod_version(tmp.path(), "hyeniadditionalfunctions").as_deref(), Some("1.0-SNAPSHOT"));
    }

    #[test]
    fn loader_version_compat() {
        assert!(loader_version_ok("21.1.50", Some("21.1.0"), None));
        assert!(!loader_version_ok("21.0.9", Some("21.1.0"), None)); // 최소 미달
        assert!(loader_version_ok("21.1.50", Some("21.1.0"), Some("21.2.0")));
        assert!(!loader_version_ok("21.3.0", Some("21.1.0"), Some("21.2.0"))); // 최대 초과
        assert!(loader_version_ok("21.1.50", None, None)); // 제약 없음
        assert!(loader_version_ok("21.1.50", Some(""), Some(""))); // 빈 문자열 = 제약 없음
    }

    #[test]
    fn mod_inclusion_gate() {
        // 기설치는 서버 미인증이어도 항상 포함(구버전 방치 방지)
        assert!(should_include_mod(true, "required", false));
        assert!(should_include_mod(true, "optional", false));
        // 미설치: 인증 서버 + required만 포함
        assert!(should_include_mod(false, "required", true));
        assert!(!should_include_mod(false, "required", false)); // 서버 미인증
        assert!(!should_include_mod(false, "optional", true)); // optional 신규는 제외
    }

    #[test]
    fn find_requires_hyphen_no_prefix_false_positive() {
        // M5-1 회귀: "hyeni"가 "hyenihelper-*.jar"를 잡으면 안 됨 (오삭제 방지)
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("hyenihelper-neoforge-1.21.1-1.0.5.jar"), b"x").unwrap();
        std::fs::write(tmp.path().join("hyenicore-2.0.0.jar"), b"x").unwrap();
        std::fs::write(tmp.path().join("hyeni-1.0.0.jar"), b"x").unwrap();

        let hyeni = find_mod_files(tmp.path(), "hyeni");
        assert_eq!(hyeni.len(), 1, "hyeni는 hyeni-만 잡아야 함");
        assert!(hyeni[0].file_name().unwrap().to_string_lossy().starts_with("hyeni-1"));

        assert_eq!(find_mod_files(tmp.path(), "hyenihelper").len(), 1);
    }

    #[tokio::test]
    async fn latest_request_includes_env_query() {
        use std::sync::{Arc, Mutex};

        let registry = r#"{"version":"2","mods":[{"id":"hyenihelper","name":"HyeniHelper",
            "latestVersion":"1.0.5","description":"","category":"required",
            "gameVersions":["1.21.1"],"loaders":[]}],"lastUpdated":"x"}"#;
        let latest = r#"{"version":"1.0.5","name":"HyeniHelper","modId":"hyenihelper",
            "gameVersions":["1.21.1"],"releaseDate":"x","changelog":"fix",
            "loaders":{"neoforge":{"gameVersions":{"1.21.1":
              {"file":"hyenihelper-neoforge-1.21.1-1.0.5.jar","sha256":"ab","size":10,
               "downloadPath":"p","downloadUrl":"u","minLoaderVersion":"1"}}}}}"#;

        // 서버가 받은 요청 URL(경로+쿼리)을 기록 → latest 요청의 쿼리를 검증
        let seen: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let seen_srv = seen.clone();
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let addr = format!("http://{}", server.server_addr());
        std::thread::spawn(move || {
            for req in server.incoming_requests() {
                let url = req.url().to_string();
                seen_srv.lock().unwrap().push(url.clone());
                let body = if url.starts_with("/api/v2/mods/") && url.contains("/latest") {
                    latest
                } else {
                    registry
                };
                let _ = req.respond(tiny_http::Response::from_string(body));
            }
        });

        let tmp = tempfile::tempdir().unwrap();
        let http = reqwest::Client::new();
        let updates = check_all_updates(
            &http, &addr, tmp.path(),
            "1.21.1", "neoforge", true, false,
        )
        .await
        .unwrap();

        // 응답 처리·로컬 매칭 불변: 미설치 모드가 업데이트 목록에 그대로 잡힌다
        assert_eq!(updates.len(), 1);
        assert_eq!(updates[0].mod_id, "hyenihelper");

        // latest 요청에 프로필 환경 쿼리(gameVersion·loader)가 실려야 함
        let latest_url = seen
            .lock()
            .unwrap()
            .iter()
            .find(|u| u.contains("/latest"))
            .cloned()
            .expect("latest 요청이 서버에 도달해야 함");
        assert!(latest_url.contains("gameVersion=1.21.1"), "실제 URL: {latest_url}");
        assert!(latest_url.contains("loader=neoforge"), "실제 URL: {latest_url}");
    }
}
