import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { getJson } from '../src/admin/r2.js';
import { handleMods } from '../src/admin/mods.js';

async function clearBucket() {
  const list = await env.RELEASES.list();
  for (const o of list.objects) await env.RELEASES.delete(o.key);
}
beforeEach(clearBucket);

function req(method, path, body) {
  return new Request(`https://e.com${path}`, {
    method, headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}
function publishReq(id, version, loader, gv) {
  const fd = new FormData();
  fd.set('meta', JSON.stringify({ modId: id, name: 'HH', version, category: 'required', changelog: '',
    files: [{ loader, gameVersion: gv, fileField: 'jar0', fileName: 'a.jar', minLoaderVersion: '1', maxLoaderVersion: null, dependencies: {} }] }));
  fd.set('jar0', new File(['x'], 'a.jar', { type: 'application/java-archive' }));
  return new Request(`https://e.com/admin/api/mods/${id}/versions`, { method: 'POST', body: fd });
}

describe('index maintained on publish + GET index', () => {
  it('publish builds index; GET returns it', async () => {
    await handleMods(publishReq('hh', '1.0.4', 'neoforge', '1.21.1'), env);
    const res = await handleMods(req('GET', '/admin/api/mods/hh/index'), env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.targets.neoforge['1.21.1'].auto).toBe('1.0.4');
  });
  it('GET index for unknown mod returns empty targets', async () => {
    const res = await handleMods(req('GET', '/admin/api/mods/none/index'), env);
    expect(res.status).toBe(200);
    expect((await res.json()).targets).toEqual({});
  });
});

describe('boundary guards (safeDecode + null body)', () => {
  it('GET index with malformed %-escape id → 400 (not 500)', async () => {
    const res = await handleMods(req('GET', '/admin/api/mods/%zz/index'), env);
    expect(res.status).toBe(400);
  });
  it('PATCH pins with malformed %-escape id → 400 (not 500)', async () => {
    const res = await handleMods(
      new Request('https://e.com/admin/api/mods/%zz/pins', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loader: 'neoforge', gameVersion: '1.21.1' }),
      }), env);
    expect(res.status).toBe(400);
  });
  it('PATCH pins with JSON null body → 400 (not 500)', async () => {
    const res = await handleMods(
      new Request('https://e.com/admin/api/mods/hh/pins', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: 'null',
      }), env);
    expect(res.status).toBe(400);
  });
});

describe('PATCH pins', () => {
  it('pins a valid version and rejects an invalid one', async () => {
    await handleMods(publishReq('hh', '1.0.4', 'neoforge', '1.21.1'), env);
    const ok = await handleMods(req('PATCH', '/admin/api/mods/hh/pins',
      { loader: 'neoforge', gameVersion: '1.21.1', version: '1.0.4' }), env);
    expect(ok.status).toBe(200);
    expect((await getJson(env, 'mods/hh/index.json')).targets.neoforge['1.21.1'].pinned).toBe('1.0.4');

    const bad = await handleMods(req('PATCH', '/admin/api/mods/hh/pins',
      { loader: 'neoforge', gameVersion: '1.21.1', version: '9.9.9' }), env);
    expect(bad.status).toBe(400);
  });
});
