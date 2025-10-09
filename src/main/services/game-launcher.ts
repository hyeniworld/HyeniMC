import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { VersionDetails, Library } from './version-manager';

export interface LaunchOptions {
  versionId: string;
  javaPath: string;
  gameDir: string;
  minMemory?: number;
  maxMemory?: number;
  username?: string;
  uuid?: string;
  accessToken?: string;
  userType?: string;
}

export interface GameProcess {
  process: ChildProcess;
  versionId: string;
  startTime: Date;
}

export class GameLauncher {
  private activeProcesses: Map<string, GameProcess> = new Map();

  /**
   * Launch Minecraft
   */
  async launch(
    options: LaunchOptions,
    onLog?: (line: string) => void,
    onExit?: (code: number | null) => void
  ): Promise<GameProcess> {
    console.log(`[Game Launcher] Launching Minecraft ${options.versionId}`);

    // Build JVM arguments
    const jvmArgs = await this.buildJvmArguments(options);

    // Build game arguments
    const gameArgs = await this.buildGameArguments(options);

    // Combine all arguments
    const allArgs = [...jvmArgs, ...gameArgs];

    console.log(`[Game Launcher] Java: ${options.javaPath}`);
    console.log(`[Game Launcher] Working directory: ${options.gameDir}`);
    console.log(`[Game Launcher] Args count: ${allArgs.length}`);
    console.log(`[Game Launcher] JVM Args count: ${jvmArgs.length}`);
    console.log(`[Game Launcher] Game Args count: ${gameArgs.length}`);
    console.log(`[Game Launcher] Game Args:`, gameArgs);
    console.log(`[Game Launcher] Full command:`);
    console.log(`"${options.javaPath}" ${allArgs.slice(0, 10).join(' ')}...`);

    // Spawn process
    const childProcess = spawn(options.javaPath, allArgs, {
      cwd: options.gameDir,
      env: {
        ...process.env,
      },
    });

    const gameProcess: GameProcess = {
      process: childProcess,
      versionId: options.versionId,
      startTime: new Date(),
    };

    this.activeProcesses.set(options.versionId, gameProcess);

    // Handle stdout
    childProcess.stdout?.on('data', (data) => {
      const lines = data.toString().split('\n');
      lines.forEach((line: string) => {
        if (line.trim()) {
          console.log(`[Game Output] ${line}`);
          if (onLog) {
            onLog(line);
          }
        }
      });
    });

    // Handle stderr
    childProcess.stderr?.on('data', (data) => {
      const lines = data.toString().split('\n');
      lines.forEach((line: string) => {
        if (line.trim()) {
          console.error(`[Game Error] ${line}`);
          if (onLog) {
            onLog(`[ERROR] ${line}`);
          }
        }
      });
    });

    // Handle exit
    childProcess.on('exit', (code) => {
      console.log(`[Game Launcher] Process exited with code: ${code}`);
      this.activeProcesses.delete(options.versionId);
      if (onExit) {
        onExit(code);
      }
    });

    // Handle error
    childProcess.on('error', (error) => {
      console.error(`[Game Launcher] Process error:`, error);
      this.activeProcesses.delete(options.versionId);
    });

    return gameProcess;
  }

  /**
   * Build JVM arguments
   */
  private async buildJvmArguments(options: LaunchOptions): Promise<string[]> {
    const args: string[] = [];

    // macOS specific: GLFW needs to run on first thread
    if (process.platform === 'darwin') {
      args.push('-XstartOnFirstThread');
    }

    // Memory settings
    const minMemory = options.minMemory || 512;
    const maxMemory = options.maxMemory || 2048;
    args.push(`-Xms${minMemory}M`);
    args.push(`-Xmx${maxMemory}M`);

    // Native library path
    const nativesDir = await this.extractNatives(options.versionId, options.gameDir);
    args.push(`-Djava.library.path=${nativesDir}`);

    // Classpath
    const classpath = await this.buildClasspath(options.versionId, options.gameDir);
    args.push('-cp');
    args.push(classpath);

    // Additional JVM args
    args.push('-XX:+UnlockExperimentalVMOptions');
    args.push('-XX:+UseG1GC');
    args.push('-XX:G1NewSizePercent=20');
    args.push('-XX:G1ReservePercent=20');
    args.push('-XX:MaxGCPauseMillis=50');
    args.push('-XX:G1HeapRegionSize=32M');

    // Main class
    const versionJson = await this.loadVersionJson(options.versionId, options.gameDir);
    args.push(versionJson.mainClass);

    return args;
  }

