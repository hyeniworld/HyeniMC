//! 프로필 통계 — 기존 profile_stats 테이블 그대로 사용 (행 없으면 0 기본값).

use rusqlite::Connection;
use serde::Serialize;

use crate::CoreError;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileStats {
    pub profile_id: String,
    pub last_launched_at: Option<i64>,
    pub total_play_time: i64,
    pub launch_count: i64,
    pub crash_count: i64,
    pub last_crash_at: Option<i64>,
}

pub fn get_stats(conn: &Connection, profile_id: &str) -> Result<ProfileStats, CoreError> {
    let mut stmt = conn.prepare(
        "SELECT last_launched_at, total_play_time, launch_count, crash_count, last_crash_at
         FROM profile_stats WHERE profile_id = ?1",
    )?;
    let mut rows = stmt.query_map([profile_id], |r| {
        Ok(ProfileStats {
            profile_id: profile_id.to_string(),
            last_launched_at: r.get(0)?,
            total_play_time: r.get::<_, Option<i64>>(1)?.unwrap_or(0),
            launch_count: r.get::<_, Option<i64>>(2)?.unwrap_or(0),
            crash_count: r.get::<_, Option<i64>>(3)?.unwrap_or(0),
            last_crash_at: r.get(4)?,
        })
    })?;
    Ok(rows.next().transpose()?.unwrap_or(ProfileStats {
        profile_id: profile_id.to_string(),
        last_launched_at: None,
        total_play_time: 0,
        launch_count: 0,
        crash_count: 0,
        last_crash_at: None,
    }))
}

pub fn record_launch(conn: &Connection, profile_id: &str, now_secs: i64) -> Result<(), CoreError> {
    conn.execute(
        "INSERT INTO profile_stats (profile_id, last_launched_at, launch_count) VALUES (?1, ?2, 1)
         ON CONFLICT(profile_id) DO UPDATE SET last_launched_at=?2, launch_count=launch_count+1",
        rusqlite::params![profile_id, now_secs],
    )?;
    Ok(())
}

pub fn record_play_time(conn: &Connection, profile_id: &str, seconds: i64) -> Result<(), CoreError> {
    conn.execute(
        "INSERT INTO profile_stats (profile_id, total_play_time) VALUES (?1, ?2)
         ON CONFLICT(profile_id) DO UPDATE SET total_play_time=total_play_time+?2",
        rusqlite::params![profile_id, seconds],
    )?;
    Ok(())
}

pub fn record_crash(conn: &Connection, profile_id: &str, now_secs: i64) -> Result<(), CoreError> {
    conn.execute(
        "INSERT INTO profile_stats (profile_id, crash_count, last_crash_at) VALUES (?1, 1, ?2)
         ON CONFLICT(profile_id) DO UPDATE SET crash_count=crash_count+1, last_crash_at=?2",
        rusqlite::params![profile_id, now_secs],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn fixture() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE profile_stats (
                profile_id TEXT PRIMARY KEY,
                last_launched_at INTEGER,
                total_play_time INTEGER DEFAULT 0,
                launch_count INTEGER DEFAULT 0,
                crash_count INTEGER DEFAULT 0,
                last_crash_at INTEGER
            );",
        )
        .unwrap();
        conn
    }

    #[test]
    fn missing_row_yields_zeroes() {
        let conn = fixture();
        let s = get_stats(&conn, "p1").unwrap();
        assert_eq!(s.launch_count, 0);
        assert_eq!(s.last_launched_at, None);
        assert_eq!(s.profile_id, "p1");
    }

    #[test]
    fn record_launch_play_crash_accumulate() {
        let conn = fixture();
        record_launch(&conn, "p1", 100).unwrap();
        record_launch(&conn, "p1", 200).unwrap();
        record_play_time(&conn, "p1", 3600).unwrap();
        record_crash(&conn, "p1", 250).unwrap();
        let s = get_stats(&conn, "p1").unwrap();
        assert_eq!(s.launch_count, 2);
        assert_eq!(s.last_launched_at, Some(200));
        assert_eq!(s.total_play_time, 3600);
        assert_eq!(s.crash_count, 1);
        assert_eq!(s.last_crash_at, Some(250));
    }
}
