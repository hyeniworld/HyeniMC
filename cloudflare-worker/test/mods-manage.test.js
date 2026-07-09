import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { putJson, getJson, putObject, objectExists } from '../src/admin/r2.js';
import { handleMods } from '../src/admin/mods.js';

async function clearBucket() {
  const list = await env.RELEASES.list();
  for (const o of list.objects) await env.RELEASES.delete(o.key);
}
beforeEach(clearBucket);

function req(method, path, body) {
  return new Request(`https://example.com${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}

function manifest(version, extra = {}) {
  return {
    modId: 'hh', name: 'HH', version, releaseDate: '2025-01-01T00:00:00Z',
    changelog: 'c' + version, gameVersions: ['1.21.1'],
    loaders: { neoforge: { gameVersions: { '1.21.1': {
      file: 'a.jar', sha256: 'x', size: 1,
      minLoaderVersion: '21.1.200', maxLoaderVersion: null,
      downloadPath: `mods/hh/versions/${version}/neoforge/1.21.1/a.jar`, dependencies: {},
    } } } },
    category: 'required', ...extra,
  };
}

async function seedTwoVersions() {
  await putObject(env, 'mods/hh/versions/1.0.0/neoforge/1.21.1/a.jar', 'x', 'application/java-archive');
  await putJson(env, 'mods/hh/versions/1.0.0/manifest.json', manifest('1.0.0'));
  await putObject(env, 'mods/hh/versions/1.1.0/neoforge/1.21.1/a.jar', 'x', 'application/java-archive');
  await putJson(env, 'mods/hh/versions/1.1.0/manifest.json', manifest('1.1.0'));
  await putJson(env, 'mods/hh/latest.json', manifest('1.1.0'));
}

describe('PATCH latest (rollback)', () => {
  it('points latest to an older version', async () => {
    await seedTwoVersions();
    const res = await handleMods(req('PATCH', '/admin/api/mods/hh/latest', { version: '1.0.0' }), env);
    expect(res.status).toBe(200);
    expect((await getJson(env, 'mods/hh/latest.json')).version).toBe('1.0.0');
    expect((await getJson(env, 'mods/registry.json')).mods[0].latestVersion).toBe('1.0.0');
  });

  it('404 for unknown version', async () => {
    await seedTwoVersions();
    const res = await handleMods(req('PATCH', '/admin/api/mods/hh/latest', { version: '9.9.9' }), env);
    expect(res.status).toBe(404);
  });
});

describe('PATCH version (meta edit)', () => {
  it('edits changelog and mirrors to latest when current', async () => {
    await seedTwoVersions();
    const res = await handleMods(req('PATCH', '/admin/api/mods/hh/versions/1.1.0', { changelog: '수정됨' }), env);
    expect(res.status).toBe(200);
    expect((await getJson(env, 'mods/hh/versions/1.1.0/manifest.json')).changelog).toBe('수정됨');
    expect((await getJson(env, 'mods/hh/latest.json')).changelog).toBe('수정됨');
  });

  it('applies a per-target edit to ONLY the named (loader,gameVersion)', async () => {
    const twoLoader = {
      modId: 'hh', name: 'HH', version: '1.0.0', releaseDate: '2025-01-01T00:00:00Z',
      changelog: 'c1.0.0', gameVersions: ['1.21.1'], category: 'required',
      loaders: {
        neoforge: { gameVersions: { '1.21.1': { file: 'nf.jar', sha256: 'a', size: 1, minLoaderVersion: '21.1.200', maxLoaderVersion: null, downloadPath: 'p', dependencies: {} } } },
        fabric:   { gameVersions: { '1.21.1': { file: 'fa.jar', sha256: 'b', size: 2, minLoaderVersion: '0.16.0', maxLoaderVersion: null, downloadPath: 'p', dependencies: { fabricapi: '>=0.100' } } } },
      },
    };
    // 1.0.0은 latest가 아님(latest는 1.1.0) → 편집 가능
    await putJson(env, 'mods/hh/versions/1.0.0/manifest.json', twoLoader);
    await putJson(env, 'mods/hh/latest.json', manifest('1.1.0'));

    const res = await handleMods(
      req('PATCH', '/admin/api/mods/hh/versions/1.0.0', {
        targets: [{ loader: 'neoforge', gameVersion: '1.21.1', minLoaderVersion: '21.1.999' }],
      }),
      env,
    );
    expect(res.status).toBe(200);

    const saved = await getJson(env, 'mods/hh/versions/1.0.0/manifest.json');
    // 지정한 타깃만 변경
    expect(saved.loaders.neoforge.gameVersions['1.21.1'].minLoaderVersion).toBe('21.1.999');
    // 다른 타깃은 그대로
    expect(saved.loaders.fabric.gameVersions['1.21.1'].minLoaderVersion).toBe('0.16.0');
    expect(saved.loaders.fabric.gameVersions['1.21.1'].dependencies).toEqual({ fabricapi: '>=0.100' });
  });
});

describe('DELETE version', () => {
  it('blocks deleting current latest', async () => {
    await seedTwoVersions();
    const res = await handleMods(req('DELETE', '/admin/api/mods/hh/versions/1.1.0'), env);
    expect(res.status).toBe(409);
  });

  it('deletes a non-latest version', async () => {
    await seedTwoVersions();
    const res = await handleMods(req('DELETE', '/admin/api/mods/hh/versions/1.0.0'), env);
    expect(res.status).toBe(200);
    expect(await objectExists(env, 'mods/hh/versions/1.0.0/manifest.json')).toBe(false);
  });
});
