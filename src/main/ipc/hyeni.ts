/**
 * IPC handlers for HyeniHelper mod updates
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants/ipc';
import { hyeniUpdater, HyeniHelperUpdateInfo } from '../services/hyeni-updater';

export function registerHyeniHandlers() {
  /**
   * Check for HyeniHelper update
   */
  ipcMain.handle(
    IPC_CHANNELS.HYENI_CHECK_UPDATE,
    async (
      _event,
      profilePath: string,
      gameVersion: string,
      loaderType: string,
      serverAddress?: string
    ): Promise<HyeniHelperUpdateInfo | null> => {
      try {
        console.log(`[IPC] Checking HyeniHelper update for profile: ${profilePath}${serverAddress ? ` (server: ${serverAddress})` : ''}`);
        
        const updateInfo = await hyeniUpdater.checkHyeniHelperUpdate(
          profilePath,
          gameVersion,
          loaderType,
          serverAddress
        );
        
        if (updateInfo) {
          console.log(`[IPC] Update available: ${updateInfo.currentVersion} -> ${updateInfo.latestVersion}`);
        } else {
          console.log('[IPC] No update available');
        }
        
        return updateInfo;
      } catch (error) {
        console.error('[IPC] Failed to check for update:', error);
        throw error;
      }
    }
  );

  /**
   * Install HyeniHelper update
   */
  ipcMain.handle(
    IPC_CHANNELS.HYENI_INSTALL_UPDATE,
    async (
      event,
      profilePath: string,
      updateInfo: HyeniHelperUpdateInfo
    ): Promise<{ success: boolean; message?: string }> => {
      try {
        console.log(`[IPC] Installing HyeniHelper update: ${updateInfo.latestVersion}`);
        
        await hyeniUpdater.installUpdate(
          profilePath,
          updateInfo,
          (progress) => {
            // Send progress updates to renderer
            // @deprecated - 레거시, 더 이상 사용되지 않음
            event.sender.send('hyeni:update-progress', progress);
          }
        );
        
        console.log('[IPC] HyeniHelper update installed successfully');
        
        return {
          success: true
        };
      } catch (error) {
        console.error('[IPC] Failed to install update:', error);
        
        return {
          success: false,
          message: error instanceof Error ? error.message : '업데이트 설치에 실패했습니다.'
        };
      }
    }
  );
}
