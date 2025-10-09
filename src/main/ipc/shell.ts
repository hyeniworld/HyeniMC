import { ipcMain, shell, app } from 'electron';

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

  console.log('[IPC Shell] Shell handlers registered');
}
