/** R2 바인딩(env.RELEASES) 헬퍼. 키에 버킷 prefix를 붙이지 않는다. */

export async function getJson(env, key) {
  const obj = await env.RELEASES.get(key);
  if (!obj) return null;
  return JSON.parse(await obj.text());
}

export async function putJson(env, key, obj) {
  await env.RELEASES.put(key, JSON.stringify(obj, null, 2), {
    httpMetadata: { contentType: 'application/json' },
  });
}

export async function putObject(env, key, body, contentType) {
  await env.RELEASES.put(key, body, {
    httpMetadata: { contentType: contentType || 'application/octet-stream' },
  });
}

export async function objectExists(env, key) {
  const head = await env.RELEASES.head(key);
  return head !== null;
}

const VERSION_SEG = /\/versions\/(\d+\.\d+\.\d+)\//;

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

export async function listVersions(env, prefix) {
  const versions = new Set();
  let cursor;
  do {
    const list = await env.RELEASES.list({ prefix, cursor });
    for (const o of list.objects) {
      const m = o.key.match(VERSION_SEG);
      if (m) versions.add(m[1]);
    }
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
  return [...versions].sort((a, b) => compareVersions(b, a));
}

export async function listPrefixes(env, prefix) {
  const names = new Set();
  let cursor;
  do {
    const list = await env.RELEASES.list({ prefix, delimiter: '/', cursor });
    for (const p of list.delimitedPrefixes) {
      const name = p.slice(prefix.length).replace(/\/$/, '');
      if (name) names.add(name);
    }
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
  return [...names];
}

export async function deletePrefix(env, prefix) {
  let count = 0;
  let cursor;
  do {
    const list = await env.RELEASES.list({ prefix, cursor });
    const keys = list.objects.map((o) => o.key);
    for (const key of keys) {
      await env.RELEASES.delete(key);
      count++;
    }
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
  return count;
}
