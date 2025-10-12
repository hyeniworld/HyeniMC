import { registerProtocolWindows } from './register-windows';
import { registerProtocolMacOS } from './register-macos';

/**
 * Register custom URL protocol (hyenimc://)
 * Cross-platform: Windows, macOS
 */
export function registerCustomProtocol(): void {
  console.log('[Protocol] Registering custom protocol for platform:', process.platform);
  
  if (process.platform === 'win32') {
    registerProtocolWindows();
  } else if (process.platform === 'darwin') {
    registerProtocolMacOS();
  } else {
    console.warn('[Protocol] Custom protocol not supported on this platform');
  }
}
