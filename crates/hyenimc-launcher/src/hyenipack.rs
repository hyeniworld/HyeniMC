//! 혜니팩 설치 + V2 선언형 동기화 + 팩 업데이트.
//! 사용자 런처는 url 피닝된 매니페스트 전제(MR/CF 라이브 resolve는 제작자 도구 몫).

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::download::{download_all, DownloadConfig, DownloadTask};
use crate::install::GameDirs;
use crate::LauncherError;

// ── 매니페스트 (v1/v2 공용) ──────────────────────────────

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackManifest {
    #[serde(default)]
    pub format_version: u32,
    #[serde(default)]
    pub hyenipack_id: Option<String>,
    pub name: String,
    pub version: String,
    pub minecraft: PackMinecraft,
    #[serde(default)]
    pub mods: Vec<PackMod>,
    #[serde(default)]
    pub overrides: Vec<OverridePolicy>,
    #[serde(default)]
    pub breaking: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackMinecraft {
    pub version: String,
    pub loader_type: String,
    #[serde(default)]
    pub loader_version: String,
}

/// 매니페스트 모드 엔트리. exporter는 metadata 중첩({source,projectId,version})으로 저장하므로
/// 평면 필드 + 중첩 metadata 양쪽을 흡수한다.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackMod {
    pub file_name: String,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub sha256: Option<String>,
    #[serde(default)]
    pub sha1: Option<String>,
    #[serde(default)]
    pub size: Option<u64>,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub metadata: Option<PackModMetadata>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackModMetadata {
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
}

impl PackMod {
    pub fn effective_source(&self) -> Option<String> {
        self.source
            .clone()
            .or_else(|| self.metadata.as_ref().and_then(|m| m.source.clone()))
    }
    pub fn effective_project_id(&self) -> Option<String> {
        self.project_id
            .clone()
            .or_else(|| self.metadata.as_ref().and_then(|m| m.project_id.clone()))
    }
    pub fn effective_version(&self) -> Option<String> {
        self.metadata.as_ref().and_then(|m| m.version.clone())
    }
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct OverridePolicy {
    pub path: String,
    pub policy: String, // keep | replace | merge(→keep 취급)
}

/// Longest-prefix-match. 기본 keep.
pub fn find_policy<'a>(rel_path: &str, policies: &'a [OverridePolicy]) -> &'a str {
    let norm = rel_path.replace('\\', "/");
    policies
        .iter()
        .filter(|p| norm.starts_with(&p.path.replace('\\', "/")))
        .max_by_key(|p| p.path.len())
        .map(|p| p.policy.as_str())
        .unwrap_or("keep")
}

// ── 모드 .meta.json (jar 옆 사이드카) ────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModMeta {
    pub source: String,
    #[serde(default)]
    pub source_mod_id: Option<String>,
    #[serde(default)]
    pub version_number: Option<String>,
    #[serde(default)]
    pub installed_from: Option<String>, // 'hyenipack' | 'manual' | ...
    #[serde(default)]
    pub modpack_id: Option<String>,
    #[serde(default)]
    pub modpack_version: Option<String>,
}

pub fn read_mod_meta(jar_path: &Path) -> Option<ModMeta> {
    let meta_path = meta_path_for(jar_path);
    let text = std::fs::read_to_string(meta_path).ok()?;
    serde_json::from_str(&text).ok()
}

pub fn write_mod_meta(jar_path: &Path, meta: &ModMeta) -> Result<(), LauncherError> {
    let text = serde_json::to_string_pretty(meta)?;
    std::fs::write(meta_path_for(jar_path), text)?;
    Ok(())
}

fn meta_path_for(jar_path: &Path) -> PathBuf {
    let mut s = jar_path.as_os_str().to_os_string();
    s.push(".meta.json");
    PathBuf::from(s)
}

// ── 프로필 팩 메타 (.hyenipack-meta.json) ───────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PackInstallMeta {
    pub hyenipack_id: String,
    pub version: String,
}

pub fn pack_meta_path(instance_dir: &Path) -> PathBuf {
    instance_dir.join(".hyenipack-meta.json")
}

pub fn read_pack_meta(instance_dir: &Path) -> Option<PackInstallMeta> {
    let text = std::fs::read_to_string(pack_meta_path(instance_dir)).ok()?;
    serde_json::from_str(&text).ok()
}

pub fn write_pack_meta(instance_dir: &Path, meta: &PackInstallMeta) -> Result<(), LauncherError> {
    std::fs::write(pack_meta_path(instance_dir), serde_json::to_string_pretty(meta)?)?;
    Ok(())
}

