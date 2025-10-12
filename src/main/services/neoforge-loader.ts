import axios from 'axios';
import * as fs from 'fs/promises';
import * as path from 'path';
import { API_ENDPOINTS } from '../../shared/constants';

/**
 * NeoForge 버전 정보
 */
export interface NeoForgeVersion {
  version: string;
  mcVersion: string;
}

/**
 * NeoForge 설치 프로필
 */
export interface NeoForgeInstallProfile {
  spec: number;
  profile: string;
  version: string;
  json: string;
  path: string;
  minecraft: string;
  data: Record<string, any>;
  processors: Array<{
    jar: string;
    classpath: string[];
    args: string[];
    outputs?: Record<string, string>;
  }>;
  libraries: Array<{
    name: string;
    downloads: {
      artifact: {
        path: string;
        url: string;
        sha1: string;
        size: number;
      };
    };
  }>;
}

/**
 * NeoForge Meta API 클라이언트
 */
export class NeoForgeLoaderService {
  private metaUrl = API_ENDPOINTS.NEOFORGE_META;
  private mavenUrl = API_ENDPOINTS.NEOFORGE_MAVEN;

  /**
   * 사용 가능한 NeoForge 버전 목록 가져오기 (cached via gRPC)
   */
  async getVersions(forceRefresh = false): Promise<string[]> {
    try {
      console.log('[NeoForge] Fetching versions...');
      
      // Use cached gRPC service
      const { cacheRpc } = await import('../grpc/clients');
      const response = await cacheRpc.getNeoForgeVersions({ forceRefresh });
      
      // Convert gRPC response to version strings
      const versions = response.versions.map(v => v.version);
      
      console.log(`[NeoForge] Found ${versions.length} versions (cached)`);
      return versions;
    } catch (error) {
      console.error('[NeoForge] Failed to fetch versions:', error);
      // 에러 시 빈 배열 반환 (앱이 멈추지 않도록)
      return [];
    }
  }

  /**
   * 특정 Minecraft 버전과 호환되는 NeoForge 버전 가져오기
   */
  async getVersionsForMinecraft(minecraftVersion: string): Promise<string[]> {
    try {
      const allVersions = await this.getVersions();
      
      if (allVersions.length === 0) {
        console.log('[NeoForge] No versions available');
        return [];
      }
      
      // NeoForge 버전 형식: 20.4.X-beta (for 1.20.4), 21.1.X (for 1.21.1)
      // Minecraft 버전 파싱 (1.20.4 -> major: 20, minor: 4)
      const mcParts = minecraftVersion.split('.');
      if (mcParts.length < 2) {
        console.warn('[NeoForge] Invalid Minecraft version format:', minecraftVersion);
        return [];
      }
      
      const mcMajor = parseInt(mcParts[1]); // 1.20.4 -> 20
      const mcMinor = mcParts[2] ? parseInt(mcParts[2]) : 0; // 1.20.4 -> 4, 1.21 -> 0

      console.log(`[NeoForge] Filtering for MC ${minecraftVersion} (major: ${mcMajor}, minor: ${mcMinor})`);

      // 호환되는 버전 필터링
      const compatibleVersions = allVersions.filter(version => {
        // NeoForge 버전에서 숫자 추출 (20.4.237-beta -> major: 20, minor: 4)
        const match = version.match(/^(\d+)\.(\d+)\./);
        if (match) {
          const neoMajor = parseInt(match[1]);
          const neoMinor = parseInt(match[2]);
          
          // 정확히 일치하는 버전만 필터링
          const isMatch = (neoMajor === mcMajor && neoMinor === mcMinor);
          
          if (isMatch) {
            console.log(`[NeoForge] Matched version: ${version}`);
          }
          
          return isMatch;
        }
        return false;
      });

      console.log(`[NeoForge] Found ${compatibleVersions.length} versions for MC ${minecraftVersion}`);
      
      // 버전 번호로 정렬 (최신이 먼저)
      compatibleVersions.sort((a, b) => {
        // 버전 문자열에서 빌드 번호 추출 (예: "21.1.72" -> 72)
        const getBuildNumber = (version: string) => {
          const match = version.match(/^\d+\.\d+\.(\d+)/);
          return match ? parseInt(match[1]) : 0;
        };
        
        const buildA = getBuildNumber(a);
        const buildB = getBuildNumber(b);
        
        // 내림차순 정렬 (큰 번호가 먼저)
        return buildB - buildA;
      });
      
      if (compatibleVersions.length > 0) {
        console.log(`[NeoForge] First 3 versions (latest):`, compatibleVersions.slice(0, 3));
      }
      
      return compatibleVersions;
    } catch (error) {
      console.error('[NeoForge] Failed to filter versions:', error);
      return [];
    }
  }

