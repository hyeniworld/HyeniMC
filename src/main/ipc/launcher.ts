/**
 * IPC handlers for launcher updates
 */

import { ipcMain, shell } from 'electron';
import { checkForUpdates, downloadUpdate, quitAndInstall, getCurrentVersion } from '../auto-updater';
import { getLogPath } from '../utils/logger';

export function registerLauncherHandlers(): void {
  // Check for updates
  ipcMain.handle('launcher:check-for-updates', async () => {
    try {
      await checkForUpdates();
      return { success: true };
    } catch (error) {
      console.error('[IPC:Launcher] Check for updates failed:', error);
      throw error;
    }
  });

  // Download update
  ipcMain.handle('launcher:download-update', async () => {
    try {
      await downloadUpdate();
      return { success: true };
    } catch (error) {
      console.error('[IPC:Launcher] Download update failed:', error);
      throw error;
    }
  });

  // Quit and install
  ipcMain.handle('launcher:quit-and-install', () => {
    try {
      quitAndInstall();
      return { success: true };
    } catch (error) {
      console.error('[IPC:Launcher] Quit and install failed:', error);
      throw error;
    }
  });

  // Get current version
  ipcMain.handle('launcher:get-version', () => {
    try {
      return { success: true, version: getCurrentVersion() };
    } catch (error) {
      console.error('[IPC:Launcher] Get version failed:', error);
      throw error;
    }
  });

  // Get log file path
  ipcMain.handle('launcher:get-log-path', () => {
    try {
      const logPath = getLogPath();
      return { success: true, path: logPath };
    } catch (error) {
      console.error('[IPC:Launcher] Get log path failed:', error);
      throw error;
    }
  });

  // Open log file in explorer/finder
  ipcMain.handle('launcher:open-log-folder', async () => {
    try {
      const logPath = getLogPath();
      const logDir = require('path').dirname(logPath);
      await shell.openPath(logDir);
      return { success: true };
    } catch (error) {
      console.error('[IPC:Launcher] Open log folder failed:', error);
      throw error;
    }
  });

  console.log('[IPC:Launcher] Launcher handlers registered');
}
