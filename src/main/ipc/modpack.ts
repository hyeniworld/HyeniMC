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

      const result = await modpackManager.installModpack(
        versionId,
        profileId,
        instanceDir,
        (progress) => {
          // Send progress updates to renderer
          event.sender.send('modpack:install-progress', progress);
        }
      );

      // Patch profile with detected loader/gameVersion via gRPC
      try {
        const { profileRpc } = await import('../grpc/clients');
        const patch: any = {
          // repeated fields must be arrays (serializer iterates over them)
          jvmArgs: [],
          gameArgs: [],
          // ensure int32 fields are valid numbers if marshaller inspects them
          memoryMin: 0,
          memoryMax: 0,
        };
        if (result.gameVersion) patch.gameVersion = result.gameVersion;
        if (result.loaderType) patch.loaderType = result.loaderType;
        if (result.loaderVersion) patch.loaderVersion = result.loaderVersion;
        if (patch.gameVersion || patch.loaderType || patch.loaderVersion) {
          await profileRpc.updateProfile({ id: profileId, patch } as any);
          console.log('[IPC Modpack] Profile patched with loader info (gRPC):', patch);
        }
      } catch (e) {
        console.warn('[IPC Modpack] Failed to patch profile after install (gRPC):', e);
      }

      console.log('[IPC Modpack] Modpack installation complete');
      return { success: true };
    } catch (error) {
      console.error('[IPC Modpack] Failed to install modpack:', error);
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

        const loaderInfo = await modpackManager.importModpackFromFile(filePath, profileId, instanceDir, (progress) => {
          // Send progress updates to renderer
          event.sender.send('modpack:import-progress', progress);
        });

        console.log('[IPC Modpack] Modpack import complete', loaderInfo);
        return { success: true };
      } catch (error) {
        console.error('[IPC Modpack] Failed to import modpack:', error);
        throw error;
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
