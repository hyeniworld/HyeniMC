#!/bin/bash

# HyeniMC 릴리즈 스크립트
# 사용법: ./scripts/release.sh [patch|minor|major] [message]

set -e

VERSION_TYPE=$1
COMMIT_MESSAGE=$2

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 사용법 출력
if [ -z "$VERSION_TYPE" ]; then
  echo -e "${RED}❌ 버전 타입을 지정해주세요${NC}"
  echo ""
  echo "사용법: ./scripts/release.sh [patch|minor|major] [message]"
  echo ""
  echo "버전 타입:"
  echo "  patch  - 버그 수정 (0.1.0 → 0.1.1)"
  echo "  minor  - 기능 추가 (0.1.0 → 0.2.0)"
  echo "  major  - 주요 변경 (0.1.0 → 1.0.0)"
  echo ""
  echo "예시:"
  echo "  ./scripts/release.sh patch"
  echo "  ./scripts/release.sh minor \"새로운 기능 추가\""
  exit 1
fi

# 버전 타입 검증
if [[ ! "$VERSION_TYPE" =~ ^(patch|minor|major)$ ]]; then
  echo -e "${RED}❌ 잘못된 버전 타입: $VERSION_TYPE${NC}"
  echo "patch, minor, major 중 하나를 선택해주세요."
  exit 1
fi

# 현재 버전 확인
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo -e "${YELLOW}📦 현재 버전: v$CURRENT_VERSION${NC}"

# Git 상태 확인
if [[ -n $(git status -s) ]]; then
  echo -e "${RED}❌ 커밋되지 않은 변경사항이 있습니다${NC}"
  echo "먼저 변경사항을 커밋하거나 stash 해주세요."
  git status -s
  exit 1
fi

# 메인 브랜치 확인
CURRENT_BRANCH=$(git branch --show-current)
if [[ "$CURRENT_BRANCH" != "main" && "$CURRENT_BRANCH" != "master" ]]; then
  echo -e "${YELLOW}⚠️  현재 브랜치: $CURRENT_BRANCH${NC}"
  read -p "메인 브랜치가 아닙니다. 계속하시겠습니까? (y/N): " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

# 최신 상태 확인
echo -e "${YELLOW}🔄 원격 저장소 확인 중...${NC}"
git fetch origin

LOCAL=$(git rev-parse @)
REMOTE=$(git rev-parse @{u})

if [ $LOCAL != $REMOTE ]; then
  echo -e "${RED}❌ 로컬과 원격 저장소가 동기화되지 않았습니다${NC}"
  echo "git pull을 먼저 실행해주세요."
  exit 1
fi

# 버전 업데이트
echo -e "${GREEN}⬆️  버전 업데이트 중...${NC}"
if [ -z "$COMMIT_MESSAGE" ]; then
  npm version $VERSION_TYPE -m "chore: release v%s"
else
  npm version $VERSION_TYPE -m "chore: release v%s - $COMMIT_MESSAGE"
fi

# 새 버전 가져오기
NEW_VERSION=$(node -p "require('./package.json').version")
echo -e "${GREEN}✅ 새 버전: v$NEW_VERSION${NC}"

# 태그 푸시
echo -e "${GREEN}🚀 태그 푸시 중...${NC}"
git push origin $CURRENT_BRANCH
git push origin "v$NEW_VERSION"

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✅ 릴리즈 v$NEW_VERSION 시작됨!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "📦 GitHub Actions에서 빌드 중..."
echo "🔗 진행 상황: https://github.com/devbug/HyeniMC/actions"
echo "📋 릴리즈 페이지: https://github.com/devbug/HyeniMC/releases/tag/v$NEW_VERSION"
echo ""
echo "빌드가 완료되면 자동으로 릴리즈가 생성되고,"
echo "사용자들은 런처를 통해 자동 업데이트를 받게 됩니다."
echo ""
