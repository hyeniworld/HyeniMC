import { app, BrowserWindow } from 'electron';
import { URL } from 'url';
import path from 'path';
import fs from 'fs/promises';
import AdmZip from 'adm-zip';
import nbt from 'prismarine-nbt';
import { profileRpc } from '../grpc/clients';

interface AuthData {
  token: string;
  servers?: string[];  // Multiple servers separated by comma (optional)
}

interface ProfileInfo {
  id: string;
  name: string;
  gameDirectory: string;
  serverAddress: string;
}

/**
 * Setup protocol handler for hyenimc:// URLs
 * Handles both Windows and macOS URL opening
 */
export function setupProtocolHandler(mainWindow: BrowserWindow | null): void {
  console.log('[Protocol] Setting up protocol handler');

  // macOS: App already running, receives open-url event
  app.on('open-url', (event, url) => {
    event.preventDefault();
    console.log('[Protocol] macOS open-url:', url);
    if (mainWindow) {
      handleProtocolUrl(url, mainWindow);
    }
  });

  // Windows: Already handled in second-instance event
  // (see main.ts)
}

/**
 * Handle protocol URL from command line or second-instance
 * Called from main.ts when hyenimc:// URL is detected
 */
export async function handleProtocolUrl(urlString: string, mainWindow: BrowserWindow): Promise<void> {
  try {
    console.log('[Protocol] Handling URL:', urlString);
    
    const url = new URL(urlString);
    
    if (url.protocol !== 'hyenimc:') {
      console.error('[Protocol] Invalid protocol:', url.protocol);
      return;
    }

    // Parse hostname/pathname
    // hyenimc://auth?token=xxx&server=yyy
    const hostname = url.hostname || url.pathname.replace('//', '').split('?')[0];
    
    if (hostname === 'auth') {
      const token = url.searchParams.get('token');
      const serverParam = url.searchParams.get('server');

      if (!token) {
        throw new Error('인증 토큰이 누락되었습니다.');
      }

      let servers: string[] | undefined;
      
      if (serverParam) {
        // Server parameter provided - filter by servers.dat
        servers = serverParam.split(',').map(s => s.trim()).filter(s => s.length > 0);
        
        if (servers.length === 0) {
          throw new Error('유효한 서버 주소가 없습니다.');
        }
        
        console.log('[Protocol] Auth request - Servers:', servers);
      } else {
        // No server parameter - apply to all profiles with HyeniHelper
        console.log('[Protocol] Auth request - All profiles (no server filter)');
      }
      
      const result = await handleAuthRequest({ token, servers });
      
      // Send success message to UI
      const serverMessage = servers ? servers.join(', ') : '모든 프로필';
      mainWindow.webContents.send('auth:success', {
        servers: serverMessage,
        token,
        profileCount: result.profileCount,
        profileNames: result.profileNames,
        message: `${serverMessage} 인증 완료! (${result.profileCount}개 프로필)`
      });
    } else {
      console.error('[Protocol] Unknown endpoint:', hostname);
      throw new Error(`알 수 없는 엔드포인트: ${hostname}`);
    }
  } catch (error) {
    console.error('[Protocol] Handler error:', error);
    mainWindow.webContents.send('auth:error', {
      message: error instanceof Error ? error.message : '인증 처리 중 오류가 발생했습니다.'
    });
  }
}

/**
 * Handle authentication request
 * Two modes:
 * 1. With servers: Find profiles by servers.dat, overwrite config unconditionally
 * 2. Without servers: Find all profiles with HyeniHelper, only write if config is missing or token is empty
 */
