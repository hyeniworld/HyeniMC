# Tauri M2b: 설치 파이프라인 + JVM 실행 + 배선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 프로필 실행 버튼이 Tauri에서 동작한다 — 버전 설치(다운로드) → JVM 인자 조립 → spawn → 로그/종료 이벤트가 렌더러까지 흐른다 (M2 완료 조건 "바닐라 실행"의 코드 측 전부; 실게임 기동 육안 확인은 일괄 테스트).

**Architecture:** hyenimc-launcher에 install(오케스트레이션)/natives(zip 추출)/launch(인자 조립+spawn+로그) 추가 → Tauri에 LaunchState(활성 프로세스 레지스트리) + 커맨드 7개 + 이벤트 emit(`download:progress`, `game:log`, `game:started`, `game:stopped` — 기존 IPC_EVENTS 이름 그대로) → shim에 Tauri 이벤트 `listen` 브리지.

**Tech Stack:** 기존 + zip crate. 테스트는 전부 오프라인(tiny_http fixture 서버, 가짜 java 스크립트).

## Global Constraints

- 레이아웃(실측): 버전 json/jar/natives = `<instance>/versions/<id>/{<id>.json, <id>.jar, natives/}`, 라이브러리 = 인스턴스 `<instance>/libraries` 우선 → 공유 `<userData>/shared/libraries` 폴백(다운로드는 공유에), 에셋 = 공유 `<userData>/shared/assets/{indexes,objects}`
- JVM 인자(TS buildJvmArguments 순서 그대로): macOS `-XstartOnFirstThread` → `-Xms/-Xmx`(min>max면 max=min 보정) → `-Djava.library.path` → `-cp <classpath>` → G1GC 튜닝 6종 → 매니페스트 jvm 인자(rules 평가, `${natives_directory}`/`${classpath}`/`-cp` 중복 스킵, `${library_directory}`=인스턴스 libraries, `${classpath_separator}`, `${version_name}`, launcher_name=HyeniMC) → mainClass
- 게임 인자 치환 테이블(TS와 동일): auth_player_name/version_name/game_directory/assets_root/assets_index_name/auth_uuid/auth_access_token(기본 "null")/user_type(기본 legacy)/version_type/user_properties="{}"/clientid/auth_xuid/resolution_width(854)/height(480) + quickPlay 4종 인자쌍 필터 + fullscreen 플래그
- 클래스패스: 라이브러리(rules 통과분; artifact.path 또는 maven 이름 파생 경로) + 마지막에 클라이언트 jar. 누락 라이브러리는 url(maven 베이스) 있으면 공유에 다운로드 시도
- 이벤트 이름은 기존 렌더러 리스너와 동일: `download:progress`/`game:log`/`game:started`/`game:stopped`
- 실행 종료 시 record_play_time(경과 초) + 크래시(비0 종료)면 record_crash — M1 stats 재사용
- 브랜치 `feat/tauri-m0`, 커밋 `feat(tauri): ...`

---

### Task 1: natives 추출 (natives.rs)

**Interfaces:** `fn native_classifier_key() -> &'static str` ("osx"/"windows"/"linux"), `fn extract_natives(version_dir: &Path, jars: &[PathBuf]) -> Result<PathBuf, LauncherError>` — `<version_dir>/natives`에 zip 전개(META-INF 제외), 반환=natives 디렉터리

**Steps:** zip crate(workspace deps 추가) → 테스트: 임시 zip(파일 2 + META-INF 1) 만들어 추출 후 META-INF 부재 확인(RED→GREEN) → 커밋 `feat(tauri): natives 추출`

핵심 구현:

```rust
pub fn extract_natives(version_dir: &Path, jars: &[PathBuf]) -> Result<PathBuf, LauncherError> {
    let natives_dir = version_dir.join("natives");
    std::fs::create_dir_all(&natives_dir)?;
    for jar in jars {
        let file = std::fs::File::open(jar)?;
        let mut zip = zip::ZipArchive::new(file).map_err(|e| LauncherError::Other(e.to_string()))?;
        for i in 0..zip.len() {
            let mut entry = zip.by_index(i).map_err(|e| LauncherError::Other(e.to_string()))?;
            let name = entry.name().to_string();
            if name.starts_with("META-INF") || name.ends_with('/') { continue; }
            let out = natives_dir.join(&name);
            if let Some(p) = out.parent() { std::fs::create_dir_all(p)?; }
            let mut f = std::fs::File::create(&out)?;
            std::io::copy(&mut entry, &mut f)?;
        }
    }
    Ok(natives_dir)
}
```

### Task 2: 설치 오케스트레이션 (install.rs)

**Interfaces:**
- `GameDirs{instance_dir: PathBuf, shared_libraries: PathBuf, shared_assets: PathBuf}` + `impl GameDirs { fn version_dir(&self, id) -> PathBuf; fn version_json(&self, id); fn client_jar(&self, id) }`
- `InstallPhase` enum: `VersionJson|Libraries|Assets|Finalize` (serde 소문자) — 진행 이벤트 payload `{phase, completed, total, currentFile}`
- `async fn ensure_version(client, version_summary_url: &str, version_id: &str, dirs: &GameDirs, cfg: &DownloadConfig, on_progress) -> Result<VersionDetail, LauncherError>` — ① 버전 json 다운로드/저장(이미 있으면 로컬 읽기 + inheritsFrom이면 부모도 ensure 후 병합) ② client jar ③ rules 통과 라이브러리 전부(artifact + natives classifier 대상 포함)를 공유 libraries에 ④ asset index 저장 후 objects를 `objects/<h2>/<hash>`로 (전부 download_all 재사용)
- `fn native_jars_for(detail: &VersionDetail, dirs: &GameDirs) -> Vec<PathBuf>` — classifier 방식 natives jar 경로 목록 (Task 4의 추출 입력)

