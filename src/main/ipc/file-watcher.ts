import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { fileWatcher } from '../services/file-watcher';

export function registerFileWatcherHandlers(): void {
  // Start watching a profile
  ipcMain.handle(IPC_CHANNELS.FILE_WATCH_START, async (_, profileId: string, gameDirectory: string) => {
    try {
      fileWatcher.watchProfile(profileId, gameDirectory);
      return { success: true };
    } catch (error) {
      console.error('[IPC] Failed to start file watcher:', error);
      throw error;
    }
  });

  // Stop watching a profile
  ipcMain.handle(IPC_CHANNELS.FILE_WATCH_STOP, async (_, profileId: string) => {
    try {
      await fileWatcher.unwatchProfile(profileId);
      return { success: true };
    } catch (error) {
      console.error('[IPC] Failed to stop file watcher:', error);
      throw error;
    }
  });
}
