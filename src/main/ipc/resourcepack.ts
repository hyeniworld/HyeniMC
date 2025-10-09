import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { ResourcePackManager } from '../services/resourcepack-manager';
import { getProfileInstanceDir } from '../utils/paths';

/**
 * Register resource pack-related IPC handlers
 */
export function registerResourcePackHandlers(): void {
  // List resource packs for a profile
  ipcMain.handle(IPC_CHANNELS.RESOURCEPACK_LIST, async (_event, profileId: string) => {
    try {
      const gameDir = getProfileInstanceDir(profileId);
      const packManager = new ResourcePackManager();
      const packs = await packManager.listResourcePacks(gameDir);
      
      return packs.map(pack => ({
        fileName: pack.fileName,
        name: pack.name,
        description: pack.description,
        packFormat: pack.packFormat,
        enabled: pack.enabled,
      }));
    } catch (error) {
      console.error('[IPC ResourcePack] Failed to list resource packs:', error);
      throw error;
    }
  });

  // Enable resource pack
  ipcMain.handle(IPC_CHANNELS.RESOURCEPACK_ENABLE, async (_event, profileId: string, fileName: string) => {
    try {
      const gameDir = getProfileInstanceDir(profileId);
      const packManager = new ResourcePackManager();
      await packManager.enablePack(gameDir, fileName);
      
      return { success: true };
    } catch (error) {
      console.error('[IPC ResourcePack] Failed to enable pack:', error);
      throw error;
    }
  });

  // Disable resource pack
  ipcMain.handle(IPC_CHANNELS.RESOURCEPACK_DISABLE, async (_event, profileId: string, fileName: string) => {
    try {
      const gameDir = getProfileInstanceDir(profileId);
      const packManager = new ResourcePackManager();
      await packManager.disablePack(gameDir, fileName);
      
      return { success: true };
    } catch (error) {
      console.error('[IPC ResourcePack] Failed to disable pack:', error);
      throw error;
    }
  });

  // Delete resource pack
  ipcMain.handle(IPC_CHANNELS.RESOURCEPACK_DELETE, async (_event, profileId: string, fileName: string) => {
    try {
      const gameDir = getProfileInstanceDir(profileId);
      const packManager = new ResourcePackManager();
      await packManager.deletePack(gameDir, fileName);
      
      return { success: true };
    } catch (error) {
      console.error('[IPC ResourcePack] Failed to delete pack:', error);
      throw error;
    }
  });

  console.log('[IPC ResourcePack] Resource pack handlers registered');
}
