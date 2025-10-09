import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS, IPC_EVENTS } from '../../shared/constants';
import { VersionManager } from '../services/version-manager';
import { GameLauncher, LaunchOptions } from '../services/game-launcher';
import { app } from 'electron';
import * as path from 'path';

let versionManager: VersionManager | null = null;
let gameLauncher: GameLauncher | null = null;

function getVersionManager(): VersionManager {
  if (!versionManager) {
    const gameDir = path.join(app.getPath('userData'), 'game');
    versionManager = new VersionManager(gameDir);
  }
  return versionManager;
}

export function getGameLauncher(): GameLauncher {
  if (!gameLauncher) {
    gameLauncher = new GameLauncher();
  }
  return gameLauncher;
}

/**
 * Register game-related IPC handlers
 */
export function registerGameHandlers(): void {
  // Download game version
  ipcMain.handle(IPC_CHANNELS.GAME_DOWNLOAD_VERSION, async (event, versionId: string) => {
    try {
      console.log(`[IPC Game] Downloading version: ${versionId}`);
      const manager = getVersionManager();
      
      const mainWindow = BrowserWindow.fromWebContents(event.sender);
      
      await manager.downloadVersion(versionId, (progress) => {
        // Send progress updates to renderer
        if (mainWindow) {
          mainWindow.webContents.send(IPC_EVENTS.GAME_DOWNLOAD_PROGRESS, {
            versionId,
            ...progress,
          });
        }
      });
      
      console.log(`[IPC Game] Download completed: ${versionId}`);
      return { success: true };
    } catch (err) {
      console.error('[IPC Game] Failed to download version:', err);
      throw new Error(err instanceof Error ? err.message : 'Failed to download version');
    }
  });

  // Get version details
  ipcMain.handle(IPC_CHANNELS.GAME_GET_VERSION_DETAILS, async (event, versionId: string) => {
    try {
      console.log(`[IPC Game] Getting version details: ${versionId}`);
      const manager = getVersionManager();
      const details = await manager.getVersionDetails(versionId);
      return details;
    } catch (err) {
      console.error('[IPC Game] Failed to get version details:', err);
      throw new Error(err instanceof Error ? err.message : 'Failed to get version details');
    }
  });

  // Check if version is installed
  ipcMain.handle(IPC_CHANNELS.GAME_CHECK_INSTALLED, async (event, versionId: string) => {
    try {
      const gameDir = path.join(app.getPath('userData'), 'game');
      const clientJar = path.join(gameDir, 'versions', versionId, `${versionId}.jar`);
      
      const fs = await import('fs/promises');
      try {
        await fs.access(clientJar);
        return true;
      } catch {
        return false;
      }
    } catch (err) {
      console.error('[IPC Game] Failed to check installation:', err);
      return false;
    }
  });

  // Launch game
  ipcMain.handle(IPC_CHANNELS.GAME_LAUNCH, async (event, options: LaunchOptions) => {
    try {
      console.log(`[IPC Game] Launching game: ${options.versionId}`);
      const launcher = getGameLauncher();
      const mainWindow = BrowserWindow.fromWebContents(event.sender);
      
      const gameProcess = await launcher.launch(
        options,
        (log) => {
          // Stream logs to renderer
          if (mainWindow) {
            mainWindow.webContents.send(IPC_EVENTS.GAME_LOG, {
              versionId: options.versionId,
              line: log,
            });
          }
        },
        (code) => {
          // Notify game exit
          if (mainWindow) {
            mainWindow.webContents.send(IPC_EVENTS.GAME_STOPPED, {
              versionId: options.versionId,
              code,
            });
          }
        }
      );
      
      // Notify game started
      if (mainWindow) {
        mainWindow.webContents.send(IPC_EVENTS.GAME_STARTED, {
          versionId: options.versionId,
        });
      }
      
      console.log(`[IPC Game] Game launched: ${options.versionId}`);
      return { success: true, pid: gameProcess.process.pid };
    } catch (err) {
      console.error('[IPC Game] Failed to launch game:', err);
      throw new Error(err instanceof Error ? err.message : 'Failed to launch game');
    }
  });

  // Stop game
  ipcMain.handle(IPC_CHANNELS.GAME_STOP, async (event, versionId: string) => {
    try {
      console.log(`[IPC Game] Stopping game: ${versionId}`);
      const launcher = getGameLauncher();
      const stopped = launcher.stopGame(versionId);
      return { success: stopped };
    } catch (err) {
      console.error('[IPC Game] Failed to stop game:', err);
      throw new Error(err instanceof Error ? err.message : 'Failed to stop game');
    }
  });

  // Get active games
  ipcMain.handle(IPC_CHANNELS.GAME_GET_ACTIVE, async () => {
    try {
      const launcher = getGameLauncher();
      const activeGames = launcher.getActiveProcesses();
      return activeGames.map(g => ({
        versionId: g.versionId,
        startTime: g.startTime,
        pid: g.process.pid,
      }));
    } catch (err) {
      console.error('[IPC Game] Failed to get active games:', err);
      return [];
    }
  });

  // Check if game is running
  ipcMain.handle(IPC_CHANNELS.GAME_IS_RUNNING, async (event, versionId: string) => {
    try {
      const launcher = getGameLauncher();
      return launcher.isGameRunning(versionId);
    } catch (err) {
      console.error('[IPC Game] Failed to check if game is running:', err);
      return false;
    }
  });
}
