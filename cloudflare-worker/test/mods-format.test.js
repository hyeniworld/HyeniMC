import { describe, it, expect } from 'vitest';
import { sha256Hex, isoNow, buildManifest } from '../src/admin/mods-format.js';

describe('sha256Hex', () => {
  it('computes hex digest', async () => {
    const hex = await sha256Hex(new TextEncoder().encode('abc'));
    expect(hex).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('isoNow', () => {
  it('has no milliseconds and ends with Z', () => {
    expect(isoNow()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });
});

describe('buildManifest', () => {
  const meta = {
    modId: 'hyenihelper',
    name: 'HyeniHelper',
    version: '1.0.5',
    category: 'required',
    changelog: 'fix bug',
    releaseDate: '2025-11-14T10:40:00Z',
    files: [
      {
        loader: 'neoforge', gameVersion: '1.21.1',
        fileName: 'hyenihelper-neoforge-1.21.1-1.0.5.jar',
        sha256: 'deadbeef', size: 2048,
        minLoaderVersion: '21.1.200', maxLoaderVersion: null,
        dependencies: {},
      },
    ],
  };

  it('produces the expected manifest shape', () => {
    const m = buildManifest(meta);
    expect(m).toEqual({
      modId: 'hyenihelper',
      name: 'HyeniHelper',
      version: '1.0.5',
      releaseDate: '2025-11-14T10:40:00Z',
      changelog: 'fix bug',
      gameVersions: ['1.21.1'],
      loaders: {
        neoforge: {
          gameVersions: {
            '1.21.1': {
              file: 'hyenihelper-neoforge-1.21.1-1.0.5.jar',
              sha256: 'deadbeef',
              size: 2048,
              minLoaderVersion: '21.1.200',
              maxLoaderVersion: null,
              downloadPath: 'mods/hyenihelper/versions/1.0.5/neoforge/1.21.1/hyenihelper-neoforge-1.21.1-1.0.5.jar',
              dependencies: {},
            },
          },
        },
      },
      category: 'required',
    });
  });

  it('groups multiple loaders and dedups gameVersions', () => {
    const m = buildManifest({
      ...meta,
      files: [
        { loader: 'neoforge', gameVersion: '1.21.1', fileName: 'a.jar', sha256: 'x', size: 1, minLoaderVersion: '1', maxLoaderVersion: null, dependencies: {} },
        { loader: 'fabric', gameVersion: '1.21.1', fileName: 'b.jar', sha256: 'y', size: 2, minLoaderVersion: '2', maxLoaderVersion: null, dependencies: {} },
      ],
    });
    expect(Object.keys(m.loaders).sort()).toEqual(['fabric', 'neoforge']);
    expect(m.gameVersions).toEqual(['1.21.1']);
  });
});
