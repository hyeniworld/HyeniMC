import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { ModpackManager } from '../services/modpack-manager';
import { getProfileInstanceDir } from '../utils/paths';

const modpackManager = new ModpackManager();

/**
 * Register modpack-related IPC handlers
 */
export function registerModpackHandlers(): void {
  // Search modpacks
  ipcMain.handle(IPC_CHANNELS.MODPACK_SEARCH, async (_event, query: string, gameVersion?: string) => {
    try {
      console.log(`[IPC Modpack] Searching modpacks: "${query}"`);
      const results = await modpackManager.searchModpacks(query, gameVersion);
      return results;
    } catch (error) {
      console.error('[IPC Modpack] Failed to search modpacks:', error);
      throw error;
    }
  });

  // Get modpack versions
  ipcMain.handle(IPC_CHANNELS.MODPACK_GET_VERSIONS, async (_event, modpackId: string, gameVersion?: string) => {
    try {
      console.log(`[IPC Modpack] Getting versions for: ${modpackId}`);
      const versions = await modpackManager.getModpackVersions(modpackId, gameVersion);
      return versions;
    } catch (error) {
      console.error('[IPC Modpack] Failed to get versions:', error);
      throw error;
    }
  });

  // Install modpack
  ipcMain.handle(IPC_CHANNELS.MODPACK_INSTALL, async (event, profileId: string, versionId: string) => {
    try {
      console.log(`[IPC Modpack] Installing modpack version: ${versionId} to profile: ${profileId}`);
      const instanceDir = getProfileInstanceDir(profileId);

      await modpackManager.installModpack(
        versionId,
        profileId,
        instanceDir,
        (progress) => {
          // Send progress updates to renderer
          event.sender.send('modpack:install-progress', progress);
        }
      );

      console.log('[IPC Modpack] Modpack installation complete');
      return { success: true };
    } catch (error) {
      console.error('[IPC Modpack] Failed to install modpack:', error);
      throw error;
    }
  });

  console.log('[IPC Modpack] Modpack handlers registered');
}
