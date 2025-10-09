import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';

const execAsync = promisify(exec);

export interface JavaInstallation {
  path: string;
  version: string;
  majorVersion: number;
  vendor?: string;
  architecture: string;
}

/**
 * Detect Java installations on the system
 */
export async function detectJavaInstallations(): Promise<JavaInstallation[]> {
  const installations: JavaInstallation[] = [];
  const platform = process.platform;

  try {
    if (platform === 'darwin') {
      // macOS
      installations.push(...await detectMacOSJava());
    } else if (platform === 'win32') {
      // Windows
      installations.push(...await detectWindowsJava());
    } else if (platform === 'linux') {
      // Linux
      installations.push(...await detectLinuxJava());
    }
  } catch (error) {
    console.error('[Java Detector] Error detecting Java:', error);
  }

  return installations;
}

/**
 * Detect Java on macOS
 */
async function detectMacOSJava(): Promise<JavaInstallation[]> {
  const installations: JavaInstallation[] = [];

  try {
    // Check using /usr/libexec/java_home
    const { stdout } = await execAsync('/usr/libexec/java_home -V 2>&1');
    const lines = stdout.split('\n');

    for (const line of lines) {
      // Parse lines like: "1.8.0_292" (x86_64) "AdoptOpenJDK" - "AdoptOpenJDK 8"
      const match = line.match(/"([^"]+)"\s+\(([^)]+)\)\s+"([^"]+)"/);
      if (match) {
        const version = match[1];
        const arch = match[2];
        const vendor = match[3];

        try {
          const { stdout: homePath } = await execAsync(`/usr/libexec/java_home -v "${version}"`);
          const javaPath = path.join(homePath.trim(), 'bin', 'java');

          installations.push({
            path: javaPath,
            version,
            majorVersion: parseMajorVersion(version),
            vendor,
            architecture: arch,
          });
        } catch (err) {
          // Skip this version
        }
      }
    }

    // Also check common paths
    const commonPaths = [
      '/Library/Java/JavaVirtualMachines',
      path.join(process.env.HOME || '', 'Library/Java/JavaVirtualMachines'),
    ];

    for (const basePath of commonPaths) {
      try {
        const dirs = await fs.readdir(basePath);
        for (const dir of dirs) {
          const javaPath = path.join(basePath, dir, 'Contents/Home/bin/java');
          try {
            await fs.access(javaPath);
            const version = await getJavaVersion(javaPath);
            if (version && !installations.find(j => j.path === javaPath)) {
              installations.push({
                path: javaPath,
                version: version.version,
                majorVersion: version.majorVersion,
                architecture: process.arch,
              });
            }
          } catch {
            // Skip
          }
        }
      } catch {
        // Directory doesn't exist
      }
    }
  } catch (error) {
    console.error('[Java Detector] macOS detection error:', error);
  }

  return installations;
}

/**
 * Detect Java on Windows
 */
async function detectWindowsJava(): Promise<JavaInstallation[]> {
  const installations: JavaInstallation[] = [];

  try {
    // Check common installation paths
    const programFiles = [
      process.env.ProgramFiles || 'C:\\Program Files',
      process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
    ];

    for (const programFile of programFiles) {
      const javaBasePaths = [
        path.join(programFile, 'Java'),
        path.join(programFile, 'Eclipse Adoptium'),
        path.join(programFile, 'Zulu'),
        path.join(programFile, 'Microsoft'),
      ];

      for (const basePath of javaBasePaths) {
        try {
          const dirs = await fs.readdir(basePath);
          for (const dir of dirs) {
            const javaPath = path.join(basePath, dir, 'bin', 'java.exe');
            try {
              await fs.access(javaPath);
              const version = await getJavaVersion(javaPath);
              if (version) {
                installations.push({
                  path: javaPath,
                  version: version.version,
                  majorVersion: version.majorVersion,
                  vendor: basePath.includes('Adoptium') ? 'Eclipse Adoptium' : 
                          basePath.includes('Zulu') ? 'Azul Zulu' :
                          basePath.includes('Microsoft') ? 'Microsoft' : undefined,
                  architecture: programFile.includes('x86') ? 'x86' : 'x64',
                });
              }
            } catch {
              // Skip
            }
          }
        } catch {
          // Directory doesn't exist
        }
      }
    }

    // Check PATH
    try {
      const { stdout } = await execAsync('where java');
      const paths = stdout.split('\n').filter(p => p.trim());
      for (const javaPath of paths) {
        const cleanPath = javaPath.trim();
        if (!installations.find(j => j.path === cleanPath)) {
          const version = await getJavaVersion(cleanPath);
          if (version) {
            installations.push({
              path: cleanPath,
              version: version.version,
              majorVersion: version.majorVersion,
              architecture: 'unknown',
            });
          }
        }
      }
    } catch {
      // java not in PATH
    }
  } catch (error) {
    console.error('[Java Detector] Windows detection error:', error);
  }

  return installations;
}

