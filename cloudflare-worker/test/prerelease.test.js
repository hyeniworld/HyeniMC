import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { getJson, putJson, compareVersions, isPrerelease, listVersions } from '../src/admin/r2.js';
import { handleMods } from '../src/admin/mods.js';
import { rebuildModIndex, resolveFromIndex, setModPin } from '../src/admin/mod-index.js';

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

const metaFor = (version) => ({
  modId: 'hyenihelper', name: 'HyeniHelper', version,
  category: 'required', changelog: 'test',
  files: [{
    loader: 'neoforge', gameVersion: '1.21.1', fileField: 'jar0',
    fileName: `hyenihelper-neoforge-1.21.1-${version}.jar`,
    minLoaderVersion: '21.1.200', maxLoaderVersion: null, dependencies: {},
  }],
});

describe('prerelease version format (x.y.z-(alpha|beta|pre)NNN)', () => {
  it('compareVersions: prerelease < same-x.y.z release, label/number ordering', () => {
    expect(compareVersions('1.2.3-beta001', '1.2.3')).toBeLessThan(0);
    expect(compareVersions('1.2.3', '1.2.3-pre001')).toBeGreaterThan(0);
    expect(compareVersions('1.2.3-alpha001', '1.2.3-beta001')).toBeLessThan(0);
    expect(compareVersions('1.2.3-beta001', '1.2.3-pre001')).toBeLessThan(0);
    expect(compareVersions('1.2.3-beta001', '1.2.3-beta002')).toBeLessThan(0);
    expect(compareVersions('1.2.4-alpha001', '1.2.3')).toBeGreaterThan(0);
    // 기존 x.y.z 동작 유지
    expect(compareVersions('1.21.2', '1.21.11')).toBeLessThan(0);
    expect(compareVersions('1.0.5', '1.0.5')).toBe(0);
  });

  it('isPrerelease detects only the supported suffix form', () => {
    expect(isPrerelease('1.2.3-beta001')).toBe(true);
    expect(isPrerelease('1.2.3-pre999')).toBe(true);
    expect(isPrerelease('1.2.3')).toBe(false);
    expect(isPrerelease('1.0-SNAPSHOT')).toBe(false); // 레거시는 형식 밖
  });

  it('publish accepts prerelease but does NOT promote global latest', async () => {
    let res = await handleMods(publishReq('hyenihelper', metaFor('1.0.5'), { jar0: 'STABLE' }), env);
    expect(res.status).toBe(201);
    res = await handleMods(publishReq('hyenihelper', metaFor('1.0.6-beta001'), { jar0: 'BETA' }), env);
    expect(res.status).toBe(201);

    // 전역 latest는 정식 1.0.5 유지 (구 런처 보호)
    const latest = await getJson(env, 'mods/hyenihelper/latest.json');
    expect(latest.version).toBe('1.0.5');
    // 버전 스냅샷 자체는 저장됨 (버전 목록 스캔에 잡힘)
    const versions = await listVersions(env, 'mods/hyenihelper/versions/');
    expect(versions).toContain('1.0.6-beta001');
  });

  it('index auto excludes prerelease; pin exposes it explicitly', async () => {
    await handleMods(publishReq('hyenihelper', metaFor('1.0.5'), { jar0: 'STABLE' }), env);
    await handleMods(publishReq('hyenihelper', metaFor('1.0.6-beta001'), { jar0: 'BETA' }), env);

    const idx = await getJson(env, 'mods/hyenihelper/index.json');
    // auto는 프리릴리즈를 무시하고 정식 최신
    expect(idx.targets.neoforge['1.21.1'].auto).toBe('1.0.5');
    expect(resolveFromIndex(idx, 'neoforge', '1.21.1')).toBe('1.0.5');

    // 핀은 허용 — 명시적 전원 배포
    const pin = await setModPin(env, 'hyenihelper', 'neoforge', '1.21.1', '1.0.6-beta001');
    expect(pin.ok).toBe(true);
    expect(resolveFromIndex(pin.index, 'neoforge', '1.21.1')).toBe('1.0.6-beta001');
  });

  it('prerelease-only target has auto=null (not exposed until pinned)', async () => {
    await handleMods(publishReq('hyenihelper', metaFor('1.0.6-beta001'), { jar0: 'BETA' }), env);
    const idx = await getJson(env, 'mods/hyenihelper/index.json');
    expect(idx.targets.neoforge['1.21.1'].auto).toBeNull();
    expect(resolveFromIndex(idx, 'neoforge', '1.21.1')).toBeNull();
  });

  it('rejects malformed prerelease suffixes', async () => {
    for (const bad of ['1.0.6-beta1', '1.0.6-beta0001', '1.0.6-rc001', '1.0.6-SNAPSHOT', '1.0.6beta001']) {
      const res = await handleMods(publishReq('hyenihelper', metaFor(bad), { jar0: 'X' }), env);
      expect(res.status, bad).toBe(400);
    }
  });
});
