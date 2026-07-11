//! 설치된 모드 목록/토글/삭제 (M6 보완) — 기존 Go 백엔드 listMods 대응.
//!
//! 실데이터 형식(실인스턴스 확인):
//! - 활성: `X.jar` / 비활성: `X.jar.disabled`
//! - 사이드카: `<디스크상 전체 파일명>.meta.json` (path/size/sha1만 — 표시 메타 없음)
//! - 표시 메타는 jar 내부: `fabric.mod.json`(JSON) 또는 `META-INF/neoforge.mods.toml`·`mods.toml`(TOML)
//! - NeoForge 버전 placeholder `${file.jarVersion}` → MANIFEST.MF `Implementation-Version`

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::workermods::parse_mod_version;
use crate::LauncherError;

const DISABLED_SUFFIX: &str = ".disabled";
const SIDECAR_SUFFIX: &str = ".meta.json";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledMod {
    /// 정규화된 파일명 (`.disabled` 제거) — 렌더러의 토글/삭제 키
    pub file_name: String,
    pub name: String,
    pub version: String,
    pub mod_id: String,
    pub description: String,
    pub authors: Vec<String>,
    pub enabled: bool,
    pub file_size: u64,
}

/// jar 내부 메타에서 추출한 표시용 정보(캐시 miss 시 개별 파싱에 사용).
#[derive(Debug, Clone, Default)]
pub struct ModMetadata {
    pub name: String,
    pub version: String,
    pub mod_id: String,
    pub description: String,
    pub authors: Vec<String>,
}

/// 개별 jar 메타 파싱. `canonical_name`은 `.disabled` 제거된 파일명(`X.jar`).
/// 메타가 없으면 name은 파일명, version은 파일명에서 추론.
pub fn parse_mod_metadata(jar_path: &Path, canonical_name: &str) -> ModMetadata {
    let meta = parse_jar_metadata(jar_path).unwrap_or_default();
    let stem = canonical_name.trim_end_matches(".jar");
    ModMetadata {
        name: if meta.name.is_empty() {
            canonical_name.to_string()
        } else {
            meta.name
        },
        version: resolve_version(meta.version, stem),
        mod_id: meta.mod_id,
        description: meta.description,
        authors: meta.authors,
    }
}

/// mods 디렉터리의 설치 모드 목록. 디렉터리가 없으면 빈 목록.
pub fn list_mods(mods_dir: &Path) -> Vec<InstalledMod> {
    let Ok(entries) = fs::read_dir(mods_dir) else {
        return Vec::new();
    };
    let mut mods: Vec<InstalledMod> = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            if !path.is_file() {
                return None;
            }
            let disk_name = entry.file_name().to_string_lossy().to_string();
            let (canonical, enabled) = match disk_name.strip_suffix(DISABLED_SUFFIX) {
                Some(base) => (base.to_string(), false),
                None => (disk_name.clone(), true),
            };
            if !canonical.to_lowercase().ends_with(".jar") {
                return None;
            }
            let file_size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            let m = parse_mod_metadata(&path, &canonical);
            Some(InstalledMod {
                name: m.name,
                mod_id: m.mod_id,
                description: m.description,
                authors: m.authors,
                version: m.version,
                file_name: canonical,
                enabled,
                file_size,
            })
        })
        .collect();
    mods.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    mods
}

