# HyeniMC Phase 1: Tauri 사용자 런처 마이그레이션 설계

**작성일:** 2026-07-06
**상태:** 설계 확정 대기 → 마일스톤별 구현 플랜은 착수 시점에 개별 작성
**선행 결정:** 워크스페이스 `.hyeniworld/decisions.md` 2026-07-06 항목 참조

> **이 문서의 위치**: 전체 로드맵(0 push → 1 경정리 → 2 본 문서 → 3 제작자 도구 V2 export/R2 업로드 → 4 Tauri 스파이크 → 5 본 구현)의 2번. 각 마일스톤(M1~M6)은 착수 시 superpowers:writing-plans 형식의 바이트 단위 구현 플랜을 별도 작성한다.

---

## 1. 목표와 동기

**목표:** 일반 사용자 배포용 HyeniMC 런처를 Electron+Go 3-프로세스에서 **단일 프로세스 Tauri v2 + Rust**로 재작성한다.

- 배포 용량: 103MB(arm64 DMG) → **15~25MB 목표**
- 실행 부담: Chromium 번들 + Node 메인 + Go 데몬 3중 상주 → 시스템 WebView + Rust 단일 프로세스
- 아키텍처 부채 해소: gRPC/proto 계층(생성 코드 약 28K줄), 사이드카 spawn + `.grpc-port` 핸드셰이크, TS/Go 이중 구현(다운로드·로더)이 전부 소멸

**하지 않는 것 (2안 확정):** 혜니팩 제작 기능(외부 모드팩 import, 모드 검색/설치/업데이트, 혜니팩 export, 리소스/셰이더 설치·삭제 UI)은 기존 Electron 앱을 제작자 개인 도구로 존치. 장기적으로 Rust feature 빌드로 흡수(3안 수렴).

## 1.5 플랫폼 원칙 (2026-07-06 사용자 명시)

**일반 사용자 주 플랫폼은 Windows, 개발 환경은 macOS.** Java 감지·설치·게임 실행 등 플랫폼 민감 로직은 Windows 동작이 1순위다. 실천 규칙:
- 플랫폼 분기 코드는 Windows 경로를 먼저 작성·검토 (경로 구분자, `;` classpath, `.exe`, 콘솔 창 억제, rename-over-existing 등)
- `cargo check --target x86_64-pc-windows-msvc`를 각 마일스톤 마감 검증에 포함 (hyenimc-launcher — cfg(windows) 경로 타입 체크. hyenimc-core는 bundled sqlite C 컴파일 제약으로 macOS에서 불가 → Windows 실기/CI)
- QA 매트릭스에서 Windows 시나리오를 우선 순위로 배치, M6 배포 파이프라인은 NSIS(Windows)를 1급으로
- Windows 실기 검증(일괄 테스트)은 반드시 Windows 머신에서 수행 — Java 감지 벤더 디렉터리/딥링크 레지스트리/NSIS 교체 설치

## 2. 확정된 결정 사항 (2026-07-06)

| 항목 | 결정 |
|---|---|
| 분리 방식 | 2안(사용자 런처만 Tauri, Electron은 제작자 도구 존치) → 3안(feature 빌드) 로드맵 |
| 오프라인 계정 | 제거 |
| Quilt 로더 | 제거 (Fabric/NeoForge만) |
| 모드 단위 업데이트 | 일반 사용자에서 제거 — **팩 단위 업데이트(V2)로 일원화** |
| 리소스팩/셰이더팩 | 읽기전용 리스트(팩 제공분/사용자 추가분 구분 배지) + 셸 열기. 파일 감시 필수 |
| 크래시 분석 | 분석 로직 제거, **크래시 리포트 수집·전달**(로그 접근 + zip 내보내기)로 대체 |
| V2 팩 업데이트 체크 | 프로필 실행 전(필수) + 런처 시작 시 1회(배너) |

## 3. 스코프

### 포함 (사용자 런처)

