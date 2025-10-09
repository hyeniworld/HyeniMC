import axios from 'axios';

export interface MinecraftVersionManifest {
  latest: {
    release: string;
    snapshot: string;
  };
  versions: Array<{
    id: string;
    type: 'release' | 'snapshot' | 'old_beta' | 'old_alpha';
    url: string;
    time: string;
    releaseTime: string;
  }>;
}

const VERSION_MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';

/**
 * Fetch Minecraft version list from Mojang API
 */
export async function fetchMinecraftVersions(): Promise<string[]> {
  try {
    const response = await axios.get<MinecraftVersionManifest>(VERSION_MANIFEST_URL);
    const manifest = response.data;

    // Filter only release versions (no snapshots)
    const releaseVersions = manifest.versions
      .filter(v => v.type === 'release')
      .map(v => v.id);

    return releaseVersions;
  } catch (error) {
    console.error('[Minecraft API] Failed to fetch versions:', error);
    // Return fallback versions if API fails
    return [
      '1.21.4', '1.21.3', '1.21.2', '1.21.1', '1.21',
      '1.20.6', '1.20.5', '1.20.4', '1.20.3', '1.20.2', '1.20.1', '1.20',
      '1.19.4', '1.19.3', '1.19.2', '1.19.1', '1.19',
      '1.18.2', '1.18.1', '1.18',
      '1.17.1', '1.17',
      '1.16.5', '1.16.4', '1.16.3', '1.16.2', '1.16.1',
    ];
  }
}

/**
 * Get latest Minecraft version
 */
export async function getLatestMinecraftVersion(): Promise<string> {
  try {
    const response = await axios.get<MinecraftVersionManifest>(VERSION_MANIFEST_URL);
    return response.data.latest.release;
  } catch (error) {
    console.error('[Minecraft API] Failed to fetch latest version:', error);
    return '1.21.4';
  }
}
