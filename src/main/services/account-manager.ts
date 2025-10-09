import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import { MinecraftProfile } from './microsoft-auth';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;

export interface StoredAccount {
  id: string;
  name: string;
  uuid: string;
  type: 'microsoft' | 'offline';
  encryptedData?: string; // Encrypted tokens
  iv?: string;
  authTag?: string;
  skin?: string;
  lastUsed: number;
}

export class AccountManager {
  private accountsPath: string;
  private encryptionKey: Buffer;
  private accounts: Map<string, StoredAccount> = new Map();

  constructor() {
    this.accountsPath = path.join(app.getPath('userData'), 'accounts.json');
    
    // Generate or load encryption key
    const keyPath = path.join(app.getPath('userData'), '.key');
    this.encryptionKey = this.getOrCreateKey(keyPath);
  }

  /**
   * Initialize and load accounts
   */
  async initialize(): Promise<void> {
    try {
      const data = await fs.readFile(this.accountsPath, 'utf-8');
      const accounts: StoredAccount[] = JSON.parse(data);
      
      for (const account of accounts) {
        this.accounts.set(account.id, account);
      }
      
      console.log(`[Account Manager] Loaded ${accounts.length} accounts`);
    } catch (error) {
      if ((error as any).code !== 'ENOENT') {
        console.error('[Account Manager] Failed to load accounts:', error);
      }
      // File doesn't exist yet, that's ok
    }
  }

  /**
   * Save Microsoft account
   */
  async saveMicrosoftAccount(profile: MinecraftProfile): Promise<string> {
    const accountId = profile.uuid;
    
    // Encrypt sensitive data
    const sensitiveData = JSON.stringify({
      accessToken: profile.accessToken,
      refreshToken: profile.refreshToken,
      expiresAt: profile.expiresAt,
    });
    
    const { encrypted, iv, authTag } = this.encrypt(sensitiveData);
    
    const account: StoredAccount = {
      id: accountId,
      name: profile.name,
      uuid: profile.uuid,
      type: 'microsoft',
      encryptedData: encrypted,
      iv,
      authTag,
      skin: profile.skin,
      lastUsed: Date.now(),
    };
    
    this.accounts.set(accountId, account);
    await this.saveAccounts();
    
    console.log(`[Account Manager] Saved Microsoft account: ${profile.name}`);
    return accountId;
  }

  /**
   * Add offline account
   */
  async addOfflineAccount(username: string): Promise<string> {
    const accountId = crypto.randomUUID();
    
    const account: StoredAccount = {
      id: accountId,
      name: username,
      uuid: this.generateOfflineUUID(username),
      type: 'offline',
      lastUsed: Date.now(),
    };
    
    this.accounts.set(accountId, account);
    await this.saveAccounts();
    
    console.log(`[Account Manager] Added offline account: ${username}`);
    return accountId;
  }

  /**
   * Get account by ID
   */
  getAccount(accountId: string): StoredAccount | undefined {
    return this.accounts.get(accountId);
  }

  /**
   * Get all accounts
   */
  getAllAccounts(): StoredAccount[] {
    return Array.from(this.accounts.values()).sort((a, b) => b.lastUsed - a.lastUsed);
  }

  /**
   * Get decrypted tokens for Microsoft account
   */
  async getAccountTokens(accountId: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
  } | null> {
    const account = this.accounts.get(accountId);
    
    if (!account || account.type !== 'microsoft' || !account.encryptedData) {
      return null;
    }
    
    try {
      const decrypted = this.decrypt(account.encryptedData, account.iv!, account.authTag!);
      return JSON.parse(decrypted);
    } catch (error) {
      console.error('[Account Manager] Failed to decrypt tokens:', error);
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
    const account = this.accounts.get(accountId);
    
    if (!account || account.type !== 'microsoft') {
      throw new Error('Account not found or not Microsoft account');
    }
    
    const sensitiveData = JSON.stringify({
      accessToken,
      refreshToken,
      expiresAt,
    });
    
    const { encrypted, iv, authTag } = this.encrypt(sensitiveData);
    
    account.encryptedData = encrypted;
    account.iv = iv;
    account.authTag = authTag;
    account.lastUsed = Date.now();
    
    await this.saveAccounts();
  }

  /**
   * Update last used timestamp
   */
  async updateLastUsed(accountId: string): Promise<void> {
    const account = this.accounts.get(accountId);
    
    if (account) {
      account.lastUsed = Date.now();
      await this.saveAccounts();
    }
  }

  /**
   * Remove account
   */
  async removeAccount(accountId: string): Promise<void> {
    this.accounts.delete(accountId);
    await this.saveAccounts();
    
    console.log(`[Account Manager] Removed account: ${accountId}`);
  }

  /**
   * Save accounts to disk
   */
  private async saveAccounts(): Promise<void> {
    const accounts = Array.from(this.accounts.values());
    await fs.writeFile(this.accountsPath, JSON.stringify(accounts, null, 2));
  }

  /**
   * Encrypt data
   */
  private encrypt(text: string): { encrypted: string; iv: string; authTag: string } {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, this.encryptionKey, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    return {
      encrypted,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
    };
  }

  /**
   * Decrypt data
   */
  private decrypt(encrypted: string, ivHex: string, authTagHex: string): string {
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    
    const decipher = crypto.createDecipheriv(ALGORITHM, this.encryptionKey, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }

  /**
   * Get or create encryption key
   */
  private getOrCreateKey(keyPath: string): Buffer {
    try {
      const key = require('fs').readFileSync(keyPath);
      return key;
    } catch {
      const key = crypto.randomBytes(KEY_LENGTH);
      require('fs').writeFileSync(keyPath, key);
      return key;
    }
  }

  /**
   * Generate offline UUID (deterministic)
   */
  private generateOfflineUUID(username: string): string {
    const hash = crypto.createHash('md5').update(`OfflinePlayer:${username}`).digest('hex');
    
    // Format as UUID
    return [
      hash.substring(0, 8),
      hash.substring(8, 12),
      hash.substring(12, 16),
      hash.substring(16, 20),
      hash.substring(20, 32),
    ].join('-');
  }
}
