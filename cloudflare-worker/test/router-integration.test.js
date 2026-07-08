import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { putJson } from '../src/admin/r2.js';
import { dispatchAdmin } from '../src/admin/router.js';

async function clearBucket() {
  const list = await env.RELEASES.list();
  for (const o of list.objects) await env.RELEASES.delete(o.key);
}
beforeEach(clearBucket);

describe('dispatchAdmin', () => {
  it('routes mods list', async () => {
    await putJson(env, 'mods/registry.json', { version: '2.0', lastUpdated: 'x', mods: [{ id: 'a' }] });
    const res = await dispatchAdmin(new Request('https://e.com/admin/api/mods'), env);
    expect(res.status).toBe(200);
  });

  it('routes modpacks list', async () => {
    const res = await dispatchAdmin(new Request('https://e.com/admin/api/modpacks'), env);
    expect(res.status).toBe(200);
  });

  it('registry rebuild endpoint', async () => {
    await putJson(env, 'mods/hh/latest.json', {
      modId: 'hh', name: 'HH', version: '1.0.0', gameVersions: ['1.21.1'],
      loaders: {}, category: 'required',
    });
    const res = await dispatchAdmin(new Request('https://e.com/admin/api/registry/rebuild', { method: 'POST' }), env);
    expect(res.status).toBe(200);
    expect((await res.json()).count).toBe(1);
  });

  it('unknown route 404', async () => {
    const res = await dispatchAdmin(new Request('https://e.com/admin/api/zzz'), env);
    expect(res.status).toBe(404);
  });
});
