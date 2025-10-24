/**
 * MetadataManager 테스트
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { MetadataManager, InstalledModMeta, UnifiedMetadata } from '../metadata-manager';
import { mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';

describe('MetadataManager', () => {
  let testDir: string;
  let manager: MetadataManager;

  beforeEach(async () => {
    // 테스트용 임시 디렉토리 생성
    testDir = await mkdtemp(path.join(tmpdir(), 'metadata-test-'));
    manager = new MetadataManager();
  });

  afterEach(async () => {
    // 테스트 디렉토리 정리
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      console.error('Failed to cleanup test directory:', error);
    }
  });

  describe('통합 메타 파일 읽기/쓰기', () => {
    it('통합 메타 파일을 생성하고 읽을 수 있어야 함', async () => {
      const unified = await manager.createUnifiedMetadata(testDir, {
        source: 'manual',
        modpackId: 'test-pack',
        modpackName: 'Test Pack',
        modpackVersion: '1.0.0',
      });

      expect(unified.version).toBe(1);
      expect(unified.source).toBe('manual');
      expect(unified.modpackId).toBe('test-pack');
      expect(unified.mods).toEqual({});

      // 읽기 테스트
      const read = await manager.readUnifiedMetadata(testDir);
      expect(read).toEqual(unified);
    });

    it('통합 메타 파일에 모드를 추가할 수 있어야 함', async () => {
      await manager.createUnifiedMetadata(testDir);

      const modMeta: InstalledModMeta = {
        source: 'modrinth',
        sourceModId: 'sodium',
        sourceFileId: 'abc123',
        versionNumber: '0.5.8',
        installedAt: new Date().toISOString(),
      };

      await manager.updateModMetadata(testDir, 'sodium-0.5.8.jar', modMeta);

      const unified = await manager.readUnifiedMetadata(testDir);
      expect(unified?.mods['sodium-0.5.8.jar']).toEqual(modMeta);
    });

    it('통합 메타 파일에서 모드를 삭제할 수 있어야 함', async () => {
      await manager.createUnifiedMetadata(testDir);

      const modMeta: InstalledModMeta = {
        source: 'modrinth',
        sourceModId: 'sodium',
        versionNumber: '0.5.8',
        installedAt: new Date().toISOString(),
      };

      await manager.updateModMetadata(testDir, 'sodium-0.5.8.jar', modMeta);
      await manager.removeModMetadata(testDir, 'sodium-0.5.8.jar');

      const unified = await manager.readUnifiedMetadata(testDir);
      expect(unified?.mods['sodium-0.5.8.jar']).toBeUndefined();
    });
  });

  describe('개별 메타 파일 읽기/쓰기 (레거시)', () => {
    it('개별 메타 파일을 생성하고 읽을 수 있어야 함', async () => {
      const modPath = path.join(testDir, 'sodium-0.5.8.jar');
      await fs.writeFile(modPath, 'fake jar content');

      const modMeta: InstalledModMeta = {
        source: 'modrinth',
        sourceModId: 'sodium',
        versionNumber: '0.5.8',
        installedAt: new Date().toISOString(),
      };

      await manager.writeLegacyMetadata(modPath, modMeta);

      const read = await manager.readLegacyMetadata(modPath);
      expect(read).toEqual(modMeta);
    });
  });

  describe('getModMetadata (자동 fallback)', () => {
    it('통합 메타를 우선적으로 사용해야 함', async () => {
      // 통합 메타 생성
      await manager.createUnifiedMetadata(testDir);
      const unifiedMeta: InstalledModMeta = {
        source: 'modrinth',
        sourceModId: 'sodium',
        versionNumber: '0.5.8',
        installedAt: new Date().toISOString(),
      };
      await manager.updateModMetadata(testDir, 'sodium-0.5.8.jar', unifiedMeta);

      // 개별 메타도 생성 (다른 버전)
      const modPath = path.join(testDir, 'sodium-0.5.8.jar');
      await fs.writeFile(modPath, 'fake jar');
      const legacyMeta: InstalledModMeta = {
        source: 'local',
        versionNumber: '0.5.7', // 다른 버전
        installedAt: new Date().toISOString(),
      };
      await manager.writeLegacyMetadata(modPath, legacyMeta);

      // 통합 메타가 우선되어야 함
      const result = await manager.getModMetadata(testDir, 'sodium-0.5.8.jar');
      expect(result.found).toBe(true);
      expect(result.source).toBe('unified');
      expect(result.metadata?.versionNumber).toBe('0.5.8'); // 통합 메타의 버전
    });

    it('통합 메타가 없으면 개별 메타로 fallback해야 함', async () => {
      const modPath = path.join(testDir, 'sodium-0.5.8.jar');
      await fs.writeFile(modPath, 'fake jar');
      const legacyMeta: InstalledModMeta = {
        source: 'local',
        versionNumber: '0.5.7',
        installedAt: new Date().toISOString(),
      };
      await manager.writeLegacyMetadata(modPath, legacyMeta);

      const result = await manager.getModMetadata(testDir, 'sodium-0.5.8.jar');
      expect(result.found).toBe(true);
      expect(result.source).toBe('legacy');
      expect(result.metadata).toEqual(legacyMeta);
    });

    it('둘 다 없으면 not found를 반환해야 함', async () => {
      const result = await manager.getModMetadata(testDir, 'nonexistent.jar');
      expect(result.found).toBe(false);
      expect(result.source).toBe('none');
    });
  });

  describe('getAllModsMetadata', () => {
    it('통합 메타와 개별 메타를 병합해야 함', async () => {
      // 통합 메타 생성
      await manager.createUnifiedMetadata(testDir);
      await manager.updateModMetadata(testDir, 'sodium-0.5.8.jar', {
        source: 'modrinth',
        sourceModId: 'sodium',
        versionNumber: '0.5.8',
        installedAt: new Date().toISOString(),
      });

      // 개별 메타 생성 (다른 모드)
      const modPath = path.join(testDir, 'lithium-0.11.2.jar');
      await fs.writeFile(modPath, 'fake jar');
      await manager.writeLegacyMetadata(modPath, {
        source: 'local',
        versionNumber: '0.11.2',
        installedAt: new Date().toISOString(),
      });

      const allMods = await manager.getAllModsMetadata(testDir);
      expect(Object.keys(allMods)).toHaveLength(2);
      expect(allMods['sodium-0.5.8.jar']).toBeDefined();
      expect(allMods['lithium-0.11.2.jar']).toBeDefined();
    });
  });

});
