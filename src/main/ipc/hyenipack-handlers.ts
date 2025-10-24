/**
 * HyeniPack IPC Handlers
 */

import { ipcMain } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { hyeniPackExporter } from '../services/hyenipack-exporter';
import { hyeniPackImporter } from '../services/hyenipack-importer';
import { HyeniPackExportOptions, HyeniPackImportProgress, FileTreeNode } from '../../shared/types/hyenipack';

export function registerHyeniPackHandlers() {
  /**
   * 인스턴스 폴더 트리 가져오기
   */
  ipcMain.handle(
    'hyenipack:get-file-tree',
    async (event, instanceDir: string) => {
      try {
        const buildTree = async (dirPath: string, basePath: string): Promise<FileTreeNode[]> => {
          const entries = await fs.readdir(dirPath, { withFileTypes: true });
          const nodes: FileTreeNode[] = [];
          
          for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            const relativePath = path.relative(basePath, fullPath);
            
            // 제외할 폴더들
            if (entry.name === '.temp_modpack' || entry.name === '.temp_modpack_import' || 
                entry.name === 'saves' || entry.name === 'logs' || entry.name === 'crash-reports' ||
                entry.name.startsWith('.')) {
              continue;
            }
            
            if (entry.isDirectory()) {
              const children = await buildTree(fullPath, basePath);
              nodes.push({
                path: relativePath,
                name: entry.name,
                type: 'directory',
                checked: false,
                children
              });
            } else {
              const stat = await fs.stat(fullPath);
              nodes.push({
                path: relativePath,
                name: entry.name,
                type: 'file',
                size: stat.size,
                checked: false
              });
            }
          }
          
          return nodes.sort((a, b) => {
            if (a.type === b.type) return a.name.localeCompare(b.name);
            return a.type === 'directory' ? -1 : 1;
          });
        };
        
        const tree = await buildTree(instanceDir, instanceDir);
        return { success: true, tree };
      } catch (error: any) {
        console.error('[IPC HyeniPack] Get file tree failed:', error);
        return { success: false, error: error.message };
      }
    }
  );
  
  /**
   * 혜니팩 미리보기
   */
  ipcMain.handle(
    'hyenipack:preview',
    async (event, packFilePath: string) => {
      try {
        const manifest = await hyeniPackImporter.previewHyeniPack(packFilePath);
        return { success: true, manifest };
      } catch (error: any) {
        console.error('[IPC HyeniPack] Preview failed:', error);
        return { success: false, error: error.message };
      }
    }
  );
  
  /**
   * 혜니팩 가져오기
   */
  ipcMain.handle(
    'hyenipack:import',
    async (
      event,
      packFilePath: string,
      profileId: string,
      instanceDir: string,
      onProgress?: (progress: HyeniPackImportProgress) => void
    ) => {
      try {
        const result = await hyeniPackImporter.importHyeniPack(
          packFilePath,
          profileId,
          instanceDir,
          onProgress
        );
        return result;
      } catch (error: any) {
        console.error('[IPC HyeniPack] Import failed:', error);
        return { success: false, installedMods: 0, error: error.message };
      }
    }
  );
  
  /**
   * 혜니팩 내보내기
   */
  ipcMain.handle(
    'hyenipack:export',
    async (event, profileId: string, options: HyeniPackExportOptions, outputPath?: string) => {
      try {
        // Profile 정보 가져오기
        const { profileRpc } = await import('../grpc/clients');
        const { getProfileInstanceDir } = await import('../utils/paths');
        
        const pbProfile = await profileRpc.getProfile({ id: profileId });
        
        // Profile 데이터 변환
        const profile = {
          id: pbProfile.id || '',
          name: pbProfile.name || '',
          gameVersion: pbProfile.gameVersion || '',
          loaderType: (pbProfile.loaderType || 'fabric') as 'fabric' | 'neoforge' | 'forge' | 'quilt',
          loaderVersion: pbProfile.loaderVersion || '',
          gameDir: getProfileInstanceDir(profileId)
        };
        
        // Export 실행
        const filePath = await hyeniPackExporter.exportProfile(profile, options, outputPath);
        return { success: true, filePath };
      } catch (error: any) {
        console.error('[IPC HyeniPack] Export failed:', error);
        return { success: false, error: error.message };
      }
    }
  );
  
  console.log('[IPC] HyeniPack handlers registered');
}
