/**
 * Worker Mods Types
 * Types for Worker API v2 multi-mod update system
 */

// Registry API Response
export interface WorkerModRegistryResponse {
  version: string;
  mods: WorkerModRegistryItem[];
  lastUpdated: string;
}

export interface WorkerModRegistryItem {
  id: string;
  name: string | null;  // Can be null, fallback to id
  latestVersion: string;
  description: string;
  category: 'required' | 'optional';
  gameVersions: string[];
  loaders: WorkerModLoader[];
  dependencies?: {
    required: string[];
    optional: string[];
  };
}

export interface WorkerModLoader {
  type: string;  // "neoforge" | "forge" | "fabric" | "quilt"
  minVersion: string;
  maxVersion: string | null;
  supportedGameVersions: (string | null)[];
}

// Latest API Response
export interface WorkerModLatestResponse {
  version: string;
  name: string | null;
  gameVersions: string[];
  releaseDate: string;
  modId: string;
  changelog?: string;
  loaders: {
    [loaderType: string]: {
      gameVersions: {
        [gameVersion: string]: {
          file: string;
          sha256: string;
          size: number;
          downloadPath: string;
          downloadUrl: string;
          minLoaderVersion: string;
          maxLoaderVersion: string | null;
          dependencies?: {
            required?: string[];
            optional?: string[];
          };
        };
      };
    };
  };
}

// Update Check Result
export interface WorkerModUpdateCheck {
  modId: string;
  name: string;  // Never null (uses id as fallback)
  currentVersion: string | null;
  latestVersion: string;
  available: boolean;
  isInstalled: boolean;  // Already installed in profile
  category: 'required' | 'optional';
  downloadUrl: string;
  sha256: string;
  size: number;
  changelog: string;
  gameVersion: string;
  loader: string;
}

// Install Progress
export interface WorkerModInstallProgress {
  modId: string;
  modName: string;
  progress: number;  // 0-100
  status: 'downloading' | 'installing' | 'complete' | 'error';
  message?: string;
}

// Install Result
export interface WorkerModInstallResult {
  modId: string;
  success: boolean;
  error?: string;
}
