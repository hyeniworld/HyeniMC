import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { putJson, getJson } from '../src/admin/r2.js';
import { buildRegistryEntry, rebuildRegistry } from '../src/admin/registry.js';

async function clearBucket() {
  const list = await env.RELEASES.list();
  for (const o of list.objects) await env.RELEASES.delete(o.key);
}
beforeEach(clearBucket);

const latestHH = {
  modId: 'hyenihelper', name: 'HyeniHelper', version: '1.0.5',
  releaseDate: '2025-11-14T10:40:00Z', changelog: 'x',
  gameVersions: ['1.21.1'],
  loaders: {
    neoforge: { gameVersions: { '1.21.1': {
      file: 'a.jar', sha256: 'x', size: 1,
      minLoaderVersion: '21.1.200', maxLoaderVersion: null,
      downloadPath: 'mods/hyenihelper/versions/1.0.5/neoforge/1.21.1/a.jar',
      dependencies: {},
    } } },
  },
  category: 'required',
};

describe('buildRegistryEntry', () => {
  it('maps latest.json to registry entry with default description', () => {
    const entry = buildRegistryEntry(latestHH, null);
    expect(entry).toEqual({
      id: 'hyenihelper',
      name: 'HyeniHelper',
      description: 'HyeniMC hyenihelper mod',
      latestVersion: '1.0.5',
      category: 'required',
      gameVersions: ['1.21.1'],
      loaders: [{
        type: 'neoforge',
        minVersion: '21.1.200',
        maxVersion: null,
        supportedGameVersions: ['1.21.1'],
      }],
      dependencies: { required: [], optional: [] },
    });
  });

  it('preserves existing description and dependencies', () => {
    const entry = buildRegistryEntry(latestHH, {
      id: 'hyenihelper', description: '커스텀 설명',
      dependencies: { required: ['hyenicore'], optional: [] },
    });
    expect(entry.description).toBe('커스텀 설명');
    expect(entry.dependencies).toEqual({ required: ['hyenicore'], optional: [] });
  });
});

describe('rebuildRegistry', () => {
  it('collects all mods and writes registry.json', async () => {
    await putJson(env, 'mods/hyenihelper/latest.json', latestHH);
    await putJson(env, 'mods/other/latest.json', { ...latestHH, modId: 'other', name: 'Other' });

    const reg = await rebuildRegistry(env);
    expect(reg.version).toBe('2.0');
    expect(reg.mods.map((m) => m.id).sort()).toEqual(['hyenihelper', 'other']);

    const stored = await getJson(env, 'mods/registry.json');
    expect(stored.mods.length).toBe(2);
  });

  it('preserves description across rebuilds', async () => {
    await putJson(env, 'mods/hyenihelper/latest.json', latestHH);
    await putJson(env, 'mods/registry.json', {
      version: '2.0', lastUpdated: 'x',
      mods: [{ id: 'hyenihelper', description: '보존됨', dependencies: { required: [], optional: [] } }],
    });
    const reg = await rebuildRegistry(env);
    expect(reg.mods.find((m) => m.id === 'hyenihelper').description).toBe('보존됨');
  });
});
