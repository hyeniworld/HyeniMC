/** 모드 관리 핸들러: 목록/버전/게시/롤백/편집/삭제. */
import { adminJson } from './router.js';
import { getJson, listVersions, putObject, putJson, objectExists, deletePrefix } from './r2.js';
import { sha256Hex, buildManifest, isoNow } from './mods-format.js';
import { rebuildRegistry } from './registry.js';
import { rebuildModIndex, setModPin } from './mod-index.js';

export const MOD_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
export const LOADER_PATTERN = /^[a-z0-9]+$/;
export const GAME_VERSION_PATTERN = /^\d+\.\d+(\.\d+)?$/;
export const FILE_NAME_PATTERN = /^[A-Za-z0-9._+-]+\.jar$/;

/** manifest의 loaders를 (로더,게임버전) 단위의 평면 타깃 목록으로 펼친다. */
function flattenTargets(manifest) {
  const out = [];
  const loaders = manifest?.loaders || {};
  for (const [loader, ldata] of Object.entries(loaders)) {
    for (const [gameVersion, cell] of Object.entries(ldata?.gameVersions || {})) {
      out.push({
        loader, gameVersion,
        minLoaderVersion: cell?.minLoaderVersion ?? null,
        maxLoaderVersion: cell?.maxLoaderVersion ?? null,
        dependencies: cell?.dependencies ?? {},
        file: cell?.file ?? null,
        sha256: cell?.sha256 ?? null,
        size: cell?.size ?? null,
      });
    }
  }
  return out;
}

/** URIError 없이 안전하게 디코딩한다. 잘못된 %-이스케이프는 null로 반환해 400 처리하도록 한다. */
function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

export async function handleMods(request, env) {
  const path = new URL(request.url).pathname;
  const method = request.method;

  if (method === 'GET' && path === '/admin/api/mods') {
    return await listMods(env);
  }

  const versions = path.match(/^\/admin\/api\/mods\/([^/]+)\/versions$/);
  if (versions) {
    const id = safeDecode(versions[1]);
    if (id === null || !MOD_ID_PATTERN.test(id)) return adminJson({ error: 'Invalid mod id' }, 400);
    if (method === 'GET') return await listModVersions(env, id);
    if (method === 'POST') return await publishModVersion(request, env, id);
  }

  // PATCH /admin/api/mods/{id}/latest  (롤백)
  const latestM = path.match(/^\/admin\/api\/mods\/([^/]+)\/latest$/);
  if (latestM && method === 'PATCH') {
    const id = safeDecode(latestM[1]);
    if (id === null || !MOD_ID_PATTERN.test(id)) return adminJson({ error: 'Invalid mod id' }, 400);
    return await rollbackMod(request, env, id);
  }

  // PATCH/DELETE /admin/api/mods/{id}/versions/{ver}
  const verM = path.match(/^\/admin\/api\/mods\/([^/]+)\/versions\/([^/]+)$/);
  if (verM) {
    const id = safeDecode(verM[1]);
    const ver = safeDecode(verM[2]);
    if (id === null || !MOD_ID_PATTERN.test(id)) return adminJson({ error: 'Invalid mod id' }, 400);
    if (ver === null || !VERSION_PATTERN.test(ver)) return adminJson({ error: 'Invalid version' }, 400);
    if (method === 'PATCH') return await editModVersion(request, env, id, ver);
    if (method === 'DELETE') return await deleteModVersion(env, id, ver);
  }

  // GET /admin/api/mods/{id}/index
  const indexM = path.match(/^\/admin\/api\/mods\/([^/]+)\/index$/);
  if (indexM && method === 'GET') {
    const id = safeDecode(indexM[1]);
    if (id === null || !MOD_ID_PATTERN.test(id)) return adminJson({ error: 'Invalid mod id' }, 400);
    const idx = await getJson(env, `mods/${id}/index.json`);
    return adminJson(idx || { version: '1', targets: {} });
  }

  // PATCH /admin/api/mods/{id}/pins  {loader, gameVersion, version|null}
  const pinsM = path.match(/^\/admin\/api\/mods\/([^/]+)\/pins$/);
  if (pinsM && method === 'PATCH') {
    const id = safeDecode(pinsM[1]);
    if (id === null || !MOD_ID_PATTERN.test(id)) return adminJson({ error: 'Invalid mod id' }, 400);
    let body;
    try { body = await request.json(); } catch { return adminJson({ error: 'JSON 본문 필요' }, 400); }
    if (!body || typeof body !== 'object' || !body.loader || !body.gameVersion) return adminJson({ error: 'loader, gameVersion 필요' }, 400);
    const version = body.version === undefined ? null : body.version;
    const r = await setModPin(env, id, body.loader, body.gameVersion, version);
    if (!r.ok) return adminJson({ error: r.error }, 400);
    return adminJson({ ok: true, index: r.index });
  }

  return adminJson({ error: 'Not Found' }, 404);
}

