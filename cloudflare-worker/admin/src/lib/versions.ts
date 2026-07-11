// 같은 x.y.z 안에서 정식(4) > pre(3) > beta(2) > alpha(1)
const LABEL_RANK: Record<string, number> = { alpha: 1, beta: 2, pre: 3 };

interface VersionKey { nums: number[]; rank: number; num: number }

function parseVersionKey(v: string): VersionKey {
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|pre)(\d{3}))?$/);
  if (m) {
    return {
      nums: [Number(m[1]), Number(m[2]), Number(m[3])],
      rank: m[4] ? LABEL_RANK[m[4]] : 4,
      num: m[5] ? Number(m[5]) : 0,
    };
  }
  const parts = v.split('.').map((p) => parseInt(p, 10) || 0);
  return { nums: [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0], rank: 4, num: 0 };
}

/** x.y.z(-(alpha|beta|pre)NNN)? 비교 — 숫자 세그먼트 기준(1.21.2 < 1.21.11), 프리릴리즈 < 같은 x.y.z 정식. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersionKey(a);
  const pb = parseVersionKey(b);
  for (let i = 0; i < 3; i++) {
    if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] - pb.nums[i];
  }
  if (pa.rank !== pb.rank) return pa.rank - pb.rank;
  if (pa.num !== pb.num) return pa.num - pb.num;
  return a.localeCompare(b);
}

export const sortVersions = (arr: string[]): string[] => [...arr].sort(compareVersions);
