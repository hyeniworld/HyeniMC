import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import { MinecraftProfile } from './microsoft-auth';
import { accountRpc } from '../grpc/clients';
import type { AccountResponse } from '../gen/launcher/account';

export interface StoredAccount {
  id: string;
  name: string;
  uuid: string;
  type: 'microsoft' | 'offline';
  skin?: string;
  lastUsed: number;
}

// Legacy account format from accounts.json
interface LegacyAccount {
  id: string;
  name: string;
  uuid: string;
  type: 'microsoft' | 'offline';
  encryptedData?: string;
  iv?: string;
  authTag?: string;
  skin?: string;
  lastUsed: number;
}

export class AccountManager {
  private accountsPath: string;

  constructor() {
    this.accountsPath = path.join(app.getPath('userData'), 'accounts.json');
  }

  /**
   * Initialize - migrate legacy accounts.json to DB if exists
   */
  async initialize(): Promise<void> {
    console.log('[Account Manager] Using backend storage');
    
    // Check if legacy accounts.json exists
    try {
      await fs.access(this.accountsPath);
      console.log('[Account Manager] Found legacy accounts.json, migrating to database...');
      await this.migrateLegacyAccounts();
    } catch (error) {
      // File doesn't exist, which is fine
    }
  }

  /**
   * Migrate legacy accounts.json to database and delete the file
   */
  private async migrateLegacyAccounts(): Promise<void> {
    try {
      // Read legacy file
      const data = await fs.readFile(this.accountsPath, 'utf-8');
      const legacyAccounts: LegacyAccount[] = JSON.parse(data);
      
      if (legacyAccounts.length === 0) {
        console.log('[Account Manager] No accounts to migrate');
        await fs.unlink(this.accountsPath);
        return;
      }

      console.log(`[Account Manager] Found ${legacyAccounts.length} legacy account(s)`);

      // Note: We can only migrate offline accounts
      // Microsoft accounts cannot be migrated because tokens were encrypted with different keys
      // Offline accounts: username-based, can be recreated (deterministic UUID)
      let migratedCount = 0;
      let skippedCount = 0;

      for (const account of legacyAccounts) {
        try {
          if (account.type === 'offline') {
            // Offline accounts: recreate with same username
            // UUID will be identical (deterministic generation)
            await accountRpc.addOfflineAccount({
              username: account.name,
            });
            migratedCount++;
            console.log(`[Account Manager] Migrated offline account: ${account.name}`);
          } else {
            // Microsoft accounts: require re-login
            skippedCount++;
            console.log(`[Account Manager] Skipped Microsoft account (requires re-login): ${account.name}`);
          }
        } catch (error) {
          console.error(`[Account Manager] Failed to migrate account ${account.name}:`, error);
        }
      }

      // Delete the legacy file
      await fs.unlink(this.accountsPath);
      console.log(`[Account Manager] Migration complete: ${migratedCount} offline account(s) migrated`);
      if (skippedCount > 0) {
        console.log(`[Account Manager] ${skippedCount} Microsoft account(s) require re-login`);
      }
      console.log(`[Account Manager] Deleted accounts.json`);

    } catch (error) {
      console.error('[Account Manager] Failed to migrate legacy accounts:', error);
      console.error('[Account Manager] Keeping accounts.json for safety');
    }
  }

  /**
   * Save Microsoft account
   */
  async saveMicrosoftAccount(profile: MinecraftProfile): Promise<string> {
    const result = await accountRpc.saveMicrosoftAccount({
      name: profile.name,
      uuid: profile.uuid,
      accessToken: profile.accessToken,
      refreshToken: profile.refreshToken,
      expiresAt: profile.expiresAt,
      skinUrl: profile.skin || '',
    });
    
    console.log(`[Account Manager] Saved Microsoft account: ${profile.name}`);
    return result.accountId;
  }

  /**
   * Add offline account
   */
  async addOfflineAccount(username: string): Promise<string> {
    const result = await accountRpc.addOfflineAccount({
      username,
    });
    
    console.log(`[Account Manager] Added offline account: ${username}`);
    return result.accountId;
  }

  /**
   * Get account by ID
   */
  async getAccount(accountId: string): Promise<StoredAccount | null> {
    try {
      const account = await accountRpc.getAccount({ accountId });
      return this.convertToStoredAccount(account);
    } catch (error) {
      console.error('[Account Manager] Failed to get account:', error);
      return null;
    }
  }

  /**
   * Get all accounts
   */
  async getAllAccounts(): Promise<StoredAccount[]> {
    try {
      const response = await accountRpc.getAllAccounts({});
      return response.accounts.map(acc => this.convertToStoredAccount(acc));
    } catch (error) {
      console.error('[Account Manager] Failed to get all accounts:', error);
      return [];
    }
  }

  /**
   * Get decrypted tokens for Microsoft account
   */
  async getAccountTokens(accountId: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
  } | null> {
    try {
      const tokens = await accountRpc.getAccountTokens({ accountId });
      return {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: Number(tokens.expiresAt),
      };
    } catch (error) {
      console.error('[Account Manager] Failed to get account tokens:', error);
      return null;
    }
  }

  /**
   * Update account tokens
   */
  async updateAccountTokens(
    accountId: string,
    accessToken: string,
    refreshToken: string,
    expiresAt: number
  ): Promise<void> {
    await accountRpc.updateAccountTokens({
      accountId,
      accessToken,
      refreshToken,
      expiresAt,
    });
  }

  /**
   * Update last used timestamp
   */
  async updateLastUsed(accountId: string): Promise<void> {
    await accountRpc.updateLastUsed({ accountId });
  }

  /**
   * Remove account
   */
  async removeAccount(accountId: string): Promise<void> {
    await accountRpc.removeAccount({ accountId });
    console.log(`[Account Manager] Removed account: ${accountId}`);
  }

  /**
   * Convert gRPC AccountResponse to StoredAccount
   */
  private convertToStoredAccount(account: AccountResponse): StoredAccount {
    return {
      id: account.id,
      name: account.name,
      uuid: account.uuid,
      type: account.type as 'microsoft' | 'offline',
      skin: account.skinUrl || undefined,
      lastUsed: Number(account.lastUsed),
    };
  }
}
