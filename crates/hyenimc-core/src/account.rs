//! 계정 저장소 — 기존 accounts 테이블 그대로 (Go AccountService 의미 포팅).
//! offline 타입은 제거 방침 — 생성하지 않고, 기존 행은 목록에서 그대로 노출만 한다.

use rusqlite::Connection;
use serde::Serialize;

use crate::crypto::{decrypt_tokens, encrypt_tokens, DecryptedTokens};
use crate::CoreError;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub name: String,
    pub uuid: String,
    #[serde(rename = "type")]
    pub account_type: String,
    pub skin_url: Option<String>,
    pub last_used: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

/// "abcd1234..." 32자 → 8-4-4-4-12 하이픈 형식 (Go formatUUID 동일)
pub fn format_uuid(raw: &str) -> String {
    let clean: String = raw.chars().filter(|c| *c != '-').collect();
    if clean.len() != 32 {
        return raw.to_string();
    }
    format!(
        "{}-{}-{}-{}-{}",
        &clean[0..8],
        &clean[8..12],
        &clean[12..16],
        &clean[16..20],
        &clean[20..32]
    )
}

fn row_to_account(row: &rusqlite::Row<'_>) -> rusqlite::Result<Account> {
    Ok(Account {
        id: row.get(0)?,
        name: row.get(1)?,
        uuid: row.get(2)?,
        account_type: row.get(3)?,
        skin_url: row.get(4)?,
        last_used: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

const ACCOUNT_COLUMNS: &str = "id, name, uuid, type, skin_url, last_used, created_at, updated_at";

pub fn list_accounts(conn: &Connection) -> Result<Vec<Account>, CoreError> {
    let sql = format!("SELECT {ACCOUNT_COLUMNS} FROM accounts ORDER BY last_used DESC");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], row_to_account)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn get_account(conn: &Connection, id: &str) -> Result<Option<Account>, CoreError> {
    let sql = format!("SELECT {ACCOUNT_COLUMNS} FROM accounts WHERE id = ?1");
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query_map([id], row_to_account)?;
    Ok(rows.next().transpose()?)
}

/// Microsoft 계정 저장(업서트 — id = formatted uuid, Go 동일).
#[allow(clippy::too_many_arguments)]
pub fn save_microsoft_account(
    conn: &Connection,
    key: &[u8; 32],
    device_id: &str,
    name: &str,
    uuid: &str,
    tokens: &DecryptedTokens,
    skin_url: Option<&str>,
    now_secs: i64,
) -> Result<Account, CoreError> {
    let id = format_uuid(uuid);
    let (enc, iv, tag) = encrypt_tokens(key, tokens)?;
    conn.execute(
        "INSERT INTO accounts (id, name, uuid, type, encrypted_data, iv, auth_tag, skin_url,
                               last_used, device_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'microsoft', ?4, ?5, ?6, ?7, ?8, ?9, ?8, ?8)
         ON CONFLICT(id) DO UPDATE SET
           name=?2, encrypted_data=?4, iv=?5, auth_tag=?6, skin_url=?7,
           last_used=?8, device_id=?9, updated_at=?8",
        rusqlite::params![id, name, id, enc, iv, tag, skin_url, now_secs, device_id],
    )?;
    Ok(get_account(conn, &id)?.expect("just inserted"))
}

pub fn get_tokens(
    conn: &Connection,
    key: &[u8; 32],
    id: &str,
) -> Result<Option<DecryptedTokens>, CoreError> {
    let mut stmt =
        conn.prepare("SELECT encrypted_data, iv, auth_tag FROM accounts WHERE id = ?1")?;
    let mut rows = stmt.query_map([id], |r| {
        Ok((
            r.get::<_, Option<String>>(0)?,
            r.get::<_, Option<String>>(1)?,
            r.get::<_, Option<String>>(2)?,
        ))
    })?;
    match rows.next().transpose()? {
        Some((Some(enc), Some(iv), Some(tag))) => Ok(Some(decrypt_tokens(key, &enc, &iv, &tag)?)),
        Some(_) => Ok(None), // offline 계정 등 토큰 없음
        None => Ok(None),
    }
}

pub fn update_tokens(
    conn: &Connection,
    key: &[u8; 32],
    id: &str,
    tokens: &DecryptedTokens,
    now_secs: i64,
) -> Result<(), CoreError> {
    let (enc, iv, tag) = encrypt_tokens(key, tokens)?;
    conn.execute(
        "UPDATE accounts SET encrypted_data=?2, iv=?3, auth_tag=?4, updated_at=?5 WHERE id=?1",
        rusqlite::params![id, enc, iv, tag, now_secs],
    )?;
    Ok(())
}

pub fn update_last_used(conn: &Connection, id: &str, now_secs: i64) -> Result<(), CoreError> {
    conn.execute(
        "UPDATE accounts SET last_used=?2 WHERE id=?1",
        rusqlite::params![id, now_secs],
    )?;
    Ok(())
}

pub fn remove_account(conn: &Connection, id: &str) -> Result<bool, CoreError> {
    Ok(conn.execute("DELETE FROM accounts WHERE id = ?1", [id])? > 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    const DDL: &str = "CREATE TABLE accounts (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, uuid TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('microsoft', 'offline')),
        encrypted_data TEXT, iv TEXT, auth_tag TEXT, skin_url TEXT,
        last_used INTEGER NOT NULL, device_id TEXT NOT NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);";

    fn fixture() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(DDL).unwrap();
        conn
    }

    #[test]
    fn format_uuid_hyphenates() {
        assert_eq!(
            format_uuid("cd43417303a44a51893f8cc93551a91d"),
            "cd434173-03a4-4a51-893f-8cc93551a91d"
        );
        // 이미 하이픈이 있으면 정규화
        assert_eq!(
            format_uuid("cd434173-03a4-4a51-893f-8cc93551a91d"),
            "cd434173-03a4-4a51-893f-8cc93551a91d"
        );
    }

    #[test]
    fn save_get_tokens_update_remove_roundtrip() {
        let conn = fixture();
        let key = [9u8; 32];
        let tokens = DecryptedTokens {
            access_token: "mc-token".into(),
            refresh_token: "ms-refresh".into(),
            expires_at: 1000,
        };
        let acc = save_microsoft_account(
            &conn, &key, "dev-1", "혜니", "cd43417303a44a51893f8cc93551a91d",
            &tokens, Some("https://skin"), 500,
        )
        .unwrap();
        assert_eq!(acc.account_type, "microsoft");
        assert_eq!(acc.id, "cd434173-03a4-4a51-893f-8cc93551a91d");

        let got = get_tokens(&conn, &key, &acc.id).unwrap().unwrap();
        assert_eq!(got, tokens);

        let new_tokens = DecryptedTokens {
            access_token: "mc2".into(),
            refresh_token: "r2".into(),
            expires_at: 2000,
        };
        update_tokens(&conn, &key, &acc.id, &new_tokens, 600).unwrap();
        assert_eq!(get_tokens(&conn, &key, &acc.id).unwrap().unwrap(), new_tokens);

        // 재로그인(동일 uuid) → 업서트
        save_microsoft_account(&conn, &key, "dev-1", "혜니2", &acc.uuid, &new_tokens, None, 700)
            .unwrap();
        assert_eq!(list_accounts(&conn).unwrap().len(), 1);
        assert_eq!(list_accounts(&conn).unwrap()[0].name, "혜니2");

        assert!(remove_account(&conn, &acc.id).unwrap());
        assert!(get_tokens(&conn, &key, &acc.id).unwrap().is_none());
    }
}
