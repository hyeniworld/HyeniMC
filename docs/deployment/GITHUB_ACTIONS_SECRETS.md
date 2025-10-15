# GitHub Actions Secrets 설정 가이드

GitHub Actions에서 빌드가 성공하려면 필요한 시크릿을 설정해야 합니다.

## 필수 Secrets

### 1. `AZURE_CLIENT_ID`
Microsoft 인증을 위한 Azure Client ID

**설정 방법**: [MICROSOFT_AUTH_SETUP.md](../guides/MICROSOFT_AUTH_SETUP.md) 참조

### 2. `HYENIMC_WORKER_URL`
배포된 HyeniMC Worker URL (CurseForge Proxy + Mod Distribution)

**중요**: 이 URL은 Cloudflare Workers 무료 티어 남용 방지를 위해 공개하지 않습니다.

**예시**: `https://hyenimc-worker.YOUR_ACCOUNT.workers.dev`

## Secrets 설정 방법

### 1. GitHub Repository 설정 페이지 이동

1. GitHub 저장소 페이지로 이동
2. **Settings** 탭 클릭
3. 좌측 메뉴에서 **Secrets and variables** > **Actions** 클릭

### 2. Secret 추가

1. **New repository secret** 버튼 클릭
2. 다음 Secrets 추가:

**AZURE_CLIENT_ID**
- **Name**: `AZURE_CLIENT_ID`
- **Value**: Azure Portal의 Client ID

**HYENIMC_WORKER_URL**
- **Name**: `HYENIMC_WORKER_URL`
- **Value**: `https://hyenimc-worker.YOUR_ACCOUNT.workers.dev`

3. **Add secret** 클릭

### 3. 설정 확인

다음 Secrets가 모두 등록되어 있는지 확인:

- ✅ `AZURE_CLIENT_ID`
- ✅ `HYENIMC_WORKER_URL`
- ✅ `GITHUB_TOKEN` (자동 생성됨)

## 빌드 워크플로우

GitHub Actions는 다음 파일들을 자동 생성합니다:

```yaml
- name: Create auth config
  run: |
    cat > src/main/services/auth-config.ts << 'EOF'
    export const AUTH_CONFIG = {
      AZURE_CLIENT_ID: '${{ secrets.AZURE_CLIENT_ID }}',
      REDIRECT_URI: 'http://localhost:53682/callback',
    };
    EOF

- name: Create .env file
  run: |
    cat > .env << 'EOF'
    HYENIMC_WORKER_URL=${{ secrets.HYENIMC_WORKER_URL }}
    EOF
```

## 테스트

### 로컬에서 테스트

```bash
# .env 파일 생성
cp .env.example .env

# .env 파일에 실제 Worker URL 입력
# HYENIMC_WORKER_URL=https://hyenimc-worker.YOUR_ACCOUNT.workers.dev

# 빌드 테스트
npm run build
```

### GitHub Actions에서 테스트

1. 코드 커밋 및 푸시
2. GitHub Actions 탭에서 워크플로우 실행 확인
3. 빌드 로그에서 에러 확인

## 문제 해결

### 문제: "HYENIMC_WORKER_URL is not set"

**원인**: GitHub Secret이 설정되지 않음

**해결**:
1. GitHub Repository Settings > Secrets and variables > Actions
2. `HYENIMC_WORKER_URL` Secret 추가

### 문제: "AZURE_CLIENT_ID is not defined"

**원인**: GitHub Secret이 설정되지 않음

**해결**:
1. GitHub Repository Settings > Secrets and variables > Actions
2. `AZURE_CLIENT_ID` Secret 추가

### 문제: 빌드는 성공하지만 런처가 Worker에 연결 안 됨

**원인**: 잘못된 Worker URL 또는 Worker가 배포되지 않음

**해결**:
1. Worker가 정상 배포되었는지 확인:
   ```bash
   curl https://hyenimc-worker.YOUR_ACCOUNT.workers.dev/health
   ```
2. GitHub Secret의 URL이 정확한지 확인
3. 빌드된 앱의 환경 변수 확인

## 보안 주의사항

### ✅ 해야 할 것
- GitHub Secrets를 통해 민감한 정보 관리
- `.env` 파일을 `.gitignore`에 추가
- Secret 값을 로그에 출력하지 않기

### ❌ 하지 말아야 할 것
- Worker URL을 코드에 하드코딩
- `.env` 파일을 Git에 커밋
- Secret 값을 공개 저장소에 노출

## 참고

### 환경별 Worker URL 관리

프로덕션과 개발 환경을 분리하려면:

```yaml
# .github/workflows/release-launcher.yml
- name: Create .env file
  run: |
    cat > .env << 'EOF'
    HYENIMC_WORKER_URL=${{ secrets.HYENIMC_WORKER_URL_PROD }}
    EOF

# .github/workflows/dev-build.yml (개발용)
- name: Create .env file
  run: |
    cat > .env << 'EOF'
    HYENIMC_WORKER_URL=${{ secrets.HYENIMC_WORKER_URL_DEV }}
    EOF
```

### 추가 환경 변수

필요한 경우 추가 환경 변수를 설정할 수 있습니다:

```yaml
- name: Create .env file
  run: |
    cat > .env << 'EOF'
    HYENIMC_WORKER_URL=${{ secrets.HYENIMC_WORKER_URL }}
    NODE_ENV=production
    LOG_LEVEL=info
    EOF
```

## 관련 문서

- [GitHub Actions 배포 가이드](./GITHUB_ACTIONS_SETUP.md)
- [Worker 배포 가이드](./DEPLOYMENT_GUIDE.md)
- [환경 변수 설정](../../cloudflare-worker/ENV_SETUP.md)
