import { app } from 'electron';
import * as path from 'path';

/**
 * Get base HyeniMC data directory
 */
export function getDataDir(): string {
  return app.getPath('userData');
}

/**
 * Get shared resources directory (libraries, assets)
 */
export function getSharedDir(): string {
  return path.join(getDataDir(), 'shared');
}

/**
 * Get shared libraries directory
 */
export function getSharedLibrariesDir(): string {
  return path.join(getSharedDir(), 'libraries');
}

/**
 * Get shared assets directory
 */
export function getSharedAssetsDir(): string {
  return path.join(getSharedDir(), 'assets');
}

/**
 * Get instances base directory
 */
export function getInstancesDir(): string {
  return path.join(getDataDir(), 'instances');
}

/**
 * Get specific profile instance directory
 */
export function getProfileInstanceDir(profileId: string): string {
  return path.join(getInstancesDir(), profileId);
}

/**
 * Get profile versions directory
 */
export function getProfileVersionsDir(profileId: string): string {
  return path.join(getProfileInstanceDir(profileId), 'versions');
}

/**
 * Get profile saves directory
 */
export function getProfileSavesDir(profileId: string): string {
  return path.join(getProfileInstanceDir(profileId), 'saves');
}

/**
 * Get profile resourcepacks directory
 */
export function getProfileResourcePacksDir(profileId: string): string {
  return path.join(getProfileInstanceDir(profileId), 'resourcepacks');
}

/**
 * Get profile screenshots directory
 */
export function getProfileScreenshotsDir(profileId: string): string {
  return path.join(getProfileInstanceDir(profileId), 'screenshots');
}

/**
 * Get profile mods directory
 */
export function getProfileModsDir(profileId: string): string {
  return path.join(getProfileInstanceDir(profileId), 'mods');
}
