/** 혜니팩 관리 핸들러. 공개 API가 읽는 modpacks/{id}/latest.json은 유지하고,
 * 버전 폴더에 스냅샷 latest.json을 추가로 저장해 롤백/편집을 지원한다. */
import { unzipSync } from 'fflate';
import { adminJson } from './router.js';
import { getJson, putJson, putObject, objectExists, listVersions, listPrefixes, deletePrefix, compareVersions } from './r2.js';
import { sha256Hex } from './mods-format.js';

const PACK_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

/** URIError 없이 안전하게 디코딩한다. 잘못된 %-이스케이프는 null로 반환해 400 처리하도록 한다. */
function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

export async function handlePacks(request, env) {
  const path = new URL(request.url).pathname;
  const method = request.method;

  if (method === 'GET' && path === '/admin/api/modpacks') {
    return await listPacks(env);
  }

  const versM = path.match(/^\/admin\/api\/modpacks\/([^/]+)\/versions$/);
  if (versM) {
    const id = safeDecode(versM[1]);
    if (id === null || !PACK_ID_PATTERN.test(id)) return adminJson({ error: 'Invalid modpack id' }, 400);
    if (method === 'GET') return await listPackVersions(env, id);
    if (method === 'POST') return await publishPackVersion(request, env, id);
  }

  const latestM = path.match(/^\/admin\/api\/modpacks\/([^/]+)\/latest$/);
  if (latestM && method === 'PATCH') {
    const id = safeDecode(latestM[1]);
    if (id === null || !PACK_ID_PATTERN.test(id)) return adminJson({ error: 'Invalid modpack id' }, 400);
    return await rollbackPack(request, env, id);
  }

  const manM = path.match(/^\/admin\/api\/modpacks\/([^/]+)\/versions\/([^/]+)\/manifest$/);
  if (manM && method === 'GET') {
    const id = safeDecode(manM[1]);
    const ver = safeDecode(manM[2]);
    if (id === null || !PACK_ID_PATTERN.test(id)) return adminJson({ error: 'Invalid modpack id' }, 400);
    if (ver === null || !VERSION_PATTERN.test(ver)) return adminJson({ error: 'Invalid version' }, 400);
    return await getPackVersionManifest(env, id, ver);
  }

  const verM = path.match(/^\/admin\/api\/modpacks\/([^/]+)\/versions\/([^/]+)$/);
  if (verM) {
    const id = safeDecode(verM[1]);
    const ver = safeDecode(verM[2]);
    if (id === null || !PACK_ID_PATTERN.test(id)) return adminJson({ error: 'Invalid modpack id' }, 400);
    if (ver === null || !VERSION_PATTERN.test(ver)) return adminJson({ error: 'Invalid version' }, 400);
    if (method === 'PATCH') return await editPackVersion(request, env, id, ver);
    if (method === 'DELETE') return await deletePackVersion(env, id, ver);
  }

  return adminJson({ error: 'Not Found' }, 404);
}

/** .hyenipack(ZIP) 안의 hyenipack.json을 언집해 로더/게임버전/모드 목록을 노출한다.
 * sidecar latest.json에는 로더/모드 정보가 없어 팩 파일을 직접 파싱해야 한다. */
async function getPackVersionManifest(env, id, ver) {
  const obj = await env.RELEASES.get(`modpacks/${id}/versions/${ver}/pack.hyenipack`);
  if (!obj) return adminJson({ error: 'Not Found' }, 404);
  let manifest;
  try {
    const buf = new Uint8Array(await obj.arrayBuffer());
    const files = unzipSync(buf, { filter: (f) => f.name === 'hyenipack.json' });
    const entry = files['hyenipack.json'];
    if (!entry) return adminJson({ error: '.hyenipack에 hyenipack.json이 없습니다.' }, 422);
    manifest = JSON.parse(new TextDecoder().decode(entry));
  } catch (e) {
    return adminJson({ error: '.hyenipack 파싱 실패', message: e.message }, 500);
  }
  return adminJson({
    formatVersion: manifest.formatVersion ?? null,
    name: manifest.name ?? null,
    minecraft: manifest.minecraft ?? null,
    mods: Array.isArray(manifest.mods) ? manifest.mods : [],
  });
}

/** 목록 노출용 관용 파서: 팩 누락/엔트리 없음/JSON 오류 등 어떤 실패에도 null을 반환한다.
 * 팩 하나가 깨져도 전체 목록이 무너지지 않도록 상태 구분 없이 조용히 넘어간다. */
async function readPackManifest(env, id, ver) {
  const obj = await env.RELEASES.get(`modpacks/${id}/versions/${ver}/pack.hyenipack`);
  if (!obj) return null;
  try {
    const buf = new Uint8Array(await obj.arrayBuffer());
    const files = unzipSync(buf, { filter: (f) => f.name === 'hyenipack.json' });
    const entry = files['hyenipack.json'];
    if (!entry) return null;
    return JSON.parse(new TextDecoder().decode(entry));
  } catch { return null; }
}