- **코어**: 프로필 CRUD·격리 인스턴스, MC 버전/에셋 다운로드(Mojang piston, SHA1, 병렬, 재개), 게임 실행(JVM 인자/classpath/natives 조립 + spawn + 로그 스트림), Java 자동 감지, MS OAuth 다계정(PKCE + localhost:53682 콜백 + Xbox→XSTS→MC), 전역 설정, 프로필 통계
- **로더**: Fabric / NeoForge 설치
- **혜니팩**: 설치(매니페스트 resolve + CDN 다운로드) + **V2 팩 자동 업데이트 엔진(신규 구현)** + Modrinth/CurseForge resolve·다운로드 씬 클라이언트(검색·브라우즈 UI 없음, CF는 Worker 프록시 경유)
- **리소스팩/셰이더팩**: 읽기전용 구분 리스트 + 폴더 열기 + 파일 감시
- **혜니월드 통합**: HyeniHelper + worker mods 자동 관리(기존 2개 시스템을 1개로 통합), `hyenimc://` 딥링크 인증(servers.dat NBT + HyeniHelper config 자동 기록)
- **앱 인프라**: 런처 자동 업데이트(tauri-plugin-updater), 크래시 리포트 수집·전달, 에러 다이얼로그, 다운로드 진행 UI 파이프라인, 로깅, 강혜니 테마 UI

### 제외 (제작자 도구 = 기존 Electron 존치)

모드 검색/설치/업데이트/의존성 해결 UI, 외부 모드팩(.mrpack/CF zip) import, 혜니팩 export, 리소스/셰이더 설치·삭제·업데이트, CurseForge 검색 UI

### 영구 제거

오프라인 계정, Quilt, 크래시 분석 로직(crash-analyzer), Go 데몬·gRPC 전체, 모드 단위 업데이트 UI

## 4. 아키텍처

### 4.1 프로세스 모델

```
[기존]  React 렌더러 ←IPC→ Electron 메인(TS 19.5K) ←gRPC→ Go 데몬(8.4K)
[신규]  React 렌더러 ←invoke/emit→ Tauri Rust 코어 (단일 프로세스)
```

### 4.2 Rust workspace 구조 (3안 수렴 대비 크레이트 분리)

```
hyenimc/
├── crates/
│   ├── hyenimc-core/      # 저장소(SQLite: 프로필/계정/설정/통계), MS OAuth·토큰 암복호화,
│   │                      # 다운로드 엔진(병렬/SHA/재개), 공용 모델, 에러 타입.
│   │                      # UI·Tauri 비의존 — 제작자 도구(3안)와 공유될 기반
│   ├── hyenimc-launcher/  # MC 버전 매니페스트, 에셋/라이브러리, Java 감지, JVM 실행/로그, Fabric·NeoForge 설치
│   ├── hyenimc-pack/      # 혜니팩 매니페스트(v1 파싱 + v2), MR/CF resolve 씬 클라이언트,
│   │                      # 설치/선언형 동기화(V2 업데이트 엔진)
│   └── hyenimc-hyeni/     # Worker API 클라이언트(레지스트리/latest), worker mods 관리,
│                          # 딥링크 처리(servers.dat NBT, HyeniHelper config)
├── apps/
│   └── launcher/          # Tauri v2 앱: 커맨드 표면 + 이벤트 브리지 + 창/딥링크/업데이터 설정
│       ├── src-tauri/
│       └── src/           # 기존 src/renderer + src/shared 이식 (Vite 그대로)
└── (future) crates/hyenimc-creator/  # 3안 진입 시: 모드 검색/모드팩 import/혜니팩 export
```

### 4.3 의존성 대응표

| 현재 (TS/Go) | Rust |
|---|---|
| axios / electron.net / Go net/http | `reqwest` (+ `tokio`) |
| modernc.org/sqlite | `rusqlite` (bundled) |
| adm-zip / node-stream-zip | `zip` |
| prismarine-nbt | `fastnbt` |
| chokidar | `notify` |
| electron-updater | `tauri-plugin-updater` |
| hyenimc:// 프로토콜 등록 | `tauri-plugin-deep-link` |
| dialog/shell/single instance/log | `tauri-plugin-dialog` / `-shell`,`-opener` / `-single-instance` / `-log` |
| crypto (SHA1/SHA256, PKCE) | `sha1`, `sha2`, `base64`, `rand` |
| Go AES-256 토큰 암호화 | `aes-gcm` — **기존 `.key`(32B) + `.device_id` 파생 방식 그대로 포팅** (아래 4.4) |
| semver / uuid | `semver` / `uuid` |
| minecraft-launcher-core | (해당 없음 — 기존에도 미사용, 자체 구현 포팅) |

