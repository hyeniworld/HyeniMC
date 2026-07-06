//! 프로필 모델 + 조회 — 기존 Go 스키마(profiles 테이블) 그대로 읽기.

use rusqlite::Connection;
use serde::Serialize;

use crate::CoreError;

/// 렌더러가 쓰는 camelCase 필드명으로 직렬화 (기존 IPC 응답 형태 호환).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub icon: Option<String>,
    pub game_version: String,
    pub loader_type: String,
    pub loader_version: Option<String>,
    pub game_directory: String,
    pub favorite: bool,
    pub server_address: Option<String>,
    pub installation_status: Option<String>,
    pub last_played: Option<i64>,
    pub total_play_time: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

pub fn list_profiles(conn: &Connection) -> Result<Vec<Profile>, CoreError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, description, icon, game_version, loader_type, loader_version,
                game_directory, favorite, server_address, installation_status,
                last_played, total_play_time, created_at, updated_at
         FROM profiles
         ORDER BY favorite DESC, updated_at DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Profile {
            id: row.get(0)?,
            name: row.get(1)?,
            description: row.get(2)?,
            icon: row.get(3)?,
            game_version: row.get(4)?,
            loader_type: row.get(5)?,
            loader_version: row.get(6)?,
            game_directory: row.get(7)?,
            favorite: row.get::<_, Option<i64>>(8)?.unwrap_or(0) != 0,
            server_address: row.get(9)?,
            installation_status: row.get(10)?,
            last_played: row.get(11)?,
            total_play_time: row.get::<_, Option<i64>>(12)?.unwrap_or(0),
            created_at: row.get(13)?,
            updated_at: row.get(14)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_database;

    /// 기존 Go migrations.go의 profiles DDL 그대로 (in-place 호환 검증용 fixture).
    const PROFILES_DDL: &str = r#"
        CREATE TABLE schema_version (
            version INTEGER PRIMARY KEY,
            applied_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE profiles (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            icon TEXT,
            game_version TEXT NOT NULL,
            loader_type TEXT NOT NULL,
            loader_version TEXT,
            game_directory TEXT NOT NULL,
            java_path TEXT,
            memory_min INTEGER,
            memory_max INTEGER,
            resolution_width INTEGER,
            resolution_height INTEGER,
            fullscreen INTEGER,
            jvm_args TEXT,
            game_args TEXT,
            modpack_id TEXT,
            modpack_source TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            last_played INTEGER,
            total_play_time INTEGER DEFAULT 0,
            favorite INTEGER DEFAULT 0,
            server_address TEXT,
            installation_status TEXT DEFAULT 'complete'
        );
    "#;

    fn fixture_db() -> (tempfile::TempDir, std::path::PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("hyenimc.db");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(PROFILES_DDL).unwrap();
        conn.execute("INSERT INTO schema_version (version) VALUES (13)", [])
            .unwrap();
        conn.execute(
            "INSERT INTO profiles (id, name, game_version, loader_type, loader_version,
                                   game_directory, created_at, updated_at, favorite)
             VALUES ('p1', '혜니월드 생존', '1.21.1', 'fabric', '0.16.7', '/tmp/p1', 100, 200, 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO profiles (id, name, game_version, loader_type, game_directory,
                                   created_at, updated_at)
             VALUES ('p2', 'vanilla', '26.1.2', 'vanilla', '/tmp/p2', 100, 300)",
            [],
        )
        .unwrap();
        (dir, path)
    }

    #[test]
    fn reads_profiles_from_legacy_schema() {
        // Arrange
        let (_dir, path) = fixture_db();
        let conn = open_database(&path).unwrap();

        // Act
        let profiles = list_profiles(&conn).unwrap();

        // Assert — favorite 우선 정렬, 필드 매핑, NULL 허용 필드
        assert_eq!(profiles.len(), 2);
        assert_eq!(profiles[0].id, "p1");
        assert_eq!(profiles[0].name, "혜니월드 생존");
        assert!(profiles[0].favorite);
        assert_eq!(profiles[0].loader_version.as_deref(), Some("0.16.7"));
        assert_eq!(profiles[1].id, "p2");
        assert!(!profiles[1].favorite);
        assert_eq!(profiles[1].loader_version, None);
        assert_eq!(profiles[1].total_play_time, 0);
    }

    #[test]
    fn schema_version_is_read() {
        let (_dir, path) = fixture_db();
        let conn = open_database(&path).unwrap();
        assert_eq!(crate::db::schema_version(&conn).unwrap(), 13);
    }

    #[test]
    fn missing_db_is_an_explicit_error() {
        let err = open_database(std::path::Path::new("/nonexistent/hyenimc.db")).unwrap_err();
        assert!(matches!(err, CoreError::DataDirNotFound(_)));
    }

    #[test]
    fn profile_serializes_to_camel_case() {
        let (_dir, path) = fixture_db();
        let conn = open_database(&path).unwrap();
        let profiles = list_profiles(&conn).unwrap();
        let json = serde_json::to_string(&profiles[0]).unwrap();
        assert!(json.contains("\"gameVersion\":\"1.21.1\""));
        assert!(json.contains("\"loaderType\":\"fabric\""));
        assert!(json.contains("\"totalPlayTime\""));
    }
}
