/**
 * Worker Mod Auto-Update Service
 * 
 * Manages automatic updates for mods deployed via Cloudflare Worker.
 * Implements Option A (Hybrid) server detection:
 * 1. Priority: UI Profile.serverAddress (explicit control)
 * 2. Fallback: servers.dat auto-detection
 * 3. Skip: if neither HyeniWorld server found
 */

import * as path from 'path';
import * as fs from 'fs-extra';
import { app, net } from 'electron';
import * as crypto from 'crypto';
import * as nbt from 'prismarine-nbt';
import { ENV_CONFIG } from '../config/env-config';
import { isAuthorizedServer } from '../../shared/config/server-config';
import { parseModVersion, isNewerVersion, compareVersions } from '../../shared/utils/version';

// ============================================================================
// Types
// ============================================================================

export interface ModRegistry {
  version: string;
  lastUpdated: string;
  mods: ModInfo[];
}

export interface ModInfo {
  id: string;
  name: string;
  description: string;
  latestVersion: string;
  category: 'required' | 'optional' | 'server-side';
  gameVersions: string[];
  loaders: LoaderCompatibility[];
  dependencies?: {
    required: string[];
    optional: string[];
  };
}

export interface LoaderCompatibility {
  type: string;              // "neoforge" | "forge" | "fabric" | "quilt"
  minVersion: string;        // Minimum loader version (e.g., "21.1.0")
  maxVersion: string | null; // Maximum loader version (null = no limit)
  recommended?: string;      // Recommended loader version
}

export interface ModDetailInfo {
  modId: string;
  name: string;
  version: string;
  gameVersions: string[];
  loaders: Record<string, LoaderFileInfo>;
  changelog: string;
  releaseDate: string;
  dependencies?: {
    required: string[];
    optional: string[];
  };
}

export interface LoaderFileInfo {
  file: string;
  sha256: string;
  size: number;
  minLoaderVersion: string;
  maxLoaderVersion: string | null;
  downloadUrl?: string;
}

export interface ModUpdateInfo {
  modId: string;
  modName: string;
  available: boolean;
  currentVersion: string | null;
  latestVersion: string;
  downloadUrl: string;
  sha256: string;
  size: number;
  changelog: string;
  gameVersion: string;
  loader: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

function getWorkerUrl(): string {
  const url = ENV_CONFIG.HYENIMC_WORKER_URL;
  
  if (!url) {
    throw new Error('HYENIMC_WORKER_URL is not configured. Please check your .env file.');
  }
  
  return url;
}

function getModRegistryUrl(): string {
  return `${getWorkerUrl()}/api/v2/mods`;
}

function getModDetailUrl(modId: string): string {
  return `${getWorkerUrl()}/api/v2/mods/${modId}/latest`;
}

function getModDownloadUrl(modId: string, loader: string, version: string, gameVersion: string, file: string): string {
  return `${getWorkerUrl()}/download/v2/mods/${modId}/versions/${version}/${loader}/${gameVersion}/${file}`;
}

// ============================================================================
// WorkerModUpdater Class
// ============================================================================

export class WorkerModUpdater {
  /**
   * Option A (Hybrid): Check if server requires mod updates
   * 
   * Priority:
   * 1. Profile.serverAddress (UI input) - highest priority
   * 2. servers.dat auto-detection - fallback
   * 3. None - skip
   * 
   * @param profileServerAddress - Server address from profile settings (UI)
   * @param gameDirectory - Game directory to check servers.dat
   * @returns true if HyeniWorld server detected
   */
  static async isRequiredModServer(
    profileServerAddress: string | undefined,
    gameDirectory: string
  ): Promise<boolean> {
    // Step 1: Check Profile.serverAddress (highest priority)
    if (profileServerAddress?.trim()) {
      const isAuthorized = isAuthorizedServer(profileServerAddress);
      
      if (isAuthorized) {
        console.log(`[WorkerModUpdater] ✅ Authorized server from profile: ${profileServerAddress}`);
        return true;
      }
      
      // Explicitly set to non-authorized server - skip servers.dat check
      console.log(`[WorkerModUpdater] ⏭️  Non-authorized server specified: ${profileServerAddress}`);
      return false;
    }
    
    // Step 2: servers.dat auto-detection (fallback)
    console.log('[WorkerModUpdater] 🔍 Checking servers.dat for authorized servers...');
    return await this.checkServersDatForAuthorizedServers(gameDirectory);
  }
  