/// 모드 활성/비활성 전환 — `.disabled` rename + 사이드카 동반 rename.
/// 이미 원하는 상태면 no-op 성공.
pub fn toggle_mod(mods_dir: &Path, file_name: &str, enabled: bool) -> Result<(), LauncherError> {
    let canonical = file_name.trim_end_matches(DISABLED_SUFFIX);
    let enabled_path = mods_dir.join(canonical);
    let disabled_path = mods_dir.join(format!("{canonical}{DISABLED_SUFFIX}"));
    let (from, to) = if enabled {
        (disabled_path, enabled_path)
    } else {
        (enabled_path, disabled_path)
    };
    if !from.exists() {
        if to.exists() {
            return Ok(()); // 이미 원하는 상태
        }
        return Err(LauncherError::Other(format!("모드 파일 없음: {canonical}")));
    }
    fs::rename(&from, &to)?;
    rename_sidecar(&from, &to);
    // 통합 메타(.hyenimc-metadata.json) 키도 갱신 — Electron renameModMetadata 대응(이탈 방지).
    if let (Some(f), Some(t)) = (from.file_name(), to.file_name()) {
        crate::instmeta::rename_meta_key(mods_dir, &f.to_string_lossy(), &t.to_string_lossy());
    }
    Ok(())
}

/// 모드 삭제 — 활성/비활성 양쪽 형태와 사이드카 모두 제거.
pub fn remove_mod(mods_dir: &Path, file_name: &str) -> Result<(), LauncherError> {
    let canonical = file_name.trim_end_matches(DISABLED_SUFFIX);
    let mut removed = false;
    for disk_name in [canonical.to_string(), format!("{canonical}{DISABLED_SUFFIX}")] {
        let path = mods_dir.join(&disk_name);
        if path.exists() {
            fs::remove_file(&path)?;
            removed = true;
        }
        let sidecar = mods_dir.join(format!("{disk_name}{SIDECAR_SUFFIX}"));
        if sidecar.exists() {
            let _ = fs::remove_file(&sidecar);
        }
    }
    // 통합 메타에서도 제거 — Electron removeModMetadata 대응(이탈 방지).
    crate::instmeta::remove_meta_keys(
        mods_dir,
        &[canonical.to_string(), format!("{canonical}{DISABLED_SUFFIX}")],
    );
    if removed {
        Ok(())
    } else {
        Err(LauncherError::Other(format!("모드 파일 없음: {canonical}")))
    }
}

fn rename_sidecar(from: &Path, to: &Path) {
    let sidecar_of = |p: &Path| -> PathBuf {
        let mut name = p.file_name().unwrap_or_default().to_os_string();
        name.push(SIDECAR_SUFFIX);
        p.with_file_name(name)
    };
    let from_sidecar = sidecar_of(from);
    if from_sidecar.exists() {
        let _ = fs::rename(&from_sidecar, sidecar_of(to));
    }
}

#[derive(Default)]
struct JarMeta {
    mod_id: String,
    name: String,
    version: String,
    description: String,
    authors: Vec<String>,
}

/// jar 내부 메타 파싱: fabric.mod.json → neoforge.mods.toml → mods.toml 순.
/// `${file.jarVersion}` placeholder는 MANIFEST.MF Implementation-Version으로 치환.
fn parse_jar_metadata(jar_path: &Path) -> Option<JarMeta> {
    let file = fs::File::open(jar_path).ok()?;
    let mut zip = zip::ZipArchive::new(file).ok()?;

    if let Some(text) = read_zip_entry(&mut zip, "fabric.mod.json") {
        if let Some(meta) = parse_fabric_json(&text) {
            return Some(meta);
        }
    }
    for entry_name in ["META-INF/neoforge.mods.toml", "META-INF/mods.toml"] {
        if let Some(text) = read_zip_entry(&mut zip, entry_name) {
            if let Some(mut meta) = parse_mods_toml(&text) {
                if meta.version.contains("${") {
                    meta.version = read_zip_entry(&mut zip, "META-INF/MANIFEST.MF")
                        .and_then(|m| parse_manifest_version(&m))
                        .unwrap_or_default();
                }
                return Some(meta);
            }
        }
    }
    None
}

fn read_zip_entry(zip: &mut zip::ZipArchive<fs::File>, name: &str) -> Option<String> {
    let mut entry = zip.by_name(name).ok()?;
    let mut text = String::new();
    entry.read_to_string(&mut text).ok()?;
    Some(text)
}

