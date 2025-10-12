import { ModrinthAPI } from './modrinth-api';
import { CurseForgeAPI } from './curseforge-api';
import type { ModSearchResult, ModSearchFilters } from '../../shared/types/profile';

/**
 * Multi-source mod aggregator
 * Combines results from Modrinth and CurseForge
 */
export class ModAggregator {
  private modrinthAPI: ModrinthAPI;
  private curseforgeAPI: CurseForgeAPI;

  constructor() {
    this.modrinthAPI = new ModrinthAPI();
    this.curseforgeAPI = new CurseForgeAPI();
  }

  /**
   * Search mods from all available sources
   */
  async searchAll(
    query: string,
    filters?: ModSearchFilters
  ): Promise<{ hits: ModSearchResult[]; total: number }> {
    const source = filters?.source || 'both';

    // Determine which sources to search
    const sources: ('modrinth' | 'curseforge')[] = 
      source === 'both' ? ['modrinth', 'curseforge'] :
      source === 'modrinth' ? ['modrinth'] :
      source === 'curseforge' ? ['curseforge'] : [];

    console.log(`[ModAggregator] Searching: "${query}" from sources:`, sources);

    // Search from all sources in parallel
    const searchPromises = sources.map(async (src) => {
      try {
        if (src === 'modrinth') {
          return await this.modrinthAPI.searchMods(query, filters);
        } else {
          // Only search CurseForge if configured
          if (this.curseforgeAPI.isConfigured()) {
            return await this.curseforgeAPI.searchMods(query, filters);
          }
          return { hits: [], total: 0 };
        }
      } catch (error) {
        console.error(`[ModAggregator] ${src} search failed:`, error);
        return { hits: [], total: 0 };
      }
    });

    const results = await Promise.all(searchPromises);

    // Combine all hits
    const allHits = results.flatMap(r => r.hits);
    const totalCount = results.reduce((sum, r) => sum + r.total, 0);

    // Deduplicate by slug (prefer higher download count)
    const deduplicated = this.deduplicateBySlug(allHits);

    console.log(`[ModAggregator] Found ${deduplicated.length} unique mods (total: ${totalCount})`);

    return {
      hits: deduplicated,
      total: totalCount,
    };
  }

  /**
   * Deduplicate mods by slug
   * When duplicates exist, prefer the one with higher downloads
   */
  private deduplicateBySlug(hits: ModSearchResult[]): ModSearchResult[] {
    const seen = new Map<string, ModSearchResult>();

    for (const hit of hits) {
      const key = hit.slug.toLowerCase();
      const existing = seen.get(key);

      if (!existing || hit.downloads > existing.downloads) {
        // Add source badge to name if not present
        if (!hit.name.includes('🟢') && !hit.name.includes('🟠')) {
          // Keep original name, badge will be shown in UI
        }
        seen.set(key, hit);
      }
    }

    return Array.from(seen.values());
  }

  /**
   * Check if CurseForge is available
   */
  isCurseForgeAvailable(): boolean {
    return this.curseforgeAPI.isConfigured();
  }
}
