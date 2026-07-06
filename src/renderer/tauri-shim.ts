/**
 * Tauri 환경용 electronAPI 어댑터 (M1).
 *
 * - Electron에서는 preload가 window.electronAPI를 먼저 주입하므로 아무 것도 하지 않는다.
 * - Tauri에서는 profile(11)/settings(2)/system(2)을 Rust 커맨드로 실연결하고,
 *   나머지 카테고리는 명시적 스텁(빈 응답 + 최초 1회 console.warn)으로 경계를 표시한다.
 *   스텁 카테고리는 M2+에서 순차 실구현된다.
 */

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

  const warned = new Set<string>();
  const stub = (name: string, value: unknown = []) => async () => {
    if (!warned.has(name)) {
      console.warn(`[tauri-shim] stub: ${name}`);
      warned.add(name);
    }
    return value;
  };

  const api: any = {
    profile: {
      list: () => invoke('profile_list'),
      get: (id: string) => invoke('profile_get', { id }),
      create: (data: unknown) => invoke('profile_create', { data }),
      update: (id: string, data: unknown) => invoke('profile_update', { id, data }),
      delete: (id: string) => invoke('profile_delete', { id }),
      toggleFavorite: (id: string) => invoke('profile_toggle_favorite', { id }),
      launch: stub('profile.launch', undefined), // M2
      getStats: (profileId: string) => invoke('profile_get_stats', { profileId }),
      recordLaunch: (profileId: string) => invoke('profile_record_launch', { profileId }),
      recordPlayTime: (profileId: string, seconds: number) =>
        invoke('profile_record_play_time', { profileId, seconds }),
      recordCrash: (profileId: string) => invoke('profile_record_crash', { profileId }),
    },
    settings: {
      get: () => invoke('settings_get'),
      update: (settings: unknown) => invoke('settings_update', { settings }),
      resetCache: stub('settings.resetCache', { success: true, message: 'stub' }),
      getCacheStats: stub('settings.getCacheStats', { size: 0, files: 0 }),
      export: stub('settings.export', '{}'),
      import: stub('settings.import', { success: false, message: 'M1 미구현' }),
    },
    system: {
      getPath: (name: string) => invoke('system_get_path', { name }),
      getMemory: () => invoke('system_memory'),
    },
    game: {
      getActive: stub('game.getActive', []),
      isRunning: stub('game.isRunning', false),
      stop: stub('game.stop', undefined),
    },
    on: () => () => undefined,
    once: () => () => undefined,
    off: () => undefined,
    removeAllListeners: () => undefined,
  };

  // 미구현 카테고리: 빈 응답 스텁 + warn (M2+에서 순차 실구현)
  const STUB_CATEGORIES = [
    'mod', 'modpack', 'resourcepack', 'shaderpack', 'account', 'version', 'java',
    'loader', 'hyeni', 'workerMods', 'hyenipack', 'shell', 'dialog', 'fs',
    'launcher', 'fileWatcher', 'errorDialog',
  ];
  for (const cat of STUB_CATEGORIES) {
    api[cat] = new Proxy(
      {},
      { get: (_t, m: string | symbol) => stub(`${cat}.${String(m)}`) }
    );
  }

  (window as any).electronAPI = api;
  console.info('[tauri-shim] M1 adapter installed');
}

installTauriShim();

export {};
