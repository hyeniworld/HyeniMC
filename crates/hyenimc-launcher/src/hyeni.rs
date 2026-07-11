//! 혜니월드 딥링크 인증 보조 — servers.dat 확인 + HyeniHelper config 기록.
//! TS protocol/handler.ts 의미 포팅.

use std::io::Read;
use std::path::Path;

use serde::Deserialize;

use crate::LauncherError;

#[derive(Debug, Deserialize)]
struct ServersDat {
    #[serde(default)]
    servers: Vec<ServerEntry>,
}

#[derive(Debug, Deserialize)]
struct ServerEntry {
    #[serde(default)]
    ip: Option<String>,
}

/// servers.dat(비압축 NBT, gzip 폴백)에 해당 서버 주소가 등록돼 있는지.
/// 주소 비교는 대소문자 무시 + 포트 유무 허용(prefix 매칭: "a.devbug.ing" ⊂ "a.devbug.ing:25565").
pub fn servers_dat_contains(path: &Path, server_address: &str) -> bool {
    let Ok(bytes) = std::fs::read(path) else { return false };
    let parsed: Option<ServersDat> = fastnbt::from_bytes(&bytes).ok().or_else(|| {
        // gzip 폴백
        let mut decoder = flate2::read::GzDecoder::new(&bytes[..]);
        let mut out = Vec::new();
        decoder.read_to_end(&mut out).ok()?;
        fastnbt::from_bytes(&out).ok()
    });
    let Some(dat) = parsed else { return false };

    // 포트 유무 무시: 호스트 부분만 비교
    let want_host = server_address.to_lowercase();
    let want_host = want_host.split(':').next().unwrap_or(&want_host).to_string();
    dat.servers.iter().any(|s| {
        s.ip.as_deref()
            .map(|ip| {
                let ip = ip.to_lowercase();
                ip.split(':').next().unwrap_or(&ip) == want_host
            })
            .unwrap_or(false)
    })
}

/// servers.dat의 서버 주소 목록 (worker mods 폴백 트리거용)
pub fn servers_dat_ips(path: &Path) -> Vec<String> {
    let Ok(bytes) = std::fs::read(path) else { return Vec::new() };
    let parsed: Option<ServersDat> = fastnbt::from_bytes(&bytes).ok().or_else(|| {
        let mut decoder = flate2::read::GzDecoder::new(&bytes[..]);
        let mut out = Vec::new();
        decoder.read_to_end(&mut out).ok()?;
        fastnbt::from_bytes(&out).ok()
    });
    parsed
        .map(|d| d.servers.into_iter().filter_map(|s| s.ip).collect())
        .unwrap_or_default()
}

/// mods/에 HyeniHelper jar가 있는지 (MODE 2 대상 판정)
pub fn has_hyenihelper(mods_dir: &Path) -> bool {
    !crate::workermods::find_mod_files(mods_dir, "hyenihelper").is_empty()
}

/// HyeniHelper config 기록 — TS writeHyeniHelperConfig와 동일 포맷.
/// overwrite=false면 기존 config에 비어있지 않은 token이 있을 때 스킵(false 반환).
pub fn write_hyenihelper_config(
    game_dir: &Path,
    token: &str,
    overwrite: bool,
) -> Result<bool, LauncherError> {
    let config_dir = game_dir.join("config");
    let config_file = config_dir.join("hyenihelper-config.json");

    if !overwrite {
        if let Ok(text) = std::fs::read_to_string(&config_file) {
            if let Ok(existing) = serde_json::from_str::<serde_json::Value>(&text) {
                if existing
                    .get("token")
                    .and_then(|t| t.as_str())
                    .map(|t| !t.is_empty())
                    .unwrap_or(false)
                {
                    return Ok(false); // 기존 토큰 보존
                }
            }
        }
    }

    std::fs::create_dir_all(&config_dir)?;
    let config = serde_json::json!({
        "token": token,
        "enabled": true,
        "timeoutSeconds": 10,
        "serverStatusPort": 4444,
        "authPort": 35565,
        "serverStatusInterval": 180,
    });
    std::fs::write(&config_file, serde_json::to_string_pretty(&config)?)?;
    Ok(true)
}

