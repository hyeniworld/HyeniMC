export {};

declare global {
  interface Window {
    electronAPI: {
      profile: {
        create: (data: any) => Promise<any>;
        list: () => Promise<any[]>;
        get: (id: string) => Promise<any>;
        update: (id: string, data: any) => Promise<any>;
        delete: (id: string) => Promise<void>;
        launch: (id: string, accountId?: string) => Promise<void>;
        toggleFavorite: (id: string) => Promise<any>;
        getStats: (profileId: string) => Promise<any>;
        recordLaunch: (profileId: string) => Promise<void>;
        recordPlayTime: (profileId: string, seconds: number) => Promise<void>;
        recordCrash: (profileId: string) => Promise<void>;
      };
      settings: {
        get: () => Promise<any>;
        update: (settings: any) => Promise<{ ok: boolean }>;
        resetCache: () => Promise<{ success: boolean; message: string }>;
        getCacheStats: () => Promise<{ size: number; files: number }>;
        export: () => Promise<string>;
        import: (data: string) => Promise<{ success: boolean; message: string }>;
      };
      account: {
        loginMicrosoft: () => Promise<any>;
        addOffline: (username: string) => Promise<any>;
        list: () => Promise<any[]>;
        remove: (id: string) => Promise<void>;
      };
      version: {
        list: (releaseOnly?: boolean) => Promise<string[]>;
        latest: () => Promise<string>;
      };
      java: {
        detect: (forceRefresh?: boolean) => Promise<Array<{
          path: string;
          version: string;
          majorVersion: number;
          vendor?: string;
          architecture: string;
        }>>;
        getCached: () => Promise<Array<{
          path: string;
          version: string;
          majorVersion: number;
          vendor?: string;
          architecture: string;
        }>>;
        getRecommended: (minecraftVersion: string) => Promise<number>;
        checkCompatibility: (javaVersion: number, minecraftVersion: string) => Promise<boolean>;
      };
      loader: {
        getVersions: (loaderType: string, minecraftVersion?: string, includeUnstable?: boolean) => Promise<any>;
        getRecommended: (loaderType: string, minecraftVersion: string) => Promise<any>;
        install: (loaderType: string, minecraftVersion: string, loaderVersion: string) => Promise<any>;
        checkInstalled: (loaderType: string, minecraftVersion: string, loaderVersion: string, profileId?: string) => Promise<any>;
      };
      shell: {
        openPath: (path: string) => Promise<string>;
        openExternal: (url: string) => Promise<void>;
      };
      mod: {
        list: (profileId: string, forceRefresh?: boolean) => Promise<any>;
        toggle: (modId: string, enabled: boolean) => Promise<void>;
        refreshCache: (profileId: string) => Promise<void>;
        search: (query: string, gameVersion?: string, loaderType?: string) => Promise<any>;
        install: (profileId: string, source: string, projectId: string, versionId: string) => Promise<any>;
        remove: (profileId: string, modId: string) => Promise<void>;
      };
      modpack: {
        search: (query: string, gameVersion?: string) => Promise<any[]>;
        getVersions: (modpackId: string, gameVersion?: string) => Promise<any[]>;
        install: (profileId: string, versionId: string) => Promise<{ success: boolean }>;
        installUrl: (profileId: string, url: string) => Promise<{ success: boolean }>;
        validateFile: (filePath: string) => Promise<any>;
        extractMetadata: (filePath: string) => Promise<any>;
        importFile: (filePath: string, profileId: string) => Promise<{ success: boolean }>;
        selectFile: () => Promise<string | null>;
      };
      resourcepack: {
        list: (profileId: string) => Promise<any>;
        install: (profileId: string, filePath: string) => Promise<void>;
        installUrl: (profileId: string, url: string) => Promise<void>;
        remove: (profileId: string, id: string) => Promise<void>;
      };
      shaderpack: {
        list: (profileId: string) => Promise<any>;
        install: (profileId: string, filePath: string) => Promise<void>;
        installUrl: (profileId: string, url: string) => Promise<void>;
        remove: (profileId: string, id: string) => Promise<void>;
      };
      game: {
        stop: (versionId: string) => Promise<{ success: boolean }>;
        isRunning: (versionId: string) => Promise<boolean>;
        getActive: () => Promise<Array<{ profileId?: string; versionId: string; startTime: Date; pid: number }>>;
      };
      system: {
        getPath: (name: string) => Promise<string>;
        getMemory: () => Promise<number>;
      };
      fileWatcher: {
        start: (profileId: string, gameDirectory: string) => Promise<{ success: boolean }>;
        stop: (profileId: string) => Promise<{ success: boolean }>;
      };
      hyeni: {
        checkUpdate: (profilePath: string, gameVersion: string, loaderType: string) => Promise<any>;
        installUpdate: (profilePath: string, updateInfo: any) => Promise<{ success: boolean; message?: string }>;
      };
      on: (channel: string, callback: (...args: any[]) => void) => () => void;
      once: (channel: string, callback: (...args: any[]) => void) => void;
      off: (channel: string, callback: (...args: any[]) => void) => void;
    };
  }
}
