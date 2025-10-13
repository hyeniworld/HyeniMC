/**
 * Electron Auto-Updater Service
 * 
 * Manages launcher updates using electron-updater
 */

import { autoUpdater } from 'electron-updater';
import { BrowserWindow } from 'electron';
import log from 'electron-log';

// Configure logging
autoUpdater.logger = log;
(autoUpdater.logger as typeof log).transports.file.level = 'info';

// Disable auto-download by default (manual control)
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

export interface UpdateInfo {
  version: string;
  releaseNotes: string;
  releaseDate: string;
  required: boolean;
}

let mainWindow: BrowserWindow | null = null;

/**
 * Initialize auto-updater with main window
 */
export function initAutoUpdater(window: BrowserWindow) {
  mainWindow = window;

  // Update available
  autoUpdater.on('update-available', (info) => {
    log.info('[AutoUpdater] Update available:', info.version);
    
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('launcher:update-available', {
        version: info.version,
        releaseNotes: info.releaseNotes || '',
        releaseDate: info.releaseDate,
        required: false // Can be configured based on version comparison
      });
    }
  });

  // Update not available
  autoUpdater.on('update-not-available', (info) => {
    log.info('[AutoUpdater] Update not available, current version:', info.version);
    
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('launcher:update-not-available', {
        version: info.version
      });
    }
  });

  // Download progress
  autoUpdater.on('download-progress', (progressObj) => {
    log.info(`[AutoUpdater] Download progress: ${progressObj.percent}%`);
    
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('launcher:download-progress', {
        percent: Math.round(progressObj.percent),
        bytesPerSecond: progressObj.bytesPerSecond,
        transferred: progressObj.transferred,
        total: progressObj.total
      });
    }
  });

  // Update downloaded
  autoUpdater.on('update-downloaded', (info) => {
    log.info('[AutoUpdater] Update downloaded:', info.version);
    
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('launcher:update-downloaded', {
        version: info.version
      });
    }
  });

  // Error
  autoUpdater.on('error', (error) => {
    log.error('[AutoUpdater] Error:', error);
    
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('launcher:update-error', {
        message: error.message
      });
    }
  });

  log.info('[AutoUpdater] Initialized');
}

/**
 * Check for updates manually
 */
export async function checkForUpdates(): Promise<void> {
  try {
    log.info('[AutoUpdater] Checking for updates...');
    await autoUpdater.checkForUpdates();
  } catch (error) {
    log.error('[AutoUpdater] Check failed:', error);
    throw error;
  }
}

/**
 * Download update
 */
export async function downloadUpdate(): Promise<void> {
  try {
    log.info('[AutoUpdater] Starting download...');
    await autoUpdater.downloadUpdate();
  } catch (error) {
    log.error('[AutoUpdater] Download failed:', error);
    throw error;
  }
}

/**
 * Install update and restart app
 */
export function quitAndInstall(): void {
  log.info('[AutoUpdater] Quitting and installing update...');
  
  // Give the main window time to close gracefully
  setTimeout(() => {
    autoUpdater.quitAndInstall(false, true);
  }, 500);
}

/**
 * Get current version
 */
export function getCurrentVersion(): string {
  return autoUpdater.currentVersion.version;
}
