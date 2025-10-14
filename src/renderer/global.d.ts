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
        list: (profileId: string) => Promise<any[]>;
        search: (query: string, filters?: any) => Promise<{ hits: any[]; total: number }>;
        getDetails: (modId: string, source?: 'modrinth' | 'curseforge') => Promise<any>;
        getVersions: (modId: string, gameVersion?: string, loaderType?: string, source?: 'modrinth' | 'curseforge') => Promise<any[]>;
        install: (profileId: string, modId: string, versionId: string, source?: 'modrinth' | 'curseforge') => Promise<{ success: boolean; fileName: string }>;
        checkDependencies: (profileId: string, modId: string, versionId: string, gameVersion: string, loaderType: string, source?: 'modrinth' | 'curseforge') => Promise<any>;
        installDependencies: (profileId: string, dependencies: any[]) => Promise<any>;
        checkUpdates: (profileId: string, gameVersion: string, loaderType: string) => Promise<any[]>;
        updateMod: (profileId: string, modId: string, versionId: string, source: 'modrinth' | 'curseforge') => Promise<{ success: boolean; fileName: string }>;
        update: (profileId: string, update: any) => Promise<{ success: boolean }>;
        updateAll: (profileId: string, updates: any[]) => Promise<any>;
        toggle: (profileId: string, fileName: string, enabled: boolean) => Promise<{ success: boolean }>;
        remove: (profileId: string, fileName: string) => Promise<{ success: boolean }>;
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
        list: (profileId: string) => Promise<any[]>;
        enable: (profileId: string, fileName: string) => Promise<{ success: boolean }>;
        disable: (profileId: string, fileName: string) => Promise<{ success: boolean }>;
        delete: (profileId: string, fileName: string) => Promise<{ success: boolean }>;
        install: (profileId: string, filePath: string) => Promise<{ success: boolean }>;
        installUrl: (profileId: string, url: string) => Promise<{ success: boolean }>;
        selectFile: () => Promise<string | null>;
      };
      shaderpack: {
        list: (profileId: string) => Promise<any[]>;
        enable: (profileId: string, fileName: string, isDirectory: boolean) => Promise<{ success: boolean }>;
        disable: (profileId: string, fileName: string, isDirectory: boolean) => Promise<{ success: boolean }>;
        delete: (profileId: string, fileName: string, isDirectory: boolean) => Promise<{ success: boolean }>;
        install: (profileId: string, filePath: string) => Promise<{ success: boolean }>;
        installUrl: (profileId: string, url: string) => Promise<{ success: boolean }>;
        selectFile: () => Promise<string | null>;
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
        checkForUpdate: (profilePath: string, gameVersion: string, loaderType: string) => Promise<any>;
        installUpdate: (profilePath: string, updateInfo: any) => Promise<{ success: boolean; message?: string }>;
      };
      launcher: {
        checkForUpdates: () => Promise<{ success: boolean }>;
        downloadUpdate: () => Promise<{ success: boolean }>;
        quitAndInstall: () => Promise<{ success: boolean }>;
        getVersion: () => Promise<{ success: boolean; version: string }>;
      };
      on: (channel: string, callback: (...args: any[]) => void) => () => void;
      once: (channel: string, callback: (...args: any[]) => void) => void;
      off: (channel: string, callback: (...args: any[]) => void) => void;
    };
  }
}