  /**
   * Build game arguments
   */
  private async buildGameArguments(options: LaunchOptions): Promise<string[]> {
    const args: string[] = [];
    const versionJson = await this.loadVersionJson(options.versionId, options.gameDir);

    // Replace placeholders
    const username = options.username || 'Player';
    const uuid = options.uuid || '00000000-0000-0000-0000-000000000000';
    const accessToken = options.accessToken || 'null';
    const userType = options.userType || 'legacy';
    const versionName = options.versionId;
    const gameDirectory = options.gameDir;
    // Use shared assets directory
    const { getSharedAssetsDir } = await import('../utils/paths');
    const assetsDir = getSharedAssetsDir();
    const assetIndex = versionJson.assetIndex?.id || versionJson.assets || 'legacy';

    const replacements: Record<string, string> = {
      '${auth_player_name}': username,
      '${version_name}': versionName,
      '${game_directory}': gameDirectory,
      '${assets_root}': assetsDir,
      '${assets_index_name}': assetIndex,
      '${auth_uuid}': uuid,
      '${auth_access_token}': accessToken,
      '${user_type}': userType,
      '${version_type}': versionJson.type || 'release',
      '${user_properties}': '{}',
    };

    // Check which format to use
    if (versionJson.minecraftArguments) {
      // Old format (pre-1.13): single string with space-separated args
      const gameArgs = versionJson.minecraftArguments.split(' ');
      for (const arg of gameArgs) {
        let replaced = arg;
        for (const [key, value] of Object.entries(replacements)) {
          replaced = replaced.replace(key, value);
        }
        args.push(replaced);
      }
    } else if (versionJson.arguments?.game) {
      // New format (1.13+): array of strings or objects
      const gameArgs = this.parseArguments(versionJson.arguments.game);
      
      // Filter out quick play arguments to avoid conflicts
      const quickPlayArgs = ['--quickPlayPath', '--quickPlaySingleplayer', '--quickPlayMultiplayer', '--quickPlayRealms'];
      let skipNext = false;
      
      for (const arg of gameArgs) {
        if (skipNext) {
          skipNext = false;
          continue;
        }
        
        if (quickPlayArgs.includes(arg)) {
          skipNext = true; // Skip this arg and its value
          continue;
        }
        
        let replaced = arg;
        for (const [key, value] of Object.entries(replacements)) {
          replaced = replaced.replace(key, value);
        }
        args.push(replaced);
      }
    }

    return args;
  }

  /**
   * Build classpath
   */
  private async buildClasspath(versionId: string, gameDir: string): Promise<string> {
    const versionJson = await this.loadVersionJson(versionId, gameDir);
    const classpathParts: string[] = [];

    // Add libraries (from shared directory)
    const { getSharedLibrariesDir } = await import('../utils/paths');
    const librariesDir = getSharedLibrariesDir();
    for (const library of versionJson.libraries || []) {
      if (!this.shouldUseLibrary(library)) {
        continue;
      }

      if (library.downloads?.artifact) {
        const libPath = path.join(librariesDir, library.downloads.artifact.path);
        classpathParts.push(libPath);
      }
    }

    // Add client JAR
    const clientJar = path.join(gameDir, 'versions', versionId, `${versionId}.jar`);
    classpathParts.push(clientJar);

    // Join with platform-specific separator
    const separator = process.platform === 'win32' ? ';' : ':';
    return classpathParts.join(separator);
  }

