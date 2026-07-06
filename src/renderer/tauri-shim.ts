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
      event: {
        listen: (
          event: string,
          handler: (e: { payload: unknown }) => void
        ) => Promise<() => void>;
      };
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
      launch: (id: string, accountId?: string) =>
        invoke('game_launch', { profileId: id, accountId }),
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
      getActive: () => invoke('game_get_active'),
      isRunning: (profileId: string) => invoke('game_is_running', { profileId }),
      stop: (profileId: string) => invoke('game_stop', { profileId }),
      downloadVersion: (profileId: string) => invoke('game_download_version', { profileId }),
    },
    version: {
      getVersions: () => invoke('version_list_minecraft'),
      getLatest: async () => {
        const list = (await invoke('version_list_minecraft')) as Array<{ id: string; type: string }>;
        return list.find((v) => v.type === 'release')?.id;
      },
    },
    java: {
      detect: () => invoke('java_detect'),
      getInstallations: () => invoke('java_detect'),
    },
    loader: {
      getVersions: (loaderType: string, gameVersion: string) =>
        invoke('loader_get_versions', { loaderType, gameVersion }),
    },
    account: {
      loginMicrosoft: () => invoke('account_login_microsoft'),
      addOffline: async () => {
        throw new Error('오프라인 계정은 지원이 종료되었습니다 (2026-07-06 결정)');
      },
      list: () => invoke('account_list'),
      remove: (id: string) => invoke('account_remove', { id }),
      refresh: (id: string) => invoke('account_refresh', { id }),
    },
    // 이벤트 브리지: Electron ipcRenderer.on → Tauri event listen (동일 이벤트 이름)
    on: (event: string, cb: (data: unknown) => void) => {
      const unlistenP = tauri.event.listen(event, (e) => cb(e.payload));
      return () => {
        unlistenP.then((unlisten) => unlisten());
      };
    },
    once: (event: string, cb: (data: unknown) => void) => {
      let done = false;
      const unlistenP = tauri.event.listen(event, (e) => {
        if (done) return;
        done = true;
        unlistenP.then((unlisten) => unlisten());
        cb(e.payload);
      });
      return () => {
        unlistenP.then((unlisten) => unlisten());
      };
    },
    off: () => undefined,
    removeAllListeners: () => undefined,
  };

  // 미구현 카테고리: 빈 응답 스텁 + warn (M4+에서 순차 실구현)
  const STUB_CATEGORIES = [
    'mod', 'modpack', 'resourcepack', 'shaderpack',
    'hyeni', 'workerMods', 'hyenipack', 'shell', 'dialog', 'fs',
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
