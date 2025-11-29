import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { VersionDetails, Library } from './version-manager';
import { GameLaunchValidator } from './game-launch-validator';
import { GameLaunchError } from '../utils/error-handler';

export interface LaunchOptions {
  profileId?: string;  // Profile ID for tracking
  versionId: string;
  javaPath: string;
  gameDir: string;
  minMemory?: number;
  maxMemory?: number;
  username?: string;
  uuid?: string;
  accessToken?: string;
  userType?: string;
  resolution?: {
    width: number;
    height: number;
  };
  fullscreen?: boolean;
}

export interface GameProcess {
  process: ChildProcess;
  profileId?: string;  // Profile ID
  versionId: string;
  startTime: Date;
  playTimeTracker?: NodeJS.Timeout;  // Timer for tracking play time
  lastRecordedTime: number;  // Last recorded play time in seconds
}

export class GameLauncher {
  private activeProcesses: Map<string, GameProcess> = new Map();
  private validator = new GameLaunchValidator();

  /**
   * Check if a profile is currently running (checks actual process state)
   */
  isProfileRunning(versionId: string): boolean {
    const gameProcess = this.activeProcesses.get(versionId);
    if (!gameProcess) {
      return false;
    }
    
    // Check if process is actually alive using PID
    try {
      // process.kill(pid, 0) doesn't actually kill, just checks if process exists
      process.kill(gameProcess.process.pid!, 0);
      return true;
    } catch (error) {
      // Process doesn't exist, clean up
      console.log(`[Game Launcher] Process ${gameProcess.process.pid} not found, cleaning up`);
      this.activeProcesses.delete(versionId);
      return false;
    }
  }