// ── 선언형 동기화 (순수 함수) ────────────────────────────

#[derive(Debug, Clone)]
pub struct ModSyncPlan {
    pub to_install: Vec<PackMod>,
    pub to_remove: Vec<String>, // fileName
}

fn matches(target: &PackMod, local_name: &str, local_meta: &ModMeta) -> bool {
    match (target.effective_project_id(), &local_meta.source_mod_id) {
        (Some(tp), Some(lp)) if !tp.is_empty() && !lp.is_empty() => {
            target.effective_source() == Some(local_meta.source.clone()) && tp == *lp
        }
        _ => target.file_name == local_name,
    }
}

/// "매니페스트에 있으면 설치, 없으면(hyenipack 소속만) 삭제. manual은 보존."
pub fn plan_mod_sync(existing: &[(String, ModMeta)], target: &[PackMod]) -> ModSyncPlan {
    let mut to_install = Vec::new();
    let mut to_remove = Vec::new();

    // 삭제 대상: 매니페스트에 없는 hyenipack 관리 모드
    for (name, meta) in existing {
        let in_target = target.iter().any(|t| matches(t, name, meta));
        if !in_target && meta.installed_from.as_deref() == Some("hyenipack") {
            to_remove.push(name.clone());
        }
    }

    // 설치/갱신 대상
    for t in target {
        let found = existing.iter().find(|(name, meta)| matches(t, name, meta));
        match found {
            None => to_install.push(t.clone()),
            Some((name, meta)) => {
                // 버전 변경(파일명 상이) 또는 versionNumber 상이면 재설치
                let version_changed = t.effective_version().is_some()
                    && meta.version_number.is_some()
                    && t.effective_version() != meta.version_number;
                if &t.file_name != name || version_changed {
                    to_install.push(t.clone());
                }
            }
        }
    }
    ModSyncPlan { to_install, to_remove }
}

// ── 설치 실행 ────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackInstallProgress {
    pub stage: String, // "mods" | "overrides" | "finalize"
    pub completed: usize,
    pub total: usize,
}

/// 매니페스트 기준 모드 동기화 + overrides 적용 + pack_meta 기록.
/// pack_zip은 .hyenipack(zip) 경로. mods jar는 매니페스트 url에서 CDN 다운로드.
pub async fn install_pack(
    http: &reqwest::Client,
    pack_zip: &Path,
    dirs: &GameDirs,
    cfg: &DownloadConfig,
    worker_token: Option<&str>,
    on_progress: impl Fn(PackInstallProgress) + Send + Sync,
) -> Result<PackManifest, LauncherError> {
    let manifest = read_manifest_from_zip(pack_zip)?;
    let mods_dir = dirs.instance_dir.join("mods");
    tokio::fs::create_dir_all(&mods_dir).await?;

    // 기존 설치 스캔
    let existing = scan_installed_mods(&mods_dir)?;
    let plan = plan_mod_sync(&existing, &manifest.mods);

    // 삭제
    for name in &plan.to_remove {
        let jar = mods_dir.join(name);
        let _ = tokio::fs::remove_file(&jar).await;
        let _ = tokio::fs::remove_file(meta_path_for(&jar)).await;
    }

    // 다운로드
    let total = plan.to_install.len();
    let mut tasks = Vec::new();
    for m in &plan.to_install {
        let url = m
            .url
            .clone()
            .ok_or_else(|| LauncherError::Other(format!("모드 url 없음(피닝 필요): {}", m.file_name)))?;
        // CF 프록시는 토큰 쿼리 부착 (worker downloadFile 방식)
        let url = maybe_authorize_url(&url, m, worker_token);
        tasks.push(DownloadTask {
            url,
            dest: mods_dir.join(&m.file_name),
            sha1: m.sha1.clone(),
            size: m.size,
        });
    }
    download_all(http, tasks, cfg, |p| {
        on_progress(PackInstallProgress { stage: "mods".into(), completed: p.completed, total });
    })
    .await?;

    // .meta.json 기록
    for m in &plan.to_install {
        let jar = mods_dir.join(&m.file_name);
        let meta = ModMeta {
            source: m.effective_source().unwrap_or_else(|| "url".into()),
            source_mod_id: m.effective_project_id(),
            version_number: m.effective_version(),
            installed_from: Some("hyenipack".into()),
            modpack_id: manifest.hyenipack_id.clone(),
            modpack_version: Some(manifest.version.clone()),
        };
        write_mod_meta(&jar, &meta)?;
    }

    // overrides 적용
    apply_overrides(pack_zip, dirs, &manifest.overrides, &on_progress)?;

    // pack_meta
    if let Some(id) = &manifest.hyenipack_id {
        write_pack_meta(&dirs.instance_dir, &PackInstallMeta {
            hyenipack_id: id.clone(),
            version: manifest.version.clone(),
        })?;
    }
    on_progress(PackInstallProgress { stage: "finalize".into(), completed: 1, total: 1 });
    Ok(manifest)
}

