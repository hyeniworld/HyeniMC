import { ModrinthAPI } from './modrinth-api';
import { ModManager } from './mod-manager';
import type { ModVersion } from '../../shared/types/profile';

export interface ModUpdateInfo {
  modId: string;
  modName: string;
  fileName: string;
  currentVersion: string;
  latestVersion: string;
  latestVersionId: string;
  changelog?: string;
  required: boolean;
  downloadUrl: string;
  fileSize: number;
}

export interface UpdateResult {
  success: string[];
  failed: Array<{ modName: string; error: string }>;
  skipped: string[];
}

export class ModUpdater {
  private modrinthAPI: ModrinthAPI;

  constructor() {
    this.modrinthAPI = new ModrinthAPI();
  }

  /**
   * 설치된 모드들의 업데이트 확인
   * 
   * 참고: 현재는 Modrinth에서 가져온 모드만 업데이트 확인 가능
   * 로컬 모드는 소스 정보가 없어서 업데이트를 확인할 수 없음
   */
  async checkUpdates(
    gameDir: string,
    gameVersion: string,
    loaderType: string
  ): Promise<ModUpdateInfo[]> {
    const updates: ModUpdateInfo[] = [];

    try {
      const modManager = new ModManager();
      const installedMods = await modManager.listMods(gameDir);

      console.log(`[ModUpdater] Checking updates for ${installedMods.length} mods`);

      // TODO: 실제로는 모드 메타데이터에서 소스 정보를 가져와야 함
      // 현재는 파일 이름 기반으로 Modrinth에서 검색 시도
      for (const mod of installedMods) {
        if (!mod.enabled) {
          console.log(`[ModUpdater] Skipping disabled mod: ${mod.name}`);
          continue;
        }

        try {
          // 파일 이름에서 모드 ID 추출 시도 (fabric-api-0.92.0+1.20.1.jar -> fabric-api)
          const modSlug = this.extractModSlug(mod.fileName);
          
          // Modrinth에서 모드 검색
          const searchResult = await this.modrinthAPI.searchMods(mod.name, {
            gameVersion,
            loaderType: loaderType !== 'vanilla' ? loaderType : undefined,
            limit: 1,
          } as any);

          if (searchResult.hits.length === 0) {
            console.log(`[ModUpdater] No results found for: ${mod.name}`);
            continue;
          }

          const modInfo = searchResult.hits[0];
          
          // 최신 버전 가져오기
          const versions = await this.modrinthAPI.getModVersions(
            modInfo.id,
            gameVersion,
            loaderType as any
          );

          if (versions.length === 0) {
            console.log(`[ModUpdater] No compatible versions for: ${mod.name}`);
            continue;
          }

          const latestVersion = versions[0];

          // 버전 비교 (간단한 문자열 비교)
          if (this.isNewerVersion(latestVersion.versionNumber, mod.version)) {
            updates.push({
              modId: modInfo.id,
              modName: mod.name,
              fileName: mod.fileName,
              currentVersion: mod.version,
              latestVersion: latestVersion.versionNumber,
              latestVersionId: latestVersion.id,
              changelog: latestVersion.changelog,
              required: false, // TODO: 실제 required 상태 확인
              downloadUrl: latestVersion.downloadUrl,
              fileSize: latestVersion.fileSize,
            });

            console.log(`[ModUpdater] Update available: ${mod.name} ${mod.version} -> ${latestVersion.versionNumber}`);
          }
        } catch (error) {
          console.error(`[ModUpdater] Failed to check update for ${mod.name}:`, error);
        }
      }

      console.log(`[ModUpdater] Found ${updates.length} updates`);
      return updates;
    } catch (error) {
      console.error('[ModUpdater] Failed to check updates:', error);
      return [];
    }
  }

