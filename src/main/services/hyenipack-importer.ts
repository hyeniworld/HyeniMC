/**
 * HyeniPack Importer
 * 
 * .hyenipack 파일을 가져와서 프로필 생성
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { app } from 'electron';
import AdmZip from 'adm-zip';
import { 
  HyeniPackManifest, 
  HyeniPackImportProgress,
  FailedMod,
  HyeniPackImportResult,
  DetailedImportProgress
} from '../../shared/types/hyenipack';
import { metadataManager } from './metadata-manager';
import { downloadRpc } from '../grpc/clients';
import { ModrinthAPI } from './modrinth-api';
import { CurseForgeAPI } from './curseforge-api';
import { retryManager } from '../utils/retry-manager';
import { TimeoutManager, withTimeout } from '../utils/timeout-manager';

// Lazy initialization
let modrinthAPI: ModrinthAPI;
let curseforgeAPI: CurseForgeAPI;

function getModrinthAPI(): ModrinthAPI {
  if (!modrinthAPI) modrinthAPI = new ModrinthAPI();
  return modrinthAPI;
}

function getCurseForgeAPI(): CurseForgeAPI {
  if (!curseforgeAPI) curseforgeAPI = new CurseForgeAPI();
  return curseforgeAPI;
}

// 타임아웃 설정 (밀리초)
const TIMEOUTS = {
  GLOBAL: 30 * 60 * 1000,        // 30분 (전체)
  API_BATCH: 5 * 60 * 1000,      // 5분 (API 수집)
  PER_DOWNLOAD: 10 * 60 * 1000,  // 10분 (모드당)
  STUCK_THRESHOLD: 3 * 60 * 1000, // 3분 (stuck 감지)
};

export class HyeniPackImporter {
  private failedMods: FailedMod[] = [];
  private installedCount: number = 0;
  private timeoutManager: TimeoutManager | null = null;
  /**
   * 혜니팩 파일 미리보기 (manifest만 읽기)
   */
  async previewHyeniPack(packFilePath: string): Promise<HyeniPackManifest> {
    const zip = new AdmZip(packFilePath);
    const manifestEntry = zip.getEntry('hyenipack.json');
    
    if (!manifestEntry) {
      throw new Error('Invalid hyenipack file: missing hyenipack.json');
    }
    
    const manifestText = manifestEntry.getData().toString('utf8');
    const manifest: HyeniPackManifest = JSON.parse(manifestText);
    
    // 포맷 버전 확인
    if (manifest.formatVersion !== 1) {
      throw new Error(`Unsupported format version: ${manifest.formatVersion}`);
    }
    
    return manifest;
  }
  
  /**
   * 혜니팩 가져오기
   */
  async importHyeniPack(
    packFilePath: string,
    profileId: string,
    instanceDir: string,
    onProgress?: (progress: DetailedImportProgress) => void,
    checkCancelled?: () => boolean
  ): Promise<HyeniPackImportResult> {
    // 초기화
    this.failedMods = [];
    this.installedCount = 0;
    this.timeoutManager = new TimeoutManager({
      globalTimeoutMs: TIMEOUTS.GLOBAL,
      stuckThresholdMs: TIMEOUTS.STUCK_THRESHOLD,
    });
    this.timeoutManager.start();

    let manifest: HyeniPackManifest | null = null;

    try {
      // 취소 체크
      if (checkCancelled?.()) {
        throw new Error('Installation cancelled by user');
      }

      this.updateProgress(onProgress, {
        stage: 'extracting',
        progress: 0,
        message: '혜니팩 파일 읽는 중...',
      });
      
      // 1. manifest 읽기
      manifest = await this.previewHyeniPack(packFilePath);
      const zip = new AdmZip(packFilePath);
      
      console.log(`[HyeniPackImporter] Importing: ${manifest.name} v${manifest.version}`);
      console.log(`[HyeniPackImporter] Instance dir: ${instanceDir}`);
      
      // 취소 체크
      if (checkCancelled?.()) {
        throw new Error('Installation cancelled by user');
      }

      onProgress?.({
        stage: 'extracting',
        progress: 10,
        message: '압축 해제 중...',
      });
      
      // 2. 인스턴스 디렉토리 생성
      await fs.mkdir(instanceDir, { recursive: true });
      
      // 3. mods/ 디렉토리 생성 및 모드 압축 해제
      const modsDir = path.join(instanceDir, 'mods');
      await fs.mkdir(modsDir, { recursive: true });
      
      this.updateProgress(onProgress, {
        stage: 'installing_mods',
        progress: 20,
        message: '모드 정보 수집 중...',
        totalMods: manifest.mods.length,
      });
      
      // 1단계: 모든 모드의 다운로드 정보를 병렬로 수집
      const downloadTasks: Array<{
        modEntry: any;
        finalFileName: string;
        downloadUrl: string;
        sha1?: string;
      }> = [];
      
      const localMods: any[] = [];
      
      // API 호출을 병렬로 처리 (재시도 + 타임아웃)
      const apiPromises = manifest.mods.map(async (modEntry) => {
        if (modEntry.metadata && modEntry.metadata.source && modEntry.metadata.projectId) {
          let attempts = 0;
          try {
            // API 호출을 재시도와 함께 실행 (최대 3회)
            const version = await retryManager.retryWithBackoff(
              async () => {
                attempts++;
                // 개별 API 호출에 30초 타임아웃
                return await withTimeout(
                  (async () => {
                    let ver: any;
                    if (modEntry.metadata!.source === 'curseforge') {
                      const versions = await getCurseForgeAPI().getModVersions(modEntry.metadata!.projectId!);
                      ver = versions.find((v: any) => v.id === modEntry.metadata!.version);
                    } else if (modEntry.metadata!.source === 'modrinth') {
                      const versions = await getModrinthAPI().getModVersions(modEntry.metadata!.projectId!);
                      ver = versions.find((v: any) => v.id === modEntry.metadata!.version);
                    }
                    return ver;
                  })(),
                  30000,
                  `API timeout: ${modEntry.fileName}`
                );
              },
              `API call for ${modEntry.fileName}`,
              { 
                maxRetries: 3,
                initialDelayMs: 1000,
                maxDelayMs: 10000,
              }
            );
            
            if (version && version.downloadUrl) {
              let finalFileName = version.fileName;
              if (modEntry.fileName.endsWith('.disabled') && !finalFileName.endsWith('.disabled')) {
                finalFileName = `${finalFileName}.disabled`;
              }
              
              downloadTasks.push({
                modEntry,
                finalFileName,
                downloadUrl: version.downloadUrl,
                sha1: version.sha1,
              });
            } else {
              console.error(`[HyeniPackImporter] Version not found after ${attempts} attempts: ${modEntry.fileName}`);
              // 3회 재시도 후에도 버전을 찾을 수 없는 경우
              this.failedMods.push({
                fileName: modEntry.fileName,
                reason: 'API에서 버전 정보를 찾을 수 없음 (3회 재시도 완료)',
                category: 'api_error',
                retryable: false, // 더 이상 재시도 불가
                attempts,
              });
            }
          } catch (error: any) {
            console.error(`[HyeniPackImporter] API error after ${attempts} attempts for ${modEntry.fileName}:`, error);
            // 3회 재시도 후 최종 실패
            this.failedMods.push({
              fileName: modEntry.fileName,
              reason: error.message || 'API 호출 실패 (3회 재시도 완료)',
              category: error.message?.includes('timeout') ? 'timeout' : 'api_error',
              retryable: false, // 모든 재시도 소진
              attempts,
              lastError: error.message,
            });
          }
        } else {
          // 로컬 모드는 나중에 처리
          localMods.push(modEntry);
        }
      });
      
      // 전체 API 배치에 5분 타임아웃 + 취소 체크
      const cancelPromise = new Promise<never>((_, reject) => {
        const checkInterval = setInterval(() => {
          if (checkCancelled?.()) {
            clearInterval(checkInterval);
            reject(new Error('Installation cancelled by user'));
          }
        }, 500); // 0.5초마다 취소 체크
        
        // API 배치 완료 시 인터벌 정리
        Promise.all(apiPromises).finally(() => clearInterval(checkInterval));
      });
      
      await withTimeout(
        Promise.race([Promise.all(apiPromises), cancelPromise]),
        TIMEOUTS.API_BATCH,
        'API 수집 시간 초과 (5분)'
      );
      
      console.log(`[HyeniPackImporter] Collected ${downloadTasks.length} mods to download`);
      
      // 2단계: 수집된 정보로 다운로드 실행
      this.updateProgress(onProgress, {
        stage: 'installing_mods',
        progress: 30,
        message: '모드 다운로드 중...',
        totalMods: downloadTasks.length + localMods.length,
      });
      
      // installedCount는 클래스 멤버 변수 사용
      
      for (let i = 0; i < downloadTasks.length; i++) {
        // 취소 체크
        if (checkCancelled?.()) {
          throw new Error('Installation cancelled by user');
        }
        
        // 타임아웃 체크
        if (this.timeoutManager?.isGlobalTimeout()) {
          throw new Error('전역 타임아웃 초과 (30분)');
        }
        if (this.timeoutManager?.isStuck()) {
          throw new Error('설치가 3분 이상 진행되지 않았습니다');
        }

        const task = downloadTasks[i];
        
        this.updateProgress(onProgress, {
          stage: 'installing_mods',
          progress: 30 + Math.floor((i / (downloadTasks.length + localMods.length)) * 40),
          message: `모드 다운로드 중... (${i + 1}/${downloadTasks.length + localMods.length})`,
          currentMod: task.finalFileName,
          totalMods: downloadTasks.length + localMods.length,
        });
        
        try {
          const destPath = path.join(modsDir, task.finalFileName);
          const req: any = {
            taskId: `hyenipack-${i}-${Date.now()}`,
            url: task.downloadUrl,
            destPath,
            profileId,
            type: 'mod',
            name: task.finalFileName,
            maxRetries: 3,
            concurrency: 1,
          };
          if (task.sha1) {
            req.checksum = { algo: 'sha1', value: task.sha1 };
          }
          
          const started = await downloadRpc.startDownload(req);
          await new Promise<void>((resolve, reject) => {
            const cancel = downloadRpc.streamProgress(
              { profileId } as any,
              (ev) => {
                if (ev.taskId !== started.taskId) return;
                if (ev.status === 'completed') { cancel(); resolve(); }
                else if (ev.status === 'failed' || ev.status === 'cancelled') { 
                  cancel(); 
                  reject(new Error(ev.error || '다운로드 실패')); 
                }
              },
              (err) => {
                if (err && ('' + err).includes('CANCELLED')) return;
                if (err) reject(err);
              }
            );
          });
          
          this.installedCount++;
          console.log(`[HyeniPackImporter] Downloaded: ${task.finalFileName}`);
        } catch (error: any) {
          console.error(`[HyeniPackImporter] Download error: ${task.finalFileName}`, error);
          
          // 실패 모드 추적
          this.failedMods.push({
            fileName: task.finalFileName,
            reason: error.message || 'Download failed',
            category: error.message?.includes('checksum') ? 'checksum_mismatch' : 'download_failed',
            retryable: true,
            attempts: 1,
            lastError: error.message,
          });
        }
      }
      
      // 3단계: 로컬 모드 처리
      for (let i = 0; i < localMods.length; i++) {
        // 취소 & 타임아웃 체크
        if (checkCancelled?.()) {
          throw new Error('Installation cancelled by user');
        }
        if (this.timeoutManager?.isGlobalTimeout()) {
          throw new Error('전역 타임아웃 초과 (30분)');
        }
        
        const modEntry = localMods[i];
        
        this.updateProgress(onProgress, {
          stage: 'installing_mods',
          progress: 30 + Math.floor(((downloadTasks.length + i) / (downloadTasks.length + localMods.length)) * 40),
          message: `모드 설치 중... (${downloadTasks.length + i + 1}/${downloadTasks.length + localMods.length})`,
          currentMod: modEntry.fileName,
          totalMods: downloadTasks.length + localMods.length,
        });
        
        // 로컬 모드는 ZIP에서 추출
        const zipEntry = zip.getEntry(`mods/${modEntry.fileName}`);
        
        if (!zipEntry) {
          console.warn(`[HyeniPackImporter] Mod not found in pack: ${modEntry.fileName}`);
          this.failedMods.push({
            fileName: modEntry.fileName,
            reason: 'ZIP 파일에 모드가 없음',
            category: 'not_found',
            retryable: false,
            attempts: 1,
          });
          continue;
        }
        
        try {
          const destPath = path.join(modsDir, modEntry.fileName);
          
          // 파일 추출
          const buffer = zipEntry.getData();
          await fs.writeFile(destPath, buffer);
          
          // SHA256 검증
          const actualSha256 = await this.calculateSHA256(destPath);
          if (actualSha256 !== modEntry.sha256) {
            console.error(`[HyeniPackImporter] Checksum mismatch: ${modEntry.fileName}`);
            console.error(`[HyeniPackImporter] Expected: ${modEntry.sha256}`);
            console.error(`[HyeniPackImporter] Got: ${actualSha256}`);
            
            // 손상된 파일 삭제
            await fs.unlink(destPath);
            throw new Error(`파일 손상: ${modEntry.fileName}`);
          }
          
          this.installedCount++;
          console.log(`[HyeniPackImporter] Installed local mod: ${modEntry.fileName}`);
        } catch (error: any) {
          console.error(`[HyeniPackImporter] Local mod error: ${modEntry.fileName}`, error);
          this.failedMods.push({
            fileName: modEntry.fileName,
            reason: error.message || '로컬 모드 설치 실패',
            category: error.message?.includes('손상') ? 'checksum_mismatch' : 'download_failed',
            retryable: false,
            attempts: 1,
            lastError: error.message,
          });
        }
      }
      
      // 4. overrides 적용
      this.updateProgress(onProgress, {
        stage: 'applying_overrides',
        progress: 70,
        message: '설정 파일 적용 중...',
      });
      
      const entries = zip.getEntries();
      const overrideEntries = entries.filter(e => 
        e.entryName.startsWith('overrides/') && !e.isDirectory
      );
      
      for (const entry of overrideEntries) {
        // overrides/ 제거하고 instanceDir에 추출
        const relativePath = entry.entryName.replace(/^overrides\//, '');
        const destPath = path.join(instanceDir, relativePath);
        
        await fs.mkdir(path.dirname(destPath), { recursive: true });
        
        const buffer = entry.getData();
        await fs.writeFile(destPath, buffer);
        
        console.log(`[HyeniPackImporter] Applied override: ${relativePath}`);
      }
      
      // 5. 통합 메타데이터 생성
      this.updateProgress(onProgress, {
        stage: 'applying_overrides',
        progress: 90,
        message: '메타데이터 생성 중...',
      });
      
      await this.createMetadata(modsDir, manifest);
      
      // 6. 아이콘 추출 (있으면)
      const iconEntry = zip.getEntry('icon.png');
      if (iconEntry) {
        const iconPath = path.join(instanceDir, 'icon.png');
        const buffer = iconEntry.getData();
        await fs.writeFile(iconPath, buffer);
        console.log('[HyeniPackImporter] Icon extracted');
      }
      
      this.updateProgress(onProgress, {
        stage: 'complete',
        progress: 100,
        message: '가져오기 완료!',
      });
      
      console.log(`[HyeniPackImporter] Successfully imported: ${manifest.name}`);
      
      return this.buildResult(manifest);
      
    } catch (error: any) {
      console.error('[HyeniPackImporter] Import failed:', error);
      return this.buildErrorResult(manifest?.mods?.length || 0, error);
    } finally {
      this.timeoutManager?.stop();
    }
  }

  /**
   * 진행 상태 업데이트 헬퍼
   */
  private updateProgress(
    onProgress: ((progress: DetailedImportProgress) => void) | undefined,
    progress: HyeniPackImportProgress
  ) {
    this.timeoutManager?.updateProgress();
    
    const detailedProgress: DetailedImportProgress = {
      ...progress,
      installedMods: this.installedCount,
      failedMods: this.failedMods.length,
    };
    
    onProgress?.(detailedProgress);
  }

  /**
   * 최종 결과 구축
   */
  private buildResult(manifest: HyeniPackManifest): HyeniPackImportResult {
    const expectedMods = manifest.mods.length;
    const partialSuccess = this.installedCount > 0 && this.failedMods.length > 0;
    
    return {
      success: this.failedMods.length === 0,
      expectedMods,
      installedMods: this.installedCount,
      failedMods: this.failedMods,
      partialSuccess,
      minecraftVersion: manifest.minecraft.version,
      loaderType: manifest.minecraft.loaderType,
      loaderVersion: manifest.minecraft.loaderVersion,
      warning: this.failedMods.length > 0 
        ? `${this.failedMods.length}개 모드 설치 실패` 
        : undefined,
    };
  }

  /**
   * 에러 결과 구축
   */
  private buildErrorResult(expectedMods: number, error: any): HyeniPackImportResult {
    return {
      success: false,
      expectedMods,
      installedMods: this.installedCount,
      failedMods: this.failedMods,
      partialSuccess: false,
      error: error.message || 'Unknown error',
    };
  }
  
  /**
   * 통합 메타데이터 생성
   */
  private async createMetadata(
    modsDir: string,
    manifest: HyeniPackManifest
  ): Promise<void> {
    const metadata: any = {
      version: 1,
      source: 'hyenipack',
      installedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      hyeniPack: {
        name: manifest.name,
        version: manifest.version,
        author: manifest.author,
      },
      mods: {}
    };
    
    for (const modEntry of manifest.mods) {
      metadata.mods[modEntry.fileName] = {
        source: modEntry.metadata?.source || 'local',
        sourceModId: modEntry.metadata?.projectId,
        versionNumber: modEntry.metadata?.version || 'unknown',
        installedAt: new Date().toISOString(),
        installedFrom: 'hyenipack',
        hyeniPackName: manifest.name,
        hyeniPackVersion: manifest.version,
      };
    }
    
    await metadataManager.writeUnifiedMetadata(modsDir, metadata);
    console.log('[HyeniPackImporter] Metadata created');
  }
  
  /**
   * 파일 SHA256 계산
   */
  private async calculateSHA256(filePath: string): Promise<string> {
    const hash = crypto.createHash('sha256');
    const buffer = await fs.readFile(filePath);
    hash.update(buffer);
    return hash.digest('hex');
  }
}

export const hyeniPackImporter = new HyeniPackImporter();
