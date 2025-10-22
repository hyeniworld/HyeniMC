/**
 * HyeniHelper Mod Updater Service
 * 
 * Checks for HyeniHelper mod updates from the Cloudflare Worker API
 * and handles installation/updates.
 */

import * as path from 'path';
import * as fs from 'fs-extra';
import { app, net } from 'electron';
import * as crypto from 'crypto';
import { ENV_CONFIG } from '../config/env-config';
import { isAuthorizedServer } from '../../shared/config/server-config';

// HyeniMC Worker URL (CurseForge API Proxy + Mod Distribution)
function getWorkerUrl(): string {
  const url = ENV_CONFIG.HYENIMC_WORKER_URL;
  
  if (!url) {
    throw new Error('HYENIMC_WORKER_URL is not configured. Please check your .env file.');
  }
  
  return url;
}

function getReleasesApiUrl(): string {
  return `${getWorkerUrl()}/api/mods`;
}

function getDownloadBaseUrl(): string {
  return `${getWorkerUrl()}/download/mods`;
}

export interface HyeniHelperUpdateInfo {
  available: boolean;
  currentVersion: string | null;
  latestVersion: string;
  downloadUrl: string;
  sha256: string;
  size: number;
  changelog: string;
  required: boolean;
  gameVersion: string;
  loader: string;
}

interface LatestReleaseResponse {
  version: string;
  releaseDate: string;
  minLauncherVersion?: string;
  gameVersions: string[];
  changelog: string;
  loaders: {
    [key: string]: {
      // v1 format (legacy)
      fileName?: string;
      sha256?: string;
      size?: number;
      downloadPath?: string;
      downloadUrl?: string;
      // v2 format (new)
      gameVersions?: {
        [gameVersion: string]: {
          file: string;
          sha256: string;
          size: number;
          downloadPath: string;
          downloadUrl?: string;
          minLoaderVersion: string;
          maxLoaderVersion?: string | null;
          dependencies?: {
            required?: string[];
            optional?: string[];
          };
        };
      };
    };
  };
}

export class HyeniUpdater {
  /**
   * Check if HyeniHelper update is available for a profile
   * @param profilePath - Profile path
   * @param gameVersion - Game version
   * @param loaderType - Loader type (neoforge, fabric, etc.)
   * @param serverAddress - Server address from profile settings (optional)
   */
  async checkHyeniHelperUpdate(
    profilePath: string,
    gameVersion: string,
    loaderType: string,
    serverAddress?: string
  ): Promise<HyeniHelperUpdateInfo | null> {
    try {
      // 1. Get local version
      const localVersion = await this.getLocalVersion(profilePath);
      
      // 2. Check if update check should be performed
      // - Always check if HyeniHelper is already installed
      // - Also check if authorized server is configured (for installation recommendation)
      const isAuthorizedServerConfigured = serverAddress?.trim() && isAuthorizedServer(serverAddress);
      
      if (!localVersion && !isAuthorizedServerConfigured) {
        console.log('[HyeniUpdater] HyeniHelper not installed and no authorized server configured, skipping update check');
        return null;
      }
      
      if (!localVersion && isAuthorizedServerConfigured) {
        console.log(`[HyeniUpdater] HyeniHelper not installed but authorized server configured (${serverAddress}), checking for installation`);
      }
      
      // 3. Fetch latest version from API
      const latest = await this.fetchLatestRelease();
      
      if (!latest) {
        console.log('[HyeniUpdater] No release information available');
        return null;
      }
      
      // 4. Check if loader is supported
      const loaderInfo = latest.loaders[loaderType];
      if (!loaderInfo) {
        console.log(`[HyeniUpdater] Loader ${loaderType} not supported in latest release`);
        return null;
      }
      
      // 5. Extract file info based on API version (v1 or v2)
      let fileInfo: {
        downloadUrl: string;
        sha256: string;
        size: number;
        fileName: string;
      };
      
      if (loaderInfo.gameVersions) {
        // v2 format: nested by game version
        const gameVersionInfo = loaderInfo.gameVersions[gameVersion];
        
        if (!gameVersionInfo) {
          console.log(`[HyeniUpdater] Game version ${gameVersion} not supported in latest release`);
          return null;
        }
        
        if (!gameVersionInfo.downloadPath || !gameVersionInfo.sha256) {
          console.error('[HyeniUpdater] Invalid loader info: missing downloadPath or sha256');
          return null;
        }
        
        // Generate downloadUrl from downloadPath if not present
        const downloadUrl = gameVersionInfo.downloadUrl || `/${gameVersionInfo.downloadPath}`;
        
        fileInfo = {
          downloadUrl,
          sha256: gameVersionInfo.sha256,
          size: gameVersionInfo.size,
          fileName: gameVersionInfo.file
        };
      } else {
        // v1 format: flat structure (legacy)
        if (!loaderInfo.downloadUrl || !loaderInfo.sha256) {
          console.error('[HyeniUpdater] Invalid loader info: missing downloadUrl or sha256');
          return null;
        }
        
        // Check if game version is supported
        if (!latest.gameVersions.includes(gameVersion)) {
          console.log(`[HyeniUpdater] Game version ${gameVersion} not supported in latest release`);
          return null;
        }
        
        fileInfo = {
          downloadUrl: loaderInfo.downloadUrl,
          sha256: loaderInfo.sha256,
          size: loaderInfo.size!,
          fileName: loaderInfo.fileName!
        };
      }
      
      // 6. Compare versions
      // If not installed or newer version available, return update info
      const needsUpdate = !localVersion || this.isNewerVersion(latest.version, localVersion);
      
      if (needsUpdate) {
        console.log(`[HyeniUpdater] Update available: ${localVersion || 'not installed'} -> ${latest.version}`);
        
        return {
          available: true,
          currentVersion: localVersion,
          latestVersion: latest.version,
          downloadUrl: fileInfo.downloadUrl,
          sha256: fileInfo.sha256,
          size: fileInfo.size,
          changelog: latest.changelog,
          required: false, // TODO: Implement required flag logic
          gameVersion,
          loader: loaderType
        };
      }
      
      console.log(`[HyeniUpdater] Already up to date: ${localVersion}`);
      return null;
      
    } catch (error) {
      console.error('[HyeniUpdater] Failed to check for updates:', error);
      throw error;
    }
  }
  
