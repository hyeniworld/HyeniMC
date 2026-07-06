/**
 * 앱 모드 구분 (M6b) — 사용자 런처(Tauri) vs 제작자 도구(Electron).
 *
 * Tauri 빌드는 window.__TAURI__를 노출하므로, 그 존재로 사용자 런처를 판별한다.
 * 제작자 전용 기능(모드 검색·설치·업데이트, 모드팩 import, 혜니팩 export)은
 * 사용자 런처에서 숨긴다. 확정 방침: 2026-07-06 decisions.md.
 */
export function isUserLauncher(): boolean {
  return typeof (window as any).__TAURI__ !== 'undefined';
}

/** 제작자 도구(Electron)에서만 노출할 기능인지 */
export function isCreatorMode(): boolean {
  return !isUserLauncher();
}
