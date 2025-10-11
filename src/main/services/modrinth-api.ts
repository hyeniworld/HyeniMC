import axios, { AxiosInstance } from 'axios';
import { API_ENDPOINTS, API_HEADERS } from '../../shared/constants';
import { 
  ModSearchResult, 
  ModDetails, 
  ModVersion, 
  ModSearchFilters,
  LoaderType 
} from '../../shared/types/profile';

/**
 * Modrinth API 클라이언트
 * https://docs.modrinth.com/api-spec
 */
export class ModrinthAPI {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: API_ENDPOINTS.MODRINTH_BASE,
      headers: API_HEADERS.MODRINTH,
      timeout: 30000,
    });
  }

  /**
   * 단일 버전 상세 조회 (의존성 포함)
   */
  async getVersion(versionId: string): Promise<ModVersion | null> {
    try {
      console.log(`[Modrinth] Fetching version ${versionId}`);

      const response = await this.client.get(`/version/${versionId}`);
      const ver = response.data;

      if (!ver) return null;

      const version: ModVersion = {
        id: ver.id,
        versionNumber: ver.version_number,
        name: ver.name,
        changelog: ver.changelog,
        gameVersions: ver.game_versions || [],
        loaders: ver.loaders || [],
        downloadUrl: ver.files?.[0]?.url,
        fileName: ver.files?.[0]?.filename,
        fileSize: ver.files?.[0]?.size,
        sha1: ver.files?.[0]?.hashes?.sha1,
        sha512: ver.files?.[0]?.hashes?.sha512,
        dependencies: ver.dependencies?.map((dep: any) => ({
          modId: dep.project_id,
          type: dep.dependency_type,
          versionRange: dep.version_id,
        })) || [],
        publishedAt: new Date(ver.date_published),
      };

      return version;
    } catch (error) {
      console.error('[Modrinth] Failed to fetch version:', error);
      return null;
    }
  }

  /**
   * 모드 검색
   */
  async searchMods(
    query: string,
    filters?: ModSearchFilters
  ): Promise<{ hits: ModSearchResult[]; total: number }> {
    try {
      console.log(`[Modrinth] Searching mods: "${query}"`);
      
      const params: any = {
        query,
        limit: filters?.limit || 20,
        offset: filters?.offset || 0,
        facets: [],
      };

      // Facets 구성
      const facets: string[][] = [];
      
      if (filters?.gameVersion) {
        facets.push([`versions:${filters.gameVersion}`]);
      }
      
      if (filters?.loaderType && filters.loaderType !== 'vanilla') {
        const loaderName = filters.loaderType === 'neoforge' ? 'neoforge' : filters.loaderType;
        facets.push([`categories:${loaderName}`]);
      }
      
      if (filters?.categories && filters.categories.length > 0) {
        facets.push(filters.categories.map(cat => `categories:${cat}`));
      }

      // Project type: mod only
      facets.push(['project_type:mod']);

      if (facets.length > 0) {
        params.facets = JSON.stringify(facets);
      }

      const response = await this.client.get('/search', { params });

      const hits: ModSearchResult[] = response.data.hits.map((hit: any) => ({
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
        loaders: hit.categories?.filter((c: string) => 
          ['fabric', 'forge', 'neoforge'].includes(c)
        ) as LoaderType[] || [],
        source: 'modrinth',
        updatedAt: new Date(hit.date_modified),
      }));

      console.log(`[Modrinth] Found ${hits.length} mods (total: ${response.data.total_hits})`);
      
      return {
        hits,
        total: response.data.total_hits,
      };
    } catch (error) {
      console.error('[Modrinth] Search failed:', error);
      throw new Error('Failed to search mods from Modrinth');
    }
  }

  /**
   * 모드 상세 정보 가져오기
   */
  async getModDetails(projectId: string): Promise<ModDetails> {
    try {
      console.log(`[Modrinth] Fetching mod details: ${projectId}`);
      
      const response = await this.client.get(`/project/${projectId}`);
      const project = response.data;

      const details: ModDetails = {
        id: project.id,
        slug: project.slug,
        name: project.title,
        description: project.description,
        author: project.team,
        iconUrl: project.icon_url,
        downloads: project.downloads,
        followers: project.followers,
        categories: project.categories || [],
        gameVersions: project.game_versions || [],
        loaders: project.loaders || [],
        source: 'modrinth',
        updatedAt: new Date(project.updated),
        body: project.body || '',
        gallery: project.gallery?.map((img: any) => ({
          url: img.url,
          title: img.title,
          description: img.description,
        })),
        websiteUrl: project.issues_url,
        sourceUrl: project.source_url,
        issuesUrl: project.issues_url,
        license: project.license?.name,
        versions: [],
      };

      console.log(`[Modrinth] Fetched details for: ${details.name}`);
      return details;
    } catch (error) {
      console.error('[Modrinth] Failed to fetch mod details:', error);
      throw new Error(`Failed to fetch mod details: ${projectId}`);
    }
  }

  /**
   * 모드 버전 목록 가져오기
   */
  async getModVersions(
    projectId: string,
    gameVersion?: string,
    loaderType?: LoaderType
  ): Promise<ModVersion[]> {
    try {
      console.log(`[Modrinth] Fetching versions for ${projectId}`);
      
      const params: any = {
        loaders: loaderType && loaderType !== 'vanilla' 
          ? JSON.stringify([loaderType === 'neoforge' ? 'neoforge' : loaderType])
          : undefined,
        game_versions: gameVersion ? JSON.stringify([gameVersion]) : undefined,
      };

      const response = await this.client.get(`/project/${projectId}/version`, { params });

      const versions: ModVersion[] = response.data.map((ver: any) => ({
        id: ver.id,
        versionNumber: ver.version_number,
        name: ver.name,
        changelog: ver.changelog,
        gameVersions: ver.game_versions || [],
        loaders: ver.loaders || [],
        downloadUrl: ver.files[0]?.url,
        fileName: ver.files[0]?.filename,
        fileSize: ver.files[0]?.size,
        sha1: ver.files[0]?.hashes?.sha1,
        sha512: ver.files[0]?.hashes?.sha512,
        dependencies: ver.dependencies?.map((dep: any) => ({
          modId: dep.project_id,
          type: dep.dependency_type,
          versionRange: dep.version_id,
        })) || [],
        publishedAt: new Date(ver.date_published),
      }));

      console.log(`[Modrinth] Found ${versions.length} versions`);
      return versions;
    } catch (error) {
      console.error('[Modrinth] Failed to fetch versions:', error);
      throw new Error(`Failed to fetch mod versions: ${projectId}`);
    }
  }

  /**
   * 여러 프로젝트 정보 한번에 가져오기
   */
  async getMultipleProjects(projectIds: string[]): Promise<ModDetails[]> {
    try {
      console.log(`[Modrinth] Fetching ${projectIds.length} projects`);
      
      const response = await this.client.get('/projects', {
        params: {
          ids: JSON.stringify(projectIds),
        },
      });

      return response.data.map((project: any) => ({
        id: project.id,
        slug: project.slug,
        name: project.title,
        description: project.description,
        author: project.team,
        iconUrl: project.icon_url,
        downloads: project.downloads,
        followers: project.followers,
        categories: project.categories || [],
        gameVersions: project.game_versions || [],
        loaders: project.loaders || [],
        source: 'modrinth' as const,
        updatedAt: new Date(project.updated),
        body: project.body || '',
        versions: [],
      }));
    } catch (error) {
      console.error('[Modrinth] Failed to fetch multiple projects:', error);
      throw error;
    }
  }

  /**
   * 카테고리 목록 가져오기
   */
  async getCategories(): Promise<Array<{ name: string; id: string; icon: string }>> {
    try {
      console.log('[Modrinth] Fetching categories...');
      
      const response = await this.client.get('/tag/category');
      
      return response.data
        .filter((cat: any) => cat.project_type === 'mod')
        .map((cat: any) => ({
          name: cat.name,
          id: cat.name.toLowerCase().replace(/\s+/g, '-'),
          icon: cat.icon,
        }));
    } catch (error) {
      console.error('[Modrinth] Failed to fetch categories:', error);
      return [];
    }
  }

  /**
   * 모드 다운로드 (파일 URL 반환)
   */
  async getDownloadUrl(versionId: string): Promise<string> {
    try {
      console.log(`[Modrinth] Getting download URL for version ${versionId}`);
      
      const response = await this.client.get(`/version/${versionId}`);
      const primaryFile = response.data.files.find((f: any) => f.primary) || response.data.files[0];
      
      if (!primaryFile) {
        throw new Error('No download file found');
      }

      return primaryFile.url;
    } catch (error) {
      console.error('[Modrinth] Failed to get download URL:', error);
      throw error;
    }
  }

  /**
   * 모드 업데이트 확인
   */
  async checkForUpdates(
    projectId: string,
    currentVersion: string,
    gameVersion: string,
    loaderType: LoaderType
  ): Promise<ModVersion | null> {
    try {
      const versions = await this.getModVersions(projectId, gameVersion, loaderType);
      
      if (versions.length === 0) {
        return null;
      }

      // 최신 버전이 현재 버전과 다르면 업데이트 있음
      const latest = versions[0];
      if (latest.versionNumber !== currentVersion) {
        return latest;
      }

      return null;
    } catch (error) {
      console.error('[Modrinth] Failed to check for updates:', error);
      return null;
    }
  }
}