  /**
   * Install/Update HyeniHelper mod
   */
  async installUpdate(
    profilePath: string,
    updateInfo: HyeniHelperUpdateInfo,
    onProgress?: (progress: number) => void
  ): Promise<void> {
    try {
      console.log(`[HyeniUpdater] Installing update: ${updateInfo.latestVersion}`);
      console.log(`[HyeniUpdater] Update info:`, JSON.stringify(updateInfo, null, 2));
      
      // 1. Get auth token
      const token = await this.getUserToken(profilePath);
      if (!token) {
        throw new Error('인증 토큰이 없습니다. Discord에서 /인증 명령어로 인증하세요.');
      }
      
      // 2. Validate updateInfo
      if (!updateInfo.downloadUrl) {
        throw new Error('다운로드 URL이 없습니다. API 응답을 확인해주세요.');
      }
      if (!updateInfo.sha256) {
        throw new Error('SHA256 해시가 없습니다. API 응답을 확인해주세요.');
      }
      
      // 3. Download new file
      // v1: downloadUrl format: /hyenihelper/versions/1.0.1/file.jar
      // v2: downloadUrl format: /mods/hyenihelper/versions/1.0.2/neoforge/1.21.1/file.jar
      // Base URL: https://worker.dev/download/mods
      // For v1, downloadUrl already excludes /mods/, so we add it
      // For v2, downloadUrl includes /mods/, so we need to adjust
      let downloadPath = updateInfo.downloadUrl;
      
      // If downloadUrl starts with /mods/, remove it since base URL already includes /mods
      if (downloadPath.startsWith('/mods/')) {
        downloadPath = downloadPath.substring(6); // Remove '/mods/' (6 chars)
      }
      
      // Ensure path starts with /
      if (!downloadPath.startsWith('/')) {
        downloadPath = '/' + downloadPath;
      }
      
      // URL encode the token to handle special characters like +, /, =
      const encodedToken = encodeURIComponent(token);
      const downloadUrl = `${getDownloadBaseUrl()}${downloadPath}?token=${encodedToken}`;
      console.log(`[HyeniUpdater] Downloading: ${getDownloadBaseUrl()}${downloadPath} (token: ${token.substring(0, 8)}...)`);
      const tempPath = await this.downloadFile(downloadUrl, updateInfo.sha256, onProgress);
      
      // 4. Backup old files
      const modsDir = path.join(profilePath, 'mods');
      await fs.ensureDir(modsDir);
      
      const oldFiles = await this.findHyeniHelperFiles(modsDir);
      console.log(`[HyeniUpdater] Found ${oldFiles.length} old files to backup`);
      
      for (const file of oldFiles) {
        const backupPath = `${file}.backup`;
        await fs.rename(file, backupPath);
        console.log(`[HyeniUpdater] Backed up: ${path.basename(file)}`);
      }
      
      // 5. Install new file
      const fileName = updateInfo.downloadUrl.split('/').pop()!;
      const targetPath = path.join(modsDir, fileName);
      await fs.copyFile(tempPath, targetPath);
      console.log(`[HyeniUpdater] Installed: ${fileName}`);
      
      // 6. Delete backups
      for (const file of oldFiles) {
        const backupPath = `${file}.backup`;
        await fs.remove(backupPath);
      }
      
      // 7. Cleanup temp file
      await fs.remove(tempPath);
      
      console.log(`[HyeniUpdater] Update complete: ${updateInfo.latestVersion}`);
      
    } catch (error) {
      console.error('[HyeniUpdater] Failed to install update:', error);
      
      // Restore backups on error
      const modsDir = path.join(profilePath, 'mods');
      const backups = await fs.readdir(modsDir);
      for (const file of backups) {
        if (file.endsWith('.backup')) {
          const originalPath = path.join(modsDir, file.replace('.backup', ''));
          const backupPath = path.join(modsDir, file);
          await fs.rename(backupPath, originalPath);
        }
      }
      
      throw error;
    }
  }
  
