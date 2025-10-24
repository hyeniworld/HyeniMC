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
import { HyeniPackManifest, HyeniPackImportProgress } from '../../shared/types/hyenipack';
import { metadataManager } from './metadata-manager';
import { downloadRpc } from '../grpc/clients';
import { ModrinthAPI } from './modrinth-api';
import { CurseForgeAPI } from './curseforge-api';

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

export class HyeniPackImporter {
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
    onProgress?: (progress: HyeniPackImportProgress) => void
  ): Promise<{
    success: boolean;
    installedMods: number;
    minecraftVersion?: string;
    loaderType?: string;
    loaderVersion?: string;
    error?: string;
  }> {
    try {
      onProgress?.({
        stage: 'extracting',
        progress: 0,
        message: '혜니팩 파일 읽는 중...',
      });
      
      // 1. manifest 읽기
      const manifest = await this.previewHyeniPack(packFilePath);
      const zip = new AdmZip(packFilePath);
      
      console.log(`[HyeniPackImporter] Importing: ${manifest.name} v${manifest.version}`);
      console.log(`[HyeniPackImporter] Instance dir: ${instanceDir}`);
      
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
      
      onProgress?.({
        stage: 'installing_mods',
        progress: 20,
        message: '모드 설치 중...',
        totalMods: manifest.mods.length,
      });
      
      let installedCount = 0;
      
      for (let i = 0; i < manifest.mods.length; i++) {
        const modEntry = manifest.mods[i];
        
        onProgress?.({
          stage: 'installing_mods',
          progress: 20 + Math.floor((i / manifest.mods.length) * 50),
          message: `모드 설치 중... (${i + 1}/${manifest.mods.length})`,
          currentMod: modEntry.fileName,
          totalMods: manifest.mods.length,
        });
        
        // 메타데이터가 있는 모드는 다운로드
        if (modEntry.metadata && modEntry.metadata.source && modEntry.metadata.projectId) {
          try {
            console.log(`[HyeniPackImporter] Downloading mod from ${modEntry.metadata.source}: ${modEntry.fileName}`);
            
            // 버전 정보 가져오기
            let version: any;
            if (modEntry.metadata.source === 'curseforge') {
              const versions = await getCurseForgeAPI().getModVersions(modEntry.metadata.projectId);
              version = versions.find((v: any) => v.id === modEntry.metadata?.version);
            } else if (modEntry.metadata.source === 'modrinth') {
              const versions = await getModrinthAPI().getModVersions(modEntry.metadata.projectId);
              version = versions.find((v: any) => v.id === modEntry.metadata?.version);
            }
            
            if (!version || !version.downloadUrl) {
              console.error(`[HyeniPackImporter] Version not found: ${modEntry.fileName}`);
              continue;
            }
            
            // 다운로드 실행
            const destPath = path.join(modsDir, version.fileName);
            const req: any = {
              taskId: `hyenipack-${version.id}`,
              url: version.downloadUrl,
              destPath,
              profileId,
              type: 'mod',
              name: version.fileName,
              maxRetries: 3,
              concurrency: 1,
            };
            if (version.sha1) {
              req.checksum = { algo: 'sha1', value: version.sha1 };
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
            
            installedCount++;
            console.log(`[HyeniPackImporter] Downloaded: ${version.fileName}`);
          } catch (error) {
            console.error(`[HyeniPackImporter] Download error: ${modEntry.fileName}`, error);
          }
          continue;
        }
        
        // 로컬 모드는 ZIP에서 추출
        const zipEntry = zip.getEntry(`mods/${modEntry.fileName}`);
        
        if (!zipEntry) {
          console.warn(`[HyeniPackImporter] Mod not found in pack: ${modEntry.fileName}`);
          continue;
        }
        
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
        
        installedCount++;
        console.log(`[HyeniPackImporter] Installed local mod: ${modEntry.fileName}`);
      }
      
      // 4. overrides 적용
      onProgress?.({
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
      onProgress?.({
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
      
      onProgress?.({
        stage: 'complete',
        progress: 100,
        message: '가져오기 완료!',
      });
      
      console.log(`[HyeniPackImporter] Successfully imported: ${manifest.name}`);
      
      return {
        success: true,
        installedMods: installedCount,
        minecraftVersion: manifest.minecraft.version,
        loaderType: manifest.minecraft.loaderType,
        loaderVersion: manifest.minecraft.loaderVersion,
      };
      
    } catch (error: any) {
      console.error('[HyeniPackImporter] Import failed:', error);
      return {
        success: false,
        installedMods: 0,
        error: error.message || 'Unknown error',
      };
    }
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
