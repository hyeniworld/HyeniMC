import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { putJson } from '../src/admin/r2.js';
import { handleMods } from '../src/admin/mods.js';

async function clearBucket() {
  const list = await env.RELEASES.list();
  for (const o of list.objects) await env.RELEASES.delete(o.key);
}
beforeEach(clearBucket);

function req(method, path) {
  return new Request(`https://example.com${path}`, { method });
}

const latest = {
  modId: 'hyenihelper', name: 'HyeniHelper', version: '1.0.5',
  releaseDate: '2025-11-14T10:40:00Z', changelog: 'x',
  gameVersions: ['1.21.1'], loaders: {}, category: 'required',
};

describe('GET /admin/api/mods', () => {
  it('returns registry when present', async () => {
    await putJson(env, 'mods/registry.json', {
      version: '2.0', lastUpdated: 'x',
      mods: [{ id: 'hyenihelper', latestVersion: '1.0.5' }],
    });
    const res = await handleMods(req('GET', '/admin/api/mods'), env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mods[0].id).toBe('hyenihelper');
  });

  it('returns empty mods when registry absent', async () => {
    const res = await handleMods(req('GET', '/admin/api/mods'), env);
    expect(res.status).toBe(200);
    expect((await res.json()).mods).toEqual([]);
  });
});

describe('GET /admin/api/mods/{id}/versions', () => {
  it('lists versions with manifest summaries', async () => {
    await putJson(env, 'mods/hyenihelper/versions/1.0.5/manifest.json', latest);
    await putJson(env, 'mods/hyenihelper/versions/1.0.4/manifest.json', { ...latest, version: '1.0.4' });
    const res = await handleMods(req('GET', '/admin/api/mods/hyenihelper/versions'), env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.versions.map((v) => v.version)).toEqual(['1.0.5', '1.0.4']);
  });

  it('rejects invalid mod id', async () => {
    const res = await handleMods(req('GET', '/admin/api/mods/Bad_ID/versions'), env);
    expect(res.status).toBe(400);
  });
});
