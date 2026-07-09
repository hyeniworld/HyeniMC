import { env, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';

async function clearBucket() {
  const list = await env.RELEASES.list();
  for (const o of list.objects) await env.RELEASES.delete(o.key);
}
beforeEach(clearBucket);

async function put(key, obj) {
  await env.RELEASES.put(key, JSON.stringify(obj), { httpMetadata: { contentType: 'application/json' } });
}
function manifest(version, loaders) {
  return { modId: 'hh', name: 'HH', version, releaseDate: '2025-01-01T00:00:00Z', changelog: '', gameVersions: [], loaders, category: 'required' };
}
const cell = (gv) => ({ [gv]: { file: 'a.jar', sha256: 'x', size: 1, minLoaderVersion: '1', maxLoaderVersion: null, downloadPath: `mods/hh/versions/x/${gv}/a.jar`, dependencies: {} } });

describe('GET /api/v2/mods/{id}/latest with env query', () => {
  beforeEach(async () => {
    await put('mods/hh/versions/1.0.4/manifest.json', manifest('1.0.4', { neoforge: { gameVersions: cell('1.21.1') } }));
    await put('mods/hh/versions/1.0.11/manifest.json', manifest('1.0.11', { fabric: { gameVersions: cell('1.21.1') } }));
    await put('mods/hh/latest.json', manifest('1.0.11', { fabric: { gameVersions: cell('1.21.1') } }));
    await put('mods/hh/index.json', { version: '1', updatedAt: 'x', targets: {
      neoforge: { '1.21.1': { auto: '1.0.4', pinned: null } },
      fabric: { '1.21.1': { auto: '1.0.11', pinned: null } },
    } });
  });

  it('resolves neoforge/1.21.1 to 1.0.4 (not the global latest 1.0.11)', async () => {
    const res = await SELF.fetch('https://e.com/api/v2/mods/hh/latest?gameVersion=1.21.1&loader=neoforge');
    expect(res.status).toBe(200);
    expect((await res.json()).version).toBe('1.0.4');
  });

  it('resolves fabric/1.21.1 to 1.0.11', async () => {
    const res = await SELF.fetch('https://e.com/api/v2/mods/hh/latest?gameVersion=1.21.1&loader=fabric');
    expect((await res.json()).version).toBe('1.0.11');
  });

  it('404 when the env has no target', async () => {
    const res = await SELF.fetch('https://e.com/api/v2/mods/hh/latest?gameVersion=9.9.9&loader=neoforge');
    expect(res.status).toBe(404);
  });

  it('no query → returns the global latest.json (backward compat)', async () => {
    const res = await SELF.fetch('https://e.com/api/v2/mods/hh/latest');
    expect(res.status).toBe(200);
    expect((await res.json()).version).toBe('1.0.11');
  });

  it('query present but no index → falls back to global latest', async () => {
    await env.RELEASES.delete('mods/hh/index.json');
    const res = await SELF.fetch('https://e.com/api/v2/mods/hh/latest?gameVersion=1.21.1&loader=neoforge');
    expect(res.status).toBe(200);
    expect((await res.json()).version).toBe('1.0.11');
  });

  it('index resolves but manifest missing → 404 (never the wrong-loader global latest)', async () => {
    // 인덱스는 neoforge/1.21.1 → 1.0.4로 해석하지만 그 manifest가 사라진 상태
    await env.RELEASES.delete('mods/hh/versions/1.0.4/manifest.json');
    const res = await SELF.fetch('https://e.com/api/v2/mods/hh/latest?gameVersion=1.21.1&loader=neoforge');
    expect(res.status).toBe(404);
    // 글로벌 latest(fabric 1.0.11)로 조용히 폴백하지 않는다
    expect((await res.json()).error).toBe('No release for this environment');
  });
});
