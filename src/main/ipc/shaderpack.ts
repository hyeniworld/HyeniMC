import { ipcMain, dialog } from 'electron';
import { downloadRpc } from '../grpc/clients';
import { IPC_CHANNELS } from '../../shared/constants';
import { ShaderPackManager } from '../services/shaderpack-manager';
import { getProfileInstanceDir } from '../utils/paths';

/**
 * Register shader pack-related IPC handlers
 */
export function registerShaderPackHandlers(): void {
  // List shader packs for a profile
  ipcMain.handle(IPC_CHANNELS.SHADERPACK_LIST, async (_event, profileId: string) => {
    try {
      const gameDir = getProfileInstanceDir(profileId);
      const packManager = new ShaderPackManager();
      const packs = await packManager.listShaderPacks(gameDir);
      
      return packs.map(pack => ({
        fileName: pack.fileName,
        name: pack.name,
        enabled: pack.enabled,
        isDirectory: pack.isDirectory,
      }));
    } catch (error) {
      console.error('[IPC ShaderPack] Failed to list shader packs:', error);
      throw error;
    }
  });

  // Install shader pack from URL
  ipcMain.handle(IPC_CHANNELS.SHADERPACK_INSTALL_URL, async (_event, profileId: string, url: string, suggestedFileName?: string, checksum?: { algo: 'sha1'|'sha256'; value: string }) => {
    try {
      const gameDir = getProfileInstanceDir(profileId);
      const destDir = `${gameDir}/shaderpacks`;
      const fs = await import('fs/promises');
      await fs.mkdir(destDir, { recursive: true });

      const fileName = suggestedFileName || decodeURIComponent(new URL(url).pathname.split('/').pop() || 'shaderpack.zip');
      const destPath = `${destDir}/${fileName}`;

      const req: any = {
        taskId: `shaderpack-${Date.now()}`,
        url,
        destPath,
        profileId,
        type: 'shaderpack',
        name: fileName,
        maxRetries: 3,
      };
      if (checksum?.value) req.checksum = { algo: checksum.algo, value: checksum.value };

      const started = await downloadRpc.startDownload(req);
      await new Promise<void>((resolve, reject) => {
        const cancel = downloadRpc.streamProgress(
          { profileId } as any,
          (ev) => {
            if (ev.taskId !== started.taskId) return;
            if (ev.status === 'completed') { cancel(); resolve(); }
            else if (ev.status === 'failed' || ev.status === 'cancelled') { cancel(); reject(new Error(ev.error || '다운로드 실패')); }
          },
          (err) => {
            if (err && ('' + err).includes('CANCELLED')) return;
            if (err) reject(err);
          }
        );
      });

      return { success: true, fileName };
    } catch (error) {
      console.error('[IPC ShaderPack] Failed to install pack from URL:', error);
      throw error;
    }
  });

  // Select shader pack file
  ipcMain.handle(IPC_CHANNELS.SHADERPACK_SELECT_FILE, async () => {
    const result = await dialog.showOpenDialog({
      title: '셰이더팩 파일 선택',
      properties: ['openFile'],
      filters: [
        { name: 'Zip', extensions: ['zip'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // Install shader pack from file
  ipcMain.handle(IPC_CHANNELS.SHADERPACK_INSTALL, async (_event, profileId: string, filePath: string) => {
    try {
      const gameDir = getProfileInstanceDir(profileId);
      const packManager = new ShaderPackManager();
      await packManager.installPack(gameDir, filePath);
      return { success: true };
    } catch (error) {
      console.error('[IPC ShaderPack] Failed to install pack:', error);
      throw error;
    }
  });

  // Enable shader pack
  ipcMain.handle(IPC_CHANNELS.SHADERPACK_ENABLE, async (_event, profileId: string, fileName: string, isDirectory: boolean) => {
    try {
      const gameDir = getProfileInstanceDir(profileId);
      const packManager = new ShaderPackManager();
      await packManager.enablePack(gameDir, fileName, isDirectory);
      
      return { success: true };
    } catch (error) {
      console.error('[IPC ShaderPack] Failed to enable pack:', error);
      throw error;
    }
  });

  // Disable shader pack
  ipcMain.handle(IPC_CHANNELS.SHADERPACK_DISABLE, async (_event, profileId: string, fileName: string, isDirectory: boolean) => {
    try {
      const gameDir = getProfileInstanceDir(profileId);
      const packManager = new ShaderPackManager();
      await packManager.disablePack(gameDir, fileName, isDirectory);
      
      return { success: true };
    } catch (error) {
      console.error('[IPC ShaderPack] Failed to disable pack:', error);
      throw error;
    }
  });

  // Delete shader pack
  ipcMain.handle(IPC_CHANNELS.SHADERPACK_DELETE, async (_event, profileId: string, fileName: string, isDirectory: boolean) => {
    try {
      const gameDir = getProfileInstanceDir(profileId);
      const packManager = new ShaderPackManager();
      await packManager.deletePack(gameDir, fileName, isDirectory);
      
      return { success: true };
    } catch (error) {
      console.error('[IPC ShaderPack] Failed to delete pack:', error);
      throw error;
    }
  });

  console.log('[IPC ShaderPack] Shader pack handlers registered');
}