### 4.4 기존 데이터 호환 (in-place 전환 원칙)

기존 사용자의 데이터를 마이그레이션 절차 없이 그대로 읽는다:

- SQLite DB 위치 **(2026-07-06 실측 정정)**: 실데이터는 `~/.hyenimc`가 아니라 **Electron userData/data** — macOS `~/Library/Application Support/hyenimc/data/hyenimc.db`, Windows `%APPDATA%\hyenimc\data\`, Linux `~/.config/hyenimc/data/` (Electron이 Go 데몬을 `HYENIMC_DATA_DIR=userData/data`로 spawn했기 때문. `~/.hyenimc`는 Go 단독 실행 폴백으로 schema_version만 있는 빈 DB). Tauri도 이 경로를 그대로 본다 — `hyenimc-core/src/paths.rs::legacy_data_dir()`. profiles / accounts / global_settings / profile_stats 테이블은 스키마 그대로 사용, 모드 캐시류 테이블(api_cache, loader_versions, mod_* 등)은 미사용 방치(v2에서 정리)
- 계정 토큰: Go의 AES-256(`.key` 32바이트 + `.device_id` 파생) 방식을 동일하게 구현해 기존 저장 토큰 복호화 유지
- 프로필 디렉터리 구조(instances/, mods/, resourcepacks/, `.meta.json` 사이드카) 완전 호환 — `.meta.json`의 `installedFrom: 'hyenipack'` / `modpackId` 필드가 V2 동기화·리소스팩 구분 배지의 근거
- 렌더러 설정(zustand persist 등)은 WebView localStorage로 이전되므로 초기화 허용(경미)

### 4.5 커맨드 표면 (기존 IPC 100 핸들러 → 약 55 커맨드)

| 카테고리 | 기존 | Phase 1 | 비고 |
|---|---|---|---|
| profile | 11 | 11 | 유지 |
| game | 7 | 7 | 유지 |
| account | 6 | 5 | 오프라인 제거 |
| settings | 6 | 6 | 유지 |
| mod | 14 | 2 | list/toggle만 (검색·설치·업데이트 제거) |
| modpack | 8 | 0 | 제거 |
| hyenipack | 4 | 4 | import 계열 유지 + **packUpdate.check/apply 신규 2** |
| resourcepack/shaderpack | 14 | 4 | list + openFolder만 |
| loader | 4 | 3 | Quilt 제거 |
| java / version / launcher / shell / dialog / system / fileWatcher / errorDialog | 19 | 19 | 유지 |
| hyeni + workerMods | 4 | 2 | 두 시스템 통합 |
| **crashReport** | 0 | 2 | **신규**: exportReport / openLogsFolder |

이벤트(emit): 다운로드 진행(11 phase), 게임 로그/상태, 파일 변경, 런처 업데이트, **팩 업데이트 가능 알림(신규)**. 렌더러에는 `window.electronAPI` 시그니처를 유지하는 **어댑터 shim**(invoke/listen 래퍼)을 둬서 컴포넌트 수정을 최소화한다.

## 5. V2 팩 업데이트 — 스펙 확정 필요 항목 (갭)

[HYENIPACK_V2_AUTO_UPDATE.md](../HYENIPACK_V2_AUTO_UPDATE.md) 설계를 기반으로 한다. 갭 6항목은 2026-07-06 사용자 결정으로 모두 확정:

1. **팩 배포 접근 (확정)**: **Worker 경유** — 기존 mods v2 API 패턴 그대로 확장(`/api/v2/hyenipacks/<id>/latest` 등). R2 정적 public 직접 접근 안 함. rate limit·클라이언트 식별 일관성 유지
2. **체크 시점 (확정)**: 프로필 실행 전(필수) + 런처 시작 시 1회(배너)
3. **업데이트 서버 접근 불가 시 (확정)**: **기본 실행 차단 + 설정(고급)에서 강제 실행 허용**. 근거(사용자): 필수 모드가 미갱신 상태면 어차피 서버 접속이 거부되므로 사용자는 업데이트될 때까지 재시도하게 됨 — 차단이 오히려 명확한 UX. (M4 설계 시 선택적 완화 검토: 직전 성공 체크가 N시간 이내 + 미적용 업데이트 없음이면 통과시키는 grace window)
4. **breaking 플래그 UX (확정)**: breaking=true 업데이트가 존재하면 적용 전까지 실행 차단 — 위 3번의 강제 실행 설정으로도 우회 불가(3번은 "체크를 못 한" 상황용, breaking은 "비호환을 아는" 상황이라 강제 실행이 무의미). breaking=false면 "나중에" 허용
5. **v1 팩 공존**: 기존 v1 혜니팩(hyenipackId 없음)은 업데이트 체크 없이 동작 — v2 export 준비 후 재배포로 승격
6. **CF 파일 다운로드**: 매니페스트에 직링크가 없는 항목은 Worker 프록시로 resolve (API 키 은닉 유지). **제작자 측 선행(로드맵 3번)**: V2 export + Worker 팩 엔드포인트 + 업로드 스크립트(기존 wrangler 스크립트 패턴 유지 — 배포 관리 도구는 별도 P3 백로그)가 M4 테스트의 전제

## 6. 마일스톤

각 마일스톤은 독립적으로 동작 검증 가능한 상태로 끝나며, 착수 시 writing-plans 형식의 상세 플랜을 개별 작성한다.

- **M0 — 스파이크 (로드맵 4번과 동일, go/no-go 게이트)** — **구현 완료 (2026-07-06, 커밋 8d64733)**: Cargo workspace(crates/hyenimc-core + apps/launcher/src-tauri) + Tauri v2 셸(기존 Vite 렌더러 연결 + withGlobalTauri + tauri-shim) + single-instance/deep-link(hyenimc://)/updater 플러그인 배선 + 서명 키 생성(로컬 보관) + **기존 실DB in-place 읽기 실증(schema v18, 프로필 4개)**. 컴파일·테스트 검증 완료(cargo test 4/4, cargo check, 기존 vite/tsc/vitest 무손상). **잔여(사용자 일괄 테스트 시점으로 연기, 2026-07-06 방침)**: tauri dev 육안 확인·창 드래그·딥링크 런타임 수신(macOS는 번들 필요)·더미 피드 업데이트 라운드트립·Squirrel.Mac 교체 검증
- **M1 — 골격** — **구현 완료 (2026-07-06, `cafdc10`~`c6005ea`)**: hyenimc-core에 settings(global_settings KV — DB 키 매핑 예외 2개 실측 반영)/profile CRUD(이중 Option 패치, uuid v4, 인스턴스 디렉터리)/stats(profile_stats UPSERT) 모듈, Tauri 커맨드 14개(DbState=Mutex<Connection>), 어댑터 shim 정식화(profile 11·settings 2·system 2 실연결, 나머지 명시적 스텁). core 테스트 13개 + 실DB 스모크 통과. **실DB 스모크가 잡은 비호환 1건 수정**: jvm_args/game_args가 Go 판에서 JSON 배열 BLOB으로 저장됨 → NULL/TEXT/BLOB 허용 파서 + Vec<String> 모델링. 잔여(일괄 테스트): 프로필 화면 실데이터 렌더 육안 확인, 플랜: [2026-07-06-tauri-m1-skeleton.md](../superpowers/plans/2026-07-06-tauri-m1-skeleton.md)
- **M2 — 게임 파이프라인**: 다운로드 엔진(병렬/SHA1/재개/진행 이벤트), 버전 매니페스트/에셋/라이브러리, Java 감지, JVM 실행 + 로그 스트림 + 종료/크래시 감지. **바닐라 실행 성공이 완료 조건**
  - **M2a 기반 3종 완료 (2026-07-06, `3dcbdbc`~)**: hyenimc-launcher 크레이트 신설 — 다운로드 엔진(tiny_http 오프라인 테스트 4종), 매니페스트 모델+OS rules(inheritsFrom 병합, 테스트 8종), Java 감지(실기 스모크: JDK 21×3 + 17×2 발견). 플랜: [2026-07-06-tauri-m2a-foundations.md](../superpowers/plans/2026-07-06-tauri-m2a-foundations.md). 참고: Tauri 앱 패키지명 hyenimc-launcher→hyenimc-app 변경(크레이트명 충돌)
  - **M2b 완료 (2026-07-06, `73abcc8`~`1d9d811`)**: install.rs(ensure_version — 버전 json/클라이언트 jar/라이브러리+natives classifier/에셋, 오프라인 fixture 서버 통합 테스트) + natives.rs(zip 전개) + launch.rs(TS 의미 그대로의 인자 조립 순수 함수 + GameHandle spawn/로그/종료 감시) + game.rs 커맨드 7개 + 이벤트(download:progress/game:log/game:started/game:stopped) + shim `on`→Tauri listen 브리지, profile.launch 실연결. 계정은 M3 전 더미(Player). Rust 테스트 38개. 플랜: [2026-07-06-tauri-m2b-install-launch.md](../superpowers/plans/2026-07-06-tauri-m2b-install-launch.md)
  - **M2 잔여(일괄 테스트)**: 실게임 기동 육안 확인(tauri dev → 프로필 실행 → 바닐라 창). 코드 측 완료 조건은 충족
- **M3 — 계정** — **구현 완료 (2026-07-06, `923e5db`~`a154a7f`)**: core crypto(Go AES-256-GCM 스킴 바이트 호환 — **실DB 실계정 토큰 복호화 실증**, expires_at은 ms epoch로 실측 정정) + accounts 저장소, launcher auth(PKCE RFC 벡터/콜백 서버 실소켓 테스트/XBL→XSTS→MC 체인), 계정 커맨드 4개 + game_launch 실계정(자동 갱신) + shim. client_id는 option_env/런타임 env — generate-config의 Rust 산출 정식화는 M6. 플랜: [2026-07-06-tauri-m3-accounts.md](../superpowers/plans/2026-07-06-tauri-m3-accounts.md). **잔여(일괄 테스트)**: 실계정 브라우저 로그인 e2e + 실행 검증
- **M4 — 로더 + 혜니팩** — **구현 완료 (2026-07-06, `a340e10`~`b281d96`)**:
  - M4a: loader.rs — Fabric(meta profile json + maven 파생 라이브러리) / NeoForge(installer --install-client, CREATE_NO_WINDOW). game_launch가 로더별 실효 version_id 자동 설치·병합. Quilt/Forge 미지원(방침).
  - M4b: hyenipack.rs — 매니페스트(v1/v2), plan_mod_sync 선언형 동기화(manual 보존/hyenipack 소속만 제거/버전변경 재설치 — 순수 함수 집중 테스트), install_pack(CDN 다운로드+.meta.json+overrides longest-prefix 정책), Worker check/download. pack.rs 커맨드 3개 + **실행 전 게이트**(breaking 차단 우회 불가 / 서버 접근 불가 시 advanced.force_launch로만 우회). url 피닝 전제(라이브 resolve는 제작자 도구), merge 정책 keep 격하.
  - 플랜: [M4a](../superpowers/plans/2026-07-06-tauri-m4a-loaders.md) / [M4b](../superpowers/plans/2026-07-06-tauri-m4b-hyenipack.md). **잔여(일괄 테스트)**: 모드 프로필 실행 + 실 R2 팩 업/다운 e2e
- **M5 — 혜니월드 통합** — **구현 완료 (2026-07-06, `5049c42`~`01aeb15`)**: worker mods 통합 관리(registry/latest 체크 + sha256 설치 + 구버전 제거, 승인 도메인 `*.devbug.ing`/`*.devbug.me` 우선 + servers.dat 폴백 트리거) / `hyenimc://` 딥링크 인증(on_open_url + single-instance argv, MODE1 servers.dat 매칭·무조건 / MODE2 HyeniHelper 존재·기존 토큰 보존, config 포맷 TS 동일, auth:success·auth:error) / 크래시 리포트(로그 링버퍼 500줄 + zip export: latest.log·crash-reports 3개·프로필/시스템/모드 → Downloads) / 리소스·셰이더 읽기전용 리스트(팩 제공분 구분 배지 — install_pack이 .hyenipack-provided.json 기록) + notify 파일 감시 + shell(opener). 플랜: [2026-07-06-tauri-m5-hyeniworld.md](../superpowers/plans/2026-07-06-tauri-m5-hyeniworld.md). Rust 테스트 75. **잔여(일괄 테스트)**: 딥링크 실기 수신(macOS 번들)/실서버 접속 e2e/파일 감시 육안
- **M6 — 마감**: 자동 업데이트 프로덕션 구성, **기존 Electron 설치 교체 실행**(아래 전략), 테마/접근성 폴리시, QA 매트릭스 전체 회귀, 배포 파이프라인(arm64/x64/win)

