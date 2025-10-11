import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { Profile, CreateProfileData } from '../../shared/types';
import { getBackendAddress } from '../backend/manager';
import { getAccountManager } from './account';
import { profileRpc } from '../grpc/clients';
import * as pb from '../gen/launcher/profile';

/**
 * Register profile-related IPC handlers
 */
export function registerProfileHandlers(): void {
  // Create profile
  ipcMain.handle(IPC_CHANNELS.PROFILE_CREATE, async (event, data: CreateProfileData) => {
    try {
      const addr = getBackendAddress();
      if (!addr) {
        throw new Error('Backend server is not running');
      }

      const res = await profileRpc.createProfile({
        name: data.name ?? '',
        description: data.description ?? '',
        icon: data.icon ?? '',
        gameVersion: data.gameVersion ?? '',
        loaderType: (data as any).loaderType ?? '',
        loaderVersion: data.loaderVersion ?? '',
      });
      return fromPbProfile(res);
    } catch (error) {
      console.error('[IPC Profile] Create failed:', error);
      throw error;
    }
  });

  // List profiles
  ipcMain.handle(IPC_CHANNELS.PROFILE_LIST, async () => {
    try {
      const addr = getBackendAddress();
      if (!addr) {
        throw new Error('Backend server is not running');
      }

      const res = await profileRpc.listProfiles({});
      return (res.profiles || []).map(fromPbProfile);
    } catch (error) {
      console.error('[IPC Profile] List failed:', error);
      throw error;
    }
  });

  // Get profile
  ipcMain.handle(IPC_CHANNELS.PROFILE_GET, async (event, id: string) => {
    try {
      const addr = getBackendAddress();
      if (!addr) {
        throw new Error('Backend server is not running');
      }

      const res = await profileRpc.getProfile({ id });
      return fromPbProfile(res);
    } catch (error) {
      console.error('[IPC Profile] Get failed:', error);
      throw error;
    }
  });

  // Update profile
  ipcMain.handle(IPC_CHANNELS.PROFILE_UPDATE, async (event, id: string, data: Partial<Profile>) => {
    try {
      console.log(`[IPC Profile] Updating profile ${id} with data:`, data);
      
      const addr = getBackendAddress();
      if (!addr) {
        throw new Error('Backend server is not running');
      }

      
      const patch: pb.Profile = {
        id,
        name: data.name ?? '',
        description: data.description ?? '',
        icon: data.icon ?? '',
        gameVersion: data.gameVersion ?? '',
        loaderType: data.loaderType ?? '',
        loaderVersion: data.loaderVersion ?? '',
        gameDirectory: data.gameDirectory ?? '',
        jvmArgs: data.jvmArgs ?? [],
        memoryMin: data.memory?.min ?? 0,
        memoryMax: data.memory?.max ?? 0,
        gameArgs: data.gameArgs ?? [],
        modpackId: data.modpackId ?? '',
        modpackSource: (data as any).modpackSource ?? '',
        createdAt: 0,
        updatedAt: 0,
        lastPlayed: 0,
        totalPlayTime: data.totalPlayTime ?? 0,
      };
      const res = await profileRpc.updateProfile({ id, patch });
      console.log(`[IPC Profile] Profile updated successfully:`);
      return fromPbProfile(res);
    } catch (error) {
      console.error('[IPC Profile] Update failed:', error);
      throw error;
    }
  });

  // Delete profile
  ipcMain.handle(IPC_CHANNELS.PROFILE_DELETE, async (event, id: string) => {
    try {
      const addr = getBackendAddress();
      if (!addr) {
        throw new Error('Backend server is not running');
      }
      await profileRpc.deleteProfile({ id });
      
      // Delete profile instance directory (game files, saves, etc.)
      const { getProfileInstanceDir } = await import('../utils/paths');
      const instanceDir = getProfileInstanceDir(id);
      
      const fs = await import('fs/promises');
      try {
        await fs.rm(instanceDir, { recursive: true, force: true });
        console.log(`[IPC Profile] Deleted instance directory: ${instanceDir}`);
      } catch (err) {
        console.warn(`[IPC Profile] Failed to delete instance directory:`, err);
        // Don't throw - profile is already deleted from backend
      }
      
      console.log('[IPC Profile] Profile deleted successfully');
      return { success: true };
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : '프로필 삭제에 실패했습니다');
    }
  });

  // Launch profile
  ipcMain.handle(IPC_CHANNELS.PROFILE_LAUNCH, async (event, id: string, accountId?: string) => {
    try {
      console.log('[IPC Profile] Launching profile:', id, 'with account:', accountId || 'default');
      
      const addr = getBackendAddress();
      if (!addr) {
        throw new Error('Backend server is not running');
      }

      // Get profile via gRPC
      const pbProfile = await profileRpc.getProfile({ id });
      const profile = fromPbProfile(pbProfile);
      
      // Attach accountId to profile for later use
      (profile as any).accountId = accountId;
      
      console.log(`[IPC Profile] Profile: ${profile.name}, Version: ${profile.gameVersion}`);

      // Import game launcher modules
      const { detectJavaInstallations } = await import('../services/java-detector');
      const { VersionManager } = await import('../services/version-manager');
      const { app, BrowserWindow } = await import('electron');

      // Detect Java
      console.log('[IPC Profile] Detecting Java installations...');
      const javaInstallations = await detectJavaInstallations();
      
      if (javaInstallations.length === 0) {
        throw new Error('Java를 찾을 수 없습니다. Java를 설치해주세요.');
      }

      // Select appropriate Java (prefer Java 17+)
      const java = javaInstallations.find(j => j.majorVersion >= 17) || javaInstallations[0];
      console.log(`[IPC Profile] Using Java ${java.version} at ${java.path}`);

      // Get profile-specific instance directory
      const { getProfileInstanceDir, getSharedLibrariesDir, getSharedAssetsDir } = await import('../utils/paths');
      const instanceDir = getProfileInstanceDir(id);
      const sharedLibrariesDir = getSharedLibrariesDir();
      const sharedAssetsDir = getSharedAssetsDir();
      
      console.log(`[IPC Profile] Instance directory: ${instanceDir}`);
      console.log(`[IPC Profile] Shared libraries: ${sharedLibrariesDir}`);
      console.log(`[IPC Profile] Shared assets: ${sharedAssetsDir}`);
      
      // Create instance directory if it doesn't exist
      const fs = await import('fs/promises');
      await fs.mkdir(instanceDir, { recursive: true });
      
      // Use custom VersionManager with shared resources
      const versionManager = new VersionManager(instanceDir, sharedLibrariesDir, sharedAssetsDir);
      const window = BrowserWindow.fromWebContents(event.sender);
      
      console.log(`[IPC Profile] Ensuring ${profile.gameVersion} is fully downloaded...`);
      
      // Download (will skip files that already exist with correct checksum)
      await versionManager.downloadVersion(profile.gameVersion, async (progress) => {
        const payload = {
          versionId: profile.gameVersion,
          profileName: profile.name,
          ...progress,
        } as any;

        if (window) {
          window.webContents.send('download:progress', payload);
        }

        // Also publish via gRPC so other consumers can subscribe through the server stream
        try {
          // Map to ProgressEvent with new proto fields
          await (await import('../grpc/clients')).downloadRpc.publishProgress({
            taskId: String(progress?.taskId || ''),
            type: String(progress?.type || 'minecraft'),
            name: String(progress?.name || ''),
            progress: Number(progress?.percent ?? progress?.progress ?? 0),
            downloaded: Number(progress?.downloaded ?? progress?.currentFileDownloaded ?? 0),
            total: Number(progress?.total ?? progress?.currentFileTotal ?? 0),
            status: String(progress?.status || 'downloading'),
            error: progress?.error ? String(progress.error) : '',
            profileId: String(profile.id || ''),
            profileName: String(profile.name || ''),
            versionId: String(profile.gameVersion || ''),
            versionName: String(profile.gameVersion || ''),
            fileName: String(progress?.currentFile || progress?.fileName || ''),
          } as any);
        } catch (e) {
          // swallow publish errors to avoid impacting download flow
        }
      });
      
      console.log('[IPC Profile] Download verification completed');

      // Install loader if needed
      let actualVersionId = profile.gameVersion;
      
      if (profile.loaderType && profile.loaderType !== 'vanilla') {
        console.log(`[IPC Profile] Installing ${profile.loaderType} loader...`);
        
        const { LoaderManager } = await import('../services/loader-manager');
        const loaderManager = new LoaderManager();
        
        // Get recommended version if not specified
        let loaderVersion: string | undefined = profile.loaderVersion;
        if (!loaderVersion) {
          console.log(`[IPC Profile] Getting recommended ${profile.loaderType} version...`);
          const rec = await loaderManager.getRecommendedVersion(profile.loaderType, profile.gameVersion);
          loaderVersion = rec ?? undefined;

          if (!loaderVersion) {
            throw new Error(`${profile.loaderType} 로더를 찾을 수 없습니다. 다른 로더를 선택해주세요.`);
          }
          
          console.log(`[IPC Profile] Using recommended version: ${loaderVersion}`);
        }
        
        // Check if already installed
        const isInstalled = await loaderManager.isLoaderInstalled(
          profile.loaderType,
          profile.gameVersion,
          loaderVersion,
          instanceDir
        );
        
        if (!isInstalled) {
          console.log(`[IPC Profile] Installing ${profile.loaderType} ${loaderVersion}...`);
          
          actualVersionId = await loaderManager.installLoader(
            profile.loaderType,
            profile.gameVersion,
            loaderVersion,
            instanceDir,
            (message, current, total) => {
              if (window) {
                window.webContents.send('loader:install-progress', {
                  loaderType: profile.loaderType,
                  message,
                  current,
                  total,
                  progress: (current / total) * 100,
                });
              }
            }
          );
          
          console.log(`[IPC Profile] Loader installed: ${actualVersionId}`);
        } else {
          actualVersionId = loaderManager.getVersionId(profile.loaderType, profile.gameVersion, loaderVersion);
          console.log(`[IPC Profile] Loader already installed: ${actualVersionId}`);
        }
      }

      // Get account info from global state (passed as parameter)
      let username = 'Player';
      let uuid = '00000000-0000-0000-0000-000000000000';
      let accessToken = 'null';
      let userType = 'legacy';
      
      // Check if accountId is passed (for backward compatibility)
      const accountIdToUse = (profile as any).accountId;
      
      console.log(`[IPC Profile] Account ID to use: ${accountIdToUse || '(none - using default Player)'}`);
      
      if (accountIdToUse) {
        try {
          const { MicrosoftAuthService } = await import('../services/microsoft-auth');
          const accountManager = getAccountManager();
          const account = accountManager.getAccount(accountIdToUse);
          
          if (!account) {
            console.warn('[IPC Profile] Account not found, using default');
          } else if (account.type === 'offline') {
            username = account.name;
            uuid = account.uuid;
            accessToken = 'null';
            userType = 'legacy';
            
            console.log(`[IPC Profile] Using offline account:`);
            console.log(`  - Username: ${username}`);
            console.log(`  - UUID: ${uuid}`);
          } else {
            // Microsoft account - get and refresh tokens if needed
            let tokens = await accountManager.getAccountTokens(accountIdToUse);
            
            if (tokens) {
              // Refresh if expired or expiring soon (within 5 minutes)
              if (tokens.expiresAt < Date.now() + 5 * 60 * 1000) {
                console.log('[IPC Profile] Refreshing expired token...');
                
                const authService = new MicrosoftAuthService();
                const newTokens = await authService.refreshToken(tokens.refreshToken);
                const newExpiresAt = Date.now() + newTokens.expiresIn * 1000;
                
                await accountManager.updateAccountTokens(
                  accountIdToUse,
                  newTokens.accessToken,
                  newTokens.refreshToken,
                  newExpiresAt
                );
                
                tokens = {
                  accessToken: newTokens.accessToken,
                  refreshToken: newTokens.refreshToken,
                  expiresAt: newExpiresAt,
                };
              }
              
              username = account.name;
              uuid = account.uuid;
              accessToken = tokens.accessToken;
              userType = 'msa';
              
              console.log(`[IPC Profile] Account details:`);
              console.log(`  - Username: ${username}`);
              console.log(`  - UUID: ${uuid}`);
              console.log(`  - Access Token: ${accessToken.substring(0, 20)}...`);
              console.log(`  - User Type: ${userType}`);
              
              // Update last used
              await accountManager.updateLastUsed(accountIdToUse);
            }
          }
          
          console.log(`[IPC Profile] Using account: ${username} (${userType})`);
        } catch (error) {
          console.warn('[IPC Profile] Failed to get account info, using default:', error);
        }
      }

      // Get memory settings from profile (with defaults)
      const minMemory = profile.memory?.min || 512;
      const maxMemory = profile.memory?.max || 4096;
      
      // Use custom Java path if set, otherwise use detected Java
      const javaPathToUse = profile.javaPath || java.path;

      // Launch game using IPC
      const launchOptions = {
        profileId: id,  // Pass profile ID for tracking
        versionId: actualVersionId,
        javaPath: javaPathToUse,
        gameDir: instanceDir,
        minMemory,
        maxMemory,
        username,
        uuid,
        accessToken,
        userType,
        resolution: profile.resolution,
        fullscreen: profile.fullscreen,
      };

      console.log('[IPC Profile] Launching game with options:');
      console.log(`  - Version: ${actualVersionId}`);
      console.log(`  - Java Path: ${javaPathToUse}`);
      console.log(`  - Memory: ${minMemory}MB - ${maxMemory}MB`);
      console.log(`  - Resolution: ${profile.resolution?.width || 854}x${profile.resolution?.height || 480}`);
      console.log(`  - Fullscreen: ${profile.fullscreen || false}`);
      console.log(`  - Username: ${username}`);
      console.log(`  - UUID: ${uuid}`);
      console.log(`  - User Type: ${userType}`);
      console.log(`  - Access Token: ${accessToken.substring(0, 20)}...`);
      
      // Use shared game launcher instance from game.ts
      const { getGameLauncher } = await import('../ipc/game');
      const launcher = getGameLauncher();
      
      const gameProcess = await launcher.launch(
        launchOptions,
        (log) => {
          if (window) {
            window.webContents.send('game:log', {
              versionId: id,  // Use profile ID
              line: log,
            });
          }
        },
        (code) => {
          if (window) {
            window.webContents.send('game:stopped', {
              versionId: id,  // Use profile ID
              code,
            });
          }
        }
      );

      if (window) {
        window.webContents.send('game:started', {
          versionId: id,  // Use profile ID
        });
      }

      console.log(`[IPC Profile] Game launched successfully: ${profile.name}`);
      return { success: true, message: '게임이 시작되었습니다!' };
    } catch (error) {
      console.error('[IPC Profile] Failed to launch:', error);
      throw new Error(error instanceof Error ? error.message : '게임 실행에 실패했습니다');
    }
  });
}

function fromPbProfile(p: pb.Profile): Profile {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    icon: p.icon,
    gameVersion: p.gameVersion,
    loaderType: p.loaderType as any,
    loaderVersion: p.loaderVersion,
    gameDirectory: p.gameDirectory,
    javaPath: '',
    jvmArgs: p.jvmArgs,
    memory: { min: p.memoryMin ?? 0, max: p.memoryMax ?? 0 },
    gameArgs: p.gameArgs,
    resolution: undefined,
    fullscreen: false,
    modpackId: p.modpackId,
    modpackSource: p.modpackSource as any,
    createdAt: p.createdAt ? new Date(p.createdAt * 1000).toISOString() as unknown as any : (undefined as any),
    updatedAt: p.updatedAt ? new Date(p.updatedAt * 1000).toISOString() as unknown as any : (undefined as any),
    lastPlayed: p.lastPlayed ? new Date(p.lastPlayed * 1000).toISOString() as unknown as any : (undefined as any),
    totalPlayTime: p.totalPlayTime ?? 0,
    authRequired: false,
    spaEnabled: false,
    serverAddress: '',
  } as any;
}