  /**
   * Launch Minecraft
   */
  async launch(
    options: LaunchOptions,
    onLog?: (line: string) => void,
    onExit?: (code: number | null) => void
  ): Promise<GameProcess> {
    // Check for duplicate launch
    if (this.isProfileRunning(options.versionId)) {
      throw new Error(`프로필 ${options.versionId}이(가) 이미 실행 중입니다!`);
    }

    // ✨ 실행 전 검증
    console.log('[Game Launcher] Validating launch configuration...');
    const validation = await this.validator.validateBeforeLaunch({
      profileId: options.profileId,
      gameVersion: options.versionId,
      javaPath: options.javaPath,
      gameDirectory: options.gameDir,
      memory: {
        min: options.minMemory || 512,
        max: options.maxMemory || 2048,
      },
    });
    
    // Warning 로그 출력
    validation.issues
      .filter(i => i.severity === 'warning')
      .forEach(issue => {
        console.warn(`[Validator] ${issue.title}: ${issue.message}`);
      });
    
    // Error 또는 Critical 발생 시 실행 차단
    if (!validation.canLaunch) {
      const criticalIssue = validation.issues.find(i => i.severity === 'critical') 
                          || validation.issues.find(i => i.severity === 'error')
                          || validation.issues[0];
      
      console.error('[Game Launcher] Validation failed:', criticalIssue);
      
      throw new GameLaunchError({
        title: criticalIssue.title,
        message: criticalIssue.message,
        solution: criticalIssue.solution,
        technicalDetails: criticalIssue.technicalDetails || JSON.stringify(validation.issues, null, 2),
      });
    }

    // Auto-fix invalid memory settings from profile (기존 로직 유지)
    if (options.minMemory && options.maxMemory && options.minMemory > options.maxMemory) {
      console.warn(`[Game Launcher] Invalid memory settings detected: min(${options.minMemory}MB) > max(${options.maxMemory}MB). Auto-correcting...`);
      options.maxMemory = options.minMemory;
      console.log(`[Game Launcher] Corrected memory settings: min=${options.minMemory}MB, max=${options.maxMemory}MB`);
    }

    console.log(`[Game Launcher] Launching Minecraft ${options.versionId}`);

    // Build JVM arguments
    const jvmArgs = await this.buildJvmArguments(options);

    // Build game arguments
    const gameArgs = await this.buildGameArguments(options);

    // Combine all arguments
    const allArgs = [...jvmArgs, ...gameArgs];

    console.log(`[Game Launcher] Java: ${options.javaPath}`);
    console.log(`[Game Launcher] Working directory: ${options.gameDir}`);
    console.log(`[Game Launcher] Total arguments: ${allArgs.length} (JVM: ${jvmArgs.length}, Game: ${gameArgs.length})`);

    // Launch process
    const childProcess = spawn(options.javaPath, allArgs, {
      cwd: options.gameDir,
      env: {
        ...process.env,
      },
    });

    const gameProcess: GameProcess = {
      process: childProcess,
      profileId: options.profileId,
      versionId: options.versionId,
      startTime: new Date(),
      lastRecordedTime: 0,
    };

    // Use profileId as key if available, otherwise use versionId
    const processKey = options.profileId || options.versionId;
    this.activeProcesses.set(processKey, gameProcess);
    console.log(`[Game Launcher] Started game: ${processKey} (PID: ${childProcess.pid})`);

    // Start play time tracker (record every 30 seconds if profileId is available)
    if (options.profileId) {
      gameProcess.playTimeTracker = setInterval(async () => {
        const elapsedSeconds = Math.floor((Date.now() - gameProcess.startTime.getTime()) / 1000);
        const newPlayTime = elapsedSeconds - gameProcess.lastRecordedTime;
        
        if (newPlayTime > 0) {
          try {
            const { cacheRpc } = await import('../grpc/clients');
            await cacheRpc.recordProfilePlayTime({
              profileId: options.profileId!,
              seconds: newPlayTime,
            });
            gameProcess.lastRecordedTime = elapsedSeconds;
            // Log only every 5 minutes (10 intervals) to reduce noise
            if (elapsedSeconds % 300 === 0 || elapsedSeconds < 60) {
              console.log(`[Game Launcher] Play time: ${Math.floor(elapsedSeconds / 60)}m ${elapsedSeconds % 60}s`);
            }
          } catch (error) {
            console.error('[Game Launcher] Failed to record play time:', error);
          }
        }
      }, 30000); // 30 seconds
      
      console.log(`[Game Launcher] Play time tracker started for profile ${options.profileId}`);
    }

    // ✨ Buffer for capturing process output (for crash analysis)
    const outputBuffer: string[] = [];
    const MAX_BUFFER_LINES = 500; // Keep last 500 lines
    
    const addToBuffer = (line: string) => {
      outputBuffer.push(line);
      if (outputBuffer.length > MAX_BUFFER_LINES) {
        outputBuffer.shift();
      }
    };

    // Handle stdout
    childProcess.stdout?.on('data', (data) => {
      const lines = data.toString().split('\n');
      lines.forEach((line: string) => {
        if (line.trim()) {
          addToBuffer(`[STDOUT] ${line}`);
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
          addToBuffer(`[STDERR] ${line}`);
          if (onLog) {
            onLog(`[ERROR] ${line}`);
          }
        }
      });
    });
    
    // Store buffer reference in gameProcess for crash analysis
    (gameProcess as any).outputBuffer = outputBuffer;

    // Handle exit
    childProcess.on('exit', async (code) => {
      console.log(`[Game Launcher] Process exited with code: ${code}`);
      const processKey = options.profileId || options.versionId;
      
      // Stop play time tracker and record final play time
      if (gameProcess.playTimeTracker) {
        clearInterval(gameProcess.playTimeTracker);
      }
      
      // Record final play time
      if (options.profileId) {
        const elapsedSeconds = Math.floor((Date.now() - gameProcess.startTime.getTime()) / 1000);
        const finalPlayTime = elapsedSeconds - gameProcess.lastRecordedTime;
        
        if (finalPlayTime > 0) {
          try {
            const { cacheRpc } = await import('../grpc/clients');
            await cacheRpc.recordProfilePlayTime({
              profileId: options.profileId,
              seconds: finalPlayTime,
            });
            const minutes = Math.floor(elapsedSeconds / 60);
            const seconds = elapsedSeconds % 60;
            console.log(`[Game Launcher] Total session: ${minutes}m ${seconds}s`);
          } catch (error) {
            console.error('[Game Launcher] Failed to record final play time:', error);
          }
        }
        
        // Record crash if exit code is not 0
        if (code !== 0 && code !== null) {
          try {
            const { cacheRpc } = await import('../grpc/clients');
            await cacheRpc.recordProfileCrash({ profileId: options.profileId });
            console.log(`[Game Launcher] Game crashed (exit code: ${code})`);
            
            // ✨ 크래시 분석
            const { CrashAnalyzer } = await import('./crash-analyzer');
            const analyzer = new CrashAnalyzer();
            const latestCrashLog = await analyzer.findLatestCrashLog(options.gameDir);
            
            // showErrorDialog를 통해 UI에 표시
            const { BrowserWindow } = await import('electron');
            const { showErrorDialog } = await import('../ipc/error-dialog');
            const windows = BrowserWindow.getAllWindows();
            const mainWindow = windows.length > 0 ? windows[0] : null;
            
            // Get buffered output
            const bufferedOutput = (gameProcess as any).outputBuffer as string[] || [];
            const elapsedMs = Date.now() - gameProcess.startTime.getTime();
            
            if (latestCrashLog) {
              console.log(`[Game Launcher] Analyzing crash log: ${latestCrashLog}`);
              const analysis = await analyzer.analyzeCrashLog(latestCrashLog);
              
              if (mainWindow) {
                showErrorDialog(mainWindow, {
                  type: 'error',
                  title: analysis.title,
                  message: analysis.message,
                  details: analysis.crashLog ? analysis.crashLog.substring(0, 2000) : undefined, // 처음 2000자만
                  suggestions: analysis.fixes.map(f => f.title),
                  actions: analysis.fixes
                    .filter(f => f.action)
                    .map(f => ({
                      label: f.title,
                      type: 'primary' as const,
                      action: f.action!,
                    })),
                });
              }
            } else {
              // ✨ 크래시 로그가 없는 경우 - 버퍼된 출력으로 분석
              console.warn(`[Game Launcher] No crash log found. Process ran for ${elapsedMs}ms`);
              
              // 버퍼된 출력을 로그에 기록
              if (bufferedOutput.length > 0) {
                console.log(`[Game Launcher] === Process Output (last ${bufferedOutput.length} lines) ===`);
                // 마지막 50줄만 콘솔에 출력
                const lastLines = bufferedOutput.slice(-50);
                lastLines.forEach(line => console.log(`  ${line}`));
                console.log(`[Game Launcher] === End of Process Output ===`);
              } else {
                console.warn(`[Game Launcher] No output was captured from the process`);
              }
              
              // 빠른 크래시인지 확인 (10초 이내)
              const isQuickCrash = elapsedMs < 10000;
              
              // 에러 분석
              const errorAnalysis = this.analyzeProcessOutput(bufferedOutput, code, elapsedMs);
              
              if (mainWindow) {
                showErrorDialog(mainWindow, {
                  type: 'error',
                  title: errorAnalysis.title,
                  message: errorAnalysis.message,
                  details: bufferedOutput.length > 0 
                    ? bufferedOutput.slice(-100).join('\n') 
                    : `프로세스가 ${elapsedMs}ms 만에 종료됨 (exit code: ${code})\n\n출력이 캡처되지 않았습니다.`,
                  suggestions: errorAnalysis.suggestions,
                });
              }
            }
          } catch (error) {
            console.error('[Game Launcher] Failed to record crash:', error);
          }
        }
      }
      
      this.activeProcesses.delete(processKey);
      if (onExit) {
        onExit(code);
      }
    });

    // Handle error
    childProcess.on('error', (error) => {
      console.error(`[Game Launcher] Process error:`, error);
      
      // Stop play time tracker
      if (gameProcess.playTimeTracker) {
        clearInterval(gameProcess.playTimeTracker);
      }
      
      // Send user-friendly error to renderer
      const { createUserFriendlyError } = require('../utils/error-handler');
      const userError = createUserFriendlyError(error);
      
      if (childProcess.stdout) {
        childProcess.stdout.emit('data', Buffer.from(`\n❌ ${userError.title}\n${userError.message}\n`));
        if (userError.solution) {
          childProcess.stdout.emit('data', Buffer.from(`💡 ${userError.solution}\n`));
        }
      }
      
      const processKey = options.profileId || options.versionId;
      this.activeProcesses.delete(processKey);
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

    // Memory settings with validation
    let minMemory = options.minMemory || 512;
    let maxMemory = options.maxMemory || 2048;
    
    // Validate: ensure min <= max
    if (minMemory > maxMemory) {
      console.warn(`[Game Launcher] WARNING: minMemory (${minMemory}MB) > maxMemory (${maxMemory}MB). Auto-adjusting maxMemory to ${minMemory}MB.`);
      maxMemory = minMemory;
    }
    
    console.log(`[Game Launcher] Memory settings: -Xms${minMemory}M -Xmx${maxMemory}M`);
    
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

    // Add JVM arguments from version JSON (for NeoForge, Fabric, Vanilla, etc.)
    const versionJson = await this.loadVersionJson(options.versionId, options.gameDir);
    if (versionJson.arguments?.jvm) {
      const { getSharedLibrariesDir } = await import('../utils/paths');
      const librariesDir = getSharedLibrariesDir();
      const instanceLibrariesDir = path.join(options.gameDir, 'libraries');
      
      for (const arg of versionJson.arguments.jvm) {
        if (typeof arg === 'string') {
          // Skip if it's a duplicate (already added above)
          if (arg.includes('${natives_directory}') || 
              arg.includes('${classpath}') ||
              arg === '-cp') {
            continue;
          }
          
          // Replace placeholders
          let processedArg = arg
            .replace(/\$\{library_directory\}/g, instanceLibrariesDir)
            .replace(/\$\{classpath_separator\}/g, process.platform === 'win32' ? ';' : ':')
            .replace(/\$\{version_name\}/g, options.versionId)
            .replace(/\$\{launcher_name\}/g, 'HyeniMC')
            .replace(/\$\{launcher_version\}/g, '1.0.0');
          
          args.push(processedArg);
        }
      }
    }

    // Main class
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
    
    console.log('[Game Launcher] Building game arguments:');
    console.log(`  - Username: ${username}`);
    console.log(`  - UUID: ${uuid}`);
    console.log(`  - User Type: ${userType}`);
    console.log(`  - Access Token: ${accessToken === 'null' ? 'null (offline)' : accessToken.substring(0, 20) + '...' }`);
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
      '${clientid}': uuid,
      '${auth_xuid}': uuid,
      '${resolution_width}': String(options.resolution?.width || 854),
      '${resolution_height}': String(options.resolution?.height || 480),
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

    // Add fullscreen if enabled (resolution placeholders are already replaced above)
    if (options.fullscreen) {
      args.push('--fullscreen');
    }

    return args;
  }

  /**
   * Build classpath
   */
  private async buildClasspath(versionId: string, gameDir: string): Promise<string> {
    const versionJson = await this.loadVersionJson(versionId, gameDir);
    const classpathParts: string[] = [];

    // Add libraries (check both instance and shared directories)
    const { getSharedLibrariesDir } = await import('../utils/paths');
    const sharedLibrariesDir = getSharedLibrariesDir();
    const instanceLibrariesDir = path.join(gameDir, 'libraries');
    
    const missingLibraries: string[] = [];
    const skippedByRules: string[] = [];
    
    for (const library of versionJson.libraries || []) {
      if (!this.shouldUseLibrary(library)) {
        skippedByRules.push(library.name || 'unknown');
        continue;
      }

      let relativePath: string;
      
      if (library.downloads?.artifact) {
        // Minecraft-style library with downloads info
        relativePath = library.downloads.artifact.path;
      } else if (library.name) {
        // Fabric/NeoForge-style library with only name (e.g., "net.fabricmc:fabric-loader:0.17.2")
        const parts = library.name.split(':');
        if (parts.length >= 3) {
          const [group, artifact, version] = parts;
          const groupPath = group.replace(/\./g, '/');
          const fileName = `${artifact}-${version}.jar`;
          relativePath = path.join(groupPath, artifact, version, fileName);
        } else {
          console.warn(`[Game Launcher] Invalid library name format: ${library.name}`);
          continue;
        }
      } else {
        console.warn(`[Game Launcher] Library has no downloads.artifact or name:`, library);
        continue;
      }
      
      // Check instance libraries first, then shared libraries
      const instanceLibPath = path.join(instanceLibrariesDir, relativePath);
      const sharedLibPath = path.join(sharedLibrariesDir, relativePath);
      
      let foundPath: string | null = null;
      
      try {
        await fs.access(instanceLibPath);
        foundPath = instanceLibPath;
      } catch {
        try {
          await fs.access(sharedLibPath);
          foundPath = sharedLibPath;
        } catch {
          // Library not found - try to download it
          const downloaded = await this.tryDownloadMissingLibrary(
            library.name || relativePath,
            relativePath,
            sharedLibPath,
            (library as any).url
          );
          
          if (downloaded) {
            foundPath = sharedLibPath;
          } else {
            missingLibraries.push(library.name || relativePath);
            foundPath = sharedLibPath; // Still add to classpath for error clarity
          }
        }
      }
      
      if (foundPath) {
        classpathParts.push(foundPath);
      }
    }

    console.log(`[Game Launcher] Built classpath with ${classpathParts.length} libraries`);
    
    if (skippedByRules.length > 0) {
      console.log(`[Game Launcher] Skipped ${skippedByRules.length} libraries by platform rules`);
    }
    
    if (missingLibraries.length > 0) {
      console.error(`[Game Launcher] ⚠️ Missing ${missingLibraries.length} libraries:`);
      missingLibraries.forEach(lib => console.error(`  - ${lib}`));
    }

    // Add client JAR (except for NeoForge, which uses its own client JAR)
    // NeoForge installer creates client-X.X.X-srg.jar which is loaded automatically
    if (!versionId.startsWith('neoforge-')) {
      // For versions with inheritsFrom, use the parent's JAR
      const clientVersionId = (versionJson as any).inheritsFrom || versionId;
      const clientJar = path.join(gameDir, 'versions', clientVersionId, `${clientVersionId}.jar`);
      
      console.log(`[Game Launcher] Client JAR: ${clientJar}`);
      classpathParts.push(clientJar);
    } else {
      console.log(`[Game Launcher] Skipping Minecraft JAR for NeoForge (uses own client JAR)`);
    }

    // Join with platform-specific separator
    const separator = process.platform === 'win32' ? ';' : ':';
    return classpathParts.join(separator);
  }

  /**
   * Try to download a missing library from Maven repositories
   */
  private async tryDownloadMissingLibrary(
    libraryName: string,
    relativePath: string,
    targetPath: string,
    libraryUrl?: string
  ): Promise<boolean> {
    const axios = (await import('axios')).default;
    
    // Maven 저장소 목록 (순서대로 시도)
    const mavenRepositories = [
      'https://maven.fabricmc.net/',
      'https://repo1.maven.org/maven2/',  // Maven Central
      'https://maven.neoforged.net/releases/',  // NeoForge Maven
    ];

    // URL 목록 생성
    const urlsToTry: string[] = [];
    const artifactPath = relativePath.replace(/\\/g, '/'); // Windows path를 URL 경로로 변환
    
    if (libraryUrl && libraryUrl.trim()) {
      const baseUrl = libraryUrl.endsWith('/') ? libraryUrl : `${libraryUrl}/`;
      urlsToTry.push(`${baseUrl}${artifactPath}`);
    }
    
    for (const repo of mavenRepositories) {
      const url = `${repo}${artifactPath}`;
      if (!urlsToTry.includes(url)) {
        urlsToTry.push(url);
      }
    }

    for (const url of urlsToTry) {
      try {
        console.log(`[Game Launcher] Downloading missing library: ${libraryName} from ${url}`);
        const response = await axios.get(url, { 
          responseType: 'arraybuffer',
          timeout: 30000,
          validateStatus: (status) => status === 200,
        });
        
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.writeFile(targetPath, response.data);
        
        console.log(`[Game Launcher] ✅ Downloaded missing library: ${libraryName}`);
        return true;
      } catch (error) {
        // 다음 URL 시도
      }
    }

    console.warn(`[Game Launcher] ❌ Failed to download library: ${libraryName}`);
    return false;
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
   * Load version JSON (with inheritance support for Fabric/Forge)
   */
  private async loadVersionJson(versionId: string, gameDir: string, visited = new Set<string>()): Promise<VersionDetails> {
    // Prevent infinite recursion
    if (visited.has(versionId)) {
      console.error(`[Game Launcher] Circular dependency detected: ${versionId}`);
      throw new Error(`Circular version dependency: ${versionId}`);
    }
    visited.add(versionId);

    const versionJsonPath = path.join(gameDir, 'versions', versionId, `${versionId}.json`);
    
    let content: string;
    try {
      content = await fs.readFile(versionJsonPath, 'utf-8');
    } catch (error) {
      console.error(`[Game Launcher] Failed to read version JSON: ${versionJsonPath}`);
      throw error;
    }
    
    const versionJson = JSON.parse(content);

    // Check if this version inherits from another (Fabric, Forge, etc.)
    if (versionJson.inheritsFrom) {
      console.log(`[Game Launcher] Loading ${versionId} → inherits from ${versionJson.inheritsFrom}`);
      
      // Load parent version (pass visited set to prevent cycles)
      const parentJson = await this.loadVersionJson(versionJson.inheritsFrom, gameDir, visited);
      
      // Merge libraries and remove duplicates (child libraries take precedence)
      // Compare by group:artifact (without version) to handle version conflicts
      const childLibs = versionJson.libraries || [];
      const parentLibs = parentJson.libraries || [];
      
      // Extract group:artifact from library name (e.g., "org.ow2.asm:asm:9.9" -> "org.ow2.asm:asm")
      const getLibraryKey = (name: string): string => {
        const parts = name.split(':');
        if (parts.length >= 2) {
          return `${parts[0]}:${parts[1]}`; // group:artifact
        }
        return name;
      };
      
      const childLibKeys = new Set(childLibs.map((lib: Library) => getLibraryKey(lib.name)));
      
      // Filter out parent libraries that have the same group:artifact as child libraries
      const uniqueParentLibs = parentLibs.filter((lib: Library) => {
        const key = getLibraryKey(lib.name);
        if (childLibKeys.has(key)) {
          console.log(`[Game Launcher] Using child version: ${childLibs.find((c: Library) => getLibraryKey(c.name) === key)?.name} (overrides ${lib.name})`);
          return false;
        }
        return true;
      });
      
      const mergedLibraries = [...childLibs, ...uniqueParentLibs];
      const duplicatesRemoved = parentLibs.length - uniqueParentLibs.length;
      
      if (duplicatesRemoved > 0) {
        console.log(`[Game Launcher] Removed ${duplicatesRemoved} duplicate libraries (version conflicts resolved)`);
      }
      
      // Merge parent and child
      const merged = {
        ...parentJson,
        ...versionJson,
        id: versionJson.id,
        libraries: mergedLibraries,
        // Merge arguments
        arguments: {
          game: [
            ...(versionJson.arguments?.game || []),
            ...(parentJson.arguments?.game || []),
          ],
          jvm: [
            ...(versionJson.arguments?.jvm || []),
            ...(parentJson.arguments?.jvm || []),
          ],
        },
        // Use child's mainClass if specified, otherwise parent's
        mainClass: versionJson.mainClass || parentJson.mainClass,
      };
      
      console.log(`[Game Launcher] Loaded ${versionId} with ${merged.libraries.length} libraries`);
      
      return merged;
    }

    return versionJson;
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
      // Check OS rules
      if (rule.os) {
        const matches = this.matchesOS(rule.os);
        if (rule.action === 'allow' && !matches) {
          return false;
        }
        if (rule.action === 'disallow' && matches) {
          return false;
        }
      }
      
      // Check feature rules (e.g., is_demo_user, has_custom_resolution)
      if (rule.features) {
        const matches = this.checkFeatures(rule.features);
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
   * Check if features match
   */
  private checkFeatures(features: Record<string, boolean>): boolean {
    // is_demo_user: true if the user doesn't own the game (should be false for authenticated users)
    if ('is_demo_user' in features) {
      return features.is_demo_user === false; // We never want demo mode for authenticated users
    }
    
    // has_custom_resolution: true if custom resolution is set
    if ('has_custom_resolution' in features) {
      return features.has_custom_resolution === true; // We support custom resolution
    }
    
    // has_quick_plays_support: for quick play feature
    if ('has_quick_plays_support' in features) {
      return features.has_quick_plays_support === false; // We don't support quick play
    }
    
    // is_quick_play_singleplayer/multiplayer/realms
    if ('is_quick_play_singleplayer' in features || 
        'is_quick_play_multiplayer' in features ||
        'is_quick_play_realms' in features) {
      return false; // We don't use quick play features
    }
    
    // Default: assume feature is not present
    return false;
  }

  /**
   * Stop game process
   */
  stopGame(versionId: string): boolean {
    const gameProcess = this.activeProcesses.get(versionId);
    if (gameProcess) {
      console.log(`[Game Launcher] Stopping game: ${versionId} (PID: ${gameProcess.process.pid})`);
      
      // Stop play time tracker
      if (gameProcess.playTimeTracker) {
        clearInterval(gameProcess.playTimeTracker);
      }
      
      gameProcess.process.kill('SIGTERM');  // Use SIGTERM for graceful shutdown
      this.activeProcesses.delete(versionId);
      return true;
    }
    console.warn(`[Game Launcher] Cannot stop - process not found: ${versionId}`);
    return false;
  }

  /**
   * Get active processes (verifies each process is actually running)
   */
  getActiveProcesses(): GameProcess[] {
    const activeProcesses: GameProcess[] = [];
    
    // Check each process and clean up dead ones
    for (const [key, gameProcess] of this.activeProcesses.entries()) {
      try {
        // Check if process is actually alive
        process.kill(gameProcess.process.pid!, 0);
        activeProcesses.push(gameProcess);
      } catch (error) {
        // Process is dead, clean up
        console.log(`[Game Launcher] Cleaning up dead process: ${key} (PID: ${gameProcess.process.pid})`);
        
        // Stop play time tracker
        if (gameProcess.playTimeTracker) {
          clearInterval(gameProcess.playTimeTracker);
        }
        
        this.activeProcesses.delete(key);
      }
    }
    
    return activeProcesses;
  }

  /**
   * Check if game is running (alias for isProfileRunning)
   */
  isGameRunning(versionId: string): boolean {
    return this.isProfileRunning(versionId);
  }

  /**
   * Analyze process output to determine crash cause
   */
  private analyzeProcessOutput(
    output: string[],
    exitCode: number | null,
    elapsedMs: number
  ): { title: string; message: string; suggestions: string[] } {
    const outputText = output.join('\n').toLowerCase();
    const suggestions: string[] = [];
    
    // Java 관련 에러 패턴
    const javaErrors = {
      'unsupportedclassversionerror': {
        title: 'Java 버전 호환성 문제',
        message: '현재 Java 버전이 이 마인크래프트 버전과 호환되지 않습니다.',
        suggestions: ['프로필 설정에서 Java 버전을 변경해보세요', 'Java 21 이상을 설치해보세요'],
      },
      'java.lang.noclassdeffounderror': {
        title: '클래스를 찾을 수 없음',
        message: '필요한 라이브러리나 클래스가 누락되었습니다.',
        suggestions: ['게임 파일을 다시 다운로드해보세요', '모드 충돌 여부를 확인해보세요'],
      },
      'java.lang.outofmemoryerror': {
        title: '메모리 부족',
        message: 'Java 힙 메모리가 부족합니다.',
        suggestions: ['프로필 설정에서 최대 메모리를 늘려보세요', '다른 프로그램을 종료해보세요'],
      },
      'could not create the java virtual machine': {
        title: 'JVM 생성 실패',
        message: 'Java Virtual Machine을 생성할 수 없습니다.',
        suggestions: ['할당된 메모리가 시스템 메모리보다 큰지 확인해보세요', 'Java를 다시 설치해보세요'],
      },
      'error: could not find or load main class': {
        title: '메인 클래스를 찾을 수 없음',
        message: '마인크래프트 실행 파일이 손상되었거나 누락되었습니다.',
        suggestions: ['게임 파일을 다시 다운로드해보세요', '버전 파일을 확인해보세요'],
      },
      'access is denied': {
        title: '접근 거부됨',
        message: '파일이나 폴더에 대한 접근이 거부되었습니다.',
        suggestions: ['관리자 권한으로 런처를 실행해보세요', '안티바이러스가 차단하는지 확인해보세요'],
      },
      'unable to access jarfile': {
        title: 'JAR 파일 접근 불가',
        message: '마인크래프트 JAR 파일을 찾을 수 없거나 접근할 수 없습니다.',
        suggestions: ['게임 파일을 다시 다운로드해보세요', '파일 경로에 특수문자가 있는지 확인해보세요'],
      },
    };

    // LWJGL/OpenGL 관련 에러
    const graphicsErrors = {
      'lwjgl': {
        title: 'LWJGL 에러',
        message: '그래픽 라이브러리에서 문제가 발생했습니다.',
        suggestions: ['그래픽 드라이버를 업데이트해보세요', 'Java 버전을 변경해보세요'],
      },
      'opengl': {
        title: 'OpenGL 에러',
        message: 'OpenGL 그래픽 에러가 발생했습니다.',
        suggestions: ['그래픽 드라이버를 업데이트해보세요', '호환성 모드로 실행해보세요'],
      },
      'no lwjgl': {
        title: 'LWJGL 누락',
        message: 'LWJGL 네이티브 라이브러리를 찾을 수 없습니다.',
        suggestions: ['게임 파일을 다시 다운로드해보세요', '64비트 Java를 사용하고 있는지 확인해보세요'],
      },
    };

    // 모드 관련 에러
    const modErrors = {
      'mixin': {
        title: 'Mixin 에러',
        message: '모드 로딩 중 에러가 발생했습니다.',
        suggestions: ['호환되지 않는 모드를 제거해보세요', '모드 버전을 확인해보세요'],
      },
      'fabric': {
        title: 'Fabric 에러',
        message: 'Fabric 모드 로더에서 에러가 발생했습니다.',
        suggestions: ['Fabric 버전을 업데이트해보세요', '모드 호환성을 확인해보세요'],
      },
      'forge': {
        title: 'Forge 에러',
        message: 'Forge 모드 로더에서 에러가 발생했습니다.',
        suggestions: ['Forge 버전을 업데이트해보세요', '모드 호환성을 확인해보세요'],
      },
    };

    // 에러 패턴 검색
    for (const [pattern, info] of Object.entries(javaErrors)) {
      if (outputText.includes(pattern)) {
        return { title: info.title, message: info.message, suggestions: info.suggestions };
      }
    }

    for (const [pattern, info] of Object.entries(graphicsErrors)) {
      if (outputText.includes(pattern)) {
        return { title: info.title, message: info.message, suggestions: info.suggestions };
      }
    }

    for (const [pattern, info] of Object.entries(modErrors)) {
      if (outputText.includes(pattern)) {
        return { title: info.title, message: info.message, suggestions: info.suggestions };
      }
    }

    // 일반적인 에러 메시지 찾기
    const errorLines = output.filter(line => 
      line.toLowerCase().includes('error') || 
      line.toLowerCase().includes('exception') ||
      line.toLowerCase().includes('failed')
    );

    if (errorLines.length > 0) {
      // 첫 번째 에러 라인에서 정보 추출
      const firstError = errorLines[0];
      return {
        title: '게임 실행 오류',
        message: firstError.replace('[STDOUT] ', '').replace('[STDERR] ', ''),
        suggestions: [
          '로그 내용을 확인하여 원인을 파악해보세요',
          '게임 파일을 다시 다운로드해보세요',
          '모드나 리소스팩을 제거하고 다시 시도해보세요',
        ],
      };
    }

    // 빠른 종료 (10초 이내)
    if (elapsedMs < 10000) {
      if (output.length === 0) {
        return {
          title: '게임이 즉시 종료됨',
          message: `프로세스가 ${elapsedMs}ms 만에 종료되었습니다. (exit code: ${exitCode})`,
          suggestions: [
            'Java 경로가 올바른지 확인해보세요',
            'Java 버전이 이 마인크래프트 버전과 호환되는지 확인해보세요',
            '게임 디렉토리 경로에 특수문자가 있는지 확인해보세요',
            '안티바이러스 프로그램이 차단하는지 확인해보세요',
          ],
        };
      }
      return {
        title: '게임이 빠르게 종료됨',
        message: `프로세스가 ${(elapsedMs / 1000).toFixed(1)}초 만에 종료되었습니다. (exit code: ${exitCode})`,
        suggestions: [
          '아래 로그 내용을 확인해보세요',
          'Java 버전이 호환되는지 확인해보세요',
          '모드 충돌 여부를 확인해보세요',
        ],
      };
    }

    // 기본 메시지
    return {
      title: '알 수 없는 오류',
      message: `게임이 비정상 종료되었습니다. (exit code: ${exitCode})`,
      suggestions: [
        '로그 내용을 확인해보세요',
        '마인크래프트 커뮤니티에서 도움을 구해보세요',
        '게임 파일을 다시 다운로드해보세요',
      ],
    };
  }
}
