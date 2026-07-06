# 전체 리뷰 (M0~M4) — 1차: preload↔shim/이벤트 계약 축

> M4b 리뷰에서 계약 불일치가 다발해(9건 중 4건), 같은 축을 전 마일스톤에 확장 적용한 결과.
> 진행 상태: **1차(계약 축) 완료 — 발견 7건.** 2차(Rust 내부 의미론 심층)는 미착수 — 아래 "2차 계획" 참조.

## 1차 발견 (증거는 각 항목의 파일:라인)

| # | 심각도 | 내용 | 상태 |
|---|---|---|---|
| G1 | High | `game:started` payload의 versionId에 로더 버전 id를 넣음 — 렌더러(ProfileList.tsx:48-57)는 Electron 의미(processKey=**profileId**)로 러닝/launching 상태를 키잉 → 시작 직후 상태 표시 오동작(폴링이 profileId로 뒤늦게 보정) | 수정 |
| G2 | Med | `system_memory`가 bytes 반환 — TS(shell.ts:84-88)는 **MB** 반환. SettingsPage 메모리 슬라이더 파괴 | 수정 |
| G4 | High | `loader.getVersions` — 렌더러(CreateProfileModal.tsx:139-148)는 `result.versions[].version` 객체 배열 기대, shim은 string[] 반환 → 로더 버전 로드 실패 = **프로필 생성 불가** | 수정 |
| G5 | High | shim version 표면 이름 불일치 — preload/렌더러는 `version.list(releaseOnly): string[]` + `version.latest(): string`, shim은 존재하지 않는 getVersions/getLatest만 정의 → TypeError | 수정 |
| G6 | Med(구조) | 부분 실구현 카테고리가 Proxy 스텁을 통째로 대체 → 미구현 메서드가 undefined(TypeError). loader.install/checkInstalled/getRecommended 등(현재 렌더러 미사용이라 잠재) | 수정(전 카테고리 스텁 병합 구조) |
| G3 | 무해 강등 | getActive 반환에 startTime/pid 누락 — 렌더러(ProfileList.tsx:37)는 `profileId \|\| versionId`만 사용해 정상 동작 | 보류(M6) |
| G7 | Low | java.detect 반환에 vendor/architecture 누락(UI 표시 저하 가능성, 현 사용처 무해). download:progress payload가 렌더러 downloadStore의 상세 필드(percent/speed 등)와 다름 — 진행 모달 표시 저하(기능은 동작) | 보류(M6 폴리시) |

## 검증 완료로 확인된 축 (이상 없음)

- account 표면(loginMicrosoft/addOffline/list/remove/refresh) — preload와 일치
- game.stop/isRunning 파라미터 의미(Electron도 processKey=profileId) / `game:stopped` payload(versionId=profileId로 송신 중 ✓)
- settings 스키마(snake_case 중첩, M1에서 실측 기반) / profile CRUD 표면 / hyenipack(M4b-fix에서 정합됨)
- Windows 경로: 패키지 앱 userData는 productName("HyeniMC") 기준이나 Windows/macOS 모두 대소문자 무시 FS라 lowercase 매핑과 동일 디렉터리 (Linux만 주의 — 문서화)

## 2차 (Rust 의미론 심층) — **완료 (2026-07-06)**

- [x] ① launch.rs 인자 조립 실물 대조 — `examples/dump_args.rs` 신설, 실인스턴스(neoforge-21.1.211)로 병합→클래스패스→인자 전체 실행: **미해석 플레이스홀더 0, 누락 라이브러리 0**, 게임 인자가 TS 치환 테이블 + NeoForge FML 인자(--fml.*/--launchTarget)까지 일치. 부수: 클래스패스에 자식∪부모 동일 라이브러리 중복 항목 존재 — TS 병합과 동일 거동 + JVM 무해(첫 항목 우선)라 유지
- [x] ② install.rs 레이아웃 실디렉터리 대조 — `shared/{libraries,assets/{indexes,objects}}` + `<instance>/{versions/<id>/{<id>.json,<id>.jar,natives},libraries}` 실물 일치. versions 없는 인스턴스 2개는 미실행 프로필로 판명(가정 이상 없음)
- [x] **G8 (High, ①·② 대조 중 발견·수정)**: 클라이언트 jar 처리 — TS는 NeoForge면 클래스패스에 **미포함**(installer의 srg client jar가 라이브러리로 로드), inheritsFrom 프로필은 **부모 jar** 사용. 우리는 자식 id jar를 항상 포함 → Fabric 기동 실패급. merge_inherited가 inherits_from을 보존하도록 + build_classpath에 TS 의미 재현. 회귀 테스트 추가
- [x] ③ auth.rs 페이로드 TS 필드 대조 — XBL(RPS/RpsTicket d=)/XSTS(RETAIL/rp://api.minecraftservices.com/)/login_with_xbox(identityToken XBL3.0)/프로필(bearer) 전 필드 일치. 헤더 차이(Accept 미설정)는 무해
- [x] ④ account 업서트 device_id 갱신 — Go SaveMicrosoftAccount와 동일 의미(재로그인 시 현 device_id로 갱신) 확인
- [x] ⑤ lock 보유 중 await — **구조상 불가 확인**: tauri 커맨드 future는 Send 요구, std MutexGuard가 await를 넘으면 컴파일 에러. 전 코드 컴파일 통과 = 해당 지점 없음. 수동 추적으로도 game_launch/account/pack의 lock이 전부 블록/문장 단위로 drop됨
- [x] ⑥ 이벤트 구독 해제 — shim on()이 unlisten 클로저 반환, 렌더러 cleanup 패턴(useEffect return) 호환. once는 1회 후 자체 해제

## 종합 결론

전체 리뷰(1차+2차) 종결. 발견 총 8건(1차 7 + 2차 G8) 중 6건 수정·2건 보류(G3 무해/G7 M6). 실물 검증 도구 2종(read_real_db, dump_args)이 상시 스모크로 남음. **M5 진행 가능 상태.** 잔여 확인은 일괄 테스트 몫(실게임 기동/실로그인/Windows 실기).
