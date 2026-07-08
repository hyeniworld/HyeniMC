/**
 * 관리 API 라우터. /admin/api/* 요청을 받아 처리한다.
 * Cloudflare Access JWT 인증 미들웨어를 통과해야 핸들러에 도달한다.
 */

import { verifyAccessJwt } from './access.js';

export function adminJson(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleAdminApi(request, env, ctx) {
  const identity = await verifyAccessJwt(request, env);
  if (!identity) {
    return adminJson({ error: 'Unauthorized', message: 'Access 인증이 필요합니다.' }, 401);
  }

  const path = new URL(request.url).pathname;

  if (request.method === 'GET' && path === '/admin/api/ping') {
    return adminJson({ ok: true });
  }

  return adminJson({ error: 'Not Found' }, 404);
}