  /**
   * 모드 업데이트 실행
   */
  async updateMod(
    gameDir: string,
    update: ModUpdateInfo,
    onProgress?: (progress: number) => void
  ): Promise<void> {
    try {
      const modsDir = `${gameDir}/mods`;
      const modManager = new ModManager();

      console.log(`[ModUpdater] Updating ${update.modName}...`);

      // 기존 모드 파일 삭제
      await modManager.deleteMod(gameDir, update.fileName);

      // 새 버전 다운로드
      const { DownloadManager } = await import('./download-manager');
      const downloadManager = new DownloadManager();

      // Get latest version details
      const versions = await this.modrinthAPI.getModVersions(update.modId);
      const version = versions.find(v => v.id === update.latestVersionId);

      if (!version || !version.downloadUrl) {
        throw new Error('Download URL not found');
      }

      const taskId = downloadManager.addTask(
        version.downloadUrl,
        `${modsDir}/${version.fileName}`,
        version.sha1,
        'sha1'
      );

      await downloadManager.startAll((progress) => {
        onProgress?.(progress.progress);
      });

      console.log(`[ModUpdater] Successfully updated ${update.modName}`);
    } catch (error) {
      console.error(`[ModUpdater] Failed to update ${update.modName}:`, error);
      throw error;
    }
  }

  /**
   * 여러 모드 일괄 업데이트
   */
  async updateMods(
    gameDir: string,
    updates: ModUpdateInfo[],
    onProgress?: (current: number, total: number, modName: string) => void
  ): Promise<UpdateResult> {
    const success: string[] = [];
    const failed: Array<{ modName: string; error: string }> = [];
    const skipped: string[] = [];
    const total = updates.length;

    for (let i = 0; i < updates.length; i++) {
      const update = updates[i];
      
      onProgress?.(i + 1, total, update.modName);

      try {
        await this.updateMod(gameDir, update);
        success.push(update.modName);
      } catch (error) {
        console.error(`[ModUpdater] Failed to update ${update.modName}:`, error);
        failed.push({
          modName: update.modName,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return { success, failed, skipped };
  }

  /**
   * 필수 모드만 업데이트
   */
  async updateRequiredMods(
    gameDir: string,
    updates: ModUpdateInfo[],
    onProgress?: (current: number, total: number, modName: string) => void
  ): Promise<UpdateResult> {
    const requiredUpdates = updates.filter(u => u.required);
    return this.updateMods(gameDir, requiredUpdates, onProgress);
  }

  /**
   * 파일 이름에서 모드 슬러그 추출
   */
  private extractModSlug(fileName: string): string {
    // fabric-api-0.92.0+1.20.1.jar -> fabric-api
    const baseName = fileName.replace(/\.jar(\.disabled)?$/, '');
    const parts = baseName.split('-');
    
    // 버전 번호로 보이는 부분 제거
    const nameparts: string[] = [];
    for (const part of parts) {
      if (/^\d/.test(part)) {
        break;
      }
      nameparts.push(part);
    }
    
    return nameparts.join('-') || baseName;
  }

  /**
   * 간단한 버전 비교
   * TODO: semver 라이브러리 사용 고려
   */
  private isNewerVersion(latest: string, current: string): boolean {
    // 같으면 false
    if (latest === current) return false;

    // 간단한 문자열 비교 (실제로는 semver 사용 필요)
    const latestParts = latest.split(/[\.\-\+]/).map(p => parseInt(p) || p);
    const currentParts = current.split(/[\.\-\+]/).map(p => parseInt(p) || p);

    for (let i = 0; i < Math.max(latestParts.length, currentParts.length); i++) {
      const latestPart = latestParts[i] || 0;
      const currentPart = currentParts[i] || 0;

      if (typeof latestPart === 'number' && typeof currentPart === 'number') {
        if (latestPart > currentPart) return true;
        if (latestPart < currentPart) return false;
      } else {
        // 문자열 비교
        const latestStr = String(latestPart);
        const currentStr = String(currentPart);
        if (latestStr > currentStr) return true;
        if (latestStr < currentStr) return false;
      }
    }

    return false;
  }
}
