/**
 * 프로필 관련 타입 정의
 */

export type LoaderType = 'vanilla' | 'fabric' | 'forge' | 'neoforge' | 'quilt';

export interface Profile {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  
  // 게임 버전 정보
  gameVersion: string;
  loaderType: LoaderType;
  loaderVersion?: string;
  
  // 경로 설정
  gameDirectory: string;
  
  // Java 설정
  javaPath?: string;
  jvmArgs: string[];
  memory: {
    min: number;
    max: number;
  };
  
  // 게임 설정
  gameArgs: string[];
  resolution?: {
    width: number;
    height: number;
  };
  fullscreen?: boolean;
  
  // 모드 관리
  mods: Mod[];
  modpackId?: string;
  modpackSource?: 'modrinth' | 'curseforge';
  
  // 메타데이터
  createdAt: Date;
  updatedAt: Date;
  lastPlayed?: Date;
  totalPlayTime: number;
  
  // 추후 추가 예정
  authRequired?: boolean;
  spaEnabled?: boolean;
  serverAddress?: string;
  favorite: boolean;
}

export interface CreateProfileData {
  name: string;
  description?: string;
  gameVersion: string;
  loaderType: LoaderType;
  loaderVersion?: string;
  icon?: string;
}

export interface ManualProfileData extends CreateProfileData {
  memory?: { min: number; max: number };
  jvmArgs?: string[];
  gameArgs?: string[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// Mod 관련 타입
export type ModSource = 'modrinth' | 'curseforge' | 'local' | 'custom' | 'url';

export interface Mod {
  id: string;
  name: string;
  version: string;
  fileName: string;
  
  // 소스 정보
  source: ModSource;
  modId?: string;  // Source mod ID (Modrinth project ID or CurseForge mod ID)
  sourceId?: string;
  projectSlug?: string;
  fileId?: string;
  
  // 메타데이터
  description?: string;
  author?: string;
  iconUrl?: string;
  websiteUrl?: string;
  
  // 의존성
  dependencies: ModDependency[];
  
  // 상태
  enabled: boolean;
  required: boolean;
  
  // 호환성
  gameVersions: string[];
  loaders: LoaderType[];
  
  // 업데이트
  updateAvailable?: boolean;
  latestVersion?: string;
  
  // 파일 정보
  fileSize: number;
  sha1?: string;
  sha512?: string;
  
  installedAt: Date;
  updatedAt?: Date;
}

export interface ModDependency {
  modId: string;
  type: 'required' | 'optional' | 'incompatible' | 'embedded';
  versionRange?: string;
}

export interface InstallModData {
  source: ModSource;
  projectId: string;
  versionId?: string;
  required?: boolean;
}

export type ModSearchSortOption = 
  | 'relevance'      // 관련성 (기본값)
  | 'downloads'      // 다운로드 수
  | 'updated'        // 업데이트순
  | 'newest';        // 최신순

export interface ModSearchFilters {
  gameVersion?: string;
  loaderType?: LoaderType;
  categories?: string[];
  source?: ModSource;
  limit?: number;
  offset?: number;
  sortBy?: ModSearchSortOption;
}

export interface ModSearchResult {
  id: string;
  slug: string;
  name: string;
  description: string;
  author: string;
  iconUrl?: string;
  downloads: number;
  followers: number;
  categories: string[];
  gameVersions: string[];
  loaders: LoaderType[];
  source: ModSource;
  updatedAt: Date;
}

export interface ModDetails extends ModSearchResult {
  body: string;
  gallery?: Array<{
    url: string;
    title?: string;
    description?: string;
  }>;
  websiteUrl?: string;
  sourceUrl?: string;
  issuesUrl?: string;
  license?: string;
  versions: ModVersion[];
}

export interface ModVersion {
  id: string;
  versionNumber: string;
  name: string;
  changelog?: string;
  gameVersions: string[];
  loaders: LoaderType[];
  downloadUrl: string;
  fileName: string;
  fileSize: number;
  sha1?: string;
  sha512?: string;
  dependencies: ModDependency[];
  publishedAt: Date;
}

export interface ModUpdate {
  mod: Mod;
  currentVersion: string;
  latestVersion: string;
  versionId: string;
  changelog?: string;
  required: boolean;
}

export interface UpdateResult {
  success: Mod[];
  failed: Array<{ mod: Mod; error: string }>;
  skipped: Mod[];
}

export interface DependencyIssue {
  mod: Mod;
  type: 'missing' | 'incompatible' | 'version-mismatch';
  dependency: ModDependency;
  suggestion?: string;
}

export interface CompatibilityResult {
  compatible: boolean;
  issues: string[];
  warnings: string[];
}
