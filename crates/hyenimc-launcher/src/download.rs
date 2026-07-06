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

#[derive(Debug, Clone, Default)]
pub struct DownloadTask {
    pub url: String,
    pub dest: PathBuf,
    pub sha1: Option<String>,
    pub sha256: Option<String>,
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
        Self {
            max_parallel: 10,
            max_retries: 5,
            timeout: Duration::from_secs(60),
            retry_base_ms: 1000,
        }
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

fn sha256_file(path: &std::path::Path) -> std::io::Result<String> {
    use sha2::Digest as _;
    let data = std::fs::read(path)?;
    Ok(hex::encode(sha2::Sha256::digest(&data)))
}

/// 기대 체크섬(sha1/sha256 중 존재하는 것)과 파일 대조. 기대치가 없으면 Ok(true).
fn checksums_match(path: &std::path::Path, task: &DownloadTask) -> std::io::Result<bool> {
    if let Some(expected) = &task.sha1 {
        if !sha1_file(path)?.eq_ignore_ascii_case(expected) {
            return Ok(false);
        }
    }
    if let Some(expected) = &task.sha256 {
        if !sha256_file(path)?.eq_ignore_ascii_case(expected) {
            return Ok(false);
        }
    }
    Ok(true)
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
    let resp = client
        .get(&task.url)
        .timeout(timeout)
        .send()
        .await?
        .error_for_status()?;
    let mut file = tokio::fs::File::create(&part).await?;
    let mut stream = resp.bytes_stream();
    use futures::StreamExt;
    while let Some(chunk) = stream.next().await {
        file.write_all(&chunk?).await?;
    }
    file.flush().await?;
    drop(file);

    if !checksums_match(&part, task)? {
        let _ = tokio::fs::remove_file(&part).await;
        return Err(LauncherError::ChecksumMismatch {
            path: task.dest.display().to_string(),
            expected: task
                .sha1
                .clone()
                .or_else(|| task.sha256.clone())
                .unwrap_or_default(),
            actual: "mismatch".into(),
        });
    }
    // Windows는 목적지가 존재하면 rename이 실패한다 (손상 파일 재다운로드 경로)
    if task.dest.exists() {
        let _ = tokio::fs::remove_file(&task.dest).await;
    }
    tokio::fs::rename(&part, &task.dest).await?;
    Ok(())
}

async fn download_one(
    client: &reqwest::Client,
    task: &DownloadTask,
    cfg: &DownloadConfig,
) -> Result<(), LauncherError> {
    // 이미 존재 + 체크섬 일치(또는 기대치 없음) → 스킵, 불일치 → 재다운로드
    if task.dest.exists() && checksums_match(&task.dest, task).unwrap_or(false) {
        return Ok(());
    }
    let mut attempt = 0u32;
    loop {
        match fetch_to_file(client, task, cfg.timeout).await {
            Ok(()) => return Ok(()),
            Err(_e) if attempt < cfg.max_retries => {
                let backoff = cfg
                    .retry_base_ms
                    .saturating_mul(1 << attempt.min(5))
                    .min(30_000);
                tokio::time::sleep(Duration::from_millis(backoff)).await;
                attempt += 1;
            }
            Err(_) => {
                return Err(LauncherError::DownloadFailed {
                    url: task.url.clone(),
                    retries: cfg.max_retries,
                });
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
            download_one(&client, &task, &cfg).await.map(|_| task)
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
                    current_file: task
                        .dest
                        .file_name()
                        .map(|f| f.to_string_lossy().into_owned())
                        .unwrap_or_default(),
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    /// body를 모든 경로로 서빙하는 로컬 서버. /fail_once/*는 첫 요청에 500.
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
        let cfg = DownloadConfig { timeout: std::time::Duration::from_secs(5), retry_base_ms: 1, ..Default::default() };

        let task = || DownloadTask {
            url: format!("{addr}/file.jar"),
            dest: dest.clone(),
            sha1: Some(sha.clone()),
            sha256: None,
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
            sha256: None,
            size: None,
        };
        download_all(&client, vec![task], &cfg, |_| {}).await.unwrap();
        assert_eq!(std::fs::read(&dest).unwrap(), b"retry-ok");
    }

    #[tokio::test]
    async fn sha256_is_verified_when_present() {
        use sha2::Digest as _;
        let (addr, _) = spawn_server(b"body-256");
        let dir = tempfile::tempdir().unwrap();
        let client = reqwest::Client::new();
        let cfg = DownloadConfig { max_retries: 1, retry_base_ms: 1, timeout: std::time::Duration::from_secs(5), ..Default::default() };

        // 올바른 sha256 → 성공
        let good = DownloadTask {
            url: format!("{addr}/ok"),
            dest: dir.path().join("ok.jar"),
            sha1: None,
            sha256: Some(hex::encode(sha2::Sha256::digest(b"body-256"))),
            size: None,
        };
        download_all(&client, vec![good], &cfg, |_| {}).await.unwrap();

        // 틀린 sha256 → 재시도 후 실패
        let bad = DownloadTask {
            url: format!("{addr}/bad"),
            dest: dir.path().join("bad.jar"),
            sha1: None,
            sha256: Some("0".repeat(64)),
            size: None,
        };
        let err = download_all(&client, vec![bad], &cfg, |_| {}).await.unwrap_err();
        assert!(matches!(err, LauncherError::DownloadFailed { .. }));
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
            sha256: None,
            size: None,
        };
        let err = download_all(&client, vec![task], &cfg, |_| {}).await.unwrap_err();
        assert!(matches!(err, LauncherError::DownloadFailed { .. }));
    }

    #[tokio::test]
    async fn progress_reports_completion() {
        let (addr, _) = spawn_server(b"p");
        let dir = tempfile::tempdir().unwrap();
        let done = Arc::new(AtomicUsize::new(0));
        let done2 = done.clone();
        let tasks = (0..5)
            .map(|i| DownloadTask {
                url: format!("{addr}/f{i}"),
                dest: dir.path().join(format!("f{i}")),
                sha1: None,
                sha256: None,
                size: None,
            })
            .collect();
        download_all(&reqwest::Client::new(), tasks, &DownloadConfig { timeout: std::time::Duration::from_secs(5), retry_base_ms: 1, ..Default::default() }, move |p| {
            done2.store(p.completed, Ordering::SeqCst);
        })
        .await
        .unwrap();
        assert_eq!(done.load(Ordering::SeqCst), 5);
    }
}
