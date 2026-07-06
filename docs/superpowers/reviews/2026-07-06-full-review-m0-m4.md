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

## 2차 계획 (미착수 — 다음 세션)

Rust 내부 의미론 심층: ① launch.rs 인자 조립을 TS 산출과 필드 단위 대조(실프로필 1개로 양쪽 인자 배열 덤프 비교) ② install.rs 에셋/라이브러리 경로를 실디렉터리와 대조 ③ auth.rs 체인 페이로드를 TS와 필드 대조 ④ account/crypto 업서트 시 device_id 갱신 의미 ⑤ 앱 크레이트 lock 보유 중 await 지점 점검(데드락 위험) ⑥ 렌더러 이벤트 구독 해제 경로.
