import { ModrinthAPI } from './modrinth-api';
import { DownloadManager } from './download-manager';
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
  stage: 'downloading' | 'extracting' | 'installing_mods' | 'applying_overrides' | 'complete';
  progress: number;
  message: string;
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
  ): Promise<void> {
    const tempDir = path.join(instanceDir, '.temp_modpack');
    
    try {
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

      const downloadManager = new DownloadManager();
      const taskId = downloadManager.addTask(
        version.downloadUrl,
        modpackPath,
        undefined,
        'sha1'
      );

      await downloadManager.startAll((progress) => {
        onProgress?.({
          stage: 'downloading',
          progress: progress.progress,
          message: `모드팩 다운로드 중... ${progress.progress}%`,
        });
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

      // 4. 모드 설치
      onProgress?.({
        stage: 'installing_mods',
        progress: 0,
        message: '모드 다운로드 중...',
      });

      const modsDir = path.join(instanceDir, 'mods');
      await fs.mkdir(modsDir, { recursive: true });

      const files = manifest.files || [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const progress = Math.floor(((i + 1) / files.length) * 100);
        
        onProgress?.({
          stage: 'installing_mods',
          progress,
          message: `모드 다운로드 중... (${i + 1}/${files.length})`,
        });

        // 파일 다운로드
        const fileName = path.basename(file.path);
        const filePath = path.join(modsDir, fileName);

        try {
          const response = await axios.get(file.downloads[0], {
            responseType: 'arraybuffer',
          });
          await fs.writeFile(filePath, response.data);
        } catch (error) {
          console.error(`[ModpackManager] Failed to download ${fileName}:`, error);
        }
      }

      // 5. Overrides 적용
      onProgress?.({
        stage: 'applying_overrides',
        progress: 0,
        message: 'Overrides 적용 중...',
      });

      const overridesDir = path.join(tempDir, 'overrides');
      try {
        const overridesStat = await fs.stat(overridesDir);
        if (overridesStat.isDirectory()) {
          await this.copyDirectory(overridesDir, instanceDir);
        }
      } catch (error) {
        console.log('[ModpackManager] No overrides directory found');
      }

      // 6. 완료
      onProgress?.({
        stage: 'complete',
        progress: 100,
        message: '모드팩 설치 완료!',
      });

      console.log('[ModpackManager] Modpack installation complete');
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