async function listMods(env) {
  const registry = await getJson(env, 'mods/registry.json');
  return adminJson({ mods: registry?.mods || [] });
}

async function listModVersions(env, id) {
  const versionIds = await listVersions(env, `mods/${id}/versions/`);
  const versions = [];
  for (const v of versionIds) {
    const manifest = await getJson(env, `mods/${id}/versions/${v}/manifest.json`);
    versions.push({
      version: v,
      releaseDate: manifest?.releaseDate || null,
      gameVersions: manifest?.gameVersions || [],
      changelog: manifest?.changelog || '',
      category: manifest?.category || 'optional',
      targets: flattenTargets(manifest),
    });
  }
  const latest = await getJson(env, `mods/${id}/latest.json`);
  return adminJson({ id, latestVersion: latest?.version || null, versions });
}

async function publishModVersion(request, env, id) {
  let form;
  try {
    form = await request.formData();
  } catch {
    return adminJson({ error: 'multipart/form-data 본문이 필요합니다.' }, 400);
  }

  const rawMeta = form.get('meta');
  if (typeof rawMeta !== 'string') {
    return adminJson({ error: 'meta 필드(JSON)가 필요합니다.' }, 400);
  }
  let meta;
  try {
    meta = JSON.parse(rawMeta);
  } catch {
    return adminJson({ error: 'meta 필드(JSON)가 필요합니다.' }, 400);
  }

  // 검증
  if (meta.modId !== id) return adminJson({ error: 'modId가 경로와 불일치합니다.' }, 400);
  if (!VERSION_PATTERN.test(meta.version || '')) {
    return adminJson({ error: '버전 형식은 x.y.z 여야 합니다.' }, 400);
  }
  if (!Array.isArray(meta.files) || meta.files.length === 0) {
    return adminJson({ error: 'files가 비어 있습니다.' }, 400);
  }

  const overwrite = new URL(request.url).searchParams.get('overwrite') === 'true';
  const manifestKey = `mods/${id}/versions/${meta.version}/manifest.json`;
  if (!overwrite && await objectExists(env, manifestKey)) {
    return adminJson({ error: '이미 존재하는 버전입니다.', message: `${id}@${meta.version}` }, 409);
  }

  // 파일 파트 수집 + 검증(업로드 전에 모두 존재/형식 확인)
  const prepared = [];
  for (const f of meta.files) {
    if (!LOADER_PATTERN.test(f.loader || '')) {
      return adminJson({ error: `잘못된 loader 형식: ${f.loader}` }, 400);
    }
    if (!GAME_VERSION_PATTERN.test(f.gameVersion || '')) {
      return adminJson({ error: `잘못된 gameVersion 형식: ${f.gameVersion}` }, 400);
    }
    if (!FILE_NAME_PATTERN.test(f.fileName || '')) {
      return adminJson({ error: `잘못된 fileName 형식: ${f.fileName}` }, 400);
    }
    const part = form.get(f.fileField);
    if (!part || typeof part.arrayBuffer !== 'function') {
      return adminJson({ error: `파일 파트 누락: ${f.fileField}` }, 400);
    }
    const buffer = await part.arrayBuffer();
    prepared.push({
      ...f,
      buffer,
      size: buffer.byteLength,
      sha256: await sha256Hex(buffer),
    });
  }

  // 업로드(부분 실패 시 latest/registry는 갱신하지 않음)
  const failed = [];
  for (const f of prepared) {
    const key = `mods/${id}/versions/${meta.version}/${f.loader}/${f.gameVersion}/${f.fileName}`;
    try {
      await putObject(env, key, f.buffer, 'application/java-archive');
    } catch (e) {
      failed.push({ file: f.fileName, error: e.message });
    }
  }
  if (failed.length > 0) {
    return adminJson({ error: '일부 파일 업로드 실패', failed }, 500);
  }

  // manifest / latest / registry
  const manifest = buildManifest({
    modId: id,
    name: meta.name,
    version: meta.version,
    category: meta.category,
    changelog: meta.changelog || '',
    releaseDate: meta.releaseDate || isoNow(),
    files: prepared,
  });
  await putJson(env, manifestKey, manifest);
  await putJson(env, `mods/${id}/latest.json`, manifest);
  await rebuildRegistry(env);
  await rebuildModIndex(env, id);

  return adminJson({
    version: meta.version,
    files: prepared.map((f) => ({ file: f.fileName, sha256: f.sha256, size: f.size })),
  }, 201);
}

