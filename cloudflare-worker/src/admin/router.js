import { verifyAccessJwt, devBypassIdentity } from './access.js';
import { handleMods } from './mods.js';
import { handlePacks } from './packs.js';
import { rebuildRegistry } from './registry.js';

export function adminJson(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** 인증 이후의 순수 라우팅(테스트에서 직접 호출). */
export async function dispatchAdmin(request, env) {
  const path = new URL(request.url).pathname;
  const method = request.method;

  if (method === 'GET' && path === '/admin/api/ping') {
    return adminJson({ ok: true });
  }
  if (method === 'POST' && path === '/admin/api/registry/rebuild') {
    const reg = await rebuildRegistry(env);
    return adminJson({ ok: true, count: reg.mods.length });
  }
  if (path.startsWith('/admin/api/modpacks')) {
    return await handlePacks(request, env);
  }
  if (path.startsWith('/admin/api/mods')) {
    return await handleMods(request, env);
  }
  return adminJson({ error: 'Not Found' }, 404);
}

export async function handleAdminApi(request, env, ctx) {
  const identity = devBypassIdentity(request, env) || await verifyAccessJwt(request, env);
  if (!identity) {
    return adminJson({ error: 'Unauthorized', message: 'Access 인증이 필요합니다.' }, 401);
  }
  return await dispatchAdmin(request, env);
}
