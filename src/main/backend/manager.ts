import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { app } from 'electron';

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
        binaryPath = path.join(
          projectRoot,
          'backend',
          'bin',
          arch === 'arm64' ? 'hyenimc-backend' : 'hyenimc-backend-x64'
        );
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
      const binaryName = platform === 'darwin' 
        ? (arch === 'arm64' ? 'hyenimc-backend' : 'hyenimc-backend-x64')
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
    
    // Spawn backend process
    backendProcess = spawn(binaryPath, [], {
      env: {
        ...process.env,
        HYENIMC_DATA_DIR: dataDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let resolved = false;

    // Capture stdout to get the listening address
    backendProcess.stdout?.on('data', (data) => {
      const output = data.toString().trim();
      console.log('[Backend]', output);

      if (!resolved && output.match(/^\d+\.\d+\.\d+\.\d+:\d+$/)) {
        backendAddress = output;
        resolved = true;
        console.log('[Backend] Server listening on:', backendAddress);
        resolve(output);
      }
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

    // Timeout after 10 seconds
    setTimeout(() => {
      if (!resolved) {
        reject(new Error('Backend server failed to start within timeout'));
      }
    }, 10000);
  });
}

/**
 * Stop the backend server
 */
export async function stopBackend(): Promise<void> {
  if (backendProcess) {
    return new Promise((resolve) => {
      backendProcess!.once('exit', () => {
        backendProcess = null;
        backendAddress = null;
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