fn parse_fabric_json(text: &str) -> Option<JarMeta> {
    let value: serde_json::Value = serde_json::from_str(text).ok()?;
    let authors = value
        .get("authors")
        .and_then(|a| a.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|item| {
                    // 문자열 또는 {name: ...} 객체 (fabric 스펙)
                    item.as_str()
                        .map(String::from)
                        .or_else(|| item.get("name").and_then(|n| n.as_str()).map(String::from))
                })
                .collect()
        })
        .unwrap_or_default();
    Some(JarMeta {
        mod_id: str_field(&value, "id"),
        name: str_field(&value, "name"),
        version: str_field(&value, "version"),
        description: str_field(&value, "description"),
        authors,
    })
}

fn str_field(value: &serde_json::Value, key: &str) -> String {
    value.get(key).and_then(|v| v.as_str()).unwrap_or_default().to_string()
}

fn parse_mods_toml(text: &str) -> Option<JarMeta> {
    let value: toml::Value = text.parse().ok()?;
    let first_mod = value.get("mods")?.as_array()?.first()?;
    let field = |key: &str| -> String {
        first_mod.get(key).and_then(|v| v.as_str()).unwrap_or_default().trim().to_string()
    };
    let authors_raw = field("authors");
    let authors = if authors_raw.is_empty() {
        Vec::new()
    } else {
        authors_raw.split(',').map(|s| s.trim().to_string()).collect()
    };
    Some(JarMeta {
        mod_id: field("modId"),
        name: field("displayName"),
        version: field("version"),
        description: field("description"),
        authors,
    })
}

fn parse_manifest_version(manifest: &str) -> Option<String> {
    manifest.lines().find_map(|line| {
        line.strip_prefix("Implementation-Version:")
            .map(|v| v.trim().to_string())
    })
}

