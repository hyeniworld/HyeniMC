/** 혜니팩 관리 핸들러. 공개 API가 읽는 modpacks/{id}/latest.json은 유지하고,
 * 버전 폴더에 스냅샷 latest.json을 추가로 저장해 롤백/편집을 지원한다. */
import { adminJson } from './router.js';
import { getJson, putJson, putObject, objectExists, listVersions, listPrefixes, deletePrefix } from './r2.js';
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

async function listPacks(env) {
  const ids = await listPrefixes(env, 'modpacks/');
  const packs = [];
  for (const id of ids) {
    const latest = await getJson(env, `modpacks/${id}/latest.json`);
    if (latest) packs.push({ id, latestVersion: latest.version, breaking: !!latest.breaking });
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
  await putJson(env, `modpacks/${id}/latest.json`, sidecar);
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
