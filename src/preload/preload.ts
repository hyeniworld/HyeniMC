import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, IPC_EVENTS } from '../shared/constants';
import type { Profile, CreateProfileData } from '../shared/types';

// Expose protected methods to renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Profile APIs
  profile: {
    create: (data: CreateProfileData): Promise<Profile> => 
      ipcRenderer.invoke(IPC_CHANNELS.PROFILE_CREATE, data),
    
    list: (): Promise<Profile[]> => 
      ipcRenderer.invoke(IPC_CHANNELS.PROFILE_LIST),
    
    get: (id: string): Promise<Profile> => 
      ipcRenderer.invoke(IPC_CHANNELS.PROFILE_GET, id),
    
    update: (id: string, data: Partial<CreateProfileData>): Promise<Profile> => 
      ipcRenderer.invoke(IPC_CHANNELS.PROFILE_UPDATE, id, data),
    
    delete: (id: string): Promise<void> => 
      ipcRenderer.invoke(IPC_CHANNELS.PROFILE_DELETE, id),
    
    launch: (id: string): Promise<void> => 
      ipcRenderer.invoke(IPC_CHANNELS.PROFILE_LAUNCH, id),
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
        create: (data: CreateProfileData) => Promise<Profile>;
        list: () => Promise<Profile[]>;
        get: (id: string) => Promise<Profile>;
        update: (id: string, data: Partial<Profile>) => Promise<Profile>;
        delete: (id: string) => Promise<void>;
        launch: (id: string) => Promise<void>;
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
      on: (channel: string, callback: (...args: any[]) => void) => () => void;
      once: (channel: string, callback: (...args: any[]) => void) => void;
      off: (channel: string, callback: (...args: any[]) => void) => void;
    };
  }
}
