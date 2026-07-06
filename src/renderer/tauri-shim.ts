/**
 * Tauri 환경용 electronAPI shim (M0 스파이크).
 *
 * Tauri webview에서 렌더러가 그대로 뜨는지 검증하기 위한 최소 어댑터.
 * - Electron에서는 preload가 window.electronAPI를 먼저 주입하므로 아무 것도 하지 않는다.
 * - Tauri에서는 (withGlobalTauri로 노출된) window.__TAURI__.core.invoke로 구현된
 *   커맨드(profile.getAll → get_profiles)만 실연결하고, 나머지는 빈 응답 스텁.
 *
 * M1에서 이 파일이 정식 어댑터(전 커맨드 매핑)로 대체된다.
 */

type AnyFn = (...args: unknown[]) => unknown;

declare global {
  interface Window {
    __TAURI__?: {
      core: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
    };
  }
}

function installTauriShim(): void {
  const tauri = window.__TAURI__;
  if (!tauri || (window as any).electronAPI) return;

  const invoke = tauri.core.invoke;

  // 실구현된 커맨드 매핑 (M0)
  const implemented: Record<string, Record<string, AnyFn>> = {
    profile: {
      getAll: () => invoke('get_profiles'),
      list: () => invoke('get_profiles'),
    },
    system: {
      getMemory: async () => ({ total: 16384, free: 8192 }),
    },
  };

  // 그 외 전부: 호출 시 빈 배열을 resolve하는 스텁 (UI 렌더 확인용)
  const stubMethod: AnyFn = async () => [];
  const noop = () => undefined;

  const apiProxy = new Proxy(implemented, {
    get(target, category: string) {
      // 이벤트 구독 표면은 no-op unsubscribe 반환
      if (category === 'on' || category === 'once') return () => noop;
      if (category === 'off' || category === 'removeAllListeners') return noop;

      const impl = target[category] ?? {};
      return new Proxy(impl, {
        get(implTarget, method: string) {
          return implTarget[method] ?? stubMethod;
        },
      });
    },
  });

  (window as any).electronAPI = apiProxy;
  console.info('[tauri-shim] electronAPI stub installed (M0 spike)');
}

installTauriShim();

export {};
