//! 프로필별 모드 목록 캐시 — 기존 `profile_mods` 테이블 그대로 사용(Electron in-place 호환).
//!
//! Electron(Go) 규칙:
//! - `file_name`: 디스크 이름(활성 `X.jar`, 비활성 `X.jar.disabled`)
//! - `enabled`: 1/0 (= !`.disabled`)
//! - `authors`: JSON 배열 문자열 `["A","B"]`
//! - `last_modified`: 파일 mtime(초)
//!
//! mod_list는 디스크 파일 개수+mtime만 비교(빠름)해 변경 없으면 이 캐시를 반환하고,
//! 변경분만 재파싱해 여기에 반영한다.

use rusqlite::{params, Connection};

use crate::CoreError;

#[derive(Debug, Clone)]
pub struct CachedMod {
    /// 디스크 이름(.disabled 포함)
    pub file_name: String,
    pub file_size: i64,
    pub mod_id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub authors: Vec<String>,
    pub enabled: bool,
    pub source: String,
    pub last_modified: i64,
    pub source_mod_id: Option<String>,
    pub source_file_id: Option<String>,
}

/// 프로필의 캐시된 모드 목록.
pub fn list_cached_mods(conn: &Connection, profile_id: &str) -> Result<Vec<CachedMod>, CoreError> {
    let mut stmt = conn.prepare(
        "SELECT file_name, file_size, mod_id, name, version, description, authors, enabled, \
                source, last_modified, source_mod_id, source_file_id \
         FROM profile_mods WHERE profile_id = ?1",
    )?;
    let rows = stmt.query_map([profile_id], |row| {
        let authors_json: Option<String> = row.get(6)?;
        let authors = authors_json
            .and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
            .unwrap_or_default();
        Ok(CachedMod {
            file_name: row.get(0)?,
            file_size: row.get::<_, Option<i64>>(1)?.unwrap_or(0),
            mod_id: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
            name: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
            version: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
            description: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
            authors,
            enabled: row.get::<_, i64>(7)? != 0,
            source: row.get::<_, Option<String>>(8)?.unwrap_or_else(|| "local".into()),
            last_modified: row.get::<_, Option<i64>>(9)?.unwrap_or(0),
            source_mod_id: row.get(10)?,
            source_file_id: row.get(11)?,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// 변경/신규 모드를 캐시에 반영(UPSERT). `file_path`는 mods_dir + file_name.
pub fn upsert_mods(
    conn: &Connection,
    profile_id: &str,
    mods_dir: &str,
    mods: &[CachedMod],
    now_secs: i64,
) -> Result<(), CoreError> {
    let tx = conn.unchecked_transaction()?;
    for m in mods {
        let authors = serde_json::to_string(&m.authors).unwrap_or_else(|_| "[]".into());
        let file_path = format!("{mods_dir}/{}", m.file_name);
        // id는 신규 삽입 시에만 쓰임 — 충돌(profile_id,file_name) 시 기존 행 UPDATE.
        let id = uuid::Uuid::new_v4().to_string();
        tx.execute(
            "INSERT INTO profile_mods \
               (id, profile_id, file_name, file_path, file_size, mod_id, name, version, \
                description, authors, enabled, source, last_modified, created_at, updated_at, \
                source_mod_id, source_file_id) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?14,?15,?16) \
             ON CONFLICT(profile_id, file_name) DO UPDATE SET \
                file_path=excluded.file_path, file_size=excluded.file_size, \
                mod_id=excluded.mod_id, name=excluded.name, version=excluded.version, \
                description=excluded.description, authors=excluded.authors, \
                enabled=excluded.enabled, source=excluded.source, \
                last_modified=excluded.last_modified, updated_at=excluded.updated_at, \
                source_mod_id=excluded.source_mod_id, source_file_id=excluded.source_file_id",
            params![
                id,
                profile_id,
                m.file_name,
                file_path,
                m.file_size,
                m.mod_id,
                m.name,
                m.version,
                m.description,
                authors,
                m.enabled as i64,
                m.source,
                m.last_modified,
                now_secs,
                m.source_mod_id,
                m.source_file_id,
            ],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// 디스크에서 사라진 캐시 항목 제거.
pub fn delete_missing(
    conn: &Connection,
    profile_id: &str,
    existing_file_names: &[String],
) -> Result<(), CoreError> {
    let cached = list_cached_mods(conn, profile_id)?;
    for m in cached {
        if !existing_file_names.iter().any(|n| n == &m.file_name) {
            conn.execute(
                "DELETE FROM profile_mods WHERE profile_id = ?1 AND file_name = ?2",
                params![profile_id, m.file_name],
            )?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCHEMA: &str = "CREATE TABLE profile_mods (\
        id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, file_name TEXT NOT NULL, \
        file_path TEXT NOT NULL, file_hash TEXT, file_size INTEGER, mod_id TEXT, \
        name TEXT, version TEXT, description TEXT, authors TEXT, enabled INTEGER DEFAULT 1, \
        source TEXT, last_modified INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, \
        source_mod_id TEXT, source_file_id TEXT); \
        CREATE UNIQUE INDEX idx_profile_mods_unique ON profile_mods(profile_id, file_name);";

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        conn
    }

    fn sample(file_name: &str, mtime: i64) -> CachedMod {
        CachedMod {
            file_name: file_name.into(),
            file_size: 123,
            mod_id: "aquaculture".into(),
            name: "Aquaculture".into(),
            version: "1.0".into(),
            description: "desc".into(),
            authors: vec!["A".into(), "B".into()],
            enabled: !file_name.ends_with(".disabled"),
            source: "local".into(),
            last_modified: mtime,
            source_mod_id: Some("srcmod".into()),
            source_file_id: None,
        }
    }

    #[test]
    fn upsert_list_roundtrip_and_authors_json() {
        let conn = setup();
        upsert_mods(&conn, "p1", "/mods", &[sample("A.jar", 100)], 1).unwrap();
        let got = list_cached_mods(&conn, "p1").unwrap();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].file_name, "A.jar");
        assert_eq!(got[0].authors, vec!["A", "B"]); // JSON 왕복
        assert!(got[0].enabled);
        assert_eq!(got[0].source_mod_id.as_deref(), Some("srcmod"));
    }

    #[test]
    fn upsert_conflict_updates_not_duplicates() {
        let conn = setup();
        upsert_mods(&conn, "p1", "/mods", &[sample("A.jar", 100)], 1).unwrap();
        // 같은 (profile,file_name), mtime/version 변경
        let mut changed = sample("A.jar", 200);
        changed.version = "2.0".into();
        upsert_mods(&conn, "p1", "/mods", &[changed], 2).unwrap();
        let got = list_cached_mods(&conn, "p1").unwrap();
        assert_eq!(got.len(), 1); // 중복 행 없음
        assert_eq!(got[0].last_modified, 200);
        assert_eq!(got[0].version, "2.0");
    }

    #[test]
    fn delete_missing_removes_absent_files() {
        let conn = setup();
        upsert_mods(&conn, "p1", "/mods", &[sample("A.jar", 1), sample("B.jar", 1)], 1).unwrap();
        // 디스크에 A.jar만 남음 → B.jar 제거
        delete_missing(&conn, "p1", &["A.jar".to_string()]).unwrap();
        let got = list_cached_mods(&conn, "p1").unwrap();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].file_name, "A.jar");
    }

    #[test]
    fn disabled_flag_from_file_name() {
        let conn = setup();
        upsert_mods(&conn, "p1", "/mods", &[sample("X.jar.disabled", 1)], 1).unwrap();
        let got = list_cached_mods(&conn, "p1").unwrap();
        assert!(!got[0].enabled);
    }
}
