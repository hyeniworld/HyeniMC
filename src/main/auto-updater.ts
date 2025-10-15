/**
 * Electron Auto-Updater Service
 * 
 * Manages launcher updates using electron-updater
 */

import { BrowserWindow, app } from 'electron';
import log from 'electron-log';

// Enable dev mode for testing updates in development
// MUST be done BEFORE importing electron-updater
if (process.env.NODE_ENV === 'development') {
  const path = require('path');
  const fs = require('fs');
  
  log.info('[AutoUpdater] Running in development mode - enabling update checks');
  
  // Read package.json to get correct version
  const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
  const devVersion = packageJson.version;
  log.info(`[AutoUpdater] Dev version from package.json: ${devVersion}`);
  
  // Override app.getVersion BEFORE electron-updater is imported
  app.getVersion = () => devVersion;
  
  // Force dev mode to check for updates
  Object.defineProperty(app, 'isPackaged', {
    get() {
      return true;
    }
  });
  
  log.info(`[AutoUpdater] Current version set to: ${app.getVersion()}`);
}

// Import electron-updater AFTER setting up dev mode
import { autoUpdater } from 'electron-updater';

// Configure logging
autoUpdater.logger = log;
(autoUpdater.logger as typeof log).transports.file.level = 'info';

// Set update config path for development
if (process.env.NODE_ENV === 'development') {
  const path = require('path');
  const fs = require('fs');
  const devConfigPath = path.join(process.cwd(), 'dev-app-update.yml');
  
  // Only set config path if the file exists
  if (fs.existsSync(devConfigPath)) {
    log.info(`[AutoUpdater] Using dev config: ${devConfigPath}`);
    // @ts-ignore - updateConfigPath is available but not in types
    autoUpdater.updateConfigPath = devConfigPath;
  } else {
    log.info(`[AutoUpdater] Dev config not found, skipping update checks in development`);
    // Disable update checks in development if config doesn't exist
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
  }
}

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
  autoUpdater.on('update-available', async (info) => {
    log.info('[AutoUpdater] Update available:', info.version);
    
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('launcher:update-available', {
        version: info.version,
        releaseNotes: info.releaseNotes || '',
        releaseDate: info.releaseDate,
        required: false // Can be configured based on version comparison
      });
    }

    // Check if auto-download is enabled in settings
    try {
      const { settingsRpc } = await import('./grpc/clients');
      const res = await settingsRpc.getSettings();
      const autoDownload = res.settings?.update?.autoDownload ?? false;
      
      if (autoDownload) {
        log.info('[AutoUpdater] Auto-download is enabled, starting download...');
        await autoUpdater.downloadUpdate();
      } else {
        log.info('[AutoUpdater] Auto-download is disabled, waiting for manual trigger');
      }
    } catch (error) {
      log.error('[AutoUpdater] Failed to check auto-download setting:', error);
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
  // Skip update checks in development if config file doesn't exist
  if (process.env.NODE_ENV === 'development') {
    const path = require('path');
    const fs = require('fs');
    const devConfigPath = path.join(process.cwd(), 'dev-app-update.yml');
    
    if (!fs.existsSync(devConfigPath)) {
      log.info('[AutoUpdater] Skipping update check in development (no dev-app-update.yml)');
      return;
    }
  }
  
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
 * Get current version from package.json
 */
export function getCurrentVersion(): string {
  return app.getVersion();
}
