import { describe, test, expect } from 'vitest';
import {
  isValidHyenipackId,
  buildManifestV2,
  buildLatestInfo,
  ManifestV2Input,
} from '../hyenipack-manifest';

function baseInput(): ManifestV2Input {
  return {
    profile: {
      name: '혜니월드 생존',
      gameVersion: '1.21.1',
      loaderType: 'fabric',
      loaderVersion: '0.16.7',
    },
    options: {
      hyenipackId: 'hyenipack-hyeniworld',
      packName: '혜니월드 생존 팩',
      version: '1.2.0',
      author: 'deVbug',
      description: '공식 팩',
      changelog: '- Sodium 업데이트',
      breaking: false,
      selectedFiles: ['mods/sodium.jar', 'config/options.json'],
      overridePolicies: [{ path: 'config', policy: 'keep' }],
    },
    mods: [
      {
        fileName: 'sodium.jar',
        metadata: { source: 'modrinth', projectId: 'AANobbMI', version: 'abc' },
        sha256: 'deadbeef',
        size: 1024,
      },
    ],
    launcherVersion: '0.3.4',
    createdAt: '2026-07-06T04:00:00.000Z',
  };
}

describe('isValidHyenipackId', () => {
  test('accepts lowercase alphanumeric with hyphens', () => {
    expect(isValidHyenipackId('hyenipack-hyeniworld')).toBe(true);
  });

  test.each(['', 'UPPER', 'has space', 'dot.dot', '-leading', 'a'.repeat(65)])(
    'rejects invalid id: %s',
    (id) => {
      expect(isValidHyenipackId(id)).toBe(false);
    }
  );
});

describe('buildManifestV2', () => {
  test('produces formatVersion 2 manifest with v2 fields', () => {
    // Arrange
    const input = baseInput();

    // Act
    const manifest = buildManifestV2(input);

    // Assert
    expect(manifest.formatVersion).toBe(2);
    expect(manifest.hyenipackId).toBe('hyenipack-hyeniworld');
    expect(manifest.changelog).toBe('- Sodium 업데이트');
    expect(manifest.breaking).toBe(false);
    expect(manifest.overrides).toEqual([{ path: 'config', policy: 'keep' }]);
    expect(manifest.minecraft).toEqual({
      version: '1.21.1',
      loaderType: 'fabric',
      loaderVersion: '0.16.7',
    });
    expect(manifest.mods).toHaveLength(1);
    expect(manifest.createdAt).toBe('2026-07-06T04:00:00.000Z');
    expect(manifest.exportedFrom?.version).toBe('0.3.4');
  });

  test('throws on invalid hyenipackId', () => {
    const input = baseInput();
    input.options.hyenipackId = 'Bad ID!';
    expect(() => buildManifestV2(input)).toThrow(/hyenipackId/);
  });

  test('throws on non-semver version', () => {
    const input = baseInput();
    input.options.version = 'v1';
    expect(() => buildManifestV2(input)).toThrow(/version/);
  });
});

describe('buildLatestInfo', () => {
  test('derives latest.json fields from manifest + pack file facts', () => {
    // Arrange
    const manifest = buildManifestV2(baseInput());

    // Act
    const latest = buildLatestInfo(manifest, 'cafebabe', 52428800, '2026-07-06T05:00:00.000Z');

    // Assert
    expect(latest).toEqual({
      hyenipackId: 'hyenipack-hyeniworld',
      name: '혜니월드 생존 팩',
      version: '1.2.0',
      changelog: '- Sodium 업데이트',
      breaking: false,
      fileSize: 52428800,
      sha256: 'cafebabe',
      releaseDate: '2026-07-06T05:00:00.000Z',
    });
  });
});
