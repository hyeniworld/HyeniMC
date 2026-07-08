import { describe, it, expect, beforeAll } from 'vitest';
import { verifyAccessJwt } from '../src/admin/access.js';

// base64url 인코딩 헬퍼
function b64url(bytes) {
  let bin = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlStr(str) {
  return b64url(new TextEncoder().encode(str));
}

const TEAM = 'https://example.cloudflareaccess.com';
const AUD = 'test-aud';
let keyPair, jwk;

async function makeJwt(claims, signKey = keyPair.privateKey, kid = 'kid1') {
  const header = { alg: 'RS256', kid, typ: 'JWT' };
  const payload = {
    iss: TEAM, aud: [AUD], email: 'me@example.com',
    exp: Math.floor(Date.now() / 1000) + 600,
    ...claims,
  };
  const signingInput = `${b64urlStr(JSON.stringify(header))}.${b64urlStr(JSON.stringify(payload))}`;
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', signKey, new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${b64url(sig)}`;
}

function fakeFetch() {
  return async () => new Response(JSON.stringify({ keys: [jwk] }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

function reqWithJwt(token) {
  return new Request('https://example.com/admin/api/ping', {
    headers: token ? { 'Cf-Access-Jwt-Assertion': token } : {},
  });
}

const env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };

beforeAll(async () => {
  keyPair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['sign', 'verify'],
  );
  jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  jwk.kid = 'kid1';
  jwk.alg = 'RS256';
});

describe('verifyAccessJwt', () => {
  it('accepts a valid token', async () => {
    const token = await makeJwt({});
    const result = await verifyAccessJwt(reqWithJwt(token), env, { fetchImpl: fakeFetch() });
    expect(result).toEqual({ email: 'me@example.com' });
  });

  it('rejects missing header', async () => {
    const result = await verifyAccessJwt(reqWithJwt(null), env, { fetchImpl: fakeFetch() });
    expect(result).toBeNull();
  });

  it('rejects wrong audience', async () => {
    const token = await makeJwt({ aud: ['other-aud'] });
    const result = await verifyAccessJwt(reqWithJwt(token), env, { fetchImpl: fakeFetch() });
    expect(result).toBeNull();
  });

  it('rejects expired token', async () => {
    const token = await makeJwt({ exp: Math.floor(Date.now() / 1000) - 10 });
    const result = await verifyAccessJwt(reqWithJwt(token), env, { fetchImpl: fakeFetch() });
    expect(result).toBeNull();
  });

  it('rejects token with no exp claim', async () => {
    const token = await makeJwt({ exp: undefined });
    const result = await verifyAccessJwt(reqWithJwt(token), env, { fetchImpl: fakeFetch() });
    expect(result).toBeNull();
  });

  it('rejects tampered signature', async () => {
    const token = (await makeJwt({})).slice(0, -3) + 'AAA';
    const result = await verifyAccessJwt(reqWithJwt(token), env, { fetchImpl: fakeFetch() });
    expect(result).toBeNull();
  });
});