/// HyeniHelper config에 저장된 사용자 토큰(딥링크 /인증으로 기록됨) 읽기.
/// 워커 모드 업데이트 설치 인증에 쓰인다(TS getUserToken 대응). 없으면 None.
pub fn read_hyenihelper_token(game_dir: &Path) -> Option<String> {
    let config_file = game_dir.join("config").join("hyenihelper-config.json");
    let text = std::fs::read_to_string(config_file).ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    value
        .get("token")
        .and_then(|t| t.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from)
}

/// hyenimc://auth?token=X&server=A,B&hyenipack=ID 파싱 (순수).
/// 세 번째 = hyenipack 쿼리 파라미터(없거나 비면 None — 하위호환).
/// OS/브라우저가 정규화하며 붙이는 경로 슬래시(`hyenimc://auth/?…`)도 허용한다
/// (TS 원본 protocol/handler.ts는 new URL 기반이라 관대했음 — 동일 의미 유지).
pub fn parse_auth_url(url: &str) -> Option<(String, Vec<String>, Option<String>)> {
    let rest = url.strip_prefix("hyenimc://auth")?;
    let rest = rest.strip_prefix('/').unwrap_or(rest);
    if !rest.is_empty() && !rest.starts_with('?') {
        return None; // hyenimc://authx 등 다른 호스트
    }
    let query = rest.strip_prefix('?').unwrap_or("");
    let mut token = None;
    let mut servers = Vec::new();
    let mut hyenipack = None;
    for pair in query.split('&') {
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        match k {
            "token" => token = Some(percent_decode(v)),
            "server" => {
                servers = percent_decode(v)
                    .split(',')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect();
            }
            "hyenipack" => hyenipack = Some(percent_decode(v)),
            _ => {}
        }
    }
    token
        .filter(|t| !t.is_empty())
        .map(|t| (t, servers, hyenipack.filter(|p| !p.is_empty())))
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if let (Some(h), Some(l)) = (
                bytes.get(i + 1).copied().and_then(hex_val),
                bytes.get(i + 2).copied().and_then(hex_val),
            ) {
                out.push(h * 16 + l);
                i += 3;
                continue;
            }
        }
        out.push(if bytes[i] == b'+' { b' ' } else { bytes[i] });
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Serialize;

    #[derive(Serialize)]
    struct DatOut {
        servers: Vec<EntryOut>,
    }
    #[derive(Serialize)]
    struct EntryOut {
        ip: String,
        name: String,
    }

    fn write_servers_dat(path: &Path, ips: &[&str]) {
        let dat = DatOut {
            servers: ips.iter().map(|ip| EntryOut { ip: ip.to_string(), name: "s".into() }).collect(),
        };
        let bytes = fastnbt::to_bytes(&dat).unwrap();
        std::fs::write(path, bytes).unwrap();
    }

    #[test]
    fn servers_dat_matching() {
        let tmp = tempfile::tempdir().unwrap();
        let dat = tmp.path().join("servers.dat");
        write_servers_dat(&dat, &["mc.devbug.ing", "other.example.com:25565"]);

        assert!(servers_dat_contains(&dat, "mc.devbug.ing"));
        assert!(servers_dat_contains(&dat, "MC.DEVBUG.ING"));
        assert!(servers_dat_contains(&dat, "other.example.com")); // 포트 무시 매칭
        assert!(!servers_dat_contains(&dat, "nope.devbug.ing"));
        assert!(!servers_dat_contains(&tmp.path().join("absent.dat"), "mc.devbug.ing"));
    }

    #[test]
    fn config_write_and_overwrite_semantics() {
        let tmp = tempfile::tempdir().unwrap();
        // 신규 기록
        assert!(write_hyenihelper_config(tmp.path(), "tok-1", false).unwrap());
        let text = std::fs::read_to_string(tmp.path().join("config/hyenihelper-config.json")).unwrap();
        let v: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(v["token"], "tok-1");
        assert_eq!(v["authPort"], 35565);
        assert_eq!(v["serverStatusPort"], 4444);
        assert_eq!(v["enabled"], true);

        // overwrite=false + 기존 토큰 존재 → 스킵
        assert!(!write_hyenihelper_config(tmp.path(), "tok-2", false).unwrap());
        let v2: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(tmp.path().join("config/hyenihelper-config.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(v2["token"], "tok-1");

        // overwrite=true → 교체
        assert!(write_hyenihelper_config(tmp.path(), "tok-3", true).unwrap());
        let v3: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(tmp.path().join("config/hyenihelper-config.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(v3["token"], "tok-3");

        // read_hyenihelper_token: 기록된 토큰을 그대로 읽음
        assert_eq!(read_hyenihelper_token(tmp.path()).as_deref(), Some("tok-3"));
    }

    #[test]
    fn read_token_missing_or_empty_is_none() {
        let tmp = tempfile::tempdir().unwrap();
        assert_eq!(read_hyenihelper_token(tmp.path()), None); // config 없음
        let config_dir = tmp.path().join("config");
        std::fs::create_dir_all(&config_dir).unwrap();
        std::fs::write(config_dir.join("hyenihelper-config.json"), r#"{"token":""}"#).unwrap();
        assert_eq!(read_hyenihelper_token(tmp.path()), None); // 빈 토큰
    }

    #[test]
    fn auth_url_parsing() {
        let (token, servers, _p) =
            parse_auth_url("hyenimc://auth?token=abc%2B1&server=a.devbug.ing,b.devbug.ing").unwrap();
        assert_eq!(token, "abc+1");
        assert_eq!(servers, vec!["a.devbug.ing", "b.devbug.ing"]);

        let (t2, s2, _p2) = parse_auth_url("hyenimc://auth?token=xyz").unwrap();
        assert_eq!(t2, "xyz");
        assert!(s2.is_empty());

        assert!(parse_auth_url("hyenimc://auth?server=a").is_none()); // token 필수
        assert!(parse_auth_url("hyenimc://other?token=x").is_none());
    }

    #[test]
    fn auth_url_tolerates_normalized_path_slash() {
        // OS/브라우저가 hyenimc://auth?… 를 hyenimc://auth/?… 로 정규화해 전달하는 경우
        let (t, s, p) = parse_auth_url("hyenimc://auth/?token=abc&server=mc.a.com").unwrap();
        assert_eq!(t, "abc");
        assert_eq!(s, vec!["mc.a.com"]);
        assert_eq!(p, None);
        assert!(parse_auth_url("hyenimc://auth/").is_none()); // 토큰 없음
        assert!(parse_auth_url("hyenimc://authors?token=x").is_none()); // 다른 호스트는 여전히 거부
    }

    #[test]
    fn parse_auth_url_with_hyenipack() {
        let (t, s, p) = parse_auth_url("hyenimc://auth?token=abc&server=mc.a.com&hyenipack=season3").unwrap();
        assert_eq!(t, "abc");
        assert_eq!(s, vec!["mc.a.com"]);
        assert_eq!(p.as_deref(), Some("season3"));
        // 파라미터 없음 → None (하위호환)
        let (_, _, p2) = parse_auth_url("hyenimc://auth?token=abc").unwrap();
        assert_eq!(p2, None);
        // 빈 값 → None
        let (_, _, p3) = parse_auth_url("hyenimc://auth?token=abc&hyenipack=").unwrap();
        assert_eq!(p3, None);
    }
}
