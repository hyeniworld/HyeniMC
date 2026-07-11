import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

describe('admin routing', () => {
  it('GET /admin/api/ping without Access JWT returns 401', async () => {
    const res = await SELF.fetch('https://example.com/admin/api/ping');
    expect(res.status).toBe(401);
  });

  it('unknown /admin/api route without JWT returns 401 (auth first)', async () => {
    const res = await SELF.fetch('https://example.com/admin/api/nope');
    expect(res.status).toBe(401);
  });

  it('does not intercept public /health route', async () => {
    const res = await SELF.fetch('https://example.com/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });
});
