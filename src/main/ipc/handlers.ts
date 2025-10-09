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
import { registerResourcePackHandlers } from './resourcepack';
import { registerShaderPackHandlers } from './shaderpack';

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
  registerResourcePackHandlers();
  registerShaderPackHandlers();
  
  // TODO: Register other handlers
  // registerModHandlers();
  // registerModpackHandlers();
  // registerSettingsHandlers();
  // registerInstanceHandlers();

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
