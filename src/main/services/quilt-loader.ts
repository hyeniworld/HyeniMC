import axios from 'axios';
import * as fs from 'fs/promises';
import * as path from 'path';

interface QuiltVersion {
  separator: string;
  build: number;
  maven: string;
  version: string;
}

interface QuiltLoaderVersion {
  loader: QuiltVersion;
  hashed: QuiltVersion;
  launcherMeta: {
    version: number;
    libraries: {
      client: any[];
      common: any[];
      server: any[];
    };
    mainClass: {
      client: string;
      server: string;
    };
  };
}

export class QuiltLoader {
  private readonly baseUrl = 'https://meta.quiltmc.org/v3';

  /**
   * Get all available Quilt loader versions (cached via gRPC)
   */
  async getAllVersions(forceRefresh = false): Promise<string[]> {
    try {
      const { cacheRpc } = await import('../grpc/clients');
      const response = await cacheRpc.getQuiltVersions({ forceRefresh });
      return response.versions.map(v => v.version);
    } catch (error) {
      console.error('[Quilt] Failed to fetch all versions:', error);
      throw new Error('Failed to fetch Quilt versions');
    }
  }

  /**
   * Get available Quilt versions for a Minecraft version
   * Note: This still uses direct API call as cached data doesn't include per-MC-version filtering
   */
  async getVersions(minecraftVersion: string): Promise<string[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/versions/loader/${minecraftVersion}`);
      return response.data.map((v: QuiltLoaderVersion) => v.loader.version);
    } catch (error) {
      console.error('[Quilt] Failed to fetch versions:', error);
      throw new Error('Failed to fetch Quilt versions');
    }
  }

  /**
   * Install Quilt loader
   */
  async install(
    minecraftVersion: string,
    quiltVersion: string,
    gameDir: string,
    onProgress?: (message: string, current: number, total: number) => void
  ): Promise<string> {
    try {
      console.log(`[Quilt] Installing Quilt ${quiltVersion} for Minecraft ${minecraftVersion}...`);

      // 1. Fetch profile
      if (onProgress) onProgress('Fetching Quilt profile...', 1, 4);
      const profile = await this.downloadProfile(minecraftVersion, quiltVersion, gameDir);

      // 2. Download libraries
      if (onProgress) onProgress('Downloading Quilt libraries...', 2, 4);
      const { getSharedLibrariesDir } = await import('../utils/paths');
      const librariesDir = getSharedLibrariesDir();
      await this.downloadLibraries(profile, librariesDir, (current, total) => {
        if (onProgress) {
          onProgress(`Downloading libraries (${current}/${total})...`, 2, 4);
        }
      });

      // 3. Complete
      if (onProgress) onProgress('Quilt installation completed', 4, 4);
      const versionId = `quilt-loader-${quiltVersion}-${minecraftVersion}`;
      console.log(`[Quilt] Installation completed: ${versionId}`);

      return versionId;
    } catch (error) {
      console.error('[Quilt] Installation failed:', error);
      throw error;
    }
  }

  /**
   * Download Quilt profile
   */
  private async downloadProfile(
    minecraftVersion: string,
    quiltVersion: string,
    gameDir: string
  ): Promise<any> {
    try {
      console.log(`[Quilt] Downloading profile for ${quiltVersion}...`);
      
      const url = `${this.baseUrl}/versions/loader/${minecraftVersion}/${quiltVersion}/profile/json`;
      const response = await axios.get(url);
      const profile = response.data;

      // Save profile
      const versionId = profile.id;
      const versionDir = path.join(gameDir, 'versions', versionId);
      await fs.mkdir(versionDir, { recursive: true });

      const profilePath = path.join(versionDir, `${versionId}.json`);
      await fs.writeFile(profilePath, JSON.stringify(profile, null, 2));
      
      console.log(`[Quilt] Profile saved: ${profilePath}`);
      return profile;
    } catch (error) {
      console.error('[Quilt] Failed to download profile:', error);
      throw new Error('Failed to download Quilt profile');
    }
  }

  /**
   * Convert Maven name to path (e.g., "org.example:artifact:1.0" -> "org/example/artifact/1.0/artifact-1.0.jar")
   */
  private mavenToPath(name: string): { path: string; url: string } {
    const parts = name.split(':');
    const group = parts[0].replace(/\./g, '/');
    const artifact = parts[1];
    const version = parts[2];
    
    const jarPath = `${group}/${artifact}/${version}/${artifact}-${version}.jar`;
    
    // Quilt uses Maven Central and Quilt Maven
    const quiltMavenUrl = `https://maven.quiltmc.org/repository/release/${jarPath}`;
    
    return { path: jarPath, url: quiltMavenUrl };
  }

  /**
   * Download Quilt libraries
   */
  private async downloadLibraries(
    profile: any,
    librariesDir: string,
    onProgress?: (current: number, total: number) => void
  ): Promise<void> {
    const libraries = profile.libraries || [];
    console.log(`[Quilt] Downloading ${libraries.length} libraries to: ${librariesDir}`);

    let completed = 0;
    let skipped = 0;
    let failed = 0;

    for (const library of libraries) {
      let artifact: { path: string; url: string; size?: number };
      
      // Try standard format first
      if (library.downloads?.artifact) {
        artifact = library.downloads.artifact;
      } 
      // Fallback: construct from Maven name
      else if (library.name) {
        artifact = this.mavenToPath(library.name);
      } 
      else {
        console.warn(`[Quilt] Library missing both artifact and name info:`, library);
        continue;
      }

      const filePath = path.join(librariesDir, artifact.path);

      // Check if already exists
      try {
        const stats = await fs.stat(filePath);
        if (!artifact.size || stats.size === artifact.size) {
          skipped++;
          completed++;
          if (onProgress) onProgress(completed, libraries.length);
          continue;
        }
      } catch {
        // File doesn't exist, download it
      }

      // Download
      try {
        const dir = path.dirname(filePath);
        await fs.mkdir(dir, { recursive: true });

        console.log(`[Quilt] Downloading: ${artifact.path}`);
        const response = await axios.get(artifact.url, { responseType: 'arraybuffer' });
        await fs.writeFile(filePath, response.data);
        
        completed++;
        if (onProgress) onProgress(completed, libraries.length);
      } catch (error) {
        failed++;
        console.error(`[Quilt] Failed to download library: ${artifact.path}`, error);
      }
    }

    console.log(`[Quilt] Library download summary: ${completed} total, ${skipped} skipped, ${failed} failed`);
    
    if (failed > 0) {
      throw new Error(`Failed to download ${failed} Quilt libraries`);
    }
  }

  /**
   * Verify Quilt installation
   */
  async verify(versionId: string, gameDir: string): Promise<boolean> {
    try {
      const versionDir = path.join(gameDir, 'versions', versionId);
      const profilePath = path.join(versionDir, `${versionId}.json`);

      await fs.access(profilePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Uninstall Quilt
   */
  async uninstall(versionId: string, gameDir: string): Promise<void> {
    try {
      const versionDir = path.join(gameDir, 'versions', versionId);
      await fs.rm(versionDir, { recursive: true, force: true });
      console.log(`[Quilt] Uninstalled: ${versionId}`);
    } catch (error) {
      console.error('[Quilt] Uninstall failed:', error);
      throw error;
    }
  }
}
