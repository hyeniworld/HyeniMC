import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { Profile, CreateProfileData } from '../../shared/types';
import axios from 'axios';
import { getBackendAddress } from '../backend/manager';

/**
 * Register profile-related IPC handlers
 */
export function registerProfileHandlers(): void {
  // Create profile
  ipcMain.handle(IPC_CHANNELS.PROFILE_CREATE, async (event, data: CreateProfileData) => {
    try {
      const addr = getBackendAddress();
      if (!addr) {
        throw new Error('Backend server is not running');
      }

      // For now, make HTTP request to backend
      // TODO: Replace with gRPC client when proto code is generated
      const response = await axios.post(`http://${addr}/api/profiles`, data);
      return response.data as Profile;
    } catch (error) {
      console.error('[IPC Profile] Create failed:', error);
      throw error;
    }
  });

  // List profiles
  ipcMain.handle(IPC_CHANNELS.PROFILE_LIST, async () => {
    try {
      const addr = getBackendAddress();
      if (!addr) {
        throw new Error('Backend server is not running');
      }

      // TODO: Replace with gRPC client
      const response = await axios.get(`http://${addr}/api/profiles`);
      return response.data as Profile[];
    } catch (error) {
      console.error('[IPC Profile] List failed:', error);
      throw error;
    }
  });

  // Get profile
  ipcMain.handle(IPC_CHANNELS.PROFILE_GET, async (event, id: string) => {
    try {
      const addr = getBackendAddress();
      if (!addr) {
        throw new Error('Backend server is not running');
      }

      // TODO: Replace with gRPC client
      const response = await axios.get(`http://${addr}/api/profiles/${id}`);
      return response.data as Profile;
    } catch (error) {
      console.error('[IPC Profile] Get failed:', error);
      throw error;
    }
  });

  // Update profile
  ipcMain.handle(IPC_CHANNELS.PROFILE_UPDATE, async (event, id: string, data: Partial<Profile>) => {
    try {
      const addr = getBackendAddress();
      if (!addr) {
        throw new Error('Backend server is not running');
      }

      // TODO: Replace with gRPC client
      const response = await axios.patch(`http://${addr}/api/profiles/${id}`, data);
      return response.data as Profile;
    } catch (error) {
      console.error('[IPC Profile] Update failed:', error);
      throw error;
    }
  });

  // Delete profile
  ipcMain.handle(IPC_CHANNELS.PROFILE_DELETE, async (event, id: string) => {
    try {
      const addr = getBackendAddress();
      if (!addr) {
        throw new Error('Backend server is not running');
      }

      // TODO: Replace with gRPC client
      await axios.delete(`http://${addr}/api/profiles/${id}`);
      
      // Delete profile instance directory (game files, saves, etc.)
      const { getProfileInstanceDir } = await import('../utils/paths');
      const instanceDir = getProfileInstanceDir(id);
      
      const fs = await import('fs/promises');
      try {
        await fs.rm(instanceDir, { recursive: true, force: true });
        console.log(`[IPC Profile] Deleted instance directory: ${instanceDir}`);
      } catch (err) {
        console.warn(`[IPC Profile] Failed to delete instance directory:`, err);
        // Don't throw - profile is already deleted from backend
      }
      
      console.log('[IPC Profile] Profile deleted successfully');
      return { success: true };
    } catch (error) {
      console.error('[IPC Profile] Failed to delete:', error);
      throw new Error(error instanceof Error ? error.message : '프로필 삭제에 실패했습니다');
    }
  });

  // Launch profile
  ipcMain.handle(IPC_CHANNELS.PROFILE_LAUNCH, async (event, id: string) => {
    try {
      console.log('[IPC Profile] Launching profile:', id);
      
      const addr = getBackendAddress();
      if (!addr) {
        throw new Error('Backend server is not running');
      }

      // Get profile
      const response = await axios.get(`http://${addr}/api/profiles/${id}`);
      const profile = response.data;
      
      console.log(`[IPC Profile] Profile: ${profile.name}, Version: ${profile.gameVersion}`);

      // Import game launcher modules
      const { detectJavaInstallations } = await import('../services/java-detector');
      const { VersionManager } = await import('../services/version-manager');
      const path = await import('path');
      const { app, BrowserWindow } = await import('electron');

      // Detect Java
      console.log('[IPC Profile] Detecting Java installations...');
      const javaInstallations = await detectJavaInstallations();
      
      if (javaInstallations.length === 0) {
        throw new Error('Java를 찾을 수 없습니다. Java를 설치해주세요.');
      }

      // Select appropriate Java (prefer Java 17+)
      const java = javaInstallations.find(j => j.majorVersion >= 17) || javaInstallations[0];
      console.log(`[IPC Profile] Using Java ${java.version} at ${java.path}`);

      // Get profile-specific instance directory
      const { getProfileInstanceDir, getSharedLibrariesDir, getSharedAssetsDir } = await import('../utils/paths');
      const instanceDir = getProfileInstanceDir(id);
      const sharedLibrariesDir = getSharedLibrariesDir();
      const sharedAssetsDir = getSharedAssetsDir();
      
      console.log(`[IPC Profile] Instance directory: ${instanceDir}`);
      console.log(`[IPC Profile] Shared libraries: ${sharedLibrariesDir}`);
      console.log(`[IPC Profile] Shared assets: ${sharedAssetsDir}`);
      
      // Create instance directory if it doesn't exist
      const fs = await import('fs/promises');
      await fs.mkdir(instanceDir, { recursive: true });
      
      // Use custom VersionManager with shared resources
      const versionManager = new VersionManager(instanceDir, sharedLibrariesDir, sharedAssetsDir);
      const window = BrowserWindow.fromWebContents(event.sender);
      
      console.log(`[IPC Profile] Ensuring ${profile.gameVersion} is fully downloaded...`);
      
      // Download (will skip files that already exist with correct checksum)
      await versionManager.downloadVersion(profile.gameVersion, (progress) => {
        if (window) {
          window.webContents.send('download:progress', {
            versionId: profile.gameVersion,
            ...progress,
          });
        }
      });
      
      console.log('[IPC Profile] Download verification completed');

      // Launch game using IPC
      const { IPC_CHANNELS: IPC } = await import('../../shared/constants');
      const launchOptions = {
        versionId: profile.gameVersion,
        javaPath: java.path,
        gameDir: instanceDir,
        minMemory: 512,
        maxMemory: 4096,
        username: 'Player',
      };

      console.log('[IPC Profile] Launching game...');
      
      // Import game launcher
      const { GameLauncher } = await import('../services/game-launcher');
      const launcher = new GameLauncher();
      
      const gameProcess = await launcher.launch(
        launchOptions,
        (log) => {
          if (window) {
            window.webContents.send('game:log', {
              versionId: profile.gameVersion,
              line: log,
            });
          }
        },
        (code) => {
          if (window) {
            window.webContents.send('game:stopped', {
              versionId: profile.gameVersion,
              code,
            });
          }
        }
      );

      if (window) {
        window.webContents.send('game:started', {
          versionId: profile.gameVersion,
        });
      }

      console.log(`[IPC Profile] Game launched successfully!`);
      return { success: true, message: '게임이 시작되었습니다!' };
    } catch (error) {
      console.error('[IPC Profile] Failed to launch:', error);
      throw new Error(error instanceof Error ? error.message : '게임 실행에 실패했습니다');
    }
  });
}
