//! 설치된 모드의 통합 메타데이터 저장소 — `mods/.hyenimc-metadata.json`.
//!
//! Electron `metadata-manager.ts`의 `UnifiedMetadata`와 동일 포맷을 읽고 쓴다.
//! Electron은 이 통합 파일을 정본으로 쓰므로(개별 사이드카는 프로덕션에서 안 씀) Tauri도 여기로 수렴한다.
//!
//! Tauri가 통합 파일을 다시 쓸 때 Electron이 기록한 미지 필드(isDependency/autoUpdate 등)를
//! 잃지 않도록 `#[serde(flatten)]`으로 원본을 보존한다.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::LauncherError;

const UNIFIED_FILE: &str = ".hyenimc-metadata.json";
const META_VERSION: u32 = 1;

/// 개별 모드 메타 (통합 파일의 `mods[fileName]`). Electron `InstalledModMeta`와 동일.
/// 선택 필드는 부재 시 생략(skip_serializing_if)해 Electron 스키마와 왕복 손실이 없게 한다.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledModMeta {
    #[serde(default)]
    pub source: String, // 'modrinth' | 'curseforge' | 'url' | 'local'
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_mod_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_file_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version_number: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub installed_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub installed_from: Option<String>, // 'hyenipack' | 'manual' | 'update' | 'dependency'
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modpack_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modpack_version: Option<String>,
    /// Electron이 기록하는 미지 필드(isDependency/dependencyOf/autoUpdate 등) 보존.
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

/// 통합 메타 파일 전체. `mods`는 fileName → InstalledModMeta.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnifiedMetadata {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default = "default_top_source")]
    pub source: String, // 'hyenipack' | 'manual' | 'migrated'
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modpack_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modpack_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modpack_version: Option<String>,
    #[serde(default)]
    pub installed_at: String,
    #[serde(default)]
    pub updated_at: String,
    #[serde(default)]
    pub mods: BTreeMap<String, InstalledModMeta>,
    /// 상위 레벨의 미지 필드 보존.
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

fn default_version() -> u32 {
    META_VERSION
}
fn default_top_source() -> String {
    "manual".into()
}

impl UnifiedMetadata {
    /// 새 통합 메타(빈 mods). `source`는 'hyenipack' | 'manual' | 'migrated'.
    pub fn new(source: &str) -> Self {
        let now = iso_now();
        UnifiedMetadata {
            version: META_VERSION,
            source: source.into(),
            modpack_id: None,
            modpack_name: None,
            modpack_version: None,
            installed_at: now.clone(),
            updated_at: now,
            mods: BTreeMap::new(),
            extra: serde_json::Map::new(),
        }
    }
}

fn unified_path(mods_dir: &Path) -> PathBuf {
    mods_dir.join(UNIFIED_FILE)
}

/// 통합 파일 읽기. 없거나 파싱 실패 시 None.
pub fn read_unified(mods_dir: &Path) -> Option<UnifiedMetadata> {
    let text = std::fs::read_to_string(unified_path(mods_dir)).ok()?;
    serde_json::from_str(&text).ok()
}

/// 통합 파일 쓰기. `updated_at`은 내부에서 항상 현재 시각으로 갱신한다
/// (Electron writeUnifiedMetadata와 동일 — 호출부가 깜빡해도 안전).
pub fn write_unified(mods_dir: &Path, meta: &UnifiedMetadata) -> Result<(), LauncherError> {
    if let Some(parent) = unified_path(mods_dir).parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut meta = meta.clone();
    meta.updated_at = iso_now();
    std::fs::write(unified_path(mods_dir), serde_json::to_string_pretty(&meta)?)?;
    Ok(())
}

/// 통합 파일에서 키 이름 변경(활성/비활성 토글 시 — Electron renameModMetadata 대응). 없으면 no-op.
pub fn rename_meta_key(mods_dir: &Path, from: &str, to: &str) {
    if from == to {
        return;
    }
    if let Some(mut u) = read_unified(mods_dir) {
        if let Some(m) = u.mods.remove(from) {
            u.mods.insert(to.to_string(), m);
            u.updated_at = iso_now();
            let _ = write_unified(mods_dir, &u);
        }
    }
}

