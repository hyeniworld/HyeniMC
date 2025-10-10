import { ipcMain, dialog } from 'electron';
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

  // Select file dialog for installing a resource pack
  ipcMain.handle(IPC_CHANNELS.RESOURCEPACK_SELECT_FILE, async () => {
    const result = await dialog.showOpenDialog({
      title: '리소스팩 파일 선택',
      properties: ['openFile'],
      filters: [
        { name: 'Zip', extensions: ['zip'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // Install a resource pack from a given file path
  ipcMain.handle(IPC_CHANNELS.RESOURCEPACK_INSTALL, async (_event, profileId: string, filePath: string) => {
    try {
      const gameDir = getProfileInstanceDir(profileId);
      const packManager = new ResourcePackManager();
      await packManager.installPack(gameDir, filePath);
      return { success: true };
    } catch (error) {
      console.error('[IPC ResourcePack] Failed to install pack:', error);
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
