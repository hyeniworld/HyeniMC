/**
 * 파일 시스템 경로 상수
 */

import { app } from 'electron';
import path from 'path';
import os from 'os';

// 앱 데이터 디렉토리
export const getAppDataPath = (): string => {
  if (process.env.NODE_ENV === 'development') {
    return path.join(process.cwd(), '.hyenimc-dev');
  }
  return path.join(app?.getPath('userData') || os.homedir(), '.hyenimc');
};

// 기본 마인크래프트 디렉토리
export const getDefaultMinecraftPath = (): string => {
  switch (process.platform) {
    case 'darwin':
      return path.join(os.homedir(), 'Library/Application Support/minecraft');
    case 'win32':
      return path.join(os.homedir(), 'AppData/Roaming/.minecraft');
    default:
      return path.join(os.homedir(), '.minecraft');
  }
};

// 앱 내부 경로
export const APP_PATHS = {
  CONFIG: 'config.json',
  PROFILES: 'profiles',
  INSTANCES: 'instances',
  CACHE: 'cache',
  RUNTIME: 'runtime',
  DOWNLOADS: 'downloads',
  LOGS: 'logs',
} as const;

// 캐시 경로
export const CACHE_PATHS = {
  VERSIONS: 'versions',
  MODS: 'mods',
  MODPACKS: 'modpacks',
} as const;

// 런타임 경로
export const RUNTIME_PATHS = {
  JAVA: 'java',
  MINECRAFT: 'minecraft',
  LOADERS: 'loaders',
} as const;

// 마인크래프트 경로
export const MINECRAFT_PATHS = {
  VERSIONS: 'versions',
  LIBRARIES: 'libraries',
  ASSETS: 'assets',
} as const;

// 인스턴스 경로
export const INSTANCE_PATHS = {
  MODS: 'mods',
  CONFIG: 'config',
  SAVES: 'saves',
  RESOURCEPACKS: 'resourcepacks',
  SHADERPACKS: 'shaderpacks',
  LOGS: 'logs',
  CRASH_REPORTS: 'crash-reports',
} as const;
