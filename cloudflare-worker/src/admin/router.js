/**
 * 관리 API 라우터. /admin/api/* 요청을 받아 처리한다.
 * 인증(Access) 미들웨어는 Task 2에서 추가한다.
 */

export function adminJson(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleAdminApi(request, env, ctx) {
  const path = new URL(request.url).pathname;

  if (request.method === 'GET' && path === '/admin/api/ping') {
    return adminJson({ ok: true });
  }

  return adminJson({ error: 'Not Found' }, 404);
}
