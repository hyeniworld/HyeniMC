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
    pub java_path: Option<String>,
    pub memory_min: Option<i64>,
    pub memory_max: Option<i64>,
    pub resolution_width: Option<i64>,
    pub resolution_height: Option<i64>,
    pub fullscreen: Option<bool>,
    /// Go 판이 JSON 배열을 BLOB/TEXT로 저장 — 항상 파싱된 배열로 노출 (렌더러 호환)
    pub jvm_args: Vec<String>,
    pub game_args: Vec<String>,
    pub modpack_id: Option<String>,
    pub modpack_source: Option<String>,
}

/// jvm_args/game_args 컬럼 — NULL/TEXT/BLOB 모두 허용, JSON 배열로 파싱 (실DB는 BLOB).
fn json_string_array(row: &rusqlite::Row<'_>, idx: usize) -> rusqlite::Result<Vec<String>> {
    use rusqlite::types::ValueRef;
    let bytes: Option<Vec<u8>> = match row.get_ref(idx)? {
        ValueRef::Null => None,
        ValueRef::Text(t) => Some(t.to_vec()),
        ValueRef::Blob(b) => Some(b.to_vec()),
        _ => None,
    };
    Ok(bytes
        .and_then(|b| serde_json::from_slice::<Vec<String>>(&b).ok())
        .unwrap_or_default())
}

const PROFILE_COLUMNS: &str = "id, name, description, icon, game_version, loader_type, loader_version,
    game_directory, favorite, server_address, installation_status,
    last_played, total_play_time, created_at, updated_at,
    java_path, memory_min, memory_max, resolution_width, resolution_height, fullscreen,
    jvm_args, game_args, modpack_id, modpack_source";

fn row_to_profile(row: &rusqlite::Row<'_>) -> rusqlite::Result<Profile> {
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
        java_path: row.get(15)?,
        memory_min: row.get(16)?,
        memory_max: row.get(17)?,
        resolution_width: row.get(18)?,
        resolution_height: row.get(19)?,
        fullscreen: row.get::<_, Option<i64>>(20)?.map(|v| v != 0),
        jvm_args: json_string_array(row, 21)?,
        game_args: json_string_array(row, 22)?,
        modpack_id: row.get(23)?,
        modpack_source: row.get(24)?,
    })
}

pub fn list_profiles(conn: &Connection) -> Result<Vec<Profile>, CoreError> {
    // 정렬: 즐겨찾기 → 최근 플레이 → 생성일 (프론트 sortProfiles와 동일 의도).
    // last_played는 NULL이 뒤로(SQLite DESC에서 NULL이 최소값 → 마지막).
    let sql = format!(
        "SELECT {PROFILE_COLUMNS} FROM profiles \
         ORDER BY favorite DESC, last_played DESC, created_at DESC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], row_to_profile)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn get_profile(conn: &Connection, id: &str) -> Result<Option<Profile>, CoreError> {
    let sql = format!("SELECT {PROFILE_COLUMNS} FROM profiles WHERE id = ?1");
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query_map([id], row_to_profile)?;
    Ok(rows.next().transpose()?)
}

/// 새 프로필 입력 (렌더러 CreateProfileModal의 formData 형태와 호환 — camelCase)
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewProfile {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    pub game_version: String,
    pub loader_type: String,
    #[serde(default)]
    pub loader_version: Option<String>,
}

/// 부분 갱신 패치. 바깥 Option = "이 필드를 갱신할지", 안쪽 Option = "NULL(전역 상속)로 되돌릴지".
#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfilePatch {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub game_version: Option<String>,
    #[serde(default)]
    pub loader_type: Option<String>,
    #[serde(default)]
    pub loader_version: Option<String>,
    #[serde(default)]
    pub server_address: Option<String>,
    #[serde(default, with = "double_option")]
    pub java_path: Option<Option<String>>,
    #[serde(default, with = "double_option")]
    pub memory_min: Option<Option<i64>>,
    #[serde(default, with = "double_option")]
    pub memory_max: Option<Option<i64>>,
    #[serde(default, with = "double_option")]
    pub resolution_width: Option<Option<i64>>,
    #[serde(default, with = "double_option")]
    pub resolution_height: Option<Option<i64>>,
    #[serde(default, with = "double_option")]
    pub fullscreen: Option<Option<bool>>,
    #[serde(default)]
    pub jvm_args: Option<Vec<String>>,
    #[serde(default)]
    pub game_args: Option<Vec<String>>,
}

