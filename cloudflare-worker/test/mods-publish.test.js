import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach, vi } from 'vitest';
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

  it('rejects when meta field is missing from the form', async () => {
    const fd = new FormData();
    fd.set('jar0', new File(['X'], 'jar0', { type: 'application/java-archive' }));
    const res = await handleMods(new Request('https://example.com/admin/api/mods/hyenihelper/versions', {
      method: 'POST', body: fd,
    }), env);
    expect(res.status).toBe(400);
  });

  it('rejects file entry with a path separator in fileName (before any upload)', async () => {
    const bad = { ...meta, files: [{ ...meta.files[0], fileName: '../evil.jar' }] };
    const res = await handleMods(publishReq('hyenihelper', bad, { jar0: 'JARBYTES' }), env);
    expect(res.status).toBe(400);
    const list = await env.RELEASES.list({ prefix: 'mods/hyenihelper/' });
    expect(list.objects.length).toBe(0);
    expect(await getJson(env, 'mods/registry.json')).toBeNull();
  });

  it('rejects file entry with malformed loader', async () => {
    const bad = { ...meta, files: [{ ...meta.files[0], loader: 'neo/forge' }] };
    const res = await handleMods(publishReq('hyenihelper', bad, { jar0: 'JARBYTES' }), env);
    expect(res.status).toBe(400);
  });

  it('rejects file entry with malformed gameVersion', async () => {
    const bad = { ...meta, files: [{ ...meta.files[0], gameVersion: 'latest' }] };
    const res = await handleMods(publishReq('hyenihelper', bad, { jar0: 'JARBYTES' }), env);
    expect(res.status).toBe(400);
  });

  it('keeps global latest at the higher version when a lower version is backfilled', async () => {
    await handleMods(publishReq('hyenihelper', meta, { jar0: 'JARBYTES' }), env); // 1.0.5
    const older = { ...meta, version: '1.0.3',
      files: [{ ...meta.files[0], fileName: 'hyenihelper-neoforge-1.21.1-1.0.3.jar' }] };
    const res = await handleMods(publishReq('hyenihelper', older, { jar0: 'OLDBYTES' }), env);
    expect(res.status).toBe(201);

    // 전역 latest는 여전히 1.0.5
    expect((await getJson(env, 'mods/hyenihelper/latest.json')).version).toBe('1.0.5');
    // 백필 버전 자체는 저장됨
    expect(await objectExists(env, 'mods/hyenihelper/versions/1.0.3/manifest.json')).toBe(true);
    // 환경별 index의 auto는 최고 버전 1.0.5
    const index = await getJson(env, 'mods/hyenihelper/index.json');
    expect(index.targets.neoforge['1.21.1'].auto).toBe('1.0.5');
  });

  it('advances global latest when a higher version is published', async () => {
    await handleMods(publishReq('hyenihelper', meta, { jar0: 'JARBYTES' }), env); // 1.0.5
    const newer = { ...meta, version: '1.0.6',
      files: [{ ...meta.files[0], fileName: 'hyenihelper-neoforge-1.21.1-1.0.6.jar' }] };
    const res = await handleMods(publishReq('hyenihelper', newer, { jar0: 'NEWBYTES' }), env);
    expect(res.status).toBe(201);
    expect((await getJson(env, 'mods/hyenihelper/latest.json')).version).toBe('1.0.6');
  });

  it('refreshes global latest content on same-version overwrite', async () => {
    await handleMods(publishReq('hyenihelper', meta, { jar0: 'JARBYTES' }), env); // 1.0.5 changelog 'fix'
    const edited = { ...meta, changelog: 'refreshed changelog' };
    const res = await handleMods(publishReq('hyenihelper', edited, { jar0: 'JARBYTES' }, '?overwrite=true'), env);
    expect(res.status).toBe(201);
    expect((await getJson(env, 'mods/hyenihelper/latest.json')).changelog).toBe('refreshed changelog');
  });

  it('rolls back on partial upload failure: latest/registry not written, returns 500', async () => {
    const spy = vi.spyOn(env.RELEASES, 'put').mockRejectedValueOnce(new Error('boom'));
    try {
      const res = await handleMods(publishReq('hyenihelper', meta, { jar0: 'JARBYTES' }), env);
      expect(res.status).toBe(500);
      expect(await getJson(env, 'mods/hyenihelper/latest.json')).toBeNull();
      expect(await getJson(env, 'mods/registry.json')).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('minLoaderVersion optional at publish', () => {
  it('accepts a file without minLoaderVersion; manifest null, registry falls back to 0.0.0', async () => {
    const noMin = {
      ...meta,
      files: [{ ...meta.files[0], minLoaderVersion: null }],
    };
    const res = await handleMods(publishReq('hyenihelper', noMin, { jar0: 'JARBYTES' }), env);
    expect(res.status).toBe(201);

    const manifest = await getJson(env, 'mods/hyenihelper/versions/1.0.5/manifest.json');
    expect(manifest.loaders.neoforge.gameVersions['1.21.1'].minLoaderVersion).toBeNull();

    const registry = await getJson(env, 'mods/registry.json');
    const entry = registry.mods.find((m) => m.id === 'hyenihelper');
    expect(entry.loaders[0].minVersion).toBe('0.0.0'); // 구(Electron) 런처 호환 폴백
  });

  it('normalizes empty-string minLoaderVersion to null in manifest', async () => {
    const emptyMin = {
      ...meta,
      version: '1.0.6',
      files: [{ ...meta.files[0], minLoaderVersion: '', fileName: 'hyenihelper-neoforge-1.21.1-1.0.6.jar' }],
    };
    const res = await handleMods(publishReq('hyenihelper', emptyMin, { jar0: 'JARBYTES' }), env);
    expect(res.status).toBe(201);
    const manifest = await getJson(env, 'mods/hyenihelper/versions/1.0.6/manifest.json');
    expect(manifest.loaders.neoforge.gameVersions['1.21.1'].minLoaderVersion).toBeNull();
  });
});
