//! 계정 커맨드 (M3) — 기존 account IPC 대응. 토큰은 기존 Go 스킴으로 암호화 저장.

use tauri::State;
use tauri_plugin_opener::OpenerExt;

use hyenimc_core::crypto::DecryptedTokens;
use hyenimc_launcher::auth;

use crate::commands::DbState;
use crate::util::cmd_err;

/// setup에서 로드되는 암호화 컨텍스트 (.key / .device_id)
pub struct CryptoState {
    pub key: [u8; 32],
    pub device_id: String,
}

fn client_id() -> Result<String, String> {
    if let Some(id) = option_env!("AZURE_CLIENT_ID") {
        if !id.is_empty() {
            return Ok(id.to_string());
        }
    }
    std::env::var("AZURE_CLIENT_ID")
        .ok()
        .filter(|v| !v.is_empty())
        .ok_or_else(|| {
            "AZURE_CLIENT_ID가 설정되지 않았습니다 (.env 또는 환경변수)".to_string()
        })
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn now_secs() -> i64 {
    now_ms() / 1000
}

#[tauri::command]
pub fn account_list(db: State<DbState>) -> Result<Vec<hyenimc_core::account::Account>, String> {
    hyenimc_core::account::list_accounts(&db.0.lock().unwrap()).map_err(cmd_err("account"))
}

#[tauri::command]
pub fn account_remove(db: State<DbState>, id: String) -> Result<bool, String> {
    hyenimc_core::account::remove_account(&db.0.lock().unwrap(), &id).map_err(cmd_err("account"))
}

/// Microsoft 로그인 전체 플로우 — 브라우저 열기 → 콜백 → 토큰 교환 → MC 세션/프로필 → 저장
#[tauri::command]
pub async fn account_login_microsoft(
    app: tauri::AppHandle,
    db: State<'_, DbState>,
    crypto: State<'_, CryptoState>,
) -> Result<hyenimc_core::account::Account, String> {
    let client_id = client_id()?;
    let (verifier, challenge) = auth::generate_pkce();
    let state = auth::generate_state();
    let url = auth::build_authorize_url(&client_id, &challenge, &state);

    app.opener()
        .open_url(url, None::<String>)
        .map_err(|e| format!("브라우저 열기 실패: {e}"))?;

    let code = auth::run_callback_server(&state, std::time::Duration::from_secs(300))
        .await
        .map_err(cmd_err("account"))?;

    let http = reqwest::Client::new();
    let ms = auth::exchange_code(&http, &client_id, &code, &verifier)
        .await
        .map_err(cmd_err("account"))?;
    let session = auth::login_minecraft(&http, &ms.access_token)
        .await
        .map_err(cmd_err("account"))?;
    let profile = auth::fetch_profile(&http, &session.access_token)
        .await
        .map_err(cmd_err("account"))?;

    // TS 의미: access_token = MC 세션 토큰, refresh_token = MS refresh, expires_at = ms epoch
    let tokens = DecryptedTokens {
        access_token: session.access_token,
        refresh_token: ms.refresh_token,
        expires_at: now_ms() + session.expires_in * 1000,
    };
    let conn = db.0.lock().unwrap();
    hyenimc_core::account::save_microsoft_account(
        &conn,
        &crypto.key,
        &crypto.device_id,
        &profile.name,
        &profile.id,
        &tokens,
        profile.active_skin_url().as_deref(),
        now_secs(),
    )
    .map_err(cmd_err("account"))
}

/// 토큰 갱신 (만료 임박 시 자동) — MS refresh → MC 세션 재발급 → 저장
#[tauri::command]
pub async fn account_refresh(
    db: State<'_, DbState>,
    crypto: State<'_, CryptoState>,
    id: String,
) -> Result<hyenimc_core::account::Account, String> {
    refresh_account_tokens(&db, &crypto, &id).await?;
    let conn = db.0.lock().unwrap();
    hyenimc_core::account::get_account(&conn, &id)
        .map_err(cmd_err("account"))?
        .ok_or_else(|| format!("계정 없음: {id}"))
}

async fn refresh_account_tokens(
    db: &State<'_, DbState>,
    crypto: &State<'_, CryptoState>,
    id: &str,
) -> Result<DecryptedTokens, String> {
    let old = {
        let conn = db.0.lock().unwrap();
        hyenimc_core::account::get_tokens(&conn, &crypto.key, id)
            .map_err(cmd_err("account"))?
            .ok_or_else(|| format!("계정 토큰 없음: {id}"))?
    };
    let client_id = client_id()?;
    let http = reqwest::Client::new();
    let ms = auth::refresh_ms_token(&http, &client_id, &old.refresh_token)
        .await
        .map_err(|e| format!("토큰 갱신 실패 — 다시 로그인하세요: {e}"))?;
    let session = auth::login_minecraft(&http, &ms.access_token)
        .await
        .map_err(cmd_err("account"))?;
    let new_tokens = DecryptedTokens {
        access_token: session.access_token,
        refresh_token: ms.refresh_token,
        expires_at: now_ms() + session.expires_in * 1000,
    };
    let conn = db.0.lock().unwrap();
    hyenimc_core::account::update_tokens(&conn, &crypto.key, id, &new_tokens, now_secs())
        .map_err(cmd_err("account"))?;
    Ok(new_tokens)
}

/// game_launch용 — 만료 60초 전이면 자동 갱신 후 유효 토큰 반환.
pub async fn get_valid_tokens(
    db: &State<'_, DbState>,
    crypto: &State<'_, CryptoState>,
    id: &str,
) -> Result<DecryptedTokens, String> {
    let tokens = {
        let conn = db.0.lock().unwrap();
        hyenimc_core::account::get_tokens(&conn, &crypto.key, id)
            .map_err(cmd_err("account"))?
            .ok_or_else(|| format!("계정 토큰 없음: {id}"))?
    };
    if tokens.expires_at > now_ms() + 60_000 {
        let conn = db.0.lock().unwrap();
        let _ = hyenimc_core::account::update_last_used(&conn, id, now_secs());
        return Ok(tokens);
    }
    let refreshed = refresh_account_tokens(db, crypto, id).await?;
    let conn = db.0.lock().unwrap();
    let _ = hyenimc_core::account::update_last_used(&conn, id, now_secs());
    Ok(refreshed)
}
