import { app } from 'electron';
import path from 'path';

/**
 * Register custom protocol handler for Windows
 * 
 * This allows the app to handle hyenimc:// URLs
 * Example: hyenimc://auth?token=xxx&server=yyy
 */
export function registerProtocolWindows(): void {
  if (process.defaultApp) {
    // Development mode: running with electron .
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('hyenimc', process.execPath, [
        path.resolve(process.argv[1])
      ]);
      console.log('[Protocol] Windows protocol registered (dev mode)');
    }
  } else {
    // Production mode: packaged .exe
    app.setAsDefaultProtocolClient('hyenimc');
    console.log('[Protocol] Windows protocol registered (production mode)');
  }
}
