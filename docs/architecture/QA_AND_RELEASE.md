# HyeniMC Tauri 사용자 런처 — QA 매트릭스 & 배포 (M6)

> Phase 1(M0~M5) 코드 완료 후 일괄 테스트/배포 가이드. Windows가 일반 사용자 1순위(설계 §1.5).

## 실행 방법 (개발)

```bash
npm run dev:tauri     # 개발 실행 (vite 5173 + Rust 앱, 핫리로드)
npm run build:tauri   # 배포 번들 (arm64/x64 dmg + nsis)
```

- `AZURE_CLIENT_ID`/`HYENIMC_WORKER_URL`은 빌드 시 `.env`에서 자동 주입(build.rs). dev 실행 시에도 주입됨.
- 기존 Electron 판(`npm run dev`)과 동시 실행 비권장(같은 SQLite 공유).

## QA 매트릭스 (일괄 테스트 — 사용자 진행)

우선순위: **Windows > macOS**. 각 항목 [ ]=미검증, [x]=검증 완료.

> **진행 현황 (2026-07-11, Windows 검증)**: A·B 전체 + C(breaking 제외) + D(크래시 리포트 제외) 완료. **남은 것**: C의 breaking 업데이트(적용 전 차단), D의 크래시 리포트 export, **E 전체**(자동 업데이트 — updater 서버/릴리스 구성 후 GitHub Action 실행 필요). F(이식 완결 검증)는 별도 미착수.

### A. 코어 (플랫폼 공통) — ✅ 완료 (2026-07-11)
- [x] 앱 기동 → 기존 프로필 목록이 실데이터로 표시 (`[db] legacy DB connected`)
- [x] 전역 설정 로드/저장 (메모리 슬라이더, Java 경로, 해상도)
- [x] 프로필 생성(커스텀 탭만 보임 — 온라인/파일 탭 숨김 확인) → 삭제 → 즐겨찾기
- [x] MS 로그인(시스템 브라우저 → 콜백) → 계정 목록 → 재인증(만료 자동 갱신)

### B. 게임 실행 매트릭스 {바닐라, Fabric, NeoForge} × {Windows x64, macOS arm64} — ✅ 완료 (2026-07-11)
- [x] 바닐라 다운로드(진행률 모달) → 실행 → 창 표시
- [x] Fabric 프로필 실행 (로더 자동 설치, **부모 jar 클래스패스** — G8)
- [x] NeoForge 프로필 실행 (installer 자동 실행, 콘솔 창 안 뜸 — Windows)
- [x] 게임 로그 스트림 표시 / 종료 시 플레이타임 기록
- [x] Java 자동 감지 (Windows: ProgramFiles 벤더 폴더/JAVA_HOME)

### C. 혜니팩 & 업데이트 — ⚠️ breaking 업데이트만 미검증
- [x] 혜니팩 import → 모드 설치(url 피닝분 다운로드 + zip 동봉분 추출) → overrides 적용
- [x] 팩 업데이트: 신버전 감지(실행 전/시작 배너) → 적용 → 모드 diff 정확 → 사용자 파일 보존
- [ ] breaking 업데이트 시 적용 전 실행 차단(강제 불가) / **Worker 접근 불가 시 [강제 실행]/[닫기] 다이얼로그**(설정 토글 아님)
- [x] worker mods 자동 관리 (혜니월드 서버 프로필에서만 체크, sha256 설치)

### D. 혜니월드 통합 — ⚠️ 크래시 리포트만 미검증
- [x] `hyenimc://auth?token=…&server=…` 딥링크 → servers.dat 매칭 프로필에 config 기록 (Windows/macOS 번들)
- [x] 리소스/셰이더팩 리스트 (팩 제공분/사용자 추가분 구분 배지) + 폴더 열기 + 파일 감시 반영
- [ ] 크래시 리포트 export (Downloads에 zip — Windows USERPROFILE 경로 확인) + 로그 폴더 열기

### E. 자동 업데이트 & 교체 설치 — ⚠️ Windows 교체 설치 완료, 자동 업데이트(E.1)·macOS 남음
- [ ] 런처 업데이트 확인/다운로드/설치 (updater 서버/릴리스 구성 후 — 태그 push → release-launcher.yml)
- [x] **Windows**: 기존 Electron 판 위에 Tauri NSIS 설치 → 기존 판 자동 제거 + 데이터 보존 (installer-hooks.nsh) — **검증 완료 2026-07-11**. electron-builder 언인스톨 키가 appId 문자열이 아니라 GUID(`85ce1611-…`, appId에서 계산·버전 무관)라 초기 훅이 못 찾던 버그 수정. v0.1.0~0.3.4 전 버전 동일 appId → 모두 커버.
- [ ] **macOS**: Squirrel.Mac zip 교체 검증 (동일 Developer ID) / 실패 시 브릿지 릴리스

> **Electron 인앱 자동 업데이트(electron-updater) → Tauri 브릿지는 별도 과제(설계 §6, 미구현)**: Electron은 `latest.yml`을, Tauri 릴리스는 `latest.json`만 생성. 실서비스 전환 때 마지막 Electron 릴리스에 `latest.yml`+Tauri 설치 유도가 필요. E.1/E.2 검증엔 무관.

### F. Electron→Tauri 이식 완결 & 감사 정정 검증 (2026-07-08 세션)

