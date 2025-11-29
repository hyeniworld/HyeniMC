import axios from 'axios';
import * as fs from 'fs/promises';
import * as path from 'path';
import { API_ENDPOINTS } from '../../shared/constants';

/**
 * Fabric 로더 버전 정보
 */
export interface FabricLoaderVersion {
  separator: string;
  build: number;
  maven: string;
  version: string;
  stable: boolean;
}

/**
 * Fabric 게임 버전 정보
 */
export interface FabricGameVersion {
  version: string;
  stable: boolean;
}

/**
 * Fabric 프로필 정보
 */
export interface FabricProfile {
  id: string;
  inheritsFrom: string;
  releaseTime: string;
  time: string;
  type: string;
  mainClass: string;
  arguments: {
    game: string[];
    jvm: string[];
  };
  libraries: Array<{
    name: string;
    url: string;
  }>;
}

/**
 * Fabric Meta API 클라이언트
 */
export class FabricLoaderService {
  private baseUrl = API_ENDPOINTS.FABRIC_META;

  /**
   * 사용 가능한 Fabric 로더 버전 목록 가져오기 (cached via gRPC)
   */
  async getLoaderVersions(forceRefresh = false): Promise<FabricLoaderVersion[]> {
    try {
      console.log('[Fabric] Fetching loader versions...');
      
      // Use cached gRPC service
      const { cacheRpc } = await import('../grpc/clients');
      const response = await cacheRpc.getFabricVersions({ forceRefresh });
      
      // Convert gRPC response to FabricLoaderVersion
      const versions: FabricLoaderVersion[] = response.versions.map(v => ({
        separator: '.',
        build: v.buildNumber || 0,
        maven: v.mavenCoords,
        version: v.version,
        stable: v.stable,
      }));
      
      console.log(`[Fabric] Found ${versions.length} loader versions (cached)`);
      return versions;
    } catch (error) {
      console.error('[Fabric] Failed to fetch loader versions:', error);
      throw new Error('Failed to fetch Fabric loader versions');
    }
  }

  /**
   * 특정 게임 버전에 대한 Fabric 로더 버전 가져오기
   */
  async getLoadersForGameVersion(gameVersion: string): Promise<FabricLoaderVersion[]> {
    try {
      console.log(`[Fabric] Fetching loaders for game version ${gameVersion}...`);
      const response = await axios.get(
        `${this.baseUrl}${API_ENDPOINTS.FABRIC_VERSIONS}/loader/${gameVersion}`
      );
      
      // API 응답 구조: [{ loader: {...}, intermediary: {...}, launcherMeta: {...} }]
      // loader 객체만 추출
      const loaders: FabricLoaderVersion[] = response.data.map((item: any) => {
        if (item.loader) {
          return {
            separator: item.loader.separator,
            build: item.loader.build,
            maven: item.loader.maven,
            version: item.loader.version,
            stable: item.loader.stable,
          };
        }
        return null;
      }).filter((loader: any) => loader !== null);
      
      console.log(`[Fabric] Found ${loaders.length} compatible loaders`);
      if (loaders.length > 0) {
        console.log(`[Fabric] First loader:`, loaders[0]);
      }
      
      return loaders;
    } catch (error) {
      console.error('[Fabric] Failed to fetch loaders for game version:', error);
      throw new Error(`Failed to fetch Fabric loaders for ${gameVersion}`);
    }
  }

