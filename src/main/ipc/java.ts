import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { detectJavaInstallations, getCachedJavaInstallations, getRecommendedJavaVersion, isJavaCompatible } from '../services/java-detector';

/**
 * Register Java-related IPC handlers
 */
export function registerJavaHandlers(): void {
  // Detect Java installations (with force refresh option)
  ipcMain.handle(IPC_CHANNELS.JAVA_DETECT, async (event, forceRefresh = false) => {
    try {
      console.log(`[IPC Java] Detecting Java installations (forceRefresh: ${forceRefresh})`);
      const installations = await detectJavaInstallations(forceRefresh);
      console.log(`[IPC Java] Found ${installations.length} Java installation(s)`);
      return installations;
    } catch (err) {
      console.error('[IPC Java] Failed to detect Java:', err);
      throw new Error(err instanceof Error ? err.message : 'Failed to detect Java');
    }
  });

  // Get cached Java installations (no re-detection)
  ipcMain.handle('java:get-cached', async () => {
    try {
      const installations = getCachedJavaInstallations();
      console.log(`[IPC Java] Returning ${installations.length} cached Java installation(s)`);
      return installations;
    } catch (err) {
      console.error('[IPC Java] Failed to get cached Java:', err);
      throw new Error(err instanceof Error ? err.message : 'Failed to get cached Java');
    }
  });

  // Get recommended Java version for Minecraft version
  ipcMain.handle(IPC_CHANNELS.JAVA_GET_RECOMMENDED, async (event, minecraftVersion: string) => {
    try {
      console.log('[IPC Java] Get recommended Java version for:', minecraftVersion);
      const recommendedVersion = getRecommendedJavaVersion(minecraftVersion);
      console.log(`[IPC Java] Recommended Java version: ${recommendedVersion}`);
      return recommendedVersion;
    } catch (err) {
      console.error('[IPC Java] Failed to get recommended version:', err);
      throw new Error(err instanceof Error ? err.message : 'Failed to get recommended Java version');
    }
  });

  // Check Java compatibility
  ipcMain.handle(IPC_CHANNELS.JAVA_CHECK_COMPATIBILITY, async (event, javaVersion: number, minecraftVersion: string) => {
    try {
      console.log(`[IPC Java] Checking compatibility: Java ${javaVersion} with Minecraft ${minecraftVersion}`);
      const compatible = isJavaCompatible(javaVersion, minecraftVersion);
      console.log(`[IPC Java] Compatible: ${compatible}`);
      return compatible;
    } catch (err) {
      console.error('[IPC Java] Failed to check compatibility:', err);
      throw new Error(err instanceof Error ? err.message : 'Failed to check Java compatibility');
    }
  });
}
