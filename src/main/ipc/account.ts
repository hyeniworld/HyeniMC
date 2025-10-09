import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants/ipc';
import { MicrosoftAuthService } from '../services/microsoft-auth';
import { AccountManager } from '../services/account-manager';

let accountManager: AccountManager;
let authService: MicrosoftAuthService;

export function registerAccountHandlers() {
  accountManager = new AccountManager();
  authService = new MicrosoftAuthService();
  
  // Initialize account manager
  accountManager.initialize().catch(console.error);

  // Login with Microsoft
  ipcMain.handle(IPC_CHANNELS.ACCOUNT_LOGIN_MICROSOFT, async (event) => {
    try {
      console.log('[IPC Account] Microsoft login requested');
      
      // Get parent window
      const window = BrowserWindow.fromWebContents(event.sender);
      
      // Perform login
      const profile = await authService.login(window || undefined);
      
      // Save account
      await accountManager.saveMicrosoftAccount(profile);
      
      console.log('[IPC Account] Login successful:', profile.name);
      
      return {
        id: profile.id,
        name: profile.name,
        uuid: profile.uuid,
        type: 'microsoft' as const,
        skin: profile.skin,
      };
    } catch (error: any) {
      console.error('[IPC Account] Login failed:', error);
      throw error;
    }
  });

  // Add offline account
  ipcMain.handle(IPC_CHANNELS.ACCOUNT_ADD_OFFLINE, async (event, username: string) => {
    try {
      console.log('[IPC Account] Adding offline account:', username);
      
      if (!username || username.trim().length === 0) {
        throw new Error('사용자 이름을 입력해주세요');
      }
      
      const accountId = await accountManager.addOfflineAccount(username.trim());
      const account = accountManager.getAccount(accountId);
      
      return {
        id: account!.id,
        name: account!.name,
        uuid: account!.uuid,
        type: 'offline' as const,
      };
    } catch (error: any) {
      console.error('[IPC Account] Failed to add offline account:', error);
      throw error;
    }
  });

  // Get all accounts
  ipcMain.handle(IPC_CHANNELS.ACCOUNT_LIST, async () => {
    try {
      const accounts = accountManager.getAllAccounts();
      return accounts;
    } catch (error: any) {
      console.error('[IPC Account] Failed to list accounts:', error);
      throw error;
    }
  });

  // Remove account
  ipcMain.handle(IPC_CHANNELS.ACCOUNT_REMOVE, async (event, accountId: string) => {
    try {
      console.log('[IPC Account] Removing account:', accountId);
      await accountManager.removeAccount(accountId);
      return { success: true };
    } catch (error: any) {
      console.error('[IPC Account] Failed to remove account:', error);
      throw error;
    }
  });

  // Get account for game launch
  ipcMain.handle(IPC_CHANNELS.ACCOUNT_GET_FOR_LAUNCH, async (event, accountId: string) => {
    try {
      const account = accountManager.getAccount(accountId);
      if (!account) {
        throw new Error('Account not found');
      }

      if (account.type === 'offline') {
        return {
          username: account.name,
          uuid: account.uuid,
          accessToken: 'null',
          userType: 'legacy',
        };
      }

      // Microsoft account
      const tokens = await accountManager.getAccountTokens(accountId);
      if (!tokens) {
        throw new Error('Failed to get account tokens');
      }

      // Check if token needs refresh (within 5 minutes)
      if (tokens.expiresAt < Date.now() + 5 * 60 * 1000) {
        console.log('[IPC Account] Refreshing expired token...');
        const newTokens = await authService.refreshToken(tokens.refreshToken);
        const newExpiresAt = Date.now() + newTokens.expiresIn * 1000;
        
        await accountManager.updateAccountTokens(
          accountId,
          newTokens.accessToken,
          newTokens.refreshToken,
          newExpiresAt
        );

        return {
          username: account.name,
          uuid: account.uuid,
          accessToken: newTokens.accessToken,
          userType: 'msa',
        };
      }

      await accountManager.updateLastUsed(accountId);

      return {
        username: account.name,
        uuid: account.uuid,
        accessToken: tokens.accessToken,
        userType: 'msa',
      };
    } catch (error: any) {
      console.error('[IPC Account] Failed to get account for launch:', error);
      throw error;
    }
  });
}

export function getAccountManager(): AccountManager {
  return accountManager;
}
