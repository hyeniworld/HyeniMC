//! 모드로더 설치 — Fabric(meta API profile json) / NeoForge·Forge(installer client).
//! TS fabric-loader.ts / neoforge-loader.ts 의미 포팅.

use serde::{Deserialize, Serialize};

use crate::download::{download_all, DownloadConfig, DownloadTask};
use crate::install::GameDirs;
use crate::launch::maven_relative_path;
use crate::manifest::VersionDetail;
use crate::LauncherError;

const FABRIC_META: &str = "https://meta.fabricmc.net/v2/versions/loader";
const NEOFORGE_MAVEN: &str = "https://maven.neoforged.net/releases/net/neoforged/neoforge";
const FORGE_MAVEN: &str = "https://maven.minecraftforge.net/net/minecraftforge/forge";
const FABRIC_FALLBACK_REPOS: [&str; 2] =
    ["https://maven.fabricmc.net/", "https://repo1.maven.org/maven2/"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoaderVersion {
    pub version: String,
    pub stable: bool,
}

pub fn fabric_version_id(game: &str, loader: &str) -> String {
    format!("fabric-loader-{loader}-{game}")
}

pub fn neoforge_version_id(version: &str) -> String {
    format!("neoforge-{version}")
}

/// Forge maven 버전 `1.20.1-47.4.20` → installer가 생성하는 버전 id `1.20.1-forge-47.4.20`.
pub fn forge_version_id(forge_maven_version: &str) -> String {
    match forge_maven_version.split_once('-') {
        Some((mc, build)) => format!("{mc}-forge-{build}"),
        None => forge_maven_version.to_string(),
    }
}

/// Forge maven 버전이 주어진 MC 버전용인지 — `<mc>-<build>` 프리픽스 매칭.
pub fn forge_matches_mc(forge_version: &str, mc_version: &str) -> bool {
    forge_version.starts_with(&format!("{mc_version}-"))
}

/// MC 버전 → 매칭할 NeoForge 버전 프리픽스(끝에 `.` 포함).
///
/// NeoForge 버전 넘버링은 MC 버전 체계를 따라간다(실측 확인, 2026):
/// - 구형 MC `1.21.1` → NeoForge `21.1.<build>` (3세그먼트) → prefix `"21.1."`
/// - 구형 MC `1.21`   → NeoForge `21.0.<build>`            → prefix `"21.0."`
/// - 신형 MC `26.2`   → NeoForge `26.2.0.<build>` (4세그)  → prefix `"26.2.0."`
/// - 신형 MC `26.1.2` → NeoForge `26.1.2.<build>`          → prefix `"26.1.2."`
fn neoforge_prefix_for_mc(mc_version: &str) -> Option<String> {
    if let Some(rest) = mc_version.strip_prefix("1.") {
        // 구형: 앞의 "1." 제거 후 major.minor (minor 없으면 0)
        let mut parts = rest.split('.');
        let major = parts.next().filter(|s| !s.is_empty())?;
        let minor = parts.next().unwrap_or("0");
        Some(format!("{major}.{minor}."))
    } else {
        // 신형: major.minor[.patch] 그대로 (patch 없으면 0)
        let mut parts = mc_version.split('.');
        let major = parts.next().filter(|s| !s.is_empty())?;
        let minor = parts.next().filter(|s| !s.is_empty())?;
        let patch = parts.next().unwrap_or("0");
        Some(format!("{major}.{minor}.{patch}."))
    }
}

/// NeoForge 버전이 주어진 MC 버전에 해당하는지 (신·구 버전 체계 모두 지원).
pub fn neoforge_matches_mc(neoforge_version: &str, mc_version: &str) -> bool {
    neoforge_prefix_for_mc(mc_version)
        .is_some_and(|prefix| neoforge_version.starts_with(&prefix))
}

/// maven-metadata.xml에서 <version> 태그 추출 (XML 의존 없이)
pub fn parse_maven_versions(xml: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = xml;
    while let Some(start) = rest.find("<version>") {
        rest = &rest[start + "<version>".len()..];
        if let Some(end) = rest.find("</version>") {
            out.push(rest[..end].trim().to_string());
            rest = &rest[end..];
        } else {
            break;
        }
    }
    out
}

#[derive(Debug, Deserialize)]
struct FabricLoaderEntry {
    loader: FabricLoaderInfo,
}

#[derive(Debug, Deserialize)]
struct FabricLoaderInfo {
    version: String,
    #[serde(default)]
    stable: bool,
}

pub async fn fabric_loader_versions(
    http: &reqwest::Client,
    game_version: &str,
) -> Result<Vec<LoaderVersion>, LauncherError> {
    let entries: Vec<FabricLoaderEntry> = http
        .get(format!("{FABRIC_META}/{game_version}"))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    Ok(entries
        .into_iter()
        .map(|e| LoaderVersion { version: e.loader.version, stable: e.loader.stable })
        .collect())
}

pub async fn neoforge_versions(http: &reqwest::Client) -> Result<Vec<String>, LauncherError> {
    let xml = http
        .get(format!("{NEOFORGE_MAVEN}/maven-metadata.xml"))
        .send()
        .await?
        .error_for_status()?
        .text()
        .await?;
    Ok(parse_maven_versions(&xml))
}

/// forge 메이븐 버전(`{mc}-{build}`, 예 `1.20.1-47.4.20`)에서 `{mc}-` 프리픽스를 떼어 build만 남긴다.
/// 프리픽스가 없으면(build-only 입력) 원본 그대로. 비교(version_key)가 build끼리 이뤄지게 정규화.
pub fn forge_build_part<'a>(version: &'a str, mc_version: &str) -> &'a str {
    version.strip_prefix(&format!("{mc_version}-")).unwrap_or(version)
}

