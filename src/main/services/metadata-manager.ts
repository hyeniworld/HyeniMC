/**
 * Metadata Manager
 * 
 * 모드 메타데이터 관리 통합 클래스
 * - 개별 .meta.json 읽기/쓰기 (레거시 호환)
 * - 통합 .hyenimc-metadata.json 읽기/쓰기 (최적화)
 * - 자동 변환 및 마이그레이션
 */

import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * 개별 모드 메타데이터
 */
export interface InstalledModMeta {
  // 기본 정보
  source: 'modrinth' | 'curseforge' | 'hyeniworld' | 'url' | 'local';
  sourceModId?: string;
  sourceFileId?: string;
  versionNumber: string;
  installedAt: string;
  
  // 설치 정보
  installedFrom?: 'hyenipack' | 'manual' | 'update' | 'dependency';
  
  // 모드팩 정보
  modpackId?: string;
  modpackVersion?: string;
  
  // 의존성 정보
  isDependency?: boolean;
  dependencyOf?: string; // 어떤 모드의 의존성인지
  
  // 업데이트 설정
  updateChannel?: 'stable' | 'beta' | 'dev';
  autoUpdate?: boolean;
}

/**
 * 통합 메타데이터 구조
 */
export interface UnifiedMetadata {
  version: number; // 메타데이터 형식 버전
  source: 'hyenipack' | 'manual' | 'migrated';
  modpackId?: string;
  modpackName?: string;
  modpackVersion?: string;
  installedAt: string;
  updatedAt: string;
  mods: Record<string, InstalledModMeta>; // key: fileName
}

/**
 * 메타데이터 읽기 결과
 */
export interface MetadataReadResult {
  found: boolean;
  source: 'unified' | 'legacy' | 'none';
  metadata?: InstalledModMeta;
}

/**
 * 메타데이터 관리자
 */
export class MetadataManager {
  private static readonly UNIFIED_META_FILE = '.hyenimc-metadata.json';
  private static readonly META_VERSION = 1;

  /**
   * 개별 메타 파일 읽기 (레거시)
   */
  async readLegacyMetadata(modFilePath: string): Promise<InstalledModMeta | null> {
    const metaPath = `${modFilePath}.meta.json`;
    
    try {
      const content = await fs.readFile(metaPath, 'utf8');
      const metadata = JSON.parse(content) as InstalledModMeta;
      return metadata;
    } catch (error) {
      // 파일이 없거나 파싱 실패
      return null;
    }
  }

