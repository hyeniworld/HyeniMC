/** 모드 관리 핸들러: 목록/버전/게시/롤백/편집/삭제. */
import { adminJson } from './router.js';
import { getJson, listVersions, putObject, putJson, objectExists } from './r2.js';
import { sha256Hex, buildManifest, isoNow } from './mods-format.js';
import { rebuildRegistry } from './registry.js';

export const MOD_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

export async function handleMods(request, env) {
  const path = new URL(request.url).pathname;
  const method = request.method;

  if (method === 'GET' && path === '/admin/api/mods') {
    return await listMods(env);
  }

  const versions = path.match(/^\/admin\/api\/mods\/([^/]+)\/versions$/);
  if (versions) {
    const id = decodeURIComponent(versions[1]);
    if (!MOD_ID_PATTERN.test(id)) return adminJson({ error: 'Invalid mod id' }, 400);
    if (method === 'GET') return await listModVersions(env, id);
    if (method === 'POST') return await publishModVersion(request, env, id);
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

  let meta;
  try {
    meta = JSON.parse(form.get('meta'));
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

  // 파일 파트 수집 + 검증(업로드 전에 모두 존재 확인)
  const prepared = [];
  for (const f of meta.files) {
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

  return adminJson({
    version: meta.version,
    files: prepared.map((f) => ({ file: f.fileName, sha256: f.sha256, size: f.size })),
  }, 201);
}
