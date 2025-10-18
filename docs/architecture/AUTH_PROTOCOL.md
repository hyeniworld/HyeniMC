# HyeniMC 인증 프로토콜 API

## 개요

HyeniMC는 커스텀 URL 프로토콜(`hyenimc://`)을 통해 외부 애플리케이션(예: 디스코드 봇)에서 런처로 인증 정보를 전달할 수 있습니다.

이 문서는 디스코드 봇 또는 웹 서비스에서 HyeniMC 런처와 통신하는 방법을 설명합니다.

---

## URL 형식

```
hyenimc://auth?token={TOKEN}&server={SERVER}
```

### 파라미터

| 파라미터 | 필수 여부 | 타입 | 설명 |
|---------|---------|------|------|
| `token` | **필수** | string | 사용자 인증 토큰 (HyeniHelper 모드에 전달됨) |
| `server` | 선택 | string | 서버 주소(들). 콤마로 구분하여 여러 개 전달 가능 |

---

## 동작 모드

### MODE 1: 서버 주소 지정 (Server-Specific)

**URL 예시:**
```
hyenimc://auth?token=user123abc&server=play.hyeniworld.com
```

**동작:**
1. 사용자의 마인크래프트 `servers.dat` 파일에서 지정된 서버 주소를 검색
2. 매칭되는 프로필에서 HyeniHelper 모드 확인
3. **무조건 config 파일 덮어쓰기** (기존 토큰이 있어도 업데이트)

**사용 사례:**
- 특정 서버용 인증 토큰을 갱신할 때
- 서버별로 다른 토큰을 관리할 때

**여러 서버 지정:**
```
hyenimc://auth?token=user123abc&server=play.hyeniworld.com,test.hyeniworld.com,dev.hyeniworld.com
```

---

### MODE 2: 전체 프로필 (Global)

**URL 예시:**
```
hyenimc://auth?token=user123abc
```

**동작:**
1. `servers.dat` 확인 없이 모든 프로필 검색
2. HyeniHelper 모드가 설치된 모든 프로필 대상
3. **조건부 작성:**
   - Config 파일이 없으면 → ✅ 작성
   - Config 파일은 있지만 `token`이 비어있으면 → ✅ 작성
   - Config 파일이 있고 `token`이 이미 있으면 → ❌ 건너뜀 (기존 토큰 보호)

**사용 사례:**
- 처음 설치하는 사용자에게 기본 토큰 배포
- 토큰이 없는 프로필에만 안전하게 토큰 추가

---

## 생성되는 Config 파일

**경로:**
```
{프로필 디렉토리}/config/hyenihelper-config.json
```

**파일 내용:**
```json
{
  "token": "user123abc",
  "enabled": true,
  "timeoutSeconds": 10,
  "serverStatusPort": 4444,
  "authPort": 35565,
  "serverStatusInterval": 180
}
```

---

## 디스코드 봇 연동 예시

### Discord.js (v14)

```javascript
const { Client, GatewayIntentBits, SlashCommandBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');

const client = new Client({ 
  intents: [GatewayIntentBits.Guilds] 
});

// 슬래시 커맨드 등록
const authCommand = new SlashCommandBuilder()
  .setName('auth')
  .setDescription('혜니월드 서버 인증을 진행합니다');

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  
  if (interaction.commandName === 'auth') {
    const userId = interaction.user.id;
    
    // 1. 토큰 생성 (DB에 저장 등)
    const token = await generateUserToken(userId);
    
    // 2. 인증 URL 생성
    const authUrl = `hyenimc://auth?token=${token}&server=play.hyeniworld.com`;
    
    // 3. 버튼과 함께 응답
    const button = new ButtonBuilder()
      .setLabel('🎮 혜니월드 인증하기')
      .setStyle(ButtonStyle.Link)
      .setURL(authUrl);
    
    const row = new ActionRowBuilder().addComponents(button);
    
    await interaction.reply({
      content: '아래 버튼을 클릭하여 HyeniMC 런처에서 인증을 완료하세요!\n\n**참고:**\n- HyeniMC 런처가 설치되어 있어야 합니다\n- HyeniHelper 모드가 설치된 프로필이 있어야 합니다\n- 마인크래프트 멀티플레이에서 서버를 미리 추가해주세요',
      components: [row],
      ephemeral: true
    });
  }
});

