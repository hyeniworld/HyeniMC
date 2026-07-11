//! 병렬 다운로드 엔진 — TS DownloadManager + Go DownloadService의 의미 포팅.
//! 세마포어 병렬, SHA1 검증(불일치 시 삭제 후 재시도), 지수 백오프, .part 임시 파일.

use std::path::PathBuf;
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
    /// true면 기존 파일 체크섬이 일치해도 스킵하지 않고 항상 새로 받아 덮어쓴다.
    /// 설치 의도가 있는 경로(워커 모드 업데이트)용 — 에셋/라이브러리는 false(스킵=캐시).
    pub force: bool,
}

/// download_one 결과 — 스킵을 조용히 삼키지 않고 호출측(download_all 요약 로그)에 알린다.
enum DownloadOutcome {
    Downloaded,
    Skipped,
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
///
/// sha1/sha256이 모두 없고 size만 있으면 파일 크기만 비교(빠름). Mojang assets objects는
/// 파일명이 콘텐츠 SHA1이라(=immutable) 존재+크기로 충분 — 8525개를 매번 전량 읽어
/// SHA1 재계산하면 tokio 워커를 오래 점유해 다운로드가 0%에서 멈춘 것처럼 보인다.
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
    if task.sha1.is_none() && task.sha256.is_none() {
        if let Some(expected_size) = task.size {
            if std::fs::metadata(path)?.len() != expected_size {
                return Ok(false);
            }
        }
    }
    Ok(true)
}

/// 한 번의 fetch 시도 실패 — 재시도 가치가 있는지(retryable)와 사람이 읽을 사유를 함께 보존.
/// 이 사유가 최종 DownloadFailed로 전파되어 로그·UI에 실제 원인(HTTP 401/404, 본문 등)을 노출한다.
struct FetchErr {
    retryable: bool,
    reason: String,
    /// HTTP 상태 코드 (HTTP 오류일 때만). 401/404 분기용으로 상위까지 보존.
    status: Option<u16>,
}

impl FetchErr {
    /// IO 오류는 대개 결정적(권한/경로) — 재시도 대신 사유를 명확히 노출.
    fn io(e: std::io::Error) -> Self {
        Self { retryable: false, reason: format!("파일 IO 오류: {e}"), status: None }
    }
}

async fn fetch_to_file(
    client: &reqwest::Client,
    task: &DownloadTask,
    timeout: Duration,
) -> Result<(), FetchErr> {
    if let Some(parent) = task.dest.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(FetchErr::io)?;
    }
    let part = task.dest.with_extension("part");
    let resp = client
        .get(&task.url)
        .timeout(timeout)
        .send()
        .await
        .map_err(|e| FetchErr { retryable: true, reason: format!("요청 실패: {e}"), status: None })?;

    // error_for_status()로 상태를 삼키지 않고 직접 검사 — 실제 상태 코드/본문을 사유에 담는다.
    // 4xx(클라이언트 오류: 401 인증/404 없음)는 재시도해도 소용없으므로 즉시 실패시킨다.
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        let snippet: String = body.chars().take(300).collect();
        let reason = if snippet.trim().is_empty() {
            format!("HTTP {status}")
        } else {
            format!("HTTP {status}: {snippet}")
        };
        return Err(FetchErr {
            retryable: status.is_server_error(),
            reason,
            status: Some(status.as_u16()),
        });
    }

    let mut file = tokio::fs::File::create(&part).await.map_err(FetchErr::io)?;
    let mut stream = resp.bytes_stream();
    use futures::StreamExt;
    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| FetchErr { retryable: true, reason: format!("본문 수신 중단: {e}"), status: None })?;
        file.write_all(&bytes).await.map_err(FetchErr::io)?;
    }
    file.flush().await.map_err(FetchErr::io)?;
    drop(file);

    if !checksums_match(&part, task).map_err(FetchErr::io)? {
        let _ = tokio::fs::remove_file(&part).await;
        // 전송 중 손상 가능 — 재시도 가치 있음
        return Err(FetchErr { retryable: true, reason: "체크섬 불일치".into(), status: None });
    }
    // Windows는 목적지가 존재하면 rename이 실패한다 (손상 파일 재다운로드 경로)
    if task.dest.exists() {
        let _ = tokio::fs::remove_file(&task.dest).await;
    }
    tokio::fs::rename(&part, &task.dest).await.map_err(FetchErr::io)?;
    Ok(())
}

