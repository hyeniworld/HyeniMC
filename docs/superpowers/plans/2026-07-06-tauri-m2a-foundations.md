# Tauri M2a: 게임 파이프라인 기반 3종 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** hyenimc-launcher 크레이트에 M2의 오프라인 테스트 가능한 기반 3종 — ① 병렬 다운로드 엔진(SHA1/재시도/재개) ② Mojang 버전 매니페스트 모델 + OS rules 평가 ③ Java 감지 — 를 구현한다. (설치 파이프라인·JVM 실행·Tauri 배선은 후속 플랜 M2b)

**Architecture:** 새 크레이트 `crates/hyenimc-launcher` (tokio 비동기). download.rs는 TS DownloadManager(311줄)의 의미 포팅 — 세마포어 병렬 + SHA1 검증 + 지수 백오프 재시도. manifest.rs/rules.rs는 piston-meta version_manifest_v2 + 버전 상세 JSON의 serde 모델(inheritsFrom 병합 포함). java.rs는 TS java-detector의 macOS 경로(java_home -V + JavaVirtualMachines 스캔) 우선.

**Tech Stack:** tokio, reqwest, sha1, serde/serde_json, zip(후속), dev: tiny_http, tempfile.

## Global Constraints

- 디렉터리 레이아웃 in-place 호환(실측): 공유 `<userData>/shared/libraries|assets`, 버전은 프로필별 `<instance>/versions/<id>/` — M2b에서 사용, 본 플랜은 경로 하드코딩 금지(파라미터로 받기)
- 매니페스트 URL: `https://piston-meta.mojang.com/mc/game/version_manifest_v2.json`, 에셋: `https://resources.download.minecraft.net/<h2>/<hash>` (TS version-manager.ts 실측)
- 병렬 기본값은 설정의 download.max_parallel(기본 10), 재시도 max_retries(기본 5), 백오프 1→2→4→8→16s(cap 30) — Go download_service.go 의미 유지
- 테스트는 전부 오프라인(로컬 tiny_http 서버/fixture JSON). 실네트워크 호출 테스트 금지
- 브랜치 `feat/tauri-m0` 계속, 커밋 형식 `feat(tauri): ...`

---

### Task 1: hyenimc-launcher 크레이트 + 다운로드 엔진

**Files:**
- Create: `crates/hyenimc-launcher/Cargo.toml`, `crates/hyenimc-launcher/src/lib.rs`, `crates/hyenimc-launcher/src/download.rs`
- Modify: `Cargo.toml` (workspace members + tokio/reqwest/sha1/futures deps)

**Interfaces:**
- Produces: `DownloadTask{url: String, dest: PathBuf, sha1: Option<String>, size: Option<u64>}`, `DownloadConfig{max_parallel: usize, max_retries: u32, timeout: Duration}`, `Progress{completed: usize, total: usize, bytes_done: u64, current_file: String}`, `async fn download_all(client: &reqwest::Client, tasks: Vec<DownloadTask>, cfg: &DownloadConfig, on_progress: impl Fn(Progress) + Send + Sync) -> Result<(), LauncherError>` — 이미 존재+SHA1 일치 파일은 스킵, 불일치는 재다운로드, 실패 시 태스크 단위 재시도

- [ ] **Step 1: 크레이트 스캐폴드 + 실패하는 테스트** — Cargo.toml:

```toml
[package]
name = "hyenimc-launcher"
version.workspace = true
edition.workspace = true
license.workspace = true
authors.workspace = true

[dependencies]
serde.workspace = true
serde_json.workspace = true
thiserror.workspace = true
tokio = { version = "1", features = ["rt-multi-thread", "macros", "fs", "process", "sync", "io-util", "time"] }
reqwest = { version = "0.12", features = ["stream"] }
sha1 = "0.10"
hex = "0.4"
futures = "0.3"

[dev-dependencies]
tempfile = "3"
tiny_http = "0.12"
```

workspace members에 `"crates/hyenimc-launcher"` 추가. lib.rs:

