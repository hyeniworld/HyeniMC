import axios, { AxiosInstance } from 'axios';
import { v4 as uuidv4 } from 'uuid';
import type { 
  ModSearchResult, 
  ModDetails, 
  ModVersion, 
  ModSearchFilters,
  LoaderType 
} from '../../shared/types/profile';
import { ENV_CONFIG } from '../config/env-config';

// HyeniMC Worker URL (CurseForge API Proxy + Mod Distribution)
function getProxyUrl(): string {
  const url = ENV_CONFIG.HYENIMC_WORKER_URL;
  
  if (!url) {
    throw new Error('HYENIMC_WORKER_URL is not configured. Please check your .env file.');
  }
  
  return url;
}

function shouldUseProxy(): boolean {
  return process.env.NODE_ENV === 'production' || !ENV_CONFIG.CURSEFORGE_API_KEY;
}

/**
 * Generate or retrieve launcher ID for rate limiting
 */
function getLauncherId(): string {
  // In production, this should be stored persistently
  // For now, generate a UUID per session
  if (!(global as any).__launcherId) {
    (global as any).__launcherId = uuidv4();
  }
  return (global as any).__launcherId;
}

/**
 * CurseForge API 클라이언트
 * https://docs.curseforge.com/
 * 
 * Uses a proxy server to protect the API key in production.
 * In development with CURSEFORGE_API_KEY set, uses direct API access.
 */
export class CurseForgeAPI {
  private client: AxiosInstance;
  private apiKey: string;
  private useProxy: boolean;
  private readonly MINECRAFT_GAME_ID = 432; // Minecraft game ID
  private readonly MODS_CLASS_ID = 6; // Mods class ID

  constructor(apiKey?: string) {
    // Determine if we should use proxy
    this.apiKey = apiKey || ENV_CONFIG.CURSEFORGE_API_KEY || '';
    this.useProxy = shouldUseProxy() || !this.apiKey;
    
    const proxyUrl = getProxyUrl();
    
    if (this.useProxy) {
      console.log('[CurseForge] Using proxy server:', proxyUrl);
    } else {
      console.log('[CurseForge] Using direct API access (development mode)');
    }

    const baseURL = this.useProxy ? proxyUrl : 'https://api.curseforge.com/v1';
    const headers: any = {
      'Accept': 'application/json',
    };

    if (this.useProxy) {
      // Proxy mode: send launcher ID for rate limiting
      headers['x-launcher-id'] = getLauncherId();
    } else {
      // Direct mode: send API key
      headers['x-api-key'] = this.apiKey;
    }

    this.client = axios.create({
      baseURL,
      headers,
      timeout: 30000,
    });
  }

  /**
   * API 키가 설정되어 있거나 프록시를 사용 중인지 확인
   */
  isConfigured(): boolean {
    return this.useProxy || this.apiKey.length > 0;
  }

