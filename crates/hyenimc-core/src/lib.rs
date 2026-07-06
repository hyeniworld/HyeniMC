//! HyeniMC 코어 — 저장소/모델. UI·Tauri 비의존.
//!
//! Phase 1 원칙: 기존 Electron+Go 판의 데이터를 마이그레이션 없이 그대로 읽는다
//! (SQLite 스키마·프로필 디렉터리 in-place 호환).

pub mod db;
pub mod paths;
pub mod profile;

pub use db::open_database;
pub use profile::{list_profiles, Profile};

// 하위 크레이트가 Connection 타입 등을 쓸 수 있게 re-export
pub use rusqlite;

#[derive(thiserror::Error, Debug)]
pub enum CoreError {
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("data directory not found: {0}")]
    DataDirNotFound(String),
}
