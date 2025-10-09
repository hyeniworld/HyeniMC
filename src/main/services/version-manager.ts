import axios from 'axios';
import * as path from 'path';
import { DownloadManager } from './download-manager';

const VERSION_MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';

export interface MinecraftVersionManifest {
  id: string;
  type: string;
  url: string;
  time: string;
  releaseTime: string;
  sha1: string;
  complianceLevel: number;
}

export interface VersionDetails {
  id: string;
  type: string;
  mainClass: string;
  assets?: string;
  assetIndex: {
    id: string;
    sha1: string;
    size: number;
    totalSize: number;
    url: string;
  };
  downloads: {
    client: {
      sha1: string;
      size: number;
      url: string;
    };
    server?: {
      sha1: string;
      size: number;
      url: string;
    };
  };
  libraries: Library[];
  javaVersion?: {
    component: string;
    majorVersion: number;
  };
  // Old format (pre-1.13)
  minecraftArguments?: string;
  // New format (1.13+)
  arguments?: {
    game?: any[];
    jvm?: any[];
  };
}

export interface Library {
  name: string;
  downloads: {
    artifact?: {
      path: string;
      sha1: string;
      size: number;
      url: string;
    };
    classifiers?: Record<string, {
      path: string;
      sha1: string;
      size: number;
      url: string;
    }>;
  };
  rules?: Array<{
    action: 'allow' | 'disallow';
    os?: {
      name?: string;
      arch?: string;
    };
    features?: Record<string, boolean>;
  }>;
  natives?: Record<string, string>;
  extract?: {
    exclude?: string[];
  };
}

export class VersionManager {
  private instanceDir: string;
  private librariesDir: string;
  private assetsDir: string;
  private downloadManager: DownloadManager;

  constructor(instanceDir: string, librariesDir?: string, assetsDir?: string) {
    this.instanceDir = instanceDir;
    // Use shared directories if provided, otherwise use instance-local
    this.librariesDir = librariesDir || path.join(instanceDir, 'libraries');
    this.assetsDir = assetsDir || path.join(instanceDir, 'assets');
    // Increase concurrent downloads for better speed
    this.downloadManager = new DownloadManager(20);
  }

  /**
   * Get version manifest for a specific version
   */
  async getVersionManifest(versionId: string): Promise<MinecraftVersionManifest> {
    const response = await axios.get(VERSION_MANIFEST_URL);
    const manifest = response.data;

    const version = manifest.versions.find((v: any) => v.id === versionId);
    if (!version) {
      throw new Error(`Version ${versionId} not found`);
    }

    return version;
  }

  /**
   * Get version details
   */
  async getVersionDetails(versionId: string): Promise<VersionDetails> {
    const manifest = await this.getVersionManifest(versionId);
    const response = await axios.get(manifest.url);
    return response.data;
  }

  /**
   * Download game client JAR
   */
  async downloadClient(versionId: string, onProgress?: (progress: any) => void): Promise<string> {
    console.log(`[Version Manager] Downloading client for ${versionId}`);
    
    const details = await this.getVersionDetails(versionId);
    
    // Save version JSON
    const versionJsonPath = path.join(
      this.instanceDir,
      'versions',
      versionId,
      `${versionId}.json`
    );
    
    const fs = await import('fs/promises');
    await fs.mkdir(path.dirname(versionJsonPath), { recursive: true });
    await fs.writeFile(versionJsonPath, JSON.stringify(details, null, 2));
    console.log(`[Version Manager] Saved version JSON: ${versionJsonPath}`);
    
    // Download client JAR
    const clientJarPath = path.join(
      this.instanceDir,
      'versions',
      versionId,
      `${versionId}.jar`
    );

    const taskId = this.downloadManager.addTask(
      details.downloads.client.url,
      clientJarPath,
      details.downloads.client.sha1,
      'sha1'
    );

    await this.downloadManager.startAll(onProgress);
    
    console.log(`[Version Manager] Client downloaded: ${clientJarPath}`);
    return clientJarPath;
  }

