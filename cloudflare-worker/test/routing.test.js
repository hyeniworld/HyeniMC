import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

describe('admin routing', () => {
  it('GET /admin/api/ping returns 200', async () => {
    const res = await SELF.fetch('https://example.com/admin/api/ping');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('unknown /admin/api route returns 404', async () => {
    const res = await SELF.fetch('https://example.com/admin/api/nope');
    expect(res.status).toBe(404);
  });

  it('does not intercept public /health route', async () => {
    const res = await SELF.fetch('https://example.com/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });
});
