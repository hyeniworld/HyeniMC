//! 혜니팩 설치 + V2 선언형 동기화 + 팩 업데이트.
//! 사용자 런처는 url 피닝된 매니페스트 전제(MR/CF 라이브 resolve는 제작자 도구 몫).

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::download::{download_all, DownloadConfig, DownloadTask};
use crate::install::GameDirs;
use crate::LauncherError;

// ── 매니페스트 (v1/v2 공용) ──────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackMinecraft {
    pub version: String,
    pub loader_type: String,
    #[serde(default)]
    pub loader_version: String,
}

/// 매니페스트 모드 엔트리. exporter는 metadata 중첩({source,projectId,version})으로 저장하므로
/// 평면 필드 + 중첩 metadata 양쪽을 흡수한다.
#[derive(Debug, Clone, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
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

/// 레거시 개별 사이드카 경로 `<jar>.meta.json` — 삭제 시 정리용(더 이상 쓰지 않음).
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
                    // 파일명이 바뀌는 재설치면 구 jar 제거 (중복 모드 크래시 방지).
                    // manual이라도 projectId 매치 시 팩이 인수(V2 문서: 덮어쓰기 후 관리 대상).
                    if &t.file_name != name && !to_remove.contains(name) {
                        to_remove.push(name.clone());
                    }
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
    // formatVersion 방어 — 이 런처가 아는 형식은 v1·v2뿐. 0(키 누락)·3+ 등은 처리 규칙이
    // 다르거나 손상 매니페스트이므로 조용히 오설치하지 않고 명시적으로 거부한다(Electron 동일).
    if manifest.format_version != 1 && manifest.format_version != 2 {
        return Err(LauncherError::Other(format!(
            "지원하지 않는 혜니팩 형식입니다 (formatVersion={}). 런처를 업데이트하거나 팩을 다시 받으세요.",
            manifest.format_version
        )));
    }
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

    // 다운로드(url 피닝분) + zip 동봉분(로컬/커스텀 모드 — TS importer 동일) 분리
    let total = plan.to_install.len();
    let mut tasks = Vec::new();
    let mut from_zip: Vec<&PackMod> = Vec::new();
    for m in &plan.to_install {
        match &m.url {
            Some(url) => {
                // CF 프록시는 토큰 쿼리 부착 (worker downloadFile 방식)
                let url = maybe_authorize_url(url, m, worker_token);
                tasks.push(DownloadTask {
                    url,
                    dest: mods_dir.join(&m.file_name),
                    sha1: m.sha1.clone(),
                    sha256: m.sha256.clone(),
                    size: m.size,
                });
            }
            None => from_zip.push(m),
        }
    }
    // 다운로드분 개수 — zip 동봉 추출 진행률을 이 뒤로 이어붙인다(전체 total 대비 연속 표시).
    let downloaded_count = tasks.len();
    download_all(http, tasks, cfg, |p| {
        on_progress(PackInstallProgress { stage: "mods".into(), completed: p.completed, total });
    })
    .await?;

    // zip 동봉 모드 추출 (url 없는 엔트리 — v1 팩/로컬 모드/피닝 실패 폴백).
    // 다운로드 안 하는 동봉분도 진행률에 포함해야 303/343에서 멈춘 듯 보이지 않는다.
    if !from_zip.is_empty() {
        let file = std::fs::File::open(pack_zip)?;
        let mut zip = zip::ZipArchive::new(file).map_err(|e| LauncherError::Other(e.to_string()))?;
        for (i, m) in from_zip.iter().enumerate() {
            let entry_name = format!("mods/{}", m.file_name);
            let mut entry = zip.by_name(&entry_name).map_err(|_| {
                LauncherError::Other(format!(
                    "모드를 받을 곳이 없음 (url 미피닝 + zip에도 없음): {}",
                    m.file_name
                ))
            })?;
            let dest = mods_dir.join(&m.file_name);
            let mut out = std::fs::File::create(&dest)?;
            std::io::copy(&mut entry, &mut out)?;
            on_progress(PackInstallProgress {
                stage: "mods".into(),
                completed: downloaded_count + i + 1,
                total,
            });
        }
    }

    // 설치 메타를 통합 파일(.hyenimc-metadata.json)에 기록 — 개별 사이드카 대신 Electron과
    // 동일 정본에 쓴다. 기존 파일이 있으면 미지 필드(autoUpdate 등)를 보존한 채 갱신.
    {
        use crate::instmeta::{self, InstalledModMeta};
        let mut unified = instmeta::read_unified(&mods_dir)
            .unwrap_or_else(|| instmeta::UnifiedMetadata::new("hyenipack"));
        unified.source = "hyenipack".into();
        for name in &plan.to_remove {
            unified.mods.remove(name);
        }
        let now = instmeta::iso_now();
        for m in &plan.to_install {
            unified.mods.insert(
                m.file_name.clone(),
                InstalledModMeta {
                    source: m.effective_source().unwrap_or_else(|| "url".into()),
                    source_mod_id: m.effective_project_id(),
                    source_file_id: None,
                    version_number: m.effective_version(),
                    installed_at: Some(now.clone()),
                    installed_from: Some("hyenipack".into()),
                    modpack_id: manifest.hyenipack_id.clone(),
                    modpack_version: Some(manifest.version.clone()),
                    extra: Default::default(),
                },
            );
        }
        if let Some(id) = &manifest.hyenipack_id {
            unified.modpack_id = Some(id.clone());
        }
        unified.modpack_name = Some(manifest.name.clone());
        unified.modpack_version = Some(manifest.version.clone());
        unified.updated_at = now;
        instmeta::write_unified(&mods_dir, &unified)?;
    }

    // overrides 적용 + 제공 리소스/셰이더팩 기록
    // overrides 적용은 시간이 걸릴 수 있어(설정/리소스 다수 추출) 마무리 단계로 전환해 표시.
    // (그러지 않으면 UI가 모드 100%에서 멈춘 듯 보인다)
    on_progress(PackInstallProgress { stage: "finalize".into(), completed: 0, total: 1 });
    let provided = apply_overrides(pack_zip, dirs, &manifest.overrides, &on_progress)?;
    std::fs::write(
        provided_packs_path(&dirs.instance_dir),
        serde_json::to_string_pretty(&provided)?,
    )?;

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

