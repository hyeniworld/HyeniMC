# Tauri M4a: 모드로더 설치 (Fabric/NeoForge) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (인라인 기확정). Steps use checkbox syntax.

**Goal:** 프로필 loader_type이 fabric/neoforge면 game_launch가 로더를 자동 설치하고 로더 버전으로 실행한다 (M2의 inheritsFrom 병합/클래스패스/인자 조립 재사용).

**실측 확정치:**
- Fabric: `https://meta.fabricmc.net/v2/versions/loader/<game>` (목록, [{loader:{version,stable}}]) / `.../<game>/<loader>/profile/json` (버전 json, id=`fabric-loader-<l>-<g>`, inheritsFrom=<game>). 라이브러리는 downloads 없이 name+url(maven 베이스) — maven 경로 파생 다운로드(sha 없음), 폴백 저장소 maven.fabricmc.net → maven central
- NeoForge: 버전 목록 `https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml`(<version> 태그 정규식 추출), MC `1.<maj>.<min>` ↔ neoforge `<maj>.<min>.*` 매핑. 설치 = installer jar 다운로드(`.../neoforge-<v>/neoforge-<v>-installer.jar`) → **launcher_profiles.json 생성 후** `java -jar installer --install-client <instance_dir>` (versions/`neoforge-<v>`/ + libraries/를 인스턴스에 생성 — 기존 레이아웃 일치, 클래스패스가 인스턴스 libraries 우선이라 그대로 동작)
- game_launch: 로더 프로필이면 ① 베이스 게임 ensure_version ② 로더 버전 json 없으면 설치 ③ version_id = 로더 id로 인자/클래스패스 (load_version_detail이 병합)
- Windows 원칙: installer spawn에 CREATE_NO_WINDOW, launcher 크레이트 Windows 타깃 check

**Tasks:**
1. `loader.rs` (launcher 크레이트): `fabric_loader_versions(http, game)` / `install_fabric(http, game, loader, dirs, cfg) -> version_id` / `neoforge_versions(http)` + `neoforge_versions_for(mc_version)` 필터(순수) / `install_neoforge(http, version, java, dirs) -> version_id` / `fabric_version_id`/`neoforge_version_id`(순수). 테스트: 버전 id 조립·MC 매핑 필터·maven-metadata 파싱·fabric 프로필 json fixture 파싱(전부 오프라인)
2. game.rs 통합: loader_type별 version_id 결정 + 자동 설치, `loader_get_versions` 커맨드 + shim(loader 카테고리 실연결)
3. 마감: 전체 검증(+Windows 타깃) + 문서/운영 파일

**의도된 보류:** Quilt(제거 확정), Forge(레거시 — 기존 프로필에 없음), NeoForge 설치 진행 이벤트(설치 로그는 game:log로만).
