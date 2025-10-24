import { ipcMain, shell, app, dialog } from 'electron';
import * as os from 'os';

/**
 * Register shell-related IPC handlers
 */
export function registerShellHandlers(): void {
  // Open path in file manager
  ipcMain.handle('shell:openPath', async (_event, path: string) => {
    try {
      const error = await shell.openPath(path);
      if (error) {
        throw new Error(error);
      }
      return path;
    } catch (error) {
      console.error('[Shell] Failed to open path:', error);
      throw error;
    }
  });

  // Open URL in external browser
  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    try {
      await shell.openExternal(url);
    } catch (error) {
      console.error('[Shell] Failed to open external URL:', error);
      throw error;
    }
  });

  // Show save dialog
  ipcMain.handle('dialog:showSaveDialog', async (_event, options: any) => {
    try {
      const result = await dialog.showSaveDialog(options);
      if (result.canceled || !result.filePath) {
        return null;
      }
      return result.filePath;
    } catch (error) {
      console.error('[Dialog] Failed to show save dialog:', error);
      throw error;
    }
  });

  // Show message box
  ipcMain.handle('dialog:showMessageBox', async (_event, options: any) => {
    try {
      const result = await dialog.showMessageBox(options);
      return result.response;
    } catch (error) {
      console.error('[Dialog] Failed to show message box:', error);
      throw error;
    }
  });

  // Check if file exists
  ipcMain.handle('fs:exists', async (_event, filePath: string) => {
    try {
      const fs = await import('fs/promises');
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  });

  // Get system path
  ipcMain.handle('system:getPath', async (_event, name: string) => {
    try {
      if (name === 'home') {
        return app.getPath('home');
      } else if (name === 'userData') {
        return app.getPath('userData');
      }
      return app.getPath(name as any);
    } catch (error) {
      console.error('[System] Failed to get path:', error);
      throw error;
    }
  });

  // Get system memory in MB
  ipcMain.handle('system:getMemory', async () => {
    try {
      const totalMemory = os.totalmem();
      const memoryInMB = Math.floor(totalMemory / (1024 * 1024));
      console.log('[System] Total memory:', memoryInMB, 'MB');
      return memoryInMB;
    } catch (error) {
      console.error('[System] Failed to get memory:', error);
      return 16384; // Default 16GB
    }
  });

  console.log('[IPC Shell] Shell handlers registered');
}
