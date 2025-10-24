/**
 * HyeniPack Exporter
 * 
 * 프로필을 .hyenipack 파일로 내보내기
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { app } from 'electron';
import AdmZip from 'adm-zip';
import { HyeniPackManifest, HyeniPackModEntry, HyeniPackExportOptions } from '../../shared/types/hyenipack';
import { metadataManager } from './metadata-manager';

interface Profile {
  id: string;
  name: string;
  gameVersion: string;
  loaderType: 'fabric' | 'neoforge' | 'forge' | 'quilt';
  loaderVersion: string;
  gameDir: string;
}

export class HyeniPackExporter {
  /**
   * 프로필을 혜니팩 파일로 내보내기
   */
  async exportProfile(
    profile: Profile,
    options: HyeniPackExportOptions,
    outputPath?: string
  ): Promise<string> {
    const instanceDir = profile.gameDir;
    
    // 1. 임시 작업 디렉토리
    const tempDir = path.join(app.getPath('temp'), `hyenipack-${Date.now()}`);
    
    try {
      await fs.mkdir(tempDir, { recursive: true });
      
      console.log(`[HyeniPackExporter] Starting export for profile: ${profile.name}`);
      console.log(`[HyeniPackExporter] Temp dir: ${tempDir}`);
      
      // 2. hyenipack.json 생성
      const manifest = await this.createManifest(profile, options, instanceDir);
      await fs.writeFile(
        path.join(tempDir, 'hyenipack.json'),
        JSON.stringify(manifest, null, 2),
        'utf8'
      );
      console.log('[HyeniPackExporter] Manifest created');
      
      // 3. 메타데이터 수집 (mods 폴더용)
      const modsDir = path.join(instanceDir, 'mods');
      const metadata = await metadataManager.readUnifiedMetadata(modsDir);
      
      // 4. 선택된 파일들 복사
      const tempModsDir = path.join(tempDir, 'mods');
      const overridesDir = path.join(tempDir, 'overrides');
      await fs.mkdir(tempModsDir, { recursive: true });
      await fs.mkdir(overridesDir, { recursive: true });
      
      for (const relativePath of options.selectedFiles) {
        const srcPath = path.join(instanceDir, relativePath);
        
        try {
          const stat = await fs.stat(srcPath);
          
          // mods 폴더의 파일 처리
          if (relativePath.startsWith('mods/') || relativePath.startsWith('mods\\')) {
            const fileName = path.basename(relativePath);
            const modMeta = metadata?.mods[fileName];
            
            // 메타데이터가 있는 모드는 jar 파일을 포함하지 않음 (매니페스트에만 기록)
            if (modMeta && modMeta.source && modMeta.sourceModId) {
              console.log(`[HyeniPackExporter] Skipping mod with metadata: ${fileName} (will be downloaded on import)`);
              continue;
            }
            
            // 메타데이터가 없는 모드 (로컬/커스텀)는 jar 파일 포함
            const destPath = path.join(tempDir, relativePath);
            
            if (stat.isDirectory()) {
              await this.copyDirectory(srcPath, destPath);
              console.log(`[HyeniPackExporter] Copied mods directory: ${relativePath}`);
            } else {
              await fs.mkdir(path.dirname(destPath), { recursive: true });
              await fs.copyFile(srcPath, destPath);
              console.log(`[HyeniPackExporter] Copied local/custom mod: ${relativePath}`);
            }
          } else {
            // 나머지는 overrides/ 안에 복사
            const destPath = path.join(overridesDir, relativePath);
            
            if (stat.isDirectory()) {
              await this.copyDirectory(srcPath, destPath);
              console.log(`[HyeniPackExporter] Copied override directory: ${relativePath}`);
            } else {
              await fs.mkdir(path.dirname(destPath), { recursive: true });
              await fs.copyFile(srcPath, destPath);
              console.log(`[HyeniPackExporter] Copied override file: ${relativePath}`);
            }
          }
        } catch (error) {
          console.error(`[HyeniPackExporter] Failed to copy: ${relativePath}`, error);
        }
      }
      
      // 5. 아이콘 복사 (선택)
      const iconPath = path.join(instanceDir, 'icon.png');
      if (await this.fileExists(iconPath)) {
        await fs.copyFile(iconPath, path.join(tempDir, 'icon.png'));
        console.log('[HyeniPackExporter] Icon copied');
      }
      
      // 6. ZIP 압축
      const finalPath = outputPath || 
        path.join(
          app.getPath('downloads'),
          `${options.packName.replace(/[^a-zA-Z0-9-_]/g, '-')}-${options.version}.hyenipack`
        );
      
      await this.createZip(tempDir, finalPath);
      
      console.log(`[HyeniPackExporter] HyeniPack created: ${finalPath}`);
      return finalPath;
      
    } finally {
      // 7. 임시 디렉토리 삭제
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
        console.log('[HyeniPackExporter] Temp directory cleaned up');
      } catch (error) {
        console.error('[HyeniPackExporter] Failed to clean up temp directory:', error);
      }
    }
  }
  
  /**
   * manifest 생성
   */
  private async createManifest(
    profile: Profile,
    options: HyeniPackExportOptions,
    instanceDir: string
  ): Promise<HyeniPackManifest> {
    // 선택된 파일 중 mods 폴더의 파일들만 메타데이터 수집
    const modsDir = path.join(instanceDir, 'mods');
    const metadata = await metadataManager.readUnifiedMetadata(modsDir);
    
    const mods: HyeniPackModEntry[] = [];
    
    for (const relativePath of options.selectedFiles) {
      // mods/ 폴더의 파일만 처리
      if (!relativePath.startsWith('mods/') && !relativePath.startsWith('mods\\')) {
        continue;
      }
      
      const fileName = path.basename(relativePath);
      const filePath = path.join(instanceDir, relativePath);
      
      try {
        const stat = await fs.stat(filePath);
        if (stat.isDirectory()) continue; // 폴더는 건너뛰기
        
        const sha256 = await this.calculateSHA256(filePath);
        
        const modMeta = metadata?.mods[fileName];
        
        mods.push({
          fileName,
          metadata: modMeta ? {
            version: modMeta.sourceFileId || modMeta.versionNumber,
            source: modMeta.source,
            projectId: modMeta.sourceModId
          } : undefined,
          sha256,
          size: stat.size
        });
      } catch (error) {
        console.error(`[HyeniPackExporter] Failed to process mod: ${fileName}`, error);
      }
    }
    
    return {
      formatVersion: 1,
      name: options.packName,
      version: options.version,
      author: options.author,
      description: options.description,
      minecraft: {
        version: profile.gameVersion,
        loaderType: profile.loaderType,
        loaderVersion: profile.loaderVersion
      },
      mods,
      createdAt: new Date().toISOString(),
      exportedFrom: {
        launcher: 'HyeniMC',
        version: app.getVersion(),
        profileName: profile.name
      }
    };
  }
  
  /**
   * ZIP 생성
   */
  private async createZip(sourceDir: string, outputPath: string): Promise<void> {
    const zip = new AdmZip();
    
    // sourceDir의 모든 파일을 재귀적으로 추가
    const addDirectory = async (dirPath: string, zipPath: string = '') => {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        const entryZipPath = zipPath ? `${zipPath}/${entry.name}` : entry.name;
        
        if (entry.isDirectory()) {
          await addDirectory(fullPath, entryZipPath);
        } else {
          zip.addLocalFile(fullPath, zipPath);
        }
      }
    };
    
    await addDirectory(sourceDir);
    
    // ZIP 저장
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    zip.writeZip(outputPath);
  }
  
  /**
   * 파일 SHA256 계산
   */
  private async calculateSHA256(filePath: string): Promise<string> {
    const hash = crypto.createHash('sha256');
    const stream = (await fs.readFile(filePath));
    hash.update(stream);
    return hash.digest('hex');
  }
  
  /**
   * 디렉토리 복사 (안전)
   */
  private async copyDirectorySafe(srcDir: string, destDir: string): Promise<void> {
    try {
      await fs.access(srcDir);
      await this.copyDirectory(srcDir, destDir);
      console.log(`[HyeniPackExporter] Copied directory: ${path.basename(srcDir)}`);
    } catch (error) {
      // 디렉토리가 없으면 무시
      console.debug(`[HyeniPackExporter] Directory not found (skipping): ${srcDir}`);
    }
  }
  
  /**
   * 파일 복사 (안전)
   */
  private async copyFileSafe(srcPath: string, destPath: string): Promise<void> {
    try {
      await fs.access(srcPath);
      await fs.mkdir(path.dirname(destPath), { recursive: true });
      await fs.copyFile(srcPath, destPath);
      console.log(`[HyeniPackExporter] Copied file: ${path.basename(srcPath)}`);
    } catch (error) {
      // 파일이 없으면 무시
      console.debug(`[HyeniPackExporter] File not found (skipping): ${srcPath}`);
    }
  }
  
  /**
   * 디렉토리 재귀 복사
   */
  private async copyDirectory(srcDir: string, destDir: string): Promise<void> {
    await fs.mkdir(destDir, { recursive: true });
    
    const entries = await fs.readdir(srcDir, { withFileTypes: true });
    
    for (const entry of entries) {
      const srcPath = path.join(srcDir, entry.name);
      const destPath = path.join(destDir, entry.name);
      
      if (entry.isDirectory()) {
        await this.copyDirectory(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }
  
  /**
   * 파일 존재 여부 확인
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}

export const hyeniPackExporter = new HyeniPackExporter();
