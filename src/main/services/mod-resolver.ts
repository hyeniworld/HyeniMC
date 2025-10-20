import { ModrinthAPI } from './modrinth-api';

/**
 * 모드 프로젝트 ID 해석 유틸리티
 * 파일명, 이름 등을 통해 Modrinth/CurseForge 프로젝트 ID를 찾음
 */
export class ModResolver {
  private modrinthAPI: ModrinthAPI;
  
  // 알려진 모드 매핑 (슬러그 -> Modrinth project ID)
  private static readonly KNOWN_MOD_MAPPINGS: Record<string, string> = {
    iris: 'YL57xq9U',
    sodium: 'AANobbMI',
    lithium: 'gvQqBUqZ',
    phosphor: 'hEOCdOgW',
    indium: 'Orvt0mRa',
    'fabric-api': 'P7dR8mSH',
    'connector': 'u58R1TMW',
    'sinytra-connector': 'u58R1TMW',
  };

  constructor() {
    this.modrinthAPI = new ModrinthAPI();
  }

  /**
   * 파일명에서 모드 슬러그 추출
   * 예: "iris-neoforge-1.8.12+mc1.21.1.jar" -> "iris"
   */
  extractModSlug(fileName: string): string {
    const baseName = fileName.replace(/\.jar(\.disabled)?$/, '');
    const parts = baseName.split('-');
    
    const nameparts: string[] = [];
    for (const part of parts) {
      if (/^\d/.test(part)) {
        break;
      }
      nameparts.push(part);
    }
    
    return nameparts.join('-') || baseName;
  }

  /**
   * 슬러그 정규화 (로더 접미사 제거 등)
   */
  normalizeSlug(slug: string): string {
    return slug
      .replace(/[-_](fabric|forge|neoforge|quilt)$/i, '')
      .replace(/[-_](fabric|forge|neoforge|quilt)[-_.].*$/i, '')
      .toLowerCase();
  }

  /**
   * Modrinth 프로젝트 ID 해석
   * 1) 알려진 매핑 확인
   * 2) 슬러그로 직접 조회
   * 3) 검색 API 폴백
   */
  async resolveModrinthProjectId(
    displayName: string,
    fileName: string,
    gameVersion: string,
    loaderType: string
  ): Promise<string | null> {
    // 파일명에서 슬러그 추출 및 정규화
    const rawSlug = this.extractModSlug(fileName);
    const slug = this.normalizeSlug(rawSlug);

    console.log(`[ModResolver] Resolving: ${displayName} (slug: ${slug})`);

    // 1) 알려진 매핑 확인
    if (ModResolver.KNOWN_MOD_MAPPINGS[slug]) {
      console.log(`[ModResolver] Found in known mappings: ${ModResolver.KNOWN_MOD_MAPPINGS[slug]}`);
      return ModResolver.KNOWN_MOD_MAPPINGS[slug];
    }

    // 2) 슬러그로 직접 조회
    try {
      const details = await this.modrinthAPI.getModDetails(slug);
      if (details?.id) {
        console.log(`[ModResolver] Resolved via slug lookup: ${details.id}`);
        return details.id;
      }
    } catch (error) {
      // 실패하면 검색으로 폴백
    }

    // 3) 검색 API 폴백
    try {
      const searchQuery = displayName || slug;
      const result = await this.modrinthAPI.searchMods(searchQuery, {
        gameVersion,
        loaderType: loaderType !== 'vanilla' ? (loaderType as any) : undefined,
        limit: 5,
      } as any);

      if (!result.hits || result.hits.length === 0) {
        console.log(`[ModResolver] No results found for: ${searchQuery}`);
        return null;
      }

      // 슬러그가 포함된 결과 우선 선택
      const preferred = result.hits.find(h =>
        h.slug?.toLowerCase().includes(slug) || h.name?.toLowerCase().includes(slug)
      ) || result.hits[0];

      console.log(`[ModResolver] Resolved via search: ${preferred.id} (${preferred.slug})`);
      return preferred.id || null;
    } catch (error) {
      console.error(`[ModResolver] Failed to resolve project:`, error);
      return null;
    }
  }

  /**
   * 알려진 매핑에 모드 추가 (런타임)
   */
  static addKnownMapping(slug: string, projectId: string): void {
    ModResolver.KNOWN_MOD_MAPPINGS[slug] = projectId;
  }
}
