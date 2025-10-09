import * as fs from 'fs/promises';
import * as path from 'path';

export interface ShaderPackInfo {
  name: string;
  fileName: string;
  filePath: string;
  enabled: boolean;
  isDirectory: boolean;
}

export class ShaderPackManager {
  /**
   * Get shaderpacks directory for profile
   */
  private getShaderPacksDirectory(gameDir: string): string {
    return path.join(gameDir, 'shaderpacks');
  }

  /**
   * List all shader packs in profile
   */
  async listShaderPacks(gameDir: string): Promise<ShaderPackInfo[]> {
    const shaderpacksDir = this.getShaderPacksDirectory(gameDir);
    
    try {
      await fs.access(shaderpacksDir);
    } catch {
      // Shaderpacks directory doesn't exist, create it
      await fs.mkdir(shaderpacksDir, { recursive: true });
      return [];
    }

    const files = await fs.readdir(shaderpacksDir, { withFileTypes: true });
    const packItems = files.filter(file => 
      file.isDirectory() || 
      file.name.endsWith('.zip') || 
      file.name.endsWith('.zip.disabled')
    );

    const packs: ShaderPackInfo[] = [];

    for (const item of packItems) {
      const filePath = path.join(shaderpacksDir, item.name);
      const isDirectory = item.isDirectory();
      const enabled = isDirectory || !item.name.endsWith('.disabled');
      const actualFileName = enabled ? item.name : item.name.replace('.disabled', '');

      packs.push({
        name: actualFileName.replace('.zip', ''),
        fileName: actualFileName,
        filePath,
        enabled,
        isDirectory,
      });
    }

    return packs.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Enable shader pack
   */
  async enablePack(gameDir: string, fileName: string, isDirectory: boolean): Promise<void> {
    const packsDir = this.getShaderPacksDirectory(gameDir);
    const disabledPath = path.join(packsDir, `${fileName}.disabled`);
    const enabledPath = path.join(packsDir, fileName);

    if (isDirectory) {
      // Directories cannot be disabled/enabled in the same way
      console.log(`[ShaderPack Manager] Cannot enable directory: ${fileName}`);
      return;
    }

    try {
      await fs.access(disabledPath);
      await fs.rename(disabledPath, enabledPath);
      console.log(`[ShaderPack Manager] Enabled pack: ${fileName}`);
    } catch (error) {
      throw new Error(`Failed to enable pack: ${fileName}`);
    }
  }

  /**
   * Disable shader pack
   */
  async disablePack(gameDir: string, fileName: string, isDirectory: boolean): Promise<void> {
    const packsDir = this.getShaderPacksDirectory(gameDir);
    const enabledPath = path.join(packsDir, fileName);
    const disabledPath = path.join(packsDir, `${fileName}.disabled`);

    if (isDirectory) {
      // Directories cannot be disabled/enabled in the same way
      console.log(`[ShaderPack Manager] Cannot disable directory: ${fileName}`);
      return;
    }

    try {
      await fs.access(enabledPath);
      await fs.rename(enabledPath, disabledPath);
      console.log(`[ShaderPack Manager] Disabled pack: ${fileName}`);
    } catch (error) {
      throw new Error(`Failed to disable pack: ${fileName}`);
    }
  }

  /**
   * Delete shader pack
   */
  async deletePack(gameDir: string, fileName: string, isDirectory: boolean): Promise<void> {
    const packsDir = this.getShaderPacksDirectory(gameDir);
    const enabledPath = path.join(packsDir, fileName);
    const disabledPath = path.join(packsDir, `${fileName}.disabled`);

    try {
      if (isDirectory) {
        await fs.rm(enabledPath, { recursive: true, force: true });
        console.log(`[ShaderPack Manager] Deleted directory: ${fileName}`);
      } else {
        // Try to delete enabled version
        try {
          await fs.unlink(enabledPath);
          console.log(`[ShaderPack Manager] Deleted pack: ${fileName}`);
          return;
        } catch {}

        // Try to delete disabled version
        await fs.unlink(disabledPath);
        console.log(`[ShaderPack Manager] Deleted disabled pack: ${fileName}`);
      }
    } catch (error) {
      throw new Error(`Failed to delete pack: ${fileName}`);
    }
  }

  /**
   * Install shader pack from file
   */
  async installPack(gameDir: string, sourceFile: string): Promise<ShaderPackInfo> {
    const packsDir = this.getShaderPacksDirectory(gameDir);
    await fs.mkdir(packsDir, { recursive: true });

    const fileName = path.basename(sourceFile);
    const targetPath = path.join(packsDir, fileName);

    // Check if pack already exists
    try {
      await fs.access(targetPath);
      throw new Error('Shader pack already exists');
    } catch (error: any) {
      if (error.message === 'Shader pack already exists') throw error;
    }

    // Copy pack file
    await fs.copyFile(sourceFile, targetPath);
    console.log(`[ShaderPack Manager] Installed pack: ${fileName}`);

    return {
      name: fileName.replace('.zip', ''),
      fileName,
      filePath: targetPath,
      enabled: true,
      isDirectory: false,
    };
  }
}