  /**
   * Extract native libraries
   */
  private async extractNatives(versionId: string, gameDir: string): Promise<string> {
    const versionJson = await this.loadVersionJson(versionId, gameDir);
    const nativesDir = path.join(gameDir, 'versions', versionId, 'natives');

    // Create natives directory
    await fs.mkdir(nativesDir, { recursive: true });

    // Use shared libraries directory
    const { getSharedLibrariesDir } = await import('../utils/paths');
    const librariesDir = getSharedLibrariesDir();
    const AdmZip = (await import('adm-zip')).default;

    for (const library of versionJson.libraries || []) {
      if (!library.natives || !this.shouldUseLibrary(library)) {
        continue;
      }

      const nativeKey = this.getNativeKey();
      const classifier = library.natives[nativeKey];

      if (classifier && library.downloads?.classifiers?.[classifier]) {
        const native = library.downloads.classifiers[classifier];
        const nativePath = path.join(librariesDir, native.path);

        try {
          // Extract native library
          const zip = new AdmZip(nativePath);
          const exclude = library.extract?.exclude || [];

          for (const entry of zip.getEntries()) {
            const shouldExtract = !exclude.some((pattern) =>
              entry.entryName.startsWith(pattern.replace('/', ''))
            );

            if (shouldExtract && !entry.isDirectory) {
              const targetPath = path.join(nativesDir, entry.entryName);
              await fs.mkdir(path.dirname(targetPath), { recursive: true });
              await fs.writeFile(targetPath, entry.getData());
            }
          }

          console.log(`[Game Launcher] Extracted native: ${native.path}`);
        } catch (error) {
          console.error(`[Game Launcher] Failed to extract native ${nativePath}:`, error);
        }
      }
    }

    return nativesDir;
  }

  /**
   * Load version JSON
   */
  private async loadVersionJson(versionId: string, gameDir: string): Promise<VersionDetails> {
    const versionJsonPath = path.join(gameDir, 'versions', versionId, `${versionId}.json`);
    const content = await fs.readFile(versionJsonPath, 'utf-8');
    return JSON.parse(content);
  }

  /**
   * Check if library should be used
   */
  private shouldUseLibrary(library: Library): boolean {
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
   * Parse arguments (handles both string and object formats)
   */
  private parseArguments(args: any[]): string[] {
    const result: string[] = [];

    for (const arg of args) {
      if (typeof arg === 'string') {
        result.push(arg);
      } else if (typeof arg === 'object' && arg.value) {
        // Check rules if present
        if (!arg.rules || this.checkRules(arg.rules)) {
          if (Array.isArray(arg.value)) {
            result.push(...arg.value);
          } else {
            result.push(arg.value);
          }
        }
      }
    }

    return result;
  }

  /**
   * Check if rules match
   */
  private checkRules(rules: any[]): boolean {
    for (const rule of rules) {
      if (rule.os) {
        const matches = this.matchesOS(rule.os);
        if (rule.action === 'allow' && !matches) {
          return false;
        }
        if (rule.action === 'disallow' && matches) {
          return false;
        }
      }
    }
    return true;
  }

  /**
   * Stop game process
   */
  stopGame(versionId: string): boolean {
    const gameProcess = this.activeProcesses.get(versionId);
    if (gameProcess) {
      gameProcess.process.kill();
      this.activeProcesses.delete(versionId);
      return true;
    }
    return false;
  }

  /**
   * Get active processes
   */
  getActiveProcesses(): GameProcess[] {
    return Array.from(this.activeProcesses.values());
  }

  /**
   * Check if game is running
   */
  isGameRunning(versionId: string): boolean {
    return this.activeProcesses.has(versionId);
  }
}