전수 대조 감사 + 검증 감사로 잡은 누락/회귀 정정분. 위 A~E와 중복되는 큰 흐름 외 세부 확인.

**프로필 설정 반영**
- [ ] 프로필별 메모리/해상도 오버라이드 저장 → 재로드 시 유지 → 실행에 반영(전역과 별개, 0=전역 상속)
- [ ] 커스텀 JVM 인자를 비운 뒤 저장 → 정상 실행(`__CLEAR_JVM_ARGS__` 마커 미주입)
- [ ] 실행 전 검증: 최대 메모리를 시스템 90% 초과로 → 실행 시 차단 다이얼로그 **[닫기]/[설정 열기]**(설정 이동)
- [ ] 잘못된 Java 경로 → 차단 다이얼로그; Java 미설치 → **[Java 설치 안내]**(브라우저)
- [ ] min>max 메모리 → 자동 보정(max=min)되어 실행

**모드 메타 통합**
- [ ] Electron으로 설치한 혜니팩 프로필을 Tauri에서 팩 업데이트 → **중복 모드 없이** 정상(통합 `.hyenimc-metadata.json`)
- [ ] 모드 목록 출처(source)가 재파싱 후에도 유지

**이벤트·UI**
- [ ] 런처 업데이트: 새 릴리스 시 **배너 표시** / 설정 '자동 다운로드' 켜면 발견 즉시 자동 다운로드
- [ ] 모드/리소스팩/셰이더팩 추가·삭제 시 **목록 자동 새로고침**(디바운스 — 대량 추가 시 폭주 없음)
- [ ] 리소스팩 **"Format N"**·설명·아이콘 표시 / 비활성(`.disabled`) 팩도 목록에 표시(enabled:false)
- [ ] 캐시 통계 표시 + 전체 삭제(실행 중이면 차단) — 대상 `<userData>/shared`(에셋/라이브러리)
- [ ] 게임 비정상 종료 → **원인 진단 다이얼로그**(메모리/모드충돌/그래픽/파일손상) + crash-report 없으면 로그 폴백

**프로필 생명주기**
- [ ] 게임 실행 중 삭제 버튼 비활성화 + 백엔드 차단
- [ ] 삭제 실패(파일 사용 중) → **'삭제 실패'** 상태 표시 + 재삭제 가능(NotFound은 성공 취급)
- [ ] 시작 시 'installing'으로 잠긴 프로필 → 'incomplete'로 해제

**워커 모드**
- [ ] 서버 미등록 프로필에서도 **기설치** 워커 모드 업데이트 확인됨
- [ ] 워커 모드 설치 성공 시 '실패' 토스트 안 뜸 / 일부 실패해도 나머지 설치(per-mod 결과)
- [ ] 로더 버전 불호환 모드는 실행 전 자동 업데이트에서 제외
- [ ] 딥링크 MODE1: servers.dat 매칭 **+ HyeniHelper 설치** 프로필에만 config 기록

**팩/모드 강제 실행 (오늘 신규)**
- [ ] Worker 접근 불가 시 실행 → **[강제 실행]/[닫기]** 안내 다이얼로그. 강제 시 진행, 닫기 시 대기
- [ ] breaking 업데이트는 강제 없이 차단(업데이트 안내)

**경로**
- [ ] 설정 게임 디렉터리 '기본값' 버튼 → OS 네이티브 문서 경로(Windows OneDrive 이동/한국어 로케일 `~/문서` 정확)

## 배포 파이프라인 (M6 잔여 — 인프라 결정 필요)

1. **updater 서버**: tauri.conf.json의 `endpoints`는 **GitHub Releases**(`github.com/hyeniworld/HyeniMC/releases/latest/download/latest.json`) — Electron판(electron-updater)과 동일 서버. 릴리스 전엔 404→조용히 no-update. 실동작하려면 릴리스에 **`latest.json`(Tauri 서명 포맷) + 서명된 번들**을 asset으로 업로드해야 함. 서명 키는 `~/.tauri/hyenimc.key`(비번 없음 — **프로덕션 전 재생성 검토**). electron-updater의 `latest.yml`과 공존 가능(다른 파일).
2. **코드 서명**: Windows(Authenticode)/macOS(Developer ID + notarization) — 교체 설치/Gatekeeper에 필수.
3. **번들 산출**: `npm run build:tauri` → arm64/x64 dmg + nsis. universal은 제외(경정리 방침).
4. **브릿지 릴리스**: 기존 Electron 사용자를 Tauri로 넘기는 마지막 electron-updater 릴리스(설계 §6).

## 알려진 보류 (M6+)
- 경로 대소문자 이원화(hyenimc/HyeniMC) — Linux만 위험(비주력)
- 스텁 잔여: mod/modpack/hyeni/fs — **제작자 전용 기능**이라 사용자 런처 UI에서 진입점 숨김(isCreatorMode), 커맨드는 no-op 스텁. (errorDialog·dialog.selectFile·settings 캐시/내보내기·onShowErrorDialog는 실구현 완료)
- 모드 검색/설치·의존성 자동설치·온라인 모드팩(CurseForge) 검색/설치는 미이식 — 제작자 도구(Electron) 전용, 사용자 런처 비대상
- generate-config의 server-config.ts(AUTHORIZED_SERVER_DOMAINS)는 Rust hyeni.rs에 하드코딩 — 동기화 필요 시 build.rs 확장
