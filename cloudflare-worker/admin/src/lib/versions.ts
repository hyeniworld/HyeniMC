/** 버전 문자열을 숫자 세그먼트 기준으로 비교(사전식이 아니라 1.21.2 < 1.21.11). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.');
  const pb = b.split('.');
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = parseInt(pa[i] ?? '0', 10) || 0;
    const y = parseInt(pb[i] ?? '0', 10) || 0;
    if (x !== y) return x - y;
  }
  return a.localeCompare(b);
}

export const sortVersions = (arr: string[]): string[] => [...arr].sort(compareVersions);
