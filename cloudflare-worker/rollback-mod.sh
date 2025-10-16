#!/usr/bin/env bash
#
# Rollback a mod to a specific version
#
# Usage:
#   ./rollback-mod.sh -m MODULE_ID [-v VERSION]
#
# Example:
#   ./rollback-mod.sh -m hyenihelper -v 1.0.0
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
GRAY='\033[0;37m'
BLUE='\033[0;34m'
NC='\033[0m'

# Variables
MOD_ID=""
VERSION=""

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -m|--mod-id)
            MOD_ID="$2"
            shift 2
            ;;
        -v|--version)
            VERSION="$2"
            shift 2
            ;;
        -h|--help)
            cat <<EOF
Usage: $0 -m MODULE_ID [-v VERSION]

Options:
  -m, --mod-id    Mod ID (e.g., hyenihelper)
  -v, --version   Target version (optional, will list if not provided)
  -h, --help      Show this help message

Example:
  $0 -m hyenihelper -v 1.0.0
EOF
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}" >&2
            exit 1
            ;;
    esac
done

if [ -z "$MOD_ID" ]; then
    echo -e "${RED}Error: Module ID is required${NC}" >&2
    echo "Run '$0 --help' for usage information" >&2
    exit 1
fi

# Get Worker URL
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKER_URL=$("$SCRIPT_DIR/scripts/get-worker-url.sh")

echo -e "${CYAN}🔄 모드 버전 롤백${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${NC}📦 모드 ID: $MOD_ID${NC}"
echo ""

# Get current version
echo -e "${CYAN}📡 현재 버전 확인 중...${NC}"
API_URL="$WORKER_URL/api/mods/$MOD_ID/latest"

if ! CURRENT_LATEST=$(curl -s "$API_URL" 2>&1); then
    echo -e "${RED}   ❌ 현재 버전 정보를 가져올 수 없습니다.${NC}"
    exit 1
fi

CURRENT_VERSION=$(echo "$CURRENT_LATEST" | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
echo -e "${GREEN}   ✅ 현재 버전: $CURRENT_VERSION${NC}"
echo ""

# Get available versions
echo -e "${CYAN}📋 사용 가능한 버전 목록 조회 중...${NC}"
VERSIONS_URL="$WORKER_URL/api/mods/$MOD_ID/versions"

if ! VERSIONS_RESPONSE=$(curl -s "$VERSIONS_URL" 2>&1); then
    echo -e "${RED}   ❌ 버전 목록을 가져올 수 없습니다.${NC}"
    exit 1
fi

VERSIONS=$(echo "$VERSIONS_RESPONSE" | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | sort -rV)

if [ -z "$VERSIONS" ]; then
    echo -e "${RED}   ❌ 사용 가능한 버전이 없습니다.${NC}"
    exit 1
fi

echo -e "${GREEN}   ✅ 발견된 버전: $(echo "$VERSIONS" | wc -l)개${NC}"
echo ""

# If version not specified, list versions and prompt
if [ -z "$VERSION" ]; then
    echo -e "${NC}사용 가능한 버전:${NC}"
    echo ""
    
    while IFS= read -r ver; do
        if [ "$ver" = "$CURRENT_VERSION" ]; then
            echo -e "${GREEN}  ▶ v$ver ${CYAN}(current)${NC}"
        else
            echo -e "${GRAY}    v$ver${NC}"
        fi
    done <<< "$VERSIONS"
    
    echo ""
    echo -en "${CYAN}롤백할 버전을 입력하세요: ${NC}"
    read -r VERSION
    
    if [ -z "$VERSION" ]; then
        echo -e "${RED}버전이 입력되지 않았습니다.${NC}"
        exit 1
    fi
fi

# Validate version exists
if ! echo "$VERSIONS" | grep -qx "$VERSION"; then
    echo -e "${RED}❌ 오류: 버전 $VERSION 을 찾을 수 없습니다.${NC}"
    exit 1
fi

# Check if it's the same as current
if [ "$VERSION" = "$CURRENT_VERSION" ]; then
    echo -e "${YELLOW}⚠️  이미 현재 버전입니다: v$VERSION${NC}"
    exit 0
fi

# Confirm rollback
echo ""
echo -e "${YELLOW}⚠️  경고: 이 작업은 모든 사용자에게 영향을 줍니다.${NC}"
echo -e "${NC}   • 현재 버전: v$CURRENT_VERSION${NC}"
echo -e "${NC}   • 롤백할 버전: v$VERSION${NC}"
echo ""
echo -en "${CYAN}계속하시겠습니까? (y/N): ${NC}"
read -r CONFIRM

if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo -e "${GRAY}취소되었습니다.${NC}"
    exit 0
fi

echo ""
echo -e "${CYAN}🔄 롤백 진행 중...${NC}"

# Download the target version's manifest
TEMP_DIR=$(mktemp -d)
trap "rm -rf '$TEMP_DIR'" EXIT

TARGET_MANIFEST="$TEMP_DIR/manifest.json"
TARGET_PATH="hyenimc-releases/mods/$MOD_ID/$VERSION/manifest.json"

echo -e "${CYAN}   📥 v$VERSION manifest 다운로드 중...${NC}"

if ! wrangler r2 object get "$TARGET_PATH" --file "$TARGET_MANIFEST" 2>&1 > /dev/null; then
    echo -e "${RED}   ❌ manifest를 찾을 수 없습니다.${NC}"
    exit 1
fi

echo -e "${GREEN}   ✅ 다운로드 완료${NC}"

# Update latest.json
echo -e "${CYAN}   📤 latest.json 업데이트 중...${NC}"
LATEST_PATH="hyenimc-releases/mods/$MOD_ID/latest.json"

if ! wrangler r2 object put "$LATEST_PATH" --remote --file "$TARGET_MANIFEST" 2>&1 > /dev/null; then
    echo -e "${RED}   ❌ 실패${NC}"
    exit 1
fi

echo -e "${GREEN}   ✅ 업데이트 완료${NC}"

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✅ 롤백 완료!${NC}"
echo ""
echo -e "${NC}📊 변경 사항:${NC}"
echo -e "${GRAY}   • 모드: $MOD_ID${NC}"
echo -e "${GRAY}   • 이전: v$CURRENT_VERSION${NC}"
echo -e "${GRAY}   • 현재: v$VERSION${NC}"
echo ""
echo -e "${NC}🔗 확인:${NC}"
echo -e "${BLUE}   curl $WORKER_URL/api/mods/$MOD_ID/latest${NC}"
echo ""
echo -e "${YELLOW}💡 런처 사용자들은 자동으로 v$VERSION 로 업데이트됩니다.${NC}"
echo ""
