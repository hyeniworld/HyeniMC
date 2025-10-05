/**
 * 기본값 상수
 */

import { AppConfig } from '../types';

export const DEFAULT_MEMORY = {
  MIN: 1024, // 1GB
  MAX: 4096, // 4GB
  RECOMMENDED_MIN: 2048, // 2GB
  RECOMMENDED_MAX: 4096, // 4GB
} as const;

export const DEFAULT_JVM_ARGS = [
  '-XX:+UseG1GC',
  '-XX:+ParallelRefProcEnabled',
  '-XX:MaxGCPauseMillis=200',
  '-XX:+UnlockExperimentalVMOptions',
  '-XX:+DisableExplicitGC',
  '-XX:+AlwaysPreTouch',
  '-XX:G1NewSizePercent=30',
  '-XX:G1MaxNewSizePercent=40',
  '-XX:G1HeapRegionSize=8M',
  '-XX:G1ReservePercent=20',
  '-XX:G1HeapWastePercent=5',
  '-XX:G1MixedGCCountTarget=4',
  '-XX:InitiatingHeapOccupancyPercent=15',
  '-XX:G1MixedGCLiveThresholdPercent=90',
  '-XX:G1RSetUpdatingPauseTimePercent=5',
  '-XX:SurvivorRatio=32',
  '-XX:+PerfDisableSharedMem',
  '-XX:MaxTenuringThreshold=1',
] as const;

export const DEFAULT_GAME_ARGS: string[] = [];

export const DEFAULT_RESOLUTION = {
  WIDTH: 1920,
  HEIGHT: 1080,
} as const;

export const DEFAULT_APP_CONFIG: AppConfig = {
  language: 'ko',
  theme: 'system',
  
  dataDirectory: '',
  defaultGameDirectory: '',
  
  autoDetectJava: true,
  javaExecutables: [],
  
  maxConcurrentDownloads: 3,
  downloadThreads: 4,
  
  autoCheckUpdates: true,
  autoUpdateRequired: true,
  updateCheckInterval: 60, // 60분
  
  useProxy: false,
  
  keepLauncherOpen: false,
  showConsole: true,
  enableAnalytics: false,
};

export const JAVA_VERSION_REQUIREMENTS = {
  '1.17': 16,
  '1.18': 17,
  '1.19': 17,
  '1.20': 17,
  '1.20.5': 21,
  '1.21': 21,
} as const;

export const DOWNLOAD_CONFIG = {
  MAX_CONCURRENT: 3,
  THREADS_PER_DOWNLOAD: 4,
  RETRY_ATTEMPTS: 3,
  TIMEOUT: 30000, // 30초
  CHUNK_SIZE: 1024 * 1024, // 1MB
} as const;

export const UPDATE_CHECK_INTERVAL = 60 * 60 * 1000; // 1시간 (밀리초)

export const SUPPORTED_LOADERS = ['vanilla', 'fabric', 'forge', 'neoforge'] as const;

export const MOD_FILE_EXTENSIONS = ['.jar'] as const;

export const MODPACK_FILE_EXTENSIONS = ['.zip', '.mrpack'] as const;
