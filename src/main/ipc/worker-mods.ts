/**
 * Worker Mods IPC Handlers
 * 
 * Handles IPC communication for multi-mod updates from Worker API
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS, IPC_EVENTS } from '../../shared/constants/ipc';
import { WorkerModRegistry } from '../services/worker-mod-registry';
import type { WorkerModUpdateCheck } from '../../shared/types/worker-mods';

const registry = new WorkerModRegistry();

export function registerWorkerModsHandlers() {
  /**
   * Check for updates across all mods
   */
  ipcMain.handle(
    IPC_CHANNELS.WORKER_MODS_CHECK_UPDATES,
    async (
      _event,
      profilePath: string,
      gameVersion: string,
      loaderType: string,
      serverAddress?: string
    ) => {
      try {
        const updates = await registry.checkAllModUpdates(
          profilePath,
          gameVersion,
          loaderType,
          serverAddress
        );
        
        return updates;
      } catch (error) {
        console.error('[Worker Mods IPC] 업데이트 확인 실패:', error);
        throw error;
      }
    }
  );

  /**
   * Install multiple mods
   */
  ipcMain.handle(
    IPC_CHANNELS.WORKER_MODS_INSTALL_MULTIPLE,
    async (
      event,
      profilePath: string,
      updates: WorkerModUpdateCheck[]
    ) => {
      try {
        const results = await registry.installMultipleMods(
          profilePath,
          updates,
          (modId, progress) => {
            // Send progress event
            event.sender.send(IPC_EVENTS.WORKER_MODS_INSTALL_PROGRESS, {
              modId,
              progress
            });
          }
        );
        
        // Send completion event
        event.sender.send(IPC_EVENTS.WORKER_MODS_UPDATE_COMPLETE, {
          results
        });
        
        return results;
      } catch (error) {
        console.error('[Worker Mods IPC] 설치 실패:', error);
        throw error;
      }
    }
  );
}