fn maybe_authorize_url(url: &str, m: &PackMod, token: Option<&str>) -> String {
    let is_cf = m.effective_source().as_deref() == Some("curseforge");
    match (is_cf, token) {
        (true, Some(t)) if !url.contains("token=") => {
            let sep = if url.contains('?') { '&' } else { '?' };
            format!("{url}{sep}token={t}")
        }
        _ => url.to_string(),
    }
}

fn read_manifest_from_zip(pack_zip: &Path) -> Result<PackManifest, LauncherError> {
    let file = std::fs::File::open(pack_zip)?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| LauncherError::Other(e.to_string()))?;
    let mut entry = zip
        .by_name("hyenipack.json")
        .map_err(|_| LauncherError::Other("hyenipack.json 없음".into()))?;
    let mut text = String::new();
    std::io::Read::read_to_string(&mut entry, &mut text)?;
    Ok(serde_json::from_str(&text)?)
}

fn scan_installed_mods(mods_dir: &Path) -> Result<Vec<(String, ModMeta)>, LauncherError> {
    let mut out = Vec::new();
    let Ok(rd) = std::fs::read_dir(mods_dir) else {
        return Ok(out);
    };
    for entry in rd.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.ends_with(".jar") {
            continue;
        }
        let meta = read_mod_meta(&entry.path()).unwrap_or(ModMeta {
            source: "local".into(),
            source_mod_id: None,
            version_number: None,
            installed_from: Some("manual".into()), // 메타 없는 jar = 사용자 추가로 간주(보존)
            modpack_id: None,
            modpack_version: None,
        });
        out.push((name, meta));
    }
    Ok(out)
}

fn apply_overrides(
    pack_zip: &Path,
    dirs: &GameDirs,
    policies: &[OverridePolicy],
    _on_progress: &(impl Fn(PackInstallProgress) + Send + Sync),
) -> Result<(), LauncherError> {
    let file = std::fs::File::open(pack_zip)?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| LauncherError::Other(e.to_string()))?;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| LauncherError::Other(e.to_string()))?;
        let name = entry.name().to_string();
        let Some(rel) = name.strip_prefix("overrides/") else { continue };
        if rel.is_empty() || name.ends_with('/') {
            continue;
        }
        let dest = dirs.instance_dir.join(rel);
        let policy = find_policy(rel, policies);
        // keep: 이미 있으면 건너뜀 / replace: 덮어씀
        if policy == "keep" && dest.exists() {
            continue;
        }
        if let Some(p) = dest.parent() {
            std::fs::create_dir_all(p)?;
        }
        let mut out = std::fs::File::create(&dest)?;
        std::io::copy(&mut entry, &mut out)?;
    }
    Ok(())
}