  /**
   * 개별 메타 파일 쓰기 (레거시)
   */
  async writeLegacyMetadata(modFilePath: string, metadata: InstalledModMeta): Promise<void> {
    const metaPath = `${modFilePath}.meta.json`;
    await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2), 'utf8');
  }

  /**
   * 통합 메타 파일 읽기
   */
  async readUnifiedMetadata(modsDir: string): Promise<UnifiedMetadata | null> {
    const metaPath = path.join(modsDir, MetadataManager.UNIFIED_META_FILE);
    
    try {
      const content = await fs.readFile(metaPath, 'utf8');
      const metadata = JSON.parse(content) as UnifiedMetadata;
      
      // 버전 호환성 확인
      if (metadata.version > MetadataManager.META_VERSION) {
        console.warn('[MetadataManager] Unified metadata version is newer than supported');
      }
      
      return metadata;
    } catch (error) {
      // 파일이 없거나 파싱 실패
      return null;
    }
  }

  /**
   * 통합 메타 파일 쓰기
   */
  async writeUnifiedMetadata(modsDir: string, metadata: UnifiedMetadata): Promise<void> {
    const metaPath = path.join(modsDir, MetadataManager.UNIFIED_META_FILE);
    
    // updatedAt 자동 갱신
    metadata.updatedAt = new Date().toISOString();
    
    await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2), 'utf8');
    console.log(`[MetadataManager] Written unified metadata: ${metaPath}`);
  }

  /**
   * 통합 메타 파일 생성 (초기화)
   */
  async createUnifiedMetadata(
    modsDir: string,
    options: {
      source?: 'hyenipack' | 'manual' | 'migrated';
      modpackId?: string;
      modpackName?: string;
      modpackVersion?: string;
    } = {}
  ): Promise<UnifiedMetadata> {
    const now = new Date().toISOString();
    
    const metadata: UnifiedMetadata = {
      version: MetadataManager.META_VERSION,
      source: options.source || 'manual',
      modpackId: options.modpackId,
      modpackName: options.modpackName,
      modpackVersion: options.modpackVersion,
      installedAt: now,
      updatedAt: now,
      mods: {},
    };
    
    await this.writeUnifiedMetadata(modsDir, metadata);
    return metadata;
  }

  /**
   * 특정 모드의 메타 정보 가져오기 (자동 fallback)
   * 1. 통합 메타에서 찾기
   * 2. 개별 메타에서 찾기 (레거시)
   */
  async getModMetadata(modsDir: string, fileName: string): Promise<MetadataReadResult> {
    // 1. 통합 메타 시도
    const unified = await this.readUnifiedMetadata(modsDir);
    if (unified && unified.mods[fileName]) {
      return {
        found: true,
        source: 'unified',
        metadata: unified.mods[fileName],
      };
    }

    // 2. 개별 메타 fallback
    const modFilePath = path.join(modsDir, fileName);
    const legacy = await this.readLegacyMetadata(modFilePath);
    if (legacy) {
      return {
        found: true,
        source: 'legacy',
        metadata: legacy,
      };
    }

    // 3. 없음
    return {
      found: false,
      source: 'none',
    };
  }

  /**
   * 모든 모드 메타 정보 가져오기
   * 통합 메타와 개별 메타를 병합
   */
  async getAllModsMetadata(modsDir: string): Promise<Record<string, InstalledModMeta>> {
    const result: Record<string, InstalledModMeta> = {};

    // 1. 통합 메타 읽기
    const unified = await this.readUnifiedMetadata(modsDir);
    if (unified) {
      Object.assign(result, unified.mods);
    }

    // 2. 개별 메타 파일들 스캔 (통합에 없는 것만)
    try {
      const entries = await fs.readdir(modsDir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (!entry.name.endsWith('.meta.json')) continue;
        
        // 파일명 추출 (예: sodium-0.5.8.jar.meta.json → sodium-0.5.8.jar)
        const fileName = entry.name.replace(/\.meta\.json$/, '');
        
        // 이미 통합 메타에 있으면 스킵
        if (result[fileName]) continue;
        
        // 개별 메타 읽기
        const modFilePath = path.join(modsDir, fileName);
        const legacy = await this.readLegacyMetadata(modFilePath);
        if (legacy) {
          result[fileName] = legacy;
        }
      }
    } catch (error) {
      console.error('[MetadataManager] Failed to scan legacy metadata:', error);
    }

    return result;
  }

  /**
   * 모드 메타 정보 업데이트 (통합 메타에)
   */
  async updateModMetadata(
    modsDir: string,
    fileName: string,
    metadata: InstalledModMeta
  ): Promise<void> {
    // 통합 메타 읽기 또는 생성
    let unified = await this.readUnifiedMetadata(modsDir);
    if (!unified) {
      unified = await this.createUnifiedMetadata(modsDir);
    }

    // 모드 메타 추가/업데이트
    unified.mods[fileName] = metadata;

    // 저장
    await this.writeUnifiedMetadata(modsDir, unified);
  }

  /**
   * 모드 메타 정보 삭제
   */
  async removeModMetadata(modsDir: string, fileName: string): Promise<void> {
    const unified = await this.readUnifiedMetadata(modsDir);
    if (!unified) return;

    // 통합 메타에서 삭제
    if (unified.mods[fileName]) {
      delete unified.mods[fileName];
      await this.writeUnifiedMetadata(modsDir, unified);
    }

    // 개별 메타 파일도 삭제 (있다면)
    try {
      const modFilePath = path.join(modsDir, fileName);
      const metaPath = `${modFilePath}.meta.json`;
      await fs.unlink(metaPath);
      console.log(`[MetadataManager] Removed legacy metadata: ${fileName}.meta.json`);
    } catch {
      // 파일이 없으면 무시
    }
  }

}

// 싱글톤 인스턴스
export const metadataManager = new MetadataManager();
