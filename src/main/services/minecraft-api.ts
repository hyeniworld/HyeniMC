import { cacheRpc } from '../grpc/clients';

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

/**
 * Fetch Minecraft version list (cached via gRPC)
 * @param forceRefresh - Force refresh from API (bypass cache)
 */
export async function fetchMinecraftVersions(forceRefresh = false): Promise<string[]> {
  try {
    const response = await cacheRpc.getMinecraftVersions({
      forceRefresh,
      releasesOnly: true,
    });

    // Convert gRPC response to version IDs
    return response.versions.map(v => v.id);
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
 * Get latest Minecraft version (cached via gRPC)
 * @param forceRefresh - Force refresh from API (bypass cache)
 */
export async function getLatestMinecraftVersion(forceRefresh = false): Promise<string> {
  try {
    const response = await cacheRpc.getLatestMinecraftVersion({ forceRefresh });
    return response.version;
  } catch (error) {
    console.error('[Minecraft API] Failed to fetch latest version:', error);
    return '1.21.4';
  }
}
