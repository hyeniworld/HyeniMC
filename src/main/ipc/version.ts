import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { versionRpc } from '../grpc/clients';

/**
 * Register version-related IPC handlers
 */
export function registerVersionHandlers(): void {
  // Get Minecraft versions
  ipcMain.handle(IPC_CHANNELS.VERSION_LIST, async (_event, releaseOnly?: boolean) => {
    try {
      const type = releaseOnly ? 'release' : 'all';
      console.log('[IPC Version] Fetching Minecraft versions via gRPC', { type });
      const res = await versionRpc.listMinecraftVersions({ type } as any);
      const versions = (res.versions || []).map(v => v.id);
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
      console.log('[IPC Version] Fetching latest Minecraft version via gRPC');
      const res = await versionRpc.listMinecraftVersions({ type: 'release' } as any);
      const first = (res.versions || [])[0];
      const latest = first?.id || '';
      console.log(`[IPC Version] Latest version: ${latest}`);
      return latest;
    } catch (err) {
      console.error('[IPC Version] Failed to fetch latest version:', err);
      throw new Error(err instanceof Error ? err.message : 'Failed to fetch latest version');
    }
  });
}
