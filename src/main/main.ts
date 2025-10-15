import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { registerIpcHandlers } from './ipc/handlers';
import { initializeDownloadStreamBridge, shutdownDownloadStreamBridge } from './ipc/downloadStream';
import { initializeInstanceLogBridge, shutdownInstanceLogBridge } from './ipc/instanceStream';
import { initializeInstanceStateBridge, shutdownInstanceStateBridge } from './ipc/instanceState';
import { startBackend, stopBackend } from './backend/manager';
import { fileWatcher } from './services/file-watcher';
import { registerCustomProtocol } from './protocol/register';
import { setupProtocolHandler, handleProtocolUrl } from './protocol/handler';
import { initAutoUpdater, checkForUpdates } from './auto-updater';
import { detectJavaInstallations } from './services/java-detector';

// Load environment variables from .env file
const isDevelopment = process.env.NODE_ENV === 'development' || !app.isPackaged;

try {
  const { config } = require('dotenv');
  const envPath = isDevelopment 
    ? path.join(__dirname, '../../.env')  // Development: project root
    : path.join(process.resourcesPath, 'app.asar', '.env');  // Production: inside asar
  
  config({ path: envPath });
  
  console.log('[Main] Mode:', isDevelopment ? 'Development' : 'Production');
  console.log('[Main] Loading .env from:', envPath);
  console.log('[Main] HYENIMC_WORKER_URL:', process.env.HYENIMC_WORKER_URL ? 'configured' : 'NOT SET');
} catch (error) {
  console.error('[Main] Failed to load .env:', error);
  console.error('[Main] CRITICAL: HYENIMC_WORKER_URL must be set!');
}

// Set app name
app.setName('HyeniMC');

// Register custom URL protocol (hyenimc://)
registerCustomProtocol();

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log('[Main] Another instance is already running, exiting...');
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    console.log('[Main] Second instance detected, command line:', commandLine);
    
    // Check for protocol URL in command line (Windows)
    const url = commandLine.find(arg => arg.startsWith('hyenimc://'));
    if (url && mainWindow) {
      console.log('[Main] Protocol URL from second instance:', url);
      handleProtocolUrl(url, mainWindow);
    }
    
    // Focus existing window
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// Disable certificate verification for Microsoft auth (macOS SSL issue workaround)
app.commandLine.appendSwitch('ignore-certificate-errors');

let mainWindow: BrowserWindow | null = null;
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
const isWin = process.platform === 'win32';

async function createWindow() {
  const preloadPath = isDev
    ? path.join(__dirname, '../preload/preload.js')
    : path.join(__dirname, '../preload/preload.js');

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    titleBarStyle: 'hiddenInset',
    show: false,
    // Hide menubar on Windows
    autoHideMenuBar: isWin,
  });

  // Ensure menu bar hidden on Windows
  if (isWin) {
    mainWindow.removeMenu();
    mainWindow.setMenuBarVisibility(false);
  }

  // Set Content Security Policy
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          isDev
            ? "default-src 'self' 'unsafe-inline' http://localhost:* ws://localhost:* data: blob:; script-src 'self' 'unsafe-inline' http://localhost:*; img-src 'self' https: http: data: blob:; connect-src 'self' https: http: ws: wss:; style-src 'self' 'unsafe-inline' http://localhost:*; font-src 'self' data:;"
            : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: http: data: blob:; connect-src 'self' https:; font-src 'self' data:;"
        ]
      }
    });
  });

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Set main window for file watcher
  fileWatcher.setMainWindow(mainWindow);

  // Initialize auto-updater
  initAutoUpdater(mainWindow);
}

/**
 * Initialize Java settings on app startup
 * Detects Java installations and sets default if global settings is empty
 */
