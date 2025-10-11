import { ModrinthAPI } from './modrinth-api';
import { ModManager } from './mod-manager';
import type { ModVersion } from '../../shared/types/profile';

export interface ModUpdateInfo {
  modId: string;
  modName: string;
  fileName: string;
  currentVersion: string;
  latestVersion: string;
  latestVersionId: string;
  changelog?: string;
  required: boolean;
  downloadUrl: string;
  fileSize: number;
}

export interface UpdateResult {
  success: string[];
  failed: Array<{ modName: string; error: string }>;
  skipped: string[];
}

export class ModUpdater {
  private modrinthAPI: ModrinthAPI;

  constructor() {
    this.modrinthAPI = new ModrinthAPI();
  }

  /**
   * 파일명에서 추출한 슬러그 정규화 (로더 접미 제거 등)
   */
  private normalizeSlug(slug: string): string {
    return slug
      .replace(/[-_](fabric|forge|neoforge)$/i, '')
      .replace(/[-_](fabric|forge|neoforge)[-_.].*$/i, '')
      .toLowerCase();
  }

  /**
   * 프로젝트 ID/슬러그 해석
   * 1) 파일명 기반 슬러그 정규화 후 getModDetails 시도
   * 2) 알려진 매핑 테이블 적용 (네오포지 대표 케이스)
   * 3) 이름 기반 검색 폴백(로더/게임버전 필터)
   */
  private async resolveProjectId(
    displayName: string,
    fileName: string,
    gameVersion: string,
    loaderType: string
  ): Promise<string | null> {
    // 1) 파일명에서 슬러그 추출/정규화
    const rawSlug = this.extractModSlug(fileName);
    const slug = this.normalizeSlug(rawSlug);

    // 2) 네오포지 등 흔한 매핑 우선 적용
    const knownMap: Record<string, string> = {
      // Iris
      iris: 'YL57xq9U',
      // Sodium
      sodium: 'AANobbMI',
      // 필요 시 추가 매핑
    };

    // 2-1) 매핑 ID가 있으면 바로 사용 가능
    if (knownMap[slug]) {
      return knownMap[slug];
    }

    // 3) 슬러그로 직접 조회 시도 (성공 시 정식 ID 획득)
    try {
      const details = await this.modrinthAPI.getModDetails(slug);
      if (details?.id) return details.id;
    } catch (_) {
      // ignore and fallback to search
    }

    // 4) 이름 기반 검색 폴백 (로더/버전 필터)
    // 파일명에서 로더 토큰 제거 후 검색어 보정
    const searchQuery = displayName || slug;
    const result = await this.modrinthAPI.searchMods(searchQuery, {
      gameVersion,
      loaderType: loaderType !== 'vanilla' ? (loaderType as any) : undefined,
      limit: 5,
    } as any);

    if (!result.hits || result.hits.length === 0) return null;

    // 후보 중 slug 포함/로더 호환 우선 선택
    const preferred = result.hits.find(h =>
      h.slug?.toLowerCase().includes(slug) || h.name?.toLowerCase().includes(slug)
    ) || result.hits[0];

    return preferred.id || null;
  }