  /**
   * Parse servers.dat and check for authorized servers
   * Reuses logic from protocol/handler.ts
   */
  private static async checkServersDatForAuthorizedServers(gameDirectory: string): Promise<boolean> {
    const serversDatPath = path.join(gameDirectory, 'servers.dat');
    
    try {
      await fs.access(serversDatPath);
      const data = await fs.readFile(serversDatPath);
      const parsed: any = await nbt.parse(data);
      
      const servers = parsed?.parsed?.value?.servers?.value?.value || [];
      
      const authorizedServers = servers.filter((server: any) => {
        const ip = server?.ip?.value || '';
        return isAuthorizedServer(ip);
      });
      
      if (authorizedServers.length > 0) {
        const serverList = authorizedServers.map((s: any) => s.ip?.value).join(', ');
        console.log(`[WorkerModUpdater] ✅ Authorized servers from servers.dat: ${serverList}`);
        return true;
      }
      
      console.log('[WorkerModUpdater] ❌ No authorized servers in servers.dat');
      return false;
    } catch (error) {
      console.log('[WorkerModUpdater] ℹ️  servers.dat not found or unreadable');
      return false;
    }
  }
  
  /**
   * Fetch mod registry from Worker API
   */
  async fetchModRegistry(): Promise<ModRegistry | null> {
    const url = getModRegistryUrl();
    
    console.log(`[WorkerModUpdater] Fetching mod registry: ${url}`);
    
    return new Promise((resolve) => {
      const request = net.request(url);
      
      request.on('response', (response) => {
        let body = '';
        
        response.on('data', (chunk) => {
          body += chunk.toString();
        });
        
        response.on('end', () => {
          if (response.statusCode !== 200) {
            console.error(`[WorkerModUpdater] API error: ${response.statusCode}`);
            resolve(null);
            return;
          }
          
          try {
            const data = JSON.parse(body) as ModRegistry;
            console.log(`[WorkerModUpdater] Registry loaded: ${data.mods?.length || 0} mods`);
            resolve(data);
          } catch (error) {
            console.error('[WorkerModUpdater] Failed to parse registry:', error);
            resolve(null);
          }
        });
      });
      
      request.on('error', (error) => {
        console.error('[WorkerModUpdater] Registry request error:', error);
        resolve(null);
      });
      
      request.end();
    });
  }
  
  /**
   * Get applicable mods for current environment
   * Filters by game version and loader type
   * @param gameVersion - Minecraft version (e.g., "1.21.1")
   * @param loaderType - Loader type (e.g., "neoforge", "forge")
   * @param loaderVersion - Optional: Loader version for compatibility check
   */
  async getApplicableMods(
    gameVersion: string,
    loaderType: string,
    loaderVersion?: string
  ): Promise<ModInfo[]> {
    const registry = await this.fetchModRegistry();
    
    if (!registry) {
      console.warn('[WorkerModUpdater] No registry available');
      return [];
    }
    
    const applicable = registry.mods.filter(mod => {
      // 1. Check game versions
      if (!mod.gameVersions || !Array.isArray(mod.gameVersions)) {
        console.warn(`[WorkerModUpdater] Mod ${mod.id} missing gameVersions`);
        return false;
      }
      
      if (!mod.gameVersions.includes(gameVersion)) {
        return false;
      }
      
      // 2. Check loader compatibility
      if (!mod.loaders || !Array.isArray(mod.loaders)) {
        console.warn(`[WorkerModUpdater] Mod ${mod.id} missing loaders`);
        return false;
      }
      
      const loaderCompat = mod.loaders.find(l => l.type === loaderType);
      if (!loaderCompat) {
        console.log(`[WorkerModUpdater] Mod ${mod.id} does not support loader: ${loaderType}`);
        return false;
      }
      
      // 3. Check loader version compatibility (if provided)
      if (loaderVersion) {
        const isVersionValid = this.checkLoaderVersionCompatibility(
          loaderVersion,
          loaderCompat.minVersion,
          loaderCompat.maxVersion
        );
        
        if (!isVersionValid) {
          console.warn(
            `[WorkerModUpdater] Mod ${mod.id} requires loader ${loaderType} ` +
            `${loaderCompat.minVersion}${loaderCompat.maxVersion ? `-${loaderCompat.maxVersion}` : '+'}, ` +
            `but ${loaderVersion} is installed`
          );
          return false;
        }
        
        // Show recommendation warning
        if (loaderCompat.recommended && loaderVersion !== loaderCompat.recommended) {
          console.log(
            `[WorkerModUpdater] ℹ️  Mod ${mod.id} recommends loader version ${loaderCompat.recommended}, ` +
            `current: ${loaderVersion}`
          );
        }
      }
      
      return true;
    });
    
    console.log(`[WorkerModUpdater] Found ${applicable.length} applicable mods for ${gameVersion} + ${loaderType}${loaderVersion ? ` ${loaderVersion}` : ''}`);
    return applicable;
  }
  
