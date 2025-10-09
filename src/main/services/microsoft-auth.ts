import { BrowserWindow, shell } from 'electron';
import axios from 'axios';
import * as crypto from 'crypto';
import * as http from 'http';
import { AUTH_CONFIG } from './auth-config';

// Azure AD Configuration
const AZURE_CLIENT_ID = AUTH_CONFIG.AZURE_CLIENT_ID;
const REDIRECT_URI = 'http://localhost:53682/callback'; // 로컬 서버 포트

export interface MinecraftProfile {
  id: string;
  name: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  uuid: string;
  skin?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export class MicrosoftAuthService {
  /**
   * Start Microsoft OAuth login flow
   */
  async login(parentWindow?: BrowserWindow): Promise<MinecraftProfile> {
    console.log('[Auth] Starting Microsoft login with system browser...');

    // Step 1: Get Microsoft OAuth token using system browser
    const msToken = await this.getMicrosoftTokenViaBrowser();
    
    // Step 2: Authenticate with Xbox Live
    const xblToken = await this.authenticateXboxLive(msToken.accessToken);
    
    // Step 3: Get Xbox XSTS token
    const xstsToken = await this.getXSTSToken(xblToken);
    
    // Step 4: Authenticate with Minecraft
    const mcToken = await this.authenticateMinecraft(xstsToken);
    
    // Step 5: Get Minecraft profile
    const profile = await this.getMinecraftProfile(mcToken);
    
    console.log(`[Auth] Login successful: ${profile.name} (${profile.uuid})`);
    
    return {
      id: profile.uuid,
      ...profile,
      accessToken: mcToken,
      refreshToken: msToken.refreshToken,
      expiresAt: Date.now() + msToken.expiresIn * 1000,
    };
  }

  /**
   * Step 1: Get Microsoft OAuth token via system browser (no certificate issues)
   */
  private async getMicrosoftTokenViaBrowser(): Promise<AuthTokens> {
    const codeVerifier = this.generateCodeVerifier();
    const codeChallenge = this.generateCodeChallenge(codeVerifier);
    const state = crypto.randomBytes(16).toString('hex');

    // Check if Client ID is set
    if (!AZURE_CLIENT_ID || AZURE_CLIENT_ID === 'YOUR_CLIENT_ID_HERE') {
      throw new Error('Azure Client ID가 설정되지 않았습니다. auth-config.ts 파일을 확인하세요.');
    }

    console.log('[Auth] Client ID:', AZURE_CLIENT_ID.substring(0, 8) + '...');

    // Build authorization URL
    const authUrl = new URL('https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize');
    authUrl.searchParams.set('client_id', AZURE_CLIENT_ID);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
    authUrl.searchParams.set('scope', 'XboxLive.signin offline_access');
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('state', state);

    console.log('[Auth] Opening system browser...');
    
    // Open in system browser
    shell.openExternal(authUrl.toString());

    // Start local server to receive callback
    const code = await this.waitForCallback(state);

    // Exchange code for token
    console.log('[Auth] Exchanging code for token...');
    const tokenResponse = await axios.post(
      'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
      new URLSearchParams({
        client_id: AZURE_CLIENT_ID,
        code,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
        code_verifier: codeVerifier,
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    return {
      accessToken: tokenResponse.data.access_token,
      refreshToken: tokenResponse.data.refresh_token,
      expiresIn: tokenResponse.data.expires_in,
    };
  }

  private async waitForCallback(expectedState: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const url = new URL(req.url!, `http://localhost:53682`);
        
        if (url.pathname === '/callback') {
          const code = url.searchParams.get('code');
          const state = url.searchParams.get('state');
          const error = url.searchParams.get('error');
          const errorDescription = url.searchParams.get('error_description');

          if (error) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`
              <html>
              <head><meta charset="utf-8"><style>body { font-family: system-ui; text-align: center; padding: 50px; }</style></head>
              <body>
                <h1>❌ 로그인 실패</h1>
                <p>${errorDescription || error}</p>
                <p>이 창을 닫으셔도 됩니다.</p>
              </body>
              </html>
            `);
            server.close();
            reject(new Error(`OAuth 오류: ${error} - ${errorDescription || ''}`));
            return;
          }

          if (!code || state !== expectedState) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<html><body><h1>Invalid response</h1></body></html>');
            server.close();
            reject(new Error('Invalid OAuth response'));
            return;
          }

          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`
            <html>
            <head>
              <meta charset="utf-8">
              <style>
                body { font-family: system-ui; text-align: center; padding: 50px; background: #1a1a1a; color: white; }
                h1 { color: #4CAF50; }
              </style>
            </head>
            <body>
              <h1>✅ 로그인 성공!</h1>
              <p>HyeniMC로 돌아가세요.</p>
              <p>이 창을 닫으셔도 됩니다.</p>
              <script>setTimeout(() => window.close(), 3000);</script>
            </body>
            </html>
          `);

          server.close();
          resolve(code);
        }
      });

      server.listen(53682, () => {
        console.log('[Auth] Callback server listening on port 53682');
      });

      server.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
          reject(new Error('포트 53682가 이미 사용 중입니다. 잠시 후 다시 시도하세요.'));
        } else {
          reject(err);
        }
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        server.close();
        reject(new Error('로그인 시간 초과 (5분)'));
      }, 5 * 60 * 1000);
    });
  }

  /**
   * Step 1 (OLD): Get Microsoft OAuth token via Electron window
   * DEPRECATED: Has certificate issues on macOS
   */
  private async getMicrosoftTokenOLD(parentWindow?: BrowserWindow): Promise<AuthTokens> {
    return new Promise((resolve, reject) => {
      let resolved = false;
      const codeVerifier = this.generateCodeVerifier();
      const codeChallenge = this.generateCodeChallenge(codeVerifier);
      const state = crypto.randomBytes(16).toString('hex');

      // Check if Client ID is set
      if (!AZURE_CLIENT_ID || AZURE_CLIENT_ID === 'YOUR_CLIENT_ID_HERE') {
        reject(new Error('Azure Client ID가 설정되지 않았습니다. auth-config.ts 파일을 확인하세요.'));
        return;
      }

      console.log('[Auth] Client ID:', AZURE_CLIENT_ID.substring(0, 8) + '...');

      // Build authorization URL
      const authUrl = new URL('https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize');
      authUrl.searchParams.set('client_id', AZURE_CLIENT_ID);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
      authUrl.searchParams.set('scope', 'XboxLive.signin offline_access');
      authUrl.searchParams.set('code_challenge', codeChallenge);
      authUrl.searchParams.set('code_challenge_method', 'S256');
      authUrl.searchParams.set('state', state);

      console.log('[Auth] Authorization URL:', authUrl.toString());

      // Create auth window
      const authWindow = new BrowserWindow({
        width: 500,
        height: 700,
        show: false, // Don't show until ready
        parent: parentWindow,
        // modal: true causes titlebar to hide on macOS, use alwaysOnTop instead
        modal: false,
        alwaysOnTop: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          webSecurity: true,
          allowRunningInsecureContent: false,
          // Enable web features needed for OAuth
          javascript: true,
          images: true,
          webgl: false,
        },
        title: 'Microsoft 로그인',
        autoHideMenuBar: true,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        resizable: false,
      });

      console.log('[Auth] Window created');

      // Open DevTools for debugging (REMOVE IN PRODUCTION)
      authWindow.webContents.openDevTools({ mode: 'detach' });

      // Show window when it's ready to avoid flickering
      authWindow.once('ready-to-show', () => {
        console.log('[Auth] Window ready to show');
        authWindow.show();
        authWindow.focus();
      });
      
      // Log when window is ready
      authWindow.webContents.on('did-finish-load', () => {
        console.log('[Auth] Window loaded successfully');
      });

      console.log('[Auth] Loading URL in window...');
      
      // Set user agent to avoid bot detection
      authWindow.webContents.setUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );
      
      authWindow.loadURL(authUrl.toString()).catch(err => {
        console.error('[Auth] Failed to load URL:', err);
        if (!resolved) {
          resolved = true;
          reject(new Error(`로그인 페이지 로드 실패: ${err.message}`));
        }
      });

      // Add keyboard shortcut to close (ESC)
      authWindow.webContents.on('before-input-event', (event, input) => {
        if (input.key === 'Escape') {
          authWindow.close();
        }
      });

      // Helper function to handle OAuth callback
      const handleCallback = async (url: string) => {
        if (!url.startsWith(REDIRECT_URI)) {
          return;
        }

        console.log('[Auth] Callback URL received:', url);

        try {
          const redirectUrl = new URL(url);
          const code = redirectUrl.searchParams.get('code');
          const returnedState = redirectUrl.searchParams.get('state');
          const error = redirectUrl.searchParams.get('error');
          const errorDescription = redirectUrl.searchParams.get('error_description');

          if (error) {
            resolved = true;
            authWindow.close();
            reject(new Error(`OAuth 오류: ${error} - ${errorDescription || ''}`));
            return;
          }

          if (!code || returnedState !== state) {
            resolved = true;
            authWindow.close();
            reject(new Error('Invalid OAuth response'));
            return;
          }

          console.log('[Auth] Exchanging code for token...');

          // Exchange code for token
          const tokenResponse = await axios.post(
            'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
            new URLSearchParams({
              client_id: AZURE_CLIENT_ID,
              code,
              redirect_uri: REDIRECT_URI,
              grant_type: 'authorization_code',
              code_verifier: codeVerifier,
            }),
            {
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
              },
            }
          );

          console.log('[Auth] Token received successfully');

          resolved = true;
          authWindow.close();
          resolve({
            accessToken: tokenResponse.data.access_token,
            refreshToken: tokenResponse.data.refresh_token,
            expiresIn: tokenResponse.data.expires_in,
          });
        } catch (error) {
          resolved = true;
          authWindow.close();
          reject(error);
        }
      };

      // Handle redirect (older OAuth flows)
      authWindow.webContents.on('will-redirect', async (event, url) => {
        event.preventDefault();
        await handleCallback(url);
      });

      // Handle navigation (modern OAuth flows)
      authWindow.webContents.on('will-navigate', async (event, url) => {
        if (url.startsWith(REDIRECT_URI)) {
          event.preventDefault();
          await handleCallback(url);
        }
      });

      // Handle page load with callback URL (fallback)
      authWindow.webContents.on('did-start-navigation', async (event, url) => {
        if (url.startsWith(REDIRECT_URI)) {
          await handleCallback(url);
        }
      });

      authWindow.on('closed', () => {
        if (!resolved) {
          reject(new Error('로그인 창이 닫혔습니다'));
        }
      });

      // Handle navigation errors
      authWindow.webContents.on('did-fail-load', async (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        console.log('[Auth] Page load failed:', {
          errorCode,
          errorDescription,
          validatedURL,
          isMainFrame,
        });
        
        // If the redirect URL fails to load (expected - no local server), check if we have the callback
        if (validatedURL && validatedURL.startsWith(REDIRECT_URI)) {
          console.log('[Auth] Redirect URL detected in failed load:', validatedURL);
          await handleCallback(validatedURL);
          return;
        }
        
        if (errorDescription.includes('ERR_ABORTED')) {
          return; // Ignore redirect aborts
        }
        
        if (errorDescription.includes('ERR_CONNECTION_REFUSED') && validatedURL && validatedURL.startsWith(REDIRECT_URI)) {
          // This is expected - no local server at localhost:3000
          console.log('[Auth] Connection refused to redirect URL (expected)');
          return;
        }
        
        // Only reject on main frame errors that are not related to callback
        if (isMainFrame && !resolved) {
          // ERR_FAILED for main Microsoft page is a real error
          if (validatedURL && validatedURL.includes('login.microsoftonline.com')) {
            console.error('[Auth] Failed to load Microsoft login page:', errorDescription);
            authWindow.close();
            resolved = true;
            reject(new Error(`Microsoft 로그인 페이지를 불러올 수 없습니다. 인터넷 연결을 확인하세요. (${errorDescription})`));
          }
        }
      });
    });
  }

  /**
   * Step 2: Authenticate with Xbox Live
   */
  private async authenticateXboxLive(msAccessToken: string): Promise<string> {
    const response = await axios.post(
      'https://user.auth.xboxlive.com/user/authenticate',
      {
        Properties: {
          AuthMethod: 'RPS',
          SiteName: 'user.auth.xboxlive.com',
          RpsTicket: `d=${msAccessToken}`,
        },
        RelyingParty: 'http://auth.xboxlive.com',
        TokenType: 'JWT',
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      }
    );

    return response.data.Token;
  }

  /**
   * Step 3: Get XSTS token
   */
  private async getXSTSToken(xblToken: string): Promise<{ token: string; uhs: string }> {
    const response = await axios.post(
      'https://xsts.auth.xboxlive.com/xsts/authorize',
      {
        Properties: {
          SandboxId: 'RETAIL',
          UserTokens: [xblToken],
        },
        RelyingParty: 'rp://api.minecraftservices.com/',
        TokenType: 'JWT',
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      }
    );

    return {
      token: response.data.Token,
      uhs: response.data.DisplayClaims.xui[0].uhs,
    };
  }

  /**
   * Step 4: Authenticate with Minecraft
   */
  private async authenticateMinecraft(xstsToken: { token: string; uhs: string }): Promise<string> {
    const response = await axios.post(
      'https://api.minecraftservices.com/authentication/login_with_xbox',
      {
        identityToken: `XBL3.0 x=${xstsToken.uhs};${xstsToken.token}`,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      }
    );

    return response.data.access_token;
  }

  /**
   * Step 5: Get Minecraft profile
   */
  private async getMinecraftProfile(mcAccessToken: string): Promise<{ uuid: string; name: string; skin?: string }> {
    const response = await axios.get('https://api.minecraftservices.com/minecraft/profile', {
      headers: {
        Authorization: `Bearer ${mcAccessToken}`,
      },
    });

    const data = response.data;
    const skin = data.skins?.find((s: any) => s.state === 'ACTIVE')?.url;

    return {
      uuid: data.id,
      name: data.name,
      skin,
    };
  }

  /**
   * Refresh access token
   */
  async refreshToken(refreshToken: string): Promise<AuthTokens> {
    const response = await axios.post(
      'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
      new URLSearchParams({
        client_id: AZURE_CLIENT_ID,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    return {
      accessToken: response.data.access_token,
      refreshToken: response.data.refresh_token,
      expiresIn: response.data.expires_in,
    };
  }

  /**
   * Validate if user owns Minecraft
   */
  async checkGameOwnership(mcAccessToken: string): Promise<boolean> {
    try {
      const response = await axios.get('https://api.minecraftservices.com/entitlements/mcstore', {
        headers: {
          Authorization: `Bearer ${mcAccessToken}`,
        },
      });

      return response.data.items && response.data.items.length > 0;
    } catch {
      return false;
    }
  }

  // PKCE helpers
  private generateCodeVerifier(): string {
    return crypto.randomBytes(32).toString('base64url');
  }

  private generateCodeChallenge(verifier: string): string {
    return crypto.createHash('sha256').update(verifier).digest('base64url');
  }
}
