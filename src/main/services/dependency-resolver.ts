import { ModrinthAPI } from './modrinth-api';
import { CurseForgeAPI } from './curseforge-api';
import { ModManager } from './mod-manager';
import type { ModVersion, ModDependency, LoaderType } from '../../shared/types/profile';

export interface DependencyResolution {
  modId: string;
  modName: string;
  versionId: string;
  versionNumber: string;
  required: boolean;
  alreadyInstalled: boolean;
  source: 'modrinth' | 'curseforge';
}

export interface DependencyIssue {
  modId: string;
  modName: string;
  type: 'missing' | 'incompatible';
  dependency: ModDependency;
  message: string;
}

export class DependencyResolver {
  private modrinthAPI: ModrinthAPI;
  private curseforgeAPI: CurseForgeAPI;

  constructor() {
    this.modrinthAPI = new ModrinthAPI();
    this.curseforgeAPI = new CurseForgeAPI();
  }

  /**
   * 모드 버전의 의존성 확인 및 해결
   */
  async resolveDependencies(
    versionId: string,
    gameVersion: string,
    loaderType: string,
    installedMods: Array<{ id: string; name: string; fileName: string; sourceModId?: string }>,
    source: 'modrinth' | 'curseforge' = 'modrinth'
  ): Promise<{
    dependencies: DependencyResolution[];
    issues: DependencyIssue[];
  }> {
    const dependencies: DependencyResolution[] = [];
    const issues: DependencyIssue[] = [];
    const processedMods = new Set<string>();

    try {
      console.log(`[DependencyResolver] Resolving dependencies from ${source} for version: ${versionId}`);
      
      // Get the version details from the appropriate source
      let version: ModVersion | null = null;
      
      if (source === 'curseforge') {
        // For CurseForge, dependency checking is limited
        // CurseForge API returns dependencies but doesn't have a direct getVersion by versionId
        // We'll skip dependency resolution for CurseForge for now
        // Dependencies are still included in the version data when fetched
        console.log(`[DependencyResolver] CurseForge dependency resolution skipped (dependencies included in version data)`);
        return { dependencies, issues };
      }
      
      version = await this.modrinthAPI.getVersion(versionId);
      
      if (!version || !version.dependencies) {
        return { dependencies, issues };
      }

      // Process each dependency
      for (const dep of version.dependencies) {
        if (processedMods.has(dep.modId)) {
          continue;
        }
        processedMods.add(dep.modId);

        // Skip if dependency type is not required or optional
        if (dep.type !== 'required' && dep.type !== 'optional') {
          continue;
        }

        const isRequired = dep.type === 'required';

        // Check if already installed (metadata-based only)
        const alreadyInstalled = installedMods.some(mod => 
          mod.sourceModId === dep.modId
        );

        if (alreadyInstalled) {
          console.log(`[DependencyResolver] Dependency ${dep.modId} already installed`);
          continue;
        }

        try {
          // Get the dependency mod details (only for Modrinth at this point)
          const depDetails = await this.modrinthAPI.getModDetails(dep.modId);
          const depVersions = await this.modrinthAPI.getModVersions(
            dep.modId,
            gameVersion,
            loaderType as any
          );

          if (depVersions.length === 0) {
            issues.push({
              modId: dep.modId,
              modName: depDetails.name,
              type: 'missing',
              dependency: dep,
              message: `호환되는 버전을 찾을 수 없습니다 (게임 버전: ${gameVersion}, 로더: ${loaderType})`,
            });
            continue;
          }

          // Use the latest compatible version
          const latestVersion = depVersions[0];

          dependencies.push({
            modId: dep.modId,
            modName: depDetails.name,
            versionId: latestVersion.id,
            versionNumber: latestVersion.versionNumber,
            required: isRequired,
            alreadyInstalled: false,
            source: source,
          });

          console.log(`[DependencyResolver] Found dependency: ${depDetails.name} (${latestVersion.versionNumber})`);
        } catch (error) {
          console.error(`[DependencyResolver] Failed to resolve dependency ${dep.modId}:`, error);
          issues.push({
            modId: dep.modId,
            modName: dep.modId,
            type: 'missing',
            dependency: dep,
            message: `의존성 정보를 가져올 수 없습니다`,
          });
        }
      }

      return { dependencies, issues };
    } catch (error) {
      console.error('[DependencyResolver] Failed to resolve dependencies:', error);
      return { dependencies, issues };
    }
  }

  /**
   * 프로필의 모든 모드 의존성 확인
   */
  async checkProfileDependencies(
    gameDir: string,
    gameVersion: string,
    loaderType: string
  ): Promise<DependencyIssue[]> {
    const issues: DependencyIssue[] = [];

    try {
      const modManager = new ModManager();
      const installedMods = await modManager.listMods(gameDir);

      // For now, we can't check dependencies of locally installed mods
      // as we need to store source information
      console.log(`[DependencyResolver] Checking ${installedMods.length} installed mods`);
      
      // TODO: Implement dependency checking for installed mods
      // This would require storing source information (modrinth ID, version ID) in mod metadata

      return issues;
    } catch (error) {
      console.error('[DependencyResolver] Failed to check profile dependencies:', error);
      return issues;
    }
  }

  /**
   * 의존성 모드들을 설치
   */
  async installDependencies(
    dependencies: DependencyResolution[],
    gameDir: string,
    onProgress?: (current: number, total: number, modName: string) => void
  ): Promise<{
    success: string[];
    failed: Array<{ modId: string; error: string }>;
  }> {
    const success: string[] = [];
    const failed: Array<{ modId: string; error: string }> = [];
    const total = dependencies.length;

    for (let i = 0; i < dependencies.length; i++) {
      const dep = dependencies[i];
      
      onProgress?.(i + 1, total, dep.modName);

      try {
        console.log(`[DependencyResolver] Installing dependency ${dep.modName}...`);
        
        // Get version details for download
        const versions = await this.modrinthAPI.getModVersions(dep.modId);
        const version = versions.find(v => v.id === dep.versionId);

        if (!version || !version.downloadUrl) {
          throw new Error('Download URL not found');
        }

        const { DownloadManager } = await import('./download-manager');
        const downloadManager = new DownloadManager(10, 10); // 기본 동시성 설정
        const modsDir = `${gameDir}/mods`;

        // Ensure mods directory exists
        const fs = await import('fs/promises');
        await fs.mkdir(modsDir, { recursive: true });

        // Download the dependency
        const taskId = downloadManager.addTask(
          version.downloadUrl,
          `${modsDir}/${version.fileName}`,
          version.sha1,
          'sha1'
        );

        await downloadManager.startAll();

        success.push(dep.modName);
        console.log(`[DependencyResolver] Successfully installed ${dep.modName}`);
      } catch (error) {
        console.error(`[DependencyResolver] Failed to install ${dep.modName}:`, error);
        failed.push({
          modId: dep.modId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return { success, failed };
  }
}
