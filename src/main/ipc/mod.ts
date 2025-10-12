import { ipcMain } from 'electron';
import { promises as fs } from 'fs';
import { downloadRpc, modRpc } from '../grpc/clients';
import { IPC_CHANNELS } from '../../shared/constants';
import { ModManager } from '../services/mod-manager';
import { ModrinthAPI } from '../services/modrinth-api';
import { CurseForgeAPI } from '../services/curseforge-api';
import { ModAggregator } from '../services/mod-aggregator';
import { DependencyResolver } from '../services/dependency-resolver';
import { ModUpdater } from '../services/mod-updater';
import { getProfileInstanceDir } from '../utils/paths';
import type { ModSearchFilters } from '../../shared/types/profile';

const modrinthAPI = new ModrinthAPI();
const curseforgeAPI = new CurseForgeAPI();
const modAggregator = new ModAggregator();
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

  // Search mods (supports multi-source)
  ipcMain.handle(IPC_CHANNELS.MOD_SEARCH, async (_event, query: string, filters?: ModSearchFilters) => {
    try {
      console.log(`[IPC Mod] Searching mods: "${query}"`, filters);
      
      const source = filters?.source || 'modrinth';  // Default to modrinth to avoid ID conflicts
      
      // Single source search to avoid ID/source conflicts
      if (source === 'curseforge') {
        if (!curseforgeAPI.isConfigured()) {
          console.warn('[IPC Mod] CurseForge not configured, falling back to Modrinth');
          return await modrinthAPI.searchMods(query, filters);
        }
        const result = await curseforgeAPI.searchMods(query, filters);
        console.log(`[IPC Mod] Found ${result.hits.length} CurseForge mods`);
        return result;
      } else if (source === 'modrinth') {
        const result = await modrinthAPI.searchMods(query, filters);
        console.log(`[IPC Mod] Found ${result.hits.length} Modrinth mods`);
        return result;
      } else {
        // Default to Modrinth for 'both' to avoid source conflicts
        const result = await modrinthAPI.searchMods(query, filters);
        console.log(`[IPC Mod] Found ${result.hits.length} mods (defaulting to Modrinth)`);
        return result;
      }
    } catch (error) {
      console.error('[IPC Mod] Failed to search mods:', error);
      throw error;
    }
  });

  // Get mod details
  ipcMain.handle(IPC_CHANNELS.MOD_GET_DETAILS, async (_event, modId: string, source: 'modrinth' | 'curseforge' = 'modrinth') => {
    try {
      console.log(`[IPC Mod] Getting mod details: ${modId} from ${source}`);
      
      if (source === 'curseforge') {
        const details = await curseforgeAPI.getModDetails(modId);
        return details;
      } else {
        const details = await modrinthAPI.getModDetails(modId);
        return details;
      }
    } catch (error) {
      console.error('[IPC Mod] Failed to get mod details:', error);
      throw error;
    }
  });

  // Get mod versions
  ipcMain.handle(IPC_CHANNELS.MOD_GET_VERSIONS, async (_event, modId: string, gameVersion?: string, loaderType?: string, source: 'modrinth' | 'curseforge' = 'modrinth') => {
    try {
      console.log(`[IPC Mod] Getting mod versions: ${modId} from ${source}`, { gameVersion, loaderType });
      
      if (source === 'curseforge') {
        const versions = await curseforgeAPI.getModVersions(modId, gameVersion, loaderType as any);
        return versions;
      } else {
        const versions = await modrinthAPI.getModVersions(modId, gameVersion, loaderType as any);
        return versions;
      }
    } catch (error) {
      console.error('[IPC Mod] Failed to get mod versions:', error);
      throw error;
    }
  });

  // Install mod
  ipcMain.handle(IPC_CHANNELS.MOD_INSTALL, async (_event, profileId: string, modId: string, versionId: string, source: 'modrinth' | 'curseforge' = 'modrinth') => {
    try {
      console.log(`[IPC Mod] Installing mod ${modId} version: ${versionId} from ${source} to profile: ${profileId}`);
      const gameDir = getProfileInstanceDir(profileId);
      const modsDir = `${gameDir}/mods`;
      
      // Ensure mods directory exists
      const fs = await import('fs/promises');
      await fs.mkdir(modsDir, { recursive: true });
      
      // Get version details from appropriate source
      let version;
      if (source === 'curseforge') {
        const versions = await curseforgeAPI.getModVersions(modId);
        version = versions.find(v => v.id === versionId);
      } else {
        const versions = await modrinthAPI.getModVersions(modId);
        version = versions.find(v => v.id === versionId);
      }
      
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
      
      // Save source metadata for update checks
      try {
        const metaPath = `${destPath}.meta.json`;
        const metadata = {
          source: source,
          sourceModId: modId,
          sourceFileId: versionId,
          installedAt: new Date().toISOString(),
        };
        await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2));
        console.log(`[IPC Mod] Saved metadata: ${metaPath}`);
      } catch (metaError) {
        console.error('[IPC Mod] Failed to save metadata:', metaError);
        // Don't fail the installation if metadata save fails
      }
      
      return { success: true, fileName: version.fileName };
    } catch (error) {
      console.error('[IPC Mod] Failed to install mod:', error);
      throw error;
    }
  });

  // Check mod dependencies
  ipcMain.handle(IPC_CHANNELS.MOD_CHECK_DEPENDENCIES, async (_event, profileId: string, modId: string, versionId: string, gameVersion: string, loaderType: string, source: 'modrinth' | 'curseforge' = 'modrinth') => {
    try {
      console.log(`[IPC Mod] Checking dependencies for version: ${versionId} from ${source}`);
      const gameDir = getProfileInstanceDir(profileId);
      const modManager = new ModManager();
      const installedMods = await modManager.listMods(gameDir);
      
      const dependencies: any[] = [];
      const issues: any[] = [];
      
      if (source === 'curseforge') {
        // For CurseForge, get the version directly and extract dependencies
        console.log(`[IPC Mod] Fetching CurseForge versions for modId: ${modId}, versionId: ${versionId}`);
        const versions = await curseforgeAPI.getModVersions(modId, gameVersion, loaderType as any);
        const version = versions.find(v => v.id === versionId);
        
        console.log(`[IPC Mod] Found version:`, version ? 'YES' : 'NO');
        if (version) {
          console.log(`[IPC Mod] Version dependencies:`, version.dependencies);
        }
        
        if (version && version.dependencies && version.dependencies.length > 0) {
          console.log(`[IPC Mod] Found ${version.dependencies.length} CurseForge dependencies`);
          
          for (const dep of version.dependencies) {
            console.log(`[IPC Mod] Processing dependency: ${dep.modId}, type: ${dep.type}`);
            
            // Skip non-required dependencies for now
            if (dep.type !== 'required') {
              console.log(`[IPC Mod] Skipping non-required dependency: ${dep.type}`);
              continue;
            }
            
            // Check if already installed
            const alreadyInstalled = installedMods.some(mod => 
              mod.id === dep.modId || mod.fileName.includes(dep.modId)
            );
            
            if (alreadyInstalled) {
              console.log(`[IPC Mod] Dependency ${dep.modId} already installed`);
              continue;
            }
            
            try {
              // Get dependency details from CurseForge
              const depDetails = await curseforgeAPI.getModDetails(dep.modId);
              const depVersions = await curseforgeAPI.getModVersions(
                dep.modId,
                gameVersion,
                loaderType as any
              );
              
              if (depVersions.length > 0) {
                dependencies.push({
                  modId: dep.modId,
                  modName: depDetails.name,
                  versionId: depVersions[0].id,
                  versionNumber: depVersions[0].versionNumber,
                  required: true,
                  alreadyInstalled: false,
                  source: 'curseforge',
                });
                console.log(`[IPC Mod] Found CurseForge dependency: ${depDetails.name}`);
              } else {
                issues.push({
                  modId: dep.modId,
                  modName: dep.modId,
                  type: 'missing',
                  dependency: dep,
                  message: `호환되는 버전을 찾을 수 없습니다`,
                });
              }
            } catch (error) {
              console.error(`[IPC Mod] Failed to resolve CurseForge dependency ${dep.modId}:`, error);
              issues.push({
                modId: dep.modId,
                modName: dep.modId,
                type: 'missing',
                dependency: dep,
                message: `의존성 정보를 가져올 수 없습니다`,
              });
            }
          }
        }
        
        console.log(`[IPC Mod] Found ${dependencies.length} dependencies, ${issues.length} issues`);
        return { dependencies, issues };
      } else {
        // For Modrinth, use DependencyResolver
        const result = await dependencyResolver.resolveDependencies(
          versionId,
          gameVersion,
          loaderType,
          installedMods,
          source
        );
        
        console.log(`[IPC Mod] Found ${result.dependencies.length} dependencies, ${result.issues.length} issues`);
        return result;
      }
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
      const modsDir = `${gameDir}/mods`;
      const fs = await import('fs/promises');
      
      const success: string[] = [];
      const failed: Array<{ modId: string; error: string }> = [];

      for (const dep of dependencies) {
        try {
          // Get version details
          let versions;
          if (dep.source === 'curseforge') {
            versions = await curseforgeAPI.getModVersions(dep.modId);
          } else {
            versions = await modrinthAPI.getModVersions(dep.modId);
          }
          
          const version = versions.find(v => v.id === dep.versionId);
          
          if (!version || !version.downloadUrl) {
            failed.push({ modId: dep.modId, error: 'Version not found' });
            continue;
          }

          // Download dependency
          const destPath = `${modsDir}/${version.fileName}`;
          const req: any = {
            taskId: `dep-${version.id}`,
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

          const { downloadRpc } = await import('../grpc/clients');
          const started = await downloadRpc.startDownload(req);
          
          await new Promise<void>((resolve, reject) => {
            const cancel = downloadRpc.streamProgress(
              { profileId } as any,
              (ev) => {
                if (ev.taskId !== started.taskId) return;
                if (ev.status === 'completed') { cancel(); resolve(); }
                else if (ev.status === 'failed' || ev.status === 'cancelled') { 
                  cancel(); 
                  reject(new Error(ev.error || '다운로드 실패')); 
                }
              },
              (err) => {
                if (err && ('' + err).includes('CANCELLED')) return;
                if (err) reject(err);
              }
            );
          });

          success.push(dep.modName);
          console.log(`[IPC Mod] Dependency installed: ${version.fileName}`);
          
          // Save source metadata for dependency
          try {
            const metaPath = `${destPath}.meta.json`;
            const metadata = {
              source: dep.source || 'modrinth',
              sourceModId: dep.modId,
              sourceFileId: dep.versionId,
              installedAt: new Date().toISOString(),
              isDependency: true,
            };
            await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2));
            console.log(`[IPC Mod] Saved dependency metadata: ${metaPath}`);
          } catch (metaError) {
            console.error('[IPC Mod] Failed to save dependency metadata:', metaError);
          }
        } catch (error) {
          console.error(`[IPC Mod] Failed to install dependency ${dep.modId}:`, error);
          failed.push({ 
            modId: dep.modId, 
            error: error instanceof Error ? error.message : 'Unknown error' 
          });
        }
      }

      return { success, failed };
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
      
      // Note: Update checking currently only works for Modrinth mods
      // CurseForge update checking requires source metadata to be stored
      const updates = await modUpdater.checkUpdates(gameDir, gameVersion, loaderType);
      
      console.log(`[IPC Mod] Found ${updates.length} updates`);
      return updates;
    } catch (error) {
      console.error('[IPC Mod] Failed to check updates:', error);
      throw error;
    }
  });

  // Update a single mod (개별 업데이트)
  ipcMain.handle('mod:update-single', async (_event, profileId: string, modId: string, versionId: string, source: 'modrinth' | 'curseforge') => {
    try {
      console.log(`[IPC Mod] Updating single mod: ${modId} -> ${versionId} (${source})`);
      const gameDir = getProfileInstanceDir(profileId);
      
      // Get version info
      let version: any;
      if (source === 'curseforge') {
        const versions = await curseforgeAPI.getModVersions(modId, undefined, undefined);
        version = versions.find(v => v.id === versionId) || versions[0];
        if (!version) {
          throw new Error('Version not found');
        }
      } else {
        version = await modrinthAPI.getVersion(versionId);
      }
      
      if (!version) {
        throw new Error('Version not found');
      }
      
      // Prepare download
      const modsDir = `${gameDir}/mods`;
      const destPath = `${modsDir}/${version.fileName}`;
      
      const downloadUrl = version.downloadUrl || version.files?.[0]?.url;
      if (!downloadUrl) {
        throw new Error('Download URL not found');
      }
      
      // Download (same as install)
      const req: any = {
        taskId: `mod-update-${versionId}`,
        url: downloadUrl,
        destPath,
        profileId,
        type: 'mod',
        name: version.fileName,
        maxRetries: 3,
        concurrency: 1,
      };
      if (version.sha1 || version.files?.[0]?.hashes?.sha1) {
        req.checksum = { algo: 'sha1', value: version.sha1 || version.files?.[0]?.hashes?.sha1 };
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
      
      // Save metadata
      const metaPath = `${destPath}.meta.json`;
      const metadata = {
        source,
        sourceModId: modId,
        sourceFileId: versionId,
        installedAt: new Date().toISOString(),
      };
      await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2));
      console.log(`[IPC Mod] Saved metadata: ${metaPath}`);
      
      console.log(`[IPC Mod] Successfully updated mod to ${version.fileName}`);
      return { success: true, fileName: version.fileName };
    } catch (error) {
      console.error('[IPC Mod] Failed to update mod:', error);
      throw error;
    }
  });

  // Update a single mod (legacy)
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