  /**
   * Fetch detailed mod info from Worker API (v2)
   * Selects the appropriate file for the given game version and loader
   */
  async fetchModInfo(
    modId: string,
    gameVersion: string,
    loaderType: string
  ): Promise<ModDetailInfo | null> {
    const url = getModDetailUrl(modId);
    
    console.log(`[WorkerModUpdater] Fetching mod info: ${url}`);
    
    return new Promise((resolve) => {
      const request = net.request(url);
      
      request.on('response', (response) => {
        let body = '';
        
        response.on('data', (chunk) => {
          body += chunk.toString();
        });
        
        response.on('end', () => {
          if (response.statusCode !== 200) {
            console.error(`[WorkerModUpdater] API error: ${response.statusCode}`);
            resolve(null);
            return;
          }
          
          try {
            const rawData = JSON.parse(body);
            
            // v2 API: Extract game version specific file info
            const loaderData = rawData.loaders?.[loaderType];
            if (!loaderData) {
              console.log(`[WorkerModUpdater] Loader ${loaderType} not found in response`);
              resolve(null);
              return;
            }
            
            const gameVersionData = loaderData.gameVersions?.[gameVersion];
            if (!gameVersionData) {
              console.log(`[WorkerModUpdater] Game version ${gameVersion} not found for ${loaderType}`);
              resolve(null);
              return;
            }
            
            // Transform to ModDetailInfo structure
            const modDetail: ModDetailInfo = {
              modId: rawData.modId,
              name: rawData.name,
              version: rawData.version,
              gameVersions: rawData.gameVersions,
              loaders: {
                [loaderType]: gameVersionData  // Only the relevant game version's file
              },
              changelog: rawData.changelog,
              releaseDate: rawData.releaseDate,
              dependencies: gameVersionData.dependencies
            };
            
            resolve(modDetail);
          } catch (error) {
            console.error('[WorkerModUpdater] Failed to parse mod info:', error);
            resolve(null);
          }
        });
      });
      
      request.on('error', (error) => {
        console.error('[WorkerModUpdater] Mod info request error:', error);
        resolve(null);
      });
      
      request.end();
    });
  }
  
  /**
   * Check if mod update is available
   */
  async checkModUpdate(
    modId: string,
    profilePath: string,
    gameVersion: string,
    loaderType: string
  ): Promise<ModUpdateInfo | null> {
    try {
      // Get local version
      const localVersion = await this.getLocalModVersion(profilePath, modId);
      
      // Fetch latest version
      const modInfo = await this.fetchModInfo(modId, gameVersion, loaderType);
      
      if (!modInfo) {
        console.log(`[WorkerModUpdater] No mod info available for: ${modId}`);
        return null;
      }
      
      // fetchModInfo already filtered by loader and game version
      const loaderInfo = modInfo.loaders[loaderType];
      if (!loaderInfo) {
        console.log(`[WorkerModUpdater] Loader ${loaderType} not supported for: ${modId}`);
        return null;
      }
      
      // Compare versions using shared utility
      const needsUpdate = !localVersion || isNewerVersion(modInfo.version, localVersion);
      
      if (needsUpdate) {
        console.log(`[WorkerModUpdater] Update available for ${modId}: ${localVersion || 'none'} -> ${modInfo.version}`);
        
        const downloadUrl = getModDownloadUrl(modId, loaderType, modInfo.version, gameVersion, loaderInfo.file);
        
        return {
          modId,
          modName: modId.charAt(0).toUpperCase() + modId.slice(1), // Capitalize first letter
          available: true,
          currentVersion: localVersion,
          latestVersion: modInfo.version,
          downloadUrl,
          sha256: loaderInfo.sha256,
          size: loaderInfo.size,
          changelog: modInfo.changelog || '',
          gameVersion,
          loader: loaderType
        };
      }
      
      console.log(`[WorkerModUpdater] Already up to date: ${modId} ${localVersion}`);
      return null;
      
    } catch (error) {
      console.error(`[WorkerModUpdater] Failed to check update for ${modId}:`, error);
      return null;
    }
  }
  
