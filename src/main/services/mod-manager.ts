import * as fs from 'fs/promises';
import * as path from 'path';
import AdmZip from 'adm-zip';

export interface ModInfo {
  id: string;
  name: string;
  version: string;
  description?: string;
  authors?: string[];
  icon?: string;
  fileName: string;
  filePath: string;
  enabled: boolean;
  loader: 'fabric' | 'neoforge' | 'forge' | 'quilt' | 'unknown';
}

export class ModManager {
  /**
   * Get mods directory for profile
   */
  private getModsDirectory(gameDir: string): string {
    return path.join(gameDir, 'mods');
  }

  /**
   * List all mods in profile
   */
  async listMods(gameDir: string): Promise<ModInfo[]> {
    const modsDir = this.getModsDirectory(gameDir);
    
    try {
      await fs.access(modsDir);
    } catch {
      // Mods directory doesn't exist, create it
      await fs.mkdir(modsDir, { recursive: true });
      return [];
    }

    const files = await fs.readdir(modsDir);
    const modFiles = files.filter(file => 
      file.endsWith('.jar') || file.endsWith('.jar.disabled')
    );

    const mods: ModInfo[] = [];

    for (const file of modFiles) {
      const filePath = path.join(modsDir, file);
      const enabled = !file.endsWith('.disabled');
      const actualFileName = enabled ? file : file.replace('.disabled', '');

      try {
        const modInfo = await this.parseModInfo(filePath, actualFileName, enabled);
        mods.push(modInfo);
      } catch (error) {
        console.error(`[Mod Manager] Failed to parse mod: ${file}`, error);
        // Add as unknown mod
        mods.push({
          id: actualFileName,
          name: actualFileName.replace('.jar', ''),
          version: 'unknown',
          fileName: actualFileName,
          filePath,
          enabled,
          loader: 'unknown',
        });
      }
    }

    return mods.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Parse mod info from JAR file
   */
  private async parseModInfo(
    filePath: string,
    fileName: string,
    enabled: boolean
  ): Promise<ModInfo> {
    const zip = new AdmZip(filePath);
    const safeParse = (text: string) => {
      try {
        // Remove control characters except tab(\t), newline(\n), carriage return(\r)
        // Covers C0 (U+0000–U+001F) and C1 (U+0080–U+009F)
        const sanitized = text.replace(/[\u0000-\u001F\u007F-\u009F]/g, (ch) => {
          return ch === '\n' || ch === '\r' || ch === '\t' ? ch : ' ';
        });
        return JSON.parse(sanitized);
      } catch (e) {
        throw e;
      }
    };
    
    // Try Fabric mod first
    let fabricEntry = zip.getEntry('fabric.mod.json');
    if (fabricEntry) {
      const content = fabricEntry.getData().toString('utf8');
      const json = safeParse(content);
      
      return {
        id: json.id || fileName,
        name: json.name || json.id || fileName,
        version: json.version || 'unknown',
        description: json.description,
        authors: Array.isArray(json.authors) 
          ? json.authors.map((a: any) => typeof a === 'string' ? a : a.name)
          : json.authors ? [json.authors] : undefined,
        icon: json.icon,
        fileName,
        filePath,
        enabled,
        loader: 'fabric',
      };
    }

    // Try NeoForge/Forge mod
    let neoforgeEntry = zip.getEntry('META-INF/mods.toml');
    if (neoforgeEntry) {
      try {
        const content = neoforgeEntry.getData().toString('utf8');
        const modInfo = this.parseToml(content);
        
        return {
          id: modInfo.modId || fileName,
          name: modInfo.displayName || modInfo.modId || fileName,
          version: modInfo.version || 'unknown',
          description: modInfo.description,
          authors: modInfo.authors ? [modInfo.authors] : undefined,
          fileName,
          filePath,
          enabled,
          loader: 'neoforge',
        };
      } catch (error) {
        console.warn(`[Mod Manager] Failed to parse NeoForge mod metadata: ${fileName}`, error);
        // Return basic info
        return {
          id: fileName.replace('.jar', ''),
          name: fileName.replace('.jar', ''),
          version: 'unknown',
          fileName,
          filePath,
          enabled,
          loader: 'neoforge',
        };
      }
    }

    // Quilt mod
    let quiltEntry = zip.getEntry('quilt.mod.json');
    if (quiltEntry) {
      try {
        const content = quiltEntry.getData().toString('utf8');
        const json = safeParse(content);
        const quilMod = json.quilt_loader?.metadata || {};
        
        return {
          id: quilMod.id || json.id || fileName,
          name: quilMod.name || json.name || fileName,
          version: quilMod.version || json.version || 'unknown',
          description: quilMod.description || json.description,
          authors: quilMod.contributors ? Object.keys(quilMod.contributors) : undefined,
          fileName,
          filePath,
          enabled,
          loader: 'quilt',
        };
      } catch (error) {
        console.warn(`[Mod Manager] Failed to parse Quilt mod metadata: ${fileName}`, error);
      }
    }

    // Unknown mod format - return basic info instead of throwing
    console.warn(`[Mod Manager] Unknown mod format: ${fileName}, returning basic info`);
    return {
      id: fileName.replace('.jar', ''),
      name: fileName.replace('.jar', ''),
      version: 'unknown',
      fileName,
      filePath,
      enabled,
      loader: 'unknown',
    };
  }

  /**
   * Simple TOML parser for mods.toml
   */
  private parseToml(content: string): any {
    const result: any = {};
    const lines = content.split('\n');
    let currentSection: any = result;

    for (const line of lines) {
      const trimmed = line.trim();
      
      // Skip comments and empty lines
      if (trimmed.startsWith('#') || trimmed === '') continue;

      // Section header
      if (trimmed.startsWith('[[')) {
        const sectionName = trimmed.slice(2, -2);
        if (sectionName === 'mods') {
          currentSection = {};
          if (!result.mods) result.mods = [];
          result.mods.push(currentSection);
        }
        continue;
      }

      // Key-value pair
      const match = trimmed.match(/^(\w+)\s*=\s*"?([^"]+)"?$/);
      if (match) {
        const [, key, value] = match;
        currentSection[key] = value.replace(/"/g, '');
      }
    }

    // Return first mod info
    return result.mods?.[0] || result;
  }

  /**
   * Enable mod
   */
  async enableMod(gameDir: string, fileName: string): Promise<void> {
    const modsDir = this.getModsDirectory(gameDir);
    const disabledPath = path.join(modsDir, `${fileName}.disabled`);
    const enabledPath = path.join(modsDir, fileName);

    try {
      await fs.access(disabledPath);
      await fs.rename(disabledPath, enabledPath);
      console.log(`[Mod Manager] Enabled mod: ${fileName}`);
    } catch (error) {
      throw new Error(`Failed to enable mod: ${fileName}`);
    }
  }

  /**
   * Disable mod
   */
  async disableMod(gameDir: string, fileName: string): Promise<void> {
    const modsDir = this.getModsDirectory(gameDir);
    const enabledPath = path.join(modsDir, fileName);
    const disabledPath = path.join(modsDir, `${fileName}.disabled`);

    try {
      await fs.access(enabledPath);
      await fs.rename(enabledPath, disabledPath);
      console.log(`[Mod Manager] Disabled mod: ${fileName}`);
    } catch (error) {
      throw new Error(`Failed to disable mod: ${fileName}`);
    }
  }

  /**
   * Delete mod
   */
  async deleteMod(gameDir: string, fileName: string): Promise<void> {
    const modsDir = this.getModsDirectory(gameDir);
    const enabledPath = path.join(modsDir, fileName);
    const disabledPath = path.join(modsDir, `${fileName}.disabled`);

    try {
      // Try to delete enabled version
      try {
        await fs.unlink(enabledPath);
        console.log(`[Mod Manager] Deleted mod: ${fileName}`);
        return;
      } catch {}

      // Try to delete disabled version
      await fs.unlink(disabledPath);
      console.log(`[Mod Manager] Deleted disabled mod: ${fileName}`);
    } catch (error) {
      throw new Error(`Failed to delete mod: ${fileName}`);
    }
  }

  /**
   * Install mod from file
   */
  async installMod(gameDir: string, sourceFile: string): Promise<ModInfo> {
    const modsDir = this.getModsDirectory(gameDir);
    await fs.mkdir(modsDir, { recursive: true });

    const fileName = path.basename(sourceFile);
    const targetPath = path.join(modsDir, fileName);

    // Check if mod already exists
    try {
      await fs.access(targetPath);
      throw new Error('Mod already exists');
    } catch (error: any) {
      if (error.message === 'Mod already exists') throw error;
    }

    // Copy mod file
    await fs.copyFile(sourceFile, targetPath);
    console.log(`[Mod Manager] Installed mod: ${fileName}`);

    // Parse and return mod info
    return await this.parseModInfo(targetPath, fileName, true);
  }
}