### 기존 Electron 설치 교체 전략 (M0 검증 → M6 실행)

**요구(2026-07-06)**: 기존 Electron 판 사용자가 수동 제거 없이 새 배포판으로 전환 — 새 설치 시 기존 제거 또는 정식 업데이트를 통한 교체.

- **Windows (주 경로 — 정식 업데이트 교체)**: 기존 electron-updater 피드(GitHub releases의 latest.yml)에 다음 버전으로 **Tauri NSIS 설치본**을 게시 → 구버전의 electron-updater가 이를 정상 업데이트로 다운로드·실행 → Tauri NSIS pre-install 훅(NSIS_HOOK_PREINSTALL)이 electron-builder가 남긴 언인스톨 레지스트리 키(appId `me.devbug.hyeniworld.hyenimc`)를 탐지해 기존 언인스톨러를 silent 실행 → 새 버전 설치. 사용자 데이터는 보존됨(`deleteAppDataOnUninstall: false` 기설정 + `~/.hyenimc`는 언인스톨 범위 밖)
- **macOS (M0에서 검증)**: electron-updater(Squirrel.Mac)의 zip 교체가 동일 Developer ID 서명의 Tauri .app으로 동작하는지 검증. 성공 시 정식 업데이트로 .app 통째 교체. 실패 시 폴백 = **브릿지 릴리스**: 마지막 Electron 버전이 Tauri DMG 다운로드·열기 안내 + 종료 후 헬퍼 스크립트로 구 .app 자기 제거
- **공통**: Tauri 앱의 productName/번들 이름을 `HyeniMC`로 동일 유지 — 수동 재설치 경로에서도 자연 덮어쓰기

