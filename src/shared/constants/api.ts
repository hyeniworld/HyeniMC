/**
 * API 엔드포인트 및 관련 상수
 */

export const API_ENDPOINTS = {
  // Modrinth
  MODRINTH_BASE: 'https://api.modrinth.com/v2',
  MODRINTH_SEARCH: '/search',
  MODRINTH_PROJECT: '/project',
  MODRINTH_VERSION: '/version',
  
  // CurseForge
  CURSEFORGE_BASE: 'https://api.curseforge.com/v1',
  CURSEFORGE_SEARCH: '/mods/search',
  CURSEFORGE_MOD: '/mods',
  
  // Minecraft
  MINECRAFT_MANIFEST: 'https://launchermeta.mojang.com/mc/game/version_manifest.json',
  MINECRAFT_RESOURCES: 'https://resources.download.minecraft.net',
  
  // Fabric
  FABRIC_META: 'https://meta.fabricmc.net/v2',
  FABRIC_VERSIONS: '/versions',
  FABRIC_LOADER: '/versions/loader',
  
  // Forge
  FORGE_MAVEN: 'https://files.minecraftforge.net/maven',
  FORGE_PROMOTIONS: 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json',
  
  // NeoForge
  NEOFORGE_MAVEN: 'https://maven.neoforged.net/releases',
  NEOFORGE_META: 'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge',
} as const;

export const API_HEADERS = {
  MODRINTH: {
    'User-Agent': 'HyeniMC/1.0.0 (hyeniworld@devbug.me)',
  },
  CURSEFORGE: {
    'Accept': 'application/json',
    'x-api-key': process.env.CURSEFORGE_API_KEY || '',
  },
} as const;

export const API_RATE_LIMITS = {
  MODRINTH: {
    requests: 300,
    window: 60000, // 1분
  },
  CURSEFORGE: {
    requests: 100,
    window: 60000, // 1분
  },
} as const;