```rust
//! 게임 파이프라인 — 다운로드/매니페스트/Java/실행 (M2).

pub mod download;
pub mod java;
pub mod manifest;
pub mod rules;

#[derive(thiserror::Error, Debug)]
pub enum LauncherError {
    #[error("http error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("checksum mismatch for {path}: expected {expected}, got {actual}")]
    ChecksumMismatch { path: String, expected: String, actual: String },
    #[error("download failed after {retries} retries: {url}")]
    DownloadFailed { url: String, retries: u32 },
    #[error("{0}")]
    Other(String),
}
```

테스트 (download.rs 하단) — tiny_http로 로컬 서버 띄워 검증:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    /// body를 N개 경로로 서빙하는 로컬 서버. /fail_once/*는 첫 요청에 500.
    fn spawn_server(body: &'static [u8]) -> (String, Arc<AtomicUsize>) {
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let addr = format!("http://{}", server.server_addr());
        let hits = Arc::new(AtomicUsize::new(0));
        let hits2 = hits.clone();
        std::thread::spawn(move || {
            let mut failed_once = std::collections::HashSet::new();
            for req in server.incoming_requests() {
                hits2.fetch_add(1, Ordering::SeqCst);
                let url = req.url().to_string();
                if url.starts_with("/fail_once/") && failed_once.insert(url.clone()) {
                    let _ = req.respond(tiny_http::Response::empty(500));
                    continue;
                }
                let _ = req.respond(tiny_http::Response::from_data(body));
            }
        });
        (addr, hits)
    }

    fn sha1_hex(data: &[u8]) -> String {
        use sha1::{Digest, Sha1};
        hex::encode(Sha1::digest(data))
    }

    #[tokio::test]
    async fn downloads_verifies_and_skips_existing() {
        let (addr, hits) = spawn_server(b"hello-mc");
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("a/b/file.jar");
        let sha = sha1_hex(b"hello-mc");
        let client = reqwest::Client::new();
        let cfg = DownloadConfig::default();

        let task = || DownloadTask {
            url: format!("{addr}/file.jar"),
            dest: dest.clone(),
            sha1: Some(sha.clone()),
            size: None,
        };
        download_all(&client, vec![task()], &cfg, |_| {}).await.unwrap();
        assert_eq!(std::fs::read(&dest).unwrap(), b"hello-mc");
        let first_hits = hits.load(Ordering::SeqCst);

        // 동일 SHA1 파일 존재 → 재다운로드 없음
        download_all(&client, vec![task()], &cfg, |_| {}).await.unwrap();
        assert_eq!(hits.load(Ordering::SeqCst), first_hits);
    }

    #[tokio::test]
    async fn retries_on_server_error() {
        let (addr, _hits) = spawn_server(b"retry-ok");
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("f.jar");
        let client = reqwest::Client::new();
        let cfg = DownloadConfig { retry_base_ms: 1, ..Default::default() };
        let task = DownloadTask {
            url: format!("{addr}/fail_once/f.jar"),
            dest: dest.clone(),
            sha1: Some(sha1_hex(b"retry-ok")),
            size: None,
        };
        download_all(&client, vec![task], &cfg, |_| {}).await.unwrap();
        assert_eq!(std::fs::read(&dest).unwrap(), b"retry-ok");
    }

    #[tokio::test]
    async fn checksum_mismatch_fails_after_retries() {
        let (addr, _) = spawn_server(b"corrupted");
        let dir = tempfile::tempdir().unwrap();
        let client = reqwest::Client::new();
        let cfg = DownloadConfig { max_retries: 1, retry_base_ms: 1, ..Default::default() };
        let task = DownloadTask {
            url: format!("{addr}/x.jar"),
            dest: dir.path().join("x.jar"),
            sha1: Some("0000000000000000000000000000000000000000".into()),
            size: None,
        };
        let err = download_all(&client, vec![task], &cfg, |_| {}).await.unwrap_err();
        assert!(matches!(err, LauncherError::DownloadFailed { .. }));
    }

    #[tokio::test]
    async fn progress_reports_completion() {
        let (addr, _) = spawn_server(b"p");
        let dir = tempfile::tempdir().unwrap();
        let client = reqwest::Client::new();
        let done = Arc::new(AtomicUsize::new(0));
        let done2 = done.clone();
        let tasks = (0..5)
            .map(|i| DownloadTask {
                url: format!("{addr}/f{i}"),
                dest: dir.path().join(format!("f{i}")),
                sha1: None,
                size: None,
            })
            .collect();
        download_all(&reqwest::Client::new(), tasks, &DownloadConfig::default(), move |p| {
            done2.store(p.completed, Ordering::SeqCst);
        })
        .await
        .unwrap();
        let _ = client;
        assert_eq!(done.load(Ordering::SeqCst), 5);
    }
}
```

- [ ] **Step 2: RED 확인** — Run: `cargo test -p hyenimc-launcher` / Expected: 컴파일 실패(타입 미정의)

- [ ] **Step 3: 구현** — download.rs:

```rust
//! 병렬 다운로드 엔진 — TS DownloadManager + Go DownloadService의 의미 포팅.
//! 세마포어 병렬, SHA1 검증(불일치 시 삭제 후 재시도), 지수 백오프, .part 임시 파일.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use sha1::{Digest, Sha1};
use tokio::io::AsyncWriteExt;
use tokio::sync::Semaphore;

