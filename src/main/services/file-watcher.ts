import { watch, FSWatcher } from 'chokidar';
import { BrowserWindow } from 'electron';
import * as path from 'path';

interface WatchedProfile {
  profileId: string;
  modsWatcher?: FSWatcher;
  resourcepacksWatcher?: FSWatcher;
  shaderpacksWatcher?: FSWatcher;
}

export class FileWatcherService {
  private watchers: Map<string, WatchedProfile> = new Map();
  private mainWindow: BrowserWindow | null = null;

  setMainWindow(window: BrowserWindow) {
    this.mainWindow = window;
  }

  /**
   * Start watching a profile's directories
   */
  watchProfile(profileId: string, gameDirectory: string) {
    // Stop existing watchers for this profile
    this.unwatchProfile(profileId);

    const watched: WatchedProfile = { profileId };

    // Watch mods directory
    const modsDir = path.join(gameDirectory, 'mods');
    watched.modsWatcher = watch(modsDir, {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100,
      },
    });

    watched.modsWatcher.on('add', (filePath) => {
      if (filePath.endsWith('.jar') || filePath.endsWith('.jar.disabled')) {
        console.log(`[FileWatcher] Mod added: ${filePath}`);
        this.notifyChange(profileId, 'mods', 'add', path.basename(filePath));
      }
    });

    watched.modsWatcher.on('unlink', (filePath) => {
      if (filePath.endsWith('.jar') || filePath.endsWith('.jar.disabled')) {
        console.log(`[FileWatcher] Mod removed: ${filePath}`);
        this.notifyChange(profileId, 'mods', 'remove', path.basename(filePath));
      }
    });

    watched.modsWatcher.on('change', (filePath) => {
      if (filePath.endsWith('.jar') || filePath.endsWith('.jar.disabled')) {
        console.log(`[FileWatcher] Mod changed: ${filePath}`);
        this.notifyChange(profileId, 'mods', 'change', path.basename(filePath));
      }
    });

    // Watch resourcepacks directory
    const resourcepacksDir = path.join(gameDirectory, 'resourcepacks');
    watched.resourcepacksWatcher = watch(resourcepacksDir, {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100,
      },
    });

    watched.resourcepacksWatcher.on('add', (filePath) => {
      console.log(`[FileWatcher] Resource pack added: ${filePath}`);
      this.notifyChange(profileId, 'resourcepacks', 'add', path.basename(filePath));
    });

    watched.resourcepacksWatcher.on('addDir', (filePath) => {
      console.log(`[FileWatcher] Resource pack dir added: ${filePath}`);
      this.notifyChange(profileId, 'resourcepacks', 'add', path.basename(filePath));
    });

    watched.resourcepacksWatcher.on('unlink', (filePath) => {
      console.log(`[FileWatcher] Resource pack removed: ${filePath}`);
      this.notifyChange(profileId, 'resourcepacks', 'remove', path.basename(filePath));
    });

    watched.resourcepacksWatcher.on('unlinkDir', (filePath) => {
      console.log(`[FileWatcher] Resource pack dir removed: ${filePath}`);
      this.notifyChange(profileId, 'resourcepacks', 'remove', path.basename(filePath));
    });

    // Watch shaderpacks directory
    const shaderpacksDir = path.join(gameDirectory, 'shaderpacks');
    watched.shaderpacksWatcher = watch(shaderpacksDir, {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100,
      },
    });

    watched.shaderpacksWatcher.on('add', (filePath) => {
      console.log(`[FileWatcher] Shader pack added: ${filePath}`);
      this.notifyChange(profileId, 'shaderpacks', 'add', path.basename(filePath));
    });

    watched.shaderpacksWatcher.on('addDir', (filePath) => {
      console.log(`[FileWatcher] Shader pack dir added: ${filePath}`);
      this.notifyChange(profileId, 'shaderpacks', 'add', path.basename(filePath));
    });

    watched.shaderpacksWatcher.on('unlink', (filePath) => {
      console.log(`[FileWatcher] Shader pack removed: ${filePath}`);
      this.notifyChange(profileId, 'shaderpacks', 'remove', path.basename(filePath));
    });

    watched.shaderpacksWatcher.on('unlinkDir', (filePath) => {
      console.log(`[FileWatcher] Shader pack dir removed: ${filePath}`);
      this.notifyChange(profileId, 'shaderpacks', 'remove', path.basename(filePath));
    });

    this.watchers.set(profileId, watched);
    console.log(`[FileWatcher] Started watching profile: ${profileId}`);
  }

  /**
   * Stop watching a profile
   */
  async unwatchProfile(profileId: string) {
    const watched = this.watchers.get(profileId);
    if (watched) {
      if (watched.modsWatcher) {
        await watched.modsWatcher.close();
      }
      if (watched.resourcepacksWatcher) {
        await watched.resourcepacksWatcher.close();
      }
      if (watched.shaderpacksWatcher) {
        await watched.shaderpacksWatcher.close();
      }
      this.watchers.delete(profileId);
      console.log(`[FileWatcher] Stopped watching profile: ${profileId}`);
    }
  }

  /**
   * Stop all watchers
   */
  async stopAll() {
    const profileIds = Array.from(this.watchers.keys());
    for (const profileId of profileIds) {
      await this.unwatchProfile(profileId);
    }
  }

  /**
   * Notify renderer of file change
   */
  private notifyChange(profileId: string, type: 'mods' | 'resourcepacks' | 'shaderpacks', action: 'add' | 'remove' | 'change', fileName: string) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('file:changed', {
        profileId,
        type,
        action,
        fileName,
      });
    }
  }
}

// Singleton instance
export const fileWatcher = new FileWatcherService();
