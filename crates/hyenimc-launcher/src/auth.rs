//! Microsoft OAuth → Xbox Live → XSTS → Minecraft 인증 체인.
//! TS microsoft-auth.ts의 의미 포팅 (PKCE S256, 로컬 콜백 127.0.0.1:53682).

use base64::Engine;
use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::LauncherError;

pub const REDIRECT_URI: &str = "http://localhost:53682/callback";
const AUTHORIZE_URL: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize";
const TOKEN_URL: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const XBL_URL: &str = "https://user.auth.xboxlive.com/user/authenticate";
const XSTS_URL: &str = "https://xsts.auth.xboxlive.com/xsts/authorize";
const MC_LOGIN_URL: &str = "https://api.minecraftservices.com/authentication/login_with_xbox";
const MC_PROFILE_URL: &str = "https://api.minecraftservices.com/minecraft/profile";

fn b64url(data: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(data)
}

/// PKCE S256 — (verifier, challenge)
pub fn generate_pkce() -> (String, String) {
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    let verifier = b64url(&bytes);
    let challenge = challenge_for(&verifier);
    (verifier, challenge)
}

pub fn challenge_for(verifier: &str) -> String {
    b64url(&Sha256::digest(verifier.as_bytes()))
}

pub fn generate_state() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

pub fn build_authorize_url(client_id: &str, challenge: &str, state: &str) -> String {
    format!(
        "{AUTHORIZE_URL}?client_id={client_id}&response_type=code\
         &redirect_uri=http%3A%2F%2Flocalhost%3A53682%2Fcallback\
         &scope=XboxLive.signin%20offline_access\
         &code_challenge={challenge}&code_challenge_method=S256&state={state}"
    )
}

/// GET 요청 라인의 경로에서 code 추출 (state 불일치/error 파라미터는 거부). 순수 함수.
pub fn parse_callback_path(path: &str, expected_state: &str) -> Result<String, LauncherError> {
    let query = path
        .split_once('?')
        .map(|(_, q)| q)
        .ok_or_else(|| LauncherError::Other("콜백에 쿼리 없음".into()))?;
    let mut code = None;
    let mut state = None;
    let mut error = None;
    for pair in query.split('&') {
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        match k {
            "code" => code = Some(v.to_string()),
            "state" => state = Some(v.to_string()),
            "error" => error = Some(v.to_string()),
            _ => {}
        }
    }
    if let Some(e) = error {
        return Err(LauncherError::Other(format!("로그인 거부/실패: {e}")));
    }
    if state.as_deref() != Some(expected_state) {
        return Err(LauncherError::Other("state 불일치 (CSRF 의심)".into()));
    }
    code.ok_or_else(|| LauncherError::Other("code 없음".into()))
}

/// 로컬 콜백 서버 — 브라우저 리디렉션에서 authorization code 수신.
pub async fn run_callback_server(
    expected_state: &str,
    timeout: std::time::Duration,
) -> Result<String, LauncherError> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let listener = tokio::net::TcpListener::bind("127.0.0.1:53682")
        .await
        .map_err(|e| LauncherError::Other(format!("콜백 포트(53682) 바인드 실패: {e}")))?;

    let accept = async {
        loop {
            let (mut stream, _) = listener.accept().await?;
            let mut buf = vec![0u8; 4096];
            let n = stream.read(&mut buf).await?;
            let request = String::from_utf8_lossy(&buf[..n]).to_string();
            let first_line = request.lines().next().unwrap_or_default().to_string();
            // "GET /callback?... HTTP/1.1"
            let path = first_line.split_whitespace().nth(1).unwrap_or_default().to_string();
            if !path.starts_with("/callback") {
                let _ = stream
                    .write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n")
                    .await;
                continue;
            }
            let result = parse_callback_path(&path, expected_state);
            let body = match &result {
                Ok(_) => "<html><body><h2>HyeniMC \u{b85c}\u{adf8}\u{c778} \u{c644}\u{b8cc}!</h2><p>\u{c774} \u{cc3d}\u{c744} \u{b2eb}\u{c544}\u{c8fc}\u{c138}\u{c694}.</p></body></html>",
                Err(_) => "<html><body><h2>\u{b85c}\u{adf8}\u{c778} \u{c2e4}\u{d328}</h2><p>\u{b7f0}\u{ccb4}\u{b85c} \u{b3cc}\u{c544}\u{ac00} \u{b2e4}\u{c2dc} \u{c2dc}\u{b3c4}\u{d558}\u{c138}\u{c694}.</p></body></html>",
            };
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = stream.write_all(response.as_bytes()).await;
            return result;
        }
    };

    match tokio::time::timeout(timeout, accept).await {
        Ok(r) => r,
        Err(_) => Err(LauncherError::Other("로그인 시간 초과 (5분)".into())),
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct MsTokenResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: i64,
}

pub async fn exchange_code(
    http: &reqwest::Client,
    client_id: &str,
    code: &str,
    verifier: &str,
) -> Result<MsTokenResponse, LauncherError> {
    let resp = http
        .post(TOKEN_URL)
        .form(&[
            ("client_id", client_id),
            ("code", code),
            ("redirect_uri", REDIRECT_URI),
            ("grant_type", "authorization_code"),
            ("code_verifier", verifier),
        ])
        .send()
        .await?
        .error_for_status()?;
    Ok(resp.json().await?)
}

pub async fn refresh_ms_token(
    http: &reqwest::Client,
    client_id: &str,
    refresh_token: &str,
) -> Result<MsTokenResponse, LauncherError> {
    let resp = http
        .post(TOKEN_URL)
        .form(&[
            ("client_id", client_id),
            ("refresh_token", refresh_token),
            ("grant_type", "refresh_token"),
            ("scope", "XboxLive.signin offline_access"),
        ])
        .send()
        .await?
        .error_for_status()?;
    Ok(resp.json().await?)
}