// ── 팩 업데이트 체크 (Worker) ────────────────────────────

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LatestInfo {
    pub hyenipack_id: String,
    pub version: String,
    #[serde(default)]
    pub breaking: bool,
    #[serde(default)]
    pub changelog: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackUpdate {
    pub hyenipack_id: String,
    pub current_version: String,
    pub latest_version: String,
    pub breaking: bool,
    pub changelog: Option<String>,
}

/// 현재 프로필의 팩 업데이트 확인. 팩 미설치면 None. 네트워크 실패는 Err(호출측이 정책 결정).
pub async fn check_pack_update(
    http: &reqwest::Client,
    worker_base: &str,
    instance_dir: &Path,
) -> Result<Option<PackUpdate>, LauncherError> {
    let Some(meta) = read_pack_meta(instance_dir) else {
        return Ok(None);
    };
    let url = format!(
        "{}/api/v2/modpacks/{}/latest",
        worker_base.trim_end_matches('/'),
        meta.hyenipack_id
    );
    let latest: LatestInfo = http.get(&url).send().await?.error_for_status()?.json().await?;
    if latest.version == meta.version {
        return Ok(None);
    }
    Ok(Some(PackUpdate {
        hyenipack_id: meta.hyenipack_id,
        current_version: meta.version,
        latest_version: latest.version,
        breaking: latest.breaking,
        changelog: latest.changelog,
    }))
}

/// 팩 버전 다운로드(Worker) → 임시 .hyenipack 경로
pub async fn download_pack_version(
    http: &reqwest::Client,
    worker_base: &str,
    hyenipack_id: &str,
    version: &str,
    token: &str,
    dest: &Path,
) -> Result<(), LauncherError> {
    let url = format!(
        "{}/download/v2/modpacks/{}/{}?token={}",
        worker_base.trim_end_matches('/'),
        hyenipack_id,
        version,
        token
    );
    let bytes = http.get(&url).send().await?.error_for_status()?.bytes().await?;
    if let Some(p) = dest.parent() {
        tokio::fs::create_dir_all(p).await?;
    }
    tokio::fs::write(dest, &bytes).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mk_meta(from: &str, pid: Option<&str>, ver: Option<&str>) -> ModMeta {
        ModMeta {
            source: "modrinth".into(),
            source_mod_id: pid.map(String::from),
            version_number: ver.map(String::from),
            installed_from: Some(from.into()),
            modpack_id: None,
            modpack_version: None,
        }
    }

    fn mk_mod(name: &str, pid: Option<&str>, ver: Option<&str>) -> PackMod {
        PackMod {
            file_name: name.into(),
            url: Some(format!("https://cdn/{name}")),
            sha256: None,
            sha1: None,
            size: None,
            source: Some("modrinth".into()),
            project_id: pid.map(String::from),
            metadata: ver.map(|v| PackModMetadata {
                source: Some("modrinth".into()),
                project_id: pid.map(String::from),
                version: Some(v.into()),
            }),
        }
    }

    #[test]
    fn v1_and_v2_manifest_parse() {
        let v2 = r#"{"formatVersion":2,"hyenipackId":"hp-world","name":"팩","version":"1.2.0",
            "minecraft":{"version":"1.21.1","loaderType":"neoforge","loaderVersion":"21.1.213"},
            "mods":[{"fileName":"sodium.jar","source":"modrinth","projectId":"AAN","url":"u","sha256":"h"}],
            "overrides":[{"path":"config","policy":"keep"}],"breaking":true}"#;
        let m: PackManifest = serde_json::from_str(v2).unwrap();
        assert_eq!(m.hyenipack_id.as_deref(), Some("hp-world"));
        assert!(m.breaking);
        assert_eq!(m.mods[0].effective_project_id().as_deref(), Some("AAN"));

        let v1 = r#"{"formatVersion":1,"name":"구팩","version":"1.0.0",
            "minecraft":{"version":"1.21.1","loaderType":"fabric","loaderVersion":"0.16.7"},"mods":[]}"#;
        let m1: PackManifest = serde_json::from_str(v1).unwrap();
        assert_eq!(m1.hyenipack_id, None);
        assert!(!m1.breaking);
    }

    #[test]
    fn find_policy_longest_prefix() {
        let ps = vec![
            OverridePolicy { path: "config".into(), policy: "keep".into() },
            OverridePolicy { path: "config/sodium.json".into(), policy: "replace".into() },
        ];
        assert_eq!(find_policy("config/options.txt", &ps), "keep");
        assert_eq!(find_policy("config/sodium.json", &ps), "replace");
        assert_eq!(find_policy("scripts/x.zs", &ps), "keep"); // 기본
    }

    #[test]
    fn sync_preserves_manual_removes_managed_installs_new() {
        let existing = vec![
            ("user-mod.jar".into(), mk_meta("manual", None, None)),
            ("old-sodium.jar".into(), mk_meta("hyenipack", Some("AAN"), Some("0.5.0"))),
            ("gone.jar".into(), mk_meta("hyenipack", Some("GONE"), Some("1.0"))),
        ];
        let target = vec![
            mk_mod("sodium-0.6.jar", Some("AAN"), Some("0.6.0")), // 버전 변경 재설치
            mk_mod("iris.jar", Some("IRIS"), Some("1.0")),        // 신규
        ];
        let plan = plan_mod_sync(&existing, &target);
        // gone(매니페스트 없음 + hyenipack) 삭제, user-mod(manual) 보존
        assert!(plan.to_remove.contains(&"gone.jar".to_string()));
        assert!(!plan.to_remove.contains(&"user-mod.jar".to_string()));
        // sodium은 projectId 매치되나 버전 변경 → 재설치, iris 신규
        let names: Vec<_> = plan.to_install.iter().map(|m| m.file_name.clone()).collect();
        assert!(names.contains(&"sodium-0.6.jar".to_string()));
        assert!(names.contains(&"iris.jar".to_string()));
    }

    #[test]
    fn sync_skips_unchanged() {
        let existing = vec![("sodium.jar".into(), mk_meta("hyenipack", Some("AAN"), Some("0.6.0")))];
        let target = vec![mk_mod("sodium.jar", Some("AAN"), Some("0.6.0"))];
        let plan = plan_mod_sync(&existing, &target);
        assert!(plan.to_install.is_empty());
        assert!(plan.to_remove.is_empty());
    }

    #[test]
    fn mod_meta_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let jar = dir.path().join("mods/sodium.jar");
        std::fs::create_dir_all(jar.parent().unwrap()).unwrap();
        std::fs::write(&jar, b"jar").unwrap();
        let meta = mk_meta("hyenipack", Some("AAN"), Some("0.6.0"));
        write_mod_meta(&jar, &meta).unwrap();
        assert_eq!(read_mod_meta(&jar).unwrap(), meta);
    }

    #[tokio::test]
    async fn install_pack_syncs_mods_and_applies_overrides() {
        use std::io::Write;
        // 모드 jar 서버
        let mod_body = b"SODIUM".to_vec();
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let addr = format!("http://{}", server.server_addr());
        let mb = mod_body.clone();
        std::thread::spawn(move || {
            for req in server.incoming_requests() {
                let _ = req.respond(tiny_http::Response::from_data(mb.clone()));
            }
        });

        // .hyenipack zip 구성 (hyenipack.json + overrides/config/opts.txt)
        let tmp = tempfile::tempdir().unwrap();
        let pack = tmp.path().join("test.hyenipack");
        {
            let f = std::fs::File::create(&pack).unwrap();
            let mut zw = zip::ZipWriter::new(f);
            let opt = zip::write::SimpleFileOptions::default();
            let manifest = format!(
                r#"{{"formatVersion":2,"hyenipackId":"hp-test","name":"T","version":"1.0.0",
                   "minecraft":{{"version":"1.21.1","loaderType":"fabric","loaderVersion":"0.16.7"}},
                   "mods":[{{"fileName":"sodium.jar","source":"modrinth","projectId":"AAN","url":"{addr}/sodium.jar"}}],
                   "overrides":[{{"path":"config","policy":"keep"}}]}}"#
            );
            zw.start_file("hyenipack.json", opt).unwrap();
            zw.write_all(manifest.as_bytes()).unwrap();
            zw.start_file("overrides/config/opts.txt", opt).unwrap();
            zw.write_all(b"OPTS").unwrap();
            zw.finish().unwrap();
        }

        let dirs = GameDirs {
            instance_dir: tmp.path().join("inst"),
            shared_libraries: tmp.path().join("sl"),
            shared_assets: tmp.path().join("sa"),
        };
        // 사용자 추가 모드(보존 대상) 미리 배치
        std::fs::create_dir_all(dirs.instance_dir.join("mods")).unwrap();
        std::fs::write(dirs.instance_dir.join("mods/user.jar"), b"USER").unwrap();

        let http = reqwest::Client::new();
        let cfg = DownloadConfig { timeout: std::time::Duration::from_secs(5), retry_base_ms: 1, ..Default::default() };
        let manifest = install_pack(&http, &pack, &dirs, &cfg, None, |_| {}).await.unwrap();

        assert_eq!(manifest.hyenipack_id.as_deref(), Some("hp-test"));
        assert_eq!(std::fs::read(dirs.instance_dir.join("mods/sodium.jar")).unwrap(), b"SODIUM");
        assert_eq!(std::fs::read(dirs.instance_dir.join("config/opts.txt")).unwrap(), b"OPTS");
        assert!(dirs.instance_dir.join("mods/user.jar").exists()); // manual 보존
        // .meta.json 기록 확인
        let meta = read_mod_meta(&dirs.instance_dir.join("mods/sodium.jar")).unwrap();
        assert_eq!(meta.installed_from.as_deref(), Some("hyenipack"));
        assert_eq!(meta.modpack_id.as_deref(), Some("hp-test"));
        // pack_meta 기록
        assert_eq!(read_pack_meta(&dirs.instance_dir).unwrap().version, "1.0.0");
    }

    #[test]
    fn cf_url_gets_token() {
        let m = PackMod {
            file_name: "cf.jar".into(),
            url: Some("https://worker/download".into()),
            sha256: None, sha1: None, size: None,
            source: Some("curseforge".into()),
            project_id: None, metadata: None,
        };
        assert!(maybe_authorize_url("https://worker/download", &m, Some("tok")).contains("token=tok"));
        // modrinth는 토큰 미부착
        let mr = mk_mod("s.jar", Some("AAN"), None);
        assert!(!maybe_authorize_url("https://cdn/s.jar", &mr, Some("tok")).contains("token"));
    }
}
