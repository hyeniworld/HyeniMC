import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { getJson, objectExists } from '../src/admin/r2.js';
import { handleMods } from '../src/admin/mods.js';

async function clearBucket() {
  const list = await env.RELEASES.list();
  for (const o of list.objects) await env.RELEASES.delete(o.key);
}
beforeEach(clearBucket);

function publishReq(id, meta, fileParts, query = '') {
  const fd = new FormData();
  fd.set('meta', JSON.stringify(meta));
  for (const [name, bytes] of Object.entries(fileParts)) {
    fd.set(name, new File([bytes], name, { type: 'application/java-archive' }));
  }
  return new Request(`https://example.com/admin/api/mods/${id}/versions${query}`, {
    method: 'POST', body: fd,
  });
}

const meta = {
  modId: 'hyenihelper', name: 'HyeniHelper', version: '1.0.5',
  category: 'required', changelog: 'fix',
  files: [{
    loader: 'neoforge', gameVersion: '1.21.1', fileField: 'jar0',
    fileName: 'hyenihelper-neoforge-1.21.1-1.0.5.jar',
    minLoaderVersion: '21.1.200', maxLoaderVersion: null, dependencies: {},
  }],
};

describe('POST /admin/api/mods/{id}/versions', () => {
  it('uploads jar, writes manifest/latest/registry', async () => {
    const res = await handleMods(publishReq('hyenihelper', meta, { jar0: 'JARBYTES' }), env);
    expect(res.status).toBe(201);

    expect(await objectExists(env,
      'mods/hyenihelper/versions/1.0.5/neoforge/1.21.1/hyenihelper-neoforge-1.21.1-1.0.5.jar')).toBe(true);

    const manifest = await getJson(env, 'mods/hyenihelper/versions/1.0.5/manifest.json');
    expect(manifest.version).toBe('1.0.5');
    expect(manifest.loaders.neoforge.gameVersions['1.21.1'].size).toBe(8);

    const latest = await getJson(env, 'mods/hyenihelper/latest.json');
    expect(latest).toEqual(manifest);

    const registry = await getJson(env, 'mods/registry.json');
    expect(registry.mods.find((m) => m.id === 'hyenihelper').latestVersion).toBe('1.0.5');
  });

  it('blocks duplicate version without overwrite', async () => {
    await handleMods(publishReq('hyenihelper', meta, { jar0: 'JARBYTES' }), env);
    const res = await handleMods(publishReq('hyenihelper', meta, { jar0: 'JARBYTES' }), env);
    expect(res.status).toBe(409);
  });

  it('allows overwrite with ?overwrite=true', async () => {
    await handleMods(publishReq('hyenihelper', meta, { jar0: 'JARBYTES' }), env);
    const res = await handleMods(publishReq('hyenihelper', meta, { jar0: 'NEWBYTES' }, '?overwrite=true'), env);
    expect(res.status).toBe(201);
  });

  it('rejects invalid version', async () => {
    const bad = { ...meta, version: '1.0' };
    const res = await handleMods(publishReq('hyenihelper', bad, { jar0: 'X' }), env);
    expect(res.status).toBe(400);
  });

  it('rejects when a declared file part is missing', async () => {
    const res = await handleMods(publishReq('hyenihelper', meta, {}), env);
    expect(res.status).toBe(400);
  });
});
