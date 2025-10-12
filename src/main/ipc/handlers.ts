import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { registerProfileHandlers } from './profile';
import { registerVersionHandlers } from './version';
import { registerJavaHandlers } from './java';
import { registerGameHandlers } from './game';
import { registerAccountHandlers } from './account';
import { registerLoaderHandlers } from './loader';
import { registerShellHandlers } from './shell';
import { registerModHandlers } from './mod';
import { registerModpackHandlers } from './modpack';
import { registerResourcePackHandlers } from './resourcepack';
import { registerShaderPackHandlers } from './shaderpack';
import { registerSettingsHandlers } from './settings';
import { registerFileWatcherHandlers } from './file-watcher';

/**
 * Register all IPC handlers
 */
export function registerIpcHandlers(): void {
  console.log('[IPC] Registering IPC handlers');

  // Register module handlers
  registerProfileHandlers();
  registerVersionHandlers();
  registerJavaHandlers();
  registerGameHandlers();
  registerAccountHandlers();
  registerLoaderHandlers();
  registerShellHandlers();
  registerModHandlers();
  registerModpackHandlers();
  registerResourcePackHandlers();
  registerShaderPackHandlers();
  registerSettingsHandlers();
  registerFileWatcherHandlers();

  console.log('[IPC] IPC handlers registered');
}

/**
 * Unregister all IPC handlers
 */
export function unregisterIpcHandlers(): void {
  // Remove all listeners for our channels
  Object.values(IPC_CHANNELS).forEach((channel) => {
    ipcMain.removeHandler(channel);
  });
}