async function initializeJavaSettings() {
  try {
    console.log('[Main] Initializing Java settings...');
    
    // Detect Java installations
    const javaInstallations = await detectJavaInstallations();
    console.log(`[Main] Detected ${javaInstallations.length} Java installation(s)`);
    
    if (javaInstallations.length === 0) {
      console.warn('[Main] No Java installations detected');
      return;
    }
    
    // Get current global settings
    const { settingsRpc } = await import('./grpc/clients');
    const settingsResponse = await settingsRpc.getSettings();
    const currentJavaPath = settingsResponse.settings?.java?.javaPath || '';
    
    // If java_path is empty, set it to the first detected Java
    if (!currentJavaPath || currentJavaPath.trim() === '') {
      const defaultJava = javaInstallations[0];
      console.log(`[Main] Setting default Java to: ${defaultJava.path} (Java ${defaultJava.majorVersion})`);
      
      // Update settings with the detected Java path
      await settingsRpc.updateSettings({
        settings: {
          java: {
            javaPath: defaultJava.path,
            memoryMin: settingsResponse.settings?.java?.memoryMin || 1024,
            memoryMax: settingsResponse.settings?.java?.memoryMax || 4096,
          },
          download: settingsResponse.settings?.download || {
            requestTimeoutMs: 3000,
            maxRetries: 5,
            maxParallel: 10,
          },
          resolution: settingsResponse.settings?.resolution || {
            width: 854,
            height: 480,
            fullscreen: false,
          },
          cache: settingsResponse.settings?.cache || {
            enabled: true,
            maxSizeGb: 10,
            ttlDays: 30,
          },
          update: settingsResponse.settings?.update || {
            checkIntervalHours: 2,
            autoDownload: false,
          },
        },
      });
      
      console.log('[Main] Java settings initialized successfully');
    } else {
      console.log(`[Main] Java path already set: ${currentJavaPath}`);
    }
  } catch (error) {
    // Don't fail app startup if Java detection fails
    console.error('[Main] Failed to initialize Java settings:', error);
  }
}

async function initialize() {
  try {
    // Start backend gRPC server
    await startBackend();
    
    // Initialize Java settings (auto-detect and set default)
    await initializeJavaSettings();
    
    // Register IPC handlers
    registerIpcHandlers();
    
    // Create window
    await createWindow();

    // Setup protocol handler after window is ready
    setupProtocolHandler(mainWindow);

    // Check for updates after startup (with 3 second delay)
    setTimeout(() => {
      console.log('[Main] Checking for launcher updates...');
      checkForUpdates().catch(err => {
        console.error('[Main] Failed to check for updates:', err);
      });
    }, 3000);

    // Setup periodic update check based on settings
    const setupPeriodicUpdateCheck = async () => {
      try {
        const { settingsRpc } = await import('./grpc/clients');
        const res = await settingsRpc.getSettings();
        const intervalHours = res.settings?.update?.checkIntervalHours ?? 2;
        const intervalMs = intervalHours * 60 * 60 * 1000;
        
        console.log(`[Main] Setting up periodic update check every ${intervalHours} hour(s)`);
        
        setInterval(() => {
          console.log('[Main] Periodic update check...');
          checkForUpdates().catch(err => {
            console.error('[Main] Failed to check for updates:', err);
          });
        }, intervalMs);
      } catch (error) {
        console.error('[Main] Failed to setup periodic update check, using default (2 hours):', error);
        // Fallback to 2 hours
        setInterval(() => {
          console.log('[Main] Periodic update check...');
          checkForUpdates().catch(err => {
            console.error('[Main] Failed to check for updates:', err);
          });
        }, 2 * 60 * 60 * 1000);
      }
    };
    setupPeriodicUpdateCheck();

    console.log('[Main] App initialization complete');

    // Initialize gRPC download stream bridge (global)
    initializeDownloadStreamBridge();
    // Initialize gRPC instance log stream bridge (global)
    initializeInstanceLogBridge();
    // Initialize gRPC instance state stream bridge (global)
    initializeInstanceStateBridge();

    // Handle protocol URL from Windows startup
    if (process.platform === 'win32' && process.argv.length > 1) {
      const url = process.argv.find(arg => arg.startsWith('hyenimc://'));
      if (url && mainWindow) {
        console.log('[Main] Windows startup URL:', url);
        // Wait for window to be ready
        setTimeout(() => {
          if (mainWindow) {
            handleProtocolUrl(url, mainWindow);
          }
        }, 1000);
      }
    }
  } catch (error) {
    console.error('Failed to initialize app:', error);
    app.quit();
  }
}

app.whenReady().then(() => {
  // Set application name for proper user data path
  app.setPath('userData', path.join(app.getPath('appData'), 'HyeniMC'));
  console.log('[Main] User data path:', app.getPath('userData'));
  
  initialize();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', async () => {
  await fileWatcher.stopAll();
  shutdownDownloadStreamBridge();
  shutdownInstanceLogBridge();
  shutdownInstanceStateBridge();
  await stopBackend();
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
});
