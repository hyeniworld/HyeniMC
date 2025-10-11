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
    detect: (): Promise<Array<{
      path: string;
      version: string;
      majorVersion: number;
      vendor?: string;
      architecture: string;
    }>> => 
      ipcRenderer.invoke(IPC_CHANNELS.JAVA_DETECT),
    
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
    getDetails: (modId: string): Promise<any> =>
      ipcRenderer.invoke(IPC_CHANNELS.MOD_GET_DETAILS, modId),
    getVersions: (modId: string, gameVersion?: string, loaderType?: string): Promise<any[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.MOD_GET_VERSIONS, modId, gameVersion, loaderType),
    install: (profileId: string, modId: string, versionId: string): Promise<{ success: boolean; fileName: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.MOD_INSTALL, profileId, modId, versionId),
    checkDependencies: (profileId: string, versionId: string, gameVersion: string, loaderType: string): Promise<any> =>
      ipcRenderer.invoke(IPC_CHANNELS.MOD_CHECK_DEPENDENCIES, profileId, versionId, gameVersion, loaderType),
    installDependencies: (profileId: string, dependencies: any[]): Promise<any> =>
      ipcRenderer.invoke(IPC_CHANNELS.MOD_INSTALL_DEPENDENCIES, profileId, dependencies),
    checkUpdates: (profileId: string, gameVersion: string, loaderType: string): Promise<any[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.MOD_CHECK_UPDATES, profileId, gameVersion, loaderType),
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
    validateFile: (filePath: string): Promise<any> =>
      ipcRenderer.invoke(IPC_CHANNELS.MODPACK_VALIDATE_FILE, filePath),
    extractMetadata: (filePath: string): Promise<any> =>
      ipcRenderer.invoke(IPC_CHANNELS.MODPACK_EXTRACT_METADATA, filePath),
    importFile: (filePath: string, profileId: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke(IPC_CHANNELS.MODPACK_IMPORT_FILE, filePath, profileId),
    selectFile: (): Promise<string | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.MODPACK_SELECT_FILE),
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
        detect: () => Promise<Array<{
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
      };
      game: {
        stop: (versionId: string) => Promise<{ success: boolean }>;
        isRunning: (versionId: string) => Promise<boolean>;
        getActive: () => Promise<Array<{ profileId?: string; versionId: string; startTime: Date; pid: number }>>;
      };
      mod: {
        list: (profileId: string) => Promise<any[]>;
        search: (query: string, filters?: any) => Promise<{ hits: any[]; total: number }>;
        getDetails: (modId: string) => Promise<any>;
        getVersions: (modId: string, gameVersion?: string, loaderType?: string) => Promise<any[]>;
        install: (profileId: string, modId: string, versionId: string) => Promise<{ success: boolean; fileName: string }>;
        checkDependencies: (profileId: string, versionId: string, gameVersion: string, loaderType: string) => Promise<any>;
        installDependencies: (profileId: string, dependencies: any[]) => Promise<any>;
        checkUpdates: (profileId: string, gameVersion: string, loaderType: string) => Promise<any[]>;
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
        selectFile: () => Promise<string | null>;
      };
      shaderpack: {
        list: (profileId: string) => Promise<any[]>;
        enable: (profileId: string, fileName: string, isDirectory: boolean) => Promise<{ success: boolean }>;
        disable: (profileId: string, fileName: string, isDirectory: boolean) => Promise<{ success: boolean }>;
        delete: (profileId: string, fileName: string, isDirectory: boolean) => Promise<{ success: boolean }>;
      };
      modpack: {
        search: (query: string, gameVersion?: string) => Promise<any[]>;
        getVersions: (modpackId: string, gameVersion?: string) => Promise<any[]>;
        install: (profileId: string, versionId: string) => Promise<{ success: boolean }>;
        validateFile: (filePath: string) => Promise<any>;
        extractMetadata: (filePath: string) => Promise<any>;
        importFile: (filePath: string, profileId: string) => Promise<{ success: boolean }>;
        selectFile: () => Promise<string | null>;
      };
      on: (channel: string, callback: (...args: any[]) => void) => () => void;
      once: (channel: string, callback: (...args: any[]) => void) => void;
      off: (channel: string, callback: (...args: any[]) => void) => void;
    };
  }
}
