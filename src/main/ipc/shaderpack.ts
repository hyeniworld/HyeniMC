import { ipcMain, dialog } from 'electron';
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