  /**
   * Get local HyeniHelper version
   */
  private async getLocalVersion(profilePath: string): Promise<string | null> {
    const modsDir = path.join(profilePath, 'mods');
    
    if (!await fs.pathExists(modsDir)) {
      return null;
    }
    
    const files = await this.findHyeniHelperFiles(modsDir);
    
    if (files.length === 0) {
      return null;
    }
    
    // Extract version from filename (e.g., hyenihelper-neoforge-1.21.1-1.0.1.jar)
    const fileName = path.basename(files[0]);
    const match = fileName.match(/hyenihelper-(?:fabric|neoforge)-[\d.]+-([\d.]+)\.jar/);
    
    if (match) {
      return match[1];
    }
    
    return null;
  }
  
  /**
   * Find HyeniHelper JAR files in mods directory
   */
  private async findHyeniHelperFiles(modsDir: string): Promise<string[]> {
    const files = await fs.readdir(modsDir);
    const hyeniFiles: string[] = [];
    
    for (const file of files) {
      if (file.startsWith('hyenihelper-') && file.endsWith('.jar')) {
        hyeniFiles.push(path.join(modsDir, file));
      }
    }
    
    return hyeniFiles;
  }
  
  /**
   * Get user auth token from config
   */
  private async getUserToken(profilePath: string): Promise<string | null> {
    const configPath = path.join(profilePath, 'config', 'hyenihelper-config.json');
    
    if (!await fs.pathExists(configPath)) {
      return null;
    }
    
    try {
      const config = await fs.readJSON(configPath);
      return config.token || null;
    } catch (error) {
      console.error('[HyeniUpdater] Failed to read config:', error);
      return null;
    }
  }
  
  /**
   * Fetch latest release info from API
   */
  private async fetchLatestRelease(): Promise<LatestReleaseResponse | null> {
    const url = `${getReleasesApiUrl()}/hyenihelper/latest`;
    console.log(`[HyeniUpdater] Fetching latest release from: ${url}`);
    
    return new Promise((resolve) => {
      const request = net.request(url);
      
      request.on('response', (response) => {
        let body = '';
        
        response.on('data', (chunk) => {
          body += chunk.toString();
        });
        
        response.on('end', () => {
          if (response.statusCode !== 200) {
            console.error(`[HyeniUpdater] API error: ${response.statusCode}`);
            console.error(`[HyeniUpdater] Response body: ${body}`);
            resolve(null);
            return;
          }
          
          try {
            const data = JSON.parse(body) as LatestReleaseResponse;
            console.log('[HyeniUpdater] API response:', JSON.stringify(data, null, 2));
            resolve(data);
          } catch (error) {
            console.error('[HyeniUpdater] Failed to parse response:', error);
            console.error('[HyeniUpdater] Response body:', body);
            resolve(null);
          }
        });
      });
      
      request.on('error', (error) => {
        console.error('[HyeniUpdater] Request error:', error);
        resolve(null);
      });
      
      request.end();
    });
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
    
    const fileName = `hyenihelper-${Date.now()}.jar`;
    const tempPath = path.join(tempDir, fileName);
    
    // Don't log full URL with token
    const urlWithoutToken = url.split('?')[0];
    console.log(`[HyeniUpdater] Downloading file: ${urlWithoutToken}`);
    
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
          writer.end();
          
          const actualSha256 = hash.digest('hex');
          
          if (actualSha256 !== expectedSha256) {
            fs.remove(tempPath);
            reject(new Error(`SHA256 mismatch: expected ${expectedSha256}, got ${actualSha256}`));
            return;
          }
          
          console.log(`[HyeniUpdater] Download complete: ${tempPath}`);
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
  
  /**
   * Compare semantic versions
   */
  private isNewerVersion(latest: string, current: string): boolean {
    const latestParts = latest.split('.').map(Number);
    const currentParts = current.split('.').map(Number);
    
    for (let i = 0; i < Math.max(latestParts.length, currentParts.length); i++) {
      const latestPart = latestParts[i] || 0;
      const currentPart = currentParts[i] || 0;
      
      if (latestPart > currentPart) return true;
      if (latestPart < currentPart) return false;
    }
    
    return false;
  }
}

// Export singleton instance
export const hyeniUpdater = new HyeniUpdater();
