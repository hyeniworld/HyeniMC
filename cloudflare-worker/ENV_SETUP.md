# 환경 변수 설정 가이드

Cloudflare Worker에서 민감한 정보(API URL, API Key 등)를 안전하게 관리하는 방법입니다.

## 필수 환경 변수

### 1. `CURSEFORGE_API_KEY`
CurseForge API 인증 키

### 2. `TOKEN_CHECK_API_URL`
토큰 검증 API 서버 주소

## 설정 방법

### 방법 1: Wrangler CLI 사용 (권장)

```bash
# CurseForge API Key 설정
wrangler secret put CURSEFORGE_API_KEY

# Token Check API URL 설정
wrangler secret put TOKEN_CHECK_API_URL
```

명령어 실행 후 값을 입력하라는 프롬프트가 나타납니다.

### 방법 2: Cloudflare Dashboard 사용

1. [Cloudflare Dashboard](https://dash.cloudflare.com/) 로그인
2. **Workers & Pages** 메뉴로 이동
3. 해당 Worker 선택 (`hyenimc-worker`)
4. **Settings** > **Variables** 탭으로 이동
5. **Environment Variables** 섹션에서 **Add variable** 클릭
6. 변수 추가:
   - Name: `TOKEN_CHECK_API_URL`
   - Value: 실제 API URL
   - Type: **Secret** (암호화됨) 선택
7. **Save** 클릭

### 방법 3: wrangler.toml에 변수 정의 (비밀 정보 아닌 경우만)

```toml
[vars]
# 공개되어도 괜찮은 설정만 여기에 추가
# 비밀 정보는 절대 wrangler.toml에 추가하지 마세요!
```

## 환경 변수 확인

```bash
# 설정된 환경 변수 목록 확인
wrangler secret list
```

## 로컬 개발 시 환경 변수 사용

로컬에서 테스트할 때는 `.dev.vars` 파일을 생성하세요:

```bash
# .dev.vars 파일 생성
cat > .dev.vars << EOF
CURSEFORGE_API_KEY=your_curseforge_api_key_here
TOKEN_CHECK_API_URL=your_token_check_api_url_here
EOF
```

**중요**: `.dev.vars` 파일은 `.gitignore`에 추가하여 Git에 커밋되지 않도록 해야 합니다.

## 보안 주의사항

✅ **해야 할 것**:
- Wrangler Secret 또는 Cloudflare Dashboard를 통해 환경 변수 설정
- `.dev.vars` 파일을 `.gitignore`에 추가
- 환경 변수를 코드에서 `env.VARIABLE_NAME` 형태로 참조

❌ **하지 말아야 할 것**:
- 코드에 API URL이나 API Key를 직접 하드코딩
- `wrangler.toml`에 비밀 정보 추가
- `.dev.vars` 파일을 Git에 커밋

## 환경 변수 업데이트

```bash
# 기존 환경 변수 업데이트
wrangler secret put TOKEN_CHECK_API_URL

# 환경 변수 삭제
wrangler secret delete TOKEN_CHECK_API_URL
```

## 문제 해결

### Worker가 환경 변수를 찾지 못하는 경우

1. 환경 변수가 올바르게 설정되었는지 확인:
   ```bash
   wrangler secret list
   ```

2. Worker를 다시 배포:
   ```bash
   wrangler deploy
   ```

3. Cloudflare Dashboard에서 변수 확인

### 로컬 개발 시 환경 변수가 작동하지 않는 경우

1. `.dev.vars` 파일이 `wrangler.toml`과 같은 디렉토리에 있는지 확인
2. Wrangler 버전 확인 및 업데이트:
   ```bash
   wrangler --version
   npm install -g wrangler@latest
   ```