**Steps:** 오프라인 통합 테스트 — tiny_http로 version json + client.jar + 라이브러리 1 + asset index(1 object) fixture 서빙 → ensure_version 후 파일 존재/SHA 검증(RED→GREEN) → 커밋 `feat(tauri): 버전 설치 파이프라인`

### Task 3: 인자 조립 + spawn (launch.rs)

**Interfaces:**
- `LaunchSpec{profile_id, version_id, java_path, min_memory_mb, max_memory_mb, username, uuid, access_token: Option<String>, user_type: Option<String>, resolution: Option<(u32,u32)>, fullscreen: bool}`
- `fn build_arguments(detail: &VersionDetail, spec: &LaunchSpec, dirs: &GameDirs, natives_dir: &Path, classpath: &str) -> Vec<String>` — **순수 함수** (Global Constraints의 순서/치환 그대로)
- `fn build_classpath(detail: &VersionDetail, dirs: &GameDirs) -> (String, Vec<String>)` — (classpath 문자열, 누락 라이브러리 이름들)
- `fn maven_relative_path(name: &str) -> Option<String>` — "g.r.o:artifact:ver" → "g/r/o/artifact/ver/artifact-ver.jar"
- `pub struct RunningGame{pub profile_id: String, pub version_id: String, pub started_at: Instant}` + `async fn spawn_game(java: &str, args: &[String], cwd: &Path, on_log: impl FnMut(String)+Send+'static, on_exit: impl FnOnce(Option<i32>)+Send+'static) -> Result<tokio::process::Child, LauncherError>` — stdout/stderr 라인 스트림 태스크 + exit 감시 태스크

**Steps:**
1. 순수 함수 테스트(RED): fixture VersionDetail(M2a의 DETAIL_FIXTURE 재사용)로 macOS에서 `-XstartOnFirstThread` 선두, `-Xms1024M/-Xmx4096M`, min>max 보정, `${auth_player_name}` 치환, quickPlay 필터, maven_relative_path 3케이스
2. 구현 → GREEN
3. spawn 테스트: 가짜 java(임시 sh 스크립트 — 2줄 출력 후 exit 3) → 로그 2줄 수신 + exit code 3 수신
4. 커밋 `feat(tauri): JVM 인자 조립 + spawn/로그 스트림`

### Task 4: Tauri 배선 + shim 이벤트 브리지

**Files:** `apps/launcher/src-tauri/src/game.rs`(신규 — LaunchState + 커맨드 7), main.rs(등록), `src/renderer/tauri-shim.ts`(game/version/java 실연결 + `on` 브리지)

**Interfaces (커맨드):** `java_detect`, `version_list_minecraft`(매니페스트 fetch → [{id,type}]), `game_download_version{profile_id}`(프로필 버전 ensure_version, `download:progress` emit), `game_launch{profile_id, account_id?}`(프로필+전역설정 병합 → LaunchSpec(계정 M3 전 더미: Player/영UUID/null 토큰) → ensure→natives→classpath→args→spawn, record_launch, `game:started` emit, 로그를 `game:log`로, 종료 시 `game:stopped` + record_play_time/record_crash), `game_stop{profile_id}`(kill), `game_is_running{profile_id}`, `game_get_active`

**shim 브리지:**

```typescript
const listeners = (window as any).__TAURI__.event;
api.on = (event: string, cb: (data: unknown) => void) => {
  const p = listeners.listen(event, (e: { payload: unknown }) => cb(e.payload));
  return () => { p.then((un: () => void) => un()); };
};
```
game/version/java 카테고리를 스텁 목록에서 제거하고 실연결. `profile.launch` → `invoke('game_launch', {profileId, accountId})`.

**Steps:** 구현 → `cargo check` + `npm run build` + vitest 회귀 → 커밋 `feat(tauri): 게임 실행 커맨드/이벤트 배선 + shim 브리지`

### Task 5: 마감

- 전체 검증(cargo test --workspace / check / npm build / vitest) + 설계 문서 M2 완료(일괄 테스트 잔여: 실게임 기동 육안) + 운영 파일 갱신 + 커밋

## Self-Review 결과

- 커버리지: game IPC 7핸들러 전부 대응(GAME_GET_VERSION_DETAILS/CHECK_INSTALLED는 ensure/exists로 흡수 — shim에서 매핑), 밸리데이터(431줄)는 **의도적 보류**(M2 최소: Rust 쪽 명시적 에러로 대체, 상세 검증 UX는 M6 폴리시), 크래시 버퍼 500줄은 M5 크래시 리포트에서.
- 계정 더미: M3 전까지 오프라인 스타일(username=Player, accessToken="null") — TS 기본값과 동일 경로.
- 타입 일관성: InstallPhase/이벤트 payload camelCase, LaunchSpec ↔ game_launch 매핑 대조 완료.