async function rollbackMod(request, env, id) {
  let body;
  try { body = await request.json(); } catch { return adminJson({ error: 'JSON 본문 필요' }, 400); }
  const version = body.version;
  if (!VERSION_PATTERN.test(version || '')) return adminJson({ error: 'Invalid version' }, 400);

  const manifest = await getJson(env, `mods/${id}/versions/${version}/manifest.json`);
  if (!manifest) return adminJson({ error: 'Not Found', message: `${id}@${version}` }, 404);

  await putJson(env, `mods/${id}/latest.json`, manifest);
  await rebuildRegistry(env);
  await rebuildModIndex(env, id);
  return adminJson({ id, latestVersion: version });
}

async function editModVersion(request, env, id, ver) {
  let body;
  try { body = await request.json(); } catch { return adminJson({ error: 'JSON 본문 필요' }, 400); }

  const manifest = await getJson(env, `mods/${id}/versions/${ver}/manifest.json`);
  if (!manifest) return adminJson({ error: 'Not Found' }, 404);

  // 불변 갱신
  const updated = { ...manifest };
  if (body.changelog !== undefined) updated.changelog = body.changelog;
  if (body.category !== undefined) updated.category = body.category;

  // targets: (로더,게임버전)별 min/max/deps를 해당 셀에만 적용 (일괄 적용 아님)
  if (Array.isArray(body.targets) && body.targets.length > 0) {
    updated.loaders = JSON.parse(JSON.stringify(manifest.loaders || {}));
    for (const t of body.targets) {
      if (!t || typeof t !== 'object') continue; // 잘못된 요소 무시
      const cell = updated.loaders?.[t.loader]?.gameVersions?.[t.gameVersion];
      if (!cell) continue; // 존재하지 않는 (로더,게임버전)은 무시
      if (t.minLoaderVersion !== undefined) cell.minLoaderVersion = t.minLoaderVersion;
      if (t.maxLoaderVersion !== undefined) cell.maxLoaderVersion = t.maxLoaderVersion;
      if (t.dependencies !== undefined) cell.dependencies = t.dependencies;
    }
  }

  await putJson(env, `mods/${id}/versions/${ver}/manifest.json`, updated);

  const latest = await getJson(env, `mods/${id}/latest.json`);
  if (latest && latest.version === ver) {
    await putJson(env, `mods/${id}/latest.json`, updated);
  }
  await rebuildRegistry(env);
  await rebuildModIndex(env, id);
  return adminJson({ id, version: ver });
}

async function deleteModVersion(env, id, ver) {
  const latest = await getJson(env, `mods/${id}/latest.json`);
  if (latest && latest.version === ver) {
    return adminJson({
      error: '현재 latest 버전은 삭제할 수 없습니다. 먼저 다른 버전으로 롤백하세요.',
    }, 409);
  }
  const removed = await deletePrefix(env, `mods/${id}/versions/${ver}/`);
  if (removed === 0) return adminJson({ error: 'Not Found' }, 404);
  await rebuildRegistry(env);
  await rebuildModIndex(env, id);
  return adminJson({ id, deleted: ver, objects: removed });
}