fn resolve_version(parsed: String, file_stem: &str) -> String {
    if !parsed.is_empty() && !parsed.contains("${") {
        return parsed;
    }
    parse_mod_version(file_stem).unwrap_or_else(|| "Unknown".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn make_jar(dir: &Path, name: &str, entries: &[(&str, &str)]) -> PathBuf {
        let path = dir.join(name);
        let file = fs::File::create(&path).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default();
        for (entry_name, content) in entries {
            writer.start_file(*entry_name, options).unwrap();
            writer.write_all(content.as_bytes()).unwrap();
        }
        writer.finish().unwrap();
        path
    }

    const FABRIC_JSON: &str = r#"{
        "id": "badoptimizations", "name": "BadOptimizations", "version": "2.3.1",
        "description": "Optimization mod", "authors": ["Thosea", {"name": "Someone"}]
    }"#;

    const NEOFORGE_TOML: &str = r#"
modLoader="javafml"
[[mods]]
    modId="aquaculture"
    version="2.7.14"
    displayName="Aquaculture 2"
    authors="Shadowclaimer, Girafi"
    description='''
    Fishing expansion.
    '''
"#;

    const NEOFORGE_TOML_PLACEHOLDER: &str = r#"
[[mods]]
modId="patchouli"
version="${file.jarVersion}"
displayName="Patchouli"
"#;

    #[test]
    fn lists_fabric_mod_with_parsed_metadata() {
        let dir = tempfile::tempdir().unwrap();
        make_jar(dir.path(), "badoptimizations-2.3.1.jar", &[("fabric.mod.json", FABRIC_JSON)]);

        let mods = list_mods(dir.path());

        assert_eq!(mods.len(), 1);
        let m = &mods[0];
        assert_eq!(m.name, "BadOptimizations");
        assert_eq!(m.version, "2.3.1");
        assert_eq!(m.mod_id, "badoptimizations");
        assert_eq!(m.authors, vec!["Thosea", "Someone"]);
        assert!(m.enabled);
        assert_eq!(m.file_name, "badoptimizations-2.3.1.jar");
    }

    #[test]
    fn lists_neoforge_mod_and_disabled_state() {
        let dir = tempfile::tempdir().unwrap();
        make_jar(
            dir.path(),
            "Aquaculture-1.21.1-2.7.14.jar.disabled",
            &[("META-INF/neoforge.mods.toml", NEOFORGE_TOML)],
        );

        let mods = list_mods(dir.path());

        assert_eq!(mods.len(), 1);
        let m = &mods[0];
        assert_eq!(m.name, "Aquaculture 2");
        assert_eq!(m.version, "2.7.14");
        assert_eq!(m.authors, vec!["Shadowclaimer", "Girafi"]);
        assert!(!m.enabled);
        // 정규화: .disabled 제거된 파일명이 키
        assert_eq!(m.file_name, "Aquaculture-1.21.1-2.7.14.jar");
    }

    #[test]
    fn resolves_jar_version_placeholder_from_manifest() {
        let dir = tempfile::tempdir().unwrap();
        make_jar(
            dir.path(),
            "Patchouli-1.21.1-92-NEOFORGE.jar",
            &[
                ("META-INF/neoforge.mods.toml", NEOFORGE_TOML_PLACEHOLDER),
                ("META-INF/MANIFEST.MF", "Manifest-Version: 1.0\nImplementation-Version: 1.21.1-92-NEOFORGE\n"),
            ],
        );

        let mods = list_mods(dir.path());

        assert_eq!(mods[0].version, "1.21.1-92-NEOFORGE");
    }

    #[test]
    fn falls_back_to_filename_when_metadata_missing() {
        let dir = tempfile::tempdir().unwrap();
        make_jar(dir.path(), "somemod-1.2.3.jar", &[("nothing.txt", "x")]);

        let mods = list_mods(dir.path());

        assert_eq!(mods[0].name, "somemod-1.2.3.jar");
        assert_eq!(mods[0].version, "1.2.3");
    }

    #[test]
    fn ignores_non_jar_files() {
        let dir = tempfile::tempdir().unwrap();
        make_jar(dir.path(), "real-1.0.0.jar", &[("a.txt", "x")]);
        fs::write(dir.path().join("real-1.0.0.jar.meta.json"), "{}").unwrap();
        fs::write(dir.path().join("readme.txt"), "x").unwrap();

        assert_eq!(list_mods(dir.path()).len(), 1);
    }

    #[test]
    fn toggle_renames_jar_and_sidecar() {
        let dir = tempfile::tempdir().unwrap();
        make_jar(dir.path(), "m-1.0.0.jar", &[("a.txt", "x")]);
        fs::write(dir.path().join("m-1.0.0.jar.meta.json"), "{}").unwrap();

        toggle_mod(dir.path(), "m-1.0.0.jar", false).unwrap();
        assert!(dir.path().join("m-1.0.0.jar.disabled").exists());
        assert!(dir.path().join("m-1.0.0.jar.disabled.meta.json").exists());
        assert!(!dir.path().join("m-1.0.0.jar").exists());

        // 이미 비활성 → no-op 성공
        toggle_mod(dir.path(), "m-1.0.0.jar", false).unwrap();

        toggle_mod(dir.path(), "m-1.0.0.jar", true).unwrap();
        assert!(dir.path().join("m-1.0.0.jar").exists());
        assert!(dir.path().join("m-1.0.0.jar.meta.json").exists());
    }

    #[test]
    fn remove_deletes_both_forms_and_sidecars() {
        let dir = tempfile::tempdir().unwrap();
        make_jar(dir.path(), "m-1.0.0.jar.disabled", &[("a.txt", "x")]);
        fs::write(dir.path().join("m-1.0.0.jar.disabled.meta.json"), "{}").unwrap();

        remove_mod(dir.path(), "m-1.0.0.jar").unwrap();

        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
        assert!(remove_mod(dir.path(), "m-1.0.0.jar").is_err());
    }
}
