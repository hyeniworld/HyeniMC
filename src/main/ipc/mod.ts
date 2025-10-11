import { ipcMain } from 'electron';
import { downloadRpc, modRpc } from '../grpc/clients';
import { IPC_CHANNELS } from '../../shared/constants';
import { ModManager } from '../services/mod-manager';
import { ModrinthAPI } from '../services/modrinth-api';
import { CurseForgeAPI } from '../services/curseforge-api';
import { DependencyResolver } from '../services/dependency-resolver';
import { ModUpdater } from '../services/mod-updater';
import { getProfileInstanceDir } from '../utils/paths';
import type { ModSearchFilters } from '../../shared/types/profile';

const modrinthAPI = new ModrinthAPI();
const curseforgeAPI = new CurseForgeAPI();
const dependencyResolver = new DependencyResolver();
const modUpdater = new ModUpdater();

/**
 * Register mod-related IPC handlers
 */
export function registerModHandlers(): void {
  // List mods for a profile (cache-based)
  ipcMain.handle(IPC_CHANNELS.MOD_LIST, async (_event, profileId: string, forceRefresh = false) => {
    try {
      console.log(`[IPC Mod] Listing mods for profile: ${profileId} (forceRefresh: ${forceRefresh})`);
      const result = await modRpc.listMods({ profileId, forceRefresh });
      
      return (result.mods || []).map(mod => ({
        id: mod.id,
        fileName: mod.fileName,
        name: mod.name || mod.fileName,
        version: mod.version || 'Unknown',
        description: mod.description || '',
        authors: mod.authors || [],
        enabled: mod.enabled,
        modId: mod.modId,
        source: mod.source,
        fileSize: mod.fileSize,
      }));
    } catch (error) {
      console.error('[IPC Mod] Failed to list mods:', error);
      throw error;
    }
  });

  // Toggle mod (enable/disable)
  ipcMain.handle(IPC_CHANNELS.MOD_TOGGLE, async (_event, profileId: string, modIdOrFileName: string, enabled: boolean) => {
    try {
      console.log(`[IPC Mod] Toggling mod: ${modIdOrFileName} -> ${enabled}`);
      
      // If it's a fileName, find the mod ID first
      let modId = modIdOrFileName;
      if (modIdOrFileName.includes('.jar')) {
        const result = await modRpc.listMods({ profileId, forceRefresh: false });
        const mod = (result.mods || []).find(m => m.fileName === modIdOrFileName);
        if (!mod) {
          throw new Error(`Mod not found: ${modIdOrFileName}`);
        }
        modId = mod.id;
      }
      
      const toggleResult = await modRpc.toggleMod({ modId, enabled });
      return { success: toggleResult.success };
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

  // Search mods
  ipcMain.handle(IPC_CHANNELS.MOD_SEARCH, async (_event, query: string, filters?: ModSearchFilters) => {
    try {
      console.log(`[IPC Mod] Searching mods: "${query}"`, filters);
      
      const source = filters?.source || 'modrinth';
      
      if (source === 'curseforge') {
        if (!curseforgeAPI.isConfigured()) {
          throw new Error('CurseForge API key not configured');
        }
        const result = await curseforgeAPI.searchMods(query, filters);
        return result;
      } else {
        const result = await modrinthAPI.searchMods(query, filters);
        return result;
      }
    } catch (error) {
      console.error('[IPC Mod] Failed to search mods:', error);
      throw error;
    }
  });

  // Get mod details
  ipcMain.handle(IPC_CHANNELS.MOD_GET_DETAILS, async (_event, modId: string) => {
    try {
      console.log(`[IPC Mod] Getting mod details: ${modId}`);
      const details = await modrinthAPI.getModDetails(modId);
      return details;
    } catch (error) {
      console.error('[IPC Mod] Failed to get mod details:', error);
      throw error;
    }
  });

  // Get mod versions
  ipcMain.handle(IPC_CHANNELS.MOD_GET_VERSIONS, async (_event, modId: string, gameVersion?: string, loaderType?: string) => {
    try {
      console.log(`[IPC Mod] Getting mod versions: ${modId}`, { gameVersion, loaderType });
      const versions = await modrinthAPI.getModVersions(modId, gameVersion, loaderType as any);
      return versions;
    } catch (error) {
      console.error('[IPC Mod] Failed to get mod versions:', error);
      throw error;
    }
  });

  // Install mod
  ipcMain.handle(IPC_CHANNELS.MOD_INSTALL, async (_event, profileId: string, modId: string, versionId: string) => {
    try {
      console.log(`[IPC Mod] Installing mod ${modId} version: ${versionId} to profile: ${profileId}`);
      const gameDir = getProfileInstanceDir(profileId);
      const modsDir = `${gameDir}/mods`;
      
      // Ensure mods directory exists
      const fs = await import('fs/promises');
      await fs.mkdir(modsDir, { recursive: true });
      
      // Get all versions to find the specific one
      const versions = await modrinthAPI.getModVersions(modId);
      const version = versions.find(v => v.id === versionId);
      
      if (!version || !version.downloadUrl) {
        throw new Error('Version not found or no download URL');
      }

      const destPath = `${modsDir}/${version.fileName}`;
      const req: any = {
        taskId: `mod-${version.id}`,
        url: version.downloadUrl,
        destPath,
        profileId,
        type: 'mod',
        name: version.fileName,
        maxRetries: 3,
        concurrency: 1,
      };
      if (version.sha1) {
        req.checksum = { algo: 'sha1', value: version.sha1 };
      }

      const started = await downloadRpc.startDownload(req);
      await new Promise<void>((resolve, reject) => {
        const cancel = downloadRpc.streamProgress(
          { profileId } as any,
          (ev) => {
            if (ev.taskId !== started.taskId) return;
            if (ev.status === 'completed') { cancel(); resolve(); }
            else if (ev.status === 'failed' || ev.status === 'cancelled') { cancel(); reject(new Error(ev.error || '다운로드 실패')); }
          },
          (err) => {
            if (err && ('' + err).includes('CANCELLED')) return;
            if (err) reject(err);
          }
        );
      });

      console.log(`[IPC Mod] Mod installed successfully: ${version.fileName}`);
      return { success: true, fileName: version.fileName };
    } catch (error) {
      console.error('[IPC Mod] Failed to install mod:', error);
      throw error;
    }
  });

  // Check mod dependencies
  ipcMain.handle(IPC_CHANNELS.MOD_CHECK_DEPENDENCIES, async (_event, profileId: string, versionId: string, gameVersion: string, loaderType: string) => {
    try {
      console.log(`[IPC Mod] Checking dependencies for version: ${versionId}`);
      const gameDir = getProfileInstanceDir(profileId);
      const modManager = new ModManager();
      const installedMods = await modManager.listMods(gameDir);
      
      const result = await dependencyResolver.resolveDependencies(
        versionId,
        gameVersion,
        loaderType,
        installedMods
      );
      
      console.log(`[IPC Mod] Found ${result.dependencies.length} dependencies, ${result.issues.length} issues`);
      return result;
    } catch (error) {
      console.error('[IPC Mod] Failed to check dependencies:', error);
      throw error;
    }
  });

  // Install mod dependencies
  ipcMain.handle(IPC_CHANNELS.MOD_INSTALL_DEPENDENCIES, async (_event, profileId: string, dependencies: any[]) => {
    try {
      console.log(`[IPC Mod] Installing ${dependencies.length} dependencies`);
      const gameDir = getProfileInstanceDir(profileId);
      
      const result = await dependencyResolver.installDependencies(
        dependencies,
        gameDir,
        (current, total, modName) => {
          console.log(`[IPC Mod] Installing dependency ${current}/${total}: ${modName}`);
        }
      );
      
      console.log(`[IPC Mod] Installed ${result.success.length} dependencies, ${result.failed.length} failed`);
      return result;
    } catch (error) {
      console.error('[IPC Mod] Failed to install dependencies:', error);
      throw error;
    }
  });

  // Check for mod updates
  ipcMain.handle(IPC_CHANNELS.MOD_CHECK_UPDATES, async (_event, profileId: string, gameVersion: string, loaderType: string) => {
    try {
      console.log(`[IPC Mod] Checking mod updates for profile: ${profileId}`);
      const gameDir = getProfileInstanceDir(profileId);
      
      const updates = await modUpdater.checkUpdates(gameDir, gameVersion, loaderType);
      
      console.log(`[IPC Mod] Found ${updates.length} updates`);
      return updates;
    } catch (error) {
      console.error('[IPC Mod] Failed to check updates:', error);
      throw error;
    }
  });

  // Update a single mod
  ipcMain.handle(IPC_CHANNELS.MOD_UPDATE, async (_event, profileId: string, update: any) => {
    try {
      console.log(`[IPC Mod] Updating mod: ${update.modName}`);
      const gameDir = getProfileInstanceDir(profileId);
      
      await modUpdater.updateMod(gameDir, update);
      
      console.log(`[IPC Mod] Successfully updated ${update.modName}`);
      return { success: true };
    } catch (error) {
      console.error('[IPC Mod] Failed to update mod:', error);
      throw error;
    }
  });

  // Update all mods
  ipcMain.handle(IPC_CHANNELS.MOD_UPDATE_ALL, async (_event, profileId: string, updates: any[]) => {
    try {
      console.log(`[IPC Mod] Updating ${updates.length} mods`);
      const gameDir = getProfileInstanceDir(profileId);
      
      const result = await modUpdater.updateMods(
        gameDir,
        updates,
        (current, total, modName) => {
          console.log(`[IPC Mod] Updating ${current}/${total}: ${modName}`);
        }
      );
      
      console.log(`[IPC Mod] Updated ${result.success.length} mods, ${result.failed.length} failed`);
      return result;
    } catch (error) {
      console.error('[IPC Mod] Failed to update mods:', error);
      throw error;
    }
  });

  console.log('[IPC Mod] Mod handlers registered');
}
