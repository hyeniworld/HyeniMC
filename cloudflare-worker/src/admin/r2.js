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

const VERSION_SEG = /\/versions\/(\d+\.\d+\.\d+(?:-(?:alpha|beta|pre)\d{3})?)\//;

/** 프리릴리즈 버전(x.y.z-(alpha|beta|pre)NNN) 여부. 자동 latest/auto 승격에서 제외하는 데 쓴다. */
export function isPrerelease(v) {
  return /-(?:alpha|beta|pre)\d{3}$/.test(v || '');
}

// 같은 x.y.z 안에서 정식(4) > pre(3) > beta(2) > alpha(1). 레이블 사전순이 단계 순서와 일치.
const LABEL_RANK = { alpha: 1, beta: 2, pre: 3 };

function parseVersionKey(v) {
  const m = (v || '').match(/^(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|pre)(\d{3}))?$/);
  if (m) {
    return {
      nums: [Number(m[1]), Number(m[2]), Number(m[3])],
      rank: m[4] ? LABEL_RANK[m[4]] : 4,
      num: m[5] ? Number(m[5]) : 0,
    };
  }
  // 형식 밖(레거시 등) — 기존 동작 근사: 숫자 세그먼트만, 정식 취급
  const parts = (v || '').split('.').map(Number);
  return { nums: [parts[0] || 0, parts[1] || 0, parts[2] || 0], rank: 4, num: 0 };
}

/** x.y.z(-(alpha|beta|pre)NNN)? 비교. 프리릴리즈는 같은 x.y.z의 정식보다 낮다(SemVer 의미). */
export function compareVersions(a, b) {
  const pa = parseVersionKey(a);
  const pb = parseVersionKey(b);
  for (let i = 0; i < 3; i++) {
    if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] > pb.nums[i] ? 1 : -1;
  }
  if (pa.rank !== pb.rank) return pa.rank > pb.rank ? 1 : -1;
  if (pa.num !== pb.num) return pa.num > pb.num ? 1 : -1;
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
