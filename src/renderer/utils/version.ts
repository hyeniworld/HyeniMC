/**
 * Semantic Version 비교 및 파싱 유틸리티
 */

/**
 * 버전 문자열에서 숫자 버전만 추출
 * @example
 * parseVersion("1.0.0") => "1.0.0"
 * parseVersion("1.0.0+fabric") => "1.0.0"
 * parseVersion("v1.2.3") => "1.2.3"
 * parseVersion("1.21.1-1.0.0") => "1.0.0" (마지막 버전 번호)
 * parseVersion("iris-neoforge-1.7.0") => "1.7.0"
 */
export function parseVersion(versionString: string): string {
  if (!versionString) return '0.0.0';

  // 1. "v" 접두사 제거
  let cleaned = versionString.replace(/^v/i, '');

  // 2. 여러 버전 패턴 시도
  // 패턴 1: x.x.x 형태 (가장 마지막 것 선택)
  const semverMatches = cleaned.match(/(\d+)\.(\d+)\.(\d+)/g);
  if (semverMatches && semverMatches.length > 0) {
    return semverMatches[semverMatches.length - 1];
  }

  // 패턴 2: x.x 형태
  const shortVersionMatch = cleaned.match(/(\d+)\.(\d+)/);
  if (shortVersionMatch) {
    return `${shortVersionMatch[0]}.0`;
  }

  // 패턴 3: x만 있는 경우
  const singleDigitMatch = cleaned.match(/(\d+)/);
  if (singleDigitMatch) {
    return `${singleDigitMatch[0]}.0.0`;
  }

  // 파싱 실패
  return '0.0.0';
}

/**
 * 두 버전을 비교
 * @returns -1 if v1 < v2, 0 if v1 === v2, 1 if v1 > v2
 * @example
 * compareVersions("1.0.0", "1.0.1") => -1
 * compareVersions("2.0.0", "1.9.9") => 1
 * compareVersions("1.5.0", "1.5.0") => 0
 */
export function compareVersions(v1: string, v2: string): number {
  const parsed1 = parseVersion(v1);
  const parsed2 = parseVersion(v2);

  const parts1 = parsed1.split('.').map(Number);
  const parts2 = parsed2.split('.').map(Number);

  // 각 파트 비교
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const part1 = parts1[i] || 0;
    const part2 = parts2[i] || 0;

    if (part1 < part2) return -1;
    if (part1 > part2) return 1;
  }

  return 0;
}

/**
 * 버전이 유효한지 확인
 */
export function isValidVersion(version: string): boolean {
  if (!version) return false;
  const parsed = parseVersion(version);
  return parsed !== '0.0.0' || version === '0.0.0';
}

/**
 * 버전 문자열을 표시용으로 포맷
 * @example
 * formatVersion("1.0.0+fabric") => "v1.0.0"
 */
export function formatVersion(version: string): string {
  const parsed = parseVersion(version);
  return `v${parsed}`;
}
