import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { app } from 'electron';
import fs from 'fs/promises';
import fsSync from 'fs';

let backendProcess: ChildProcess | null = null;
let backendAddress: string | null = null;

/**
 * Start the Go gRPC backend server
 */
export async function startBackend(): Promise<string> {
  return new Promise((resolve, reject) => {
    const isDev = process.env.NODE_ENV === 'development';
    
    // Determine binary path
    let binaryPath: string;
    const platform = process.platform;
    const arch = process.arch;
    const ext = platform === 'win32' ? '.exe' : '';
    
    if (isDev) {
      // In development, use the project root backend directory
      // app.getAppPath() returns the dist/main directory in dev mode
      // We need to go up to the project root
      const projectRoot = path.join(app.getAppPath(), '..', '..');
      
      if (platform === 'darwin') {
        // Try universal binary first, fallback to architecture-specific
        const universalPath = path.join(projectRoot, 'backend', 'bin', 'hyenimc-backend');
        const archSpecificPath = path.join(
          projectRoot,
          'backend',
          'bin',
          arch === 'arm64' ? 'hyenimc-backend-arm64' : 'hyenimc-backend-x64'
        );
        
        // Check if universal binary exists
        const fs = require('fs');
        binaryPath = fs.existsSync(universalPath) ? universalPath : archSpecificPath;
      } else if (platform === 'win32') {
        binaryPath = path.join(
          projectRoot,
          'backend',
          'bin',
          `hyenimc-backend${ext}`
        );
      } else {
        reject(new Error(`Unsupported platform: ${platform}`));
        return;
      }
    } else {
      // In production, binary is in extraResources
      // electron-builder packages architecture-specific binaries as 'hyenimc-backend'
      const binaryName = platform === 'darwin' 
        ? 'hyenimc-backend'
        : `hyenimc-backend${ext}`;
      
      binaryPath = path.join(
        process.resourcesPath,
        'backend',
        binaryName
      );
    }

    console.log('[Backend] Starting backend server:', binaryPath);

    // Set data directory
    const dataDir = path.join(app.getPath('userData'), 'data');
    
    // Clean up any stale port file from previous runs
    const portFile = path.join(dataDir, '.grpc-port');
    try {
      fsSync.unlinkSync(portFile);
      console.log('[Backend] Cleaned up stale port file');
    } catch {
      // File doesn't exist, which is fine
    }
    
    // Spawn backend process
    backendProcess = spawn(binaryPath, [], {
      env: {
        ...process.env,
        HYENIMC_DATA_DIR: dataDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let resolved = false;

    // Capture stdout for logging
    backendProcess.stdout?.on('data', (data) => {
      const output = data.toString().trim();
      console.log('[Backend]', output);
    });

    backendProcess.stderr?.on('data', (data) => {
      console.error('[Backend Error]', data.toString());
    });

    backendProcess.on('error', (error) => {
      console.error('[Backend] Failed to start:', error);
      if (!resolved) {
        reject(error);
      }
    });

    backendProcess.on('exit', (code, signal) => {
      console.log(`[Backend] Process exited with code ${code}, signal ${signal}`);
      backendProcess = null;
      backendAddress = null;
    });

    // Poll for the port file (more reliable than stdout parsing)
    // (portFile already defined above)
    const maxAttempts = 50; // 5 seconds total (50 * 100ms)
    let attempts = 0;

    const pollPortFile = async () => {
      try {
        const content = await fs.readFile(portFile, 'utf-8');
        const trimmedContent = content.trim();
        
        // Parse format: address|pid
        const [address, pidStr] = trimmedContent.split('|');
        
        // Validate address format (security: prevent injection)
        if (address && /^127\.0\.0\.1:\d+$/.test(address) && !resolved) {
          // CRITICAL: Validate PID matches our spawned process
          const pid = parseInt(pidStr, 10);
          if (backendProcess && backendProcess.pid !== pid) {
            // This is a stale port file from a previous run - ignore and keep polling
            console.warn(`[Backend] Ignoring stale port file (expected PID ${backendProcess.pid}, got ${pid}). Continuing to poll...`);
            attempts++;
            if (attempts >= maxAttempts) {
              reject(new Error('Backend server failed to start within timeout (stale port file)'));
            } else {
              setTimeout(pollPortFile, 100);
            }
            return;
          }
          
          backendAddress = address;
          resolved = true;
          console.log('[Backend] Server listening on:', backendAddress, `(PID: ${pid})`);
          resolve(backendAddress);
        } else if (trimmedContent && !resolved) {
          reject(new Error(`Invalid backend port file format: ${trimmedContent}`));
        }
      } catch (err) {
        // File doesn't exist yet, keep polling
        attempts++;
        if (attempts >= maxAttempts) {
          if (!resolved) {
            reject(new Error('Backend server failed to start within timeout'));
          }
        } else {
          setTimeout(pollPortFile, 100);
        }
      }
    };

    // Start polling after a short delay
    setTimeout(pollPortFile, 100);
  });
}

/**
 * Stop the backend server
 */
export async function stopBackend(): Promise<void> {
  if (backendProcess) {
    return new Promise((resolve) => {
      backendProcess!.once('exit', async () => {
        backendProcess = null;
        backendAddress = null;
        
        // Clean up port file
        try {
          const dataDir = path.join(app.getPath('userData'), 'data');
          const portFile = path.join(dataDir, '.grpc-port');
          await fs.unlink(portFile);
          console.log('[Backend] Cleaned up port file');
        } catch (err) {
          // Ignore errors (file might not exist)
        }
        
        resolve();
      });
      
      backendProcess!.kill('SIGTERM');
      
      // Force kill after 5 seconds
      setTimeout(() => {
        if (backendProcess) {
          backendProcess.kill('SIGKILL');
        }
      }, 5000);
    });
  }
}

/**
 * Get the backend server address
 */
export function getBackendAddress(): string | null {
  return backendAddress;
}

/**
 * Check if backend is running
 */
export function isBackendRunning(): boolean {
  return backendProcess !== null && backendAddress !== null;
}
