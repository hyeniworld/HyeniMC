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

우선순위: **Windows > macOS**. 각 항목 [ ]=미검증.

### A. 코어 (플랫폼 공통)
- [ ] 앱 기동 → 기존 프로필 목록이 실데이터로 표시 (`[db] legacy DB connected`)
- [ ] 전역 설정 로드/저장 (메모리 슬라이더, Java 경로, 해상도)
- [ ] 프로필 생성(커스텀 탭만 보임 — 온라인/파일 탭 숨김 확인) → 삭제 → 즐겨찾기
- [ ] MS 로그인(시스템 브라우저 → 콜백) → 계정 목록 → 재인증(만료 자동 갱신)

### B. 게임 실행 매트릭스 {바닐라, Fabric, NeoForge} × {Windows x64, macOS arm64}
- [ ] 바닐라 다운로드(진행률 모달) → 실행 → 창 표시
- [ ] Fabric 프로필 실행 (로더 자동 설치, **부모 jar 클래스패스** — G8)
- [ ] NeoForge 프로필 실행 (installer 자동 실행, 콘솔 창 안 뜸 — Windows)
- [ ] 게임 로그 스트림 표시 / 종료 시 플레이타임 기록
- [ ] Java 자동 감지 (Windows: ProgramFiles 벤더 폴더/JAVA_HOME)

### C. 혜니팩 & 업데이트
- [ ] 혜니팩 import → 모드 설치(url 피닝분 다운로드 + zip 동봉분 추출) → overrides 적용
- [ ] 팩 업데이트: 신버전 감지(실행 전/시작 배너) → 적용 → 모드 diff 정확 → 사용자 파일 보존
- [ ] breaking 업데이트 시 적용 전 실행 차단 / 서버 접근 불가 시 강제 실행 설정
- [ ] worker mods 자동 관리 (혜니월드 서버 프로필에서만 체크, sha256 설치)

### D. 혜니월드 통합
- [ ] `hyenimc://auth?token=…&server=…` 딥링크 → servers.dat 매칭 프로필에 config 기록 (Windows/macOS 번들)
- [ ] 리소스/셰이더팩 리스트 (팩 제공분/사용자 추가분 구분 배지) + 폴더 열기 + 파일 감시 반영
- [ ] 크래시 리포트 export (Downloads에 zip — Windows USERPROFILE 경로 확인) + 로그 폴더 열기

### E. 자동 업데이트 & 교체 설치
- [ ] 런처 업데이트 확인/다운로드/설치 (updater 서버 구성 후)
- [ ] **Windows**: 기존 Electron 판 위에 Tauri NSIS 설치 → 기존 판 자동 제거 + 데이터 보존 (installer-hooks.nsh)
- [ ] **macOS**: Squirrel.Mac zip 교체 검증 (동일 Developer ID) / 실패 시 브릿지 릴리스

## 배포 파이프라인 (M6 잔여 — 인프라 결정 필요)

1. **updater 서버**: tauri.conf.json의 `endpoints`는 **GitHub Releases**(`github.com/hyeniworld/HyeniMC/releases/latest/download/latest.json`) — Electron판(electron-updater)과 동일 서버. 릴리스 전엔 404→조용히 no-update. 실동작하려면 릴리스에 **`latest.json`(Tauri 서명 포맷) + 서명된 번들**을 asset으로 업로드해야 함. 서명 키는 `~/.tauri/hyenimc.key`(비번 없음 — **프로덕션 전 재생성 검토**). electron-updater의 `latest.yml`과 공존 가능(다른 파일).
2. **코드 서명**: Windows(Authenticode)/macOS(Developer ID + notarization) — 교체 설치/Gatekeeper에 필수.
3. **번들 산출**: `npm run build:tauri` → arm64/x64 dmg + nsis. universal은 제외(경정리 방침).
4. **브릿지 릴리스**: 기존 Electron 사용자를 Tauri로 넘기는 마지막 electron-updater 릴리스(설계 §6).

## 알려진 보류 (M6+)
- 경로 대소문자 이원화(hyenimc/HyeniMC) — Linux만 위험(비주력)
- 스텁 잔여: mod/modpack/hyeni/dialog/fs/errorDialog — 사용자 런처 UI에서 진입점 숨김 완료, 커맨드는 no-op 스텁
- generate-config의 server-config.ts(AUTHORIZED_SERVER_DOMAINS)는 Rust hyeni.rs에 하드코딩 — 동기화 필요 시 build.rs 확장