async function handleAuthRequest(data: AuthData): Promise<{ profileCount: number; profileNames: string[] }> {
  const { token, servers } = data;
  
  let successCount = 0;
  const updatedProfiles: string[] = [];
  const processedProfileIds = new Set<string>();  // Avoid duplicate processing

  if (servers && servers.length > 0) {
    // MODE 1: Server-specific authentication (with servers.dat filter)
    console.log(`[Protocol] Processing auth for servers: ${servers.join(', ')}`);
    
    for (const server of servers) {
      console.log(`[Protocol] Processing server: ${server}`);
      
      const profiles = await findProfilesByServer(server);
      
      if (profiles.length === 0) {
        console.warn(`[Protocol] No profiles found for server: ${server}`);
        continue;
      }

      console.log(`[Protocol] Found ${profiles.length} profiles with server ${server}`);

      for (const profile of profiles) {
        if (processedProfileIds.has(profile.id)) {
          console.log(`[Protocol] Profile ${profile.name} already processed, skipping...`);
          continue;
        }

        try {
          const hasHyeniHelper = await checkForHyeniHelperMod(profile.gameDirectory);

          if (hasHyeniHelper) {
            console.log(`[Protocol] Found HyeniHelper in profile: ${profile.name}`);
            
            // Write config unconditionally (overwrite)
            await writeHyeniHelperConfig(profile.gameDirectory, token, true);
            successCount++;
            updatedProfiles.push(profile.name);
            processedProfileIds.add(profile.id);
          } else {
            console.log(`[Protocol] No HyeniHelper found in profile: ${profile.name}`);
          }
        } catch (error) {
          console.error(`[Protocol] Error processing profile ${profile.name}:`, error);
        }
      }
    }
    
    if (successCount === 0) {
      throw new Error('HyeniHelper 모드가 설치된 프로필을 찾을 수 없습니다.\n\n다음을 확인해주세요:\n1. 마인크래프트 멀티플레이에서 서버를 추가했는지\n2. HyeniHelper 모드가 mods 폴더에 설치되어 있는지');
    }
  } else {
    // MODE 2: Global authentication (all profiles with HyeniHelper)
    console.log(`[Protocol] Processing auth for all profiles`);
    
    const profiles = await findAllProfiles();
    console.log(`[Protocol] Total profiles found: ${profiles.length}`);
    
    for (const profile of profiles) {
      try {
        const hasHyeniHelper = await checkForHyeniHelperMod(profile.gameDirectory);

        if (hasHyeniHelper) {
          console.log(`[Protocol] Found HyeniHelper in profile: ${profile.name}`);
          
          // Check if config exists and has token
          const shouldWrite = await shouldWriteConfig(profile.gameDirectory);
          
          if (shouldWrite) {
            await writeHyeniHelperConfig(profile.gameDirectory, token, false);
            successCount++;
            updatedProfiles.push(profile.name);
            console.log(`[Protocol] ✅ Config written for profile: ${profile.name}`);
          } else {
            console.log(`[Protocol] ⏭️ Skipped profile ${profile.name} (config already exists with token)`);
          }
        }
      } catch (error) {
        console.error(`[Protocol] Error processing profile ${profile.name}:`, error);
      }
    }
    
    if (successCount === 0) {
      throw new Error('HyeniHelper 모드가 설치된 프로필을 찾을 수 없거나,\n모든 프로필에 이미 토큰이 설정되어 있습니다.');
    }
  }

  console.log(`[Protocol] Auth completed for ${successCount} profiles: ${updatedProfiles.join(', ')}`);
  
  return {
    profileCount: successCount,
    profileNames: updatedProfiles
  };
}

/**
 * Find all profiles
 */
async function findAllProfiles(): Promise<ProfileInfo[]> {
  try {
    const response = await profileRpc.listProfiles({});
    
    return (response.profiles || []).map(profile => ({
      id: profile.id,
      name: profile.name,
      gameDirectory: profile.gameDirectory,
      serverAddress: ''
    }));
  } catch (error) {
    console.error('[Protocol] Failed to fetch profiles:', error);
    throw new Error('프로필 목록을 가져오는데 실패했습니다.');
  }
}

/**
 * Find profiles by checking servers.dat file
 */
async function findProfilesByServer(serverAddress: string): Promise<ProfileInfo[]> {
  try {
    const response = await profileRpc.listProfiles({});
    
    console.log(`[Protocol] Total profiles found: ${response.profiles?.length || 0}`);
    
    const matchingProfiles: ProfileInfo[] = [];
    
    // Check each profile's servers.dat file
    for (const profile of response.profiles || []) {
      const hasServer = await checkServersDat(profile.gameDirectory, serverAddress);
      
      if (hasServer) {
        console.log(`[Protocol] ✅ Profile "${profile.name}" has server "${serverAddress}"`);
        matchingProfiles.push({
          id: profile.id,
          name: profile.name,
          gameDirectory: profile.gameDirectory,
          serverAddress: serverAddress
        });
      } else {
        console.log(`[Protocol] ❌ Profile "${profile.name}" does not have server "${serverAddress}"`);
      }
    }
    
    console.log(`[Protocol] Matching profiles for "${serverAddress}": ${matchingProfiles.length}`);
    
    return matchingProfiles;
  } catch (error) {
    console.error('[Protocol] Failed to fetch profiles:', error);
    throw new Error('프로필 목록을 가져오는데 실패했습니다.');
  }
}

/**
 * Check if HyeniHelper mod exists by examining JAR files
 */
