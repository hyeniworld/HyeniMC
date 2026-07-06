//! SQLite 연결 — 기존 Go(modernc.org/sqlite) 판이 만든 DB를 그대로 연다 (WAL 모드).

use rusqlite::Connection;
use std::path::Path;

use crate::CoreError;

/// 기존 DB를 연다. 파일이 없으면 에러 (silent 초기화 금지 — 설계 문서 §7).
pub fn open_database(db_path: &Path) -> Result<Connection, CoreError> {
    if !db_path.exists() {
        return Err(CoreError::DataDirNotFound(db_path.display().to_string()));
    }
    let conn = Connection::open(db_path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    Ok(conn)
}

/// 스키마 버전 조회 (기존 Go migrations의 schema_version 테이블).
pub fn schema_version(conn: &Connection) -> Result<i64, CoreError> {
    let v = conn.query_row(
        "SELECT MAX(version) FROM schema_version",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    Ok(v)
}