/// JSON에서 필드 부재 = None(미갱신), null = Some(None)(NULL로 초기화), 값 = Some(Some(v)).
mod double_option {
    use serde::{Deserialize, Deserializer};

    pub fn deserialize<'de, T, D>(de: D) -> Result<Option<Option<T>>, D::Error>
    where
        T: Deserialize<'de>,
        D: Deserializer<'de>,
    {
        Option::<T>::deserialize(de).map(Some)
    }
}

pub fn create_profile(
    conn: &Connection,
    new: &NewProfile,
    game_directory: &str,
    now_secs: i64,
) -> Result<Profile, CoreError> {
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        // description/icon/loader_version/modpack_*는 NULL 대신 '' 로 저장한다.
        // Electron(Go) 리더가 이 컬럼들을 non-null string으로 스캔해, NULL이면 해당 행 스캔이
        // 실패하고 프로필이 목록에서 통째로 빠지기 때문(공유 DB 호환).
        "INSERT INTO profiles (id, name, description, icon, game_version, loader_type, loader_version,
                               game_directory, created_at, updated_at, favorite, installation_status,
                               modpack_id, modpack_source)
         VALUES (?1,?2,COALESCE(?3,''),COALESCE(?4,''),?5,?6,COALESCE(?7,''),?8,?9,?9,0,'complete','','')",
        rusqlite::params![
            id, new.name, new.description, new.icon, new.game_version,
            new.loader_type, new.loader_version, game_directory, now_secs
        ],
    )?;
    Ok(get_profile(conn, &id)?.expect("just inserted"))
}

pub fn update_profile(
    conn: &Connection,
    id: &str,
    patch: &ProfilePatch,
    now_secs: i64,
) -> Result<Option<Profile>, CoreError> {
    let mut sets: Vec<String> = Vec::new();
    let mut values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    macro_rules! set_plain {
        ($field:expr, $col:literal) => {
            if let Some(v) = &$field {
                sets.push(format!("{} = ?{}", $col, values.len() + 1));
                values.push(Box::new(v.clone()));
            }
        };
    }
    macro_rules! set_nullable {
        ($field:expr, $col:literal) => {
            if let Some(inner) = &$field {
                sets.push(format!("{} = ?{}", $col, values.len() + 1));
                values.push(Box::new(inner.clone()));
            }
        };
    }

    set_plain!(patch.name, "name");
    set_plain!(patch.description, "description");
    set_plain!(patch.icon, "icon");
    set_plain!(patch.game_version, "game_version");
    set_plain!(patch.loader_type, "loader_type");
    set_plain!(patch.loader_version, "loader_version");
    set_plain!(patch.server_address, "server_address");
    set_nullable!(patch.java_path, "java_path");
    set_nullable!(patch.memory_min, "memory_min");
    set_nullable!(patch.memory_max, "memory_max");
    set_nullable!(patch.resolution_width, "resolution_width");
    set_nullable!(patch.resolution_height, "resolution_height");
    if let Some(inner) = &patch.fullscreen {
        sets.push(format!("fullscreen = ?{}", values.len() + 1));
        values.push(Box::new(inner.map(|b| b as i64)));
    }
    if let Some(args) = &patch.jvm_args {
        sets.push(format!("jvm_args = ?{}", values.len() + 1));
        values.push(Box::new(serde_json::to_string(args).unwrap_or_else(|_| "[]".into())));
    }
    if let Some(args) = &patch.game_args {
        sets.push(format!("game_args = ?{}", values.len() + 1));
        values.push(Box::new(serde_json::to_string(args).unwrap_or_else(|_| "[]".into())));
    }

    if !sets.is_empty() {
        sets.push(format!("updated_at = ?{}", values.len() + 1));
        values.push(Box::new(now_secs));
        let sql = format!(
            "UPDATE profiles SET {} WHERE id = ?{}",
            sets.join(", "),
            values.len() + 1
        );
        values.push(Box::new(id.to_string()));
        conn.execute(&sql, rusqlite::params_from_iter(values.iter().map(|b| b.as_ref())))?;
    }
    get_profile(conn, id)
}

pub fn delete_profile(conn: &Connection, id: &str) -> Result<bool, CoreError> {
    let n = conn.execute("DELETE FROM profiles WHERE id = ?1", [id])?;
    Ok(n > 0)
}

