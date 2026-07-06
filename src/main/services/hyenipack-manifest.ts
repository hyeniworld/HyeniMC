/**
 * HyeniPack V2 매니페스트/latest.json 빌더 (순수 함수 — Electron 비의존, 테스트 대상)
 */

import {
  HyeniPackManifestV2,
  HyeniPackModEntry,
  HyeniPackExportOptionsV2,
  HyeniPackLatestInfo,
} from '../../shared/types/hyenipack';

export const HYENIPACK_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

export function isValidHyenipackId(id: string): boolean {
  return HYENIPACK_ID_PATTERN.test(id);
}

export interface ManifestV2Input {
  profile: {
    name: string;
    gameVersion: string;
    loaderType: HyeniPackManifestV2['minecraft']['loaderType'];
    loaderVersion: string;
  };
  options: HyeniPackExportOptionsV2;
  mods: HyeniPackModEntry[];
  launcherVersion: string;
  createdAt: string; // ISO 8601 — 호출부 주입 (순수성 유지)
}

export function buildManifestV2(input: ManifestV2Input): HyeniPackManifestV2 {
  const { profile, options, mods, launcherVersion, createdAt } = input;

  if (!isValidHyenipackId(options.hyenipackId)) {
    throw new Error(
      `Invalid hyenipackId: "${options.hyenipackId}" (소문자/숫자/하이픈, 최대 64자)`
    );
  }
  if (!SEMVER_PATTERN.test(options.version)) {
    throw new Error(`Invalid version: "${options.version}" (SemVer x.y.z 형식 필요)`);
  }

  return {
    formatVersion: 2,
    hyenipackId: options.hyenipackId,
    name: options.packName,
    version: options.version,
    author: options.author,
    description: options.description,
    changelog: options.changelog,
    breaking: options.breaking ?? false,
    minecraft: {
      version: profile.gameVersion,
      loaderType: profile.loaderType,
      loaderVersion: profile.loaderVersion,
    },
    mods,
    overrides: options.overridePolicies,
    createdAt,
    exportedFrom: {
      launcher: 'HyeniMC',
      version: launcherVersion,
      profileName: profile.name,
    },
  };
}

export function buildLatestInfo(
  manifest: HyeniPackManifestV2,
  packSha256: string,
  packSize: number,
  releaseDate: string
): HyeniPackLatestInfo {
  return {
    hyenipackId: manifest.hyenipackId,
    name: manifest.name,
    version: manifest.version,
    changelog: manifest.changelog,
    breaking: manifest.breaking ?? false,
    fileSize: packSize,
    sha256: packSha256,
    releaseDate,
  };
}
