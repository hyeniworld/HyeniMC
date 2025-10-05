/**
 * 버전 관련 타입 정의
 */

import { LoaderType } from './profile';

export interface MinecraftVersion {
  id: string;
  type: 'release' | 'snapshot' | 'old_beta' | 'old_alpha';
  url: string;
  releaseTime: Date;
  sha1: string;
}

export interface VersionManifest {
  id: string;
  type: string;
  mainClass: string;
  libraries: Library[];
  assetIndex: AssetIndex;
  downloads: {
    client: Download;
    server: Download;
  };
  javaVersion: {
    majorVersion: number;
    component: string;
  };
}

export interface Library {
  name: string;
  downloads: {
    artifact?: {
      path: string;
      sha1: string;
      size: number;
      url: string;
    };
    classifiers?: Record<string, {
      path: string;
      sha1: string;
      size: number;
      url: string;
    }>;
  };
  rules?: Array<{
    action: 'allow' | 'disallow';
    os?: {
      name?: string;
      arch?: string;
    };
  }>;
  natives?: Record<string, string>;
}

export interface AssetIndex {
  id: string;
  sha1: string;
  size: number;
  totalSize: number;
  url: string;
}

export interface Download {
  sha1: string;
  size: number;
  url: string;
}

export interface LoaderVersion {
  version: string;
  stable: boolean;
  releaseTime?: Date;
}

export interface CompatibleLoaders {
  fabric: LoaderVersion[];
  forge: LoaderVersion[];
  neoforge: LoaderVersion[];
}

export interface VersionManifestIndex {
  latest: {
    release: string;
    snapshot: string;
  };
  versions: MinecraftVersion[];
}
