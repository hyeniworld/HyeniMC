//! 모드로더 설치 — Fabric(meta API profile json) / NeoForge(installer --install-client).
//! TS fabric-loader.ts / neoforge-loader.ts 의미 포팅.

use serde::{Deserialize, Serialize};

use crate::download::{download_all, DownloadConfig, DownloadTask};
use crate::install::GameDirs;
use crate::launch::maven_relative_path;
use crate::manifest::VersionDetail;
use crate::LauncherError;

const FABRIC_META: &str = "https://meta.fabricmc.net/v2/versions/loader";
const NEOFORGE_MAVEN: &str = "https://maven.neoforged.net/releases/net/neoforged/neoforge";
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

/// NeoForge 설치 — installer jar를 받아 --install-client 실행. 반환: 버전 id.
pub async fn install_neoforge(
    http: &reqwest::Client,
    neoforge_version: &str,
    java_path: &str,
    dirs: &GameDirs,
    cfg: &DownloadConfig,
    mut on_log: impl FnMut(String) + Send + 'static,
) -> Result<String, LauncherError> {
    let version_id = neoforge_version_id(neoforge_version);
    if dirs.version_json(&version_id).exists() {
        return Ok(version_id);
    }

    // installer 요구사항: launcher_profiles.json 존재
    tokio::fs::create_dir_all(&dirs.instance_dir).await?;
    let profiles_path = dirs.instance_dir.join("launcher_profiles.json");
    if !profiles_path.exists() {
        tokio::fs::write(&profiles_path, r#"{"profiles":{}}"#).await?;
    }

    let temp_dir = dirs.instance_dir.join(".temp");
    let installer = temp_dir.join(format!("neoforge-{neoforge_version}-installer.jar"));
    download_all(
        http,
        vec![DownloadTask {
            url: format!(
                "{NEOFORGE_MAVEN}/{neoforge_version}/neoforge-{neoforge_version}-installer.jar"
            ),
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
        "--install-client",
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
            on_log(format!("[neoforge-installer] {line}"));
        }
    }
    let _ = tokio::fs::remove_file(&installer).await;

    if !output.status.success() {
        return Err(LauncherError::Other(format!(
            "NeoForge installer 실패 (exit {:?})",
            output.status.code()
        )));
    }
    if !dirs.version_json(&version_id).exists() {
        return Err(LauncherError::Other(
            "NeoForge installer가 버전 json을 생성하지 않음".into(),
        ));
    }
    Ok(version_id)
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
