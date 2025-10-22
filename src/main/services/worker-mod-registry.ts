/**
 * Worker Mod Registry Service
 * 
 * Manages multi-mod updates from Cloudflare Worker API v2.
 * Fetches registry, checks for updates across all mods, and installs multiple mods.
 */

import * as path from 'path';
import * as fs from 'fs-extra';
import { app, net } from 'electron';
import * as crypto from 'crypto';
import { ENV_CONFIG } from '../config/env-config';
import { isAuthorizedServer } from '../../shared/config/server-config';
import type {
  WorkerModRegistryResponse,
  WorkerModLatestResponse,
  WorkerModUpdateCheck,
  WorkerModInstallResult
} from '../../shared/types/worker-mods';

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

function getRegistryApiUrl(): string {
  return `${getWorkerUrl()}/api/v2/mods`;
}

function getModLatestApiUrl(modId: string): string {
  return `${getWorkerUrl()}/api/v2/mods/${modId}/latest`;
}

// ============================================================================
// Worker Mod Registry Service
// ============================================================================

export class WorkerModRegistry {
  /**
   * Fetch mod registry from Worker API
   */
  async fetchModRegistry(): Promise<WorkerModRegistryResponse> {
    const url = getRegistryApiUrl();
    const response = await net.fetch(url);
    
    if (!response.ok) {
      throw new Error(`Registry 조회 실패: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json() as WorkerModRegistryResponse;
    return data;
  }

  /**
   * Get set of installed mod IDs in a profile
   */
  async getInstalledMods(profilePath: string): Promise<Set<string>> {
    const modsPath = path.join(profilePath, 'mods');
    
    if (!await fs.pathExists(modsPath)) {
      return new Set();
    }
    
    const files = await fs.readdir(modsPath);
    const installedMods = new Set<string>();
    
    // Extract modId from jar filename
    // e.g., hyenihelper-neoforge-1.21.1-1.0.2.jar → hyenihelper
    for (const file of files) {
      if (file.endsWith('.jar') && !file.endsWith('.disabled')) {
        const modId = file.split('-')[0].toLowerCase();
        installedMods.add(modId);
      }
    }
    
    return installedMods;
  }

  /**
   * Get local version of a mod
   */
  async getLocalVersion(profilePath: string, modId: string): Promise<string | null> {
    const modsPath = path.join(profilePath, 'mods');
    
    if (!await fs.pathExists(modsPath)) {
      return null;
    }
    
    const files = await fs.readdir(modsPath);
    
    // Find jar file for this mod
    for (const file of files) {
      if (file.toLowerCase().startsWith(modId.toLowerCase()) && file.endsWith('.jar') && !file.endsWith('.disabled')) {
        // Extract version from filename
        // e.g., hyenihelper-neoforge-1.21.1-1.0.2.jar → 1.0.2
        const match = file.match(/-(\d+\.\d+(?:\.\d+)?(?:-[a-zA-Z0-9]+)?)\.jar$/);
        if (match) {
          return match[1];
        }
      }
    }
    
    return null;
  }

  /**
   * Compare semantic versions
   */
  private isNewerVersion(newVersion: string, currentVersion: string): boolean {
    const parseVersion = (v: string) => {
      const parts = v.split(/[-+]/)[0].split('.').map(Number);
      return parts;
    };
    
    const newParts = parseVersion(newVersion);
    const currentParts = parseVersion(currentVersion);
    
    for (let i = 0; i < Math.max(newParts.length, currentParts.length); i++) {
      const newPart = newParts[i] || 0;
      const currentPart = currentParts[i] || 0;
      
      if (newPart > currentPart) return true;
      if (newPart < currentPart) return false;
    }
    
    return false;
  }

  /**
   * Check all mod updates for a profile
   */
  async checkAllModUpdates(
    profilePath: string,
    gameVersion: string,
    loaderType: string,
    serverAddress?: string
  ): Promise<WorkerModUpdateCheck[]> {
    // Check if server is authorized
    const hasAuthorizedServer = serverAddress && isAuthorizedServer(serverAddress);
    
    try {
      // 1. Fetch registry
      const registry = await this.fetchModRegistry();
      
      // 2. Get installed mods
      const installedMods = await this.getInstalledMods(profilePath);
      
      // 3. Check each mod
      const updateChecks: WorkerModUpdateCheck[] = [];
      
      for (const mod of registry.mods) {
        const isInstalled = installedMods.has(mod.id.toLowerCase());
        
        // Decide whether to check this mod:
        if (isInstalled) {
          // ✅ Already installed → always check (regardless of server)
        } else if (hasAuthorizedServer && mod.category === 'required') {
          // ✅ New required mod + authorized server → check
        } else {
          // ❌ Skip: either no authorized server, or optional mod
          continue;
        }
        
        try {
          const updateCheck = await this.checkModUpdate(
            mod.id,
            profilePath,
            gameVersion,
            loaderType,
            isInstalled
          );
          
          if (updateCheck && updateCheck.available) {
            updateChecks.push(updateCheck);
          }
        } catch (error) {
          console.error(`[WorkerModRegistry] ${mod.id} 체크 실패:`, error);
          // Continue checking other mods
        }
      }
      
      if (updateChecks.length > 0) {
        console.log(`[WorkerModRegistry] ${updateChecks.length}개 업데이트 발견`);
      }
      
      return updateChecks;
    } catch (error) {
      console.error('[WorkerModRegistry] 업데이트 확인 실패:', error);
      throw error;
    }
  }

  /**
   * Check update for a specific mod
   */
  async checkModUpdate(
    modId: string,
    profilePath: string,
    gameVersion: string,
    loaderType: string,
    isInstalled: boolean
  ): Promise<WorkerModUpdateCheck | null> {
    const url = getModLatestApiUrl(modId);
    const response = await net.fetch(url);
    
    if (!response.ok) {
      return null;
    }
    
    const latest = await response.json() as WorkerModLatestResponse;
    
    // Check loader support
    const loaderInfo = latest.loaders[loaderType];
    if (!loaderInfo || !loaderInfo.gameVersions) {
      return null;
    }
    
    // Check game version support
    const gameVersionInfo = loaderInfo.gameVersions[gameVersion];
    if (!gameVersionInfo) {
      return null;
    }
    
    // Get local version
    const localVersion = await this.getLocalVersion(profilePath, modId);
    
    // Check if update needed
    const needsUpdate = !localVersion || this.isNewerVersion(latest.version, localVersion);
    
    if (!needsUpdate) {
      return null;
    }
    
    // Construct download URL manually (don't trust API's downloadUrl)
    // Format: /download/v2/mods/{modId}/versions/{version}/{loader}/{gameVersion}/{file}
    const fileName = gameVersionInfo.file;
    const downloadUrl = `/download/v2/mods/${modId}/versions/${latest.version}/${loaderType}/${gameVersion}/${fileName}`;
    
    return {
      modId: modId,
      name: latest.name || modId,  // Fallback to id if name is null
      currentVersion: localVersion,
      latestVersion: latest.version,
      available: true,
      isInstalled: isInstalled,
      category: isInstalled ? 'required' : 'optional',  // Treat installed as required
      downloadUrl: downloadUrl,
      sha256: gameVersionInfo.sha256,
      size: gameVersionInfo.size,
      changelog: latest.changelog || '',
      gameVersion: gameVersion,
      loader: loaderType
    };
  }

  /**
   * Install multiple mods
   */
  async installMultipleMods(
    profilePath: string,
    updates: WorkerModUpdateCheck[],
    onProgress?: (modId: string, progress: number) => void
  ): Promise<WorkerModInstallResult[]> {
    const results: WorkerModInstallResult[] = [];
    
    for (const update of updates) {
      try {
        onProgress?.(update.modId, 0);
        
        await this.downloadAndInstallMod(
          profilePath,
          update,
          (progress) => onProgress?.(update.modId, progress)
        );
        
        onProgress?.(update.modId, 100);
        results.push({ modId: update.modId, success: true });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[WorkerModRegistry] ${update.modId} 설치 실패:`, errorMessage);
        
        results.push({
          modId: update.modId,
          success: false,
          error: errorMessage
        });
      }
    }
    
