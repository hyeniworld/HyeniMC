//! 게임 파이프라인 — 다운로드/매니페스트/Java/실행 (M2).

pub mod auth;
pub mod download;
pub mod hyeni;
pub mod hyenipack;
pub mod install;
pub mod java;
pub mod launch;
pub mod loader;
pub mod manifest;
pub mod modmeta;
pub mod natives;
pub mod rules;
pub mod workermods;

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
    #[error("다운로드 실패 ({reason}): {url}")]
    DownloadFailed {
        url: String,
        reason: String,
        /// HTTP 상태 코드 (있으면). 호출자가 401/404 등을 구분해 사용자 메시지를 분기하는 데 쓴다.
        status: Option<u16>,
    },
    #[error("{0}")]
    Other(String),
}
