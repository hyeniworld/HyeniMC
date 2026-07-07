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

fn version_key(v: &str) -> Vec<u32> {
    v.split(['.', '-', '+'])
        .filter_map(|p| p.parse::<u32>().ok())
        .collect()
}

/// remote가 local보다 최신인가 (동일/구버전이면 false — 다운그레이드 없음)
pub fn is_newer_version(remote: &str, local: &str) -> bool {
    version_key(remote) > version_key(local)
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

pub async fn check_all_updates(
    http: &reqwest::Client,
    worker_base: &str,
    mods_dir: &Path,
    game_version: &str,
    loader_type: &str,
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
        let latest: LatestResponse = match http
            .get(format!("{worker_base}/api/v2/mods/{}/latest", item.id))
            .send()
            .await
            .and_then(|r| r.error_for_status())
        {
            Ok(resp) => match resp.json().await {
                Ok(v) => v,
                Err(_) => continue,
            },
            Err(_) => continue,
        };

        // 로더/게임버전 지원 여부
        let Some(file_info) = latest
            .loaders
            .get(loader_type)
            .and_then(|l| l.game_versions.get(game_version))
        else {
            continue;
        };

        // 설치 여부는 파일 존재로 판정 — 버전 파싱이 실패해도(예: `-1.0-SNAPSHOT` 등
        // 비정형 버전) 설치된 모드를 '미설치'로 오인하지 않게 한다.
        let installed = !find_mod_files(mods_dir, &item.id).is_empty();
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
        });
    }
    log::info!(
        "워커 모드 체크 완료: {} 업데이트 필요 (게임 {game_version}, 로더 {loader_type})",
        updates.len()
    );
    Ok(updates)
}

pub fn download_url(worker_base: &str, update: &WorkerModUpdate, token: &str) -> String {
    let loader_type = &update.loader_type;
    let game_version = &update.game_version;
    let encoded: String = token
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect();
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

/// 선택 업데이트 설치 — sha256 검증 다운로드 후 구버전 파일 제거.
pub async fn install_updates(
    http: &reqwest::Client,
    worker_base: &str,
    mods_dir: &Path,
    updates: &[WorkerModUpdate],
    token: &str,
    cfg: &DownloadConfig,
    on_progress: impl Fn(&str, u32) + Send + Sync,
) -> Result<Vec<String>, LauncherError> {
    std::fs::create_dir_all(mods_dir)?;
    let mut installed = Vec::new();
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
        download_all(
            http,
            vec![DownloadTask {
                url: download_url(worker_base, update, token),
                dest,
                sha1: None,
                sha256: update.sha256.clone(),
                size: update.size,
            }],
            cfg,
            |_| {},
        )
        .await
        .map_err(map_worker_download_error)?;

        for old in old_files {
            let _ = std::fs::remove_file(&old);
        }
        on_progress(&update.mod_id, 100);
        installed.push(update.mod_id.clone());
    }
    Ok(installed)
}

#[cfg(test)]
mod tests {
    use super::*;

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
        };
        let url = download_url("https://w", &u, "a+b/c=");
        assert!(url.ends_with("?token=a%2Bb%2Fc%3D"));
        assert!(url.contains("/download/v2/mods/hyenihelper/versions/1.0.5/neoforge/1.21.1/h.jar"));
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
}
