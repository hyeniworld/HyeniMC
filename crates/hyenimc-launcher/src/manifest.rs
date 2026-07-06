//! Mojang piston-meta 버전 매니페스트/상세 모델.

use serde::Deserialize;

use crate::rules::Rule;

pub const VERSION_MANIFEST_URL: &str =
    "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
pub const ASSET_BASE_URL: &str = "https://resources.download.minecraft.net";

#[derive(Debug, Clone, Deserialize)]
pub struct VersionManifest {
    pub latest: Latest,
    pub versions: Vec<VersionSummary>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Latest {
    pub release: String,
    pub snapshot: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct VersionSummary {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub url: String,
    #[serde(default)]
    pub sha1: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionDetail {
    pub id: String,
    #[serde(default)]
    pub inherits_from: Option<String>,
    #[serde(default)]
    pub main_class: Option<String>,
    #[serde(default)]
    pub asset_index: Option<AssetIndexRef>,
    #[serde(default)]
    pub assets: Option<String>,
    #[serde(default)]
    pub downloads: Option<Downloads>,
    #[serde(default)]
    pub libraries: Vec<Library>,
    #[serde(default)]
    pub arguments: Option<Arguments>,
    #[serde(default)]
    pub minecraft_arguments: Option<String>, // 레거시(~1.12)
    #[serde(default)]
    pub java_version: Option<JavaVersionRef>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetIndexRef {
    pub id: String,
    pub sha1: String,
    pub url: String,
    #[serde(default)]
    pub size: Option<u64>,
    #[serde(default)]
    pub total_size: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Downloads {
    #[serde(default)]
    pub client: Option<ArtifactRef>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ArtifactRef {
    pub sha1: String,
    pub size: u64,
    pub url: String,
    #[serde(default)]
    pub path: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JavaVersionRef {
    #[serde(default)]
    pub component: Option<String>,
    pub major_version: u32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Library {
    pub name: String,
    #[serde(default)]
    pub downloads: Option<LibraryDownloads>,
    #[serde(default)]
    pub natives: Option<std::collections::HashMap<String, String>>,
    #[serde(default)]
    pub rules: Vec<Rule>,
    #[serde(default)]
    pub url: Option<String>, // maven 베이스 (로더 라이브러리)
}

#[derive(Debug, Clone, Deserialize)]
pub struct LibraryDownloads {
    #[serde(default)]
    pub artifact: Option<ArtifactRef>,
    #[serde(default)]
    pub classifiers: Option<std::collections::HashMap<String, ArtifactRef>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Arguments {
    #[serde(default)]
    pub game: Vec<ArgumentEntry>,
    #[serde(default)]
    pub jvm: Vec<ArgumentEntry>,
}

/// 인자는 문자열 또는 {rules, value(문자열|배열)} 객체.
#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum ArgumentEntry {
    Plain(String),
    Conditional { rules: Vec<Rule>, value: ArgumentValue },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum ArgumentValue {
    One(String),
    Many(Vec<String>),
}

/// inheritsFrom 병합 — 자식 값 우선, 라이브러리는 자식 + 부모 합집합,
/// 인자는 부모 → 자식 순 연결 (TS loadVersionJson 의미).
pub fn merge_inherited(child: VersionDetail, parent: VersionDetail) -> VersionDetail {
    let mut libraries = child.libraries.clone();
    libraries.extend(parent.libraries);
    VersionDetail {
        id: child.id,
        // 보존 — 클라이언트 jar는 부모 버전 것을 쓰므로(TS buildClasspath 의미) 병합 후에도 필요
        inherits_from: child.inherits_from,
        main_class: child.main_class.or(parent.main_class),
        asset_index: child.asset_index.or(parent.asset_index),
        assets: child.assets.or(parent.assets),
        downloads: child.downloads.or(parent.downloads),
        libraries,
        arguments: match (child.arguments, parent.arguments) {
            (Some(c), Some(p)) => Some(Arguments {
                game: p.game.into_iter().chain(c.game).collect(),
                jvm: p.jvm.into_iter().chain(c.jvm).collect(),
            }),
            (c, p) => c.or(p),
        },
        minecraft_arguments: child.minecraft_arguments.or(parent.minecraft_arguments),
        java_version: child.java_version.or(parent.java_version),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DETAIL_FIXTURE: &str = r#"{
      "id": "1.21.1",
      "mainClass": "net.minecraft.client.main.Main",
      "assetIndex": {"id":"17","sha1":"abc","size":1,"totalSize":2,"url":"https://x/17.json"},
      "downloads": {"client": {"sha1":"c1","size":100,"url":"https://x/client.jar"}},
      "javaVersion": {"component":"java-runtime-delta","majorVersion":21},
      "libraries": [
        {"name":"com.mojang:a:1","downloads":{"artifact":{"path":"com/mojang/a/1/a-1.jar","sha1":"s","size":1,"url":"https://x/a.jar"}}},
        {"name":"org.lwjgl:lwjgl:3","downloads":{"artifact":{"path":"l.jar","sha1":"s","size":1,"url":"https://x/l.jar"}},
         "rules":[{"action":"allow","os":{"name":"osx"}}]}
      ],
      "arguments": {"game":["--username","${auth_player_name}"],
                    "jvm":[{"rules":[{"action":"allow","os":{"name":"osx"}}],"value":["-XstartOnFirstThread"]},"-Dkey=${classpath}"]}
    }"#;

    #[test]
    fn parses_version_detail() {
        let d: VersionDetail = serde_json::from_str(DETAIL_FIXTURE).unwrap();
        assert_eq!(d.main_class.as_deref(), Some("net.minecraft.client.main.Main"));
        assert_eq!(d.libraries.len(), 2);
        assert_eq!(d.java_version.as_ref().unwrap().major_version, 21);
        assert!(d.arguments.is_some());
        assert_eq!(d.asset_index.as_ref().unwrap().id, "17");
        assert!(d.libraries[0].rules.is_empty());
        assert_eq!(d.libraries[1].rules.len(), 1);
    }

    #[test]
    fn parses_manifest_list() {
        let json = r#"{"latest":{"release":"1.21.1","snapshot":"x"},
          "versions":[{"id":"1.21.1","type":"release","url":"https://x/v.json","sha1":"abc"}]}"#;
        let m: VersionManifest = serde_json::from_str(json).unwrap();
        assert_eq!(m.latest.release, "1.21.1");
        assert_eq!(m.versions[0].kind, "release");
    }

    #[test]
    fn merge_inherited_combines_libraries_and_keeps_child_mainclass() {
        let parent: VersionDetail = serde_json::from_str(DETAIL_FIXTURE).unwrap();
        let child: VersionDetail = serde_json::from_str(
            r#"{"id":"loader-1.21.1","inheritsFrom":"1.21.1","mainClass":"loader.Main",
                "libraries":[{"name":"loader:core:1"}]}"#,
        )
        .unwrap();
        let merged = merge_inherited(child, parent);
        assert_eq!(merged.main_class.as_deref(), Some("loader.Main"));
        assert_eq!(merged.libraries.len(), 3);
        assert!(merged.downloads.is_some());
        assert_eq!(merged.id, "loader-1.21.1");
        assert!(merged.arguments.is_some());
    }
}
