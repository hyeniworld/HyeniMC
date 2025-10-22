#!/usr/bin/env bash
#
# Update mod registry v2 from deployed mods
#
# Usage:
#   ./update-registry-v2.sh MOD_ID1 [MOD_ID2 ...]
#
# Example:
#   ./update-registry-v2.sh hyenihelper hyenicore
#

set -e

# Detect OS
if [[ "$OSTYPE" == "darwin"* ]]; then
    OS="macos"
elif [[ "$OSTYPE" == "linux"* ]]; then
    OS="linux"
else
    OS="unknown"
fi

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

# Check jq
if ! command -v jq &> /dev/null; then
    echo -e "${RED}Error: jq is required but not installed${NC}" >&2
    echo "Install: brew install jq" >&2
    exit 1
fi

# Get Worker URL
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKER_URL=$("$SCRIPT_DIR/scripts/get-worker-url.sh" 2>/dev/null)

echo -e "${CYAN}📝 모드 레지스트리 업데이트 v2.0${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${GREEN}✅ 발견된 모드: $# 개${NC}"
echo ""

# Collect mod information
MODS_JSON="["
FIRST=true

for MOD_ID in "$@"; do
    echo -e "${CYAN}📦 $MOD_ID 정보 수집 중...${NC}"
    
    API_URL="$WORKER_URL/api/v2/mods/$MOD_ID/latest"
    
    if ! RESPONSE=$(curl -s "$API_URL" 2>&1); then
        echo -e "${RED}   ❌ 실패: 정보를 가져올 수 없습니다.${NC}"
        continue
    fi
    
    # Parse with jq
    VERSION=$(echo "$RESPONSE" | jq -r '.version // empty')
    NAME=$(echo "$RESPONSE" | jq -r '.name // empty')
    GAME_VERSIONS=$(echo "$RESPONSE" | jq -c '.gameVersions // []')
    LOADERS=$(echo "$RESPONSE" | jq -c '.loaders // {}')
    
    if [ -z "$VERSION" ] || [ "$VERSION" = "null" ]; then
        echo -e "${RED}   ❌ 실패: 버전 정보를 찾을 수 없습니다.${NC}"
        continue
    fi
    
    # Build loaders compatibility array
    LOADERS_ARRAY="["
    FIRST_LOADER=true
    
    for LOADER_TYPE in $(echo "$LOADERS" | jq -r 'keys[]'); do
        if [ "$FIRST_LOADER" = false ]; then
            LOADERS_ARRAY+=","
        fi
        
        # Get game versions for this loader
        LOADER_GAME_VERSIONS=$(echo "$LOADERS" | jq -c ".[\"$LOADER_TYPE\"].gameVersions | keys")
        
        # Get min loader version (from first game version)
        FIRST_GAME_VER=$(echo "$LOADER_GAME_VERSIONS" | jq -r '.[0]')
        MIN_LOADER_VER=$(echo "$LOADERS" | jq -r ".[\"$LOADER_TYPE\"].gameVersions[\"$FIRST_GAME_VER\"].minLoaderVersion // \"0.0.0\"")
        MAX_LOADER_VER=$(echo "$LOADERS" | jq -r ".[\"$LOADER_TYPE\"].gameVersions[\"$FIRST_GAME_VER\"].maxLoaderVersion // null")
        
        LOADERS_ARRAY+=$(cat <<EOF
{
  "type": "$LOADER_TYPE",
  "minVersion": "$MIN_LOADER_VER",
  "maxVersion": $MAX_LOADER_VER,
  "supportedGameVersions": $LOADER_GAME_VERSIONS
}
EOF
)
        
        FIRST_LOADER=false
    done
    
    LOADERS_ARRAY+="]"
    
    # Determine category (default: optional)
    CATEGORY=$(echo "$RESPONSE" | jq -r '.category // "optional"')
    
    # Add to JSON
    if [ "$FIRST" = false ]; then
        MODS_JSON+=","
    fi
    
    MODS_JSON+=$(cat <<EOF

    {
      "id": "$MOD_ID",
      "name": "$NAME",
      "description": "HyeniMC $MOD_ID mod",
      "latestVersion": "$VERSION",
      "category": "$CATEGORY",
      "gameVersions": $GAME_VERSIONS,
      "loaders": $LOADERS_ARRAY,
      "dependencies": {
        "required": [],
        "optional": []
      }
    }
EOF
)
    
    FIRST=false
    echo -e "${GREEN}   ✅ 수집 완료: v$VERSION${NC}"
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

# Get current timestamp
if [[ "$OS" == "macos" ]]; then
    TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
else
    TIMESTAMP=$(date -u --iso-8601=seconds | sed 's/+00:00/Z/')
fi

cat > "$REGISTRY_PATH" <<EOF
{
  "version": "2.0",
  "lastUpdated": "$TIMESTAMP",
  "mods": $MODS_JSON
}
EOF

# Validate JSON
if ! jq empty "$REGISTRY_PATH" 2>/dev/null; then
    echo -e "${RED}   ❌ 생성된 JSON이 유효하지 않습니다${NC}"
    exit 1
fi

echo -e "${GREEN}   ✅ 생성 완료${NC}"

# Upload to R2
echo -e "${CYAN}📤 R2에 업로드 중...${NC}"

if ! wrangler r2 object put "hyenimc-releases/mods/registry.json" --remote --file "$REGISTRY_PATH" 2>&1 > /dev/null; then
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
echo -e "${NC}🔗 확인 (v2):${NC}"
echo -e "\033[0;34m   $WORKER_URL/api/v2/mods${NC}"
echo ""