  /**
   * 모드 검색 (direct HTTP request via proxy or CurseForge API)
   */
  async searchMods(
    query: string,
    filters?: ModSearchFilters
  ): Promise<{ hits: ModSearchResult[]; total: number }> {
    try {
      console.log(`[CurseForge] Searching mods: "${query}"`);
      
      // Map loader type to CurseForge loader ID
      let modLoaderType = 0;
      if (filters?.loaderType && filters.loaderType !== 'vanilla') {
        const loaderMap: Record<string, number> = {
          'fabric': 4, // Fabric
          'forge': 1,  // Forge
          'neoforge': 6, // NeoForge
          'quilt': 5,  // Quilt
        };
        modLoaderType = loaderMap[filters.loaderType] || 0;
      }

      // Sort mapping
      const sortFieldMap: Record<string, number> = {
        'relevance': 2,    // Popularity
        'downloads': 6,    // TotalDownloads
        'updated': 3,      // LastUpdated
        'newest': 11,      // ReleasedDate
      };
      const sortField = sortFieldMap[filters?.sortBy || 'relevance'] || 2;

      // Build search parameters
      const params: any = {
        gameId: this.MINECRAFT_GAME_ID,
        classId: this.MODS_CLASS_ID,
        searchFilter: query,
        pageSize: filters?.limit || 20,
        index: filters?.offset || 0,
        sortField: sortField,
        sortOrder: 'desc',
      };

      if (filters?.gameVersion) {
        params.gameVersion = filters.gameVersion;
      }

      if (modLoaderType > 0) {
        params.modLoaderType = modLoaderType;
      }

      // Direct HTTP request to proxy or CurseForge API
      const response = await this.client.get('/mods/search', { params });
      const data = response.data;

      const hits: ModSearchResult[] = data.data.map((mod: any) => {
        const latestFiles = mod.latestFiles || [];
        const gameVersions = [...new Set(
          latestFiles.flatMap((f: any) => f.gameVersions || [])
        )];

        return {
          id: mod.id.toString(),
          slug: mod.slug,
          name: mod.name,
          description: mod.summary || '',
          author: mod.authors?.[0]?.name || 'Unknown',
          iconUrl: mod.logo?.thumbnailUrl || mod.logo?.url,
          downloads: mod.downloadCount || 0,
          followers: mod.thumbsUpCount || 0,
          categories: mod.categories?.map((c: any) => c.name) || [],
          gameVersions: gameVersions as string[],
          loaders: this.extractLoaders(latestFiles),
          source: 'curseforge',
          updatedAt: new Date(mod.dateModified),
        };
      });

      console.log(`[CurseForge] Found ${hits.length} mods (total: ${data.pagination?.totalCount || 0})`);
      
      return {
        hits,
        total: data.pagination?.totalCount || 0,
      };
    } catch (error: any) {
      if (error.response?.status === 429) {
        console.warn('[CurseForge] Rate limit exceeded, please try again later');
        // Rate limit 에러는 빈 결과 반환 (폴백 처리 가능하도록)
        return { hits: [], total: 0 };
      }
      console.error('[CurseForge] Search failed:', error.message || error);
      throw new Error('Failed to search mods from CurseForge');
    }
  }

  /**
   * 모드 상세 정보 가져오기
   */
  async getModDetails(modId: string): Promise<ModDetails> {
    try {
      console.log(`[CurseForge] Fetching mod details: ${modId}`);
      
      const response = await this.client.get(`/mods/${modId}`);
      const mod = response.data.data;

      const latestFiles = mod.latestFiles || [];
      const gameVersions = [...new Set(
        latestFiles.flatMap((f: any) => f.gameVersions || [])
      )];

      const details: ModDetails = {
        id: mod.id.toString(),
        slug: mod.slug,
        name: mod.name,
        description: mod.summary || '',
        author: mod.authors?.[0]?.name || 'Unknown',
        iconUrl: mod.logo?.thumbnailUrl || mod.logo?.url,
        downloads: mod.downloadCount || 0,
        followers: mod.thumbsUpCount || 0,
        categories: mod.categories?.map((c: any) => c.name) || [],
        gameVersions: gameVersions as string[],
        loaders: this.extractLoaders(latestFiles),
        source: 'curseforge',
        updatedAt: new Date(mod.dateModified),
        body: '', // CurseForge requires separate API call for description
        websiteUrl: mod.links?.websiteUrl,
        sourceUrl: mod.links?.sourceUrl,
        issuesUrl: mod.links?.issuesUrl,
        versions: [],
      };

      console.log(`[CurseForge] Fetched details for: ${details.name}`);
      return details;
    } catch (error: any) {
      if (error.response?.status === 429) {
        console.warn('[CurseForge] Rate limit exceeded for mod details');
        throw new Error('CurseForge rate limit exceeded');
      }
      console.error('[CurseForge] Failed to fetch mod details:', error.message || error);
      throw new Error(`Failed to fetch mod details: ${modId}`);
    }
  }

  /**
   * 모드 버전 목록 가져오기
   */
  async getModVersions(
    modId: string,
    gameVersion?: string,
    loaderType?: LoaderType
  ): Promise<ModVersion[]> {
    try {
      console.log(`[CurseForge] Fetching versions for ${modId}`);
      
      const params: any = {
        gameId: this.MINECRAFT_GAME_ID,
      };

      if (gameVersion) {
        params.gameVersion = gameVersion;
      }

      if (loaderType && loaderType !== 'vanilla') {
        const loaderMap: Record<string, number> = {
          'fabric': 4,
          'forge': 1,
          'neoforge': 6,
          'quilt': 5,
        };
        params.modLoaderType = loaderMap[loaderType];
      }

      const response = await this.client.get(`/mods/${modId}/files`, { params });

      const versions: ModVersion[] = response.data.data.map((file: any) => ({
        id: file.id.toString(),
        versionNumber: file.displayName || file.fileName,
        name: file.displayName || file.fileName,
        changelog: '', // Requires separate API call
        gameVersions: file.gameVersions || [],
        loaders: this.extractLoadersFromFile(file),
        downloadUrl: file.downloadUrl,
        fileName: file.fileName,
        fileSize: file.fileLength || 0,
        sha1: file.hashes?.find((h: any) => h.algo === 1)?.value,
        sha512: file.hashes?.find((h: any) => h.algo === 2)?.value,
        dependencies: file.dependencies?.map((dep: any) => ({
          modId: dep.modId.toString(),
          type: this.mapDependencyType(dep.relationType),
          versionRange: undefined,
        })) || [],
        publishedAt: new Date(file.fileDate),
      }));

      console.log(`[CurseForge] Found ${versions.length} versions`);
      return versions;
    } catch (error: any) {
      if (error.response?.status === 429) {
        console.warn('[CurseForge] Rate limit exceeded for versions');
        return []; // 빈 배열 반환으로 부드럽게 처리
      }
      console.error('[CurseForge] Failed to fetch versions:', error.message || error);
      throw new Error(`Failed to fetch mod versions: ${modId}`);
    }
  }