/// 통합 파일에서 주어진 키들을 제거(모드 삭제 시). 없으면 no-op.
pub fn remove_meta_keys(mods_dir: &Path, names: &[String]) {
    if let Some(mut u) = read_unified(mods_dir) {
        let before = u.mods.len();
        for n in names {
            u.mods.remove(n);
        }
        if u.mods.len() != before {
            u.updated_at = iso_now();
            let _ = write_unified(mods_dir, &u);
        }
    }
}

/// 현재 시각 ISO-8601 UTC (Electron `new Date().toISOString()`과 동일 포맷).
pub fn iso_now() -> String {
    let d = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    iso_from_epoch(d.as_secs(), d.subsec_millis())
}

/// Unix epoch 초/밀리초 → `YYYY-MM-DDTHH:MM:SS.sssZ`. (Howard Hinnant civil_from_days)
fn iso_from_epoch(secs: u64, millis: u32) -> String {
    let days = (secs / 86400) as i64;
    let rem = secs % 86400;
    let (h, mi, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = doy - (153 * mp + 2) / 5 + 1; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 }; // [1, 12]
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02}T{h:02}:{mi:02}:{s:02}.{millis:03}Z")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso_format_known_epochs() {
        assert_eq!(iso_from_epoch(0, 0), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso_from_epoch(1_700_000_000, 5), "2023-11-14T22:13:20.005Z");
    }

    #[test]
    fn roundtrip_preserves_unknown_fields() {
        let dir = tempfile::tempdir().unwrap();
        // Electron이 쓴 형태 — Tauri가 모르는 필드(autoUpdate/isDependency) 포함
        let json = r#"{
            "version": 1, "source": "hyenipack",
            "modpackId": "hp", "modpackName": "월드", "modpackVersion": "1.0.0",
            "installedAt": "2024-01-01T00:00:00.000Z", "updatedAt": "2024-01-01T00:00:00.000Z",
            "futureTopField": 42,
            "mods": {
                "sodium.jar": {
                    "source": "modrinth", "sourceModId": "AAN", "sourceFileId": "vX",
                    "versionNumber": "0.6.0", "installedAt": "2024-01-01T00:00:00.000Z",
                    "installedFrom": "hyenipack", "autoUpdate": true, "isDependency": false
                }
            }
        }"#;
        std::fs::write(dir.path().join(UNIFIED_FILE), json).unwrap();

        let mut u = read_unified(dir.path()).unwrap();
        assert_eq!(u.source, "hyenipack");
        assert_eq!(u.mods["sodium.jar"].source_mod_id.as_deref(), Some("AAN"));
        // Tauri가 새 모드 추가 후 다시 써도…
        u.mods.insert("iris.jar".into(), InstalledModMeta {
            source: "modrinth".into(),
            installed_from: Some("hyenipack".into()),
            ..Default::default()
        });
        write_unified(dir.path(), &u).unwrap();

        // …Electron의 미지 필드가 보존돼야 함
        let text = std::fs::read_to_string(dir.path().join(UNIFIED_FILE)).unwrap();
        assert!(text.contains("\"autoUpdate\""), "모드 미지 필드 유실");
        assert!(text.contains("\"isDependency\""), "모드 미지 필드 유실");
        assert!(text.contains("\"futureTopField\""), "상위 미지 필드 유실");
        assert!(text.contains("\"iris.jar\""));
    }

    #[test]
    fn rename_and_remove_keys() {
        let dir = tempfile::tempdir().unwrap();
        let mut u = UnifiedMetadata::new("hyenipack");
        u.mods.insert("a.jar".into(), InstalledModMeta { source: "local".into(), ..Default::default() });
        write_unified(dir.path(), &u).unwrap();

        rename_meta_key(dir.path(), "a.jar", "a.jar.disabled");
        let u2 = read_unified(dir.path()).unwrap();
        assert!(u2.mods.contains_key("a.jar.disabled"));
        assert!(!u2.mods.contains_key("a.jar"));

        remove_meta_keys(dir.path(), &["a.jar.disabled".into()]);
        let u3 = read_unified(dir.path()).unwrap();
        assert!(u3.mods.is_empty());
    }
}
