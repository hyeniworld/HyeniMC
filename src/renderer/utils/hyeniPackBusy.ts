/**
 * 혜니팩 설치 진행 여부 전역 플래그 (B-5).
 *
 * 온라인/딥링크 설치가 하나의 경로로 통일되면서, 설치가 진행 중일 때
 * 새 딥링크 제안(hyeni:pack-suggest)이 들어오면 무시하기 위한 모듈 스코프 플래그다.
 * React 상태가 아니라 이벤트 핸들러에서 즉시 읽어야 하므로 모듈 변수로 관리한다.
 */
let busy = false;

export const setHyeniPackBusy = (v: boolean): void => {
  busy = v;
};

export const isHyeniPackBusy = (): boolean => busy;