async function listPacks(env) {
  const ids = await listPrefixes(env, 'modpacks/');
  const packs = [];
  for (const id of ids) {
    const latest = await getJson(env, `modpacks/${id}/latest.json`);
    if (!latest) continue;
    const manifest = latest.version ? await readPackManifest(env, id, latest.version) : null;
    packs.push({
      id,
      latestVersion: latest.version,
      breaking: !!latest.breaking,
      minecraft: manifest?.minecraft ?? null,
    });
  }
  return adminJson({ packs });
}

async function listPackVersions(env, id) {
  const versions = await listVersions(env, `modpacks/${id}/versions/`);
  const latest = await getJson(env, `modpacks/${id}/latest.json`);
  const detailed = [];
  for (const v of versions) {
    const snap = await getJson(env, `modpacks/${id}/versions/${v}/latest.json`);
    detailed.push({ version: v, changelog: snap?.changelog || '', breaking: !!snap?.breaking });
  }
  return adminJson({ id, latestVersion: latest?.version || null, versions: detailed });
}

async function publishPackVersion(request, env, id) {
  let form;
  try { form = await request.formData(); } catch { return adminJson({ error: 'multipart 본문 필요' }, 400); }

  const packPart = form.get('pack');
  if (!packPart || typeof packPart.arrayBuffer !== 'function') {
    return adminJson({ error: 'pack 파일 파트가 필요합니다.' }, 400);
  }
  const rawLatest = form.get('latest');
  if (typeof rawLatest !== 'string') {
    return adminJson({ error: 'latest 필드(JSON)가 필요합니다.' }, 400);
  }
  let sidecar;
  try { sidecar = JSON.parse(rawLatest); } catch {
    return adminJson({ error: 'latest 필드(JSON)가 필요합니다.' }, 400);
  }

  if (sidecar.hyenipackId !== id) return adminJson({ error: 'hyenipackId가 경로와 불일치합니다.' }, 400);
  if (!VERSION_PATTERN.test(sidecar.version || '')) return adminJson({ error: '버전 형식은 x.y.z' }, 400);

  const buffer = await packPart.arrayBuffer();
  const actual = await sha256Hex(buffer);
  if (actual !== sidecar.sha256) {
    return adminJson({ error: 'sha256 불일치', message: `expected ${sidecar.sha256}, got ${actual}` }, 400);
  }

  const overwrite = new URL(request.url).searchParams.get('overwrite') === 'true';
  const packKey = `modpacks/${id}/versions/${sidecar.version}/pack.hyenipack`;
  if (!overwrite && await objectExists(env, packKey)) {
    return adminJson({ error: '이미 존재하는 버전입니다.' }, 409);
  }

  await putObject(env, packKey, buffer, 'application/zip');
  await putJson(env, `modpacks/${id}/versions/${sidecar.version}/latest.json`, sidecar);
  // 공개 latest(쿼리 미지정 구 클라이언트용 폴백)는 더 높거나 같은 버전일 때만 갱신.
  // 같은 버전(overwrite)은 내용 새로고침을 위해 갱신, 낮은 버전(백필)은 유지.
  const curLatest = await getJson(env, `modpacks/${id}/latest.json`);
  if (!curLatest?.version || compareVersions(sidecar.version, curLatest.version) >= 0) {
    await putJson(env, `modpacks/${id}/latest.json`, sidecar);
  }
  return adminJson({ id, version: sidecar.version, sha256: actual }, 201);
}

async function rollbackPack(request, env, id) {
  let body;
  try { body = await request.json(); } catch { return adminJson({ error: 'JSON 본문 필요' }, 400); }
  if (!VERSION_PATTERN.test(body.version || '')) return adminJson({ error: 'Invalid version' }, 400);

  const snap = await getJson(env, `modpacks/${id}/versions/${body.version}/latest.json`);
  if (!snap) return adminJson({ error: 'Not Found' }, 404);
  await putJson(env, `modpacks/${id}/latest.json`, snap);
  return adminJson({ id, latestVersion: body.version });
}

async function editPackVersion(request, env, id, ver) {
  let body;
  try { body = await request.json(); } catch { return adminJson({ error: 'JSON 본문 필요' }, 400); }

  const snap = await getJson(env, `modpacks/${id}/versions/${ver}/latest.json`);
  if (!snap) return adminJson({ error: 'Not Found' }, 404);

  const updated = { ...snap };
  if (body.changelog !== undefined) updated.changelog = body.changelog;
  if (body.breaking !== undefined) updated.breaking = body.breaking;

  await putJson(env, `modpacks/${id}/versions/${ver}/latest.json`, updated);
  const latest = await getJson(env, `modpacks/${id}/latest.json`);
  if (latest && latest.version === ver) {
    await putJson(env, `modpacks/${id}/latest.json`, updated);
  }
  return adminJson({ id, version: ver });
}

async function deletePackVersion(env, id, ver) {
  const latest = await getJson(env, `modpacks/${id}/latest.json`);
  if (latest && latest.version === ver) {
    return adminJson({ error: '현재 latest 버전은 삭제할 수 없습니다. 먼저 롤백하세요.' }, 409);
  }
  const removed = await deletePrefix(env, `modpacks/${id}/versions/${ver}/`);
  if (removed === 0) return adminJson({ error: 'Not Found' }, 404);
  return adminJson({ id, deleted: ver, objects: removed });
}