async function generateUserToken(userId) {
  // TODO: 실제 토큰 생성 로직 구현
  // 예: DB에 저장, JWT 생성 등
  return `token_${userId}_${Date.now()}`;
}

client.login('YOUR_BOT_TOKEN');
```

### Python (discord.py)

```python
import discord
from discord import app_commands
from discord.ui import Button, View

class AuthView(View):
    def __init__(self, token: str):
        super().__init__()
        auth_url = f"hyenimc://auth?token={token}&server=play.hyeniworld.com"
        
        button = Button(
            label="🎮 혜니월드 인증하기",
            style=discord.ButtonStyle.link,
            url=auth_url
        )
        self.add_item(button)

class MyClient(discord.Client):
    def __init__(self):
        intents = discord.Intents.default()
        super().__init__(intents=intents)
        self.tree = app_commands.CommandTree(self)

    async def setup_hook(self):
        await self.tree.sync()

client = MyClient()

@client.tree.command(name="auth", description="혜니월드 서버 인증을 진행합니다")
async def auth(interaction: discord.Interaction):
    user_id = interaction.user.id
    
    # 1. 토큰 생성
    token = generate_user_token(user_id)
    
    # 2. View 생성
    view = AuthView(token)
    
    # 3. 응답
    await interaction.response.send_message(
        "아래 버튼을 클릭하여 HyeniMC 런처에서 인증을 완료하세요!\n\n"
        "**참고:**\n"
        "- HyeniMC 런처가 설치되어 있어야 합니다\n"
        "- HyeniHelper 모드가 설치된 프로필이 있어야 합니다\n"
        "- 마인크래프트 멀티플레이에서 서버를 미리 추가해주세요",
        view=view,
        ephemeral=True
    )

def generate_user_token(user_id: int) -> str:
    # TODO: 실제 토큰 생성 로직 구현
    import time
    return f"token_{user_id}_{int(time.time())}"

