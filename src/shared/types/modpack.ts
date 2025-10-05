/**
 * 모드팩 관련 타입 정의
 */

import { LoaderType } from './profile';

export interface Modpack {
  id: string;
  slug: string;
  name: string;
  description: string;
  author: string;
  
  source: 'modrinth' | 'curseforge';
  
  iconUrl?: string;
  bannerUrl?: string;
  
  gameVersion: string;
  loaderType: LoaderType;
  loaderVersion: string;
  
  versions: ModpackVersion[];
  
  downloads: number;
  followers: number;
  
  categories: string[];
  tags: string[];
  
  websiteUrl?: string;
  sourceUrl?: string;
  issuesUrl?: string;
  
  createdAt: Date;
  updatedAt: Date;
}

export interface ModpackVersion {
  id: string;
  name: string;
  versionNumber: string;
  changelog?: string;
  
  gameVersion: string;
  loaderVersion: string;
  
  downloadUrl: string;
  fileSize: number;
  sha1?: string;
  sha512?: string;
  
  dependencies: ModpackDependency[];
  
  downloads: number;
  publishedAt: Date;
}

export interface ModpackDependency {
  projectId: string;
  versionId: string;
  fileName: string;
  required: boolean;
}

export interface ModpackSearchFilters {
  gameVersion?: string;
  loaderType?: LoaderType;
  categories?: string[];
  source?: 'modrinth' | 'curseforge' | 'all';
  limit?: number;
  offset?: number;
}

export interface ModpackInstallProgress {
  stage: 'downloading' | 'extracting' | 'installing-loader' | 'installing-mods' | 'finalizing';
  progress: number;
  currentFile?: string;
  totalFiles?: number;
}

export interface ModpackUpdate {
  currentVersion: string;
  latestVersion: string;
  versionId: string;
  changelog?: string;
}

export interface ModpackManifest {
  name: string;
  version: string;
  author: string;
  
  minecraft: {
    version: string;
    loaders: Array<{
      id: string;
      primary: boolean;
    }>;
  };
  
  files: Array<{
    projectId: string;
    fileId: string;
    required: boolean;
  }>;
  
  overrides?: string;
}