  /**
   * Check all applicable mods for updates
   * @param profilePath - Path to profile directory
   * @param gameVersion - Minecraft version
   * @param loaderType - Loader type (neoforge, forge, etc.)
   * @param loaderVersion - Optional: Loader version for compatibility check
   */
  async checkAllMods(
    profilePath: string,
    gameVersion: string,
    loaderType: string,
    loaderVersion?: string
  ): Promise<ModUpdateInfo[]> {
    try {
      console.log('[WorkerModUpdater] Checking all mods for updates...');
      console.log(`[WorkerModUpdater] Environment: ${gameVersion} + ${loaderType}${loaderVersion ? ` ${loaderVersion}` : ''}`);
      
      const applicableMods = await this.getApplicableMods(gameVersion, loaderType, loaderVersion);
      const updates: ModUpdateInfo[] = [];
      
      for (const mod of applicableMods) {
        const update = await this.checkModUpdate(mod.id, profilePath, gameVersion, loaderType);
        if (update && update.available) {
          updates.push(update);
        }
      }
      
      console.log(`[WorkerModUpdater] Found ${updates.length} updates`);
      return updates;
      
    } catch (error) {
      console.error('[WorkerModUpdater] Failed to check all mods:', error);
      return [];
    }
  }
  
  /**
   * Install/Update a mod
   */
  async installMod(
    profilePath: string,
    updateInfo: ModUpdateInfo,
    token: string,
    onProgress?: (progress: number) => void
  ): Promise<void> {
    try {
      console.log(`[WorkerModUpdater] Installing ${updateInfo.modName} ${updateInfo.latestVersion}... (token: ${token.substring(0, 8)}...)`);
      
      // Download with token (URL encode to handle special characters like +, /, =)
      const encodedToken = encodeURIComponent(token);
      const downloadUrlWithToken = `${updateInfo.downloadUrl}?token=${encodedToken}`;
      const tempPath = await this.downloadFile(
        downloadUrlWithToken,
        updateInfo.sha256,
        onProgress
      );
      
      // Backup old files
      const modsDir = path.join(profilePath, 'mods');
      await fs.ensureDir(modsDir);
      
      const oldFiles = await this.findModFiles(modsDir, updateInfo.modId);
      console.log(`[WorkerModUpdater] Found ${oldFiles.length} old files to backup`);
      
      for (const file of oldFiles) {
        const backupPath = `${file}.backup`;
        await fs.rename(file, backupPath);
        console.log(`[WorkerModUpdater] Backed up: ${path.basename(file)}`);
      }
      
      // Install new file
      const fileName = updateInfo.downloadUrl.split('/').pop()!;
      const targetPath = path.join(modsDir, fileName);
      await fs.copyFile(tempPath, targetPath);
      console.log(`[WorkerModUpdater] Installed: ${fileName}`);
      
      // Delete backups
      for (const file of oldFiles) {
        const backupPath = `${file}.backup`;
        await fs.remove(backupPath);
      }
      
      // Cleanup temp file
      await fs.remove(tempPath);
      
      console.log(`[WorkerModUpdater] Update complete: ${updateInfo.modName} ${updateInfo.latestVersion}`);
      
    } catch (error) {
      console.error(`[WorkerModUpdater] Failed to install ${updateInfo.modName}:`, error);
      
      // Restore backups on error
      const modsDir = path.join(profilePath, 'mods');
      try {
        const backups = await fs.readdir(modsDir);
        for (const file of backups) {
          if (file.endsWith('.backup')) {
            const originalPath = path.join(modsDir, file.replace('.backup', ''));
            const backupPath = path.join(modsDir, file);
            await fs.rename(backupPath, originalPath);
          }
        }
      } catch (restoreError) {
        console.error('[WorkerModUpdater] Failed to restore backups:', restoreError);
      }
      
      throw error;
    }
  }
  
  /**
   * Get local mod version from mods directory
   * Supports flexible filename patterns: {modId}-*.jar
   */
  private async getLocalModVersion(
    profilePath: string,
    modId: string
  ): Promise<string | null> {
    const modsDir = path.join(profilePath, 'mods');
    
    if (!await fs.pathExists(modsDir)) {
      return null;
    }
    
    const files = await this.findModFiles(modsDir, modId);
    
    if (files.length === 0) {
      return null;
    }
    
    // Extract version from filename using shared utility
    // Patterns:
    // - hyenihelper-fabric-1.21.1-1.0.0.jar -> 1.0.0
    // - hyenihelper-1.0.0.jar -> 1.0.0
    // - hyenicore-neoforge-2.0.1.jar -> 2.0.1
    // - FastSuite-1.21.1-6.0.5.jar -> 6.0.5
    const fileName = path.basename(files[0], '.jar');
    const version = parseModVersion(fileName);
    
    // parseModVersion returns '0.0.0' on failure
    return version !== '0.0.0' ? version : null;
  }
  
