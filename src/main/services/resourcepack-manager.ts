import * as fs from 'fs/promises';
import * as path from 'path';
import AdmZip from 'adm-zip';

export interface ResourcePackInfo {
  name: string;
  description?: string;
  packFormat: number;
  fileName: string;
  filePath: string;
  enabled: boolean;
  icon?: string;
}

export class ResourcePackManager {
  /**
   * Get resourcepacks directory for profile
   */
  private getResourcePacksDirectory(gameDir: string): string {
    return path.join(gameDir, 'resourcepacks');
  }

  /**
   * List all resource packs in profile
   */
  async listResourcePacks(gameDir: string): Promise<ResourcePackInfo[]> {
    const resourcepacksDir = this.getResourcePacksDirectory(gameDir);
    
    try {
      await fs.access(resourcepacksDir);
    } catch {
      // Resourcepacks directory doesn't exist, create it
      await fs.mkdir(resourcepacksDir, { recursive: true });
      return [];
    }

    const files = await fs.readdir(resourcepacksDir);
    const packFiles = files.filter(file => 
      file.endsWith('.zip') || file.endsWith('.zip.disabled')
    );

    const packs: ResourcePackInfo[] = [];

    for (const file of packFiles) {
      const filePath = path.join(resourcepacksDir, file);
      const enabled = !file.endsWith('.disabled');
      const actualFileName = enabled ? file : file.replace('.disabled', '');

      try {
        const packInfo = await this.parsePackInfo(filePath, actualFileName, enabled);
        packs.push(packInfo);
      } catch (error) {
        console.error(`[ResourcePack Manager] Failed to parse pack: ${file}`, error);
        // Add as unknown pack
        packs.push({
          name: actualFileName.replace('.zip', ''),
          fileName: actualFileName,
          filePath,
          enabled,
          packFormat: 0,
        });
      }
    }

    return packs.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Parse resource pack info from ZIP file
   */
  private async parsePackInfo(
    filePath: string,
    fileName: string,
    enabled: boolean
  ): Promise<ResourcePackInfo> {
    const zip = new AdmZip(filePath);
    const safeParse = (text: string) => {
      // Remove control chars except \n, \r, \t
      const sanitized = text.replace(/[\u0000-\u0019\u007F]/g, (ch) => (ch === '\n' || ch === '\r' || ch === '\t' ? ch : ' '));
      return JSON.parse(sanitized);
    };
    
    // Try to find pack.mcmeta
    const packEntry = zip.getEntry('pack.mcmeta');
    if (!packEntry) {
      throw new Error('No pack.mcmeta found');
    }

    const content = packEntry.getData().toString('utf8');
    const json = safeParse(content);
    // Normalize description to string to avoid React rendering errors
    let description: string | undefined = undefined;
    const rawDesc = json.pack?.description;
    if (typeof rawDesc === 'string') {
      description = rawDesc;
    } else if (rawDesc && typeof rawDesc === 'object') {
      // Common form: { translate: 'key', fallback: 'text' }
      description = rawDesc.fallback || rawDesc.translate || JSON.stringify(rawDesc);
    } else if (Array.isArray(rawDesc)) {
      description = rawDesc.filter((v: any) => typeof v === 'string').join(' ');
    }
    
    // Extract icon if available
    let iconBase64: string | undefined;
    const iconEntry = zip.getEntry('pack.png');
    if (iconEntry) {
      const iconData = iconEntry.getData();
      iconBase64 = `data:image/png;base64,${iconData.toString('base64')}`;
    }

    return {
      name: fileName.replace('.zip', ''),
      description,
      packFormat: json.pack?.pack_format || 0,
      fileName,
      filePath,
      enabled,
      icon: iconBase64,
    };
  }

  /**
   * Enable resource pack
   */
  async enablePack(gameDir: string, fileName: string): Promise<void> {
    const packsDir = this.getResourcePacksDirectory(gameDir);
    const disabledPath = path.join(packsDir, `${fileName}.disabled`);
    const enabledPath = path.join(packsDir, fileName);

    try {
      await fs.access(disabledPath);
      await fs.rename(disabledPath, enabledPath);
      console.log(`[ResourcePack Manager] Enabled pack: ${fileName}`);
    } catch (error) {
      throw new Error(`Failed to enable pack: ${fileName}`);
    }
  }

  /**
   * Disable resource pack
   */
  async disablePack(gameDir: string, fileName: string): Promise<void> {
    const packsDir = this.getResourcePacksDirectory(gameDir);
    const enabledPath = path.join(packsDir, fileName);
    const disabledPath = path.join(packsDir, `${fileName}.disabled`);

    try {
      await fs.access(enabledPath);
      await fs.rename(enabledPath, disabledPath);
      console.log(`[ResourcePack Manager] Disabled pack: ${fileName}`);
    } catch (error) {
      throw new Error(`Failed to disable pack: ${fileName}`);
    }
  }

  /**
   * Delete resource pack
   */
  async deletePack(gameDir: string, fileName: string): Promise<void> {
    const packsDir = this.getResourcePacksDirectory(gameDir);
    const enabledPath = path.join(packsDir, fileName);
    const disabledPath = path.join(packsDir, `${fileName}.disabled`);

    try {
      // Try to delete enabled version
      try {
        await fs.unlink(enabledPath);
        console.log(`[ResourcePack Manager] Deleted pack: ${fileName}`);
        return;
      } catch {}

      // Try to delete disabled version
      await fs.unlink(disabledPath);
      console.log(`[ResourcePack Manager] Deleted disabled pack: ${fileName}`);
    } catch (error) {
      throw new Error(`Failed to delete pack: ${fileName}`);
    }
  }

  /**
   * Install resource pack from file
   */
  async installPack(gameDir: string, sourceFile: string): Promise<ResourcePackInfo> {
    const packsDir = this.getResourcePacksDirectory(gameDir);
    await fs.mkdir(packsDir, { recursive: true });

    const fileName = path.basename(sourceFile);
    const targetPath = path.join(packsDir, fileName);

    // Check if pack already exists
    try {
      await fs.access(targetPath);
      throw new Error('Resource pack already exists');
    } catch (error: any) {
      if (error.message === 'Resource pack already exists') throw error;
    }

    // Copy pack file
    await fs.copyFile(sourceFile, targetPath);
    console.log(`[ResourcePack Manager] Installed pack: ${fileName}`);

    // Parse and return pack info
    return await this.parsePackInfo(targetPath, fileName, true);
  }

  /**
   * Get active resource packs (for options.txt)
   */
  async getActivePacks(gameDir: string): Promise<string[]> {
    const packs = await this.listResourcePacks(gameDir);
    return packs
      .filter(pack => pack.enabled)
      .map(pack => pack.fileName.replace('.zip', ''));
  }

  /**
   * Set active resource packs order
   */
  async setActivePacksOrder(gameDir: string, packNames: string[]): Promise<void> {
    // This would update the options.txt file in Minecraft
    // For now, just log it
    console.log(`[ResourcePack Manager] Setting pack order:`, packNames);
    // TODO: Implement options.txt modification
  }
}