  /**
   * Download libraries
   */
  async downloadLibraries(
    versionId: string,
    onProgress?: (progress: any) => void
  ): Promise<string[]> {
    console.log(`[Version Manager] Downloading libraries for ${versionId}`);
    
    const details = await this.getVersionDetails(versionId);
    const downloadedLibraries: string[] = [];

    for (const library of details.libraries) {
      // Check library rules
      if (!this.shouldDownloadLibrary(library)) {
        continue;
      }

      // Download artifact
      if (library.downloads.artifact) {
        const artifact = library.downloads.artifact;
        const libPath = path.join(this.librariesDir, artifact.path);

        this.downloadManager.addTask(
          artifact.url,
          libPath,
          artifact.sha1,
          'sha1'
        );

        downloadedLibraries.push(libPath);
      }

      // Download natives
      if (library.natives) {
        const nativeKey = this.getNativeKey();
        const classifier = library.natives[nativeKey];

        if (classifier && library.downloads.classifiers?.[classifier]) {
          const native = library.downloads.classifiers[classifier];
          const nativePath = path.join(this.librariesDir, native.path);

          this.downloadManager.addTask(
            native.url,
            nativePath,
            native.sha1,
            'sha1'
          );

          downloadedLibraries.push(nativePath);
        }
      }
    }

    await this.downloadManager.startAll(onProgress);
    
    console.log(`[Version Manager] Downloaded ${downloadedLibraries.length} libraries`);
    return downloadedLibraries;
  }

  /**
   * Download assets
   */
  async downloadAssets(
    versionId: string,
    onProgress?: (progress: any) => void
  ): Promise<number> {
    console.log(`[Version Manager] Downloading assets for ${versionId}`);
    
    const details = await this.getVersionDetails(versionId);
    const assetIndex = details.assetIndex;

    // Download asset index
    const assetIndexPath = path.join(
      this.assetsDir,
      'indexes',
      `${assetIndex.id}.json`
    );

    this.downloadManager.addTask(
      assetIndex.url,
      assetIndexPath,
      assetIndex.sha1,
      'sha1'
    );

    await this.downloadManager.startAll();

    // Parse asset index
    const fs = await import('fs/promises');
    const indexData = JSON.parse(await fs.readFile(assetIndexPath, 'utf-8'));
    const assets = indexData.objects || {};
    const assetEntries = Object.entries(assets);

    console.log(`[Version Manager] Found ${assetEntries.length} assets to download`);

    // Download all assets
    const assetsObjectsPath = path.join(this.assetsDir, 'objects');

    // Add all assets to download queue
    for (const [name, asset] of assetEntries) {
      const assetHash = (asset as any).hash;
      const hashPrefix = assetHash.substring(0, 2);
      const assetPath = path.join(assetsObjectsPath, hashPrefix, assetHash);
      const assetUrl = `https://resources.download.minecraft.net/${hashPrefix}/${assetHash}`;

      this.downloadManager.addTask(assetUrl, assetPath, assetHash, 'sha1');
    }

    // Wrap progress callback to add phase info
    const wrappedProgress = (progress: any) => {
      if (onProgress) {
        onProgress({
          ...progress,
          phase: 'assets',
        });
      }
    };

    await this.downloadManager.startAll(wrappedProgress);
    
    console.log(`[Version Manager] Asset download completed`);
    return assetEntries.length;
  }

  /**
   * Check if library should be downloaded based on rules
   */
  private shouldDownloadLibrary(library: Library): boolean {
    if (!library.rules) {
      return true;
    }

    let allowed = false;

    for (const rule of library.rules) {
      if (rule.os) {
        const osMatch = this.matchesOS(rule.os);
        if (rule.action === 'allow' && osMatch) {
          allowed = true;
        } else if (rule.action === 'disallow' && osMatch) {
          return false;
        }
      } else {
        allowed = rule.action === 'allow';
      }
    }

    return allowed;
  }

  /**
   * Check if OS matches rule
   */
  private matchesOS(osRule: { name?: string; arch?: string }): boolean {
    const platform = process.platform;
    const arch = process.arch;

    const osMap: Record<string, string> = {
      win32: 'windows',
      darwin: 'osx',
      linux: 'linux',
    };

    const osName = osMap[platform];

    if (osRule.name && osRule.name !== osName) {
      return false;
    }

    if (osRule.arch && osRule.arch !== arch) {
      return false;
    }

    return true;
  }

  /**
   * Get native key for current platform
   */
  private getNativeKey(): string {
    const platform = process.platform;

    switch (platform) {
      case 'win32':
        return 'windows';
      case 'darwin':
        return 'osx';
      case 'linux':
        return 'linux';
      default:
        return 'unknown';
    }
  }

  /**
   * Download all required files for a version
   */
  async downloadVersion(
    versionId: string,
    onProgress?: (progress: any) => void
  ): Promise<void> {
    console.log(`[Version Manager] Starting download for ${versionId}`);

    // Download in sequence to show progress properly
    await this.downloadClient(versionId, onProgress);
    await this.downloadLibraries(versionId, onProgress);
    await this.downloadAssets(versionId, onProgress);

    console.log(`[Version Manager] Download completed for ${versionId}`);
  }
}
