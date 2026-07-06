//! 게임 파이프라인 — 다운로드/매니페스트/Java/실행 (M2).

pub mod download;
pub mod install;
pub mod java;
pub mod launch;
pub mod manifest;
pub mod natives;
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
    ChecksumMismatch {
        path: String,
        expected: String,
        actual: String,
    },
    #[error("download failed after {retries} retries: {url}")]
    DownloadFailed { url: String, retries: u32 },
    #[error("{0}")]
    Other(String),
}
