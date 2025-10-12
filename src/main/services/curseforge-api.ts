import axios, { AxiosInstance } from 'axios';
import type { 
  ModSearchResult, 
  ModDetails, 
  ModVersion, 
  ModSearchFilters,
  LoaderType 
} from '../../shared/types/profile';

/**
 * CurseForge API 클라이언트
 * https://docs.curseforge.com/
 * 
 * 참고: CurseForge API 사용을 위해서는 API 키가 필요합니다.
 * https://console.curseforge.com/ 에서 발급받을 수 있습니다.
 */
export class CurseForgeAPI {
  private client: AxiosInstance;
  private apiKey: string;
  private readonly MINECRAFT_GAME_ID = 432; // Minecraft game ID
  private readonly MODS_CLASS_ID = 6; // Mods class ID

  constructor(apiKey?: string) {
    // API 키는 환경 변수 또는 설정 파일에서 가져와야 합니다
    this.apiKey = apiKey || process.env.CURSEFORGE_API_KEY || '';
    
    if (!this.apiKey) {
      console.warn('[CurseForge] API key not provided. CurseForge features will be disabled.');
    }

    this.client = axios.create({
      baseURL: 'https://api.curseforge.com/v1',
      headers: {
        'Accept': 'application/json',
        'x-api-key': this.apiKey,
      },
      timeout: 30000,
    });
  }

  /**
   * API 키가 설정되어 있는지 확인
   */
  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  /**
   * 모드 검색 (cached via gRPC)
   */
  async searchMods(
    query: string,
    filters?: ModSearchFilters
  ): Promise<{ hits: ModSearchResult[]; total: number }> {
    if (!this.isConfigured()) {
      throw new Error('CurseForge API key not configured');
    }

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

      // Use cached gRPC service
      const { cacheRpc } = await import('../grpc/clients');
      const response = await cacheRpc.searchCurseForgeMods({
        query,
        gameVersion: filters?.gameVersion || '',
        modLoaderType,
        pageSize: filters?.limit || 20,
        index: filters?.offset || 0,
        forceRefresh: false,
      });

      // Parse cached JSON response
      const data = JSON.parse(response.jsonData);

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

      console.log(`[CurseForge] Found ${hits.length} mods (total: ${data.pagination.totalCount}) [cached]`);
      
      return {
        hits,
        total: data.pagination.totalCount,
      };
    } catch (error) {
      console.error('[CurseForge] Search failed:', error);
      throw new Error('Failed to search mods from CurseForge');
    }
  }

  /**
   * 모드 상세 정보 가져오기
   */
  async getModDetails(modId: string): Promise<ModDetails> {
    if (!this.isConfigured()) {
      throw new Error('CurseForge API key not configured');
    }

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
    } catch (error) {
      console.error('[CurseForge] Failed to fetch mod details:', error);
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
    if (!this.isConfigured()) {
      throw new Error('CurseForge API key not configured');
    }

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
    } catch (error) {
      console.error('[CurseForge] Failed to fetch versions:', error);
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
}
