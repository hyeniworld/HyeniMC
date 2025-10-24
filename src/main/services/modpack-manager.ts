import { ModrinthAPI } from './modrinth-api';
import { downloadRpc } from '../grpc/clients';
import axios from 'axios';
import * as path from 'path';
import * as fs from 'fs/promises';
import AdmZip from 'adm-zip';

export interface ModpackSearchResult {
  id: string;
  slug: string;
  name: string;
  description: string;
  author: string;
  iconUrl?: string;
  downloads: number;
  followers: number;
  categories: string[];
  gameVersions: string[];
  source: 'modrinth' | 'curseforge';
  updatedAt: Date;
}

export interface ModpackVersion {
  id: string;
  name: string;
  versionNumber: string;
  gameVersion: string;
  loaders: string[];
  downloadUrl: string;
  fileName: string;
  fileSize: number;
  publishedAt: Date;
}

export interface ModpackInstallProgress {
  stage: 'validating' | 'downloading' | 'extracting' | 'installing_loader' | 'installing_mods' | 'applying_overrides' | 'complete';
  progress: number;
  message: string;
}

export interface ModpackFileInfo {
  valid: boolean;
  format: ModpackFormat;
  fileSize: number;
  errors?: string[];
}

export type ModpackFormat = 'modrinth' | 'curseforge' | 'multimc' | 'prism' | 'atlauncher' | 'hyenipack' | 'unknown';

export interface ModpackMetadata {
  name: string;
  version?: string;
  author?: string;
  gameVersion: string;
  loaderType: 'vanilla' | 'fabric' | 'forge' | 'neoforge' | 'quilt';
  loaderVersion?: string;
  modCount?: number;
  fileSize: number;
}

export class ModpackManager {
  private modrinthAPI: ModrinthAPI;

  constructor() {
    this.modrinthAPI = new ModrinthAPI();
  }

  /**
   * 모드팩 검색
   */
  async searchModpacks(query: string, gameVersion?: string): Promise<ModpackSearchResult[]> {
    try {
      console.log(`[ModpackManager] Searching modpacks: "${query}"`);
      
      // Modrinth에서 모드팩 검색
      const response = await axios.get('https://api.modrinth.com/v2/search', {
        params: {
          query,
          facets: JSON.stringify([
            ['project_type:modpack'],
            gameVersion ? [`versions:${gameVersion}`] : [],
          ].filter(f => f.length > 0)),
          limit: 20,
        },
      });

      const results: ModpackSearchResult[] = response.data.hits.map((hit: any) => ({
        id: hit.project_id,
        slug: hit.slug,
        name: hit.title,
        description: hit.description,
        author: hit.author,
        iconUrl: hit.icon_url,
        downloads: hit.downloads,
        followers: hit.follows,
        categories: hit.categories || [],
        gameVersions: hit.versions || [],
        source: 'modrinth' as const,
        updatedAt: new Date(hit.date_modified),
      }));

      console.log(`[ModpackManager] Found ${results.length} modpacks`);
      return results;
    } catch (error) {
      console.error('[ModpackManager] Failed to search modpacks:', error);
      throw new Error('Failed to search modpacks');
    }
  }

  /**
   * 모드팩 버전 목록 가져오기
   */
  async getModpackVersions(modpackId: string, gameVersion?: string): Promise<ModpackVersion[]> {
    try {
      console.log(`[ModpackManager] Fetching versions for modpack: ${modpackId}`);
      
      const params: any = {};
      if (gameVersion) {
        params.game_versions = JSON.stringify([gameVersion]);
      }

      const response = await axios.get(
        `https://api.modrinth.com/v2/project/${modpackId}/version`,
        { params }
      );

      const versions: ModpackVersion[] = response.data.map((ver: any) => {
        const file = ver.files.find((f: any) => f.primary) || ver.files[0];
        
        return {
          id: ver.id,
          name: ver.name,
          versionNumber: ver.version_number,
          gameVersion: ver.game_versions?.[0] || 'unknown',
          loaders: ver.loaders || [],
          downloadUrl: file?.url,
          fileName: file?.filename,
          fileSize: file?.size || 0,
          publishedAt: new Date(ver.date_published),
        };
      });

      console.log(`[ModpackManager] Found ${versions.length} versions`);
      return versions;
    } catch (error) {
      console.error('[ModpackManager] Failed to fetch versions:', error);
      throw new Error('Failed to fetch modpack versions');
    }
  }

