import { ipcMain, dialog } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { ModpackManager } from '../services/modpack-manager';
import { getProfileInstanceDir } from '../utils/paths';

const modpackManager = new ModpackManager();

/**
 * Register modpack-related IPC handlers
 */
export function registerModpackHandlers(): void {
  // Search modpacks
  ipcMain.handle(IPC_CHANNELS.MODPACK_SEARCH, async (_event, query: string, gameVersion?: string) => {
    try {
      console.log(`[IPC Modpack] Searching modpacks: "${query}"`);
      const results = await modpackManager.searchModpacks(query, gameVersion);
      return results;
    } catch (error) {
      console.error('[IPC Modpack] Failed to search modpacks:', error);
      throw error;
    }
  });

  // Get modpack versions
  ipcMain.handle(IPC_CHANNELS.MODPACK_GET_VERSIONS, async (_event, modpackId: string, gameVersion?: string) => {
    try {
      console.log(`[IPC Modpack] Getting versions for: ${modpackId}`);
      const versions = await modpackManager.getModpackVersions(modpackId, gameVersion);
      return versions;
    } catch (error) {
      console.error('[IPC Modpack] Failed to get versions:', error);
      throw error;
    }
  });

  // Install modpack
  ipcMain.handle(IPC_CHANNELS.MODPACK_INSTALL, async (event, profileId: string, versionId: string) => {
    try {
      console.log(`[IPC Modpack] Installing modpack version: ${versionId} to profile: ${profileId}`);
      const instanceDir = getProfileInstanceDir(profileId);

      // 설치 시작 - 프로필을 'installing' 상태로 업데이트
      try {
        const { profileRpc } = await import('../grpc/clients');
        console.log('[IPC Modpack] Marking profile as installing:', profileId);
        const profile = await profileRpc.getProfile({ id: profileId });
        await profileRpc.updateProfile({ 
          id: profileId, 
          patch: { 
            ...profile,
            installationStatus: 'installing',
          } 
        });
        console.log('[IPC Modpack] ✅ Profile marked as installing');
      } catch (e) {
        console.error('[IPC Modpack] ❌ Failed to mark profile as installing:', e);
      }

      const result = await modpackManager.installModpack(
        versionId,
        profileId,
        instanceDir,
        (progress) => {
          // Send progress updates to renderer
          event.sender.send('modpack:install-progress', progress);
        }
      );

      // Patch profile with detected loader/gameVersion and mark as complete via gRPC
      try {
        const { profileRpc } = await import('../grpc/clients');
        const profile = await profileRpc.getProfile({ id: profileId });
        const patch: any = {
          ...profile,
          installationStatus: 'complete', // 설치 완료
        };
        if (result.gameVersion) patch.gameVersion = result.gameVersion;
        if (result.loaderType) patch.loaderType = result.loaderType;
        if (result.loaderVersion) patch.loaderVersion = result.loaderVersion;
        
        await profileRpc.updateProfile({ id: profileId, patch });
        console.log('[IPC Modpack] Profile patched with loader info and marked as complete (gRPC):', patch);
      } catch (e) {
        console.warn('[IPC Modpack] Failed to patch profile after install (gRPC):', e);
      }

      console.log('[IPC Modpack] Modpack installation complete');
      return { success: true };
    } catch (error) {
      console.error('[IPC Modpack] Failed to install modpack:', error);
      
      // 설치 실패 - 프로필을 'failed' 상태로 업데이트
      try {
        const { profileRpc } = await import('../grpc/clients');
        const profile = await profileRpc.getProfile({ id: profileId });
        await profileRpc.updateProfile({ 
          id: profileId, 
          patch: { 
            ...profile,
            installationStatus: 'failed',
          } 
        });
        console.log('[IPC Modpack] Profile marked as failed');
      } catch (e) {
        console.warn('[IPC Modpack] Failed to mark profile as failed:', e);
      }
      
      throw error;
    }
  });

  // Cancel modpack installation
  ipcMain.handle(IPC_CHANNELS.MODPACK_CANCEL_INSTALL, async (_event, profileId: string) => {
    try {
      console.log(`[IPC Modpack] Cancelling installation for profile: ${profileId}`);
      // 취소 플래그만 설정 (프로필은 나중에 삭제)
      await modpackManager.cancelInstall(profileId);
      console.log('[IPC Modpack] Installation cancelled, profile will be cleaned up');
      return { success: true };
    } catch (error) {
      console.error('[IPC Modpack] Failed to cancel installation:', error);
      throw error;
    }
  });

  // Validate modpack file
  ipcMain.handle(IPC_CHANNELS.MODPACK_VALIDATE_FILE, async (_event, filePath: string) => {
    try {
      console.log(`[IPC Modpack] Validating file: ${filePath}`);
      const fileInfo = await modpackManager.validateModpackFile(filePath);
      return fileInfo;
    } catch (error) {
      console.error('[IPC Modpack] Failed to validate file:', error);
      throw error;
    }
  });

  // Extract modpack metadata
  ipcMain.handle(IPC_CHANNELS.MODPACK_EXTRACT_METADATA, async (_event, filePath: string) => {
    try {
      console.log(`[IPC Modpack] Extracting metadata from: ${filePath}`);
      const metadata = await modpackManager.extractModpackMetadata(filePath);
      return metadata;
    } catch (error) {
      console.error('[IPC Modpack] Failed to extract metadata:', error);
      throw error;
    }
  });

  // Import modpack from file (compute instanceDir from profileId)
  ipcMain.handle(
    IPC_CHANNELS.MODPACK_IMPORT_FILE,
    async (event, filePath: string, profileId: string) => {
      try {
        console.log(`[IPC Modpack] Importing modpack from file: ${filePath}`);
        const instanceDir = getProfileInstanceDir(profileId);
        console.log(`[IPC Modpack] Profile: ${profileId}, Instance: ${instanceDir}`);

        // 설치 시작 - 프로필을 'installing' 상태로 업데이트
        try {
          const { profileRpc } = await import('../grpc/clients');
          console.log('[IPC Modpack] [Import] Marking profile as installing:', profileId);
          const profile = await profileRpc.getProfile({ id: profileId });
          await profileRpc.updateProfile({ 
            id: profileId, 
            patch: { 
              ...profile,
              installationStatus: 'installing',
            } 
          });
          console.log('[IPC Modpack] [Import] ✅ Profile marked as installing');
        } catch (e) {
          console.error('[IPC Modpack] [Import] ❌ Failed to mark profile as installing:', e);
        }

        const loaderInfo = await modpackManager.importModpackFromFile(filePath, profileId, instanceDir, (progress) => {
          // Send progress updates to renderer
          event.sender.send('modpack:import-progress', progress);
        });

        // 설치 완료 - 프로필을 'complete' 상태로 업데이트
        try {
          const { profileRpc } = await import('../grpc/clients');
          console.log('[IPC Modpack] [Import] Marking profile as complete:', profileId);
          const profile = await profileRpc.getProfile({ id: profileId });
          await profileRpc.updateProfile({ 
            id: profileId, 
            patch: { 
              ...profile,
              installationStatus: 'complete',
            } 
          });
          console.log('[IPC Modpack] [Import] ✅ Profile marked as complete');
        } catch (e) {
          console.error('[IPC Modpack] [Import] ❌ Failed to mark profile as complete:', e);
        }

        console.log('[IPC Modpack] Modpack import complete', loaderInfo);
        return { success: true };
      } catch (error) {
        console.error('[IPC Modpack] Failed to import modpack:', error);
        
        // 설치 실패 - 프로필을 'failed' 상태로 업데이트
        try {
          const { profileRpc } = await import('../grpc/clients');
          console.log('[IPC Modpack] [Import] Marking profile as failed:', profileId);
          const profile = await profileRpc.getProfile({ id: profileId });
          await profileRpc.updateProfile({ 
            id: profileId, 
            patch: { 
              ...profile,
              installationStatus: 'failed',
            } 
          });
          console.log('[IPC Modpack] [Import] ✅ Profile marked as failed');
        } catch (e) {
          console.error('[IPC Modpack] [Import] ❌ Failed to mark profile as failed:', e);
        }
        
        throw error;
      } finally {
        // 취소되었는지 확인하여 프로필 삭제
        if (modpackManager.isCancelled(profileId)) {
          try {
            const { profileRpc } = await import('../grpc/clients');
            await profileRpc.deleteProfile({ id: profileId });
            console.log('[IPC Modpack] [Import] Deleted cancelled profile:', profileId);
          } catch (e) {
            console.error('[IPC Modpack] [Import] Failed to delete cancelled profile:', e);
          } finally {
            // 취소 목록에서 제거
            modpackManager.clearCancelled(profileId);
          }
        }
      }
    }
  );

  // Open file dialog for modpack selection
  ipcMain.handle(IPC_CHANNELS.MODPACK_SELECT_FILE, async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: '모드팩 파일 선택',
        filters: [
          {
            name: 'Modpack Files',
            extensions: ['zip', 'mrpack', 'hyenipack'],
          },
          { name: 'All Files', extensions: ['*'] },
        ],
        properties: ['openFile'],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }

      return result.filePaths[0];
    } catch (error) {
      console.error('[IPC Modpack] Failed to open file dialog:', error);
      throw error;
    }
  });

  console.log('[IPC Modpack] Modpack handlers registered');
}
