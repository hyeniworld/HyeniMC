import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { loaderRpc } from '../grpc/clients';
import { normalizeGrpcError } from '../grpc/errors';
import { LoaderManager } from '../services/loader-manager';
import { LoaderType } from '../../shared/types/profile';
import { app } from 'electron';
import { getProfileInstanceDir } from '../utils/paths';
import * as path from 'path';

let loaderManager: LoaderManager | null = null;

function getLoaderManager(): LoaderManager {
  if (!loaderManager) {
    loaderManager = new LoaderManager();
  }
  return loaderManager;
}

/**
 * 로더 관련 IPC 핸들러 등록
 */
export function registerLoaderHandlers(): void {
  // 로더 버전 목록 가져오기
  ipcMain.handle(
    IPC_CHANNELS.LOADER_GET_VERSIONS,
    async (event, loaderType: LoaderType, minecraftVersion?: string, includeUnstable = false) => {
      try {
        console.log(`[IPC Loader] Getting versions for ${loaderType}${minecraftVersion ? ` (MC ${minecraftVersion})` : ''} (includeUnstable: ${includeUnstable})`);
        // Try gRPC first when gameVersion is provided
        if (minecraftVersion) {
          try {
            const res = await loaderRpc.getVersions({ loaderType, gameVersion: minecraftVersion, includeUnstable } as any);
            const versions = (res.versions || []).map(v => ({ version: v.version, stable: !!(v as any).stable }));
            return { success: true, versions };
          } catch (e) {
            console.warn('[IPC Loader] gRPC getVersions failed, falling back to TS manager:', (e as Error).message);
          }
        }
        // Fallback to existing TS manager
        const manager = getLoaderManager();
        const versions = await manager.getLoaderVersions(loaderType, minecraftVersion, includeUnstable);
        return { success: true, versions };
      } catch (err) {
        console.error('[IPC Loader] Failed to get versions:', err);
        const ne = normalizeGrpcError(err, '로더 버전 목록을 가져오지 못했습니다.');
        throw new Error(ne.message);
      }
    }
  );

  // 권장 로더 버전 가져오기
  ipcMain.handle(
    IPC_CHANNELS.LOADER_GET_RECOMMENDED,
    async (event, loaderType: LoaderType, minecraftVersion: string) => {
      try {
        console.log(`[IPC Loader] Getting recommended ${loaderType} version for MC ${minecraftVersion}`);
        // Try gRPC first
        try {
          const res = await loaderRpc.getRecommended({ loaderType, gameVersion: minecraftVersion } as any);
          const version = res.version?.version || '';
          if (version) return { success: true, version };
        } catch (e) {
          console.warn('[IPC Loader] gRPC getRecommended failed, falling back to TS manager:', (e as Error).message);
        }
        const manager = getLoaderManager();
        const version = await manager.getRecommendedVersion(loaderType, minecraftVersion);
        return { success: true, version };
      } catch (err) {
        console.error('[IPC Loader] Failed to get recommended version:', err);
        const ne = normalizeGrpcError(err, '권장 로더 버전을 가져오지 못했습니다.');
        throw new Error(ne.message);
      }
    }
  );

  // 로더 설치
  ipcMain.handle(
    IPC_CHANNELS.LOADER_INSTALL,
    async (
      event,
      loaderType: LoaderType,
      minecraftVersion: string,
      loaderVersion: string
    ) => {
      try {
        console.log(`[IPC Loader] Installing ${loaderType} ${loaderVersion} for MC ${minecraftVersion}`);
        const manager = getLoaderManager();
        const gameDir = path.join(app.getPath('userData'), 'game');
        
        const mainWindow = BrowserWindow.fromWebContents(event.sender);
        
        // Try gRPC streaming install first
        try {
          let lastVersionId = '';
          await new Promise<void>((resolve, reject) => {
            const cancel = loaderRpc.streamInstall(
              {
                loaderType,
                gameVersion: minecraftVersion,
                loaderVersion,
                instanceDir: gameDir,
              } as any,
              (ev) => {
                lastVersionId = ev.versionId || lastVersionId;
                if (mainWindow) {
                  mainWindow.webContents.send('loader:install-progress', {
                    loaderType,
                    message: ev.message,
                    current: ev.current,
                    total: ev.total,
                    progress: ev.percent,
                  });
                }
              },
              (err) => {
                cancel?.();
                reject(err);
              },
              () => resolve()
            );
          });
          const versionId = lastVersionId || (loaderType === 'fabric' ? `fabric-loader-${loaderVersion}-${minecraftVersion}` : loaderType === 'quilt' ? `quilt-loader-${loaderVersion}-${minecraftVersion}` : loaderType === 'neoforge' ? `neoforge-${loaderVersion}` : '');
          if (versionId) {
            console.log(`[IPC Loader] gRPC streaming install completed: ${versionId}`);
            return { success: true, versionId };
          }
        } catch (e) {
          console.warn('[IPC Loader] gRPC streaming install failed, trying unary install:', (e as Error).message);
          try {
            const res = await loaderRpc.install({
              loaderType,
              gameVersion: minecraftVersion,
              loaderVersion,
              instanceDir: gameDir,
            } as any);
            const versionId = res.versionId || '';
            if (versionId) {
              console.log(`[IPC Loader] gRPC install completed: ${versionId}`);
              return { success: true, versionId };
            }
          } catch (e2) {
            console.warn('[IPC Loader] gRPC unary install failed, falling back to TS manager:', (e2 as Error).message);
          }
        }

        // Fallback: TS manager with progress events
        const versionId = await manager.installLoader(
          loaderType,
          minecraftVersion,
          loaderVersion,
          gameDir,
          (message, current, total) => {
            if (mainWindow) {
              mainWindow.webContents.send('loader:install-progress', {
                loaderType,
                message,
                current,
                total,
                progress: (current / total) * 100,
              });
            }
          }
        );
        
        console.log(`[IPC Loader] Installation completed: ${versionId}`);
        return { success: true, versionId };
      } catch (err) {
        console.error('[IPC Loader] Failed to install:', err);
        const ne = normalizeGrpcError(err, '로더 설치에 실패했습니다.');
        throw new Error(ne.message);
      }
    }
  );

  // 로더 설치 여부 확인 (프로필 기준 지원)
  ipcMain.handle(
    IPC_CHANNELS.LOADER_CHECK_INSTALLED,
    async (
      event,
      loaderType: LoaderType,
      minecraftVersion: string,
      loaderVersion: string,
      profileId?: string
    ) => {
      try {
        console.log(`[IPC Loader] Checking if ${loaderType} ${loaderVersion} is installed` + (profileId ? ` for profile ${profileId}` : ''));
        const manager = getLoaderManager();
        const gameDir = profileId
          ? getProfileInstanceDir(profileId)
          : path.join(app.getPath('userData'), 'game');

        // Try gRPC first with instance_dir
        try {
          const res = await loaderRpc.checkInstalled({
            loaderType,
            gameVersion: minecraftVersion,
            loaderVersion,
            profileId: profileId ?? '',
            instanceDir: gameDir,
          } as any);
          return { success: true, installed: !!res.installed };
        } catch (e) {
          console.warn('[IPC Loader] gRPC checkInstalled failed, falling back to TS manager:', (e as Error).message);
        }

        const installed = await manager.isLoaderInstalled(
          loaderType,
          minecraftVersion,
          loaderVersion,
          gameDir
        );

        return { success: true, installed };
      } catch (err) {
        console.error('[IPC Loader] Failed to check installation:', err);
        return { success: false, installed: false };
      }
    }
  );
}
