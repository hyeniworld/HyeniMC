#!/usr/bin/env bash
#
# List all versions of a mod
#
# Usage:
#   ./list-versions.sh -m MODULE_ID
#
# Example:
#   ./list-versions.sh -m hyenihelper
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

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -m|--mod-id)
            MOD_ID="$2"
            shift 2
            ;;
        -h|--help)
            cat <<EOF
Usage: $0 -m MODULE_ID

Options:
  -m, --mod-id    Mod ID (e.g., hyenihelper)
  -h, --help      Show this help message

Example:
  $0 -m hyenihelper
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

echo -e "${CYAN}📋 모드 버전 목록${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${NC}📦 모드 ID: $MOD_ID${NC}"
echo ""

# Get current latest version
echo -e "${CYAN}🔍 현재 버전 확인 중...${NC}"
API_URL="$WORKER_URL/api/mods/$MOD_ID/latest"

if CURRENT_LATEST=$(curl -s "$API_URL" 2>&1); then
    CURRENT_VERSION=$(echo "$CURRENT_LATEST" | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
    if [ -n "$CURRENT_VERSION" ]; then
        echo -e "${GREEN}   ✅ 현재 버전: $CURRENT_VERSION${NC}"
    else
        echo -e "${YELLOW}   ⚠️  latest.json을 찾을 수 없습니다.${NC}"
    fi
else
    echo -e "${YELLOW}   ⚠️  latest.json을 찾을 수 없습니다.${NC}"
    CURRENT_VERSION=""
fi

echo ""

# Get all versions
echo -e "${CYAN}📡 모든 버전 조회 중...${NC}"
VERSIONS_URL="$WORKER_URL/api/mods/$MOD_ID/versions"

if ! VERSIONS_RESPONSE=$(curl -s "$VERSIONS_URL" 2>&1); then
    echo -e "${RED}   ❌ 버전 목록을 가져올 수 없습니다.${NC}"
    exit 1
fi

# Parse versions (simple JSON parsing)
VERSIONS=$(echo "$VERSIONS_RESPONSE" | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | sort -rV)

if [ -z "$VERSIONS" ]; then
    echo -e "${YELLOW}   ⚠️  배포된 버전이 없습니다.${NC}"
    exit 0
fi

VERSION_COUNT=$(echo "$VERSIONS" | wc -l)
echo -e "${GREEN}   ✅ 발견된 버전: $VERSION_COUNT개${NC}"
echo ""

echo -e "${NC}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Display versions
while IFS= read -r ver; do
    if [ "$ver" = "$CURRENT_VERSION" ]; then
        echo -e "${GREEN}  ▶ v$ver ${CYAN}(latest)${NC}"
    else
        echo -e "${GRAY}    v$ver${NC}"
    fi
done <<< "$VERSIONS"

echo ""
echo -e "${NC}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}💡 롤백하려면: ./rollback-mod.sh -m $MOD_ID -v VERSION${NC}"
echo ""