client.run('YOUR_BOT_TOKEN')
```

---

## 응답 처리

런처는 인증 성공/실패 시 내부적으로 토스트 알림을 표시합니다. 디스코드 봇에서 결과를 확인하려면:

### 방법 1: 웹훅 콜백

HyeniHelper 모드에서 인증 성공 시 웹훅을 호출하도록 구현:

```javascript
// HyeniHelper 모드 측에서
POST https://your-server.com/api/auth-callback
{
  "token": "user123abc",
  "success": true,
  "timestamp": "2025-10-13T00:00:00Z"
}
```

디스코드 봇에서 이를 받아 사용자에게 DM 전송:

```javascript
app.post('/api/auth-callback', async (req, res) => {
  const { token, success } = req.body;
  
  // 토큰으로 사용자 찾기
  const user = await findUserByToken(token);
  
  if (success && user) {
    // 디스코드 DM 전송
    const discordUser = await client.users.fetch(user.discordId);
    await discordUser.send('✅ 혜니월드 인증이 완료되었습니다!');
  }
  
  res.sendStatus(200);
});
```

### 방법 2: 폴링

사용자가 `/인증` 명령어를 실행한 후 일정 시간 동안 인증 상태를 폴링:

```javascript
// 사용자가 인증 완료했는지 주기적으로 확인
async function checkAuthStatus(userId, token) {
  for (let i = 0; i < 30; i++) { // 30초 동안 1초마다 확인
    const status = await db.query('SELECT authenticated FROM auth_tokens WHERE token = ?', [token]);
    
    if (status.authenticated) {
      const user = await client.users.fetch(userId);
      await user.send('✅ 혜니월드 인증이 완료되었습니다!');
      return;
    }
    
    await sleep(1000);
  }
}
```

---

## 에러 처리

### 가능한 에러

| 에러 | 원인 | 해결 방법 |
|------|------|----------|
| 인증 토큰 누락 | `token` 파라미터가 없음 | URL에 `token` 파라미터 추가 |
| 프로필을 찾을 수 없음 | servers.dat에 서버가 없음 | 마인크래프트에서 서버 추가 안내 |
| HyeniHelper 모드 없음 | 모드가 설치되지 않음 | 모드 설치 안내 |
| 런처가 실행되지 않음 | HyeniMC가 설치되지 않음 | 런처 설치 안내 |

### 사용자 안내 메시지 예시

```javascript
const helpMessage = `
**혜니월드 인증이 실패하셨나요?**

다음을 확인해주세요:

1️⃣ **HyeniMC 런처 설치**
   → https://hyenimc.com/download

2️⃣ **HyeniHelper 모드 설치**
   → 프로필 생성 후 mods 폴더에 hyenihelper.jar 추가

3️⃣ **서버 추가** (MODE 1 사용 시)
   → 마인크래프트 실행 → 멀티플레이 → 서버 추가
   → 서버 주소: play.hyeniworld.com

4️⃣ **인증 버튼 클릭**
   → /인증 명령어 실행 후 버튼 클릭
`;
```

---

## 보안 고려사항

### 토큰 관리

- ✅ **토큰 만료 시간 설정**: 토큰은 일정 시간 후 만료되도록 설정
- ✅ **일회성 토큰**: 한 번 사용한 토큰은 재사용 불가
- ✅ **사용자당 하나의 토큰**: 새 인증 시 기존 토큰 무효화

```javascript
async function generateUserToken(userId) {
  // 기존 토큰 무효화
  await db.query('UPDATE auth_tokens SET valid = false WHERE user_id = ?', [userId]);
  
  // 새 토큰 생성
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5분 후 만료
  
  await db.query(
    'INSERT INTO auth_tokens (user_id, token, expires_at, valid) VALUES (?, ?, ?, true)',
    [userId, token, expiresAt]
  );
  
  return token;
}
```

### URL 보안

- ✅ **HTTPS 사용**: 웹에서 링크 제공 시 HTTPS 사용
- ✅ **Ephemeral 메시지**: 디스코드에서 `ephemeral: true` 사용하여 타인에게 노출 방지
- ✅ **로깅 최소화**: 토큰을 로그에 기록하지 않음

---

## 테스트

### 로컬 테스트

`test-auth.html` 파일을 사용하여 로컬에서 테스트:

```html
<!DOCTYPE html>
<html>
<body>
  <h1>HyeniMC 인증 테스트</h1>
  
  <!-- 서버 주소 지정 -->
  <a href="hyenimc://auth?token=test-token-123&server=play.hyeniworld.com">
    🌟 혜니월드 인증하기 (서버 지정)
  </a>
  
  <br><br>
  
  <!-- 전체 프로필 -->
  <a href="hyenimc://auth?token=test-token-456">
    🌍 혜니월드 인증하기 (모든 프로필)
  </a>
</body>
</html>
```

### 프로덕션 체크리스트

- [ ] 토큰 생성 로직 구현 및 테스트
- [ ] 데이터베이스 스키마 설계 (auth_tokens 테이블)
- [ ] 토큰 만료 및 무효화 로직
- [ ] 디스코드 봇 명령어 등록
- [ ] 에러 처리 및 사용자 안내 메시지
- [ ] 웹훅 콜백 또는 폴링 구현 (선택)
- [ ] 보안 검토 (토큰 노출, 로깅 등)
- [ ] 사용자 가이드 작성 및 배포

---

## 문의

문제가 발생하거나 질문이 있으시면:

- 디스코드: [혜니월드 서버](https://discord.gg/hyeni)
- GitHub Issues: [HyeniMC Issues](https://github.com/hyeniworld/HyeniMC/issues)

---

**작성일**: 2025-10-13  
**버전**: 1.0.0  
**작성자**: HyeniMC Team
