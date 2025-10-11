import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';

export function registerSettingsHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, async () => {
    const { settingsRpc } = await import('../grpc/clients');
    const res = await settingsRpc.getSettings();
    
    // Convert camelCase from gRPC to snake_case for frontend
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
    
    // Ensure all fields have proper values (no undefined/null for proto int32)
    // Convert all numbers explicitly to avoid any type coercion issues
    // Use camelCase for gRPC generated types
    const cleanSettings: any = {
      download: {
        requestTimeoutMs: Number(settings?.download?.request_timeout_ms ?? 3000),
        maxRetries: Number(settings?.download?.max_retries ?? 5),
        maxParallel: Number(settings?.download?.max_parallel ?? 10),
      },
      java: {
        javaPath: String(settings?.java?.java_path ?? ''),
        memoryMin: Number(settings?.java?.memory_min ?? 1024),
        memoryMax: Number(settings?.java?.memory_max ?? 4096),
      },
      resolution: {
        width: Number(settings?.resolution?.width ?? 854),
        height: Number(settings?.resolution?.height ?? 480),
        fullscreen: Boolean(settings?.resolution?.fullscreen ?? false),
      },
      cache: {
        enabled: Boolean(settings?.cache?.enabled ?? true),
        maxSizeGb: Number(settings?.cache?.max_size_gb ?? 10),
        ttlDays: Number(settings?.cache?.ttl_days ?? 30),
      },
    };
    
    console.log('[Settings] Updating settings:', JSON.stringify(cleanSettings, null, 2));
    console.log('[Settings] Type check - requestTimeoutMs:', typeof cleanSettings.download.requestTimeoutMs);
    console.log('[Settings] Type check - memoryMin:', typeof cleanSettings.java.memoryMin);
    
    const res = await settingsRpc.updateSettings({ settings: cleanSettings });
    return res;
  });
}
