#!/usr/bin/env bash
#
# Update mod registry from deployed mods
#
# Usage:
#   ./update-registry.sh MOD_ID1 [MOD_ID2 ...]
#
# Example:
#   ./update-registry.sh hyenihelper hyenicore
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
GRAY='\033[0;37m'
NC='\033[0m'

if [ $# -eq 0 ]; then
    echo -e "${RED}Error: At least one module ID is required${NC}" >&2
    echo "Usage: $0 MOD_ID1 [MOD_ID2 ...]" >&2
    echo "Example: $0 hyenihelper hyenicore" >&2
    exit 1
fi

# Get Worker URL
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKER_URL=$("$SCRIPT_DIR/scripts/get-worker-url.sh")

echo -e "${CYAN}📝 모드 레지스트리 업데이트${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${GREEN}✅ 발견된 모드: $# 개${NC}"
echo ""

# Collect mod information
MODS_JSON="["
FIRST=true

for MOD_ID in "$@"; do
    echo -e "${CYAN}📦 $MOD_ID 정보 수집 중...${NC}"
    
    API_URL="$WORKER_URL/api/mods/$MOD_ID/latest"
    
    if ! RESPONSE=$(curl -s "$API_URL" 2>&1); then
        echo -e "${RED}   ❌ 실패: 정보를 가져올 수 없습니다.${NC}"
        continue
    fi
    
    # Parse JSON (simple parsing)
    VERSION=$(echo "$RESPONSE" | grep -oP '"version"\s*:\s*"\K[^"]+')
    GAME_VERSIONS=$(echo "$RESPONSE" | grep -oP '"gameVersions"\s*:\s*\[\s*"\K[^"]+')
    
    if [ -z "$VERSION" ]; then
        echo -e "${RED}   ❌ 실패: 버전 정보를 찾을 수 없습니다.${NC}"
        continue
    fi
    
    # Capitalize first letter of mod name
    MOD_NAME=$(echo "$MOD_ID" | sed 's/^\(.\)/\U\1/')
    
    # Add to JSON
    if [ "$FIRST" = false ]; then
        MODS_JSON+=","
    fi
    
    MODS_JSON+=$(cat <<EOF

    {
      "id": "$MOD_ID",
      "name": "$MOD_NAME",
      "description": "HyeniMC $MOD_ID mod",
      "latestVersion": "$VERSION",
      "gameVersions": ["$GAME_VERSIONS"]
    }
EOF
)
    
    FIRST=false
    echo -e "${GREEN}   ✅ 수집 완료: v$VERSION (MC $GAME_VERSIONS)${NC}"
done

MODS_JSON+=$'\n  ]'

if [ "$MODS_JSON" = $'[\n  ]' ]; then
    echo ""
    echo -e "${RED}❌ 수집된 모드 정보가 없습니다.${NC}"
    exit 1
fi

echo ""
echo -e "${CYAN}📝 registry.json 생성 중...${NC}"

# Create registry.json
TEMP_DIR=$(mktemp -d)
trap "rm -rf '$TEMP_DIR'" EXIT

REGISTRY_PATH="$TEMP_DIR/registry.json"
cat > "$REGISTRY_PATH" <<EOF
{
  "version": "1.0",
  "lastUpdated": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "mods": $MODS_JSON
}
EOF

echo -e "${GREEN}   ✅ 생성 완료${NC}"

# Upload to R2
echo -e "${CYAN}📤 R2에 업로드 중...${NC}"

if ! wrangler r2 object put "hyenimc-releases/registry.json" --remote --file "$REGISTRY_PATH" 2>&1 > /dev/null; then
    echo -e "${RED}   ❌ 업로드 실패${NC}"
    exit 1
fi

echo -e "${GREEN}   ✅ 업로드 완료${NC}"

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✅ 레지스트리 업데이트 완료!${NC}"
echo ""
echo -e "${NC}📊 업데이트된 모드: $# 개${NC}"
echo ""
echo -e "${NC}🔗 확인:${NC}"
echo -e "\033[0;34m   $WORKER_URL/api/mods${NC}"
echo ""
