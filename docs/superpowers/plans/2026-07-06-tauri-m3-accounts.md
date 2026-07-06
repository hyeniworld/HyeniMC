# Tauri M3: 계정 (MS OAuth + 기존 토큰 호환) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Microsoft 로그인 전체 플로우를 Rust로 포팅하고, **기존 Go 판이 암호화해 둔 계정 토큰을 그대로 복호화**해 game_launch에 실계정을 연결한다.

**Architecture:** hyenimc-core에 crypto(AES-256-GCM — Go 방식 그대로: raw 32B `.key`, 12B nonce hex, 16B tag 분리 hex, payload는 snake_case JSON)+accounts 저장소 → hyenimc-launcher에 auth(PKCE/로컬 콜백 53682/토큰 교환/XBL→XSTS→MC/프로필/refresh) → Tauri 커맨드 5개 + game_launch 실계정 배선 + shim.

**Tech Stack:** aes-gcm, rand, sha2, base64(PKCE), tokio TcpListener(콜백), reqwest.

## Global Constraints (실측 확정치)

- 암호화: 키 = `<dataDir>/.key` raw 32바이트. AES-256-GCM, nonce 12B(iv hex 24자), Seal 결과 마지막 16B를 auth_tag로 분리(hex 32자), AAD 없음. 평문 = `{"access_token":..,"refresh_token":..,"expires_at":<epoch초>}` (Go DecryptedTokens json 태그)
- accounts 스키마: id(=formatted uuid)/name/uuid/type('microsoft'|'offline' — **offline은 제거 방침이므로 microsoft만 생성**, 기존 offline 행은 읽기 무시)/encrypted_data/iv/auth_tag/skin_url/last_used/device_id/created_at/updated_at (epoch 초)
- device_id: `<dataDir>/.device_id` (없으면 sha256(dataDir 경로) hex 생성·저장)
- OAuth (TS 실측): authorize/token = `login.microsoftonline.com/consumers/oauth2/v2.0/*`, scope `XboxLive.signin offline_access`, PKCE S256 + state, redirect `http://localhost:53682/callback`. XBL `user.auth.xboxlive.com/user/authenticate` (RPS, RpsTicket `d=<access_token>`), XSTS RelyingParty `rp://api.minecraftservices.com/`, MC `login_with_xbox` identityToken `XBL3.0 x=<uhs>;<xsts>`, 프로필 GET `/minecraft/profile`
- client_id: `option_env!("AZURE_CLIENT_ID")` → 런타임 `std::env::var` 폴백 → 없으면 명시적 에러. (generate-config의 Rust 산출은 M6 배포 파이프라인에서 정식화 — 백로그 메모)
- Windows 1순위 원칙 적용: 콜백 서버/브라우저 열기(tauri-plugin-opener)는 플랫폼 중립 코드로. launcher 크레이트 Windows 타깃 check 포함
- 네트워크 플로우는 오프라인 테스트 불가 → 응답 역직렬화 fixture 테스트 + PKCE RFC 벡터 + **실DB 실계정 복호화 스모크**(토큰 값 비노출)로 대체, e2e는 일괄 테스트

---

### Task 1: hyenimc-core crypto + accounts 모듈

**Files:** Create `crates/hyenimc-core/src/crypto.rs`, `crates/hyenimc-core/src/account.rs`; Modify lib.rs, Cargo.toml(aes-gcm, rand), examples/read_real_db.rs(실계정 복호화 스모크)

**Interfaces:**
- `crypto::load_encryption_key(data_dir) -> Result<[u8;32]>` / `load_or_create_device_id(data_dir) -> Result<String>`
- `crypto::DecryptedTokens{access_token, refresh_token, expires_at}` (serde snake_case)
- `crypto::decrypt_tokens(key, enc_hex, iv_hex, tag_hex) -> Result<DecryptedTokens>` / `encrypt_tokens(key, &tokens) -> Result<(String,String,String)>`
- `account::Account{id,name,uuid,account_type,skin_url,last_used,created_at,updated_at}` (camelCase 직렬화, `type` 컬럼 ↔ account_type)
- `account::list_accounts/get_account/save_microsoft_account(conn,key,device_id,name,uuid,tokens,skin_url,now)/update_tokens/update_last_used/remove_account` + `format_uuid`(하이픈 정규화)

