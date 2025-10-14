import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, IPC_EVENTS } from '../shared/constants/ipc';

// Expose protected methods to renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Profile APIs
  profile: {
    create: (data: any): Promise<any> => 
      ipcRenderer.invoke(IPC_CHANNELS.PROFILE_CREATE, data),
    
    list: (): Promise<any[]> => 
      ipcRenderer.invoke(IPC_CHANNELS.PROFILE_LIST),
    
    get: (id: string): Promise<any> => 
      ipcRenderer.invoke(IPC_CHANNELS.PROFILE_GET, id),
    
    update: (id: string, data: any): Promise<any> => 
      ipcRenderer.invoke(IPC_CHANNELS.PROFILE_UPDATE, id, data),
    
    delete: (id: string): Promise<void> => 
      ipcRenderer.invoke(IPC_CHANNELS.PROFILE_DELETE, id),
    
    launch: (id: string, accountId?: string): Promise<void> => 
      ipcRenderer.invoke(IPC_CHANNELS.PROFILE_LAUNCH, id, accountId),
    
    toggleFavorite: (id: string): Promise<any> =>
      ipcRenderer.invoke(IPC_CHANNELS.PROFILE_TOGGLE_FAVORITE, id),
    
    // Profile statistics
    getStats: (profileId: string): Promise<any> =>
      ipcRenderer.invoke('profile:getStats', profileId),
    
    recordLaunch: (profileId: string): Promise<void> =>
      ipcRenderer.invoke('profile:recordLaunch', profileId),
    
    recordPlayTime: (profileId: string, seconds: number): Promise<void> =>
      ipcRenderer.invoke('profile:recordPlayTime', profileId, seconds),
    
    recordCrash: (profileId: string): Promise<void> =>
      ipcRenderer.invoke('profile:recordCrash', profileId),
  },

  // Settings APIs
  settings: {
    get: (): Promise<any> => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET),
    update: (settings: any): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_UPDATE, settings),
    resetCache: (): Promise<{ success: boolean; message: string }> => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_RESET_CACHE),
    getCacheStats: (): Promise<{ size: number; files: number }> => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET_CACHE_STATS),
    export: (): Promise<string> => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_EXPORT),
    import: (data: string): Promise<{ success: boolean; message: string }> => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_IMPORT, data),
  },
  
  // Account APIs
  account: {
    loginMicrosoft: (): Promise<any> =>
      ipcRenderer.invoke(IPC_CHANNELS.ACCOUNT_LOGIN_MICROSOFT),
    
    addOffline: (username: string): Promise<any> =>
      ipcRenderer.invoke(IPC_CHANNELS.ACCOUNT_ADD_OFFLINE, username),
    
    list: (): Promise<any[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.ACCOUNT_LIST),
    
    remove: (id: string): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.ACCOUNT_REMOVE, id),
  },
  
  // Version APIs
  version: {
    list: (releaseOnly?: boolean): Promise<string[]> => 
      ipcRenderer.invoke(IPC_CHANNELS.VERSION_LIST, releaseOnly),
    
    latest: (): Promise<string> => 
      ipcRenderer.invoke(IPC_CHANNELS.VERSION_LATEST),
  },
  
  // Java APIs
  java: {
    detect: (forceRefresh?: boolean): Promise<Array<{
      path: string;
      version: string;
      majorVersion: number;
      vendor?: string;
      architecture: string;
    }>> => 
      ipcRenderer.invoke(IPC_CHANNELS.JAVA_DETECT, forceRefresh),
    
    getCached: (): Promise<Array<{
      path: string;
      version: string;
      majorVersion: number;
      vendor?: string;
      architecture: string;
    }>> => 
      ipcRenderer.invoke('java:get-cached'),
    
    getRecommended: (minecraftVersion: string): Promise<number> => 
      ipcRenderer.invoke(IPC_CHANNELS.JAVA_GET_RECOMMENDED, minecraftVersion),
    
    checkCompatibility: (javaVersion: number, minecraftVersion: string): Promise<boolean> => 
      ipcRenderer.invoke(IPC_CHANNELS.JAVA_CHECK_COMPATIBILITY, javaVersion, minecraftVersion),
  },
  
  // Loader APIs
  loader: {
    getVersions: (loaderType: string, minecraftVersion?: string, includeUnstable?: boolean): Promise<any> =>
      ipcRenderer.invoke(IPC_CHANNELS.LOADER_GET_VERSIONS, loaderType, minecraftVersion, includeUnstable),
    
    getRecommended: (loaderType: string, minecraftVersion: string): Promise<any> =>
      ipcRenderer.invoke(IPC_CHANNELS.LOADER_GET_RECOMMENDED, loaderType, minecraftVersion),
    
    install: (loaderType: string, minecraftVersion: string, loaderVersion: string): Promise<any> =>
      ipcRenderer.invoke(IPC_CHANNELS.LOADER_INSTALL, loaderType, minecraftVersion, loaderVersion),
    
    checkInstalled: (loaderType: string, minecraftVersion: string, loaderVersion: string, profileId?: string): Promise<any> =>
      ipcRenderer.invoke(IPC_CHANNELS.LOADER_CHECK_INSTALLED, loaderType, minecraftVersion, loaderVersion, profileId),
  },

  // Shell APIs
  shell: {
    openPath: (path: string): Promise<string> =>
      ipcRenderer.invoke('shell:openPath', path),
    openExternal: (url: string): Promise<void> =>
      ipcRenderer.invoke('shell:openExternal', url),
  },

  // System APIs
  system: {
    getPath: (name: string): Promise<string> =>
      ipcRenderer.invoke('system:getPath', name),
    getMemory: (): Promise<number> =>
      ipcRenderer.invoke('system:getMemory'),
  },

  // Game APIs
  game: {
    stop: (versionId: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke(IPC_CHANNELS.GAME_STOP, versionId),
    isRunning: (versionId: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC_CHANNELS.GAME_IS_RUNNING, versionId),
    getActive: (): Promise<Array<{ profileId?: string; versionId: string; startTime: Date; pid: number }>> =>
      ipcRenderer.invoke(IPC_CHANNELS.GAME_GET_ACTIVE),
  },

  // Mod APIs
  mod: {
    list: (profileId: string): Promise<any[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.MOD_LIST, profileId),
    search: (query: string, filters?: any): Promise<{ hits: any[]; total: number }> =>
      ipcRenderer.invoke(IPC_CHANNELS.MOD_SEARCH, query, filters),
    getDetails: (modId: string, source?: 'modrinth' | 'curseforge'): Promise<any> =>
      ipcRenderer.invoke(IPC_CHANNELS.MOD_GET_DETAILS, modId, source),
    getVersions: (modId: string, gameVersion?: string, loaderType?: string, source?: 'modrinth' | 'curseforge'): Promise<any[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.MOD_GET_VERSIONS, modId, gameVersion, loaderType, source),
    install: (profileId: string, modId: string, versionId: string, source?: 'modrinth' | 'curseforge'): Promise<{ success: boolean; fileName: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.MOD_INSTALL, profileId, modId, versionId, source),
    checkDependencies: (profileId: string, modId: string, versionId: string, gameVersion: string, loaderType: string, source?: 'modrinth' | 'curseforge'): Promise<any> =>
      ipcRenderer.invoke(IPC_CHANNELS.MOD_CHECK_DEPENDENCIES, profileId, modId, versionId, gameVersion, loaderType, source),
    installDependencies: (profileId: string, dependencies: any[]): Promise<any> =>
      ipcRenderer.invoke(IPC_CHANNELS.MOD_INSTALL_DEPENDENCIES, profileId, dependencies),
    checkUpdates: (profileId: string, gameVersion: string, loaderType: string): Promise<any[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.MOD_CHECK_UPDATES, profileId, gameVersion, loaderType),
    updateMod: (profileId: string, modId: string, versionId: string, source: 'modrinth' | 'curseforge'): Promise<{ success: boolean; fileName: string }> =>
      ipcRenderer.invoke('mod:update-single', profileId, modId, versionId, source),
    update: (profileId: string, update: any): Promise<{ success: boolean }> =>
      ipcRenderer.invoke(IPC_CHANNELS.MOD_UPDATE, profileId, update),
    updateAll: (profileId: string, updates: any[]): Promise<any> =>
      ipcRenderer.invoke(IPC_CHANNELS.MOD_UPDATE_ALL, profileId, updates),
    toggle: (profileId: string, fileName: string, enabled: boolean): Promise<{ success: boolean }> =>
      ipcRenderer.invoke(IPC_CHANNELS.MOD_TOGGLE, profileId, fileName, enabled),
    remove: (profileId: string, fileName: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke(IPC_CHANNELS.MOD_REMOVE, profileId, fileName),
  },

  // Resource Pack APIs
  resourcepack: {
    list: (profileId: string): Promise<any[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.RESOURCEPACK_LIST, profileId),
    enable: (profileId: string, fileName: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke(IPC_CHANNELS.RESOURCEPACK_ENABLE, profileId, fileName),
    disable: (profileId: string, fileName: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke(IPC_CHANNELS.RESOURCEPACK_DISABLE, profileId, fileName),
    delete: (profileId: string, fileName: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke(IPC_CHANNELS.RESOURCEPACK_DELETE, profileId, fileName),
    install: (profileId: string, filePath: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke(IPC_CHANNELS.RESOURCEPACK_INSTALL, profileId, filePath),
    installUrl: (profileId: string, url: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke(IPC_CHANNELS.RESOURCEPACK_INSTALL_URL, profileId, url),
    selectFile: (): Promise<string | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.RESOURCEPACK_SELECT_FILE),
  },

  // Shader Pack APIs
  shaderpack: {
    list: (profileId: string): Promise<any[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.SHADERPACK_LIST, profileId),
    enable: (profileId: string, fileName: string, isDirectory: boolean): Promise<{ success: boolean }> =>
      ipcRenderer.invoke(IPC_CHANNELS.SHADERPACK_ENABLE, profileId, fileName, isDirectory),
    disable: (profileId: string, fileName: string, isDirectory: boolean): Promise<{ success: boolean }> =>
      ipcRenderer.invoke(IPC_CHANNELS.SHADERPACK_DISABLE, profileId, fileName, isDirectory),
    delete: (profileId: string, fileName: string, isDirectory: boolean): Promise<{ success: boolean }> =>
      ipcRenderer.invoke(IPC_CHANNELS.SHADERPACK_DELETE, profileId, fileName, isDirectory),
    install: (profileId: string, filePath: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke(IPC_CHANNELS.SHADERPACK_INSTALL, profileId, filePath),
    installUrl: (profileId: string, url: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke(IPC_CHANNELS.SHADERPACK_INSTALL_URL, profileId, url),
    selectFile: (): Promise<string | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.SHADERPACK_SELECT_FILE),
  },

  // Modpack APIs
  modpack: {
    search: (query: string, gameVersion?: string): Promise<any[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.MODPACK_SEARCH, query, gameVersion),
    getVersions: (modpackId: string, gameVersion?: string): Promise<any[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.MODPACK_GET_VERSIONS, modpackId, gameVersion),
    install: (profileId: string, versionId: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke(IPC_CHANNELS.MODPACK_INSTALL, profileId, versionId),
    installUrl: (profileId: string, url: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke(IPC_CHANNELS.MODPACK_IMPORT_URL, profileId, url),
    validateFile: (filePath: string): Promise<any> =>
      ipcRenderer.invoke(IPC_CHANNELS.MODPACK_VALIDATE_FILE, filePath),
    extractMetadata: (filePath: string): Promise<any> =>
      ipcRenderer.invoke(IPC_CHANNELS.MODPACK_EXTRACT_METADATA, filePath),
    importFile: (filePath: string, profileId: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke(IPC_CHANNELS.MODPACK_IMPORT_FILE, filePath, profileId),
    selectFile: (): Promise<string | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.MODPACK_SELECT_FILE),
  },

  // HyeniHelper APIs
  hyeni: {
    checkForUpdate: (profilePath: string, gameVersion: string, loaderType: string): Promise<any> =>
      ipcRenderer.invoke('hyeni:check-for-update', profilePath, gameVersion, loaderType),
    
    installUpdate: (profilePath: string, updateInfo: any): Promise<{ success: boolean; message?: string }> =>
      ipcRenderer.invoke('hyeni:install-update', profilePath, updateInfo),
  },

  // Launcher update APIs
  launcher: {
    checkForUpdates: (): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('launcher:check-for-updates'),
    
    downloadUpdate: (): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('launcher:download-update'),
    
    quitAndInstall: (): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('launcher:quit-and-install'),
    
    getVersion: (): Promise<{ success: boolean; version: string }> =>
      ipcRenderer.invoke('launcher:get-version'),
  },

  // Event listeners
  on: (channel: string, callback: (...args: any[]) => void) => {
    // Validate channel is in our allowed list
    if (Object.values(IPC_EVENTS).includes(channel as any)) {
      const subscription = (_event: any, ...args: any[]) => callback(...args);
      ipcRenderer.on(channel, subscription);
      return () => {
        ipcRenderer.removeListener(channel, subscription);
      };
    }
    console.warn(`Attempted to listen to invalid channel: ${channel}`);
    return () => {};
  },

  once: (channel: string, callback: (...args: any[]) => void) => {
    if (Object.values(IPC_EVENTS).includes(channel as any)) {
      ipcRenderer.once(channel, (_event: any, ...args: any[]) => callback(...args));
    }
  },

  off: (channel: string, callback: (...args: any[]) => void) => {
    if (Object.values(IPC_EVENTS).includes(channel as any)) {
      ipcRenderer.removeListener(channel, callback);
    }
  },
});

// Type definitions for window
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
      system: {
        getPath: (name: string) => Promise<string>;
        getMemory: () => Promise<number>;
      };
      game: {
        stop: (versionId: string) => Promise<{ success: boolean }>;
        isRunning: (versionId: string) => Promise<boolean>;
        getActive: () => Promise<Array<{ profileId?: string; versionId: string; startTime: Date; pid: number }>>;
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
      settings: {
        get: () => Promise<any>;
        update: (settings: any) => Promise<{ ok: boolean }>;
        resetCache: () => Promise<{ success: boolean; message: string }>;
        getCacheStats: () => Promise<{ size: number; files: number }>;
        export: () => Promise<string>;
        import: (data: string) => Promise<{ success: boolean; message: string }>;
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
