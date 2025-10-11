import { app, ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import * as fs from 'fs/promises';
import * as path from 'path';

export function registerSettingsHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, async () => {
    const { settingsRpc } = await import('../grpc/clients');
    const res = await settingsRpc.getSettings();
    
    // Convert gRPC camelCase to frontend snake_case
    const settings = res.settings;
    return {
      download: {
        request_timeout_ms: settings?.download?.requestTimeoutMs,
        max_retries: settings?.download?.maxRetries,
        max_parallel: settings?.download?.maxParallel,
      },
      java: {
        java_path: settings?.java?.javaPath,
        memory_min: settings?.java?.memoryMin,
        memory_max: settings?.java?.memoryMax,
      },
      resolution: {
        width: settings?.resolution?.width,
        height: settings?.resolution?.height,
        fullscreen: settings?.resolution?.fullscreen,
      },
      cache: {
        enabled: settings?.cache?.enabled,
        max_size_gb: settings?.cache?.maxSizeGb,
        ttl_days: settings?.cache?.ttlDays,
      },
    };
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_UPDATE, async (_event, settings: any) => {
    const { settingsRpc } = await import('../grpc/clients');
    
    // Ensure all int32 fields have valid values (not undefined)
    // proto3 doesn't allow undefined for scalar types
    const cleanSettings = {
      download: {
        requestTimeoutMs: Number(settings?.download?.request_timeout_ms) || 3000,
        maxRetries: Number(settings?.download?.max_retries) || 5,
        maxParallel: Number(settings?.download?.max_parallel) || 10,
      },
      java: {
        javaPath: String(settings?.java?.java_path || ''),
        memoryMin: Number(settings?.java?.memory_min) || 1024,
        memoryMax: Number(settings?.java?.memory_max) || 4096,
      },
      resolution: {
        width: Number(settings?.resolution?.width) || 854,
        height: Number(settings?.resolution?.height) || 480,
        fullscreen: Boolean(settings?.resolution?.fullscreen),
      },
      cache: {
        enabled: Boolean(settings?.cache?.enabled ?? true),
        maxSizeGb: Number(settings?.cache?.max_size_gb) || 10,
        ttlDays: Number(settings?.cache?.ttl_days) || 30,
      },
    };
    
    const res = await settingsRpc.updateSettings({ settings: cleanSettings });
    return res;
  });

  // Reset cache (clear cache directory)
  ipcMain.handle(IPC_CHANNELS.SETTINGS_RESET_CACHE, async () => {
    const dataPath = app.getPath('userData');
    const cachePath = path.join(dataPath, 'cache');
    
    try {
      // Check if cache directory exists
      await fs.access(cachePath);
      
      // Remove all files in cache directory
      const entries = await fs.readdir(cachePath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(cachePath, entry.name);
        if (entry.isDirectory()) {
          await fs.rm(fullPath, { recursive: true, force: true });
        } else {
          await fs.unlink(fullPath);
        }
      }
      
      return { success: true, message: '캐시가 삭제되었습니다.' };
    } catch (error) {
      console.error('[IPC Settings] Failed to reset cache:', error);
      return { success: false, message: '캐시 삭제에 실패했습니다.' };
    }
  });

  // Get cache statistics
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET_CACHE_STATS, async () => {
    const dataPath = app.getPath('userData');
    const cachePath = path.join(dataPath, 'cache');
    
    try {
      const stats = await getCacheStats(cachePath);
      return stats;
    } catch (error) {
      console.error('[IPC Settings] Failed to get cache stats:', error);
      return { size: 0, files: 0 };
    }
  });

  // Export settings
  ipcMain.handle(IPC_CHANNELS.SETTINGS_EXPORT, async () => {
    const { settingsRpc } = await import('../grpc/clients');
    const res = await settingsRpc.getSettings();
    return JSON.stringify(res.settings, null, 2);
  });

  // Import settings
  ipcMain.handle(IPC_CHANNELS.SETTINGS_IMPORT, async (_event, data: string) => {
    try {
      const settings = JSON.parse(data);
      const { settingsRpc } = await import('../grpc/clients');
      await settingsRpc.updateSettings({ settings });
      return { success: true, message: '설정을 가져왔습니다.' };
    } catch (error) {
      console.error('[IPC Settings] Failed to import settings:', error);
      return { success: false, message: '설정 가져오기에 실패했습니다.' };
    }
  });
}

// Helper function to calculate directory size
async function getCacheStats(dirPath: string): Promise<{ size: number; files: number }> {
  let totalSize = 0;
  let fileCount = 0;

  try {
    await fs.access(dirPath);
  } catch {
    return { size: 0, files: 0 };
  }

  async function traverse(currentPath: string) {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      
      if (entry.isDirectory()) {
        await traverse(fullPath);
      } else {
        const stats = await fs.stat(fullPath);
        totalSize += stats.size;
        fileCount++;
      }
    }
  }

  await traverse(dirPath);
  return { size: totalSize, files: fileCount };
}
