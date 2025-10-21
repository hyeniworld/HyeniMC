import { ModrinthAPI } from './modrinth-api';
import { CurseForgeAPI } from './curseforge-api';
import { ModResolver } from './mod-resolver';
import { ModManager } from './mod-manager';
import { isNewerVersion, parseModVersion } from '../../shared/utils/version';
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
  source: 'modrinth' | 'curseforge';  // Added source tracking
}

export interface UpdateResult {
  success: string[];
  failed: Array<{ modName: string; error: string }>;
  skipped: string[];
}

export class ModUpdater {
  private modrinthAPI: ModrinthAPI;
  private curseforgeAPI: CurseForgeAPI;
  private modResolver: ModResolver;

  constructor() {
    this.modrinthAPI = new ModrinthAPI();
    this.curseforgeAPI = new CurseForgeAPI();
    this.modResolver = new ModResolver();
  }

  /**
   * 설치된 모드들의 업데이트 확인
   * 
   * Modrinth와 CurseForge 모드 모두 지원
   * 소스 메타데이터가 있는 모드만 업데이트 확인 가능
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

      for (const mod of installedMods) {
        if (!mod.enabled) {
          console.log(`[ModUpdater] Skipping disabled mod: ${mod.name}`);
          continue;
        }

        try {
          // Check source metadata (from .meta.json file)
          const source = mod.source || 'local';
          const sourceModId = mod.sourceModId;
          const sourceFileId = mod.sourceFileId;

          // CurseForge mods with metadata
          if (source === 'curseforge' && sourceModId && sourceFileId) {
            const update = await this.checkCurseForgeUpdate(
              mod,
              sourceModId,
              sourceFileId,
              gameVersion,
              loaderType
            );
            if (update) {
              updates.push(update);
            }
            continue;
          }

          // Modrinth mods with metadata
          if (source === 'modrinth' && sourceModId) {
            const update = await this.checkModrinthUpdate(
              mod,
              sourceModId,
              sourceFileId,
              gameVersion,
              loaderType
            );
            if (update) {
              updates.push(update);
            }
            continue;
          }

          // Legacy: Try to resolve mod via filename/name search
          // Try Modrinth first, then CurseForge as fallback
          if (source === 'local' || source === 'modrinth' || source === 'curseforge') {
            console.log(`[ModUpdater] No metadata for ${mod.name}, trying legacy resolution`);
            
            // 1) Try Modrinth first
            const modrinthProjectId = await this.modResolver.resolveModrinthProjectId(
              mod.name,
              mod.fileName,
              gameVersion,
              loaderType
            );
            
            if (modrinthProjectId) {
              const update = await this.checkModrinthUpdate(
                mod,
                modrinthProjectId,
                undefined,
                gameVersion,
                loaderType
              );
              if (update) {
                updates.push(update);
              }
              // Modrinth에서 프로젝트를 찾았으면 업데이트 여부와 관계없이 종료
              // (이미 최신 버전이거나 호환 버전 없는 경우)
              continue;
            }

            // 2) Modrinth에서 프로젝트를 못 찾은 경우에만 CurseForge 시도
            console.log(`[ModUpdater] Not found on Modrinth: ${mod.name}, trying CurseForge fallback`);
            const curseforgeProjectId = await this.modResolver.resolveCurseForgeProjectId(
              mod.name,
              mod.fileName,
              gameVersion,
              loaderType
            );
            
            if (curseforgeProjectId) {
              const update = await this.checkCurseForgeUpdate(
                mod,
                curseforgeProjectId,
                '', // No current file ID for legacy mods
                gameVersion,
                loaderType
              );
              if (update) {
                updates.push(update);
              }
              // CurseForge에서 프로젝트를 찾았으면 종료
              continue;
            }

            console.log(`[ModUpdater] Could not resolve project for: ${mod.name} (not found on Modrinth or CurseForge)`);
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
   * Check update for a Modrinth mod
   */
  private async checkModrinthUpdate(
    mod: any,
    projectId: string,
    currentFileId: string | undefined,
    gameVersion: string,
    loaderType: string
  ): Promise<ModUpdateInfo | null> {
    try {
      const versions = await this.modrinthAPI.getModVersions(
        projectId,
        gameVersion,
        loaderType as any
      );

      if (versions.length === 0) {
        console.log(`[ModUpdater] No compatible Modrinth versions for: ${mod.name}`);
        return null;
      }

      const latestVersion = versions[0];

      // If we have current file ID, compare directly
      if (currentFileId && currentFileId === latestVersion.id) {
        return null; // Already latest
      }

      // Otherwise compare versions
      const slugForVersion = this.modResolver.normalizeSlug(this.modResolver.extractModSlug(mod.fileName));
      const currentVersion = mod.version || this.extractVersionFromFileName(mod.fileName, slugForVersion);
      const isSameFileName = !!latestVersion.fileName && mod.fileName === latestVersion.fileName;
      const needsUpdate = !isSameFileName && isNewerVersion(latestVersion.versionNumber, currentVersion);

      if (needsUpdate) {
        console.log(`[ModUpdater] Modrinth update available: ${mod.name} ${currentVersion} -> ${latestVersion.versionNumber}`);
        return {
          modId: projectId,
          modName: mod.name,
          fileName: mod.fileName,
          currentVersion,
          latestVersion: latestVersion.versionNumber,
          latestVersionId: latestVersion.id,
          changelog: latestVersion.changelog,
          required: false,
          downloadUrl: latestVersion.downloadUrl!,
          fileSize: latestVersion.fileSize!,
          source: 'modrinth',
        };
      }

      return null;
    } catch (error) {
      console.error(`[ModUpdater] Failed to check Modrinth update for ${mod.name}:`, error);
      return null;
    }
  }