async fn download_one(
    client: &reqwest::Client,
    task: &DownloadTask,
    cfg: &DownloadConfig,
) -> Result<DownloadOutcome, LauncherError> {
    // 이미 존재 + 체크섬 일치(또는 기대치 없음) → 스킵, 불일치 → 재다운로드.
    // force 태스크는 스킵하지 않는다(설치 의도 — 항상 원본에서 새로 받아 덮어씀).
    // 존재/체크섬 판정은 동기 파일 IO(대용량 SHA1 포함 가능)이므로 blocking 풀로 넘겨
    // async executor 워커를 막지 않는다(수천 개 에셋 스킵 시 정체 방지).
    if !task.force {
        let (dest, task_for_check) = (task.dest.clone(), task.clone());
        let skip = tokio::task::spawn_blocking(move || {
            dest.exists() && checksums_match(&dest, &task_for_check).unwrap_or(false)
        })
        .await
        .unwrap_or(false);
        if skip {
            log::debug!("다운로드 스킵(기존 파일 체크섬 일치): {}", task.dest.display());
            return Ok(DownloadOutcome::Skipped);
        }
    }
    let mut attempt = 0u32;
    loop {
        match fetch_to_file(client, task, cfg.timeout).await {
            Ok(()) => return Ok(DownloadOutcome::Downloaded),
            Err(e) => {
                if e.retryable && attempt < cfg.max_retries {
                    log::warn!(
                        "다운로드 재시도 {}/{} — {} ({})",
                        attempt + 1,
                        cfg.max_retries,
                        task.url,
                        e.reason
                    );
                    let backoff = cfg
                        .retry_base_ms
                        .saturating_mul(1 << attempt.min(5))
                        .min(30_000);
                    tokio::time::sleep(Duration::from_millis(backoff)).await;
                    attempt += 1;
                } else {
                    // 재시도 불가(4xx 등) 또는 재시도 소진 — 실제 사유를 로그+에러로 전파
                    log::error!("다운로드 실패 — {} ({})", task.url, e.reason);
                    return Err(LauncherError::DownloadFailed {
                        url: task.url.clone(),
                        reason: e.reason,
                        status: e.status,
                    });
                }
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
    use futures::stream::{FuturesUnordered, StreamExt};

    let total = tasks.len();
    let sem = Arc::new(Semaphore::new(cfg.max_parallel.max(1)));

    // FuturesUnordered로 동시 실행하며 완료되는 태스크마다 즉시 진행률 방출(Go와 동일한
    // 증분 진행률). download_one의 스킵 판정(SHA1/크기)은 spawn_blocking으로 분리돼
    // executor 워커를 막지 않는다 — 수천 개 에셋도 정체 없이 흐른다.
    let mut futs = FuturesUnordered::new();
    for task in tasks {
        let sem = sem.clone();
        let client = client.clone();
        let cfg = cfg.clone();
        futs.push(async move {
            let _permit = sem.acquire_owned().await.expect("semaphore closed");
            let result = download_one(&client, &task, &cfg).await;
            (result, task)
        });
    }

    let mut completed = 0usize;
    let mut bytes = 0u64;
    let mut skipped = 0usize;
    let mut first_err = None;
    while let Some((result, task)) = futs.next().await {
        match result {
            Ok(outcome) => {
                completed += 1;
                if matches!(outcome, DownloadOutcome::Skipped) {
                    skipped += 1;
                }
                if let Some(sz) = task.size {
                    bytes += sz;
                }
                on_progress(Progress {
                    completed,
                    total,
                    bytes_done: bytes,
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
    // 스킵을 조용히 삼키지 않는다 — "다운로드 없이 완료"가 로그에 보이게(개별 경로는 debug).
    if skipped > 0 {
        log::info!("다운로드 완료: {total}개 중 {skipped}개는 기존 파일 체크섬 일치로 스킵");
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

    #[test]
    fn checksums_match_by_size_when_no_hash() {
        // assets objects 경로: sha1/sha256 없이 size만으로 검증(빠른 스킵)
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("obj");
        std::fs::write(&f, b"hello").unwrap();
        let ok = DownloadTask { size: Some(5), ..Default::default() };
        assert!(checksums_match(&f, &ok).unwrap());
        let bad = DownloadTask { size: Some(99), ..Default::default() };
        assert!(!checksums_match(&f, &bad).unwrap());
        // 기대치 전혀 없으면 존재만으로 통과
        let none = DownloadTask::default();
        assert!(checksums_match(&f, &none).unwrap());
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
            force: false,
        };
        download_all(&client, vec![task()], &cfg, |_| {}).await.unwrap();
        assert_eq!(std::fs::read(&dest).unwrap(), b"hello-mc");
        let first_hits = hits.load(Ordering::SeqCst);

        // 동일 SHA1 파일 존재 → 재다운로드 없음
        download_all(&client, vec![task()], &cfg, |_| {}).await.unwrap();
        assert_eq!(hits.load(Ordering::SeqCst), first_hits);

        // force=true → 동일 파일이 있어도 항상 새로 받아 덮어쓴다 (워커 모드 설치 의도)
        let forced = DownloadTask { force: true, ..task() };
        download_all(&client, vec![forced], &cfg, |_| {}).await.unwrap();
        assert!(hits.load(Ordering::SeqCst) > first_hits);
        assert_eq!(std::fs::read(&dest).unwrap(), b"hello-mc");
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
            force: false,
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
            force: false,
        };
        download_all(&client, vec![good], &cfg, |_| {}).await.unwrap();

        // 틀린 sha256 → 재시도 후 실패
        let bad = DownloadTask {
            url: format!("{addr}/bad"),
            dest: dir.path().join("bad.jar"),
            sha1: None,
            sha256: Some("0".repeat(64)),
            size: None,
            force: false,
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
            force: false,
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
                force: false,
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
