import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
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

  it('keeps public latest at the higher version when a lower version is backfilled', async () => {
    await handlePacks(await publishReq('hyenipack', '1.2.0', 'HIGH'), env);
    const res = await handlePacks(await publishReq('hyenipack', '1.1.0', 'LOW'), env);
    expect(res.status).toBe(201);
    // 공개 latest는 여전히 높은 버전
    expect((await getJson(env, 'modpacks/hyenipack/latest.json')).version).toBe('1.2.0');
    // 낮은 버전 스냅샷은 저장됨
    expect(await objectExists(env, 'modpacks/hyenipack/versions/1.1.0/pack.hyenipack')).toBe(true);
    expect((await getJson(env, 'modpacks/hyenipack/versions/1.1.0/latest.json')).version).toBe('1.1.0');
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

describe('GET /admin/api/modpacks', () => {
  it('exposes minecraft (loader/gameVersion) per pack for filtering', async () => {
    const manifest = {
      formatVersion: 2, hyenipackId: 'hyenipack', name: 'T', version: '1.0.0',
      minecraft: { version: '1.21.1', loaderType: 'neoforge', loaderVersion: '21.1.213' },
    };
    const zip = zipSync({ 'hyenipack.json': new TextEncoder().encode(JSON.stringify(manifest)) });
    await env.RELEASES.put('modpacks/hyenipack/versions/1.0.0/pack.hyenipack', zip);
    await putJson(env, 'modpacks/hyenipack/latest.json', {
      hyenipackId: 'hyenipack', version: '1.0.0', sha256: 'x', breaking: false,
    });

    const res = await handlePacks(req('GET', '/admin/api/modpacks'), env);
    expect(res.status).toBe(200);
    const { packs } = await res.json();
    const pack = packs.find((p) => p.id === 'hyenipack');
    expect(pack).toBeTruthy();
    expect(pack.minecraft.loaderType).toBe('neoforge');
    expect(pack.minecraft.version).toBe('1.21.1');
  });

  it('keeps a pack with a missing .hyenipack in the list with minecraft: null', async () => {
    await putJson(env, 'modpacks/broken/latest.json', {
      hyenipackId: 'broken', version: '1.0.0', sha256: 'x', breaking: false,
    });

    const res = await handlePacks(req('GET', '/admin/api/modpacks'), env);
    expect(res.status).toBe(200);
    const { packs } = await res.json();
    const pack = packs.find((p) => p.id === 'broken');
    expect(pack).toBeTruthy();
    expect(pack.minecraft).toBe(null);
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

  it('serves the sidecar manifest written at publish (without reading the pack)', async () => {
    await handlePacks(await publishZipReq('scpack', '1.0.0', {
      formatVersion: 2, hyenipackId: 'scpack', name: 'SC', version: '1.0.0',
      minecraft: { version: '1.21.1', loaderType: 'neoforge', loaderVersion: '21.1.213' },
      mods: [{ fileName: 'sodium.jar', metadata: { source: 'modrinth', version: '0.5.11' } }],
    }), env);
    // 게시가 버전 사이드카(manifest.json)를 저장했는지
    const sc = await getJson(env, 'modpacks/scpack/versions/1.0.0/manifest.json');
    expect(sc.mods[0].fileName).toBe('sodium.jar');
    // 팩을 지워도 사이드카로 조회됨 — 대용량 팩을 서버에서 읽지 않는다는 증명
    await env.RELEASES.delete('modpacks/scpack/versions/1.0.0/pack.hyenipack');
    const res = await handlePacks(req('GET', '/admin/api/modpacks/scpack/versions/1.0.0/manifest'), env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mods[0].fileName).toBe('sodium.jar');
    expect(body.minecraft.loaderType).toBe('neoforge');
  });

  it('returns 404 for a nonexistent version', async () => {
    const res = await handlePacks(req('GET', '/admin/api/modpacks/hyenipack/versions/9.9.9/manifest'), env);
    expect(res.status).toBe(404);
  });
});

function packZip(manifest) {
  return zipSync({ 'hyenipack.json': strToU8(JSON.stringify(manifest)) });
}
async function publishZipReq(id, version, manifest, query = '') {
  const bytes = packZip(manifest);
  const sha256 = await sha256Hex(bytes);
  const sidecar = { hyenipackId: id, version, sha256, changelog: 'c', breaking: false };
  const fd = new FormData();
  fd.set('pack', new File([bytes], 'pack.hyenipack', { type: 'application/zip' }));
  fd.set('latest', JSON.stringify(sidecar));
  return new Request(`https://example.com/admin/api/modpacks/${id}/versions${query}`, {
    method: 'POST', body: fd,
  });
}

describe('pack meta.json', () => {
  const mani = (v) => ({
    formatVersion: 1, hyenipackId: 'metapack', name: '메타팩', version: v,
    minecraft: { version: '1.21.1', loaderType: 'neoforge', loaderVersion: '21.1.186' },
    mods: [], breaking: false,
  });

  it('publish writes meta (name/minecraft from zip, hidden=false)', async () => {
    const res = await handlePacks(await publishZipReq('metapack', '1.0.0', mani('1.0.0')), env);
    expect(res.status).toBe(201);
    const meta = await getJson(env, 'modpacks/metapack/meta.json');
    expect(meta.name).toBe('메타팩');
    expect(meta.minecraft.loaderType).toBe('neoforge');
    expect(meta.hidden).toBe(false);
  });

  it('publish preserves hidden=true', async () => {
    await putJson(env, 'modpacks/metapack/meta.json',
      { name: 'x', minecraft: null, hidden: true, updatedAt: 'z' });
    await handlePacks(await publishZipReq('metapack', '1.0.0', mani('1.0.0')), env);
    const meta = await getJson(env, 'modpacks/metapack/meta.json');
    expect(meta.hidden).toBe(true);        // 게시가 비공개를 풀지 않음
    expect(meta.name).toBe('메타팩');       // name은 갱신
  });

  it('backfill(lower version) does not change meta name from newer latest', async () => {
    await handlePacks(await publishZipReq('metapack', '1.2.0',
      { ...mani('1.2.0'), name: '신버전팩' }), env);
    await handlePacks(await publishZipReq('metapack', '1.0.0',
      { ...mani('1.0.0'), name: '구버전팩' }), env);
    const meta = await getJson(env, 'modpacks/metapack/meta.json');
    expect(meta.name).toBe('신버전팩');     // 공개 latest 기준 유지
  });

  it('rollback updates meta from target version manifest', async () => {
    await handlePacks(await publishZipReq('metapack', '1.0.0',
      { ...mani('1.0.0'), name: '팩v1' }), env);
    await handlePacks(await publishZipReq('metapack', '1.1.0',
      { ...mani('1.1.0'), name: '팩v2' }), env);
    const res = await handlePacks(req('PATCH', '/admin/api/modpacks/metapack/latest',
      { version: '1.0.0' }), env);
    expect(res.status).toBe(200);
    const meta = await getJson(env, 'modpacks/metapack/meta.json');
    expect(meta.name).toBe('팩v1');
  });

  it('legacy pack(meta absent): backfill seeds meta from public latest, not backfilled version', async () => {
    // meta 없는 레거시 상태 재현: 1.2.0을 게시한 뒤 meta만 삭제
    await handlePacks(await publishZipReq('legacy2', '1.2.0', { ...mani('1.2.0'), hyenipackId: 'legacy2', name: '최신이름' }), env);
    await env.RELEASES.delete('modpacks/legacy2/meta.json');
    // 하위 버전 백필
    await handlePacks(await publishZipReq('legacy2', '1.0.0', { ...mani('1.0.0'), hyenipackId: 'legacy2', name: '옛이름' }), env);
    const meta = await getJson(env, 'modpacks/legacy2/meta.json');
    expect(meta.name).toBe('최신이름');   // 공개 latest(1.2.0) 기준
  });

  it('edit and delete do not touch meta.hidden', async () => {
    await handlePacks(await publishZipReq('vispack2', '1.0.0', { ...mani('1.0.0'), hyenipackId: 'vispack2' }), env);
    await handlePacks(await publishZipReq('vispack2', '1.1.0', { ...mani('1.1.0'), hyenipackId: 'vispack2' }), env);
    await handlePacks(req('PATCH', '/admin/api/modpacks/vispack2/visibility', { hidden: true }), env);
    // 편집(비-latest 버전) 후에도 hidden 유지
    await handlePacks(req('PATCH', '/admin/api/modpacks/vispack2/versions/1.0.0', { changelog: 'edited' }), env);
    expect((await getJson(env, 'modpacks/vispack2/meta.json')).hidden).toBe(true);
    // 비-latest 버전 삭제 후에도 hidden 유지
    await handlePacks(req('DELETE', '/admin/api/modpacks/vispack2/versions/1.0.0'), env);
    expect((await getJson(env, 'modpacks/vispack2/meta.json')).hidden).toBe(true);
  });
});

// miniflare는 R2 최소 파트 크기(5MiB, 마지막 파트 제외)를 강제하고, vitest-pool-workers의
// 스토리지 격리 스냅샷은 5MiB 객체에서 불안정해진다. 우리 핸들러는 parts 배열을 그대로
// R2.complete()에 넘길 뿐(파트 수 무관, 병합은 R2 책임)이므로, 마지막 파트 예외를 이용해
// 작은 단일 파트로 init→part→complete→사후 sha256→마무리 전 경로를 커버한다.
describe('modpacks multipart upload (init/part/complete)', () => {
  async function initReq(id, version, sha256, overwrite) {
    return new Request(`https://example.com/admin/api/modpacks/${id}/versions/upload-init`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version, sha256, ...(overwrite ? { overwrite: true } : {}) }),
    });
  }
  function partReq(id, uploadId, version, part, bytes) {
    const qs = new URLSearchParams({ uploadId, version, part: String(part) });
    return new Request(`https://example.com/admin/api/modpacks/${id}/versions/upload-part?${qs}`, {
      method: 'PUT', body: bytes,
    });
  }
  function completeReq(id, body) {
    return new Request(`https://example.com/admin/api/modpacks/${id}/versions/upload-complete`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
  }

  it('init → part → complete: verifies sha256, writes snapshot/latest/meta from packMeta', async () => {
    const bytes = strToU8('BIGPACKBYTES');
    const sha256 = await sha256Hex(bytes);
    const initRes = await handlePacks(await initReq('bigpack', '1.0.0', sha256), env);
    expect(initRes.status).toBe(200);
    const { uploadId, key } = await initRes.json();
    expect(key).toBe('modpacks/bigpack/versions/1.0.0/pack.hyenipack');

    const p1 = await (await handlePacks(partReq('bigpack', uploadId, '1.0.0', 1, bytes), env)).json();
    expect(p1.partNumber).toBe(1);
    expect(typeof p1.etag).toBe('string');

    const res = await handlePacks(completeReq('bigpack', {
      uploadId,
      parts: [{ partNumber: p1.partNumber, etag: p1.etag }],
      latest: { hyenipackId: 'bigpack', version: '1.0.0', sha256, changelog: 'c', breaking: false },
      packMeta: { name: '대형팩', minecraft: { version: '1.21.1', loaderType: 'neoforge', loaderVersion: '21.1.1' }, mods: [{ fileName: 'lithium.jar', metadata: { source: 'modrinth', version: '0.13' } }] },
    }), env);
    expect(res.status).toBe(201);

    const stored = await env.RELEASES.get('modpacks/bigpack/versions/1.0.0/pack.hyenipack');
    expect(new Uint8Array(await stored.arrayBuffer())).toEqual(bytes);
    expect(await getJson(env, 'modpacks/bigpack/versions/1.0.0/latest.json')).toBeTruthy();
    expect((await getJson(env, 'modpacks/bigpack/latest.json')).version).toBe('1.0.0');
    const meta = await getJson(env, 'modpacks/bigpack/meta.json');
    expect(meta.name).toBe('대형팩');
    expect(meta.minecraft.loaderType).toBe('neoforge');
    // 멀티파트도 packMeta.mods로 버전 사이드카를 저장한다
    const scman = await getJson(env, 'modpacks/bigpack/versions/1.0.0/manifest.json');
    expect(scman.mods[0].fileName).toBe('lithium.jar');
  });

  it('complete with sha256 mismatch → 400 and object deleted', async () => {
    const bytes = strToU8('SMALLPACK');
    const initRes = await handlePacks(await initReq('mm', '1.0.0', 'a'.repeat(64)), env);
    const { uploadId } = await initRes.json();
    const p1 = await (await handlePacks(partReq('mm', uploadId, '1.0.0', 1, bytes), env)).json();

    const res = await handlePacks(completeReq('mm', {
      uploadId,
      parts: [{ partNumber: p1.partNumber, etag: p1.etag }],
      latest: { hyenipackId: 'mm', version: '1.0.0', sha256: 'a'.repeat(64), changelog: 'c', breaking: false },
    }), env);
    expect(res.status).toBe(400);
    expect(await objectExists(env, 'modpacks/mm/versions/1.0.0/pack.hyenipack')).toBe(false);
  });

  it('init for an existing version without overwrite → 409', async () => {
    await handlePacks(await publishReq('dup', '1.0.0', 'PACKDATA'), env);
    const res = await handlePacks(await initReq('dup', '1.0.0', 'b'.repeat(64)), env);
    expect(res.status).toBe(409);
  });

  it('init rejects bad sha256 and bad version with 400', async () => {
    expect((await handlePacks(await initReq('x', '1.0.0', 'nothex'), env)).status).toBe(400);
    expect((await handlePacks(await initReq('x', 'bad', 'c'.repeat(64)), env)).status).toBe(400);
  });

  it('upload-part rejects out-of-range part number with 400', async () => {
    const res = await handlePacks(partReq('x', 'uid', '1.0.0', 0, strToU8('z')), env);
    expect(res.status).toBe(400);
  });
});

describe('PATCH /admin/api/modpacks/{id}/visibility', () => {
  it('sets hidden and preserves name/minecraft; list shows hidden flag', async () => {
    await handlePacks(await publishZipReq('vispack', '1.0.0', {
      formatVersion: 1, hyenipackId: 'vispack', name: '비공개될팩', version: '1.0.0',
      minecraft: { version: '1.21.1', loaderType: 'neoforge', loaderVersion: '21.1.1' },
      mods: [], breaking: false,
    }), env);
    const res = await handlePacks(
      req('PATCH', '/admin/api/modpacks/vispack/visibility', { hidden: true }), env);
    expect(res.status).toBe(200);
    expect((await res.json()).hidden).toBe(true);
    const meta = await getJson(env, 'modpacks/vispack/meta.json');
    expect(meta.hidden).toBe(true);
    expect(meta.name).toBe('비공개될팩');   // 보존
    const list = await handlePacks(req('GET', '/admin/api/modpacks'), env);
    const item = (await list.json()).packs.find((p) => p.id === 'vispack');
    expect(item.hidden).toBe(true);
    expect(item.name).toBe('비공개될팩');
  });

  it('400 on non-boolean hidden, 404 on unknown pack', async () => {
    const bad = await handlePacks(
      req('PATCH', '/admin/api/modpacks/vispack/visibility', { hidden: 'yes' }), env);
    expect(bad.status).toBe(400);
    const nf = await handlePacks(
      req('PATCH', '/admin/api/modpacks/nope/visibility', { hidden: true }), env);
    expect(nf.status).toBe(404);
  });
});
