import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { registerIpcHandlers } from './ipc/handlers';
import { startBackend, stopBackend } from './backend/manager';

// Set app name
app.setName('HyeniMC');

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
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 600,
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
}

async function initialize() {
  try {
    // Start backend gRPC server
    await startBackend();
    
    // Register IPC handlers
    registerIpcHandlers();
    
    // Create window
    await createWindow();
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
  await stopBackend();
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
});