pub fn toggle_favorite(
    conn: &Connection,
    id: &str,
    now_secs: i64,
) -> Result<Option<Profile>, CoreError> {
    conn.execute(
        "UPDATE profiles SET favorite = CASE WHEN COALESCE(favorite,0)=0 THEN 1 ELSE 0 END,
                             updated_at = ?2
         WHERE id = ?1",
        rusqlite::params![id, now_secs],
    )?;
    get_profile(conn, id)
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
    fn create_get_update_delete_roundtrip() {
        let (_dir, path) = fixture_db();
        let conn = open_database(&path).unwrap();

        let new = NewProfile {
            name: "새 프로필".into(),
            description: Some("desc".into()),
            icon: None,
            game_version: "1.21.1".into(),
            loader_type: "fabric".into(),
            loader_version: Some("0.16.7".into()),
        };
        let created = create_profile(&conn, &new, "/tmp/inst/x", 1000).unwrap();
        assert_eq!(created.name, "새 프로필");
        assert_eq!(created.game_directory, "/tmp/inst/x");
        assert_eq!(created.created_at, 1000);
        assert_eq!(created.id.len(), 36); // uuid v4

        let got = get_profile(&conn, &created.id).unwrap().unwrap();
        assert_eq!(got.game_version, "1.21.1");

        let patch = ProfilePatch {
            name: Some("이름변경".into()),
            memory_max: Some(Some(8192)),
            ..Default::default()
        };
        let updated = update_profile(&conn, &created.id, &patch, 2000).unwrap().unwrap();
        assert_eq!(updated.name, "이름변경");
        assert_eq!(updated.memory_max, Some(8192));
        assert_eq!(updated.updated_at, 2000);
        assert_eq!(updated.game_version, "1.21.1"); // 미지정 필드 보존

        let fav = toggle_favorite(&conn, &created.id, 3000).unwrap().unwrap();
        assert!(fav.favorite);

        assert!(delete_profile(&conn, &created.id).unwrap());
        assert!(get_profile(&conn, &created.id).unwrap().is_none());
        assert!(!delete_profile(&conn, "no-such-id").unwrap());
    }

    #[test]
    fn jvm_args_blob_json_is_parsed() {
        // 실DB 실측: Go가 []string을 JSON 직렬화해 BLOB으로 저장 (예: 0x5B5D = "[]")
        let (_dir, path) = fixture_db();
        let conn = open_database(&path).unwrap();
        conn.execute(
            "INSERT INTO profiles (id, name, game_version, loader_type, game_directory,
                                   created_at, updated_at, jvm_args)
             VALUES ('pb', 'blob', '1.21.1', 'fabric', '/tmp/pb', 1, 1, ?1)",
            [&b"[\"-Xmx2G\",\"-XX:+UseG1GC\"]"[..]],
        )
        .unwrap();
        let p = get_profile(&conn, "pb").unwrap().unwrap();
        assert_eq!(p.jvm_args, vec!["-Xmx2G".to_string(), "-XX:+UseG1GC".to_string()]);
        assert!(p.game_args.is_empty()); // NULL → 빈 배열

        // patch로 배열 갱신 → JSON 텍스트로 저장돼도 재파싱 일치
        let patch = ProfilePatch { jvm_args: Some(vec!["-Xms1G".into()]), ..Default::default() };
        let updated = update_profile(&conn, "pb", &patch, 2).unwrap().unwrap();
        assert_eq!(updated.jvm_args, vec!["-Xms1G".to_string()]);
    }

    #[test]
    fn patch_can_reset_override_to_null() {
        let (_dir, path) = fixture_db();
        let conn = open_database(&path).unwrap();
        let new = NewProfile {
            name: "p".into(),
            description: None,
            icon: None,
            game_version: "1.21.1".into(),
            loader_type: "vanilla".into(),
            loader_version: None,
        };
        let created = create_profile(&conn, &new, "/tmp/i", 1).unwrap();
        // 오버라이드 설정 후 NULL로 되돌리기 (Some(None) = 전역 상속으로 복귀)
        let set = ProfilePatch { memory_max: Some(Some(8192)), ..Default::default() };
        update_profile(&conn, &created.id, &set, 2).unwrap();
        let reset = ProfilePatch { memory_max: Some(None), ..Default::default() };
        let after = update_profile(&conn, &created.id, &reset, 3).unwrap().unwrap();
        assert_eq!(after.memory_max, None);
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