/// 주어진 로더/ MC 버전에 설치 가능한 로더 버전 목록(설치용 전체 형식). 자동 교체는
/// fabric/neoforge/forge만 지원(그 외는 빈 목록 → 로더 상향 없음).
pub async fn installable_loader_versions(
    http: &reqwest::Client,
    loader_type: &str,
    mc_version: &str,
) -> Result<Vec<String>, LauncherError> {
    match loader_type {
        "fabric" => Ok(fabric_loader_versions(http, mc_version)
            .await?
            .into_iter()
            .map(|v| v.version)
            .collect()),
        "neoforge" => Ok(neoforge_versions(http)
            .await?
            .into_iter()
            .filter(|v| neoforge_matches_mc(v, mc_version))
            .collect()),
        "forge" => forge_versions(http, mc_version).await, // 이미 mc 필터·전체 형식
        _ => Ok(Vec::new()),
    }
}

/// Fabric 설치 — profile json 저장 + 라이브러리 다운로드. 반환: 버전 id.
pub async fn install_fabric(
    http: &reqwest::Client,
    game_version: &str,
    loader_version: &str,
    dirs: &GameDirs,
    cfg: &DownloadConfig,
) -> Result<String, LauncherError> {
    let version_id = fabric_version_id(game_version, loader_version);
    let json_path = dirs.version_json(&version_id);

    if !json_path.exists() {
        let text = http
            .get(format!("{FABRIC_META}/{game_version}/{loader_version}/profile/json"))
            .send()
            .await?
            .error_for_status()?
            .text()
            .await?;
        if let Some(p) = json_path.parent() {
            tokio::fs::create_dir_all(p).await?;
        }
        tokio::fs::write(&json_path, &text).await?;
    }

    // 라이브러리 (fabric profile은 downloads 블록 없이 name+url 베이스만)
    let detail: VersionDetail =
        serde_json::from_str(&std::fs::read_to_string(&json_path)?)?;
    let mut tasks = Vec::new();
    for lib in &detail.libraries {
        let Some(rel) = maven_relative_path(&lib.name) else { continue };
        let dest = dirs.shared_libraries.join(&rel);
        if dest.exists() {
            continue;
        }
        let base = lib
            .url
            .clone()
            .unwrap_or_else(|| FABRIC_FALLBACK_REPOS[0].to_string());
        let base = if base.ends_with('/') { base } else { format!("{base}/") };
        tasks.push(DownloadTask { url: format!("{base}{rel}"), dest, sha1: None, sha256: None, size: None });
    }
    download_all(http, tasks, cfg, |_| {}).await?;
    Ok(version_id)
}

