import { app } from 'electron';

/**
 * Register custom protocol handler for macOS
 * 
 * This allows the app to handle hyenimc:// URLs
 * Example: hyenimc://auth?token=xxx&server=yyy
 * 
 * Note: Also requires CFBundleURLTypes in package.json build config
 */
export function registerProtocolMacOS(): void {
  app.setAsDefaultProtocolClient('hyenimc');
  console.log('[Protocol] macOS protocol registered');
}