/**
 * Detect Java on Linux
 */
async function detectLinuxJava(): Promise<JavaInstallation[]> {
  const installations: JavaInstallation[] = [];

  try {
    // Check common paths
    const commonPaths = [
      '/usr/lib/jvm',
      '/usr/java',
      path.join(process.env.HOME || '', '.sdkman/candidates/java'),
    ];

    for (const basePath of commonPaths) {
      try {
        const dirs = await fs.readdir(basePath);
        for (const dir of dirs) {
          const javaPath = path.join(basePath, dir, 'bin', 'java');
          try {
            await fs.access(javaPath);
            const version = await getJavaVersion(javaPath);
            if (version) {
              installations.push({
                path: javaPath,
                version: version.version,
                majorVersion: version.majorVersion,
                architecture: process.arch,
              });
            }
          } catch {
            // Skip
          }
        }
      } catch {
        // Directory doesn't exist
      }
    }

    // Check update-alternatives
    try {
      const { stdout } = await execAsync('update-alternatives --list java');
      const paths = stdout.split('\n').filter(p => p.trim());
      for (const javaPath of paths) {
        if (!installations.find(j => j.path === javaPath)) {
          const version = await getJavaVersion(javaPath);
          if (version) {
            installations.push({
              path: javaPath,
              version: version.version,
              majorVersion: version.majorVersion,
              architecture: process.arch,
            });
          }
        }
      }
    } catch {
      // update-alternatives not available
    }
  } catch (error) {
    console.error('[Java Detector] Linux detection error:', error);
  }

  return installations;
}

/**
 * Get Java version from executable
 */
async function getJavaVersion(javaPath: string): Promise<{ version: string; majorVersion: number } | null> {
  try {
    const { stdout, stderr } = await execAsync(`"${javaPath}" -version 2>&1`);
    const output = stdout + stderr;
    
    // Parse version from output
    // Examples:
    // java version "1.8.0_292"
    // openjdk version "11.0.11"
    // openjdk version "17.0.1"
    const versionMatch = output.match(/version "([^"]+)"/);
    if (versionMatch) {
      const version = versionMatch[1];
      const majorVersion = parseMajorVersion(version);
      return { version, majorVersion };
    }
  } catch (error) {
    console.error(`[Java Detector] Failed to get version for ${javaPath}:`, error);
  }

  return null;
}

/**
 * Parse major version from version string
 */
function parseMajorVersion(version: string): number {
  // Handle both old format (1.8.0_292) and new format (11.0.11)
  const match = version.match(/^1\.(\d+)|^(\d+)/);
  if (match) {
    return parseInt(match[1] || match[2], 10);
  }
  return 0;
}

/**
 * Get recommended Java version for Minecraft version
 */
export function getRecommendedJavaVersion(minecraftVersion: string): number {
  const version = minecraftVersion.split('.').map(Number);
  
  // Minecraft 1.18+ requires Java 17
  if (version[0] === 1 && version[1] >= 18) {
    return 17;
  }
  
  // Minecraft 1.17 requires Java 16
  if (version[0] === 1 && version[1] === 17) {
    return 16;
  }
  
  // Older versions work with Java 8
  return 8;
}

/**
 * Check if Java installation is compatible with Minecraft version
 */
export function isJavaCompatible(javaVersion: number, minecraftVersion: string): boolean {
  const required = getRecommendedJavaVersion(minecraftVersion);
  return javaVersion >= required;
}