## 7. 리스크와 완화

| 리스크 | 완화 |
|---|---|
| MS OAuth 재구현 회귀 (사용자 직격) | M3에서 실계정 검증 필수. 기존 TS 구현을 명세서로 삼아 플로우 단위 대조 |
| 게임 실행 매트릭스 회귀 | QA 매트릭스: {바닐라, Fabric, NeoForge} × {1.21.x, 26.1.x} × {arm64 mac, x64 win} |
| 업데이터 전환 (서명/피드 포맷 상이) | M0에서 서명·더미 업데이트 선검증. 브릿지 릴리스로 기존 사용자 전환 경로 확보 |
| WebView 렌더링 차이 (WKWebView/WebView2) | M0 렌더러 로드에서 주요 화면 육안 점검. Chromium 전용 CSS(`WebkitAppRegion` 등) 치환 목록 이미 확보 |
| 기존 데이터 손상 | in-place 원칙 + 최초 실행 시 DB 백업 사본 생성. 읽기 실패 시 명시적 에러(silent 초기화 금지) |
| 테스트 부재 (기존 1개) | 코어 로직(매니페스트 파싱/diff, 해시, 재개, 토큰 암복호화)은 Rust 단위 테스트 필수. UI/플로우는 QA 체크리스트 |
| Rust 런처 생태계 미성숙 | 외부 크레이트에 기대지 않고 기존 TS 구현 포팅 전제 (이미 자체 구현이라 명세 완전) |

## 8. 검증 계획 (QA 체크리스트 골격)

1. 신규 설치: 프로필 생성 → 바닐라 다운로드/실행
2. 기존 사용자 업그레이드: 구 Electron 데이터 그대로 프로필/계정 인식
3. MS 로그인/로그아웃/재인증/다계정 전환
4. 혜니팩 설치 → 혜니월드 서버 접속 → HyeniHelper 자동 배포 → 딥링크 인증 → SPA/토큰 인증 통과
5. 팩 업데이트: 신버전 감지(시작 배너/실행 전) → 적용 → 모드 diff 정확성 → 사용자 추가 파일 보존
6. 리소스/셰이더 폴더 직접 조작 → 리스트 실시간 반영(파일 감시)
7. 게임 크래시 유도 → 리포트 zip 내보내기 내용물 검증
8. 런처 자동 업데이트 1회전
