import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { LoaderManager } from '../services/loader-manager';
import { LoaderType } from '../../shared/types/profile';
import { app } from 'electron';
import * as path from 'path';

let loaderManager: LoaderManager | null = null;

function getLoaderManager(): LoaderManager {
  if (!loaderManager) {
    loaderManager = new LoaderManager();
  }
  return loaderManager;
}

/**
 * 로더 관련 IPC 핸들러 등록
 */
export function registerLoaderHandlers(): void {
  // 로더 버전 목록 가져오기
  ipcMain.handle(
    IPC_CHANNELS.LOADER_GET_VERSIONS,
    async (event, loaderType: LoaderType, minecraftVersion?: string, includeUnstable = false) => {
      try {
        console.log(`[IPC Loader] Getting versions for ${loaderType}${minecraftVersion ? ` (MC ${minecraftVersion})` : ''} (includeUnstable: ${includeUnstable})`);
        const manager = getLoaderManager();
        const versions = await manager.getLoaderVersions(loaderType, minecraftVersion, includeUnstable);
        return { success: true, versions };
      } catch (err) {
        console.error('[IPC Loader] Failed to get versions:', err);
        throw new Error(err instanceof Error ? err.message : 'Failed to get loader versions');
      }
    }
  );

  // 권장 로더 버전 가져오기
  ipcMain.handle(
    IPC_CHANNELS.LOADER_GET_RECOMMENDED,
    async (event, loaderType: LoaderType, minecraftVersion: string) => {
      try {
        console.log(`[IPC Loader] Getting recommended ${loaderType} version for MC ${minecraftVersion}`);
        const manager = getLoaderManager();
        const version = await manager.getRecommendedVersion(loaderType, minecraftVersion);
        return { success: true, version };
      } catch (err) {
        console.error('[IPC Loader] Failed to get recommended version:', err);
        throw new Error(err instanceof Error ? err.message : 'Failed to get recommended version');
      }
    }
  );

  // 로더 설치
  ipcMain.handle(
    IPC_CHANNELS.LOADER_INSTALL,
    async (
      event,
      loaderType: LoaderType,
      minecraftVersion: string,
      loaderVersion: string
    ) => {
      try {
        console.log(`[IPC Loader] Installing ${loaderType} ${loaderVersion} for MC ${minecraftVersion}`);
        const manager = getLoaderManager();
        const gameDir = path.join(app.getPath('userData'), 'game');
        
        const mainWindow = BrowserWindow.fromWebContents(event.sender);
        
        const versionId = await manager.installLoader(
          loaderType,
          minecraftVersion,
          loaderVersion,
          gameDir,
          (message, current, total) => {
            // 진행률을 렌더러에 전송
            if (mainWindow) {
              mainWindow.webContents.send('loader:install-progress', {
                loaderType,
                message,
                current,
                total,
                progress: (current / total) * 100,
              });
            }
          }
        );
        
        console.log(`[IPC Loader] Installation completed: ${versionId}`);
        return { success: true, versionId };
      } catch (err) {
        console.error('[IPC Loader] Failed to install:', err);
        throw new Error(err instanceof Error ? err.message : 'Failed to install loader');
      }
    }
  );

  // 로더 설치 여부 확인
  ipcMain.handle(
    IPC_CHANNELS.LOADER_CHECK_INSTALLED,
    async (
      event,
      loaderType: LoaderType,
      minecraftVersion: string,
      loaderVersion: string
    ) => {
      try {
        console.log(`[IPC Loader] Checking if ${loaderType} ${loaderVersion} is installed`);
        const manager = getLoaderManager();
        const gameDir = path.join(app.getPath('userData'), 'game');
        
        const installed = await manager.isLoaderInstalled(
          loaderType,
          minecraftVersion,
          loaderVersion,
          gameDir
        );
        
        return { success: true, installed };
      } catch (err) {
        console.error('[IPC Loader] Failed to check installation:', err);
        return { success: false, installed: false };
      }
    }
  );
}
