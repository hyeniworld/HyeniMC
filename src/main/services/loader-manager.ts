import { FabricLoaderService } from './fabric-loader';
import { NeoForgeLoaderService } from './neoforge-loader';
import { QuiltLoader } from './quilt-loader';
import { LoaderType } from '../../shared/types/profile';

/**
 * 로더 버전 정보
 */
export interface LoaderVersionInfo {
  version: string;
  stable: boolean;
  recommended?: boolean;
}

/**
 * 모든 모드 로더를 관리하는 통합 매니저
 */
export class LoaderManager {
  private fabricService: FabricLoaderService;
  private neoforgeService: NeoForgeLoaderService;
  private quiltService: QuiltLoader;

  constructor() {
    this.fabricService = new FabricLoaderService();
    this.neoforgeService = new NeoForgeLoaderService();
    this.quiltService = new QuiltLoader();
  }

  /**
   * 특정 로더 타입의 버전 목록 가져오기
   */
  async getLoaderVersions(
    loaderType: LoaderType,
    minecraftVersion?: string,
    includeUnstable = false
  ): Promise<LoaderVersionInfo[]> {
    try {
      switch (loaderType) {
        case 'vanilla':
          return [];

        case 'fabric': {
          const versions = minecraftVersion
            ? await this.fabricService.getLoadersForGameVersion(minecraftVersion)
            : await this.fabricService.getLoaderVersions();
          
          // stable 필터링 (includeUnstable이 false인 경우)
          const filteredVersions = includeUnstable 
            ? versions 
            : versions.filter(v => v.stable);
          
          return filteredVersions.map(v => ({
            version: v.version,
            stable: v.stable,
            recommended: false,
          }));
        }

        case 'neoforge': {
          const versions = minecraftVersion
            ? await this.neoforgeService.getVersionsForMinecraft(minecraftVersion)
            : await this.neoforgeService.getVersions();
          
          // NeoForge 버전은 최신이 먼저 오도록 이미 정렬되어 있음
          // stable 필터링
          const filteredVersions = includeUnstable 
            ? versions 
            : versions.filter(v => !v.includes('beta') && !v.includes('alpha'));
          
          return filteredVersions.map(v => ({
            version: v,
            stable: !v.includes('beta') && !v.includes('alpha'),
            recommended: false,
          }));
        }

        case 'quilt': {
          if (!minecraftVersion) {
            throw new Error('Minecraft version is required for Quilt');
          }
          const versions = await this.quiltService.getVersions(minecraftVersion);
          return versions.map(v => ({
            version: v,
            stable: true,  // Quilt only returns stable versions
            recommended: false,
          }));
        }

        case 'forge':
          // Forge는 지원하지 않음 (명목상만 유지)
          console.warn('[LoaderManager] Forge is deprecated, use NeoForge instead');
          return [];

        default:
          throw new Error(`Unsupported loader type: ${loaderType}`);
      }
    } catch (error) {
      console.error(`[LoaderManager] Failed to get ${loaderType} versions:`, error);
      throw error;
    }
  }

  /**
   * 권장 로더 버전 가져오기
   */
  async getRecommendedVersion(
    loaderType: LoaderType,
    minecraftVersion: string
  ): Promise<string | null> {
    try {
      switch (loaderType) {
        case 'vanilla':
          return null;

        case 'fabric': {
          const recommended = await this.fabricService.getRecommendedLoaderVersion();
          return recommended?.version || null;
        }

        case 'neoforge':
          return await this.neoforgeService.getRecommendedVersion(minecraftVersion);

        case 'quilt': {
          const versions = await this.quiltService.getVersions(minecraftVersion);
          return versions.length > 0 ? versions[0] : null;
        }

        case 'forge':
          console.warn('[LoaderManager] Forge is deprecated, use NeoForge instead');
          return null;

        default:
          return null;
      }
    } catch (error) {
      console.error(`[LoaderManager] Failed to get recommended ${loaderType} version:`, error);
      return null;
    }
  }

  /**
   * 로더 설치
   */
  async installLoader(
    loaderType: LoaderType,
    minecraftVersion: string,
    loaderVersion: string,
    gameDir: string,
    onProgress?: (message: string, current: number, total: number) => void
  ): Promise<string> {
    try {
      console.log(`[LoaderManager] Installing ${loaderType} ${loaderVersion} for MC ${minecraftVersion}...`);

      switch (loaderType) {
        case 'vanilla':
          return minecraftVersion;

        case 'fabric':
          return await this.fabricService.install(
            minecraftVersion,
            loaderVersion,
            gameDir,
            onProgress
          );

        case 'neoforge':
          return await this.neoforgeService.install(
            minecraftVersion,
            loaderVersion,
            gameDir,
            onProgress
          );

        case 'quilt':
          return await this.quiltService.install(
            minecraftVersion,
            loaderVersion,
            gameDir,
            onProgress
          );

        case 'forge':
          throw new Error('Forge is deprecated, please use NeoForge instead');

        default:
          throw new Error(`Unsupported loader type: ${loaderType}`);
      }
    } catch (error) {
      console.error(`[LoaderManager] Failed to install ${loaderType}:`, error);
      throw error;
    }
  }

  /**
   * 로더가 설치되어 있는지 확인
   */
  async isLoaderInstalled(
    loaderType: LoaderType,
    minecraftVersion: string,
    loaderVersion: string,
    gameDir: string
  ): Promise<boolean> {
    try {
      switch (loaderType) {
        case 'vanilla':
          return true;

        case 'fabric':
          return await this.fabricService.isInstalled(minecraftVersion, loaderVersion, gameDir);

        case 'neoforge':
          return await this.neoforgeService.isInstalled(loaderVersion, gameDir);

        case 'quilt': {
          const versionId = `quilt-loader-${loaderVersion}-${minecraftVersion}`;
          return await this.quiltService.verify(versionId, gameDir);
        }

        case 'forge':
          return false;

        default:
          return false;
      }
    } catch (error) {
      console.error(`[LoaderManager] Failed to check ${loaderType} installation:`, error);
      return false;
    }
  }

  /**
   * 실행할 버전 ID 가져오기 (로더 포함)
   */
  getVersionId(
    loaderType: LoaderType,
    minecraftVersion: string,
    loaderVersion?: string
  ): string {
    switch (loaderType) {
      case 'vanilla':
        return minecraftVersion;

      case 'fabric':
        if (!loaderVersion) {
          throw new Error('Fabric loader version is required');
        }
        return `fabric-loader-${loaderVersion}-${minecraftVersion}`;

      case 'neoforge':
        if (!loaderVersion) {
          throw new Error('NeoForge version is required');
        }
        return `neoforge-${loaderVersion}`;

      case 'quilt':
        if (!loaderVersion) {
          throw new Error('Quilt loader version is required');
        }
        return `quilt-loader-${loaderVersion}-${minecraftVersion}`;

      case 'forge':
        throw new Error('Forge is deprecated, use NeoForge instead');

      default:
        return minecraftVersion;
    }
  }
}