pub fn read_manifest_from_zip(pack_zip: &Path) -> Result<PackManifest, LauncherError> {
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
    // 통합 파일(.hyenimc-metadata.json)에서 파일별 메타를 조회 — 없으면 manual(사용자 추가)로 간주.
    // 이래야 Electron으로 설치한 모드도 hyenipack 관리 대상으로 정확히 인식돼
    // 마이그레이션 시 중복/미삭제가 생기지 않는다.
    let unified = crate::instmeta::read_unified(mods_dir);
    for entry in rd.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.ends_with(".jar") {
            continue;
        }
        let inst = unified.as_ref().and_then(|u| u.mods.get(&name).cloned());
        let meta = inst.map(modmeta_from_installed).unwrap_or(ModMeta {
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

/// 통합/레거시 InstalledModMeta → 동기화 판정용 ModMeta.
fn modmeta_from_installed(m: crate::instmeta::InstalledModMeta) -> ModMeta {
    ModMeta {
        source: if m.source.is_empty() { "local".into() } else { m.source },
        source_mod_id: m.source_mod_id,
        version_number: m.version_number,
        installed_from: m.installed_from,
        modpack_id: m.modpack_id,
        modpack_version: m.modpack_version,
    }
}

/// overrides 적용. 반환: 팩이 제공한 resourcepacks/shaderpacks 파일명 (구분 표시용)
fn apply_overrides(
    pack_zip: &Path,
    dirs: &GameDirs,
    policies: &[OverridePolicy],
    _on_progress: &(impl Fn(PackInstallProgress) + Send + Sync),
) -> Result<ProvidedPacks, LauncherError> {
    // V2 폴더 replace 의미론: 해당 폴더 기존 내용 전체 삭제 후 zip 내용으로 재설치
    for p in policies {
        if p.policy == "replace" {
            let target = dirs.instance_dir.join(&p.path);
            if target.is_dir() {
                let _ = std::fs::remove_dir_all(&target);
            }
        }
    }

    let mut provided = ProvidedPacks::default();
    let file = std::fs::File::open(pack_zip)?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| LauncherError::Other(e.to_string()))?;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| LauncherError::Other(e.to_string()))?;
        let name = entry.name().to_string();
        let Some(rel) = name.strip_prefix("overrides/") else { continue };
        if rel.is_empty() || name.ends_with('/') {
            continue;
        }
        // 최상위 폴더가 resourcepacks/shaderpacks면 제공 파일로 기록 (구분 표시용)
        let norm = rel.replace('\\', "/");
        if let Some(fname) = norm.strip_prefix("resourcepacks/") {
            if !fname.contains('/') {
                provided.resourcepacks.push(fname.to_string());
            }
        } else if let Some(fname) = norm.strip_prefix("shaderpacks/") {
            if !fname.contains('/') {
                provided.shaderpacks.push(fname.to_string());
            }
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
    Ok(provided)
}

/// 팩 제공 리소스/셰이더팩 파일명 — `<instance>/.hyenipack-provided.json`
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ProvidedPacks {
    #[serde(default)]
    pub resourcepacks: Vec<String>,
    #[serde(default)]
    pub shaderpacks: Vec<String>,
}

pub fn provided_packs_path(instance_dir: &Path) -> PathBuf {
    instance_dir.join(".hyenipack-provided.json")
}

pub fn read_provided_packs(instance_dir: &Path) -> ProvidedPacks {
    std::fs::read_to_string(provided_packs_path(instance_dir))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
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
    let resp = http.get(&url).send().await?;
    // 404 = 이 팩이 업데이트 서버에 없음(로컬에서 만든 미배포 팩 / 관리 대상 아님).
    // "연결 불가"(네트워크 오류)와 구분해 업데이트 없음으로 취급 → 실행 차단하지 않는다.
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    let latest: LatestInfo = resp.error_for_status()?.json().await?;
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

/// 팩 버전 다운로드(Worker) → 임시 .hyenipack 경로.
/// 청크 스트리밍으로 받으며 `on_progress(받은 바이트, 전체 바이트)`로 진행률을 보고한다.
/// 전체 크기(Content-Length)는 없을 수 있어 `Option<u64>`.
pub async fn download_pack_version(
    http: &reqwest::Client,
    worker_base: &str,
    hyenipack_id: &str,
    version: &str,
    token: &str,
    dest: &Path,
    mut on_progress: impl FnMut(u64, Option<u64>),
) -> Result<(), LauncherError> {
    let url = format!(
        "{}/download/v2/modpacks/{}/{}?token={}",
        worker_base.trim_end_matches('/'),
        hyenipack_id,
        version,
        token
    );
    let mut resp = http.get(&url).send().await?.error_for_status()?;
    let total = resp.content_length();
    if let Some(p) = dest.parent() {
        tokio::fs::create_dir_all(p).await?;
    }
    let mut file = tokio::fs::File::create(dest).await?;
    let mut received: u64 = 0;
    use tokio::io::AsyncWriteExt;
    while let Some(chunk) = resp.chunk().await? {
        file.write_all(&chunk).await?;
        received += chunk.len() as u64;
        on_progress(received, total);
    }
    file.flush().await?;
    Ok(())
}

// ── 공개 팩 목록/latest (Worker) ─────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackListMinecraft {
    pub version: String,
    pub loader_type: String,
    #[serde(default)]
    pub loader_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackListItem {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub latest_version: Option<String>,
    #[serde(default)]
    pub breaking: bool,
    #[serde(default)]
    pub minecraft: Option<PackListMinecraft>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct PackListResponse {
    pub packs: Vec<PackListItem>,
}

/// 공개 팩 목록(GET /api/v2/modpacks). 토큰 불필요.
pub async fn fetch_pack_list(
    http: &reqwest::Client,
    worker_base: &str,
) -> Result<Vec<PackListItem>, LauncherError> {
    let url = format!("{}/api/v2/modpacks", worker_base.trim_end_matches('/'));
    let resp: PackListResponse = http.get(&url).send().await?.error_for_status()?.json().await?;
    Ok(resp.packs)
}

/// 팩 공개 latest 버전. 404(비공개/부재) → Ok(None).
pub async fn fetch_pack_latest_version(
    http: &reqwest::Client,
    worker_base: &str,
    id: &str,
) -> Result<Option<String>, LauncherError> {
    let url = format!("{}/api/v2/modpacks/{}/latest", worker_base.trim_end_matches('/'), id);
    let resp = http.get(&url).send().await?;
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    #[derive(Deserialize)]
    struct L {
        version: String,
    }
    let l: L = resp.error_for_status()?.json().await?;
    Ok(Some(l.version))
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
    fn sync_removes_old_jar_when_renamed_reinstall() {
        // F3 회귀: projectId 매치 + 파일명 변경 → 새 jar 설치와 함께 구 jar도 제거돼야 함
        let existing = vec![
            ("old-sodium.jar".into(), mk_meta("hyenipack", Some("AAN"), Some("0.5.0"))),
        ];
        let target = vec![mk_mod("sodium-0.6.jar", Some("AAN"), Some("0.6.0"))];
        let plan = plan_mod_sync(&existing, &target);
        assert!(plan.to_remove.contains(&"old-sodium.jar".to_string()), "구 jar 미삭제 (중복 모드 크래시)");
        assert_eq!(plan.to_install.len(), 1);
    }

    #[test]
    fn sync_takes_over_matching_manual_mod_on_rename() {
        // V2 문서: 파일명/ID 동일하면 혜니팩 버전으로 덮어쓰기(이제부터 관리 대상)
        // → manual이라도 projectId가 매치되고 재설치가 필요하면 구 파일 제거
        let existing = vec![
            ("sodium-user.jar".into(), mk_meta("manual", Some("AAN"), Some("0.5.0"))),
        ];
        let target = vec![mk_mod("sodium-0.6.jar", Some("AAN"), Some("0.6.0"))];
        let plan = plan_mod_sync(&existing, &target);
        assert!(plan.to_remove.contains(&"sodium-user.jar".to_string()));
        assert_eq!(plan.to_install.len(), 1);
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
    fn scan_reads_unified_metadata_for_migration() {
        // Electron으로 설치한 프로필: 통합 파일만 있고 개별 사이드카는 없음
        let dir = tempfile::tempdir().unwrap();
        let mods = dir.path().join("mods");
        std::fs::create_dir_all(&mods).unwrap();
        std::fs::write(mods.join("sodium-0.5.jar"), b"jar").unwrap();
        std::fs::write(mods.join("user.jar"), b"jar").unwrap();
        std::fs::write(
            mods.join(".hyenimc-metadata.json"),
            r#"{"version":1,"source":"hyenipack","installedAt":"x","updatedAt":"x",
               "mods":{"sodium-0.5.jar":{"source":"modrinth","sourceModId":"AAN",
               "versionNumber":"0.5.0","installedFrom":"hyenipack"}}}"#,
        )
        .unwrap();

        let existing = scan_installed_mods(&mods).unwrap();
        let sodium = existing.iter().find(|(n, _)| n == "sodium-0.5.jar").unwrap();
        assert_eq!(sodium.1.installed_from.as_deref(), Some("hyenipack"));
        assert_eq!(sodium.1.source_mod_id.as_deref(), Some("AAN"));
        // 통합에 없는 user.jar는 manual(보존)로 인식
        let user = existing.iter().find(|(n, _)| n == "user.jar").unwrap();
        assert_eq!(user.1.installed_from.as_deref(), Some("manual"));

        // 팩 업데이트 시 매니페스트에서 빠진 구 sodium이 삭제 대상(파일명 변경 → 중복 방지)
        let target = vec![mk_mod("sodium-0.6.jar", Some("AAN"), Some("0.6.0"))];
        let plan = plan_mod_sync(&existing, &target);
        assert!(
            plan.to_remove.contains(&"sodium-0.5.jar".to_string()),
            "통합 메타 미인식 시 구 jar가 안 지워져 중복 모드 크래시"
        );
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
        // 통합 메타(.hyenimc-metadata.json) 기록 확인 (개별 사이드카 아님)
        let unified = crate::instmeta::read_unified(&dirs.instance_dir.join("mods")).unwrap();
        let meta = unified.mods.get("sodium.jar").expect("통합 메타에 sodium 기록");
        assert_eq!(meta.installed_from.as_deref(), Some("hyenipack"));
        assert_eq!(meta.modpack_id.as_deref(), Some("hp-test"));
        assert!(!dirs.instance_dir.join("mods/sodium.jar.meta.json").exists(), "개별 사이드카 미생성");
        // pack_meta 기록
        assert_eq!(read_pack_meta(&dirs.instance_dir).unwrap().version, "1.0.0");
    }

    #[tokio::test]
    async fn install_pack_extracts_local_mods_and_folder_replace_semantics() {
        use std::io::Write;
        let tmp = tempfile::tempdir().unwrap();
        let pack = tmp.path().join("local.hyenipack");
        {
            let f = std::fs::File::create(&pack).unwrap();
            let mut zw = zip::ZipWriter::new(f);
            let opt = zip::write::SimpleFileOptions::default();
            // url 없는 로컬 모드 + scripts 폴더 replace 정책
            zw.start_file("hyenipack.json", opt).unwrap();
            zw.write_all(
                br#"{"formatVersion":2,"hyenipackId":"hp-local","name":"L","version":"1.0.0",
                    "minecraft":{"version":"1.21.1","loaderType":"fabric","loaderVersion":"0.16.7"},
                    "mods":[{"fileName":"custom.jar","source":"local"}],
                    "overrides":[{"path":"scripts","policy":"replace"}]}"#,
            )
            .unwrap();
            zw.start_file("mods/custom.jar", opt).unwrap();
            zw.write_all(b"CUSTOM").unwrap();
            zw.start_file("overrides/scripts/new.zs", opt).unwrap();
            zw.write_all(b"NEW").unwrap();
            zw.finish().unwrap();
        }

        let dirs = GameDirs {
            instance_dir: tmp.path().join("inst"),
            shared_libraries: tmp.path().join("sl"),
            shared_assets: tmp.path().join("sa"),
        };
        // replace 폴더에 stale 파일 미리 배치 → 삭제돼야 함
        std::fs::create_dir_all(dirs.instance_dir.join("scripts")).unwrap();
        std::fs::write(dirs.instance_dir.join("scripts/stale.zs"), b"OLD").unwrap();

        let http = reqwest::Client::new();
        let cfg = DownloadConfig { timeout: std::time::Duration::from_secs(5), retry_base_ms: 1, ..Default::default() };
        install_pack(&http, &pack, &dirs, &cfg, None, |_| {}).await.unwrap();

        // F2: zip 동봉 로컬 모드 설치됨
        assert_eq!(std::fs::read(dirs.instance_dir.join("mods/custom.jar")).unwrap(), b"CUSTOM");
        // F6: 폴더 replace — stale 삭제 + 신규 설치
        assert!(!dirs.instance_dir.join("scripts/stale.zs").exists());
        assert_eq!(std::fs::read(dirs.instance_dir.join("scripts/new.zs")).unwrap(), b"NEW");
    }

    #[test]
    fn pack_list_item_deserializes_worker_response() {
        let json = r#"{"packs":[{"id":"season3","name":"시즌3 팩","latestVersion":"1.2.0","breaking":false,
            "minecraft":{"version":"1.21.1","loaderType":"neoforge","loaderVersion":"21.1.186"}},
            {"id":"legacy","name":"legacy","latestVersion":"0.9.0","breaking":true,"minecraft":null}]}"#;
        let resp: PackListResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.packs.len(), 2);
        assert_eq!(resp.packs[0].minecraft.as_ref().unwrap().loader_type, "neoforge");
        assert!(resp.packs[1].minecraft.is_none());
        assert!(resp.packs[1].breaking);
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