  /**
   * 설치된 모드들의 업데이트 확인
   * 
   * 참고: 현재는 Modrinth에서 가져온 모드만 업데이트 확인 가능
   * 로컬 모드는 소스 정보가 없어서 업데이트를 확인할 수 없음
   */
  async checkUpdates(
    gameDir: string,
    gameVersion: string,
    loaderType: string
  ): Promise<ModUpdateInfo[]> {
    const updates: ModUpdateInfo[] = [];

    try {
      const modManager = new ModManager();
      const installedMods = await modManager.listMods(gameDir);

      console.log(`[ModUpdater] Checking updates for ${installedMods.length} mods`);

      // TODO: 이상적으로는 설치 시점의 메타데이터(Project ID/Version ID)를 저장해 직접 참조해야 함.
      // 현재는 파일명 슬러그를 우선 시도하고, 실패 시 이름 검색으로 폴백합니다.
      for (const mod of installedMods) {
        if (!mod.enabled) {
          console.log(`[ModUpdater] Skipping disabled mod: ${mod.name}`);
          continue;
        }

        try {
          // 프로젝트 식별: 파일명/이름을 기반으로 ID 또는 슬러그 해석 (네오포지 케이스 보완)
          const projectIdOrSlug = await this.resolveProjectId(
            mod.name,
            mod.fileName,
            gameVersion,
            loaderType
          );
          if (!projectIdOrSlug) {
            console.log(`[ModUpdater] Could not resolve project for: ${mod.name}`);
            continue;
          }

          // 최신 버전 가져오기
          const versions = await this.modrinthAPI.getModVersions(
            projectIdOrSlug,
            gameVersion,
            loaderType as any
          );

          if (versions.length === 0) {
            console.log(`[ModUpdater] No compatible versions for: ${mod.name}`);
            continue;
          }

          const latestVersion = versions[0];

          // 현재 버전 추정: ModManager가 파싱한 값 우선, 없으면 파일명에서 추출
          const slugForVersion = this.normalizeSlug(this.extractModSlug(mod.fileName));
          const currentVersion = mod.version || this.extractVersionFromFileName(mod.fileName, slugForVersion);

          // 동일 파일명은 업데이트 불필요로 간주 (해시 비교까지는 미구현)
          const isSameFileName = !!latestVersion.fileName && mod.fileName === latestVersion.fileName;
          const needsUpdate = !isSameFileName && this.isNewerVersion(latestVersion.versionNumber, currentVersion);

          if (needsUpdate) {
            updates.push({
              modId: projectIdOrSlug,
              modName: mod.name,
              fileName: mod.fileName,
              currentVersion,
              latestVersion: latestVersion.versionNumber,
              latestVersionId: latestVersion.id,
              changelog: latestVersion.changelog,
              required: false,
              downloadUrl: latestVersion.downloadUrl!,
              fileSize: latestVersion.fileSize!,
            });

            console.log(`[ModUpdater] Update available: ${mod.name} ${currentVersion} -> ${latestVersion.versionNumber}`);
          }
        } catch (error) {
          console.error(`[ModUpdater] Failed to check update for ${mod.name}:`, error);
        }
      }

      console.log(`[ModUpdater] Found ${updates.length} updates`);
      return updates;
    } catch (error) {
      console.error('[ModUpdater] Failed to check updates:', error);
      return [];
    }
  }

  /**
   * 모드 업데이트 실행
   */
  async updateMod(
    gameDir: string,
    update: ModUpdateInfo,
    onProgress?: (progress: number) => void
  ): Promise<void> {
    try {
      const modsDir = `${gameDir}/mods`;
      const modManager = new ModManager();

      console.log(`[ModUpdater] Updating ${update.modName}...`);

      // 기존 모드 파일 삭제
      await modManager.deleteMod(gameDir, update.fileName);

      // 새 버전 다운로드
      const { DownloadManager } = await import('./download-manager');
      const downloadManager = new DownloadManager();

      // Get latest version details
      const versions = await this.modrinthAPI.getModVersions(update.modId);
      const version = versions.find(v => v.id === update.latestVersionId);

      if (!version || !version.downloadUrl) {
        throw new Error('Download URL not found');
      }

      const taskId = downloadManager.addTask(
        version.downloadUrl,
        `${modsDir}/${version.fileName}`,
        version.sha1,
        'sha1'
      );

      await downloadManager.startAll((progress) => {
        onProgress?.(progress.progress);
      });

      console.log(`[ModUpdater] Successfully updated ${update.modName}`);
    } catch (error) {
      console.error(`[ModUpdater] Failed to update ${update.modName}:`, error);
      throw error;
    }
  }

