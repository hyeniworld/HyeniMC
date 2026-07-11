//! 계정 토큰 암복호화 — 기존 Go 판(AccountService)과 바이트 호환.
//!
//! 스킴(실측): 키 = `<dataDir>/.key` raw 32바이트, AES-256-GCM(nonce 12B, AAD 없음),
//! Seal 결과의 마지막 16바이트를 auth_tag로 분리해 encrypted_data/iv/auth_tag 각각 hex 저장.
//! 평문 = `{"access_token":..,"refresh_token":..,"expires_at":<epoch초>}`.

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use serde::{Deserialize, Serialize};
use std::path::Path;

use crate::CoreError;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DecryptedTokens {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: i64,
}

/// `<dataDir>/.key` — 없으면 새로 생성(Go getOrCreateEncryptionKey와 동일 동작).
pub fn load_or_create_encryption_key(data_dir: &Path) -> Result<[u8; 32], CoreError> {
    let key_path = data_dir.join(".key");
    if let Ok(bytes) = std::fs::read(&key_path) {
        if bytes.len() == 32 {
            let mut key = [0u8; 32];
            key.copy_from_slice(&bytes);
            return Ok(key);
        }
    }
    use rand::RngCore;
    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);
    std::fs::create_dir_all(data_dir)?;
    std::fs::write(&key_path, key)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&key_path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(key)
}

/// `<dataDir>/.device_id` — 없으면 sha256(dataDir 경로) hex 생성·저장 (Go generateDeviceID 동일).
pub fn load_or_create_device_id(data_dir: &Path) -> Result<String, CoreError> {
    let path = data_dir.join(".device_id");
    if let Ok(s) = std::fs::read_to_string(&path) {
        if !s.trim().is_empty() {
            return Ok(s.trim().to_string());
        }
    }
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(data_dir.display().to_string().as_bytes());
    let id = hex::encode(digest);
    std::fs::create_dir_all(data_dir)?;
    std::fs::write(&path, &id)?;
    Ok(id)
}

fn cipher(key: &[u8; 32]) -> Result<Aes256Gcm, CoreError> {
    Aes256Gcm::new_from_slice(key).map_err(|e| CoreError::Crypto(e.to_string()))
}

pub fn encrypt_tokens(
    key: &[u8; 32],
    tokens: &DecryptedTokens,
) -> Result<(String, String, String), CoreError> {
    let plaintext = serde_json::to_string(tokens).map_err(|e| CoreError::Crypto(e.to_string()))?;
    use rand::RngCore;
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let sealed = cipher(key)?
        .encrypt(nonce, Payload { msg: plaintext.as_bytes(), aad: &[] })
        .map_err(|e| CoreError::Crypto(e.to_string()))?;
    // Go와 동일: 마지막 16바이트(auth tag) 분리
    let (ct, tag) = sealed.split_at(sealed.len() - 16);
    Ok((hex::encode(ct), hex::encode(nonce_bytes), hex::encode(tag)))
}

pub fn decrypt_tokens(
    key: &[u8; 32],
    encrypted_hex: &str,
    iv_hex: &str,
    tag_hex: &str,
) -> Result<DecryptedTokens, CoreError> {
    let mut ct = hex::decode(encrypted_hex).map_err(|e| CoreError::Crypto(e.to_string()))?;
    let nonce_bytes = hex::decode(iv_hex).map_err(|e| CoreError::Crypto(e.to_string()))?;
    let tag = hex::decode(tag_hex).map_err(|e| CoreError::Crypto(e.to_string()))?;
    ct.extend_from_slice(&tag);

    let plaintext = cipher(key)?
        .decrypt(
            Nonce::from_slice(&nonce_bytes),
            Payload { msg: &ct, aad: &[] },
        )
        .map_err(|e| CoreError::Crypto(format!("복호화 실패 (키 불일치?): {e}")))?;
    serde_json::from_slice(&plaintext).map_err(|e| CoreError::Crypto(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_preserves_tokens_and_splits_tag() {
        let key = [7u8; 32];
        let tokens = DecryptedTokens {
            access_token: "mc-access".into(),
            refresh_token: "ms-refresh".into(),
            expires_at: 1760000000,
        };
        let (enc, iv, tag) = encrypt_tokens(&key, &tokens).unwrap();
        assert_eq!(iv.len(), 24); // 12B nonce hex
        assert_eq!(tag.len(), 32); // 16B tag hex
        let back = decrypt_tokens(&key, &enc, &iv, &tag).unwrap();
        assert_eq!(back, tokens);
    }

    #[test]
    fn decrypt_rejects_wrong_key() {
        let tokens = DecryptedTokens {
            access_token: "a".into(),
            refresh_token: "r".into(),
            expires_at: 1,
        };
        let (enc, iv, tag) = encrypt_tokens(&[1u8; 32], &tokens).unwrap();
        assert!(decrypt_tokens(&[2u8; 32], &enc, &iv, &tag).is_err());
    }

    #[test]
    fn token_json_matches_go_field_names() {
        let json = r#"{"access_token":"a","refresh_token":"r","expires_at":5}"#;
        let t: DecryptedTokens = serde_json::from_str(json).unwrap();
        assert_eq!(t.expires_at, 5);
        assert_eq!(serde_json::to_value(&t).unwrap()["access_token"], "a");
    }

    #[test]
    fn key_and_device_id_are_created_and_stable() {
        let dir = tempfile::tempdir().unwrap();
        let k1 = load_or_create_encryption_key(dir.path()).unwrap();
        let k2 = load_or_create_encryption_key(dir.path()).unwrap();
        assert_eq!(k1, k2);
        let d1 = load_or_create_device_id(dir.path()).unwrap();
        let d2 = load_or_create_device_id(dir.path()).unwrap();
        assert_eq!(d1, d2);
        assert_eq!(d1.len(), 64);
    }
}