  /**
   * 모드팩 설치
   */
  async installModpack(
    versionId: string,
    profileId: string,
    instanceDir: string,
    onProgress?: (progress: ModpackInstallProgress) => void
  ): Promise<{ gameVersion?: string; loaderType?: 'vanilla' | 'fabric' | 'forge' | 'neoforge' | 'quilt'; loaderVersion?: string }> {
    const tempDir = path.join(instanceDir, '.temp_modpack');
    
    try {
      // Ensure instance directory exists (pre-create)
      await fs.mkdir(instanceDir, { recursive: true });

      // 1. 모드팩 파일 다운로드
      onProgress?.({
        stage: 'downloading',
        progress: 0,
        message: '모드팩 다운로드 중...',
      });

      const version = await this.getVersionById(versionId);
      if (!version || !version.downloadUrl) {
        throw new Error('Modpack version not found');
      }

      await fs.mkdir(tempDir, { recursive: true });
      const modpackPath = path.join(tempDir, version.fileName);

      const reqModpack: any = {
        taskId: `modpack-${versionId}`,
        url: version.downloadUrl,
        destPath: modpackPath,
        profileId,
        type: 'modpack',
        name: version.name,
        maxRetries: 3,
        concurrency: 1,
      };
      const started = await downloadRpc.startDownload(reqModpack);
      await new Promise<void>((resolve, reject) => {
        const cancel = downloadRpc.streamProgress(
          { profileId } as any,
          (ev) => {
            if (ev.taskId !== started.taskId) return;
            if (ev.status === 'downloading') {
              onProgress?.({
                stage: 'downloading',
                progress: ev.progress,
                message: `모드팩 다운로드 중... ${ev.progress}%`,
              });
            } else if (ev.status === 'completed') {
              cancel();
              resolve();
            } else if (ev.status === 'failed' || ev.status === 'cancelled') {
              cancel();
              reject(new Error(ev.error || '다운로드 실패'));
            }
          },
          // swallow CANCELLED on client when we call cancel()
          (err) => {
            if (err && ('' + err).includes('CANCELLED')) return;
            if (err) reject(err);
          }
        );
      });

      // 2. 모드팩 압축 해제
      onProgress?.({
        stage: 'extracting',
        progress: 0,
        message: '모드팩 압축 해제 중...',
      });

      const zip = new AdmZip(modpackPath);
      zip.extractAllTo(tempDir, true);

      // 3. modrinth.index.json 파일 읽기
      const indexPath = path.join(tempDir, 'modrinth.index.json');
      const indexContent = await fs.readFile(indexPath, 'utf-8');
      const manifest = JSON.parse(indexContent);

      console.log(`[ModpackManager] Installing modpack: ${manifest.name}`);
      console.log(`[ModpackManager] Game version: ${manifest.dependencies?.minecraft}`);
      console.log(`[ModpackManager] Mods to install: ${manifest.files?.length || 0}`);

      // 4. 모드 및 리소스 설치
      onProgress?.({
        stage: 'installing_mods',
        progress: 0,
        message: '모드 다운로드 중...',
      });

      const files = manifest.files || [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const progress = Math.floor(((i + 1) / files.length) * 100);
        
        onProgress?.({
          stage: 'installing_mods',
          progress,
          message: `모드 다운로드 중... (${i + 1}/${files.length})`,
        });

        // 파일 다운로드 대상 경로: manifest의 경로 구조를 유지
        // Modrinth spec: file.path는 인스턴스 루트 기준 상대 경로일 수 있음
        const relativePath = normalizeRelativePath(file.path);
        const destPath = path.join(instanceDir, relativePath);
        await fs.mkdir(path.dirname(destPath), { recursive: true });

        try {
          const url = file.downloads?.[0];
          if (!url) throw new Error('download url missing');
          const checksum = (file.hashes && (file.hashes.sha1 || file.hashes.sha256))
            ? { algo: file.hashes.sha1 ? 'sha1' : 'sha256', value: (file.hashes.sha1 || file.hashes.sha256) }
            : undefined;
          const reqFile: any = {
            taskId: `file-${i}-${Date.now()}`,
            url,
            destPath: destPath,
            profileId,
            type: 'mod',
            name: path.basename(destPath),
            maxRetries: 3,
            concurrency: 1,
          };
          if (checksum) reqFile.checksum = checksum;
          const started = await downloadRpc.startDownload(reqFile);
          await new Promise<void>((resolve, reject) => {
            const cancel = downloadRpc.streamProgress(
              { profileId } as any,
              (ev) => {
                if (ev.taskId !== started.taskId) return;
                if (ev.status === 'downloading') {
                  // per-file progress mapped to overall progress already computed
                } else if (ev.status === 'completed') {
                  cancel();
                  resolve();
                } else if (ev.status === 'failed' || ev.status === 'cancelled') {
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
        } catch (error) {
          console.error(`[ModpackManager] Failed to download ${relativePath}:`, error);
        }
      }

      // 5. Overrides 적용
      onProgress?.({
        stage: 'applying_overrides',
        progress: 0,
        message: 'Overrides 적용 중...',
      });

      // Support both 'overrides' and 'client-overrides' per Modrinth spec
      const overrideCandidates = ['overrides', 'client-overrides'];
      let appliedOverride = false;
      for (const name of overrideCandidates) {
        const dir = path.join(tempDir, name);
        try {
          const stat = await fs.stat(dir);
          if (stat.isDirectory()) {
            await this.copyDirectory(dir, instanceDir);
            appliedOverride = true;
          }
        } catch {}
      }
      if (!appliedOverride) {
        console.log('[ModpackManager] No overrides directory found');
      }

      // 6. 완료
      onProgress?.({
        stage: 'complete',
        progress: 100,
        message: '모드팩 설치 완료!',
      });

      console.log('[ModpackManager] Modpack installation complete');
      // Extract loader info to return
      const deps = manifest?.dependencies || {};
      let loaderType: 'vanilla' | 'fabric' | 'forge' | 'neoforge' | 'quilt' | undefined = 'vanilla';
      let loaderVersion: string | undefined;
      if (deps['fabric-loader']) { loaderType = 'fabric'; loaderVersion = deps['fabric-loader']; }
      else if (deps['quilt-loader']) { loaderType = 'quilt'; loaderVersion = deps['quilt-loader']; }
      else if (deps['forge']) { loaderType = 'forge'; loaderVersion = deps['forge']; }
      else if (deps['neoforge']) { loaderType = 'neoforge'; loaderVersion = deps['neoforge']; }

      const gameVersion = deps?.minecraft || undefined;
      return { gameVersion, loaderType, loaderVersion };
    } catch (error) {
      console.error('[ModpackManager] Failed to install modpack:', error);
      throw error;
    } finally {
      // Cleanup temp directory
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch (error) {
        console.error('[ModpackManager] Failed to cleanup temp directory:', error);
      }
    }
  }

  /**
   * 버전 ID로 버전 정보 가져오기
   */
  private async getVersionById(versionId: string): Promise<ModpackVersion | null> {
    try {
      const response = await axios.get(`https://api.modrinth.com/v2/version/${versionId}`);
      const ver = response.data;
      const file = ver.files.find((f: any) => f.primary) || ver.files[0];
      
      return {
        id: ver.id,
        name: ver.name,
        versionNumber: ver.version_number,
        gameVersion: ver.game_versions?.[0] || 'unknown',
        loaders: ver.loaders || [],
        downloadUrl: file?.url,
        fileName: file?.filename,
        fileSize: file?.size || 0,
        publishedAt: new Date(ver.date_published),
      };
    } catch (error) {
      console.error('[ModpackManager] Failed to fetch version:', error);
      return null;
    }
  }

  /**
   * 모드팩 파일 검증
   */
  async validateModpackFile(filePath: string): Promise<ModpackFileInfo> {
    try {
      // 1. 파일 존재 및 크기 확인
      const stats = await fs.stat(filePath);
      if (stats.size === 0) {
        return {
          valid: false,
          format: 'unknown',
          fileSize: 0,
          errors: ['파일이 비어있습니다'],
        };
      }

      // 2. ZIP 파일 여부 확인
      let zip: AdmZip;
      try {
        zip = new AdmZip(filePath);
      } catch (error) {
        return {
          valid: false,
          format: 'unknown',
          fileSize: stats.size,
          errors: ['유효한 ZIP 파일이 아닙니다'],
        };
      }

      // 3. 모드팩 형식 감지
      const format = await this.detectModpackFormat(filePath);
      
      if (format === 'unknown') {
        return {
          valid: false,
          format: 'unknown',
          fileSize: stats.size,
          errors: ['지원하지 않는 모드팩 형식입니다'],
        };
      }

      return {
        valid: true,
        format,
        fileSize: stats.size,
      };
    } catch (error) {
      console.error('[ModpackManager] Failed to validate file:', error);
      return {
        valid: false,
        format: 'unknown',
        fileSize: 0,
        errors: [error instanceof Error ? error.message : '알 수 없는 오류'],
      };
    }
  }

  /**
   * 모드팩 형식 감지
   */
  async detectModpackFormat(filePath: string): Promise<ModpackFormat> {
    try {
      const zip = new AdmZip(filePath);
      const entries = zip.getEntries();
      const fileNames = entries.map((e) => e.entryName);

      // HyeniPack 형식 (.hyenipack)
      if (filePath.endsWith('.hyenipack') || fileNames.includes('hyenipack.json')) {
        return 'hyenipack';
      }

      // Modrinth 형식 (.mrpack)
      if (filePath.endsWith('.mrpack') || fileNames.includes('modrinth.index.json')) {
        return 'modrinth';
      }

      // CurseForge 형식
      if (fileNames.includes('manifest.json')) {
        const manifestEntry = zip.getEntry('manifest.json');
        if (manifestEntry) {
          const manifest = JSON.parse(manifestEntry.getData().toString('utf-8'));
          if (manifest.manifestType === 'minecraftModpack') {
            return 'curseforge';
          }
        }
      }

      // MultiMC/Prism 형식
      if (fileNames.includes('instance.cfg') || fileNames.includes('mmc-pack.json')) {
        return fileNames.includes('mmc-pack.json') ? 'prism' : 'multimc';
      }

      // ATLauncher 형식
      if (fileNames.includes('instance.json')) {
        const instanceEntry = zip.getEntry('instance.json');
        if (instanceEntry) {
          const instance = JSON.parse(instanceEntry.getData().toString('utf-8'));
          if (instance.launcher?.name === 'ATLauncher') {
            return 'atlauncher';
          }
        }
      }

      return 'unknown';
    } catch (error) {
      console.error('[ModpackManager] Failed to detect format:', error);
      return 'unknown';
    }
  }

  /**
   * 모드팩 메타데이터 추출
   */
  async extractModpackMetadata(filePath: string): Promise<ModpackMetadata> {
    const format = await this.detectModpackFormat(filePath);
    const stats = await fs.stat(filePath);
    const zip = new AdmZip(filePath);

    try {
      switch (format) {
        case 'hyenipack':
          return await this.extractHyeniPackMetadata(zip, stats.size);
        case 'modrinth':
          return await this.extractModrinthMetadata(zip, stats.size);
        case 'curseforge':
          return await this.extractCurseForgeMetadata(zip, stats.size);
        case 'multimc':
        case 'prism':
          return await this.extractMultiMCMetadata(zip, stats.size, format);
        case 'atlauncher':
          return await this.extractATLauncherMetadata(zip, stats.size);
        default:
          throw new Error('지원하지 않는 형식입니다');
      }
    } catch (error) {
      console.error('[ModpackManager] Failed to extract metadata:', error);
      throw error;
    }
  }

  /**
   * HyeniPack 메타데이터 추출
   */
  private async extractHyeniPackMetadata(zip: AdmZip, fileSize: number): Promise<ModpackMetadata> {
    const manifestEntry = zip.getEntry('hyenipack.json');
    if (!manifestEntry) {
      throw new Error('hyenipack.json을 찾을 수 없습니다');
    }

    const manifest = JSON.parse(manifestEntry.getData().toString('utf-8'));

    return {
      name: manifest.name || 'Unknown Modpack',
      version: manifest.version,
      author: manifest.author,
      gameVersion: manifest.minecraft?.version || 'unknown',
      loaderType: manifest.minecraft?.loaderType || 'vanilla',
      loaderVersion: manifest.minecraft?.loaderVersion,
      modCount: manifest.mods?.length || 0,
      fileSize,
    };
  }

  /**
   * Modrinth 메타데이터 추출
   */
  private async extractModrinthMetadata(zip: AdmZip, fileSize: number): Promise<ModpackMetadata> {
    const indexEntry = zip.getEntry('modrinth.index.json');
    if (!indexEntry) {
      throw new Error('modrinth.index.json을 찾을 수 없습니다');
    }

    const manifest = JSON.parse(indexEntry.getData().toString('utf-8'));
    const dependencies = manifest.dependencies || {};

    // 로더 타입 추출
    let loaderType: ModpackMetadata['loaderType'] = 'vanilla';
    let loaderVersion: string | undefined;

    if (dependencies['fabric-loader']) {
      loaderType = 'fabric';
      loaderVersion = dependencies['fabric-loader'];
    } else if (dependencies['quilt-loader']) {
      loaderType = 'quilt';
      loaderVersion = dependencies['quilt-loader'];
    } else if (dependencies['forge']) {
      loaderType = 'forge';
      loaderVersion = dependencies['forge'];
    } else if (dependencies['neoforge']) {
      loaderType = 'neoforge';
      loaderVersion = dependencies['neoforge'];
    }

    return {
      name: manifest.name || 'Unknown Modpack',
      version: manifest.versionId,
      author: manifest.summary || undefined,
      gameVersion: dependencies.minecraft || 'unknown',
      loaderType,
      loaderVersion,
      modCount: manifest.files?.length || 0,
      fileSize,
    };
  }

  /**
   * CurseForge 메타데이터 추출
   */
  private async extractCurseForgeMetadata(zip: AdmZip, fileSize: number): Promise<ModpackMetadata> {
    const manifestEntry = zip.getEntry('manifest.json');
    if (!manifestEntry) {
      throw new Error('manifest.json을 찾을 수 없습니다');
    }

    const manifest = JSON.parse(manifestEntry.getData().toString('utf-8'));
    const minecraft = manifest.minecraft || {};
    const modLoaders = minecraft.modLoaders || [];
    const primaryLoader = modLoaders.find((l: any) => l.primary) || modLoaders[0];

    // 로더 정보 파싱
    let loaderType: ModpackMetadata['loaderType'] = 'vanilla';
    let loaderVersion: string | undefined;

    if (primaryLoader?.id) {
      const loaderInfo = primaryLoader.id.split('-');
      if (loaderInfo[0] === 'forge') {
        loaderType = 'forge';
        loaderVersion = loaderInfo[1];
      } else if (loaderInfo[0] === 'neoforge') {
        loaderType = 'neoforge';
        loaderVersion = loaderInfo[1];
      } else if (loaderInfo[0] === 'fabric') {
        loaderType = 'fabric';
        loaderVersion = loaderInfo[1];
      }
    }

    return {
      name: manifest.name || 'Unknown Modpack',
      version: manifest.version,
      author: manifest.author,
      gameVersion: minecraft.version || 'unknown',
      loaderType,
      loaderVersion,
      modCount: manifest.files?.length || 0,
      fileSize,
    };
  }

  /**
   * MultiMC/Prism 메타데이터 추출
   */
  private async extractMultiMCMetadata(
    zip: AdmZip,
    fileSize: number,
    format: 'multimc' | 'prism'
  ): Promise<ModpackMetadata> {
    let gameVersion = 'unknown';
    let loaderType: ModpackMetadata['loaderType'] = 'vanilla';
    let loaderVersion: string | undefined;
    let name = 'Unknown Instance';

    // mmc-pack.json 확인 (Prism)
    if (format === 'prism') {
      const packEntry = zip.getEntry('mmc-pack.json');
      if (packEntry) {
        const pack = JSON.parse(packEntry.getData().toString('utf-8'));
        const components = pack.components || [];

        for (const component of components) {
          if (component.uid === 'net.minecraft') {
            gameVersion = component.version;
          } else if (component.uid === 'net.fabricmc.fabric-loader') {
            loaderType = 'fabric';
            loaderVersion = component.version;
          } else if (component.uid.includes('forge')) {
            loaderType = 'forge';
            loaderVersion = component.version;
          }
        }
      }
    }

    // instance.cfg 확인
    const cfgEntry = zip.getEntry('instance.cfg');
    if (cfgEntry) {
      const cfg = cfgEntry.getData().toString('utf-8');
      const lines = cfg.split('\n');
      for (const line of lines) {
        if (line.startsWith('IntendedVersion=')) {
          gameVersion = line.split('=')[1].trim();
        } else if (line.startsWith('name=')) {
          name = line.split('=')[1].trim();
        }
      }
    }

    // 모드 개수 추정
    const entries = zip.getEntries();
    const modFiles = entries.filter((e) => e.entryName.includes('minecraft/mods/') && e.entryName.endsWith('.jar'));

    return {
      name,
      gameVersion,
      loaderType,
      loaderVersion,
      modCount: modFiles.length,
      fileSize,
    };
  }

  /**
   * ATLauncher 메타데이터 추출
   */
  private async extractATLauncherMetadata(zip: AdmZip, fileSize: number): Promise<ModpackMetadata> {
    const instanceEntry = zip.getEntry('instance.json');
    if (!instanceEntry) {
      throw new Error('instance.json을 찾을 수 없습니다');
    }

    const instance = JSON.parse(instanceEntry.getData().toString('utf-8'));

    // 로더 정보는 instance.json에서 추출하기 어려울 수 있음
    let loaderType: ModpackMetadata['loaderType'] = 'vanilla';
    if (instance.loaderVersion) {
      loaderType = 'forge'; // ATLauncher는 주로 Forge 사용
    }

    return {
      name: instance.name || 'Unknown Pack',
      gameVersion: instance.minecraft || 'unknown',
      loaderType,
      loaderVersion: instance.loaderVersion,
      modCount: instance.mods?.length || 0,
      fileSize,
    };
  }

  /**
   * 로컬 파일에서 모드팩 설치
   */
  async importModpackFromFile(
    filePath: string,
    profileName: string,
    instanceDir: string,
    onProgress?: (progress: ModpackInstallProgress) => void
  ): Promise<{
    minecraftVersion?: string;
    loaderType?: string;
    loaderVersion?: string;
  }> {
    const tempDir = path.join(instanceDir, '.temp_modpack_import');

    try {
      // 1. 파일 검증
      onProgress?.({
        stage: 'validating',
        progress: 0,
        message: '모드팩 파일 검증 중...',
      });

      const fileInfo = await this.validateModpackFile(filePath);
      if (!fileInfo.valid) {
        throw new Error(fileInfo.errors?.join(', ') || '유효하지 않은 파일입니다');
      }

      console.log(`[ModpackManager] Importing ${fileInfo.format} modpack from file`);

      // 2. 메타데이터 추출
      const metadata = await this.extractModpackMetadata(filePath);
      console.log(`[ModpackManager] Modpack: ${metadata.name} (${metadata.gameVersion})`);

      // 3. 압축 해제
      onProgress?.({
        stage: 'extracting',
        progress: 10,
        message: '모드팩 압축 해제 중...',
      });

      await fs.mkdir(tempDir, { recursive: true });
      const zip = new AdmZip(filePath);
      zip.extractAllTo(tempDir, true);

      // 4. 형식별 처리
      let loaderInfo: { minecraftVersion?: string; loaderType?: string; loaderVersion?: string } = {};
      
      switch (fileInfo.format) {
        case 'hyenipack':
          // HyeniPack importer 사용
          const { hyeniPackImporter } = await import('./hyenipack-importer');
          const result = await hyeniPackImporter.importHyeniPack(filePath, '', instanceDir, onProgress ? (progress) => {
            // HyeniPackImportProgress를 ModpackInstallProgress로 변환
            let mappedStage: ModpackInstallProgress['stage'];
            switch (progress.stage) {
              case 'extracting':
                mappedStage = 'extracting';
                break;
              case 'installing_mods':
                mappedStage = 'installing_mods';
                break;
              case 'applying_overrides':
                mappedStage = 'applying_overrides';
                break;
              case 'complete':
                mappedStage = 'complete';
                break;
              default:
                mappedStage = 'extracting';
            }
            
            onProgress({
              stage: mappedStage,
              progress: progress.progress,
              message: progress.message,
            });
          } : undefined);
          
          // 로더 정보 저장
          loaderInfo = {
            minecraftVersion: result.minecraftVersion,
            loaderType: result.loaderType,
            loaderVersion: result.loaderVersion,
          };
          break;
          /* // 이전 코드 (삭제됨)
          await hyeniPackManager.installHyeniPack(filePath, profileName, instanceDir, onProgress ? (progress) => {
            // HyeniPackInstallProgress를 ModpackInstallProgress로 변환
            let mappedStage: ModpackInstallProgress['stage'];
            switch (progress.stage) {
              case 'validating':
                mappedStage = 'validating';
                break;
              case 'downloading_mods':
                mappedStage = 'installing_mods';
                break;
              case 'installing_loader':
                mappedStage = 'installing_loader';
                break;
              case 'applying_overrides':
                mappedStage = 'applying_overrides';
                break;
              case 'generating_metadata':
                mappedStage = 'applying_overrides';
                break;
              case 'complete':
                mappedStage = 'complete';
                break;
              default:
                mappedStage = 'extracting';
            }
            
            onProgress({
              stage: mappedStage,
              progress: progress.progress,
              message: progress.message,
            });
          } : undefined); */
          break;
        case 'modrinth':
          await this.installModrinthPack(tempDir, instanceDir, onProgress);
          break;
        case 'curseforge':
          await this.installCurseForgePack(tempDir, instanceDir, onProgress);
          break;
        case 'multimc':
        case 'prism':
          await this.installMultiMCPack(tempDir, instanceDir, onProgress);
          break;
        case 'atlauncher':
          await this.installATLauncherPack(tempDir, instanceDir, onProgress);
          break;
        default:
          throw new Error('지원하지 않는 형식입니다');
      }

      onProgress?.({
        stage: 'complete',
        progress: 100,
        message: '모드팩 설치 완료!',
      });

      console.log('[ModpackManager] Modpack import complete');
      return loaderInfo;
    } finally {
      // 임시 디렉토리 정리
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch (error) {
        console.error('[ModpackManager] Failed to clean up temp directory:', error);
      }
    }
  }

  /**
   * Modrinth 모드팩 설치
   */
  private async installModrinthPack(
    tempDir: string,
    instanceDir: string,
    onProgress?: (progress: ModpackInstallProgress) => void
  ): Promise<void> {
    // modrinth.index.json 읽기
    const indexPath = path.join(tempDir, 'modrinth.index.json');
    const manifest = JSON.parse(await fs.readFile(indexPath, 'utf-8'));

    // 인스턴스 디렉터리 선생성
    await fs.mkdir(instanceDir, { recursive: true });

    // 모드/리소스 다운로드
    onProgress?.({
      stage: 'installing_mods',
      progress: 30,
      message: '모드 다운로드 중...',
    });

    const files = manifest.files || [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const progress = 30 + Math.floor(((i + 1) / files.length) * 50);

      onProgress?.({
        stage: 'installing_mods',
        progress,
        message: `모드 다운로드 중... (${i + 1}/${files.length})`,
      });

      const relativePath = normalizeRelativePath(file.path);
      const filePath = path.join(instanceDir, relativePath);
      await fs.mkdir(path.dirname(filePath), { recursive: true });

      try {
        const response = await axios.get(file.downloads?.[0], {
          responseType: 'arraybuffer',
        });
        await fs.writeFile(filePath, response.data);
      } catch (error) {
        console.error(`[ModpackManager] Failed to download ${relativePath}:`, error);
      }
    }

    // Overrides 적용
    onProgress?.({
      stage: 'applying_overrides',
      progress: 85,
      message: 'Overrides 적용 중...',
    });

    // overrides / client-overrides 지원
    const overrideCandidates = ['overrides', 'client-overrides'];
    let appliedOverride = false;
    for (const name of overrideCandidates) {
      const dir = path.join(tempDir, name);
      try {
        const stat = await fs.stat(dir);
        if (stat.isDirectory()) {
          await this.copyDirectory(dir, instanceDir);
          appliedOverride = true;
        }
      } catch {}
    }
    if (!appliedOverride) {
      console.log('[ModpackManager] No overrides directory found');
    }
  }

  /**
   * CurseForge 모드팩 설치 (간단한 버전 - API 키 필요 없이 overrides만 복사)
   */
  private async installCurseForgePack(
    tempDir: string,
    instanceDir: string,
    onProgress?: (progress: ModpackInstallProgress) => void
  ): Promise<void> {
    // manifest.json 읽기
    const manifestPath = path.join(tempDir, 'manifest.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));

    console.log(`[ModpackManager] CurseForge modpack has ${manifest.files?.length || 0} mods`);
    console.log('[ModpackManager] Note: CurseForge mods require API key - only overrides will be copied');

    // Overrides 적용
    onProgress?.({
      stage: 'applying_overrides',
      progress: 50,
      message: 'Overrides 적용 중...',
    });

    const overridesDir = path.join(tempDir, manifest.overrides || 'overrides');
    try {
      const overridesStat = await fs.stat(overridesDir);
      if (overridesStat.isDirectory()) {
        await this.copyDirectory(overridesDir, instanceDir);
      }
    } catch (error) {
      console.log('[ModpackManager] No overrides directory found');
    }

    // TODO: CurseForge API를 사용한 모드 다운로드는 추후 구현
    console.log('[ModpackManager] CurseForge mod downloads not implemented yet');
  }

  /**
   * MultiMC/Prism 모드팩 설치
   */
  private async installMultiMCPack(
    tempDir: string,
    instanceDir: string,
    onProgress?: (progress: ModpackInstallProgress) => void
  ): Promise<void> {
    onProgress?.({
      stage: 'applying_overrides',
      progress: 50,
      message: '인스턴스 파일 복사 중...',
    });

    // minecraft 폴더 복사
    const minecraftDir = path.join(tempDir, 'minecraft');
    try {
      const minecraftStat = await fs.stat(minecraftDir);
      if (minecraftStat.isDirectory()) {
        await this.copyDirectory(minecraftDir, instanceDir);
      }
    } catch (error) {
      console.log('[ModpackManager] No minecraft directory found');
    }
  }

  /**
   * ATLauncher 모드팩 설치
   */
  private async installATLauncherPack(
    tempDir: string,
    instanceDir: string,
    onProgress?: (progress: ModpackInstallProgress) => void
  ): Promise<void> {
    onProgress?.({
      stage: 'applying_overrides',
      progress: 50,
      message: '인스턴스 파일 복사 중...',
    });

    // 모든 파일 복사 (instance.json 제외)
    const entries = await fs.readdir(tempDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'instance.json') continue;

      const srcPath = path.join(tempDir, entry.name);
      const destPath = path.join(instanceDir, entry.name);

      if (entry.isDirectory()) {
        await this.copyDirectory(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }

  /**
   * 디렉토리 복사 (재귀적)
   */
  private async copyDirectory(src: string, dest: string): Promise<void> {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        await this.copyDirectory(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }
}

/**
 * Normalize relative paths from manifests to prevent leading separators
 * and strip optional leading 'minecraft/' used by some pack formats.
 */
function normalizeRelativePath(p: string): string {
  let rp = p.replace(/^[\\/]+/, '');
  if (rp.startsWith('minecraft/')) rp = rp.substring('minecraft/'.length);
  if (rp.startsWith('minecraft\\')) rp = rp.substring('minecraft\\'.length);
  return rp;
}