/// Forge 계열(NeoForge/Forge) installer 공통 실행 로직.
/// installer jar 다운로드 → `java -jar … <install_arg> <instance_dir>` → 버전 json 생성 확인.
#[allow(clippy::too_many_arguments)]
async fn run_forge_family_installer(
    http: &reqwest::Client,
    installer_url: String,
    installer_filename: String,
    install_arg: &str,
    version_id: String,
    loader_label: &str,
    java_path: &str,
    dirs: &GameDirs,
    cfg: &DownloadConfig,
    mut on_log: impl FnMut(String) + Send + 'static,
) -> Result<String, LauncherError> {
    if dirs.version_json(&version_id).exists() {
        return Ok(version_id);
    }

    // installer 요구사항: launcher_profiles.json 존재. 일부 installer 버전이 필드를
    // 요구하므로 Electron과 동일한 리치 형태로 생성(최소형 `{"profiles":{}}`은 거부 가능).
    tokio::fs::create_dir_all(&dirs.instance_dir).await?;
    let profiles_path = dirs.instance_dir.join("launcher_profiles.json");
    if !profiles_path.exists() {
        let profiles = serde_json::json!({
            "profiles": {},
            "selectedProfile": "(Default)",
            "clientToken": "00000000-0000-0000-0000-000000000000",
            "launcherVersion": { "name": "HyeniMC", "format": 21 }
        });
        tokio::fs::write(&profiles_path, serde_json::to_vec_pretty(&profiles)?).await?;
    }

    let installer = dirs.instance_dir.join(".temp").join(&installer_filename);
    download_all(
        http,
        vec![DownloadTask {
            url: installer_url,
            dest: installer.clone(),
            sha1: None,
            sha256: None,
            size: None,
        }],
        cfg,
        |_| {},
    )
    .await?;

    let mut cmd = tokio::process::Command::new(java_path);
    cmd.args([
        "-jar",
        &installer.display().to_string(),
        install_arg,
        &dirs.instance_dir.display().to_string(),
    ])
    .stdout(std::process::Stdio::piped())
    .stderr(std::process::Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW

    let output = cmd.output().await?;
    for line in String::from_utf8_lossy(&output.stdout)
        .lines()
        .chain(String::from_utf8_lossy(&output.stderr).lines())
    {
        if !line.trim().is_empty() {
            on_log(format!("[{loader_label}-installer] {line}"));
        }
    }
    let _ = tokio::fs::remove_file(&installer).await;

    if !output.status.success() {
        return Err(LauncherError::Other(format!(
            "{loader_label} installer 실패 (exit {:?})",
            output.status.code()
        )));
    }
    if !dirs.version_json(&version_id).exists() {
        return Err(LauncherError::Other(format!(
            "{loader_label} installer가 버전 json을 생성하지 않음"
        )));
    }
    Ok(version_id)
}

/// NeoForge 설치 — installer jar를 받아 `--install-client` 실행. 반환: 버전 id.
pub async fn install_neoforge(
    http: &reqwest::Client,
    neoforge_version: &str,
    java_path: &str,
    dirs: &GameDirs,
    cfg: &DownloadConfig,
    on_log: impl FnMut(String) + Send + 'static,
) -> Result<String, LauncherError> {
    run_forge_family_installer(
        http,
        format!("{NEOFORGE_MAVEN}/{neoforge_version}/neoforge-{neoforge_version}-installer.jar"),
        format!("neoforge-{neoforge_version}-installer.jar"),
        "--install-client",
        neoforge_version_id(neoforge_version),
        "NeoForge",
        java_path,
        dirs,
        cfg,
        on_log,
    )
    .await
}

/// Forge maven-metadata에서 주어진 MC 버전용 버전 목록(최신 정렬 전, maven 원순).
pub async fn forge_versions(
    http: &reqwest::Client,
    mc_version: &str,
) -> Result<Vec<String>, LauncherError> {
    let xml = http
        .get(format!("{FORGE_MAVEN}/maven-metadata.xml"))
        .send()
        .await?
        .error_for_status()?
        .text()
        .await?;
    Ok(parse_maven_versions(&xml)
        .into_iter()
        .filter(|v| forge_matches_mc(v, mc_version))
        .collect())
}

/// Forge 설치 — installer jar를 받아 `--installClient` 실행. 반환: 버전 id.
pub async fn install_forge(
    http: &reqwest::Client,
    forge_version: &str,
    java_path: &str,
    dirs: &GameDirs,
    cfg: &DownloadConfig,
    on_log: impl FnMut(String) + Send + 'static,
) -> Result<String, LauncherError> {
    run_forge_family_installer(
        http,
        format!("{FORGE_MAVEN}/{forge_version}/forge-{forge_version}-installer.jar"),
        format!("forge-{forge_version}-installer.jar"),
        "--installClient",
        forge_version_id(forge_version),
        "Forge",
        java_path,
        dirs,
        cfg,
        on_log,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_ids() {
        assert_eq!(fabric_version_id("1.21.1", "0.16.7"), "fabric-loader-0.16.7-1.21.1");
        assert_eq!(neoforge_version_id("21.1.213"), "neoforge-21.1.213");
    }

    #[test]
    fn neoforge_mc_mapping() {
        // 구형 (1.21.x → 21.1.<build>)
        assert!(neoforge_matches_mc("21.1.213", "1.21.1"));
        assert!(neoforge_matches_mc("21.1.213-beta", "1.21.1"));
        assert!(!neoforge_matches_mc("21.4.10", "1.21.1"));
        assert!(!neoforge_matches_mc("20.4.237", "1.21.1"));
        // 21.1 vs 21.10 혼동 방지 (prefix가 '.'로 끝나 경계 보장)
        assert!(!neoforge_matches_mc("21.10.5", "1.21.1"));
        assert!(neoforge_matches_mc("21.10.5", "1.21.10"));
        // 구형 patch 생략 1.21 → 21.0
        assert!(neoforge_matches_mc("21.0.153", "1.21"));
        assert!(!neoforge_matches_mc("21.1.234", "1.21"));
        // 신형 (26.x → 26.<minor>.<patch>.<build>, patch 없으면 0)
        assert!(neoforge_matches_mc("26.2.0.8-beta", "26.2"));
        assert!(!neoforge_matches_mc("26.1.2.78", "26.2"));
        assert!(neoforge_matches_mc("26.1.0.5", "26.1"));
        assert!(!neoforge_matches_mc("26.1.2.78", "26.1"));
        assert!(neoforge_matches_mc("26.1.2.78", "26.1.2"));
        assert!(!neoforge_matches_mc("26.1.1.9", "26.1.2"));
    }

    #[test]
    fn forge_version_id_and_matching() {
        // maven `<mc>-<build>` → installer id `<mc>-forge-<build>`
        assert_eq!(forge_version_id("1.20.1-47.4.20"), "1.20.1-forge-47.4.20");
        assert_eq!(forge_version_id("26.2-65.0.2"), "26.2-forge-65.0.2");
        // MC prefix 매칭('-' 경계로 1.20.1 vs 1.20.10 구분)
        assert!(forge_matches_mc("1.20.1-47.4.20", "1.20.1"));
        assert!(!forge_matches_mc("1.20.10-47.4.20", "1.20.1"));
        assert!(forge_matches_mc("26.2-65.0.2", "26.2"));
        assert!(!forge_matches_mc("1.19.2-43.2.0", "1.20.1"));
    }

    #[test]
    fn maven_metadata_parsing() {
        let xml = r#"<metadata><versioning><versions>
            <version>21.1.213</version>
            <version> 21.4.10-beta </version>
        </versions></versioning></metadata>"#;
        assert_eq!(parse_maven_versions(xml), vec!["21.1.213", "21.4.10-beta"]);
    }

    #[test]
    fn fabric_profile_json_parses_as_version_detail() {
        // 실제 fabric profile json 축약 형태
        let json = r#"{
          "id": "fabric-loader-0.16.7-1.21.1",
          "inheritsFrom": "1.21.1",
          "mainClass": "net.fabricmc.loader.impl.launch.knot.KnotClient",
          "arguments": {"jvm": ["-DFabricMcEmu= net.minecraft.client.main.Main "], "game": []},
          "libraries": [
            {"name": "net.fabricmc:fabric-loader:0.16.7", "url": "https://maven.fabricmc.net/"},
            {"name": "org.ow2.asm:asm:9.7", "url": "https://maven.fabricmc.net/"}
          ]
        }"#;
        let d: VersionDetail = serde_json::from_str(json).unwrap();
        assert_eq!(d.inherits_from.as_deref(), Some("1.21.1"));
        assert_eq!(d.libraries.len(), 2);
        assert!(d.libraries[0].downloads.is_none());
        assert_eq!(d.libraries[0].url.as_deref(), Some("https://maven.fabricmc.net/"));
    }
}
