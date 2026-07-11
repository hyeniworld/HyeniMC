import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getJson, putJson, putObject, listVersions, listPrefixes, deletePrefix, objectExists,
} from '../src/admin/r2.js';

async function clearBucket() {
  const list = await env.RELEASES.list();
  for (const o of list.objects) await env.RELEASES.delete(o.key);
}

beforeEach(clearBucket);

describe('r2 helpers', () => {
  it('putJson/getJson round-trips', async () => {
    await putJson(env, 'mods/x/latest.json', { version: '1.0.0' });
    expect(await getJson(env, 'mods/x/latest.json')).toEqual({ version: '1.0.0' });
  });

  it('getJson returns null when missing', async () => {
    expect(await getJson(env, 'nope.json')).toBeNull();
  });

  it('objectExists reflects presence', async () => {
    expect(await objectExists(env, 'a.bin')).toBe(false);
    await putObject(env, 'a.bin', new Uint8Array([1, 2, 3]), 'application/octet-stream');
    expect(await objectExists(env, 'a.bin')).toBe(true);
  });

  it('listVersions extracts sorted unique versions', async () => {
    await putObject(env, 'mods/x/versions/1.0.0/manifest.json', '{}', 'application/json');
    await putObject(env, 'mods/x/versions/1.2.0/manifest.json', '{}', 'application/json');
    await putObject(env, 'mods/x/versions/1.0.0/neoforge/1.21.1/a.jar', 'x', 'application/java-archive');
    expect(await listVersions(env, 'mods/x/versions/')).toEqual(['1.2.0', '1.0.0']);
  });

  it('listPrefixes returns child segment names', async () => {
    await putObject(env, 'mods/alpha/latest.json', '{}', 'application/json');
    await putObject(env, 'mods/beta/latest.json', '{}', 'application/json');
    const names = (await listPrefixes(env, 'mods/')).sort();
    expect(names).toEqual(['alpha', 'beta']);
  });

  it('deletePrefix removes all matching objects', async () => {
    await putObject(env, 'mods/x/versions/1.0.0/a.jar', 'x', 'application/java-archive');
    await putObject(env, 'mods/x/versions/1.0.0/manifest.json', '{}', 'application/json');
    const n = await deletePrefix(env, 'mods/x/versions/1.0.0/');
    expect(n).toBe(2);
    expect(await objectExists(env, 'mods/x/versions/1.0.0/a.jar')).toBe(false);
  });
});