  /**
   * 여러 모드 일괄 업데이트
   */
  async updateMods(
    gameDir: string,
    updates: ModUpdateInfo[],
    onProgress?: (current: number, total: number, modName: string) => void
  ): Promise<UpdateResult> {
    const success: string[] = [];
    const failed: Array<{ modName: string; error: string }> = [];
    const skipped: string[] = [];
    const total = updates.length;

    for (let i = 0; i < updates.length; i++) {
      const update = updates[i];
      
      onProgress?.(i + 1, total, update.modName);

      try {
        await this.updateMod(gameDir, update);
        success.push(update.modName);
      } catch (error) {
        console.error(`[ModUpdater] Failed to update ${update.modName}:`, error);
        failed.push({
          modName: update.modName,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return { success, failed, skipped };
  }

  /**
   * 필수 모드만 업데이트
   */
  async updateRequiredMods(
    gameDir: string,
    updates: ModUpdateInfo[],
    onProgress?: (current: number, total: number, modName: string) => void
  ): Promise<UpdateResult> {
    const requiredUpdates = updates.filter(u => u.required);
    return this.updateMods(gameDir, requiredUpdates, onProgress);
  }

  /**
   * 파일 이름에서 모드 슬러그 추출
   */
  private extractModSlug(fileName: string): string {
    // fabric-api-0.92.0+1.20.1.jar -> fabric-api
    const baseName = fileName.replace(/\.jar(\.disabled)?$/, '');
    const parts = baseName.split('-');
    
    // 버전 번호로 보이는 부분 제거
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
   * 파일명에서 버전 문자열을 단순 추출 (베스트 에포트)
   * 예: sodium-fabric-0.5.8+mc1.21.1.jar -> 0.5.8+mc1.21.1
   */
  private extractVersionFromFileName(fileName: string, slug: string): string {
    const base = fileName.replace(/\.jar(\.disabled)?$/, '');
    const idx = base.indexOf(slug);
    if (idx >= 0) {
      const after = base.slice(idx + slug.length);
      const trimmed = after.replace(/^[\-\_]/, '');
      return trimmed || base;
    }
    // 폴백: 마지막 '-' 이후를 버전으로 가정
    const parts = base.split('-');
    return parts.length > 1 ? parts.slice(1).join('-') : base;
  }

  /**
   * Modrinth 버전 문자열 정규화
   * 예: 'mc1.21.1-1.8.12-neoforge' -> [1,8,12]
   *     '0.6.13+mc1.21.1' -> [0,6,13]
   */
  private normalizeVersionString(v: string): number[] {
    if (!v) return [];
    // mc 접두/접미, 로더 접미 제거
    let s = v
      .replace(/^mc\d+(?:\.\d+)*[-_]?/i, '')
      .replace(/[-_](fabric|forge|neoforge).*$/i, '')
      .replace(/.*-mc\d+(?:\.\d+)*$/i, '');
    // 숫자 시퀀스만 추출
    const nums = s.match(/\d+(?:\.\d+)*/g);
    if (!nums || nums.length === 0) {
      // 전체에서 마지막 숫자 시퀀스라도 추출
      const fallback = v.match(/\d+(?:\.\d+)*/g);
      if (!fallback) return [];
      s = fallback[fallback.length - 1];
    } else {
      s = nums[0];
    }
    return s.split('.').map(n => parseInt(n, 10) || 0);
  }

  /**
   * 버전 비교: 정규화된 숫자 배열을 기준으로 비교
   */
  private isNewerVersion(latest: string, current: string): boolean {
    if (!latest) return false;
    if (!current) return true;
    const L = this.normalizeVersionString(latest);
    const C = this.normalizeVersionString(current);
    if (L.length === 0 || C.length === 0) {
      return latest !== current; // 정보 부족 시 보수적으로 문자열 비교
    }
    for (let i = 0; i < Math.max(L.length, C.length); i++) {
      const a = L[i] ?? 0;
      const b = C[i] ?? 0;
      if (a > b) return true;
      if (a < b) return false;
    }
    return false;
  }
}
