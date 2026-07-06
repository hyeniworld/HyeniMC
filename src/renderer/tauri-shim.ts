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
    // preload 계약: list(releaseOnly): string[] / latest(): string (전체 리뷰 G5)
    version: {
      list: async (releaseOnly?: boolean) => {
        const all = (await invoke('version_list_minecraft')) as Array<{ id: string; type: string }>;
        return (releaseOnly === false ? all : all.filter((v) => v.type === 'release')).map((v) => v.id);
      },
      latest: async () => {
        const all = (await invoke('version_list_minecraft')) as Array<{ id: string; type: string }>;
        return all.find((v) => v.type === 'release')?.id ?? '';
      },
    },
    java: {
      detect: () => invoke('java_detect'),
      getInstallations: () => invoke('java_detect'),
    },
    // preload 계약: getVersions는 {versions: [{version, stable}...]} 형태 반환 (CreateProfileModal)
    loader: {
      getVersions: async (loaderType: string, gameVersion: string, _includeUnstable?: boolean) => {
        const versions = await invoke('loader_get_versions', { loaderType, gameVersion });
        return { versions };
      },
    },
    // preload 계약(hyenipack.import(filePath, profileId, instanceDir) + {success} envelope) 그대로 유지
    hyenipack: {
      import: async (filePath: string, profileId: string, _instanceDir?: string) => {
        try {
          await invoke('hyenipack_import', { profileId, filePath });
          return { success: true };
        } catch (e) {
          return { success: false, error: String(e) };
        }
      },
      preview: async (filePath: string) => {
        try {
          const manifest = await invoke('hyenipack_preview', { filePath });
          return { success: true, manifest };
        } catch (e) {
          return { success: false, error: String(e) };
        }
      },
      getFileTree: async () => ({
        success: false,
        error: '혜니팩 제작(export)은 제작자 도구에서만 지원됩니다',
      }),
      export: async () => ({
        success: false,
        error: '혜니팩 제작(export)은 제작자 도구에서만 지원됩니다',
      }),
      // 신규 표면 (팩 업데이트)
      checkUpdate: (profileId: string) => invoke('pack_check_update', { profileId }),
      applyUpdate: (profileId: string, accountId?: string) =>
        invoke('pack_apply_update', { profileId, accountId }),
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

  // preload 계약: checkUpdates(profilePath, gameVersion, loaderType, serverAddress?) / installMultiple(profilePath, updates)
  api.workerMods = {
    checkUpdates: (profilePath: string, gameVersion: string, loaderType: string, serverAddress?: string) =>
      invoke('worker_mods_check', { profilePath, gameVersion, loaderType, serverAddress }),
    installMultiple: (profilePath: string, updates: unknown[]) =>
      invoke('worker_mods_install', { profilePath, updates }),
  };

  const notSupported = (what: string) => async () => ({
    success: false,
    error: `${what}은(는) 사용자 런처에서 지원되지 않습니다 (폴더 열기로 직접 관리하세요)`,
  });

  // 리소스/셰이더팩: 읽기전용 리스트만 실연결, 변경류는 명시적 미지원
  api.resourcepack = {
    list: (profileId: string) => invoke('resourcepack_list', { profileId }),
    enable: notSupported('리소스팩 활성화'),
    disable: notSupported('리소스팩 비활성화'),
    delete: notSupported('리소스팩 삭제'),
    install: notSupported('리소스팩 설치'),
    installUrl: notSupported('리소스팩 설치'),
    selectFile: async () => null,
  };
  api.shaderpack = {
    list: (profileId: string) => invoke('shaderpack_list', { profileId }),
    enable: notSupported('셰이더팩 활성화'),
    disable: notSupported('셰이더팩 비활성화'),
    delete: notSupported('셰이더팩 삭제'),
    install: notSupported('셰이더팩 설치'),
    installUrl: notSupported('셰이더팩 설치'),
    selectFile: async () => null,
  };
  api.fileWatcher = {
    start: async (profileId: string, gameDirectory: string) => {
      await invoke('file_watch_start', { profileId, gameDirectory });
      return { success: true };
    },
    stop: async (profileId: string) => {
      await invoke('file_watch_stop', { profileId });
      return { success: true };
    },
  };
  // shell: opener 플러그인 직접 호출 (경로/URL 열기)
  api.shell = {
    openPath: async (path: string) => {
      await invoke('plugin:opener|open_path', { path });
      return '';
    },
    openExternal: (url: string) => invoke('plugin:opener|open_url', { url }),
  };
  api.crashReport = {
    exportReport: (profileId: string) => invoke('crash_export_report', { profileId }),
    openLogs: (profileId: string) => invoke('crash_open_logs', { profileId }),
  };

  // 미구현 카테고리: 빈 응답 스텁 + warn (M6에서 순차 실구현/정리)
  const STUB_CATEGORIES = [
    'mod', 'modpack', 'hyeni', 'dialog', 'fs', 'launcher', 'errorDialog',
  ];
  for (const cat of STUB_CATEGORIES) {
    api[cat] = {};
  }

  // 전 카테고리 공통: 부분 구현이어도 미구현 메서드는 undefined(TypeError)가 아니라
  // 경고 스텁으로 강등되도록 Proxy 폴백을 병합한다 (전체 리뷰 G6)
  for (const cat of Object.keys(api)) {
    const value = api[cat];
    if (typeof value !== 'object' || value === null) continue; // on/off 등 최상위 함수 제외
    api[cat] = new Proxy(value, {
      get: (target, method: string | symbol) =>
        (target as Record<string | symbol, unknown>)[method] ?? stub(`${cat}.${String(method)}`),
    });
  }

  (window as any).electronAPI = api;
  console.info('[tauri-shim] M1 adapter installed');
}

installTauriShim();

export {};
