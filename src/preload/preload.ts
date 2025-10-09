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
    list: (): Promise<string[]> => 
      ipcRenderer.invoke(IPC_CHANNELS.VERSION_LIST),
    
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
    
    checkInstalled: (loaderType: string, minecraftVersion: string, loaderVersion: string): Promise<any> =>
      ipcRenderer.invoke(IPC_CHANNELS.LOADER_CHECK_INSTALLED, loaderType, minecraftVersion, loaderVersion),
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
        list: () => Promise<string[]>;
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
        checkInstalled: (loaderType: string, minecraftVersion: string, loaderVersion: string) => Promise<any>;
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
        toggle: (profileId: string, fileName: string, enabled: boolean) => Promise<{ success: boolean }>;
        remove: (profileId: string, fileName: string) => Promise<{ success: boolean }>;
      };
      resourcepack: {
        list: (profileId: string) => Promise<any[]>;
        enable: (profileId: string, fileName: string) => Promise<{ success: boolean }>;
        disable: (profileId: string, fileName: string) => Promise<{ success: boolean }>;
        delete: (profileId: string, fileName: string) => Promise<{ success: boolean }>;
      };
      shaderpack: {
        list: (profileId: string) => Promise<any[]>;
        enable: (profileId: string, fileName: string, isDirectory: boolean) => Promise<{ success: boolean }>;
        disable: (profileId: string, fileName: string, isDirectory: boolean) => Promise<{ success: boolean }>;
        delete: (profileId: string, fileName: string, isDirectory: boolean) => Promise<{ success: boolean }>;
      };
      on: (channel: string, callback: (...args: any[]) => void) => () => void;
      once: (channel: string, callback: (...args: any[]) => void) => void;
      off: (channel: string, callback: (...args: any[]) => void) => void;
    };
  }
}
