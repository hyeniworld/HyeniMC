import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { fetchMinecraftVersions, getLatestMinecraftVersion } from '../services/minecraft-api';

/**
 * Register version-related IPC handlers
 */
export function registerVersionHandlers(): void {
  // Get Minecraft versions
  ipcMain.handle(IPC_CHANNELS.VERSION_LIST, async () => {
    try {
      console.log('[IPC Version] Fetching Minecraft versions');
      const versions = await fetchMinecraftVersions();
      console.log(`[IPC Version] Fetched ${versions.length} versions`);
      return versions;
    } catch (err) {
      console.error('[IPC Version] Failed to fetch versions:', err);
      throw new Error(err instanceof Error ? err.message : 'Failed to fetch versions');
    }
  });

  // Get latest Minecraft version
  ipcMain.handle(IPC_CHANNELS.VERSION_LATEST, async () => {
    try {
      console.log('[IPC Version] Fetching latest Minecraft version');
      const version = await getLatestMinecraftVersion();
      console.log(`[IPC Version] Latest version: ${version}`);
      return version;
    } catch (err) {
      console.error('[IPC Version] Failed to fetch latest version:', err);
      throw new Error(err instanceof Error ? err.message : 'Failed to fetch latest version');
    }
  });
}
