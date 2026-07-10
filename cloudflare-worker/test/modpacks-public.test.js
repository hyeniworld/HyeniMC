import { env, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { putJson } from '../src/admin/r2.js';

async function clearBucket() {
  const list = await env.RELEASES.list();
  for (const o of list.objects) await env.RELEASES.delete(o.key);
}
beforeEach(clearBucket);

async function seedPack(id, { version = '1.0.0', name = id, hidden = false, minecraft = null } = {}) {
  await putJson(env, `modpacks/${id}/latest.json`,
    { hyenipackId: id, version, sha256: 'x', changelog: '', breaking: false });
  await putJson(env, `modpacks/${id}/meta.json`,
    { name, minecraft, hidden, updatedAt: 'z' });
}

describe('GET /api/v2/modpacks (public list)', () => {
  it('lists visible packs with meta name/minecraft', async () => {
    await seedPack('season3', { name: '시즌3 팩', version: '1.2.0',
      minecraft: { version: '1.21.1', loaderType: 'neoforge', loaderVersion: '21.1.186' } });
    await seedPack('oldpack', { hidden: true });
    const res = await SELF.fetch('https://example.com/api/v2/modpacks');
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.packs.map((p) => p.id);
    expect(ids).toContain('season3');
    expect(ids).not.toContain('oldpack');            // hidden 제외
    const p = body.packs.find((x) => x.id === 'season3');
    expect(p.name).toBe('시즌3 팩');
    expect(p.latestVersion).toBe('1.2.0');
    expect(p.minecraft.loaderType).toBe('neoforge');
  });

  it('falls back to id/null when meta.json is absent (legacy pack)', async () => {
    await putJson(env, 'modpacks/legacy/latest.json',
      { hyenipackId: 'legacy', version: '0.9.0', breaking: false });
    const res = await SELF.fetch('https://example.com/api/v2/modpacks');
    const body = await res.json();
    const p = body.packs.find((x) => x.id === 'legacy');
    expect(p.name).toBe('legacy');
    expect(p.minecraft).toBeNull();
  });
});
