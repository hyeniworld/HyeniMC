/**
 * Semantic Version 비교 및 파싱 유틸리티
 * @deprecated Use shared/utils/version instead
 * 
 * This file re-exports functions from shared/utils/version for backwards compatibility.
 */

export {
  parseModVersion as parseVersion,
  compareVersions,
  isNewerVersion,
  isValidVersion,
  formatVersion
} from '../../shared/utils/version';
