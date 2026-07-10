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

  // Rust는 타임스탬프를 초(Unix) i64로 반환 — 렌더러는 new Date(ms)를 기대하므로
  // Electron main(profile.ts)과 동일하게 초→ISO 문자열로 변환한다(생성일 1970 표시 방지).
  // 또한 Rust는 memory/resolution을 평면(memoryMin 등, NULL=전역 상속)으로 주지만
  // 렌더러 계약(shared/types/profile.ts)은 중첩 {memory:{min,max}, resolution:{width,height}}이며
  // 0=전역 관례를 쓴다 → 여기서 평면→중첩 + null→0 정규화(어댑터 계층이 계약을 맞춘다).
  const toRendererProfile = (p: any) =>
    p && {
      ...p,
      createdAt: p.createdAt ? new Date(p.createdAt * 1000).toISOString() : undefined,
      updatedAt: p.updatedAt ? new Date(p.updatedAt * 1000).toISOString() : undefined,
      lastPlayed: p.lastPlayed ? new Date(p.lastPlayed * 1000).toISOString() : undefined,
      memory: { min: p.memoryMin ?? 0, max: p.memoryMax ?? 0 },
      resolution: { width: p.resolutionWidth ?? 0, height: p.resolutionHeight ?? 0 },
    };

  // 렌더러 계약(중첩 memory/resolution, 0=전역) → Rust ProfilePatch(평면 memoryMin 등).
  // 0은 "전역 사용" 신호 → 컬럼을 NULL로 초기화(Rust 실행부가 NULL일 때만 전역 상속하므로
  // 0을 그대로 저장하면 0MB/0px로 실행되는 문제를 막는다). memory/resolution이 없으면 손대지 않음.
  const toBackendPatch = (data: any) => {
    if (!data || typeof data !== 'object') return data;
    const out: any = { ...data };
    if (out.memory && typeof out.memory === 'object') {
      out.memoryMin = out.memory.min ? out.memory.min : null;
      out.memoryMax = out.memory.max ? out.memory.max : null;
      delete out.memory;
    }
    if (out.resolution && typeof out.resolution === 'object') {
      out.resolutionWidth = out.resolution.width ? out.resolution.width : null;
      out.resolutionHeight = out.resolution.height ? out.resolution.height : null;
      delete out.resolution;
    }
    // Proto3 우회 마커 처리(Go profile_service와 동일): ['__CLEAR_JVM_ARGS__'] = 비우기.
    // 처리하지 않으면 Rust가 마커를 jvm_args에 저장 → 실행 시 JVM 인자로 주입돼 게임이 안 뜬다.
    if (
      Array.isArray(out.jvmArgs) &&
      out.jvmArgs.length === 1 &&
      out.jvmArgs[0] === '__CLEAR_JVM_ARGS__'
    ) {
      out.jvmArgs = [];
    }
    return out;
  };

  const api: any = {
    profile: {
      list: async () => ((await invoke('profile_list')) as any[]).map(toRendererProfile),
      get: async (id: string) => toRendererProfile(await invoke('profile_get', { id })),
      create: (data: unknown) => invoke('profile_create', { data }),
      update: async (id: string, data: unknown) =>
        toRendererProfile(await invoke('profile_update', { id, data: toBackendPatch(data) })),
      delete: (id: string) => invoke('profile_delete', { id }),
      toggleFavorite: (id: string) => invoke('profile_toggle_favorite', { id }),
      launch: (id: string, accountId?: string, force?: boolean) =>
        invoke('game_launch', { profileId: id, accountId, force: force ?? false }),
      getStats: (profileId: string) => invoke('profile_get_stats', { profileId }),
      recordLaunch: (profileId: string) => invoke('profile_record_launch', { profileId }),
      recordPlayTime: (profileId: string, seconds: number) =>
        invoke('profile_record_play_time', { profileId, seconds }),
      recordCrash: (profileId: string) => invoke('profile_record_crash', { profileId }),
    },
    settings: {
      get: () => invoke('settings_get'),
      update: (settings: unknown) => invoke('settings_update', { settings }),
      // 캐시(재다운로드 가능한 shared 에셋/라이브러리) 실통계/삭제 — 기존 가짜 성공 스텁 대체
      resetCache: () => invoke('settings_reset_cache'),
      getCacheStats: () => invoke('settings_cache_stats'),
      // 설정 내보내기/가져오기 — settings_get/update로 왕복(어댑터 계층에서 처리)
      export: async () => JSON.stringify(await invoke('settings_get'), null, 2),
      import: async (data: string) => {
        try {
          const settings = JSON.parse(data);
          await invoke('settings_update', { settings });
          return { success: true, message: '설정을 가져왔습니다.' };
        } catch {
          return { success: false, message: '설정 가져오기에 실패했습니다. 파일 형식을 확인하세요.' };
        }
      },
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
      // detect(force)는 항상 재감지+캐시 갱신, getCached는 캐시 우선(초기 화면 미감지 방지)
      detect: (_force?: boolean) => invoke('java_detect'),
      getCached: () => invoke('java_get_cached'),
      getInstallations: () => invoke('java_get_cached'),
      getRecommended: (gameVersion: string) => invoke('java_get_recommended', { gameVersion }),
    },
    // preload 계약: {success, versions:[{version, stable}...]} (CreateProfileModal은 versions만,
    // ProfileSettingsTab은 result.success도 확인하므로 success 필수)
    loader: {
      getVersions: async (loaderType: string, gameVersion: string, includeUnstable?: boolean) => {
        const versions = await invoke('loader_get_versions', {
          loaderType,
          gameVersion,
          includeUnstable: !!includeUnstable,
        });
        return { success: true, versions };
      },
    },
    // preload 계약: hyenipack.import(filePath, profileId, accountId) — 3번째 인자는 accountId다.
    // (CF 피닝 url 토큰 부착에 필요 — 기존엔 _instanceDir로 오해해 버려서 account_id가 None이 됐다)
    hyenipack: {
      import: async (filePath: string, profileId: string, accountId?: string) => {
        try {
          await invoke('hyenipack_import', { profileId, filePath, accountId });
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
      // 신규 표면 (온라인 목록·검색·설치)
      listAvailable: () => invoke('pack_list_available'),
      hasAnyToken: () => invoke('hyeni_has_any_token'),
      listTokens: () => invoke('hyeni_list_tokens'),
      installFromWorker: (profileId: string, packId: string, accountId?: string) =>
        invoke('pack_install_from_worker', { profileId, packId, accountId }),
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

  // preload 계약: checkUpdates(profilePath, gameVersion, loaderType, loaderVersion, serverAddress?) / installMultiple(profilePath, updates)
  api.workerMods = {
    checkUpdates: async (profilePath: string, gameVersion: string, loaderType: string, loaderVersion: string, serverAddress?: string) => {
      const updates = (await invoke('worker_mods_check', {
        profilePath,
        gameVersion,
        loaderType,
        loaderVersion,
        serverAddress,
      })) as any[];
      // Rust는 modName/loaderType으로 주지만 렌더러(ModUpdateItem)는 name/loader를 표시하므로 매핑.
      // requiredLoaderVersion 등 나머지 필드는 ...u로 그대로 통과.
      return updates.map((u) => ({ ...u, name: u.modName, loader: u.loaderType }));
    },
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

  // 설치된 모드 목록/토글/삭제 (사용자도 조회·on/off 가능 — 검색/설치/업데이트만 제작자 전용)
  api.mod = {
    list: (profileId: string) => invoke('mod_list', { profileId }),
    toggle: async (profileId: string, fileName: string, enabled: boolean) => {
      await invoke('mod_toggle', { profileId, fileName, enabled });
      return { success: true };
    },
    remove: async (profileId: string, fileName: string) => {
      await invoke('mod_remove', { profileId, fileName });
      return { success: true };
    },
  };

  // 런처 자체 업데이트 (preload launcher 계약)
  api.launcher = {
    getVersion: () => invoke('launcher_get_version'),
    checkForUpdates: async () => {
      const r = (await invoke('launcher_check_updates')) as { available: boolean };
      return { success: true, ...r };
    },
    downloadUpdate: async () => ({ success: await invoke('launcher_download_update') }),
    quitAndInstall: async () => {
      await invoke('launcher_quit_and_install');
      return { success: true };
    },
    openLogsFolder: async () => undefined,
  };

  // 파일 선택 다이얼로그 (tauri-plugin-dialog) — 혜니팩 import 등에서 사용
  api.dialog = {
    selectFile: async (opts?: { filters?: { name: string; extensions: string[] }[] }) => {
      const path = await invoke('plugin:dialog|open', {
        options: {
          multiple: false,
          directory: false,
          filters: opts?.filters ?? [{ name: 'HyeniPack', extensions: ['hyenipack'] }],
        },
      });
      return typeof path === 'string' ? path : null;
    },
  };

  // 크래시 자동 진단 등에서 Rust가 보내는 show-error-dialog → ErrorDialogProvider로 전달.
  api.onShowErrorDialog = (cb: (data: unknown) => void) => api.on('show-error-dialog', cb);
  // 에러 다이얼로그 액션 실행 (Electron error-dialog와 동일 — 대부분 렌더러/no-op, URL만 열기).
  api.errorDialog = {
    executeAction: async (action: string) => {
      if (action === 'openJavaInstallGuide') {
        await invoke('plugin:opener|open_url', { url: 'https://www.java.com/ko/download/' });
      }
      // increaseMemory 등 그 외 액션은 Electron과 동일하게 no-op(다이얼로그만 닫힘)
      return { success: true };
    },
  };

  // 제작자 전용/미사용 카테고리 스텁 — 사용자 런처 UI에선 해당 기능이 숨겨짐(M6b).
  // hyeni.installUpdate는 worker mods로 통합됐으므로 no-op 성공 처리.
  const STUB_CATEGORIES = [
    'modpack', 'hyeni', 'fs',
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
