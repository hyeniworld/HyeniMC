/** 모드 관리 핸들러: 목록/버전/게시/롤백/편집/삭제. */
import { adminJson } from './router.js';
import { getJson, listVersions } from './r2.js';

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
