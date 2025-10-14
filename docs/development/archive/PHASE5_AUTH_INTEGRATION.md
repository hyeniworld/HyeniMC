# 혜니헬퍼 인증 연동

## 📋 목차
1. [개요](#개요)
2. [플로우](#플로우)
3. [Custom URL Protocol 등록](#custom-url-protocol-등록)
4. [Protocol Handler 구현](#protocol-handler-구현)
5. [프로필 서버 주소 필드](#프로필-서버-주소-필드)
6. [테스트 방법](#테스트-방법)
7. [구현 체크리스트](#구현-체크리스트)

---

## 개요

### 목표
디스코드 링크 클릭 → HyeniMC 자동 실행 → HyeniHelper 설정 파일 자동 생성

### 핵심 기능
1. **Custom URL Protocol** (`hyenimc://`) 등록
2. **Discord 봇 연동**: 인증 링크 생성 및 전송
3. **자동 설정**: HyeniHelper config 파일 생성
4. **크로스 플랫폼**: Windows, macOS 지원

---

## 플로우

### 전체 플로우

```
[디스코드 서버]
    │
    ├─ 사용자: /hyeni-auth 입력
    │
    ├─ 봇: 인증 토큰 생성 (UUID)
    │
    ├─ 봇: DM으로 링크 전송
    │   hyenimc://auth?token=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx&server=play.hyeniworld.com
    │
    ▼
[사용자가 링크 클릭]
    │
    ▼
[운영체제]
    │
    ├─ Windows: hyenimc:// 프로토콜 감지
    │   └─ 레지스트리: HKCU\Software\Classes\hyenimc
    │
    ├─ macOS: CFBundleURLSchemes 감지
    │
    └─ HyeniMC.exe / HyeniMC.app 실행
    │
    ▼
[HyeniMC 런처]
    │
    ├─ URL 파싱
    │   ├─ token: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    │   └─ server: play.hyeniworld.com
    │
    ├─ 프로필 검색
    │   └─ WHERE serverAddress = 'play.hyeniworld.com'
    │
    ├─ 각 프로필의 mods 폴더 스캔
    │   └─ *.jar 파일 중 'hyenihelper' 포함 여부 확인
    │
    ├─ HyeniHelper가 있는 프로필:
    │   └─ {gameDirectory}/config/hyenihelper.json 생성
    │       {
    │         "authToken": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    │         "serverAddress": "play.hyeniworld.com",
    │         "lastUpdated": "2025-10-12T12:34:56.789Z"
    │       }
    │
    └─ UI 알림
        ├─ 성공: "play.hyeniworld.com 서버 인증 완료! (2개 프로필)"
        └─ 실패: "HyeniHelper 모드가 설치된 프로필을 찾을 수 없습니다"
```

---

## Custom URL Protocol 등록

### Windows 구현

#### 방법 1: Electron API (권장)
```typescript
// src/main/protocol/register-windows.ts
import { app } from 'electron';
import path from 'path';

export function registerProtocolWindows() {
  if (process.defaultApp) {
    // 개발 모드: electron . 로 실행 중
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('hyenimc', process.execPath, [
        path.resolve(process.argv[1])
      ]);
    }
  } else {
    // 프로덕션 모드: 패키징된 .exe 실행
    app.setAsDefaultProtocolClient('hyenimc');
  }
}
```

#### 방법 2: 레지스트리 직접 등록 (Fallback)
```typescript
// src/main/protocol/register-windows-registry.ts
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function registerProtocolWindowsRegistry() {
  const exePath = process.execPath.replace(/\\/g, '\\\\');
  
  const commands = [
    `REG ADD "HKCU\\Software\\Classes\\hyenimc" /ve /d "URL:HyeniMC Protocol" /f`,
    `REG ADD "HKCU\\Software\\Classes\\hyenimc" /v "URL Protocol" /d "" /f`,
    `REG ADD "HKCU\\Software\\Classes\\hyenimc\\DefaultIcon" /ve /d "\\"${exePath}\\",0" /f`,
    `REG ADD "HKCU\\Software\\Classes\\hyenimc\\shell\\open\\command" /ve /d "\\"${exePath}\\" \\"%1\\"" /f`
  ];

  for (const cmd of commands) {
    try {
      await execAsync(cmd);
    } catch (error) {
      console.error('Registry command failed:', cmd, error);
    }
  }
}
```

### macOS 구현

#### Electron API
```typescript
// src/main/protocol/register-macos.ts
import { app } from 'electron';

export function registerProtocolMacOS() {
  app.setAsDefaultProtocolClient('hyenimc');
}
```

#### package.json 설정
```json
{
  "build": {
    "appId": "com.hyenimc.launcher",
    "productName": "HyeniMC",
    "mac": {
      "category": "public.app-category.games",
      "extendInfo": {
        "CFBundleURLTypes": [
          {
            "CFBundleURLSchemes": ["hyenimc"],
            "CFBundleURLName": "HyeniMC Protocol Handler",
            "CFBundleTypeRole": "Viewer"
          }
        ]
      }
    }
  }
}
```

### 통합 등록 함수

```typescript
// src/main/protocol/register.ts
import { registerProtocolWindows } from './register-windows';
import { registerProtocolMacOS } from './register-macos';

export function registerCustomProtocol() {
  if (process.platform === 'win32') {
    registerProtocolWindows();
  } else if (process.platform === 'darwin') {
    registerProtocolMacOS();
  } else {
    console.warn('Custom protocol not supported on this platform');
  }
}
```

---

## Protocol Handler 구현

### Main Process Handler

```typescript
// src/main/protocol/handler.ts
import { app, BrowserWindow } from 'electron';
import { URL } from 'url';
import path from 'path';
import fs from 'fs/promises';

interface AuthData {
  token: string;
  server: string;
}

export function setupProtocolHandler(mainWindow: BrowserWindow) {
  // macOS: 앱이 실행 중일 때 URL 열림
  app.on('open-url', (event, url) => {
    event.preventDefault();
    console.log('[Protocol] macOS open-url:', url);
    handleProtocolUrl(url, mainWindow);
  });

  // Windows/Linux: 단일 인스턴스 강제
  const gotTheLock = app.requestSingleInstanceLock();
  
  if (!gotTheLock) {
    console.log('[Protocol] Another instance is running, quitting...');
    app.quit();
  } else {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
      console.log('[Protocol] Second instance detected:', commandLine);
      
      // Windows: 두 번째 인스턴스 실행 시 URL이 commandLine에 포함
      const url = commandLine.find(arg => arg.startsWith('hyenimc://'));
      if (url) {
        handleProtocolUrl(url, mainWindow);
      }

      // 기존 창 포커스
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    });
  }

  // Windows: 앱 시작 시 URL 파라미터 처리
  if (process.platform === 'win32' && process.argv.length > 1) {
    const url = process.argv.find(arg => arg.startsWith('hyenimc://'));
    if (url) {
      console.log('[Protocol] Windows startup URL:', url);
      // 앱이 완전히 로드된 후 처리
      app.whenReady().then(() => {
        setTimeout(() => handleProtocolUrl(url, mainWindow), 1000);
      });
    }
  }
}

async function handleProtocolUrl(urlString: string, mainWindow: BrowserWindow) {
  try {
    console.log('[Protocol] Handling URL:', urlString);
    
    const url = new URL(urlString);
    
    if (url.protocol !== 'hyenimc:') {
      console.error('[Protocol] Invalid protocol:', url.protocol);
      return;
    }

    // hyenimc://auth?token=xxx&server=yyy
    const hostname = url.hostname || url.pathname.replace('//', '').split('?')[0];
    
    if (hostname === 'auth') {
      const token = url.searchParams.get('token');
      const server = url.searchParams.get('server');

      if (!token || !server) {
        throw new Error('Missing token or server parameter');
      }

      console.log('[Protocol] Auth request - Server:', server);
      await handleAuthRequest({ token, server });
      
      // UI에 성공 메시지 전송
      mainWindow.webContents.send('auth:success', {
        server,
        token,
        message: `${server} 서버 인증이 완료되었습니다!`
      });
    } else {
      console.error('[Protocol] Unknown endpoint:', hostname);
    }
  } catch (error) {
    console.error('[Protocol] Handler error:', error);
    mainWindow.webContents.send('auth:error', {
      message: error instanceof Error ? error.message : '인증 처리 중 오류가 발생했습니다.'
    });
  }
}

async function handleAuthRequest(data: AuthData): Promise<void> {
  const { token, server } = data;
  
  console.log(`[Protocol] Processing auth for server: ${server}`);

  // 1. 해당 서버 주소를 가진 프로필 찾기
  const profiles = await findProfilesByServer(server);
  
  if (profiles.length === 0) {
    throw new Error(`서버 주소 "${server}"를 가진 프로필을 찾을 수 없습니다.`);
  }

  console.log(`[Protocol] Found ${profiles.length} profiles with server ${server}`);

  let successCount = 0;
  const updatedProfiles: string[] = [];

  // 2. 각 프로필에서 HyeniHelper 모드 찾기
  for (const profile of profiles) {
    const modsDir = path.join(profile.gameDirectory, 'mods');
    
    try {
      const files = await fs.readdir(modsDir);
      const hyeniHelperMod = files.find(file => 
        file.toLowerCase().includes('hyenihelper') && 
        (file.endsWith('.jar') || file.endsWith('.jar.disabled'))
      );

      if (hyeniHelperMod) {
        console.log(`[Protocol] Found HyeniHelper in profile: ${profile.name}`);
        
        // 3. config 파일 생성
        await writeHyeniHelperConfig(profile.gameDirectory, token, server);
        successCount++;
        updatedProfiles.push(profile.name);
      } else {
        console.log(`[Protocol] No HyeniHelper found in profile: ${profile.name}`);
      }
    } catch (error) {
      console.error(`[Protocol] Error processing profile ${profile.name}:`, error);
    }
  }

  if (successCount === 0) {
    throw new Error('HyeniHelper 모드가 설치된 프로필을 찾을 수 없습니다.');
  }

  console.log(`[Protocol] Auth completed for ${successCount} profiles: ${updatedProfiles.join(', ')}`);
}

async function findProfilesByServer(serverAddress: string): Promise<any[]> {
  // gRPC로 프로필 목록 가져오기
  try {
    const { ProfileServiceClient } = await import('../grpc/clients');
    const client = new ProfileServiceClient();
    const response = await client.listProfiles({});
    
    return response.profiles.filter(profile => 
      profile.serverAddress?.toLowerCase() === serverAddress.toLowerCase()
    );
  } catch (error) {
    console.error('[Protocol] Failed to fetch profiles:', error);
    return [];
  }
}

async function writeHyeniHelperConfig(
  gameDirectory: string, 
  token: string, 
  server: string
): Promise<void> {
  const configDir = path.join(gameDirectory, 'config');
  const configFile = path.join(configDir, 'hyenihelper.json');

  // config 디렉토리 생성
  await fs.mkdir(configDir, { recursive: true });

  const config = {
    authToken: token,
    serverAddress: server,
    lastUpdated: new Date().toISOString(),
  };

  await fs.writeFile(configFile, JSON.stringify(config, null, 2), 'utf-8');
  console.log(`[Protocol] Config file written: ${configFile}`);
}
```

### Main.ts 통합

```typescript
// src/main/main.ts
import { app, BrowserWindow } from 'electron';
import { registerCustomProtocol } from './protocol/register';
import { setupProtocolHandler } from './protocol/handler';

// 프로토콜 등록 (앱 시작 전)
registerCustomProtocol();

let mainWindow: BrowserWindow | null = null;

app.whenReady().then(() => {
  mainWindow = createWindow();
  
  // 프로토콜 핸들러 설정
  setupProtocolHandler(mainWindow);
});
```

---

## 프로필 서버 주소 필드

### DB 마이그레이션

```go
// backend/internal/db/migrations.go

func migration_15_add_favorite_and_server_address() migrationFunc {
	return func(db *sql.DB) error {
		_, err := db.Exec(`
			ALTER TABLE profiles ADD COLUMN favorite BOOLEAN DEFAULT 0;
			ALTER TABLE profiles ADD COLUMN server_address TEXT;
			CREATE INDEX idx_profiles_server_address ON profiles(server_address);
		`)
		return err
	}
}
```

### Proto 정의

```protobuf
// proto/launcher/profile.proto

message Profile {
  // ... 기존 필드들
  
  string server_address = 20; // 혜니월드 서버 주소
  bool favorite = 21;          // 즐겨찾기 여부
}
```

### UI 수정

```typescript
// src/renderer/components/profiles/ProfileSettingsTab.tsx

export function ProfileSettingsTab({ profile }: { profile: Profile }) {
  const [serverAddress, setServerAddress] = useState(profile.serverAddress || '');
  const { toast } = useToast();

  const handleSave = async () => {
    try {
      await window.electronAPI.profile.update(profile.id, {
        ...profile,
        serverAddress,
      });
      toast({ type: 'success', message: '프로필이 저장되었습니다' });
    } catch (error) {
      toast({ type: 'error', message: '저장 실패' });
    }
  };

  return (
    <div className="space-y-6">
      {/* 기존 설정들... */}
      
      {/* 혜니월드 서버 설정 */}
      <div className="border-t border-gray-700 pt-6">
        <h3 className="text-lg font-semibold mb-4">🌟 혜니월드 설정</h3>
        
        <div>
          <label className="block text-sm font-medium mb-2">
            서버 주소
          </label>
          <input
            type="text"
            value={serverAddress}
            onChange={(e) => setServerAddress(e.target.value)}
            placeholder="예: play.hyeniworld.com"
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded focus:border-primary"
          />
          <p className="text-xs text-gray-400 mt-1">
            💡 디스코드 인증 연동을 위해 혜니월드 서버 주소를 입력하세요.
          </p>
        </div>
      </div>

      {/* 저장 버튼 */}
      <div className="sticky bottom-0 py-4 bg-gray-900 border-t border-gray-700">
        <button
          onClick={handleSave}
          className="w-full py-3 bg-primary text-white rounded font-medium hover:bg-primary-dark"
        >
          저장
        </button>
      </div>
    </div>
  );
}
```

### UI 피드백

```typescript
// src/renderer/App.tsx

function App() {
  const { toast } = useToast();

  useEffect(() => {
    // 인증 성공 이벤트
    const unsubSuccess = window.electronAPI.on('auth:success', (data: any) => {
      toast({
        type: 'success',
        message: `✨ ${data.server} 인증 완료!`,
        description: 'HyeniHelper 설정이 자동으로 업데이트되었습니다.',
        duration: 5000,
      });
    });

    // 인증 실패 이벤트
    const unsubError = window.electronAPI.on('auth:error', (data: any) => {
      toast({
        type: 'error',
        message: '인증 실패',
        description: data.message,
        duration: 7000,
      });
    });

    return () => {
      unsubSuccess();
      unsubError();
    };
  }, []);

  return <>{/* ... */}</>;
}
```

---

## 테스트 방법

### 개발 환경 테스트

#### Windows (PowerShell)
```powershell
# 런처를 개발 모드로 실행한 상태에서
Start-Process "hyenimc://auth?token=test-token-12345&server=play.hyeniworld.com"
```

#### macOS (Terminal)
```bash
# 런처를 개발 모드로 실행한 상태에서
open "hyenimc://auth?token=test-token-12345&server=play.hyeniworld.com"
```

### 프로덕션 테스트

1. **빌드**
   ```bash
   npm run build:win  # Windows
   npm run build:mac  # macOS
   ```

2. **설치 후 테스트**
   - 브라우저 주소창에 입력: `hyenimc://auth?token=xxx&server=yyy`
   - 또는 HTML 파일 생성:
     ```html
     <!DOCTYPE html>
     <html>
     <body>
       <a href="hyenimc://auth?token=test123&server=play.hyeniworld.com">
         혜니월드 인증하기
       </a>
     </body>
     </html>
     ```

### Discord 봇 예시 명령어

```python
# Discord Bot (Python 예시)
import discord
from discord.ext import commands
import uuid

@bot.command(name='hyeni-auth')
async def hyeni_auth(ctx):
    # 토큰 생성
    token = str(uuid.uuid4())
    server = "play.hyeniworld.com"
    
    # DB에 토큰 저장 (선택)
    # save_auth_token(ctx.author.id, token)
    
    # DM으로 링크 전송
    link = f"hyenimc://auth?token={token}&server={server}"
    
    await ctx.author.send(
        f"🎮 **혜니월드 인증 링크**\n\n"
        f"아래 링크를 클릭하면 HyeniMC 런처가 자동으로 설정됩니다:\n"
        f"{link}\n\n"
        f"⚠️ 이 링크는 비공개로 유지하세요!"
    )
    
    await ctx.send(f"{ctx.author.mention} DM을 확인하세요!", delete_after=5)
```

---

## 구현 체크리스트

### Day 1: Protocol 등록
- [ ] `src/main/protocol/register.ts` 생성
- [ ] Windows 등록 구현
- [ ] macOS 등록 구현
- [ ] `package.json` build 설정 추가
- [ ] 등록 테스트

### Day 2: Handler 구현
- [ ] `src/main/protocol/handler.ts` 생성
- [ ] URL 파싱 로직
- [ ] 프로필 검색 (gRPC)
- [ ] HyeniHelper 모드 감지
- [ ] config 파일 생성
- [ ] 에러 처리

### Day 3: UI 및 테스트
- [ ] DB 마이그레이션 (server_address 필드)
- [ ] 프로필 설정에 서버 주소 입력 추가
- [ ] IPC 이벤트 리스너 (auth:success, auth:error)
- [ ] Toast 알림 통합
- [ ] 개발 환경 테스트
- [ ] 빌드 및 프로덕션 테스트

---

**작성일**: 2025-10-12  
**우선순위**: ⭐⭐⭐⭐⭐ (긴급)  
**예상 시간**: 3일