  /**
   * Find mod files in mods directory
   * Pattern: {modId}-*.jar
   */
  private async findModFiles(modsDir: string, modId: string): Promise<string[]> {
    try {
      const files = await fs.readdir(modsDir);
      const modFiles: string[] = [];
      
      const pattern = new RegExp(`^${modId}-.*\\.jar$`, 'i');
      
      for (const file of files) {
        if (pattern.test(file)) {
          modFiles.push(path.join(modsDir, file));
        }
      }
      
      return modFiles;
    } catch (error) {
      console.error(`[WorkerModUpdater] Failed to read mods directory: ${modsDir}`, error);
      return [];
    }
  }
  
  /**
   * Check if loader version is compatible with mod requirements
   */
  private checkLoaderVersionCompatibility(
    currentVersion: string,
    minVersion: string,
    maxVersion: string | null
  ): boolean {
    // Compare with minimum version using shared utility
    const isAboveMin = compareVersions(currentVersion, minVersion) >= 0;
    
    // Compare with maximum version (if specified)
    if (maxVersion) {
      const isBelowMax = compareVersions(currentVersion, maxVersion) <= 0;
      return isAboveMin && isBelowMax;
    }
    
    return isAboveMin;
  }
  
  /**
   * Get user auth token from config
   */
  async getUserToken(profilePath: string): Promise<string | null> {
    const configPath = path.join(profilePath, 'config', 'hyenihelper-config.json');
    
    if (!await fs.pathExists(configPath)) {
      return null;
    }
    
    try {
      const config = await fs.readJSON(configPath);
      return config.token || null;
    } catch (error) {
      console.error('[WorkerModUpdater] Failed to read config:', error);
      return null;
    }
  }
  
  /**
   * Download file with progress tracking and SHA256 verification
   */
  private async downloadFile(
    url: string,
    expectedSha256: string,
    onProgress?: (progress: number) => void
  ): Promise<string> {
    const tempDir = path.join(app.getPath('temp'), 'hyenimc-downloads');
    await fs.ensureDir(tempDir);
    
    const fileName = `mod-${Date.now()}.jar`;
    const tempPath = path.join(tempDir, fileName);
    
    console.log(`[WorkerModUpdater] Downloading: ${url.split('?')[0]}`); // Don't log token
    
    return new Promise((resolve, reject) => {
      const request = net.request(url);
      
      request.on('response', (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`Download failed: ${response.statusCode}`));
          return;
        }
        
        const totalSize = parseInt(response.headers['content-length'] as string || '0');
        let downloadedSize = 0;
        
        const writer = fs.createWriteStream(tempPath);
        const hash = crypto.createHash('sha256');
        
        response.on('data', (chunk: Buffer) => {
          writer.write(chunk);
          hash.update(chunk);
          downloadedSize += chunk.length;
          
          if (onProgress && totalSize > 0) {
            const progress = Math.round((downloadedSize / totalSize) * 100);
            onProgress(progress);
          }
        });
        
        response.on('end', () => {
          // Close the write stream
          writer.end();
        });
        
        // Wait for file to be completely written to disk
        writer.on('finish', () => {
          const actualSha256 = hash.digest('hex');
          
          // Verify file size
          if (totalSize > 0 && downloadedSize !== totalSize) {
            fs.remove(tempPath);
            reject(new Error(`File size mismatch: expected ${totalSize} bytes, got ${downloadedSize} bytes`));
            return;
          }
          
          // Verify SHA256
          if (actualSha256 !== expectedSha256) {
            fs.remove(tempPath);
            reject(new Error(`SHA256 mismatch: expected ${expectedSha256}, got ${actualSha256}`));
            return;
          }
          
          console.log(`[WorkerModUpdater] Download complete: ${tempPath} (${downloadedSize} bytes, SHA256: ${actualSha256})`);
          resolve(tempPath);
        });
        
        response.on('error', (error: Error) => {
          writer.end();
          fs.remove(tempPath);
          reject(error);
        });
        
        writer.on('error', (error: Error) => {
          fs.remove(tempPath);
          reject(error);
        });
      });
      
      request.on('error', (error) => {
        reject(error);
      });
      
      request.end();
    });
  }
  
}

// Note: Version comparison methods moved to shared/utils/version.ts

// Export singleton instance
export const workerModUpdater = new WorkerModUpdater();