use crate::LauncherError;

#[derive(Debug, Clone)]
pub struct DownloadTask {
    pub url: String,
    pub dest: PathBuf,
    pub sha1: Option<String>,
    pub size: Option<u64>,
}

#[derive(Debug, Clone)]
pub struct DownloadConfig {
    pub max_parallel: usize,
    pub max_retries: u32,
    pub timeout: Duration,
    pub retry_base_ms: u64,
}

impl Default for DownloadConfig {
    fn default() -> Self {
        Self { max_parallel: 10, max_retries: 5, timeout: Duration::from_secs(60), retry_base_ms: 1000 }
    }
}

#[derive(Debug, Clone)]
pub struct Progress {
    pub completed: usize,
    pub total: usize,
    pub bytes_done: u64,
    pub current_file: String,
}

fn sha1_file(path: &std::path::Path) -> std::io::Result<String> {
    let data = std::fs::read(path)?;
    Ok(hex::encode(Sha1::digest(&data)))
}

async fn fetch_to_file(
    client: &reqwest::Client,
    task: &DownloadTask,
    timeout: Duration,
) -> Result<(), LauncherError> {
    if let Some(parent) = task.dest.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let part = task.dest.with_extension("part");
    let resp = client.get(&task.url).timeout(timeout).send().await?.error_for_status()?;
    let mut file = tokio::fs::File::create(&part).await?;
    let mut stream = resp.bytes_stream();
    use futures::StreamExt;
    while let Some(chunk) = stream.next().await {
        file.write_all(&chunk?).await?;
    }
    file.flush().await?;
    drop(file);

    if let Some(expected) = &task.sha1 {
        let actual = sha1_file(&part)?;
        if !actual.eq_ignore_ascii_case(expected) {
            let _ = tokio::fs::remove_file(&part).await;
            return Err(LauncherError::ChecksumMismatch {
                path: task.dest.display().to_string(),
                expected: expected.clone(),
                actual,
            });
        }
    }
    tokio::fs::rename(&part, &task.dest).await?;
    Ok(())
}