  /**
   * Fabric 프로필 JSON 다운로드
   */
  async downloadProfile(
    gameVersion: string,
    loaderVersion: string,
    outputPath: string
  ): Promise<FabricProfile> {
    try {
      console.log(`[Fabric] Downloading profile for ${gameVersion} with loader ${loaderVersion}...`);
      
      const response = await axios.get<FabricProfile>(
        `${this.baseUrl}${API_ENDPOINTS.FABRIC_VERSIONS}/loader/${gameVersion}/${loaderVersion}/profile/json`
      );

      // 프로필 JSON 저장
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, JSON.stringify(response.data, null, 2));

      console.log(`[Fabric] Profile saved to ${outputPath}`);
      return response.data;
    } catch (error) {
      console.error('[Fabric] Failed to download profile:', error);
      throw new Error('Failed to download Fabric profile');
    }
  }

  /**
   * 권장 Fabric 로더 버전 가져오기 (stable 우선)
   */
  async getRecommendedLoaderVersion(): Promise<FabricLoaderVersion | null> {
    try {
      const versions = await this.getLoaderVersions();
      
      // stable 버전 우선
      const stable = versions.find(v => v.stable);
      if (stable) {
        return stable;
      }

      // stable이 없으면 최신 버전
      return versions[0] || null;
    } catch (error) {
      console.error('[Fabric] Failed to get recommended version:', error);
      return null;
    }
  }

  /**
   * Fabric 라이브러리 다운로드
   */
  async downloadLibraries(
    profile: FabricProfile,
    librariesDir: string,
    onProgress?: (current: number, total: number) => void
  ): Promise<void> {
    console.log(`[Fabric] Downloading ${profile.libraries.length} libraries...`);

    // Maven 저장소 목록 (순서대로 시도)
    const mavenRepositories = [
      'https://maven.fabricmc.net/',
      'https://repo1.maven.org/maven2/',  // Maven Central
      'https://repo.maven.apache.org/maven2/',  // Maven Central mirror
    ];

    const downloadPromises = profile.libraries.map(async (lib, index) => {
      const parts = lib.name.split(':');
      const [group, artifact, version] = parts;
      
      const groupPath = group.replace(/\./g, '/');
      const fileName = `${artifact}-${version}.jar`;
      const libPath = path.join(librariesDir, groupPath, artifact, version, fileName);

      // 이미 존재하면 스킵
      try {
        await fs.access(libPath);
        console.log(`[Fabric] Library already exists: ${lib.name}`);
        if (onProgress) onProgress(index + 1, profile.libraries.length);
        return;
      } catch {
        // 파일이 없으면 다운로드
      }

      // URL 목록 생성 (lib.url이 있으면 먼저 시도, 그 다음 다른 저장소들)
      const urlsToTry: string[] = [];
      const artifactPath = `${groupPath}/${artifact}/${version}/${fileName}`;
      
      if (lib.url && lib.url.trim()) {
        // lib.url이 슬래시로 끝나지 않으면 추가
        const baseUrl = lib.url.endsWith('/') ? lib.url : `${lib.url}/`;
        urlsToTry.push(`${baseUrl}${artifactPath}`);
      }
      
      // 다른 Maven 저장소도 추가
      for (const repo of mavenRepositories) {
        const url = `${repo}${artifactPath}`;
        if (!urlsToTry.includes(url)) {
          urlsToTry.push(url);
        }
      }

      let downloaded = false;
      let lastError: Error | null = null;

      for (const url of urlsToTry) {
        try {
          console.log(`[Fabric] Downloading library: ${lib.name} from ${url}`);
          const response = await axios.get(url, { 
            responseType: 'arraybuffer',
            timeout: 30000,
            validateStatus: (status) => status === 200,
          });
          
          await fs.mkdir(path.dirname(libPath), { recursive: true });
          await fs.writeFile(libPath, response.data);
          
          console.log(`[Fabric] Downloaded: ${lib.name}`);
          downloaded = true;
          break;
        } catch (error) {
          lastError = error as Error;
          // 다음 URL 시도
        }
      }

      if (!downloaded) {
        console.error(`[Fabric] Failed to download library ${lib.name} from all sources`);
        throw new Error(`Failed to download Fabric library: ${lib.name}`);
      }

      if (onProgress) onProgress(index + 1, profile.libraries.length);
    });

    await Promise.all(downloadPromises);
    console.log('[Fabric] All libraries downloaded');
  }

  /**
   * Fabric 설치 (프로필 + 라이브러리)
   */
  async install(
    gameVersion: string,
    loaderVersion: string,
    gameDir: string,
    onProgress?: (message: string, current: number, total: number) => void
  ): Promise<string> {
    try {
      console.log(`[Fabric] Installing Fabric ${loaderVersion} for Minecraft ${gameVersion}...`);

      // 1. 프로필 다운로드
      if (onProgress) onProgress('Downloading Fabric profile...', 1, 3);
      const versionId = `fabric-loader-${loaderVersion}-${gameVersion}`;
      const versionDir = path.join(gameDir, 'versions', versionId);
      const profilePath = path.join(versionDir, `${versionId}.json`);

      const profile = await this.downloadProfile(gameVersion, loaderVersion, profilePath);

      // 2. 라이브러리 다운로드 (shared libraries 디렉토리 사용)
      if (onProgress) onProgress('Downloading Fabric libraries...', 2, 3);
      const { getSharedLibrariesDir } = await import('../utils/paths');
      const librariesDir = getSharedLibrariesDir();
      console.log(`[Fabric] Using shared libraries directory: ${librariesDir}`);
      
      await this.downloadLibraries(profile, librariesDir, (current, total) => {
        if (onProgress) {
          onProgress(`Downloading libraries (${current}/${total})...`, 2, 3);
        }
      });

      // 3. 완료
      if (onProgress) onProgress('Fabric installation completed', 3, 3);
      console.log(`[Fabric] Installation completed: ${versionId}`);
      
      return versionId;
    } catch (error) {
      console.error('[Fabric] Installation failed:', error);
      throw error;
    }
  }

  /**
   * Fabric이 설치되어 있는지 확인
   */
  async isInstalled(gameVersion: string, loaderVersion: string, gameDir: string): Promise<boolean> {
    const versionId = `fabric-loader-${loaderVersion}-${gameVersion}`;
    const profilePath = path.join(gameDir, 'versions', versionId, `${versionId}.json`);

    try {
      await fs.access(profilePath);
      return true;
    } catch {
      return false;
    }
  }
}
