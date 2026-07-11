/**
 * Cloudflare Access JWT(RS256) 검증.
 * Access가 엣지에서 /admin*를 이미 게이트하지만, Worker에서 2차 검증한다.
 */

const jwksCache = new Map(); // teamDomain -> { keys, expiresAt }
const JWKS_TTL_MS = 60 * 60 * 1000; // 1시간

function decodeB64url(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function jsonFromB64url(str) {
  return JSON.parse(new TextDecoder().decode(decodeB64url(str)));
}

async function getJwks(teamDomain, fetchImpl) {
  const cached = jwksCache.get(teamDomain);
  if (cached && cached.expiresAt > Date.now()) return cached.keys;

  const res = await fetchImpl(`${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const { keys } = await res.json();
  jwksCache.set(teamDomain, { keys, expiresAt: Date.now() + JWKS_TTL_MS });
  return keys;
}

/**
 * 로컬 개발 전용 인증 우회(이중 게이트). 다음을 모두 만족할 때만 통과:
 *   (1) env.ACCESS_DEV_BYPASS === 'true'
 *   (2) 요청 호스트가 localhost 계열
 * 프로덕션은 호스트가 실제 도메인이라 플래그가 실수로 켜져도 절대 열리지 않는다.
 * 활성화(그 세션에만): `wrangler dev --var ACCESS_DEV_BYPASS:true`
 * — wrangler.toml에 상시로 넣지 말 것. --var를 빼거나 배포하면 자동으로 다시 401.
 */
export function devBypassIdentity(request, env) {
  if (env.ACCESS_DEV_BYPASS !== 'true') return null;
  const host = new URL(request.url).hostname;
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') {
    return { email: 'dev-bypass@local' };
  }
  return null;
}

export async function verifyAccessJwt(request, env, { fetchImpl = fetch } = {}) {
  try {
    const token = request.headers.get('Cf-Access-Jwt-Assertion');
    if (!token) return null;

    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, sigB64] = parts;

    const header = jsonFromB64url(headerB64);
    const payload = jsonFromB64url(payloadB64);
    if (header.alg !== 'RS256') return null;

    // 클레임 검증
    const now = Math.floor(Date.now() / 1000);
    if (!payload.exp || payload.exp < now) return null;
    if (payload.iss !== env.ACCESS_TEAM_DOMAIN) return null;
    const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!auds.includes(env.ACCESS_AUD)) return null;

    // 서명 검증
    const keys = await getJwks(env.ACCESS_TEAM_DOMAIN, fetchImpl);
    const jwk = keys.find((k) => k.kid === header.kid);
    if (!jwk) return null;

    const key = await crypto.subtle.importKey(
      'jwk', jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false, ['verify'],
    );
    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5', key,
      decodeB64url(sigB64),
      new TextEncoder().encode(`${headerB64}.${payloadB64}`),
    );
    if (!valid) return null;

    return { email: payload.email || '' };
  } catch (e) {
    console.error('[access] verify error:', e.message);
    return null;
  }
}
