import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { putJson, getJson } from '../src/admin/r2.js';
import { rebuildModIndex, resolveFromIndex, setModPin } from '../src/admin/mod-index.js';

async function clearBucket() {
  const list = await env.RELEASES.list();
  for (const o of list.objects) await env.RELEASES.delete(o.key);
}
beforeEach(clearBucket);

function manifest(version, loaders) {
  return { modId: 'hh', name: 'HH', version, releaseDate: '2025-01-01T00:00:00Z',
    changelog: '', gameVersions: [], loaders, category: 'required' };
}
const cell = (gv) => ({ [gv]: { file: 'a.jar', sha256: 'x', size: 1, minLoaderVersion: '1', maxLoaderVersion: null, downloadPath: 'p', dependencies: {} } });

async function seed() {
  // 1.0.4: neoforge/1.21.1 + fabric/1.21.1
  await putJson(env, 'mods/hh/versions/1.0.4/manifest.json',
    manifest('1.0.4', { neoforge: { gameVersions: cell('1.21.1') }, fabric: { gameVersions: cell('1.21.1') } }));
  // 1.0.5: fabric/1.21.1 만
  await putJson(env, 'mods/hh/versions/1.0.5/manifest.json',
    manifest('1.0.5', { fabric: { gameVersions: cell('1.21.1') } }));
  // 1.0.11: neoforge/1.21.1 (숫자정렬 확인용: 1.0.11 > 1.0.5)
  await putJson(env, 'mods/hh/versions/1.0.11/manifest.json',
    manifest('1.0.11', { neoforge: { gameVersions: cell('1.21.1') } }));
}

describe('rebuildModIndex', () => {
  it('computes auto per (loader,gv) as the numerically-highest offering version', async () => {
    await seed();
    const idx = await rebuildModIndex(env, 'hh');
    expect(idx.targets.neoforge['1.21.1'].auto).toBe('1.0.11'); // 1.0.4, 1.0.11 중 최고(숫자)
    expect(idx.targets.fabric['1.21.1'].auto).toBe('1.0.5');    // 1.0.4, 1.0.5 중 최고
    expect(idx.targets.neoforge['1.21.1'].pinned).toBeNull();
    const stored = await getJson(env, 'mods/hh/index.json');
    expect(stored.targets.fabric['1.21.1'].auto).toBe('1.0.5');
  });

  it('preserves a pin only if that version still offers the target', async () => {
    await seed();
    await rebuildModIndex(env, 'hh');
    await setModPin(env, 'hh', 'neoforge', '1.21.1', '1.0.4');
    const idx = await rebuildModIndex(env, 'hh'); // 재계산 후에도 핀 보존(1.0.4가 neoforge/1.21.1 제공)
    expect(idx.targets.neoforge['1.21.1'].pinned).toBe('1.0.4');
  });
});

describe('resolveFromIndex', () => {
  it('returns pinned ?? auto, null when absent', async () => {
    await seed();
    let idx = await rebuildModIndex(env, 'hh');
    expect(resolveFromIndex(idx, 'neoforge', '1.21.1')).toBe('1.0.11');
    await setModPin(env, 'hh', 'neoforge', '1.21.1', '1.0.4');
    idx = await getJson(env, 'mods/hh/index.json');
    expect(resolveFromIndex(idx, 'neoforge', '1.21.1')).toBe('1.0.4');
    expect(resolveFromIndex(idx, 'quilt', '1.21.1')).toBeNull();
  });
});

describe('setModPin', () => {
  it('rejects pinning a version that does not offer the target', async () => {
    await seed();
    await rebuildModIndex(env, 'hh');
    const r = await setModPin(env, 'hh', 'neoforge', '1.21.1', '1.0.5'); // 1.0.5는 neoforge 없음
    expect(r.ok).toBe(false);
  });
  it('clears the pin with version=null', async () => {
    await seed();
    await rebuildModIndex(env, 'hh');
    await setModPin(env, 'hh', 'fabric', '1.21.1', '1.0.4');
    const r = await setModPin(env, 'hh', 'fabric', '1.21.1', null);
    expect(r.ok).toBe(true);
    expect(r.index.targets.fabric['1.21.1'].pinned).toBeNull();
  });
});