  /**
   * Check update for a CurseForge mod
   */
  private async checkCurseForgeUpdate(
    mod: any,
    modId: string,
    currentFileId: string,
    gameVersion: string,
    loaderType: string
  ): Promise<ModUpdateInfo | null> {
    try {
      const versions = await this.curseforgeAPI.getModVersions(modId);

      if (versions.length === 0) {
        console.log(`[ModUpdater] No CurseForge versions for: ${mod.name}`);
        return null;
      }

      // Filter by game version and loader
      const compatibleVersions = versions.filter(v => {
        const matchesGameVersion = v.gameVersions?.includes(gameVersion);
        const matchesLoader = 
          (loaderType === 'neoforge' && v.loaders?.includes('neoforge')) ||
          (loaderType === 'forge' && v.loaders?.includes('forge')) ||
          (loaderType === 'fabric' && v.loaders?.includes('fabric')) ||
          (loaderType === 'quilt' && v.loaders?.includes('quilt'));
        return matchesGameVersion && matchesLoader;
      });

      if (compatibleVersions.length === 0) {
        console.log(`[ModUpdater] No compatible CurseForge versions for: ${mod.name}`);
        return null;
      }

      const latestVersion = compatibleVersions[0];

      // Compare file IDs
      if (currentFileId === latestVersion.id) {
        return null; // Already latest
      }

      // Check if actually newer
      const currentVersion = mod.version || 'unknown';
      const parsedCurrent = parseModVersion(currentVersion);
      const parsedLatest = parseModVersion(latestVersion.versionNumber);
      console.log(`[ModUpdater] Comparing versions for ${mod.name}: current=${currentVersion} (parsed: ${parsedCurrent}), latest=${latestVersion.versionNumber} (parsed: ${parsedLatest})`);
      const needsUpdate = isNewerVersion(latestVersion.versionNumber, currentVersion);

      if (needsUpdate) {
        console.log(`[ModUpdater] CurseForge update available: ${mod.name} ${currentVersion} -> ${latestVersion.versionNumber}`);
        return {
          modId: modId,
          modName: mod.name,
          fileName: mod.fileName,
          currentVersion,
          latestVersion: latestVersion.versionNumber,
          latestVersionId: latestVersion.id,
          changelog: latestVersion.changelog,
          required: false,
          downloadUrl: latestVersion.downloadUrl!,
          fileSize: latestVersion.fileSize!,
          source: 'curseforge',
        };
      }

      return null;
    } catch (error) {
      console.error(`[ModUpdater] Failed to check CurseForge update for ${mod.name}:`, error);
      return null;
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

      console.log(`[ModUpdater] Updating ${update.modName} from ${update.source}...`);

      // 기존 모드 파일 삭제
      await modManager.deleteMod(gameDir, update.fileName);

      // 새 버전 다운로드
      const { DownloadManager } = await import('./download-manager');
      const downloadManager = new DownloadManager(10, 10); // 기본 동시성 설정

      // Get latest version details based on source
      let version;
      if (update.source === 'curseforge') {
        const versions = await this.curseforgeAPI.getModVersions(update.modId);
        version = versions.find(v => v.id === update.latestVersionId);
      } else {
        const versions = await this.modrinthAPI.getModVersions(update.modId);
        version = versions.find(v => v.id === update.latestVersionId);
      }

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

      // Save source metadata for the updated mod
      try {
        const fs = await import('fs/promises');
        const metaPath = `${modsDir}/${version.fileName}.meta.json`;
        const metadata = {
          source: update.source,
          sourceModId: update.modId,
          sourceFileId: update.latestVersionId,
          installedAt: new Date().toISOString(),
        };
        await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2));
        console.log(`[ModUpdater] Saved metadata for updated mod: ${metaPath}`);
      } catch (metaError) {
        console.error('[ModUpdater] Failed to save metadata:', metaError);
      }

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
   * 파일명에서 버전 문자열을 단순 추출 (베스트 에포트)
   * 예: sodium-fabric-0.5.8+mc1.21.1.jar -> 0.5.8+mc1.21.1
   */
  private extractVersionFromFileName(fileName: string, slug: string): string {
    const base = fileName.replace(/\.jar(\.disabled)?$/, '');
    const idx = base.indexOf(slug);
    if (idx >= 0) {
      const after = base.slice(idx + slug.length);
      const trimmed = after.replace(/^[\-\_]/, '');
      return trimmed || base;
    }
    // 폴백: 마지막 '-' 이후를 버전으로 가정
    const parts = base.split('-');
    return parts.length > 1 ? parts.slice(1).join('-') : base;
  }

}