**Steps:** ① Go 스킴 그대로의 roundtrip + 고정 벡터 테스트(RED) ② 구현(GREEN) ③ accounts CRUD 테스트(fixture DDL) ④ read_real_db에 실계정 복호화 검증 추가(개수/만료시각만 출력) ⑤ 커밋

### Task 2: hyenimc-launcher auth 모듈 (MS OAuth 체인)

**Files:** Create `crates/hyenimc-launcher/src/auth.rs`; Modify lib.rs, Cargo.toml(sha2, base64, rand, urlencoding 불필요 — 수동 인코딩)

**Interfaces:**
- `auth::generate_pkce() -> (verifier, challenge)` / `build_authorize_url(client_id, challenge, state) -> String`
- `auth::run_callback_server(state, timeout) -> Result<String /*code*/>` — 127.0.0.1:53682 TcpListener, `/callback?code&state` 파싱(state 불일치 거부), 브라우저에 완료 HTML 응답
- `auth::exchange_code(http, client_id, code, verifier) -> MsTokenResponse{access_token, refresh_token, expires_in}` / `refresh_ms_token(http, client_id, refresh_token) -> MsTokenResponse`
- `auth::login_minecraft(http, ms_access_token) -> McSession{access_token, expires_in}` — XBL→XSTS(uhs)→login_with_xbox 체인
- `auth::fetch_profile(http, mc_access_token) -> McProfile{id, name, skin_url: Option}`
- `auth::full_login(...)`/`full_refresh(...)` — MS 토큰 → MC 세션+프로필 (재사용 조합)

**Steps:** ① PKCE(RFC 7636 벡터: verifier "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk" → challenge "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")/authorize URL 파라미터/콜백 요청 라인 파서(순수) 테스트 ② 구현 ③ 응답 역직렬화 fixture 테스트(XBL/XSTS/login_with_xbox/profile 실제 형태 축약 JSON) ④ 커밋

### Task 3: Tauri 계정 커맨드 + game_launch 실계정 + shim

**Files:** Create `apps/launcher/src-tauri/src/account.rs`; Modify main.rs, game.rs, tauri-shim.ts

**Interfaces (커맨드 — preload account 표면 대응):**
- `account_list` → Vec<Account> (list)
- `account_login_microsoft` → 전체 플로우(브라우저는 tauri-plugin-opener로 열기) → save_microsoft_account(MS refresh 토큰 저장, **MC 세션 토큰을 access_token으로 저장 + expires_at** — TS 의미) → Account 반환
- `account_remove(id)`
- `account_refresh(id)` → refresh 체인 → update_tokens → Account
- `account_get_tokens(id)` (내부용) → 만료 60초 전이면 자동 refresh 후 복호화 토큰 반환
- game_launch: account_id 있으면 tokens 조회 → username/uuid(계정 행) + access_token, user_type="msa"; 없으면 기존 더미
- shim: account { loginMicrosoft, addOffline(제거 방침 — 명시적 에러 스텁), list, remove, refresh } 실연결

**Steps:** ① 구현 ② cargo check(+windows 타깃 launcher) + npm build + vitest ③ 커밋

### Task 4: 마감 — 전체 검증 + 실DB 스모크 + 문서/운영 파일

## Self-Review 결과
- 기존 토큰 호환이 최우선 → Task 1의 실DB 복호화 스모크가 게이트. Go와 동일 바이트 포맷(분리 tag) 검증 벡터 포함.
- 브라우저 열기: tauri-plugin-opener 필요(신규 플러그인 — capabilities 추가).
- addOffline은 제거 확정이라 에러 스텁으로 경계 표시.
