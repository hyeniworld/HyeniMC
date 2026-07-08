/**
 * 실행 게이트 관련 공유 상수.
 */

// Rust `pack::FORCE_MARKER`와 반드시 동일해야 함.
// game_launch가 업데이트 확인 실패(강제 실행 가능) 시 이 접두사로 시작하는 에러를 반환하고,
// 프론트가 감지해 [강제 실행]/[닫기] 확인 다이얼로그를 띄운다.
export const FORCE_LAUNCH_MARKER = 'FORCE_LAUNCH_AVAILABLE:';
