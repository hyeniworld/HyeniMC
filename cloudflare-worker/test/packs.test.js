import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { zipSync } from 'fflate';
import { putJson, putObject, getJson, objectExists } from '../src/admin/r2.js';
import { sha256Hex } from '../src/admin/mods-format.js';
import { handlePacks } from '../src/admin/packs.js';

async function clearBucket() {
  const list = await env.RELEASES.list();
  for (const o of list.objects) await env.RELEASES.delete(o.key);
}
beforeEach(clearBucket);

async function publishReq(id, version, packBytes, extra = {}, query = '') {
  const sha256 = await sha256Hex(new TextEncoder().encode(packBytes));
  const sidecar = { hyenipackId: id, version, sha256, changelog: 'c', breaking: false, ...extra };
  const fd = new FormData();
  fd.set('pack', new File([packBytes], 'pack.hyenipack', { type: 'application/zip' }));
  fd.set('latest', JSON.stringify(sidecar));
  return new Request(`https://example.com/admin/api/modpacks/${id}/versions${query}`, {
    method: 'POST', body: fd,
  });
}
function req(method, path, body) {
  return new Request(`https://example.com${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('GET /admin/api/modpacks/{id}/versions', () => {
  it('rejects malformed percent-encoding in modpack id with 400 (not 500)', async () => {
    const res = await handlePacks(req('GET', '/admin/api/modpacks/%/versions'), env);
    expect(res.status).toBe(400);
  });
});

describe('POST modpacks publish', () => {
  it('verifies sha256 and writes pack + snapshot + latest', async () => {
    const res = await handlePacks(await publishReq('hyenipack', '1.0.0', 'PACKDATA'), env);
    expect(res.status).toBe(201);
    expect(await objectExists(env, 'modpacks/hyenipack/versions/1.0.0/pack.hyenipack')).toBe(true);
    expect(await getJson(env, 'modpacks/hyenipack/versions/1.0.0/latest.json')).toBeTruthy();
    expect((await getJson(env, 'modpacks/hyenipack/latest.json')).version).toBe('1.0.0');
  });

  it('rejects sha256 mismatch', async () => {
    const fd = new FormData();
    fd.set('pack', new File(['REALDATA'], 'pack.hyenipack'));
    fd.set('latest', JSON.stringify({ hyenipackId: 'hyenipack', version: '1.0.0', sha256: 'wrong' }));
    const res = await handlePacks(new Request('https://example.com/admin/api/modpacks/hyenipack/versions', {
      method: 'POST', body: fd,
    }), env);
    expect(res.status).toBe(400);
  });

  it('blocks duplicate version', async () => {
    await handlePacks(await publishReq('hyenipack', '1.0.0', 'PACKDATA'), env);
    const res = await handlePacks(await publishReq('hyenipack', '1.0.0', 'PACKDATA'), env);
    expect(res.status).toBe(409);
  });

  it('rejects when latest field is missing from the form', async () => {
    const fd = new FormData();
    fd.set('pack', new File(['PACKDATA'], 'pack.hyenipack', { type: 'application/zip' }));
    const res = await handlePacks(new Request('https://example.com/admin/api/modpacks/hyenipack/versions', {
      method: 'POST', body: fd,
    }), env);
    expect(res.status).toBe(400);
  });
});

describe('modpacks rollback / edit / delete', () => {
  async function seedTwo() {
    await handlePacks(await publishReq('hyenipack', '1.0.0', 'V1'), env);
    await handlePacks(await publishReq('hyenipack', '1.1.0', 'V2'), env);
  }

  it('rolls back latest to older snapshot', async () => {
    await seedTwo();
    const res = await handlePacks(req('PATCH', '/admin/api/modpacks/hyenipack/latest', { version: '1.0.0' }), env);
    expect(res.status).toBe(200);
    expect((await getJson(env, 'modpacks/hyenipack/latest.json')).version).toBe('1.0.0');
  });

  it('edits breaking flag and mirrors to latest', async () => {
    await seedTwo();
    const res = await handlePacks(req('PATCH', '/admin/api/modpacks/hyenipack/versions/1.1.0', { breaking: true }), env);
    expect(res.status).toBe(200);
    expect((await getJson(env, 'modpacks/hyenipack/latest.json')).breaking).toBe(true);
  });

  it('blocks deleting current latest', async () => {
    await seedTwo();
    const res = await handlePacks(req('DELETE', '/admin/api/modpacks/hyenipack/versions/1.1.0'), env);
    expect(res.status).toBe(409);
  });

  it('deletes a non-latest version', async () => {
    await seedTwo();
    const res = await handlePacks(req('DELETE', '/admin/api/modpacks/hyenipack/versions/1.0.0'), env);
    expect(res.status).toBe(200);
    expect(await objectExists(env, 'modpacks/hyenipack/versions/1.0.0/pack.hyenipack')).toBe(false);
  });
});

describe('GET modpacks version manifest', () => {
  it('unzips .hyenipack and exposes loader/gameVersion/mods', async () => {
    const manifest = {
      formatVersion: 2, hyenipackId: 'hyenipack', name: 'T', version: '1.0.0',
      minecraft: { version: '1.21.1', loaderType: 'neoforge', loaderVersion: '21.1.213' },
      mods: [{ fileName: 'sodium.jar', metadata: { source: 'modrinth', version: '0.5.11' } }],
    };
    const zip = zipSync({ 'hyenipack.json': new TextEncoder().encode(JSON.stringify(manifest)) });
    await env.RELEASES.put('modpacks/hyenipack/versions/1.0.0/pack.hyenipack', zip);

    const res = await handlePacks(req('GET', '/admin/api/modpacks/hyenipack/versions/1.0.0/manifest'), env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.formatVersion).toBe(2);
    expect(body.minecraft.version).toBe('1.21.1');
    expect(body.minecraft.loaderType).toBe('neoforge');
    expect(body.minecraft.loaderVersion).toBe('21.1.213');
    expect(body.mods[0].fileName).toBe('sodium.jar');
    expect(body.mods[0].metadata.version).toBe('0.5.11');
  });

  it('returns 404 for a nonexistent version', async () => {
    const res = await handlePacks(req('GET', '/admin/api/modpacks/hyenipack/versions/9.9.9/manifest'), env);
    expect(res.status).toBe(404);
  });
});
