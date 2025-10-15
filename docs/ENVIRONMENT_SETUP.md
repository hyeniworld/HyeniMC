# 환경변수 설정 가이드

HyeniMC는 `.env` 파일을 사용하여 환경변수를 관리합니다.

---

## 📋 빠른 시작

```bash
# 1. .env 파일 생성
cp .env.example .env

# 2. 텍스트 에디터로 열기
code .env  # VS Code
# 또는 다른 에디터 사용

# 3. 필요한 값 입력 (아래 상세 설명 참조)

# 4. 개발 모드 실행 (자동으로 설정 파일 생성됨)
npm run dev
```

---

## 🔑 환경변수 목록

### 필수 환경변수

#### `HYENIMC_WORKER_URL`
- **설명**: Cloudflare Worker URL (CurseForge API Proxy + Mod Distribution)
- **형식**: `https://your-worker.YOUR_ACCOUNT.workers.dev`
- **예시**: `https://hyenimc-worker.example.workers.dev`
- **설정 방법**: [Cloudflare Worker 배포 가이드](../cloudflare-worker/README.md) 참조

#### `AZURE_CLIENT_ID`
- **설명**: Microsoft OAuth 인증을 위한 Azure Application (Client) ID
- **형식**: UUID (예: `12345678-1234-1234-1234-123456789abc`)
- **설정 방법**: [Microsoft 인증 설정 가이드](guides/MICROSOFT_AUTH_SETUP.md) 참조

### 선택적 환경변수

#### `CURSEFORGE_API_KEY`
- **설명**: CurseForge API Key (개발 환경 전용)
- **사용처**: 프록시를 거치지 않고 직접 CurseForge API 호출 시
- **형식**: 문자열
- **주의**: 프로덕션 빌드에서는 사용하지 않습니다

---

## 🛠️ 자동 설정 파일 생성

`.env` 파일을 저장하면 다음 명령어 실행 시 자동으로 TypeScript 설정 파일들이 생성됩니다:

```bash
npm run generate:config
```

생성되는 파일들:
- `src/main/services/auth-config.ts` - Azure 인증 설정
- `src/main/config/env-config.ts` - 환경변수 설정

이 파일들은 `.gitignore`에 포함되어 있어 Git에 커밋되지 않습니다.

---

## 📝 .env 파일 예시

```env
# ============================================================
# REQUIRED: HyeniMC Worker URL
# ============================================================
# CurseForge API Proxy + Mod Distribution
# Get this after deploying your own cloudflare-worker
HYENIMC_WORKER_URL=https://hyenimc-worker.YOUR_ACCOUNT.workers.dev

# ============================================================
# REQUIRED: Azure OAuth Client ID
# ============================================================
# For Microsoft Authentication (Xbox Live login)
# 1. Register an app in Azure Portal
# 2. Add redirect URI: http://localhost:53682/callback
# 3. Copy the Application (client) ID here
AZURE_CLIENT_ID=12345678-1234-1234-1234-123456789abc

# ============================================================
# OPTIONAL: CurseForge API Key (Development Only)
# ============================================================
# Only needed if you want to bypass the proxy in development
# In production builds, the worker proxy is always used
# CURSEFORGE_API_KEY=your_api_key_here
```

---

## 🔄 빌드 프로세스

### 개발 모드 (`npm run dev`)

1. `predev` 훅이 자동으로 `npm run generate:config` 실행
2. `.env` 파일에서 환경변수 읽기
3. TypeScript 설정 파일 생성
4. 개발 서버 시작

### 프로덕션 빌드 (`npm run build`)

1. `prebuild` 훅이 자동으로 `npm run generate:config` 실행
2. `.env` 파일에서 환경변수 읽기
3. TypeScript 설정 파일 생성
4. TypeScript 컴파일 시 환경변수 값이 코드에 하드코딩됨
5. **결과물에 `.env` 파일은 포함되지 않음**

---

## 🔒 보안 주의사항

### ✅ 해야 할 것
- `.env` 파일을 `.gitignore`에 포함 (이미 설정됨)
- `.env.example`을 템플릿으로 제공
- GitHub Secrets를 사용하여 CI/CD에서 `.env` 생성

### ❌ 하지 말아야 할 것
- `.env` 파일을 Git에 커밋
- 환경변수 값을 코드에 직접 하드코딩
- `.env` 파일을 공개 저장소에 업로드

---

## 🎯 GitHub Actions에서 사용

GitHub Actions 워크플로우에서는 다음과 같이 `.env` 파일을 생성합니다:

```yaml
- name: Create .env file
  run: |
    cat > .env << 'EOF'
    HYENIMC_WORKER_URL=${{ secrets.HYENIMC_WORKER_URL }}
    AZURE_CLIENT_ID=${{ secrets.AZURE_CLIENT_ID }}
    EOF

- name: Generate config files
  run: npm run generate:config
```

필요한 GitHub Secrets:
- `HYENIMC_WORKER_URL`
- `AZURE_CLIENT_ID`

자세한 내용은 [GitHub Actions Secrets 가이드](deployment/GITHUB_ACTIONS_SECRETS.md)를 참조하세요.

---

## 🔍 문제 해결

### 문제: "HYENIMC_WORKER_URL is not configured"

**원인**: `.env` 파일이 없거나 값이 설정되지 않음

**해결**:
```bash
# 1. .env 파일 존재 확인
ls -la .env

# 2. 없으면 생성
cp .env.example .env

# 3. 값 입력 후 저장

# 4. 설정 파일 재생성
npm run generate:config
```

### 문제: "AZURE_CLIENT_ID가 설정되지 않았습니다"

**원인**: `.env` 파일에 AZURE_CLIENT_ID가 없음

**해결**:
1. [Microsoft 인증 설정 가이드](guides/MICROSOFT_AUTH_SETUP.md) 참조
2. Azure Portal에서 Client ID 복사
3. `.env` 파일에 추가
4. `npm run generate:config` 실행

### 문제: 자동 생성된 파일을 찾을 수 없음

**원인**: `generate:config` 스크립트가 실행되지 않음

**해결**:
```bash
# 수동으로 실행
npm run generate:config

# 생성된 파일 확인
ls -la src/main/services/auth-config.ts
ls -la src/main/config/env-config.ts
```

---

## 📚 관련 문서

- [빠른 시작 가이드](guides/QUICKSTART.md)
- [Microsoft 인증 설정](guides/MICROSOFT_AUTH_SETUP.md)
- [Cloudflare Worker 배포](../cloudflare-worker/README.md)
- [GitHub Actions 설정](deployment/GITHUB_ACTIONS_SECRETS.md)

---

**환경변수 설정 완료! 이제 개발을 시작할 수 있습니다.** 🚀