#[derive(Debug, Deserialize)]
pub struct XboxResponse {
    #[serde(rename = "Token")]
    pub token: String,
    #[serde(rename = "DisplayClaims")]
    pub display_claims: DisplayClaims,
}

#[derive(Debug, Deserialize)]
pub struct DisplayClaims {
    pub xui: Vec<Xui>,
}

#[derive(Debug, Deserialize)]
pub struct Xui {
    pub uhs: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct McSession {
    pub access_token: String,
    pub expires_in: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct McProfile {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub skins: Vec<McSkin>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct McSkin {
    pub url: String,
    #[serde(default)]
    pub state: Option<String>,
}

impl McProfile {
    pub fn active_skin_url(&self) -> Option<String> {
        self.skins
            .iter()
            .find(|s| s.state.as_deref() == Some("ACTIVE"))
            .or(self.skins.first())
            .map(|s| s.url.clone())
    }
}

/// MS access token → Xbox Live → XSTS → Minecraft 세션
pub async fn login_minecraft(
    http: &reqwest::Client,
    ms_access_token: &str,
) -> Result<McSession, LauncherError> {
    let xbl: XboxResponse = http
        .post(XBL_URL)
        .json(&serde_json::json!({
            "Properties": {
                "AuthMethod": "RPS",
                "SiteName": "user.auth.xboxlive.com",
                "RpsTicket": format!("d={ms_access_token}"),
            },
            "RelyingParty": "http://auth.xboxlive.com",
            "TokenType": "JWT",
        }))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;

    let xsts: XboxResponse = http
        .post(XSTS_URL)
        .json(&serde_json::json!({
            "Properties": { "SandboxId": "RETAIL", "UserTokens": [xbl.token] },
            "RelyingParty": "rp://api.minecraftservices.com/",
            "TokenType": "JWT",
        }))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;

    let uhs = xsts
        .display_claims
        .xui
        .first()
        .map(|x| x.uhs.clone())
        .ok_or_else(|| LauncherError::Other("XSTS 응답에 uhs 없음".into()))?;

    let session: McSession = http
        .post(MC_LOGIN_URL)
        .json(&serde_json::json!({
            "identityToken": format!("XBL3.0 x={uhs};{}", xsts.token),
        }))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    Ok(session)
}

pub async fn fetch_profile(
    http: &reqwest::Client,
    mc_access_token: &str,
) -> Result<McProfile, LauncherError> {
    Ok(http
        .get(MC_PROFILE_URL)
        .bearer_auth(mc_access_token)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_challenge_matches_rfc7636_vector() {
        // RFC 7636 부록 B 벡터
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        assert_eq!(challenge_for(verifier), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }

    #[test]
    fn authorize_url_contains_required_params() {
        let url = build_authorize_url("client-123", "chal", "st4te");
        assert!(url.starts_with("https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?"));
        for needle in [
            "client_id=client-123",
            "response_type=code",
            "scope=XboxLive.signin%20offline_access",
            "code_challenge=chal",
            "code_challenge_method=S256",
            "state=st4te",
            "redirect_uri=http%3A%2F%2Flocalhost%3A53682%2Fcallback",
        ] {
            assert!(url.contains(needle), "missing {needle}");
        }
    }

    #[test]
    fn callback_parser_validates_state_and_error() {
        assert_eq!(
            parse_callback_path("/callback?code=abc&state=s1", "s1").unwrap(),
            "abc"
        );
        assert!(parse_callback_path("/callback?code=abc&state=WRONG", "s1").is_err());
        assert!(parse_callback_path("/callback?error=access_denied&state=s1", "s1").is_err());
        assert!(parse_callback_path("/callback", "s1").is_err());
    }

    #[test]
    fn deserializes_auth_chain_responses() {
        let xbl: XboxResponse = serde_json::from_str(
            r#"{"IssueInstant":"x","NotAfter":"y","Token":"tok",
                "DisplayClaims":{"xui":[{"uhs":"user-hash"}]}}"#,
        )
        .unwrap();
        assert_eq!(xbl.display_claims.xui[0].uhs, "user-hash");

        let mc: McSession = serde_json::from_str(
            r#"{"username":"uuid","roles":[],"access_token":"mc-tok","token_type":"Bearer","expires_in":86400}"#,
        )
        .unwrap();
        assert_eq!(mc.access_token, "mc-tok");

        let profile: McProfile = serde_json::from_str(
            r#"{"id":"abcd","name":"Player","skins":[
                {"id":"s1","state":"INACTIVE","url":"https://a"},
                {"id":"s2","state":"ACTIVE","url":"https://b"}],"capes":[]}"#,
        )
        .unwrap();
        assert_eq!(profile.active_skin_url().as_deref(), Some("https://b"));
    }

    #[tokio::test]
    async fn callback_server_receives_code() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let state = "test-state";
        let server = tokio::spawn(run_callback_server(
            state,
            std::time::Duration::from_secs(5),
        ));
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;

        let mut conn = tokio::net::TcpStream::connect("127.0.0.1:53682").await.unwrap();
        conn.write_all(b"GET /callback?code=the-code&state=test-state HTTP/1.1\r\nHost: localhost\r\n\r\n")
            .await
            .unwrap();
        let mut resp = String::new();
        let _ = conn.read_to_string(&mut resp).await;
        assert!(resp.contains("200 OK"));

        let code = server.await.unwrap().unwrap();
        assert_eq!(code, "the-code");
    }
}