    const successCount = results.filter(r => r.success).length;
    console.log(`[WorkerModRegistry] 설치 완료: ${successCount}/${results.length}개 성공`);
    
    return results;
  }

  /**
   * Read token from hyenihelper-config.json
   */
  private async getAuthToken(profilePath: string): Promise<string> {
    const configPath = path.join(profilePath, 'config', 'hyenihelper-config.json');
    
    try {
      const configContent = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(configContent);
      
      if (!config.token || config.token.trim().length === 0) {
        throw new Error('토큰이 설정되지 않았습니다. Discord /인증 명령어로 인증해주세요.');
      }
      
      return config.token;
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        throw new Error('인증 설정 파일이 없습니다. Discord /인증 명령어로 인증해주세요.');
      }
      throw error;
    }
  }

  /**
   * Download and install a single mod
   */
  private async downloadAndInstallMod(
    profilePath: string,
    update: WorkerModUpdateCheck,
    onProgress?: (progress: number) => void
  ): Promise<void> {
    const modsPath = path.join(profilePath, 'mods');
    await fs.ensureDir(modsPath);
    
    // Build download URL
    const downloadUrl = update.downloadUrl.startsWith('http')
      ? update.downloadUrl
      : `${getWorkerUrl()}${update.downloadUrl}`;
    
    // Get auth token from config file (throws error if not found)
    let token: string;
    try {
      token = await this.getAuthToken(profilePath);
    } catch (error) {
      // Re-throw token errors with clear message
      throw new Error(error instanceof Error ? error.message : '인증 토큰을 찾을 수 없습니다');
    }
    
    // Download file with progress tracking
    const fullDownloadUrl = `${downloadUrl}?token=${encodeURIComponent(token)}`;
    console.log(`[WorkerModRegistry] Downloading: ${downloadUrl} (token: ${token.substring(0, 8)}...)`);
    
    const buffer = await this.downloadWithProgress(
      fullDownloadUrl,
      update.size,
      update.sha256,
      onProgress
    );
    
    console.log(`[WorkerModRegistry] Download verified: ${buffer.length} bytes, SHA256: ${update.sha256}`);
    
    // Remove old version
    await this.removeOldVersion(modsPath, update.modId);
    
    // Extract filename from downloadUrl
    const filename = path.basename(update.downloadUrl);
    const targetPath = path.join(modsPath, filename);
    
    // Write file
    await fs.writeFile(targetPath, buffer);
    
    onProgress?.(100);
  }

  /**
   * Download file with progress tracking and verification
   */
  private async downloadWithProgress(
    url: string,
    expectedSize: number,
    expectedSha256: string,
    onProgress?: (progress: number) => void
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const request = net.request(url);
      
      request.on('response', (response) => {
        if (response.statusCode !== 200) {
          let errorMsg = `다운로드 실패: ${response.statusCode}`;
          if (response.statusCode === 401 || response.statusCode === 403) {
            errorMsg = '인증 실패: 토큰이 만료되었거나 유효하지 않습니다. Discord /인증 명령어로 재인증해주세요.';
          } else if (response.statusCode === 404) {
            errorMsg = '파일을 찾을 수 없습니다: 서버에서 모드 파일을 찾을 수 없습니다.';
          }
          reject(new Error(errorMsg));
          return;
        }
        
        const totalSize = parseInt(response.headers['content-length'] as string || '0') || expectedSize;
        let downloadedSize = 0;
        const chunks: Buffer[] = [];
        const hash = crypto.createHash('sha256');
        
        response.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
          hash.update(chunk);
          downloadedSize += chunk.length;
          
          if (onProgress && totalSize > 0) {
            const progress = Math.round((downloadedSize / totalSize) * 100);
            onProgress(progress);
          }
        });
        
        response.on('end', () => {
          const buffer = Buffer.concat(chunks);
          
          // Verify file size
          if (expectedSize > 0 && buffer.length !== expectedSize) {
            reject(new Error(`파일 크기 불일치: 예상 ${expectedSize} bytes, 실제 ${buffer.length} bytes`));
            return;
          }
          
          // Verify SHA256
          const actualSha256 = hash.digest('hex');
          if (actualSha256 !== expectedSha256) {
            reject(new Error(`SHA256 불일치: 예상 ${expectedSha256}, 실제 ${actualSha256}`));
            return;
          }
          
          resolve(buffer);
        });
        
        response.on('error', (error: Error) => {
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
   * Remove old version of a mod
   */
  private async removeOldVersion(modsPath: string, modId: string): Promise<void> {
    if (!await fs.pathExists(modsPath)) {
      return;
    }
    
    const files = await fs.readdir(modsPath);
    
    for (const file of files) {
      if (file.toLowerCase().startsWith(modId.toLowerCase()) && file.endsWith('.jar')) {
        const filePath = path.join(modsPath, file);
        await fs.remove(filePath);
      }
    }
  }
}
