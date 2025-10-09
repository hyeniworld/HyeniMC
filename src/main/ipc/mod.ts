import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { ModManager } from '../services/mod-manager';
import { getProfileInstanceDir } from '../utils/paths';

/**
 * Register mod-related IPC handlers
 */
export function registerModHandlers(): void {
  // List mods for a profile
  ipcMain.handle(IPC_CHANNELS.MOD_LIST, async (_event, profileId: string) => {
    try {
      const gameDir = getProfileInstanceDir(profileId);
      const modManager = new ModManager();
      const mods = await modManager.listMods(gameDir);
      
      return mods.map(mod => ({
        fileName: mod.fileName,
        name: mod.name,
        version: mod.version,
        description: mod.description,
        authors: mod.authors,
        enabled: mod.enabled,
      }));
    } catch (error) {
      console.error('[IPC Mod] Failed to list mods:', error);
      throw error;
    }
  });

  // Toggle mod (enable/disable)
  ipcMain.handle(IPC_CHANNELS.MOD_TOGGLE, async (_event, profileId: string, fileName: string, enabled: boolean) => {
    try {
      const gameDir = getProfileInstanceDir(profileId);
      const modManager = new ModManager();
      
      if (enabled) {
        await modManager.enableMod(gameDir, fileName);
      } else {
        await modManager.disableMod(gameDir, fileName);
      }
      
      return { success: true };
    } catch (error) {
      console.error('[IPC Mod] Failed to toggle mod:', error);
      throw error;
    }
  });

  // Delete mod
  ipcMain.handle(IPC_CHANNELS.MOD_REMOVE, async (_event, profileId: string, fileName: string) => {
    try {
      const gameDir = getProfileInstanceDir(profileId);
      const modManager = new ModManager();
      await modManager.deleteMod(gameDir, fileName);
      
      return { success: true };
    } catch (error) {
      console.error('[IPC Mod] Failed to delete mod:', error);
      throw error;
    }
  });

  console.log('[IPC Mod] Mod handlers registered');
}
