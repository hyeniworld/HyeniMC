//! 런처 전역 인증 토큰 저장소 — (디스코드 채널×서버) 세트별 다중 엔트리.
//! global_settings kv 1키(hyeni.auth_tokens)에 JSON 배열로 저장(스키마 마이그레이션 불필요).
//! 프로필 config 기록은 호출자가 서버 매칭을 통과했을 때만 한다(스펙 §2-1).

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::CoreError;

const KV_KEY: &str = "hyeni.auth_tokens";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredToken {
    pub token: String,
    #[serde(default)]
    pub servers: Vec<String>,
    #[serde(default)]
    pub received_at: i64,
}

fn normalize_set(servers: &[String]) -> Vec<String> {
    let mut v: Vec<String> = servers
        .iter()
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty())
        .collect();
    v.sort();
    v.dedup();
    v
}

fn read_raw(conn: &Connection) -> Result<Vec<StoredToken>, CoreError> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM global_settings WHERE key = ?1",
            [KV_KEY],
            |r| r.get(0),
        )
        .map(Some)
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(other),
        })?;
    let Some(raw) = raw else {
        return Ok(Vec::new());
    };
    Ok(serde_json::from_str(&raw).unwrap_or_default()) // 손상 → 빈 목록
}

fn write_raw(conn: &Connection, tokens: &[StoredToken], now_secs: i64) -> Result<(), CoreError> {
    let json = serde_json::to_string(tokens)?;
    conn.execute(
        "INSERT INTO global_settings(key, value, updated_at) VALUES(?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = ?3",
        rusqlite::params![KV_KEY, json, now_secs],
    )?;
    Ok(())
}

/// 최신(received_at desc) 정렬 목록. 키 부재/손상 JSON → 빈 Vec.
pub fn list_tokens(conn: &Connection) -> Result<Vec<StoredToken>, CoreError> {
    let mut tokens = read_raw(conn)?;
    tokens.sort_by(|a, b| b.received_at.cmp(&a.received_at));
    Ok(tokens)
}

/// 같은 servers 세트(정규화·순서 무관)면 교체, 아니면 추가.
pub fn upsert_token(
    conn: &Connection,
    token: &str,
    servers: &[String],
    now_secs: i64,
) -> Result<(), CoreError> {
    let mut tokens = read_raw(conn)?;
    let key = normalize_set(servers);
    tokens.retain(|t| normalize_set(&t.servers) != key);
    tokens.push(StoredToken {
        token: token.to_string(),
        servers: servers.to_vec(),
        received_at: now_secs,
    });
    write_raw(conn, &tokens, now_secs)
}

/// 최신 엔트리의 토큰(다운로드 폴백용 — 스코프 무관하게 유효하기만 하면 됨).
pub fn any_token(conn: &Connection) -> Result<Option<String>, CoreError> {
    Ok(list_tokens(conn)?.into_iter().next().map(|t| t.token))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE global_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);",
        ).unwrap();
        conn
    }

    #[test]
    fn upsert_and_list_ordered_by_recency() {
        let conn = db();
        upsert_token(&conn, "tok-a", &["mc.a.com".into()], 100).unwrap();
        upsert_token(&conn, "tok-b", &["mc.b.com".into()], 200).unwrap();
        let list = list_tokens(&conn).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].token, "tok-b"); // 최신 우선
        assert_eq!(any_token(&conn).unwrap().as_deref(), Some("tok-b"));
    }

    #[test]
    fn same_server_set_replaces_regardless_of_order_and_case() {
        let conn = db();
        upsert_token(&conn, "old", &["MC.A.com".into(), "mc.b.com".into()], 100).unwrap();
        upsert_token(&conn, "new", &["mc.b.com".into(), "mc.a.com ".into()], 200).unwrap();
        let list = list_tokens(&conn).unwrap();
        assert_eq!(list.len(), 1); // 교체, 추가 아님
        assert_eq!(list[0].token, "new");
    }

    #[test]
    fn empty_servers_entry_is_its_own_set() {
        let conn = db();
        upsert_token(&conn, "scoped", &["mc.a.com".into()], 100).unwrap();
        upsert_token(&conn, "unscoped", &[], 200).unwrap();
        assert_eq!(list_tokens(&conn).unwrap().len(), 2);
        upsert_token(&conn, "unscoped2", &[], 300).unwrap(); // 빈 세트끼리는 교체
        let list = list_tokens(&conn).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].token, "unscoped2");
    }

    #[test]
    fn missing_or_corrupt_value_yields_empty() {
        let conn = db();
        assert!(list_tokens(&conn).unwrap().is_empty());
        conn.execute(
            "INSERT INTO global_settings(key,value,updated_at) VALUES('hyeni.auth_tokens','{broken',0)",
            [],
        ).unwrap();
        assert!(list_tokens(&conn).unwrap().is_empty()); // 손상 → 빈 목록(에러 아님)
        assert_eq!(any_token(&conn).unwrap(), None);
    }
}
