import { ModrinthAPI } from './modrinth-api';
import { cacheRpc } from '../grpc/clients';

/**
 * 모드 프로젝트 ID 해석 유틸리티
 * 파일명, 이름 등을 통해 Modrinth/CurseForge 프로젝트 ID를 찾음
 * 동적 학습 캐싱 시스템: 검색으로 찾은 매핑을 DB에 자동 저장하여 재사용
 */
export class ModResolver {
  private modrinthAPI: ModrinthAPI;

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

    // 1) DB 캐시 확인 (동적 학습된 매핑)
    try {
      const cached = await cacheRpc.getModSlugMapping({
        slug,
        source: 'modrinth',
      });
      
      if (cached.found) {
        console.log(`[ModResolver] Found in cache: ${cached.projectId} (${cached.resolvedVia}, hits: ${cached.hitCount})`);
        return cached.projectId;
      }
    } catch (error) {
      console.log(`[ModResolver] Cache lookup failed:`, error);
      // Continue with API fallback
    }

    // 2) 슬러그로 직접 조회
    try {
      const details = await this.modrinthAPI.getModDetails(slug);
      if (details?.id) {
        console.log(`[ModResolver] Resolved via slug lookup: ${details.id}`);
        // 성공 시 DB에 저장 (향후 재사용)
        await this.saveMappingToCache(slug, details.id, details.name, 'slug_lookup', 100);
        return details.id;
      }
    } catch (error) {
      // 404나 기타 에러 발생 시 검색으로 폴백
      console.log(`[ModResolver] Slug lookup failed for '${slug}', falling back to search`);
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
      
      // 검색으로 찾은 경우 낮은 신뢰도로 저장 (정확도가 떨어질 수 있음)
      const confidence = preferred.slug?.toLowerCase() === slug ? 90 : 70;
      await this.saveMappingToCache(slug, preferred.id, preferred.name, 'search', confidence);
      
      return preferred.id || null;
    } catch (error) {
      console.error(`[ModResolver] Failed to resolve project:`, error);
      return null;
    }
  }

  /**
   * 매핑을 DB 캐시에 저장
   */
  private async saveMappingToCache(
    slug: string,
    projectId: string,
    projectName: string | undefined,
    resolvedVia: 'slug_lookup' | 'search',
    confidence: number
  ): Promise<void> {
    try {
      await cacheRpc.saveModSlugMapping({
        slug,
        source: 'modrinth',
        projectId,
        projectName: projectName || '',
        resolvedVia,
        confidence,
      });
      console.log(`[ModResolver] Saved mapping to cache: ${slug} -> ${projectId}`);
    } catch (error) {
      console.error(`[ModResolver] Failed to save mapping to cache:`, error);
      // 저장 실패해도 계속 진행
    }
  }
}
