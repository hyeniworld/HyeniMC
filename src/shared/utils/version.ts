/**
 * Semantic Version 비교 및 파싱 유틸리티
 * Main/Renderer 공통 사용
 */

/**
 * 버전 문자열에서 모드 버전만 추출 (게임 버전 제외)
 * @example
 * parseModVersion("1.0.0") => "1.0.0"
 * parseModVersion("1.0.0+fabric") => "1.0.0"
 * parseModVersion("v1.2.3") => "1.2.3"
 * parseModVersion("21.1.23+neoforge-1.21.1") => "21.1.23"
 * parseModVersion("neoforge-1.21.1-1.0.0") => "1.0.0"
 * parseModVersion("iris-neoforge-1.7.0+mc1.21.1") => "1.7.0"
 * parseModVersion("FastSuite-1.21.1-6.0.5") => "6.0.5"
 * parseModVersion("1.8.12+1.21.1-neoforge") => "1.8.12"
 */
export function parseModVersion(versionString: string): string {
  if (!versionString) return '0.0.0';

  // 1. "v" 접두사 제거
  let cleaned = versionString.replace(/^v/i, '');

  // 2. + 또는 - 구분자로 split (메타정보 분리)
  const parts = cleaned.split(/[+-]/);
  
  // 3. 각 파트에서 semver 찾고, 게임 버전 제외
  const gameVersionPattern = /^1\.(19|20|21|22|23|24)\.\d+$/; // MC 1.19.x ~ 1.24.x
  const candidates: string[] = [];
  
  for (const part of parts) {
    const semverMatch = part.match(/^(\d+)\.(\d+)\.(\d+)$/);
    if (semverMatch) {
      const version = semverMatch[0];
      // 마인크래프트 게임 버전 제외
      if (!gameVersionPattern.test(version)) {
        candidates.push(version);
      }
    }
  }
  
  // 4. 후보가 있으면 첫 번째 반환 (가장 앞에 있는 모드 버전)
  if (candidates.length > 0) {
    return candidates[0];
  }
  
  // 5. 후보가 없으면 모든 semver 찾기 (게임 버전 포함)
  const semverMatches = cleaned.match(/(\d+)\.(\d+)\.(\d+)/g);
  if (semverMatches && semverMatches.length > 0) {
    // 게임 버전이 아닌 것 우선
    const nonGameVersions = semverMatches.filter(v => !gameVersionPattern.test(v));
    if (nonGameVersions.length > 0) {
      return nonGameVersions[0];
    }
    // 전부 게임 버전이면 x.x 형식 찾기 (8.3 같은 모드 버전)
    const gameShortPattern = /^1\.(19|20|21|22|23|24)$/;
    for (const part of parts) {
      // x.x 형식인지 확인 (x.x.x는 제외)
      const shortMatch = part.match(/^(\d+)\.(\d+)$/);
      if (shortMatch && !gameShortPattern.test(shortMatch[0])) {
        return `${shortMatch[0]}.0`;
      }
    }
    // 마지막 수단으로 첫 번째 semver 반환
    return semverMatches[0];
  }

  // 6. x.x 형태
  const shortVersionMatch = cleaned.match(/(\d+)\.(\d+)/);
  if (shortVersionMatch) {
    return `${shortVersionMatch[0]}.0`;
  }

  // 7. x만 있는 경우
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
  const parsed1 = parseModVersion(v1);
  const parsed2 = parseModVersion(v2);

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
 * 최신 버전이 현재 버전보다 새로운지 확인
 * @param latest 최신 버전 문자열
 * @param current 현재 버전 문자열
 * @returns true if latest > current
 */
export function isNewerVersion(latest: string, current: string): boolean {
  if (!latest) return false;
  if (!current) return true;
  return compareVersions(latest, current) > 0;
}

/**
 * 버전이 유효한지 확인
 */
export function isValidVersion(version: string): boolean {
  if (!version) return false;
  const parsed = parseModVersion(version);
  return parsed !== '0.0.0' || version === '0.0.0';
}

/**
 * 버전 문자열을 표시용으로 포맷
 * @example
 * formatVersion("1.0.0+fabric") => "v1.0.0"
 */
export function formatVersion(version: string): string {
  const parsed = parseModVersion(version);
  return `v${parsed}`;
}
