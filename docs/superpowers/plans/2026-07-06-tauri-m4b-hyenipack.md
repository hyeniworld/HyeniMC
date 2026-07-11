# Tauri M4b: 혜니팩 설치 + V2 업데이트 엔진 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (인라인). Steps use checkbox syntax.

**Goal:** 혜니팩(.hyenipack) import 설치 + V2 팩 자동 업데이트(선언형 모드 동기화 + override 정책 + breaking 차단 + 서버 접근 불가 시 실행 차단) 엔진.

## Global Constraints (확정)
- 모드 매니페스트 엔트리: `{id?,name?,source(modrinth|curseforge|hyeniworld|url|local),projectId?,fileId?,fileName,url?,sha256?,sha1?,size?}`. url 없으면 MR/CF resolve(**M4b는 url 피닝 전제 — resolve는 제작자 도구 몫, 사용자 런처는 url 필수. url 없는 엔트리는 에러**)
- CF url은 Worker 프록시 경유 다운로드(토큰 헤더). MR/hyeniworld/url은 직접
- `.meta.json`(모드 jar 옆): `{source, sourceModId, sourceFileId, versionNumber, installedAt, installedFrom, modpackId, modpackVersion}` — installedFrom='hyenipack'이 관리 대상 표식, 'manual'은 보존
- 선언형 동기화: 매니페스트에 있으면 설치, 매니페스트에서 사라진 **hyenipack 소속 모드만** 삭제(manual 보존). matchesMod = source+projectId 일치(projectId 없으면 fileName)
- override 정책: overrides/ ZIP 내용을 policy(keep/replace/merge→keep 취급)로 instanceDir에 적용. Longest-prefix-match, 기본 keep
- V2 업데이트: 프로필 `.hyenipack-meta.json`(hyenipackId+version 저장) → Worker `/api/v2/modpacks/<id>/latest` 조회 → version 상이 시 업데이트. **breaking=true면 적용 전 실행 차단(우회 불가), 서버 접근 불가면 기본 차단 + 설정 force_launch로 우회**
- 체크 시점: 런처 시작 배너(무거운 자동 X, 정보만) + 프로필 실행 전(필수 게이트)
- Worker base URL: `HYENIMC_WORKER_URL` env → 기존 config 값. 토큰 = 계정 MC access_token(다운로드 검증용 — 기존 downloadFile 방식)
- Windows: launcher 크레이트 타깃 check

## Tasks

### T1: hyenipack 매니페스트 모델 + .meta.json (launcher `hyenipack.rs`)
- `PackManifest{format_version, hyenipack_id: Option, name, version, minecraft{version,loader_type,loader_version}, mods: Vec<PackMod>, overrides: Vec<OverridePolicy>, breaking}` (v1/v2 공용 — v1은 hyenipack_id None), `PackMod{file_name, source, project_id, file_id, url, sha256, sha1, size}`, `OverridePolicy{path, policy}`
- `ModMeta{...}` + `read_mod_meta(path)/write_mod_meta(path, &meta)`, `find_policy(rel_path, &[OverridePolicy]) -> Policy` (longest-prefix, 기본 keep)
- `PackInstallMeta{hyenipack_id, version}` + `read/write_pack_meta(instance_dir)`
- 테스트: v1/v2 매니페스트 파싱, find_policy cascading, meta roundtrip, matches_mod

### T2: 선언형 동기화 엔진 (`hyenipack.rs` 계속)
- `plan_mod_sync(existing: &[(fileName, ModMeta)], target: &[PackMod]) -> ModSyncPlan{to_install: Vec<PackMod>, to_remove: Vec<String>, to_keep}` — **순수 함수**(핵심 — 집중 테스트): 매니페스트에 없는 hyenipack 모드 삭제(manual 보존), 신규/버전변경 설치
- 테스트: manual 보존 / hyenipack 소속 제거 / 버전 변경 재설치 / 신규 설치

### T3: 설치/업데이트 실행 (`hyenipack.rs` 계속)
- `install_pack(http, pack_zip_or_manifest, dirs, cfg, token, on_progress) -> Result`: 매니페스트 읽기 → sync plan → 모드 다운로드(sha256 우선, CF는 worker 프록시)+.meta.json 기록 → 삭제 대상 제거 → overrides 적용(zip 내 overrides/) → pack_meta 기록. 로더/게임 버전은 프로필에 반영(호출측)
- `check_pack_update(http, worker_base, instance_dir) -> Option<PackUpdate{current, latest, breaking, download_url}>`
- 테스트: install_pack 오프라인(fixture manifest + fixture mod 서버), overrides 적용 검증

### T4: Tauri 배선 + 실행 전 게이트
- 커맨드: `hyenipack_import{profile_id, file_path}`(로컬 .hyenipack), `pack_check_update{profile_id}`, `pack_apply_update{profile_id, account_id?}`
- game_launch 실행 전 게이트: pack_meta 있으면 check_update → breaking이면 차단(에러) / 업데이트 있으나 non-breaking이면 진행 허용(배너는 렌더러) / 서버 접근 불가면 settings.force_launch 없으면 차단. force_launch는 global_settings 신규 키(기본 false)
- shim: hyenipack 카테고리 실연결(import/checkUpdate/applyUpdate)

### T5: 마감 — 전체 검증(+Windows) + 문서/운영

## Self-Review
- **범위 축소**: 사용자 런처는 **url 피닝된 v2 팩 전제** — MR/CF 라이브 resolve는 제작자 도구(Electron)에 있으므로 제외. url 없는 엔트리는 명시적 에러(제작자가 export 시 피닝).
- override merge 정책은 keep으로 격하(JSON 병합은 복잡도 대비 가치 낮음 — 백로그).
- 실팩 e2e(실제 R2 배포 + 접속)는 일괄 테스트. 오프라인은 fixture 서버.
- force_launch 설정 키는 M1 GlobalSettings에 없음 → download/java 등과 같은 레벨에 추가(하위호환: 기본 false).