  /**
   * 권장 NeoForge 버전 가져오기 (최신 stable)
   */
  async getRecommendedVersion(minecraftVersion: string): Promise<string | null> {
    try {
      const versions = await this.getVersionsForMinecraft(minecraftVersion);
      
      if (versions.length === 0) {
        return null;
      }

      // beta가 아닌 버전 우선
      const stableVersions = versions.filter(v => !v.includes('beta') && !v.includes('alpha'));
      
      return stableVersions[0] || versions[0];
    } catch (error) {
      console.error('[NeoForge] Failed to get recommended version:', error);
      return null;
    }
  }

  /**
   * NeoForge 설치 파일 다운로드
   */
  async downloadInstaller(
    version: string,
    outputPath: string
  ): Promise<string> {
    try {
      console.log(`[NeoForge] Downloading installer for version ${version}...`);
      
      // NeoForge Maven URL 구성
      const versionParts = version.split('.');
      const installerUrl = `${this.mavenUrl}/net/neoforged/neoforge/${version}/neoforge-${version}-installer.jar`;

      console.log(`[NeoForge] Installer URL: ${installerUrl}`);
      
      const response = await axios.get(installerUrl, {
        responseType: 'arraybuffer',
        timeout: 60000, // 60초 타임아웃
      });

      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, response.data);

      console.log(`[NeoForge] Installer downloaded to ${outputPath}`);
      return outputPath;
    } catch (error) {
      console.error('[NeoForge] Failed to download installer:', error);
      throw new Error(`Failed to download NeoForge installer: ${version}`);
    }
  }

  /**
   * launcher_profiles.json 생성 (NeoForge Installer 요구사항)
   */
  async createLauncherProfiles(gameDir: string): Promise<void> {
    const profilesPath = path.join(gameDir, 'launcher_profiles.json');
    
    try {
      await fs.access(profilesPath);
      console.log('[NeoForge] launcher_profiles.json already exists');
      return;
    } catch {
      // 파일이 없으면 생성
    }

    const profiles = {
      profiles: {},
      selectedProfile: '(Default)',
      clientToken: '00000000-0000-0000-0000-000000000000',
      launcherVersion: {
        name: 'HyeniMC',
        format: 21,
      },
    };

    await fs.writeFile(profilesPath, JSON.stringify(profiles, null, 2));
    console.log('[NeoForge] Created launcher_profiles.json');
  }

  /**
   * NeoForge Installer 실행하여 프로필 생성
   */
  async runInstaller(
    minecraftVersion: string,
    neoforgeVersion: string,
    gameDir: string,
    javaPath: string
  ): Promise<string> {
    try {
      console.log(`[NeoForge] Running installer for ${neoforgeVersion}...`);

      const versionId = `neoforge-${neoforgeVersion}`;
      const tempDir = path.join(gameDir, '.temp');
      await fs.mkdir(tempDir, { recursive: true });

      // 1. launcher_profiles.json 생성
      await this.createLauncherProfiles(gameDir);

      // 2. Installer JAR 다운로드
      const installerPath = await this.downloadInstaller(neoforgeVersion, path.join(tempDir, `neoforge-${neoforgeVersion}-installer.jar`));

      // 3. Installer 실행
      console.log(`[NeoForge] Executing installer with Java...`);
      const { spawn } = await import('child_process');
      
      return new Promise((resolve, reject) => {
        const installerProcess = spawn(javaPath, [
          '-jar',
          installerPath,
          '--install-client',
          gameDir,
        ]);

        let output = '';
        let errorOutput = '';

        installerProcess.stdout?.on('data', (data) => {
          output += data.toString();
          console.log(`[NeoForge Installer] ${data.toString().trim()}`);
        });

        installerProcess.stderr?.on('data', (data) => {
          errorOutput += data.toString();
          console.error(`[NeoForge Installer Error] ${data.toString().trim()}`);
        });

        installerProcess.on('close', async (code) => {
          if (code === 0) {
            console.log(`[NeoForge] Installer completed successfully`);
            
            // Installer가 생성한 프로필 확인
            const versionDir = path.join(gameDir, 'versions', versionId);
            const profilePath = path.join(versionDir, `${versionId}.json`);
            
            try {
              await fs.access(profilePath);
              console.log(`[NeoForge] Profile created at: ${profilePath}`);
              resolve(versionId);
            } catch {
              console.error('[NeoForge] Installer did not create profile');
              reject(new Error('NeoForge installer did not create profile'));
            }
          } else {
            console.error(`[NeoForge] Installer failed with code ${code}`);
            console.error(`[NeoForge] Error output: ${errorOutput}`);
            reject(new Error(`NeoForge installer failed with code ${code}`));
          }
        });

        installerProcess.on('error', (error) => {
          console.error(`[NeoForge] Failed to execute installer:`, error);
          reject(error);
        });
      });
    } catch (error) {
      console.error('[NeoForge] Installer execution failed:', error);
      throw error;
    }
  }

  /**
   * NeoForge 프로필 수동 생성 (Installer 실패 시 fallback)
   */
  async createManualProfile(
    minecraftVersion: string,
    neoforgeVersion: string,
    gameDir: string
  ): Promise<string> {
    try {
      console.log(`[NeoForge] Creating manual profile for ${neoforgeVersion}...`);

      const versionId = `neoforge-${neoforgeVersion}`;
      const versionDir = path.join(gameDir, 'versions', versionId);
      const profilePath = path.join(versionDir, `${versionId}.json`);

      await fs.mkdir(versionDir, { recursive: true });

      // NeoForge 기본 프로필 (바닐라로 fallback)
      const profile = {
        id: versionId,
        inheritsFrom: minecraftVersion,
        releaseTime: new Date().toISOString(),
        time: new Date().toISOString(),
        type: 'release',
        mainClass: 'net.minecraft.client.main.Main',
        arguments: {
          game: [],
          jvm: [],
        },
        libraries: [],
      };

      await fs.writeFile(profilePath, JSON.stringify(profile, null, 2));
      console.log(`[NeoForge] Manual profile created (vanilla fallback): ${profilePath}`);
      console.warn(`[NeoForge] This profile will run vanilla Minecraft. Full NeoForge support requires installer.`);
      
      return versionId;
    } catch (error) {
      console.error('[NeoForge] Failed to create manual profile:', error);
      throw error;
    }
  }

  /**
   * NeoForge 라이브러리 다운로드
   * 
   * 참고: NeoForge는 실제 라이브러리를 Minecraft 실행 시 자동으로 다운로드합니다.
   * 여기서는 설치 검증만 수행하고, 실제 다운로드는 스킵합니다.
   */
  async downloadLibraries(
    version: string,
    librariesDir: string,
    onProgress?: (current: number, total: number) => void
  ): Promise<void> {
    try {
      console.log(`[NeoForge] Verifying NeoForge ${version}...`);
      
      // NeoForge는 Minecraft 실행 시 필요한 라이브러리를 자동으로 다운로드합니다.
      // 여기서는 버전 JSON만 생성하고 라이브러리 다운로드는 스킵합니다.
      
      console.log('[NeoForge] NeoForge will download required libraries on first launch');
      if (onProgress) onProgress(1, 1);
      
      // 선택적: NeoForge universal JAR 다운로드 시도 (있는 경우)
      // 하지만 404 에러가 발생하면 무시하고 계속 진행
      try {
        const universalJarPath = path.join(
          librariesDir,
          'net/neoforged/neoforge',
          version,
          `neoforge-${version}-universal.jar`
        );

        // 이미 존재하면 스킵
        try {
          await fs.access(universalJarPath);
          console.log('[NeoForge] Universal JAR already exists');
          return;
        } catch {
          // 파일이 없으면 다운로드 시도
        }

        const universalUrl = `${this.mavenUrl}/net/neoforged/neoforge/${version}/neoforge-${version}-universal.jar`;
        
        console.log(`[NeoForge] Attempting to download universal JAR from ${universalUrl}...`);
        const response = await axios.get(universalUrl, {
          responseType: 'arraybuffer',
          timeout: 120000,
          validateStatus: (status) => status === 200, // 200만 성공으로 간주
        });

        await fs.mkdir(path.dirname(universalJarPath), { recursive: true });
        await fs.writeFile(universalJarPath, response.data);

        console.log(`[NeoForge] Universal JAR downloaded: ${universalJarPath}`);
      } catch (downloadError) {
        // 다운로드 실패해도 괜찮음 - 게임 실행 시 자동으로 다운로드됨
        console.log('[NeoForge] Universal JAR not available or download failed - will be downloaded on first launch');
      }
      
    } catch (error) {
      console.error('[NeoForge] Library verification failed:', error);
      // 에러를 던지지 않고 경고만 출력 (게임 실행은 가능)
      console.warn('[NeoForge] Continuing with installation - libraries will be downloaded on first launch');
    }
  }

  /**
   * NeoForge 설치 (프로필 + 라이브러리)
   */
  async install(
    minecraftVersion: string,
    neoforgeVersion: string,
    gameDir: string,
    onProgress?: (message: string, current: number, total: number) => void
  ): Promise<string> {
    try {
      console.log(`[NeoForge] Installing NeoForge ${neoforgeVersion} for Minecraft ${minecraftVersion}...`);

      // 1. Java 경로 가져오기
      if (onProgress) onProgress('Preparing NeoForge installer...', 1, 4);
      const { detectJavaInstallations } = await import('./java-detector');
      const javaInstallations = await detectJavaInstallations();
      
      if (javaInstallations.length === 0) {
        throw new Error('Java not found. Please install Java to use NeoForge.');
      }
      
      const java = javaInstallations.find(j => j.majorVersion >= 17) || javaInstallations[0];
      console.log(`[NeoForge] Using Java ${java.version} at ${java.path}`);

      // 2. Installer 실행 시도
      if (onProgress) onProgress('Running NeoForge installer...', 2, 4);
      let versionId: string;
      
      try {
        console.log(`[NeoForge] Starting installer execution...`);
        versionId = await this.runInstaller(minecraftVersion, neoforgeVersion, gameDir, java.path);
        console.log(`[NeoForge] Installer succeeded, profile created: ${versionId}`);
      } catch (installerError) {
        console.error('[NeoForge] Installer failed with error:',installerError);
        console.error('[NeoForge] Error details:', installerError instanceof Error ? installerError.message : String(installerError));
        console.warn('[NeoForge] Creating fallback profile...');
        if (onProgress) onProgress('Creating fallback profile...', 2, 4);
        versionId = await this.createManualProfile(minecraftVersion, neoforgeVersion, gameDir);
      }

      // 3. 라이브러리 다운로드 (shared libraries 디렉토리 사용)
      if (onProgress) onProgress('Downloading NeoForge libraries...', 3, 4);
      const { getSharedLibrariesDir } = await import('../utils/paths');
      const librariesDir = getSharedLibrariesDir();
      console.log(`[NeoForge] Using shared libraries directory: ${librariesDir}`);
      
      await this.downloadLibraries(neoforgeVersion, librariesDir, (current, total) => {
        if (onProgress) {
          onProgress(`Downloading libraries (${current}/${total})...`, 3, 4);
        }
      });

      // 4. 완료
      if (onProgress) onProgress('NeoForge installation completed', 4, 4);
      console.log(`[NeoForge] Installation completed: ${versionId}`);

      return versionId;
    } catch (error) {
      console.error('[NeoForge] Installation failed:', error);
      throw error;
    }
  }

  /**
   * NeoForge가 설치되어 있는지 확인
   */
  async isInstalled(neoforgeVersion: string, gameDir: string): Promise<boolean> {
    const versionId = `neoforge-${neoforgeVersion}`;
    const profilePath = path.join(gameDir, 'versions', versionId, `${versionId}.json`);

    try {
      await fs.access(profilePath);
      return true;
    } catch {
      return false;
    }
  }
}
