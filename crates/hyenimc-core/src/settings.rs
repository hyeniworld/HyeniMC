//! 전역 설정 — 기존 global_settings KV(dotted key) 테이블 그대로 사용.
//! 프론트 형태는 기존 IPC(snake_case 중첩)와 동일, 기본값도 ipc/settings.ts와 동일.
//!
//! DB 키 매핑 예외 2개(실DB 실측): request_timeout_ms ↔ download.timeout_ms,
//! java_path ↔ java.path. 나머지는 `<섹션>.<필드>` 패턴. update.* 키는 DB에 없어
//! 기본값으로 시작하고 첫 update_settings 때 기록된다.

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::CoreError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlobalSettings {
    pub download: DownloadSettings,
    pub java: JavaSettings,
    pub resolution: ResolutionSettings,
    pub cache: CacheSettings,
    pub update: UpdateSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadSettings {
    pub request_timeout_ms: i64,
    pub max_retries: i64,
    pub max_parallel: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JavaSettings {
    pub java_path: String,
    pub memory_min: i64,
    pub memory_max: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolutionSettings {
    pub width: i64,
    pub height: i64,
    pub fullscreen: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheSettings {
    pub enabled: bool,
    pub max_size_gb: i64,
    pub ttl_days: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateSettings {
    pub check_interval_hours: i64,
    pub auto_download: bool,
}

fn read_kv(conn: &Connection) -> Result<HashMap<String, String>, CoreError> {
    let mut stmt = conn.prepare("SELECT key, value FROM global_settings")?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
    Ok(rows.collect::<Result<HashMap<_, _>, _>>()?)
}

fn get_i64(kv: &HashMap<String, String>, key: &str, default: i64) -> i64 {
    kv.get(key).and_then(|v| v.parse().ok()).unwrap_or(default)
}

fn get_bool(kv: &HashMap<String, String>, key: &str, default: bool) -> bool {
    kv.get(key).map(|v| v == "true" || v == "1").unwrap_or(default)
}

pub fn get_settings(conn: &Connection) -> Result<GlobalSettings, CoreError> {
    let kv = read_kv(conn)?;
    Ok(GlobalSettings {
        download: DownloadSettings {
            request_timeout_ms: get_i64(&kv, "download.timeout_ms", 3000),
            max_retries: get_i64(&kv, "download.max_retries", 5),
            max_parallel: get_i64(&kv, "download.max_parallel", 10),
        },
        java: JavaSettings {
            java_path: kv.get("java.path").cloned().unwrap_or_default(),
            memory_min: get_i64(&kv, "java.memory_min", 1024),
            memory_max: get_i64(&kv, "java.memory_max", 4096),
        },
        resolution: ResolutionSettings {
            width: get_i64(&kv, "resolution.width", 854),
            height: get_i64(&kv, "resolution.height", 480),
            fullscreen: get_bool(&kv, "resolution.fullscreen", false),
        },
        cache: CacheSettings {
            enabled: get_bool(&kv, "cache.enabled", true),
            max_size_gb: get_i64(&kv, "cache.max_size_gb", 10),
            ttl_days: get_i64(&kv, "cache.ttl_days", 30),
        },
        update: UpdateSettings {
            check_interval_hours: get_i64(&kv, "update.check_interval_hours", 2),
            auto_download: get_bool(&kv, "update.auto_download", false),
        },
    })
}

pub fn update_settings(
    conn: &Connection,
    s: &GlobalSettings,
    now_secs: i64,
) -> Result<(), CoreError> {
    let pairs: Vec<(&str, String)> = vec![
        ("download.timeout_ms", s.download.request_timeout_ms.to_string()),
        ("download.max_retries", s.download.max_retries.to_string()),
        ("download.max_parallel", s.download.max_parallel.to_string()),
        ("java.path", s.java.java_path.clone()),
        ("java.memory_min", s.java.memory_min.to_string()),
        ("java.memory_max", s.java.memory_max.to_string()),
        ("resolution.width", s.resolution.width.to_string()),
        ("resolution.height", s.resolution.height.to_string()),
        ("resolution.fullscreen", s.resolution.fullscreen.to_string()),
        ("cache.enabled", s.cache.enabled.to_string()),
        ("cache.max_size_gb", s.cache.max_size_gb.to_string()),
        ("cache.ttl_days", s.cache.ttl_days.to_string()),
        ("update.check_interval_hours", s.update.check_interval_hours.to_string()),
        ("update.auto_download", s.update.auto_download.to_string()),
    ];
    let mut stmt = conn.prepare(
        "INSERT INTO global_settings (key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value=?2, updated_at=?3",
    )?;
    for (k, v) in pairs {
        stmt.execute(rusqlite::params![k, v, now_secs])?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn fixture() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE global_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);",
        )
        .unwrap();
        conn
    }

    #[test]
    fn empty_table_yields_defaults() {
        let conn = fixture();
        let s = get_settings(&conn).unwrap();
        assert_eq!(s.download.request_timeout_ms, 3000);
        assert_eq!(s.java.memory_max, 4096);
        assert_eq!(s.resolution.width, 854);
        assert!(s.cache.enabled);
        assert_eq!(s.update.check_interval_hours, 2);
    }

    #[test]
    fn reads_legacy_dotted_keys() {
        let conn = fixture();
        conn.execute_batch(
            "INSERT INTO global_settings VALUES
             ('download.timeout_ms','5000',1),
             ('java.path','/usr/bin/java',1),
             ('java.memory_max','8192',1),
             ('resolution.fullscreen','true',1);",
        )
        .unwrap();
        let s = get_settings(&conn).unwrap();
        assert_eq!(s.download.request_timeout_ms, 5000);
        assert_eq!(s.java.java_path, "/usr/bin/java");
        assert_eq!(s.java.memory_max, 8192);
        assert!(s.resolution.fullscreen);
    }

    #[test]
    fn update_roundtrips() {
        let conn = fixture();
        let mut s = get_settings(&conn).unwrap();
        s.java.memory_min = 2048;
        s.download.max_parallel = 20;
        update_settings(&conn, &s, 12345).unwrap();
        let s2 = get_settings(&conn).unwrap();
        assert_eq!(s2.java.memory_min, 2048);
        assert_eq!(s2.download.max_parallel, 20);
        let ts: i64 = conn
            .query_row(
                "SELECT updated_at FROM global_settings WHERE key='java.memory_min'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(ts, 12345);
    }

    #[test]
    fn serializes_snake_case_nested() {
        let conn = fixture();
        let s = get_settings(&conn).unwrap();
        let json = serde_json::to_value(&s).unwrap();
        assert!(json["download"]["request_timeout_ms"].is_number());
        assert!(json["java"]["java_path"].is_string());
        assert!(json["update"]["auto_download"].is_boolean());
    }
}