async function checkForHyeniHelperMod(gameDirectory: string): Promise<boolean> {
  const modsDir = path.join(gameDirectory, 'mods');
  
  console.log(`[Protocol] Checking mods directory: ${modsDir}`);
  
  try {
    const files = await fs.readdir(modsDir);
    console.log(`[Protocol] Files in mods directory: ${files.length}`);
    
    // Get all jar files
    const jarFiles = files.filter(f => f.endsWith('.jar'));
    if (jarFiles.length > 0) {
      console.log(`[Protocol] JAR files found:`, jarFiles);
    }
    
    // First check: filename contains hyenihelper
    const nameMatch = jarFiles.find(f => f.toLowerCase().includes('hyenihelper'));
    if (nameMatch) {
      console.log(`[Protocol] ✅ HyeniHelper mod found by filename: ${nameMatch}`);
      return true;
    }
    
    // Second check: examine JAR metadata
    for (const jarFile of jarFiles) {
      const jarPath = path.join(modsDir, jarFile);
      const isHyeniHelper = await checkJarModId(jarPath);
      if (isHyeniHelper) {
        console.log(`[Protocol] ✅ HyeniHelper mod found by metadata: ${jarFile}`);
        return true;
      }
    }
    
    console.log(`[Protocol] ❌ HyeniHelper mod not found`);
    return false;
  } catch (error) {
    console.warn(`[Protocol] ⚠️ Cannot read mods directory: ${modsDir}`, error);
    return false;
  }
}

/**
 * Check servers.dat file for matching server address
 */
async function checkServersDat(gameDirectory: string, serverAddress: string): Promise<boolean> {
  const serversDatPath = path.join(gameDirectory, 'servers.dat');
  
  try {
    // Check if file exists
    await fs.access(serversDatPath);
    
    // Read NBT data
    const data = await fs.readFile(serversDatPath);
    const parsed: any = await nbt.parse(data);
    
    // servers.dat structure: { servers: [ { ip: "address" } ] }
    const servers = parsed?.parsed?.value?.servers?.value?.value || [];
    
    const hasServer = servers.some((server: any) => {
      const ip = server?.ip?.value || '';
      return ip.toLowerCase() === serverAddress.toLowerCase();
    });
    
    console.log(`[Protocol] Checked servers.dat in "${gameDirectory}": ${hasServer ? 'found' : 'not found'}`);
    return hasServer;
  } catch (error) {
    // File doesn't exist or can't be read - that's okay
    console.log(`[Protocol] No servers.dat in "${gameDirectory}"`);
    return false;
  }
}

/**
 * Check JAR file's mod metadata (mods.toml or neoforge.mods.toml)
 */
async function checkJarModId(jarPath: string): Promise<boolean> {
  try {
    const zip = new AdmZip(jarPath);
    
    // Check for mods.toml or neoforge.mods.toml
    const tomlPaths = [
      'META-INF/mods.toml',
      'META-INF/neoforge.mods.toml'
    ];
    
    for (const tomlPath of tomlPaths) {
      const entry = zip.getEntry(tomlPath);
      if (entry) {
        const content = entry.getData().toString('utf8');
        
        // Simple check: look for modId = "hyenihelper" or modId="hyenihelper"
        if (content.includes('hyenihelper')) {
          return true;
        }
      }
    }
    
    return false;
  } catch (error) {
    // Can't read JAR file
    return false;
  }
}

/**
 * Check if config should be written
 * Returns true if:
 * - Config file doesn't exist
 * - Config file exists but token is empty/missing
 */
async function shouldWriteConfig(gameDirectory: string): Promise<boolean> {
  const configFile = path.join(gameDirectory, 'config', 'hyenihelper-config.json');
  
  try {
    await fs.access(configFile);
    
    // File exists - check if token is empty
    const content = await fs.readFile(configFile, 'utf-8');
    const config = JSON.parse(content);
    
    // If token is missing or empty, we should write
    const hasToken = config.token && config.token.trim().length > 0;
    return !hasToken;
  } catch (error) {
    // File doesn't exist - we should write
    return true;
  }
}

/**
 * Write HyeniHelper config file
 * Format: hyenihelper-config.json (not hyenihelper.json)
 * @param gameDirectory - Profile's game directory
 * @param token - Authentication token
 * @param overwrite - If true, overwrite even if config exists with token
 */
async function writeHyeniHelperConfig(
  gameDirectory: string, 
  token: string,
  overwrite: boolean
): Promise<void> {
  const configDir = path.join(gameDirectory, 'config');
  const configFile = path.join(configDir, 'hyenihelper-config.json');

  // Create config directory if not exists
  await fs.mkdir(configDir, { recursive: true });

  const config = {
    token: token,
    enabled: true,
    timeoutSeconds: 10,
    serverStatusPort: 4444,
    authPort: 35565,
    serverStatusInterval: 180
  };

  await fs.writeFile(configFile, JSON.stringify(config, null, 2), 'utf-8');
  console.log(`[Protocol] Config file written: ${configFile} (overwrite: ${overwrite})`);
}
