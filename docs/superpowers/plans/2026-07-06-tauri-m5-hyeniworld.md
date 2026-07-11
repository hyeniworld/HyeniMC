# Tauri M5: 혜니월드 통합 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (인라인 기확정). Steps use checkbox syntax.

**Goal:** worker mods 자동 관리(C1+C2 통합) + `hyenimc://` 딥링크 인증 + 크래시 리포트 수집·전달 + 리소스/셰이더 읽기전용 리스트 + 파일 감시 + shell — 혜니월드 전용 통합 전부.

**실측 확정치 (TS 대조 완료):**
- Worker API: registry `/api/v2/mods`, latest `/api/v2/mods/<id>/latest`, 다운로드 `/download/v2/mods/<id>/versions/<ver>/<loader>/<gameVersion>/<file>?token=<urlencoded>` (sha256 제공 — 검증 필수)
- 로컬 버전 감지: mods/에서 modId 프리픽스 jar 파일명 파싱(마지막 x.y.z), 업데이트 판정 = 원격이 더 최신일 때만(다운그레이드 없음). 설치 시 구버전 파일 제거
- 트리거: profile.server_address가 승인 도메인(`*.devbug.ing`, `*.devbug.me` — server-config.ts)일 때만. 미승인 = 빈 배열(TS 의미)
- preload 계약: `workerMods.checkUpdates(profilePath, gameVersion, loaderType, serverAddress?)` / `installMultiple(profilePath, updates[])` — **profilePath 기반이라 커맨드도 그대로 받으면 DB 불필요**. 이벤트 `worker-mods:install-progress` {modId, progress}
- 딥링크: `hyenimc://auth?token=X&server=A,B` — MODE1(server 있음): servers.dat(비압축 NBT, servers[].ip)에 해당 주소가 있는 프로필에 config 무조건 기록 / MODE2(없음): mods/에 hyenihelper*.jar 있는 프로필에 config 없거나 token 비었을 때만. config = `config/hyenihelper-config.json` `{token, enabled:true, timeoutSeconds:10, serverStatusPort:4444, authPort:35565, serverStatusInterval:180}`. 이벤트 `auth:success` {servers, token} / `auth:error`
- 파일 감시: preload `fileWatcher.start(profileId, gameDirectory)/stop(profileId)`, 이벤트 `file:changed` {profileId, ...}
- Windows 원칙: 감시/zip/NBT 전부 플랫폼 중립, launcher 크레이트 Windows 타깃 check 포함

**Tasks:**
1. **T1 launcher/workermods.rs**: 타입(registry/latest serde) + `parse_mod_version`(파일명→버전, 4패턴 테스트) + `is_newer_version`(x.y.z 숫자 비교) + `check_all_updates(http, base, mods_dir, game_version, loader_type) -> Vec<WorkerModUpdate>`(camelCase — 렌더러 useWorkerModUpdates 필드: modId/modName/currentVersion/latestVersion/isInstalled/category/changelog) + `install_updates(..., token, on_progress)`(sha256 DownloadTask + 구버전 제거). 오프라인 테스트(fixture 서버)
2. **T2 launcher/hyeni.rs**: `servers_dat_contains(path, address)`(fastnbt — 비압축, gzip 폴백) + `write_hyenihelper_config(game_dir, token, overwrite)`(정확 포맷, MODE2 의미: overwrite=false면 기존 token 있으면 스킵) + `has_hyenihelper(mods_dir)`. deps: fastnbt, flate2. fixture NBT 테스트
3. **T3 app/hyeni.rs + 딥링크**: 커맨드 `worker_mods_check(profile_path, game_version, loader_type, server_address?)`(승인 도메인 순수 함수+테스트) / `worker_mods_install(profile_path, updates, account_id?)`(토큰 = account_id 또는 last_used 계정, progress emit) — shim workerMods 실연결. main.rs deep_link on_open_url + single-instance argv에서 `hyenimc://auth` 파싱 → handle_auth(MODE1/2, 전 프로필 DB 순회) → `auth:success`/`auth:error` emit
4. **T4 app 크래시 리포트 + 팩 리스트 + 감시 + shell**: GameState에 로그 링버퍼(프로필당 500줄, 종료 후 보존) + `crash_export_report(profile_id)`(zip: 로그 버퍼 + `logs/latest.log` + `crash-reports/` 최신 3개 + 프로필 메타 JSON + OS/메모리 정보 → 다운로드 폴더, 경로 반환) + `crash_open_logs(profile_id)`(opener) / `resourcepack_list`/`shaderpack_list(profile_id)` → [{fileName, size, providedByPack}] — PackInstallMeta에 overrides 파일 목록 추가(serde default로 기존 메타 호환, install 시 기록) / notify 감시 `file_watch_start/stop` + `file:changed` emit / shim shell.openPath·openExternal → `plugin:opener|*` invoke + capabilities 권한 추가
5. **T5 마감**: 전체 검증(+Windows 타깃) + 설계 문서/운영 파일

**의도된 보류:** hyeni-updater(구 /api/mods 단일 모드 경로)는 registry 기반으로 흡수 — 별도 포팅 안 함(C1+C2 통합 결정). 게임 시작 시 자동 worker mods 업데이트(TS의 launch 내 자동 경로)는 렌더러 훅이 이미 체크/설치 UI를 제공하므로 M5에서는 수동 흐름까지, launch 자동 통합은 M6 폴리시에서 판단.