async fn download_one(
    client: &reqwest::Client,
    task: &DownloadTask,
    cfg: &DownloadConfig,
) -> Result<(), LauncherError> {
    // 이미 존재 + SHA1 일치 → 스킵
    if task.dest.exists() {
        match &task.sha1 {
            Some(expected) if sha1_file(&task.dest).map(|a| a.eq_ignore_ascii_case(expected)).unwrap_or(false) => {
                return Ok(());
            }
            None => return Ok(()),
            _ => {} // 불일치 → 재다운로드
        }
    }
    let mut attempt = 0u32;
    loop {
        match fetch_to_file(client, task, cfg.timeout).await {
            Ok(()) => return Ok(()),
            Err(_e) if attempt < cfg.max_retries => {
                let backoff = cfg.retry_base_ms.saturating_mul(1 << attempt.min(5)).min(30_000);
                tokio::time::sleep(Duration::from_millis(backoff)).await;
                attempt += 1;
            }
            Err(_) => {
                return Err(LauncherError::DownloadFailed { url: task.url.clone(), retries: cfg.max_retries });
            }
        }
    }
}

pub async fn download_all(
    client: &reqwest::Client,
    tasks: Vec<DownloadTask>,
    cfg: &DownloadConfig,
    on_progress: impl Fn(Progress) + Send + Sync,
) -> Result<(), LauncherError> {
    let total = tasks.len();
    let sem = Arc::new(Semaphore::new(cfg.max_parallel.max(1)));
    let completed = Arc::new(AtomicUsize::new(0));
    let bytes = Arc::new(AtomicU64::new(0));

    let mut handles = Vec::with_capacity(total);
    for task in tasks {
        let sem = sem.clone();
        let client = client.clone();
        let cfg = cfg.clone();
        handles.push(async move {
            let _permit = sem.acquire().await.expect("semaphore closed");
            let r = download_one(&client, &task, &cfg).await;
            r.map(|_| task)
        });
    }

    let results = futures::future::join_all(handles).await;
    let mut first_err = None;
    for r in results {
        match r {
            Ok(task) => {
                let done = completed.fetch_add(1, Ordering::SeqCst) + 1;
                if let Some(sz) = task.size {
                    bytes.fetch_add(sz, Ordering::SeqCst);
                }
                on_progress(Progress {
                    completed: done,
                    total,
                    bytes_done: bytes.load(Ordering::SeqCst),
                    current_file: task.dest.file_name().map(|f| f.to_string_lossy().into_owned()).unwrap_or_default(),
                });
            }
            Err(e) => first_err = first_err.or(Some(e)),
        }
    }
    match first_err {
        None => Ok(()),
        Some(e) => Err(e),
    }
}
```

(참고: 진행 콜백이 완료 시점 단위인 것은 TS DownloadManager와 동일 수준. 바이트 스트리밍 진행은 M2b에서 이벤트 배선 시 필요하면 확장.)

- [ ] **Step 4: GREEN 확인** — Run: `cargo test -p hyenimc-launcher` / Expected: 4 passed
- [ ] **Step 5: 커밋** — `git commit -m "feat(tauri): hyenimc-launcher 다운로드 엔진 (병렬/SHA1/재시도)"`

---

### Task 2: 버전 매니페스트 모델 + OS rules

**Files:**
- Create: `crates/hyenimc-launcher/src/manifest.rs`, `crates/hyenimc-launcher/src/rules.rs`

**Interfaces:**
- Produces (manifest.rs): `VersionManifest{latest, versions: Vec<VersionSummary{id, r#type, url, sha1}>}`, `VersionDetail{id, main_class, asset_index: AssetIndexRef, downloads(client), libraries: Vec<Library>, arguments: Option<Arguments>, minecraft_arguments: Option<String>, java_version: Option<JavaVersionRef>, inherits_from: Option<String>}`, `Library{name, downloads(artifact/classifiers), natives, rules, url}`, `fn merge_inherited(child: VersionDetail, parent: VersionDetail) -> VersionDetail`, `const VERSION_MANIFEST_URL`
- Produces (rules.rs): `fn os_name() -> &'static str` ("osx"/"windows"/"linux"), `fn os_arch() -> &'static str`, `fn rules_allow(rules: &[Rule]) -> bool`, `Rule{action, os, features}` — features는 전부 false 취급(데모/커스텀 해상도 미사용)

- [ ] **Step 1: 실패하는 테스트** — fixture JSON은 인라인 문자열 (실제 piston 포맷 발췌):

```rust
// rules.rs tests
#[test]
fn allow_rule_without_os_matches_all() {
    let rules: Vec<Rule> = serde_json::from_str(r#"[{"action":"allow"}]"#).unwrap();
    assert!(rules_allow(&rules));
}

#[test]
fn disallow_for_current_os() {
    let json = format!(r#"[{{"action":"allow"}},{{"action":"disallow","os":{{"name":"{}"}}}}]"#, os_name());
    let rules: Vec<Rule> = serde_json::from_str(&json).unwrap();
    assert!(!rules_allow(&rules));
}

#[test]
fn allow_only_other_os_excludes_current() {
    let other = if os_name() == "osx" { "windows" } else { "osx" };
    let json = format!(r#"[{{"action":"allow","os":{{"name":"{other}"}}}}]"#);
    let rules: Vec<Rule> = serde_json::from_str(&json).unwrap();
    assert!(!rules_allow(&rules));
}

#[test]
fn feature_rules_are_disallowed() {
    let rules: Vec<Rule> =
        serde_json::from_str(r#"[{"action":"allow","features":{"is_demo_user":true}}]"#).unwrap();
    assert!(!rules_allow(&rules));
}
```

```rust
// manifest.rs tests — 실제 포맷 축약 fixture
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
}

#[test]
fn merge_inherited_combines_libraries_and_keeps_child_mainclass() {
    let parent: VersionDetail = serde_json::from_str(DETAIL_FIXTURE).unwrap();
    let child: VersionDetail = serde_json::from_str(
        r#"{"id":"loader-1.21.1","inheritsFrom":"1.21.1","mainClass":"loader.Main",
            "libraries":[{"name":"loader:core:1"}]}"#,
    ).unwrap();
    let merged = merge_inherited(child, parent);
    assert_eq!(merged.main_class.as_deref(), Some("loader.Main"));
    assert_eq!(merged.libraries.len(), 3); // 자식 라이브러리 + 부모 라이브러리
    assert!(merged.downloads.is_some()); // 부모 client 다운로드 유지
    assert_eq!(merged.id, "loader-1.21.1");
}
```

- [ ] **Step 2: RED 확인** — `cargo test -p hyenimc-launcher manifest rules` 컴파일 실패
- [ ] **Step 3: 구현** — rules.rs:

```rust
//! 라이브러리/인자 OS rules 평가 (piston 버전 JSON).

use serde::Deserialize;
use std::collections::HashMap;

#[derive(Debug, Clone, Deserialize)]
pub struct Rule {
    pub action: String, // "allow" | "disallow"
    #[serde(default)]
    pub os: Option<OsRule>,
    #[serde(default)]
    pub features: Option<HashMap<String, bool>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct OsRule {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub arch: Option<String>,
    #[serde(default)]
    pub version: Option<String>, // 정규식 — 미사용(항상 매치 취급)
}

pub fn os_name() -> &'static str {
    if cfg!(target_os = "macos") { "osx" }
    else if cfg!(target_os = "windows") { "windows" }
    else { "linux" }
}

pub fn os_arch() -> &'static str {
    if cfg!(target_arch = "aarch64") { "arm64" } else { "x86" }
}

fn rule_matches(rule: &Rule) -> bool {
    // feature 조건은 전부 미사용 → feature가 걸린 rule은 매치 안 함
    if rule.features.as_ref().is_some_and(|f| !f.is_empty()) {
        return false;
    }
    match &rule.os {
        None => true,
        Some(os) => {
            os.name.as_deref().map_or(true, |n| n == os_name())
                && os.arch.as_deref().map_or(true, |a| a == os_arch() || a == "x86")
        }
    }
}

/// rules가 비면 허용. 마지막으로 매치된 rule의 action이 최종 결정 (piston 의미론).
pub fn rules_allow(rules: &[Rule]) -> bool {
    if rules.is_empty() {
        return true;
    }
    let mut allowed = false;
    for rule in rules {
        if rule_matches(rule) {
            allowed = rule.action == "allow";
        }
    }
    allowed
}
```

manifest.rs (serde 모델 — camelCase rename, Option 관용, `merge_inherited`는 자식 우선 + 라이브러리는 자식∪부모):

```rust
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
    pub minecraft_arguments: Option<String>, // 레거시(1.12-)
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

/// inheritsFrom 병합 — 자식 값 우선, 라이브러리는 자식 + 부모 합집합 (TS loadVersionJson 의미).
pub fn merge_inherited(child: VersionDetail, parent: VersionDetail) -> VersionDetail {
    let mut libraries = child.libraries.clone();
    libraries.extend(parent.libraries);
    VersionDetail {
        id: child.id,
        inherits_from: None,
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
```

- [ ] **Step 4: GREEN** — `cargo test -p hyenimc-launcher` all pass
- [ ] **Step 5: 커밋** — `git commit -m "feat(tauri): 버전 매니페스트 모델 + OS rules (inheritsFrom 병합)"`

---

### Task 3: Java 감지

**Files:**
- Create: `crates/hyenimc-launcher/src/java.rs`

**Interfaces:**
- Produces: `JavaInstallation{path: String, version: String, major_version: u32}` (camelCase 직렬화 — serde Serialize 추가), `fn parse_java_version_output(stderr: &str) -> Option<String>` (순수 — `java -version` stderr에서 버전 추출), `fn parse_major(version: &str) -> u32` ("1.8.0_392"→8, "21.0.5"→21), `async fn detect_java_installations() -> Vec<JavaInstallation>` (macOS: `/usr/libexec/java_home -V` + JavaVirtualMachines 스캔, Windows: 알려진 디렉터리, 공통: PATH의 java)

- [ ] **Step 1: 실패하는 테스트** (순수 파서만 — 감지 자체는 실기 스모크):

```rust
#[test]
fn parses_modern_version_output() {
    let out = r#"openjdk version "21.0.5" 2024-10-15 LTS"#;
    assert_eq!(parse_java_version_output(out).as_deref(), Some("21.0.5"));
}

#[test]
fn parses_legacy_version_output() {
    let out = r#"java version "1.8.0_392""#;
    assert_eq!(parse_java_version_output(out).as_deref(), Some("1.8.0_392"));
}

#[test]
fn major_version_rules() {
    assert_eq!(parse_major("1.8.0_392"), 8);
    assert_eq!(parse_major("21.0.5"), 21);
    assert_eq!(parse_major("17"), 17);
}
```

- [ ] **Step 2: RED → Step 3: 구현**:

```rust
//! Java 설치 감지 — TS java-detector.ts 의미 포팅 (macOS 우선).

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JavaInstallation {
    pub path: String,
    pub version: String,
    pub major_version: u32,
}

pub fn parse_java_version_output(out: &str) -> Option<String> {
    // `... version "21.0.5" ...` 패턴에서 따옴표 안 추출
    let idx = out.find("version \"")? + "version \"".len();
    let rest = &out[idx..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

pub fn parse_major(version: &str) -> u32 {
    let mut parts = version.split(['.', '_', '-']);
    let first: u32 = parts.next().and_then(|p| p.parse().ok()).unwrap_or(0);
    if first == 1 {
        parts.next().and_then(|p| p.parse().ok()).unwrap_or(first)
    } else {
        first
    }
}

async fn probe(java_path: &std::path::Path) -> Option<JavaInstallation> {
    let output = tokio::process::Command::new(java_path)
        .arg("-version")
        .output()
        .await
        .ok()?;
    let text = String::from_utf8_lossy(&output.stderr);
    let version = parse_java_version_output(&text)?;
    Some(JavaInstallation {
        path: java_path.display().to_string(),
        major_version: parse_major(&version),
        version,
    })
}

pub async fn detect_java_installations() -> Vec<JavaInstallation> {
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();

    #[cfg(target_os = "macos")]
    {
        // /usr/libexec/java_home -V 는 stderr에 목록 출력 — 각 홈 경로 추출
        if let Ok(out) = tokio::process::Command::new("/usr/libexec/java_home").arg("-V").output().await {
            let text = String::from_utf8_lossy(&out.stderr);
            for line in text.lines() {
                if let Some(idx) = line.find('/') {
                    let home = line[idx..].trim();
                    candidates.push(std::path::Path::new(home).join("bin/java"));
                }
            }
        }
        for base in ["/Library/Java/JavaVirtualMachines", &format!("{}/Library/Java/JavaVirtualMachines", std::env::var("HOME").unwrap_or_default())] {
            if let Ok(mut rd) = tokio::fs::read_dir(base).await {
                while let Ok(Some(entry)) = rd.next_entry().await {
                    candidates.push(entry.path().join("Contents/Home/bin/java"));
                }
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        for base in [r"C:\Program Files\Java", r"C:\Program Files\Eclipse Adoptium", r"C:\Program Files\Microsoft"] {
            if let Ok(mut rd) = tokio::fs::read_dir(base).await {
                while let Ok(Some(entry)) = rd.next_entry().await {
                    candidates.push(entry.path().join(r"bin\java.exe"));
                }
            }
        }
    }

    // PATH의 java
    if let Ok(path) = which_java().await {
        candidates.push(path);
    }

    let mut found: Vec<JavaInstallation> = Vec::new();
    for c in candidates {
        if !c.exists() {
            continue;
        }
        if found.iter().any(|j| j.path == c.display().to_string()) {
            continue;
        }
        if let Some(j) = probe(&c).await {
            if !found.iter().any(|e| e.path == j.path) {
                found.push(j);
            }
        }
    }
    found.sort_by(|a, b| b.major_version.cmp(&a.major_version));
    found
}

async fn which_java() -> Result<std::path::PathBuf, ()> {
    let cmd = if cfg!(windows) { "where" } else { "which" };
    let out = tokio::process::Command::new(cmd).arg("java").output().await.map_err(|_| ())?;
    let text = String::from_utf8_lossy(&out.stdout);
    let first = text.lines().next().ok_or(())?.trim();
    if first.is_empty() { Err(()) } else { Ok(std::path::PathBuf::from(first)) }
}
```

테스트 하단에 실기 스모크(무시 가능):

```rust
#[tokio::test]
async fn smoke_detect_on_this_machine() {
    // 실기 환경 의존 — 설치 0개여도 실패하지 않고 목록만 출력
    let found = detect_java_installations().await;
    for j in &found {
        println!("java: {} ({} / major {})", j.path, j.version, j.major_version);
    }
}
```

- [ ] **Step 4: GREEN + 실기 스모크 출력 확인** — `cargo test -p hyenimc-launcher java -- --nocapture`
- [ ] **Step 5: 커밋** — `git commit -m "feat(tauri): Java 감지 (macOS java_home/JVM 스캔 + 버전 파서)"`

---

## Self-Review 결과

- **커버리지**: M2a 스코프(다운로드/매니페스트·rules/Java) 전부 태스크화. 설치 파이프라인·natives 추출·JVM 인자 조립·spawn·Tauri 배선은 **의도적으로 M2b 플랜으로 분리** (이 기반 3종이 전부 선행 의존).
- **오프라인 테스트**: Task 1 tiny_http 로컬 서버, Task 2 인라인 fixture, Task 3 순수 파서 + 실기 스모크(환경 의존이지만 실패하지 않는 형태).
- **타입 일관성**: `LauncherError` 변형이 Task 1 구현과 lib.rs 정의 일치, `Rule`을 rules.rs에서 정의하고 manifest.rs가 import — 대조 완료. `DownloadConfig.retry_base_ms`가 테스트(1ms)와 기본값(1000ms) 모두에서 사용됨.
