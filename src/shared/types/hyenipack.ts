/**
 * HyeniPack 모드팩 형식 타입 정의
 * 
 * 로컬 파일 기반 모드팩 시스템
 * .hyenipack 파일 (ZIP 형식) 구조:
 * - hyenipack.json: 메타데이터
 * - mods/: 실제 모드 JAR 파일들
 * - overrides/: config, options.txt 등
 */

import { LoaderType } from './profile';

/**
 * HyeniPack 매니페스트 (hyenipack.json)
 */
export interface HyeniPackManifest {
  // 포맷 버전
  formatVersion: 1;
  
  // 기본 정보
  name: string;
  version: string;
  author: string;
  description?: string;
  
  // 마인크래프트 설정
  minecraft: {
    version: string;              // "1.21.1"
    loaderType: LoaderType;       // "neoforge" | "fabric" | "forge" | "quilt"
    loaderVersion: string;        // "21.1.77"
  };
  
  // 모드 목록
  mods: HyeniPackModEntry[];
  
  // 생성 정보
  createdAt: string;
  exportedFrom?: {
    launcher: 'HyeniMC';
    version: string;              // 런처 버전
    profileName: string;          // 원본 프로필 이름
  };
}

/**
 * 혜니팩 모드 엔트리
 */
export interface HyeniPackModEntry {
  // 파일명
  fileName: string;               // "sodium-0.6.13.jar"
  
  // 원본 출처 정보 (참고용, 설치 시 ZIP의 mods/ 폴더에서 가져옴)
  metadata?: {
    name?: string;                // "Sodium"
    version?: string;             // "0.6.13"
    source?: ModSource;
    projectId?: string;           // Modrinth/CurseForge ID
    description?: string;
  };
  
  // 파일 검증
  sha256: string;
  size: number;                   // 바이트
}

/**
 * 모드 소스 타입
 */
export type ModSource = 'modrinth' | 'curseforge' | 'hyeniworld' | 'url' | 'local';

/**
 * Export 옵션
 */
export interface HyeniPackExportOptions {
  packName: string;
  version: string;
  author: string;
  description: string;
  selectedFiles: string[]; // 파일 트리에서 선택된 파일 경로 목록
}

/**
 * Import 시 진행 상태
 */
export interface HyeniPackImportProgress {
  stage: 'extracting' | 'installing_loader' | 'installing_mods' | 'applying_overrides' | 'complete';
  progress: number;              // 0-100
  message: string;
  currentMod?: string;
  totalMods?: number;
}

/**
 * 파일 트리 노드 (Export UI용)
 */
export interface FileTreeNode {
  path: string;
  name: string;
  type: 'file' | 'directory';
  size?: number;
  checked: boolean;
  children?: FileTreeNode[];
}

/**
 * 모드 메타데이터 (HyeniWorld 전용)
 */
export interface ModMetadata {
  updateChannel?: 'stable' | 'beta' | 'dev';
  autoUpdate?: boolean;
  priority?: number;
}

/**
 * 의존성 정의
 */
export interface Dependencies {
  [modId: string]: DependencyInfo;
}

/**
 * 의존성 정보
 */
export interface DependencyInfo {
  type: 'required' | 'optional' | 'incompatible';
  minVersion?: string;
  maxVersion?: string;
  exactVersion?: string;
}

/**
 * HyeniWorld 전용 설정
 */
export interface HyeniWorldConfig {
  serverId: string;
  serverAddress: string;
  authRequired: boolean;
  spaEnabled: boolean;
  workerModRegistry?: string;
  features?: HyeniWorldFeatures;
}

/**
 * HyeniWorld 기능 플래그
 */
export interface HyeniWorldFeatures {
  autoModUpdate?: boolean;
  serverResourceSync?: boolean;
  customAuth?: boolean;
}

/**
 * 모드팩 권장 설정
 */
export interface ModpackSettings {
  memory?: MemorySettings;
  java?: JavaSettings;
  resolution?: ResolutionSettings;
}

/**
 * 메모리 설정
 */
export interface MemorySettings {
  recommended: number;
  minimum: number;
}

/**
 * Java 설정
 */
export interface JavaSettings {
  minimumVersion: number;
  recommendedVersion: number;
}

/**
 * 해상도 설정
 */
export interface ResolutionSettings {
  width: number;
  height: number;
}

/**
 * 모드팩 메타데이터
 */
export interface ModpackMetadata {
  iconFile?: string;
  bannerFile?: string;
  readmeFile?: string;
  categories?: string[];
  tags?: string[];
  homepage?: string;
  issues?: string;
  discord?: string;
  changelogUrl?: string;
}

/**
 * HyeniPack 검증 결과
 */
export interface HyeniPackValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  manifest?: HyeniPackManifest;
}

/**
 * HyeniPack 설치 진행률
 */
export interface HyeniPackInstallProgress {
  stage: HyeniPackInstallStage;
  progress: number;
  message: string;
  currentMod?: string;
  totalMods?: number;
}

/**
 * 설치 단계
 */
export type HyeniPackInstallStage = 
  | 'validating'
  | 'downloading_mods'
  | 'installing_loader'
  | 'applying_overrides'
  | 'generating_metadata'
  | 'complete';

/**
 * HyeniPack 내보내기 옵션
 */
export interface HyeniPackExportOptions {
  includeOverrides: boolean;
  includeServerFiles: boolean;
  includeResourcePacks: boolean;
  includeShaderPacks: boolean;
  includeScreenshots: boolean;
  minify: boolean;
}

/**
 * 모드팩 업데이트 확인 결과
 */
export interface HyeniPackUpdateCheck {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  updateUrl?: string;
  changelog?: string;
  breaking: boolean;
}

/**
 * 설치된 모드의 메타 파일 (.meta.json)
 */
export interface InstalledModMeta {
  source: ModSource;
  sourceModId?: string;
  sourceFileId?: string;
  versionNumber: string;
  installedAt: string;
  installedFrom?: 'hyenipack' | 'manual' | 'update';
  modpackId?: string;
  modpackVersion?: string;
  updateChannel?: 'stable' | 'beta' | 'dev';
  autoUpdate?: boolean;
}

/**
 * HyeniPack 형식 감지 결과
 */
export interface HyeniPackDetectionResult {
  isHyeniPack: boolean;
  formatVersion?: number;
  name?: string;
  version?: string;
}

/**
 * 실패한 모드 정보
 */
export interface FailedMod {
  fileName: string;
  reason: string;
  category: 'api_error' | 'download_failed' | 'checksum_mismatch' | 'not_found' | 'timeout';
  retryable: boolean;
  attempts: number;
  lastError?: string;
}

/**
 * Import 결과 (확장)
 */
export interface HyeniPackImportResult {
  success: boolean;
  expectedMods: number;
  installedMods: number;
  failedMods: FailedMod[];
  partialSuccess: boolean;
  minecraftVersion?: string;
  loaderType?: string;
  loaderVersion?: string;
  warning?: string;
  error?: string;
}

/**
 * 상세 진행률 정보
 */
export interface DetailedImportProgress extends HyeniPackImportProgress {
  installedMods?: number;
  failedMods?: number;
  retryingMods?: string[];
  estimatedTimeRemaining?: number;
}