  /**
   * 파일에서 로더 타입 추출
   */
  private extractLoaders(files: any[]): LoaderType[] {
    const loaderSet = new Set<LoaderType>();
    
    for (const file of files) {
      const loaders = this.extractLoadersFromFile(file);
      loaders.forEach(loader => loaderSet.add(loader));
    }

    return Array.from(loaderSet);
  }

  /**
   * 단일 파일에서 로더 타입 추출
   */
  private extractLoadersFromFile(file: any): LoaderType[] {
    const loaders: LoaderType[] = [];
    
    if (!file.gameVersions) return loaders;

    const gameVersions = file.gameVersions as string[];
    
    if (gameVersions.includes('Fabric')) loaders.push('fabric');
    if (gameVersions.includes('Forge')) loaders.push('forge');
    if (gameVersions.includes('NeoForge')) loaders.push('neoforge');
    if (gameVersions.includes('Quilt')) loaders.push('quilt');

    return loaders;
  }

  /**
   * CurseForge 의존성 타입을 우리 타입으로 변환
   */
  private mapDependencyType(relationType: number): 'required' | 'optional' | 'incompatible' | 'embedded' {
    // CurseForge relation types:
    // 1 = EmbeddedLibrary
    // 2 = OptionalDependency  
    // 3 = RequiredDependency
    // 4 = Tool
    // 5 = Incompatible
    // 6 = Include
    
    switch (relationType) {
      case 3:
        return 'required';
      case 2:
        return 'optional';
      case 5:
        return 'incompatible';
      case 1:
      case 6:
        return 'embedded';
      default:
        return 'optional';
    }
  }

  /**
   * 모드 업데이트 확인
   */
  async checkForUpdates(
    modId: string,
    currentFileId: string,
    gameVersion: string,
    loaderType: LoaderType
  ): Promise<ModVersion | null> {
    try {
      console.log(`[CurseForge] Checking updates for mod ${modId}, current file: ${currentFileId}`);
      
      // Get all versions for this mod
      const versions = await this.getModVersions(modId, gameVersion, loaderType);
      
      if (versions.length === 0) {
        return null;
      }

      const currentFileIdNum = parseInt(currentFileId);
      
      // Find newer versions (higher file ID = newer)
      const newerVersions = versions.filter(v => {
        const versionFileId = parseInt(v.id);
        return versionFileId > currentFileIdNum;
      });

      if (newerVersions.length === 0) {
        console.log(`[CurseForge] No updates found for mod ${modId}`);
        return null;
      }

      // Return the latest version (highest file ID)
      const latest = newerVersions.reduce((prev, current) => {
        return parseInt(current.id) > parseInt(prev.id) ? current : prev;
      });

      console.log(`[CurseForge] Update available for mod ${modId}: ${latest.versionNumber}`);
      return latest;
    } catch (error) {
      console.error('[CurseForge] Failed to check for updates:', error);
      return null;
    }
  }

  /**
   * 다운로드 URL 가져오기
   */
  async getDownloadUrl(modId: string, fileId: string): Promise<string> {
    try {
      const response = await this.client.get(`/mods/${modId}/files/${fileId}`);
      const file = response.data.data;
      
      if (!file.downloadUrl) {
        throw new Error('No download URL found');
      }

      return file.downloadUrl;
    } catch (error) {
      console.error('[CurseForge] Failed to get download URL:', error);
      throw error;
    }
  }
}
